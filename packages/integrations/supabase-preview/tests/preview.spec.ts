import { beforeEach, describe, expect, it } from 'vitest'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { SupabaseMutationRecord } from '../src/index.ts'
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
    waitForExit: () => Promise.resolve(true),
  }
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
    expect(outcome.gates.map(gate => gate.name)).toEqual(['migration-push', 'migration-list', 'lint'])
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

describe('what settling a preview command means', () => {
  /**
   * A handle whose direct child has closed while its tree has not.
   * @param quiescence - how the wait for the tree resolves.
   * @returns the lingering handle.
   */
  function lingering(quiescence: Promise<boolean>): SubprocessHandle {
    const reader = { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) }
    return {
      pid: 4242,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: { stdout: reader, stderr: reader },
      done: Promise.resolve({ exitCode: 0, signal: null } as SubprocessOutcome),
      terminate: () => {},
      waitForExit: () => quiescence,
    }
  }

  /**
   * A capability whose every command lingers the same way.
   * @param quiescence - how the wait for each tree resolves.
   * @returns the capability under test.
   */
  function withTree(quiescence: Promise<boolean>): SupabasePreview {
    return new SupabasePreview({ cwd: '/repo', spawn: () => lingering(quiescence), projectRef: PARENT_REF })
  }

  it('does not call a command finished while its tree is still up', async () => {
    let release = (_value: boolean): void => {}
    const quiescence = new Promise<boolean>((resolve) => { release = resolve })
    let settledRun = false
    const running = withTree(quiescence).run({ branchName: 'pr-7' }).then((outcome) => {
      settledRun = true
      return outcome
    })

    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve()
    expect(settledRun).toBe(false)

    // The child closed twenty ticks ago. What the run was waiting for is the
    // tree the child started, which is the thing that can still write.
    release(false)
    await running
  })

  it('refuses to report a run whose tree could not be observed to exit', async () => {
    const outcome = await withTree(Promise.resolve(false)).run({ branchName: 'pr-7' })

    expect(outcome.status).toBe('BLOCKED')
    expect(outcome.summary).toContain('process tree')
  })

  it('names no command output when a tree cannot be reaped', async () => {
    const leak = new Error(`supabase: ${PREVIEW_CONNECTION} refused`)
    const outcome = await withTree(Promise.reject(leak)).run({ branchName: 'pr-7' })

    // The cause is dropped rather than wrapped: a Supabase rejection echoes
    // the connection string it was given, and this reaches a durable record.
    expect(outcome.status).toBe('BLOCKED')
    expect(outcome.summary).not.toContain('s3cr3t')
    expect(outcome.summary).not.toContain('postgresql://')
  })
})

describe('a run that stops at the first gate it cannot get past', () => {
  /**
   * The capability under test, bound to the parent project.
   * @param testCommand - the project suite to run, when there is one.
   * @returns the capability.
   */
  function preview(testCommand?: readonly string[]): SupabasePreview {
    return new SupabasePreview({
      cwd: '/repo',
      spawn: seam,
      projectRef: PARENT_REF,
      pollIntervalMs: 0,
      ...testCommand === undefined ? {} : { testCommand },
    })
  }

  it('asks nothing of a branch whose migrations did not apply', async () => {
    scripts.push({ match: names('db', 'push'), respond: () => ({ exitCode: 1, stdout: '', stderr: 'relation exists' }) })

    const outcome = await preview(['pnpm', 'test']).run({ branchName: 'pr-7' })

    expect(outcome.status).toBe('FAILED')
    expect(outcome.primaryFailure?.gate).toBe('migration-push')
    expect(outcome.gates.map(gate => gate.name)).toEqual(['migration-push'])
    expect(outcome.skippedGates).toEqual(['migration-list', 'lint', 'project-tests'])
    expect(outcome.completedGates).toEqual(['create', 'identity', 'health'])
    // Lint and a test suite read off a schema that was never applied describe a
    // database that does not exist.
    expect(issued.some(spec => spec.argv.includes('lint'))).toBe(false)
    expect(issued.some(spec => spec.argv[0] === 'pnpm')).toBe(false)
    // The branch still goes away.
    expect(outcome.cleanup.attempted).toBe(true)
    expect(outcome.cleanup.succeeded).toBe(true)
  })

  it('never migrates a branch that reports the parent as its own ref', async () => {
    scripts.unshift({
      match: names('branches', 'get'),
      respond: () => ({
        exitCode: 0,
        stdout: JSON.stringify({ id: 'b1', project_ref: PARENT_REF, status: 'ACTIVE_HEALTHY', db_url: PREVIEW_CONNECTION }),
      }),
    })

    const outcome = await preview().run({ branchName: 'pr-7' })

    expect(outcome.status).toBe('BLOCKED')
    expect(outcome.failure?.code).toBe('shared-parent')
    expect(outcome.primaryFailure?.gate).toBe('identity')
    expect(outcome.completedGates).toEqual(['create'])
    expect(outcome.skippedGates).toEqual(['health', 'migration-push', 'migration-list', 'lint'])
    expect(issued.some(spec => spec.argv.includes('push'))).toBe(false)
    expect(outcome.cleanup.attempted).toBe(true)
  })

  it('does not run the project suite against a branch that failed lint', async () => {
    scripts.push({ match: names('db', 'lint'), respond: () => ({ exitCode: 1, stdout: '', stderr: 'unindexed key' }) })

    const outcome = await preview(['pnpm', 'test']).run({ branchName: 'pr-7' })

    expect(outcome.status).toBe('FAILED')
    expect(outcome.primaryFailure?.gate).toBe('lint')
    expect(outcome.skippedGates).toEqual(['project-tests'])
    expect(issued.some(spec => spec.argv[0] === 'pnpm')).toBe(false)
    expect(outcome.cleanup.succeeded).toBe(true)
  })

  it('plans no gate it was never going to run', async () => {
    scripts.push({ match: names('db', 'push'), respond: () => ({ exitCode: 1, stdout: '', stderr: '' }) })

    const outcome = await preview().run({ branchName: 'pr-7' })

    // No test command was configured, so the suite is not a gate this run
    // skipped — it is a gate this run never had.
    expect(outcome.skippedGates).toEqual(['migration-list', 'lint'])
  })

  it('keeps a branch that would not go away apart from the gates', async () => {
    scripts.push({ match: names('branches', 'delete'), respond: () => ({ exitCode: 1, stdout: '', stderr: '' }) })

    const outcome = await preview().run({ branchName: 'pr-7' })

    // Every gate passed and the branch leaked. Both are true, and folding
    // either into the other sends the wrong call to the wrong place.
    expect(outcome.status).toBe('PASSED')
    expect(outcome.primaryFailure).toBeUndefined()
    expect(outcome.cleanupFailure).toContain('deleting the preview branch failed')
  })

  it('does not let a clean teardown redeem a failed gate', async () => {
    scripts.push({ match: names('db', 'push'), respond: () => ({ exitCode: 1, stdout: '', stderr: '' }) })

    const outcome = await preview().run({ branchName: 'pr-7' })

    expect(outcome.status).toBe('FAILED')
    expect(outcome.cleanup.succeeded).toBe(true)
    expect(outcome.cleanupFailure).toBeUndefined()
  })
})

describe('checkpointing what the run left in the cloud', () => {
  /**
   * A capability whose hosted mutations are handed to an observer.
   * @param onMutation - what the observer does with each record.
   * @returns the capability under test.
   */
  function observed(onMutation: (record: SupabaseMutationRecord) => Promise<void>): SupabasePreview {
    return new SupabasePreview({
      cwd: '/repo',
      spawn: seam,
      projectRef: PARENT_REF,
      pollIntervalMs: 0,
      onMutation,
    })
  }

  it('records each hosted change only once the world has confirmed it', async () => {
    const seen: SupabaseMutationRecord[] = []

    const outcome = await observed(async (record) => { seen.push(record) }).run({ branchName: 'pr-7' })

    expect(outcome.status).toBe('PASSED')
    expect(seen.map(record => record.action)).toEqual(['preview-created', 'migrations-applied', 'preview-deleted'])
    // The ref recorded is the child's, which is the thing the identity read
    // proved and the thing a leaked branch would be found under.
    expect(seen.every(record => record.previewProjectRef === PREVIEW_REF)).toBe(true)
    expect(seen.every(record => record.branchName === 'pr-7')).toBe(true)
  })

  it('carries no connection, password or token into a record', async () => {
    const seen: SupabaseMutationRecord[] = []

    await observed(async (record) => { seen.push(record) }).run({ branchName: 'pr-7' })

    const written = JSON.stringify(seen)
    expect(written).not.toContain('postgresql://')
    expect(written).not.toContain('s3cr3t')
    expect(Object.keys(seen[0] ?? {}).sort()).toEqual(['action', 'branchName', 'previewProjectRef'])
  })

  it('does not migrate a branch whose creation could not be recorded', async () => {
    const outcome = await observed(async (record) => {
      if (record.action === 'preview-created') throw new Error(`the journal refused ${PREVIEW_CONNECTION}`)
    }).run({ branchName: 'pr-7' })

    expect(outcome.status).toBe('BLOCKED')
    expect(outcome.failure?.code).toBe('uncheckpointed-mutation')
    expect(issued.some(spec => spec.argv.includes('push'))).toBe(false)
    // The branch exists even though nothing recorded it, so the run still takes
    // it away rather than leaving it up as compensation for its own bookkeeping.
    expect(outcome.cleanup.attempted).toBe(true)
    expect(outcome.cleanup.succeeded).toBe(true)
    // And the refusal itself is not allowed to carry the connection outward.
    expect(outcome.summary).not.toContain('s3cr3t')
  })

  it('does not record migrations the branch was never read back as holding', async () => {
    scripts.push({ match: names('migration', 'list'), respond: () => ({ exitCode: 1, stdout: '', stderr: '' }) })
    const seen: string[] = []

    const outcome = await observed(async (record) => { seen.push(record.action) }).run({ branchName: 'pr-7' })

    expect(outcome.status).toBe('FAILED')
    // The push exited zero. What is missing is the read that says the branch
    // holds the history, and an unread migration is not an applied one.
    expect(seen).toEqual(['preview-created', 'preview-deleted'])
  })

  it('reports a delete nobody could record as a cleanup failure', async () => {
    const outcome = await observed(async (record) => {
      if (record.action === 'preview-deleted') throw new Error('the journal is gone')
    }).run({ branchName: 'pr-7' })

    // The gates all passed and the branch is gone; what failed is the record of
    // it going, which belongs on the cleanup side of the report.
    expect(outcome.status).toBe('PASSED')
    expect(outcome.cleanup.succeeded).toBe(false)
    expect(outcome.cleanupFailure).toContain('preview-deleted')
  })
})
