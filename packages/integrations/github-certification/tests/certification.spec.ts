import { beforeEach, describe, expect, it } from 'vitest'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { WorkflowObjective } from '@trick-harness/contracts'
import { CertificationError } from '../src/commands.ts'
import { GitHubCertification } from '../src/index.ts'

const SHA = 'a'.repeat(40)
const OTHER_SHA = 'b'.repeat(40)
const CONTEXT = 'plurora/harness-certification'
const PR_URL = 'https://github.com/owner/repo/pull/7'
/** A checkout path distinctive enough that leaking it would be visible. */
const CWD = '/home/operator/checkouts/neuro-via'

const OBJECTIVE: WorkflowObjective = Object.freeze({
  id: 'obj-1',
  cwd: CWD,
  requirement: 'add the thing',
  risk: 'low',
  workload: 'heavy',
  profileId: 'plurora',
  approvedArtifacts: {
    spec: { path: 'docs/spec.md', sha256: 'a'.repeat(64) },
    plan: { path: 'docs/plan.md', sha256: 'b'.repeat(64) },
  },
})

/** One scripted answer for a command this test does not want to really run. */
interface Script {
  readonly match: (argv: readonly string[]) => boolean
  readonly respond: (argv: readonly string[]) => { exitCode: number; stdout?: string; stderr?: string }
}

/** Every spawn request the certification under test constructed, in order. */
let issued: SubprocessSpawnSpec[] = []
/** Scripted answers, consulted in order; the first match wins. */
let scripts: Script[] = []
/** Handles that were asked to terminate, and whether their tree was awaited. */
let reaped: string[] = []

/**
 * A settled handle over a fixed result, shaped like the subprocess seam.
 *
 * @param argv - the command this handle stands for, for the reaping log.
 * @param answer - the exit code and stream text to report.
 * @returns a handle whose `done` is already resolving.
 */
function settled(
  argv: readonly string[],
  answer: { exitCode: number; stdout?: string; stderr?: string },
): SubprocessHandle {
  const reader = (text: string) => ({ readFrom: () => ({ text, nextOffset: text.length, lossy: false }) })
  return {
    pid: -1,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: { stdout: reader(answer.stdout ?? ''), stderr: reader(answer.stderr ?? '') },
    done: Promise.resolve({ exitCode: answer.exitCode, signal: null }),
    terminate: () => {},
    waitForExit: async () => { reaped.push(argv.join(' ')); return true },
  }
}

/** The seam handed to the certification: scripted answers, and a full record. */
function seam(spec: SubprocessSpawnSpec): SubprocessHandle {
  issued.push(spec)
  const answer = scripts.find(entry => entry.match(spec.argv))?.respond(spec.argv)
    ?? { exitCode: 1, stdout: '', stderr: 'no script matched' }
  return settled(spec.argv, answer)
}

/** Match a command by the leading words of its argv. */
const starts = (...prefix: string[]) => (argv: readonly string[]): boolean =>
  prefix.every((word, at) => argv[at] === word)

/** Whether one command is the status POST. */
const isPost = (argv: readonly string[]): boolean =>
  argv[0] === 'gh' && argv[2] === '--method' && argv[3] === 'POST'

/** The argv of every command constructed so far. */
const argvs = (): (readonly string[])[] => issued.map(spec => spec.argv)

/** The value of one `-f key=value` pair in the POST that was constructed. */
function posted(key: string): string | undefined {
  const argv = argvs().find(isPost)
  if (argv === undefined) return undefined
  const at = argv.findIndex(word => word.startsWith(`${key}=`))
  return at === -1 ? undefined : argv[at]?.slice(key.length + 1)
}

/** One pull request as the API reports it. */
const pullRequest = (over: Record<string, unknown> = {}): string => JSON.stringify({
  state: 'open',
  base: { ref: 'main' },
  head: { ref: 'feature/x', sha: SHA },
  ...over,
})

/** The statuses read back after a POST, newest first as GitHub returns them. */
const statuses = (...entries: { state: string; context: string; id?: number }[]): string =>
  JSON.stringify(entries.map(entry => ({
    id: entry.id ?? 4321,
    state: entry.state,
    context: entry.context,
    target_url: PR_URL,
  })))

/** The scripts for a checkout whose every identity reading agrees. */
function happyPath(state = 'pending'): Script[] {
  return [
    { match: starts('git', 'branch'), respond: () => ({ exitCode: 0, stdout: 'feature/x\n' }) },
    { match: starts('git', 'rev-parse'), respond: () => ({ exitCode: 0, stdout: `${SHA}\n` }) },
    { match: starts('gh', 'repo', 'view'), respond: () => ({ exitCode: 0, stdout: 'owner/repo\n' }) },
    {
      match: starts('gh', 'pr', 'view'),
      respond: () => ({ exitCode: 0, stdout: JSON.stringify({ number: 7, url: PR_URL }) }),
    },
    { match: isPost, respond: () => ({ exitCode: 0, stdout: JSON.stringify({ id: 4321, state, context: CONTEXT }) }) },
    {
      match: argv => argv[0] === 'gh' && argv[1] === 'api' && String(argv[2]).includes('/statuses'),
      respond: () => ({ exitCode: 0, stdout: statuses({ state, context: CONTEXT }) }),
    },
    { match: starts('gh', 'api'), respond: () => ({ exitCode: 0, stdout: pullRequest() }) },
  ]
}

/** The capability under test, bound the way the Plurora host binds it. */
const certification = (): GitHubCertification => new GitHubCertification({
  cwd: CWD,
  repository: 'owner/repo',
  baseBranch: 'main',
  context: CONTEXT,
  spawn: seam,
})

beforeEach(() => {
  issued = []
  scripts = happyPath()
  reaped = []
})

describe('what the capability is allowed to be', () => {
  it('publishes a status and offers no way to do anything else', () => {
    const instance = certification()
    const surface = [
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(instance) as object),
    ].filter(name => name !== 'constructor')

    expect(surface).toEqual(['publish'])
  })

  it('refuses at construction to be pointed at something that is not a repository', () => {
    expect(() => new GitHubCertification({
      cwd: CWD, repository: 'owner', baseBranch: 'main', context: CONTEXT, spawn: seam,
    })).toThrow(CertificationError)
  })

  it('refuses at construction a context no branch-protection rule could name', () => {
    expect(() => new GitHubCertification({
      cwd: CWD, repository: 'owner/repo', baseBranch: 'main', context: '', spawn: seam,
    })).toThrow(CertificationError)
  })
})

describe('re-reading identity before every publication', () => {
  it('reads repository, branch, head and pull request before it posts anything', async () => {
    await certification().publish({ objective: OBJECTIVE, state: 'pending' })

    const order = argvs().map(argv => argv.slice(0, 3).join(' '))
    const post = order.findIndex((_, at) => isPost(argvs()[at] as readonly string[]))
    expect(post).toBeGreaterThan(0)
    for (const read of ['gh repo view', 'git branch --show-current', 'git rev-parse HEAD', 'gh pr view --json']) {
      const seen = order.findIndex(entry => entry.startsWith(read.split(' ').slice(0, 3).join(' ')))
      expect(seen).toBeGreaterThanOrEqual(0)
      expect(seen).toBeLessThan(post)
    }
  })

  it('publishes against the revision it re-read, not one it was handed', async () => {
    const result = await certification().publish({ objective: OBJECTIVE, state: 'pending' })

    expect(result.revision).toBe(SHA)
    expect(argvs().find(isPost)?.some(word => word.includes(SHA))).toBe(true)
  })

  it('carries the verified pull request as the only URL it publishes', async () => {
    const result = await certification().publish({ objective: OBJECTIVE, state: 'pending' })

    expect(result.url).toBe(PR_URL)
    expect(posted('target_url')).toBe(PR_URL)
  })

  it('names no filesystem path, command output or credential in its evidence', async () => {
    const result = await certification().publish({ objective: OBJECTIVE, state: 'pending' })

    const text = JSON.stringify(result.evidence)
    expect(text).not.toContain(CWD)
    expect(text).not.toContain('gh ')
    expect(text).not.toMatch(/token|secret|password/i)
    expect(result.evidence.length).toBeGreaterThan(0)
  })
})

describe('what stops a publication before it reaches GitHub', () => {
  /** Replace one scripted answer, keeping the rest of the happy path. */
  const override = (script: Script): void => { scripts = [script, ...scripts] }

  /** Publish and return the error it refused with. */
  async function refusal(input = { objective: OBJECTIVE, state: 'success' as const }): Promise<CertificationError> {
    const error = await certification().publish(input).then(
      () => undefined,
      (thrown: unknown) => thrown,
    )
    expect(error).toBeInstanceOf(CertificationError)
    return error as CertificationError
  }

  it('refuses when the checkout is not the repository it was bound to', async () => {
    override({ match: starts('gh', 'repo', 'view'), respond: () => ({ exitCode: 0, stdout: 'someone/else\n' }) })

    expect((await refusal()).code).toBe('foreign-repository')
    expect(argvs().some(isPost)).toBe(false)
  })

  it('refuses on a detached head, where there is no branch to certify', async () => {
    override({ match: starts('git', 'branch'), respond: () => ({ exitCode: 0, stdout: '\n' }) })

    expect((await refusal()).code).toBe('detached-head')
    expect(argvs().some(isPost)).toBe(false)
  })

  it('refuses when the branch has no pull request', async () => {
    override({ match: starts('gh', 'pr', 'view'), respond: () => ({ exitCode: 1, stdout: 'no pull requests found' }) })

    expect((await refusal()).code).toBe('no-pull-request')
    expect(argvs().some(isPost)).toBe(false)
  })

  it('refuses when the pull request is no longer open', async () => {
    override({ match: starts('gh', 'api'), respond: () => ({ exitCode: 0, stdout: pullRequest({ state: 'closed' }) }) })

    expect((await refusal()).code).toBe('pull-request-closed')
    expect(argvs().some(isPost)).toBe(false)
  })

  it('refuses when the pull request targets a base this deployment does not certify', async () => {
    override({
      match: starts('gh', 'api'),
      respond: () => ({ exitCode: 0, stdout: pullRequest({ base: { ref: 'release/2.0' } }) }),
    })

    expect((await refusal()).code).toBe('foreign-base')
    expect(argvs().some(isPost)).toBe(false)
  })

  it('refuses when the pull request head is a different branch than the checkout', async () => {
    override({
      match: starts('gh', 'api'),
      respond: () => ({ exitCode: 0, stdout: pullRequest({ head: { ref: 'feature/other', sha: SHA } }) }),
    })

    expect((await refusal()).code).toBe('branch-mismatch')
    expect(argvs().some(isPost)).toBe(false)
  })

  it('refuses when the local head is not the head the pull request shows', async () => {
    override({
      match: starts('gh', 'api'),
      respond: () => ({ exitCode: 0, stdout: pullRequest({ head: { ref: 'feature/x', sha: OTHER_SHA } }) }),
    })

    expect((await refusal()).code).toBe('revision-mismatch')
    expect(argvs().some(isPost)).toBe(false)
  })

  it('refuses when the revision the run expected is not the one that is there now', async () => {
    const error = await refusal({ objective: OBJECTIVE, state: 'success', expectedRevision: OTHER_SHA } as never)

    expect(error.code).toBe('revision-mismatch')
    expect(argvs().some(isPost)).toBe(false)
  })

  it('refuses a state outside the published vocabulary', async () => {
    const error = await refusal({ objective: OBJECTIVE, state: 'merged' } as never)

    expect(error.code).toBe('invalid-identity')
    expect(argvs().some(isPost)).toBe(false)
  })

  it('names no command output in the message it refuses with', async () => {
    override({
      match: starts('gh', 'repo', 'view'),
      respond: () => ({ exitCode: 1, stdout: '', stderr: 'gho_secrettokenvalue is invalid; visit https://github.com/login/device' }),
    })

    const error = await refusal()

    expect(error.message).not.toContain('gho_secrettokenvalue')
    expect(error.message).not.toContain('github.com/login/device')
  })
})

describe('what the status actually says', () => {
  it('publishes the context it was constructed with and not one from the run', async () => {
    await certification().publish({ objective: OBJECTIVE, state: 'pending' })

    expect(posted('context')).toBe(CONTEXT)
  })

  it('publishes the fixed description for the state, and nothing about the work', async () => {
    scripts = happyPath('success')

    await certification().publish({ objective: OBJECTIVE, state: 'success' })

    expect(posted('description')).toBe('Harness engineering certification passed')
    expect(posted('description')).not.toContain(OBJECTIVE.requirement)
  })

  it('publishes exactly the state it was asked for', async () => {
    scripts = happyPath('failure')

    await certification().publish({ objective: OBJECTIVE, state: 'failure' })

    expect(posted('state')).toBe('failure')
  })
})

describe('verifying that the status really landed', () => {
  it('reads the statuses back after posting and before reporting success', async () => {
    await certification().publish({ objective: OBJECTIVE, state: 'pending' })

    const order = argvs()
    const post = order.findIndex(isPost)
    const read = order.findIndex(argv => argv[1] === 'api' && String(argv[2]).includes('/statuses'))
    expect(post).toBeGreaterThanOrEqual(0)
    expect(read).toBeGreaterThan(post)
  })

  it('fails when the read-back does not show the state that was requested', async () => {
    scripts = happyPath()
    scripts.unshift({
      match: argv => argv[0] === 'gh' && argv[1] === 'api' && String(argv[2]).includes('/statuses'),
      respond: () => ({ exitCode: 0, stdout: statuses({ state: 'error', context: CONTEXT }) }),
    })

    await expect(certification().publish({ objective: OBJECTIVE, state: 'pending' }))
      .rejects.toThrow(CertificationError)
  })

  it('reads only the latest status for its own context, ignoring everyone else', async () => {
    scripts = happyPath()
    scripts.unshift({
      match: argv => argv[0] === 'gh' && argv[1] === 'api' && String(argv[2]).includes('/statuses'),
      respond: () => ({
        exitCode: 0,
        stdout: statuses(
          { state: 'success', context: CONTEXT, id: 99 },
          { state: 'failure', context: 'ci/build' },
          { state: 'error', context: CONTEXT, id: 1 },
        ),
      }),
    })

    scripts = [scripts[0] as Script, ...happyPath('success')]
    const result = await certification().publish({ objective: OBJECTIVE, state: 'success' })

    expect(result.externalId).toBe('99')
  })

  it('fails when the read-back itself cannot be performed', async () => {
    scripts = happyPath()
    scripts.unshift({
      match: argv => argv[0] === 'gh' && argv[1] === 'api' && String(argv[2]).includes('/statuses'),
      respond: () => ({ exitCode: 1, stdout: '' }),
    })

    await expect(certification().publish({ objective: OBJECTIVE, state: 'pending' }))
      .rejects.toThrow(CertificationError)
  })
})

describe('what the capability does to the machine', () => {
  it('waits for every command it started to be gone before it moves on', async () => {
    await certification().publish({ objective: OBJECTIVE, state: 'pending' })

    expect(reaped.length).toBe(issued.length)
  })

  it('treats a command whose tree cannot be reaped as a failed certification', async () => {
    const stubborn = (spec: SubprocessSpawnSpec): SubprocessHandle => {
      const handle = seam(spec)
      return { ...handle, waitForExit: async () => false }
    }
    const instance = new GitHubCertification({
      cwd: CWD, repository: 'owner/repo', baseBranch: 'main', context: CONTEXT, spawn: stubborn,
    })

    await expect(instance.publish({ objective: OBJECTIVE, state: 'pending' }))
      .rejects.toThrow(CertificationError)
  })

  it('constructs no environment, so no credential can be injected through it', async () => {
    await certification().publish({ objective: OBJECTIVE, state: 'pending' })

    for (const spec of issued) {
      expect(spec.env).toBeUndefined()
      expect(JSON.stringify(spec)).not.toMatch(/token|secret|password|api[_-]?key/i)
    }
  })

  it('runs every command as an argv array with no shell and no stdin', async () => {
    await certification().publish({ objective: OBJECTIVE, state: 'pending' })

    for (const spec of issued) {
      expect(Array.isArray(spec.argv)).toBe(true)
      expect(spec.cwd).toBe(CWD)
      expect(spec.stdio?.stdin).toBe('ignore')
    }
  })

  it('carries the run cancellation into every command it starts', async () => {
    const controller = new AbortController()

    await certification().publish({ objective: OBJECTIVE, state: 'pending' }, controller.signal)

    for (const spec of issued) expect(spec.signal).toBe(controller.signal)
  })
})
