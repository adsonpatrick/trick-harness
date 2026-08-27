import { beforeEach, describe, expect, it } from 'vitest'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { SupabasePreview } from '../src/index.ts'

const PARENT_REF = 'abcdefghijklmnop'
const PREVIEW_REF = 'qrstuvwxyzabcdef'
const PREVIEW_CONNECTION = `postgresql://postgres:s3cr3t@db.${PREVIEW_REF}.supabase.co:5432/postgres`

/** One scripted answer for a command the run is expected to spawn. */
interface Script {
  readonly match: (argv: readonly string[]) => boolean
  readonly respond: () => { exitCode: number | null; stdout: string; stderr?: string }
}

let issued: SubprocessSpawnSpec[] = []
let scripts: Script[] = []

/**
 * A subprocess handle whose result is already known.
 * @param exitCode - the exit code to report.
 * @param stdout - the stdout to collect.
 * @param stderr - the stderr to collect.
 * @returns the settled handle.
 */
function settled(exitCode: number | null, stdout: string, stderr = ''): SubprocessHandle {
  const outcome: SubprocessOutcome = { exitCode, signal: null }
  const reader = (text: string): { readFrom: (from: number) => { text: string; nextOffset: number; lossy: boolean } } => ({
    readFrom: (from: number) => ({ text: text.slice(from), nextOffset: text.length, lossy: false }),
  })
  return {
    pid: 4242,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: { stdout: reader(stdout), stderr: reader(stderr) },
    done: Promise.resolve(outcome),
    terminate: () => {},
    waitForExit: () => Promise.resolve(outcome),
  } as unknown as SubprocessHandle
}

/**
 * The subprocess seam: record what was asked for, answer from the script.
 * @param spec - the spawn request.
 * @returns the scripted handle.
 */
function seam(spec: SubprocessSpawnSpec): SubprocessHandle {
  issued.push(spec)
  const script = scripts.find(candidate => candidate.match(spec.argv))
  if (script === undefined) return settled(0, '')
  const answer = script.respond()
  return settled(answer.exitCode, answer.stdout, answer.stderr ?? '')
}

/**
 * Match a command by the words it names, ignoring flags.
 * @param words - the words to look for, in order.
 * @returns a matcher.
 */
function names(...words: readonly string[]): (argv: readonly string[]) => boolean {
  return argv => words.every(word => argv.includes(word))
}

/**
 * The branch record the CLI reports for a healthy preview branch.
 * @param status - the status word to report.
 * @param connection - the connection to report.
 * @returns JSON as the CLI prints it.
 */
function branchJson(status: string, connection = PREVIEW_CONNECTION): string {
  return JSON.stringify({ id: 'br_1', project_ref: PREVIEW_REF, status, db_url: connection })
}

/**
 * A capability bound to the parent project through the scripted seam.
 * @param overrides - options to override.
 * @returns the capability.
 */
function capability(overrides: Record<string, unknown> = {}): SupabasePreview {
  return new SupabasePreview({
    cwd: process.cwd(),
    spawn: seam,
    projectRef: PARENT_REF,
    pollIntervalMs: 1,
    readyTimeoutMs: 50,
    ...overrides,
  })
}

const argvs = (): readonly (readonly string[])[] => issued.map(spec => spec.argv)

beforeEach(() => {
  issued = []
  scripts = [
    { match: names('branches', 'get'), respond: () => ({ exitCode: 0, stdout: branchJson('MIGRATIONS_PASSED') }) },
  ]
})

describe('a run that provisions, validates and tears down', () => {
  it('creates a branch, waits for it, applies migrations, reads them back, lints and cleans up', async () => {
    const outcome = await capability().run({ branchName: 'preview-run' })

    expect(outcome.status).toBe('PASSED')
    expect(outcome.gates.map(gate => gate.name)).toEqual(['migrations', 'migration-list', 'lint'])
    expect(outcome.cleanup).toEqual({ attempted: true, succeeded: true, message: undefined })

    const spoken = argvs().map(argv => argv.join(' '))
    expect(spoken[0]).toContain('branches create')
    expect(spoken.some(line => line.includes('branches get'))).toBe(true)
    expect(spoken.some(line => line.includes('db push'))).toBe(true)
    expect(spoken.some(line => line.includes('migration list'))).toBe(true)
    expect(spoken.some(line => line.includes('db lint'))).toBe(true)
    expect(spoken.at(-1)).toContain('branches delete')
  })

  it('runs the project suite with the connection in its environment, not in its argv', async () => {
    const outcome = await capability({ testCommand: ['pnpm', 'run', 'db:pgtap'] }).run({ branchName: 'preview-run' })

    expect(outcome.gates.map(gate => gate.name)).toContain('project-tests')
    const suite = issued.find(spec => spec.argv[0] === 'pnpm')
    expect(suite?.argv.join(' ')).not.toContain('postgresql://')
    expect(suite?.env?.['SUPABASE_PREVIEW_DB_URL']).toBe(PREVIEW_CONNECTION)
  })

  it('gives the Supabase commands no constructed environment at all', async () => {
    await capability().run({ branchName: 'preview-run' })

    for (const spec of issued) {
      expect(Array.isArray(spec.argv)).toBe(true)
      if (spec.argv[0] === 'supabase') expect(spec.env).toBeUndefined()
    }
  })
})

describe('a run that never gets a safe database', () => {
  it('reports BLOCKED and issues no delete when the branch was never created', async () => {
    scripts.unshift({ match: names('branches', 'create'), respond: () => ({ exitCode: 1, stdout: '', stderr: 'quota exceeded' }) })

    const outcome = await capability().run({ branchName: 'preview-run' })

    expect(outcome.status).toBe('BLOCKED')
    expect(outcome.cleanup.attempted).toBe(false)
    expect(argvs().some(argv => argv.includes('push'))).toBe(false)
  })

  it('reports BLOCKED and cleans up when the branch never becomes healthy', async () => {
    scripts = [{ match: names('branches', 'get'), respond: () => ({ exitCode: 0, stdout: branchJson('CREATING_PROJECT') }) }]

    const outcome = await capability().run({ branchName: 'preview-run' })

    expect(outcome.status).toBe('BLOCKED')
    expect(outcome.failure?.code).toBe('branch-unhealthy')
    expect(argvs().at(-1)?.join(' ')).toContain('branches delete')
  })

  it('never touches the parent when the branch reports the parent connection', async () => {
    const parentConnection = `postgresql://postgres:pw@db.${PARENT_REF}.supabase.co:5432/postgres`
    scripts = [{
      match: names('branches', 'get'),
      respond: () => ({ exitCode: 0, stdout: branchJson('MIGRATIONS_PASSED', parentConnection) }),
    }]

    const outcome = await capability().run({ branchName: 'preview-run' })

    expect(outcome.status).toBe('BLOCKED')
    expect(outcome.failure?.code).toBe('shared-parent')
    expect(argvs().some(argv => argv.includes('--db-url'))).toBe(false)
    expect(argvs().some(argv => argv.includes('--linked'))).toBe(false)
  })

  it('reports BLOCKED without a gate result when cancelled before the branch was ready', async () => {
    const controller = new AbortController()
    scripts = [{
      match: names('branches', 'get'),
      respond: () => {
        controller.abort()
        return { exitCode: 0, stdout: branchJson('CREATING_PROJECT') }
      },
    }]

    const outcome = await capability().run({ branchName: 'preview-run', signal: controller.signal })

    expect(outcome.status).toBe('BLOCKED')
    expect(outcome.failure?.code).toBe('cancelled')
    expect(outcome.gates).toEqual([])
    expect(argvs().at(-1)?.join(' ')).toContain('branches delete')
  })
})

describe('a gate that fails is not a database that was unreachable', () => {
  it('reports FAILED, keeps the evidence and still cleans up', async () => {
    scripts.unshift({
      match: names('db', 'push'),
      respond: () => ({ exitCode: 1, stdout: '', stderr: 'migration 0002 failed' }),
    })

    const outcome = await capability().run({ branchName: 'preview-run' })

    expect(outcome.status).toBe('FAILED')
    expect(outcome.failure).toBeUndefined()
    expect(outcome.gates[0]?.evidence).toContain('migration 0002 failed')
    expect(outcome.cleanup.succeeded).toBe(true)
  })

  it('keeps no connection string in the evidence it reports', async () => {
    scripts.unshift({
      match: names('db', 'push'),
      respond: () => ({ exitCode: 1, stdout: '', stderr: `could not connect to ${PREVIEW_CONNECTION}` }),
    })

    const outcome = await capability().run({ branchName: 'preview-run' })
    const serialized = JSON.stringify(outcome)

    expect(serialized).not.toContain('s3cr3t')
    expect(serialized).not.toContain(PREVIEW_CONNECTION)
  })
})

describe('cleanup is reported apart from the work', () => {
  it('keeps a failed teardown out of the run result', async () => {
    scripts.unshift({ match: names('branches', 'delete'), respond: () => ({ exitCode: 1, stdout: '', stderr: 'delete failed' }) })

    const outcome = await capability().run({ branchName: 'preview-run' })

    expect(outcome.status).toBe('PASSED')
    expect(outcome.cleanup.succeeded).toBe(false)
    expect(outcome.cleanup.message).toContain('exit code 1')
  })

  it('tears the branch down even when the failure is one this package never named', async () => {
    scripts.unshift({
      match: names('db', 'push'),
      respond: () => { throw new TypeError('the seam refused to spawn') },
    })

    await expect(capability().run({ branchName: 'preview-run' })).rejects.toThrow(TypeError)

    const spoken = argvs().map(argv => argv.join(' '))
    expect(spoken.some(line => line.includes('branches delete'))).toBe(true)
  })
})
