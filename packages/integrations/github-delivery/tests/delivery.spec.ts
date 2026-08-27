import { spawn as spawnProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { DeliveryRecord } from '@trick-harness/journal'
import { GitHubDelivery } from '../src/index.ts'

/** One scripted answer for a `gh` command this test does not want to really run. */
interface GhScript {
  readonly match: (argv: readonly string[]) => boolean
  readonly respond: () => { exitCode: number; stdout: string }
}

/** Every spawn request the delivery under test constructed, in order. */
let issued: SubprocessSpawnSpec[] = []
/** Scripted `gh` answers, consulted in order. */
let ghScripts: GhScript[] = []

/**
 * A settled handle over a fixed result, shaped like the subprocess seam.
 * @param exitCode - exit code to report.
 * @param stdout - stdout text to make readable.
 * @returns a handle whose `done` is already resolving.
 */
function settled(exitCode: number, stdout: string): SubprocessHandle {
  const reader = { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) }
  return {
    pid: -1,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: { stdout: reader, stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } },
    done: Promise.resolve({ exitCode, signal: null }),
    terminate: () => {},
    waitForExit: () => Promise.resolve(true),
  }
}

/**
 * Run a real child process and expose it through the subprocess seam shape.
 *
 * Only the streams this package actually uses are implemented; the rest of the
 * seam is deliberately inert, because a test double that pretended to support
 * piping would be asserting something the package does not do.
 * @param spec - the spawn request the package constructed.
 * @returns a handle over the running child.
 */
function realChild(spec: SubprocessSpawnSpec): SubprocessHandle {
  const [program, ...args] = spec.argv
  const child = spawnProcess(program as string, args, { cwd: spec.cwd, shell: false })
  let out = ''
  let err = ''
  child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString('utf8') })
  child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString('utf8') })
  const done = new Promise<{ exitCode: number | null; signal: null }>((resolve) => {
    child.on('close', (code) => { resolve({ exitCode: code, signal: null }) })
    child.on('error', () => { resolve({ exitCode: 127, signal: null }) })
  })
  return {
    pid: child.pid ?? -1,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {
      stdout: { readFrom: () => ({ text: out, nextOffset: out.length, lossy: false }) },
      stderr: { readFrom: () => ({ text: err, nextOffset: err.length, lossy: false }) },
    },
    done,
    terminate: () => { child.kill() },
    waitForExit: async () => { await done; return true },
  }
}

/**
 * The seam handed to the delivery: real git against the temporary repository,
 * scripted answers for `gh`, and a record of everything constructed.
 * @param spec - the spawn request the package constructed.
 * @returns a handle for the command.
 */
function seam(spec: SubprocessSpawnSpec): SubprocessHandle {
  issued.push(spec)
  if (spec.argv[0] !== 'gh') return realChild(spec)
  const answer = ghScripts.find(entry => entry.match(spec.argv))?.respond() ?? { exitCode: 1, stdout: '' }
  return settled(answer.exitCode, answer.stdout)
}

/** The argv of every command constructed so far. */
const argvs = (): (readonly string[])[] => issued.map(spec => spec.argv)

/**
 * Run a git command in a directory, synchronously enough for setup.
 * @param cwd - working directory.
 * @param args - git arguments.
 */
async function git(cwd: string, ...args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess('git', args, { cwd, shell: false })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`git ${args.join(' ')} exited ${String(code)}`))
    })
    child.on('error', reject)
  })
}

let root: string
let work: string

beforeEach(async () => {
  issued = []
  ghScripts = []
  root = mkdtempSync(join(tmpdir(), 'trick-delivery-'))
  work = join(root, 'work')
  const remote = join(root, 'remote.git')

  await git(root, 'init', '--bare', '--initial-branch=main', remote)
  await git(root, 'init', '--initial-branch=main', work)
  await git(work, 'config', 'user.email', 'test@example.invalid')
  await git(work, 'config', 'user.name', 'Delivery Test')
  await git(work, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(work, 'seed.txt'), 'seed\n')
  await git(work, 'add', 'seed.txt')
  await git(work, 'commit', '-m', 'seed')
  await git(work, 'remote', 'add', 'origin', remote)
  await git(work, 'push', 'origin', 'main')
  await git(work, 'checkout', '-b', 'feat/delivery')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/**
 * Build a delivery bound to the temporary workspace.
 * @returns the capability under test.
 */
function delivery(): GitHubDelivery {
  return new GitHubDelivery({ cwd: work, spawn: seam })
}

/**
 * Script the `gh` calls of a branch that has no pull request yet: the first
 * view finds nothing, the create succeeds, and the read-back finds the new one.
 */
function scriptNewPullRequest(): void {
  let views = 0
  ghScripts = [
    {
      match: argv => argv[2] === 'view',
      respond: () => {
        views += 1
        return views === 1
          ? { exitCode: 1, stdout: '' }
          : { exitCode: 0, stdout: JSON.stringify({ number: 42, url: 'https://example.invalid/pr/42', state: 'OPEN' }) }
      },
    },
    { match: argv => argv[2] === 'create', respond: () => ({ exitCode: 0, stdout: '' }) },
    { match: argv => argv[2] === 'checks', respond: () => ({ exitCode: 0, stdout: '' }) },
  ]
}

describe('validating the branch before anything is written', () => {
  it('reads the branch from the workspace rather than trusting the request', async () => {
    await expect(delivery().validateBranch('feat/something-else')).rejects.toMatchObject({ code: 'foreign-branch' })
  })

  it('refuses to deliver on main even when main is checked out', async () => {
    await git(work, 'checkout', 'main')

    await expect(delivery().validateBranch('main')).rejects.toMatchObject({ code: 'protected-branch' })
  })

  it('refuses a detached head', async () => {
    await git(work, 'checkout', '--detach')

    await expect(delivery().validateBranch('feat/delivery')).rejects.toMatchObject({ code: 'detached-head' })
  })

  it('accepts the feature branch the workspace is actually on', async () => {
    await expect(delivery().validateBranch('feat/delivery')).resolves.toBe('feat/delivery')
  })
})

describe('staging exactly the approved write set', () => {
  it('stages the approved paths and reads the index back to prove it', async () => {
    writeFileSync(join(work, 'a.txt'), 'a\n')
    writeFileSync(join(work, 'b.txt'), 'b\n')

    await expect(delivery().stage(['a.txt', 'b.txt'])).resolves.toEqual(['a.txt', 'b.txt'])
  })

  it('reads a non-ASCII path back as itself rather than as git escaping it', async () => {
    writeFileSync(join(work, 'relatório.txt'), 'ok\n')

    await expect(delivery().stage(['relatório.txt'])).resolves.toEqual(['relatório.txt'])
  })

  it('refuses when the index holds work the delivery was not scoped to commit', async () => {
    writeFileSync(join(work, 'a.txt'), 'a\n')
    writeFileSync(join(work, 'stowaway.txt'), 'not mine\n')
    await git(work, 'add', 'stowaway.txt')

    await expect(delivery().stage(['a.txt'])).rejects.toMatchObject({ code: 'unexpected-stage' })
  })

  it('never constructs a git add that stages the whole tree', async () => {
    writeFileSync(join(work, 'a.txt'), 'a\n')
    await delivery().stage(['a.txt'])

    const add = argvs().find(argv => argv[1] === 'add')
    expect(add).toEqual(['git', 'add', '--', 'a.txt'])
    expect(add).not.toContain('.')
    expect(add).not.toContain('-A')
  })
})

describe('a delivery that lands', () => {
  it('commits, pushes and opens the pull request, reporting re-read facts', async () => {
    scriptNewPullRequest()
    writeFileSync(join(work, 'a.txt'), 'a\n')

    const outcome = await delivery().deliver({
      branch: 'feat/delivery',
      files: ['a.txt'],
      message: 'feat: deliver a',
      pullRequest: { title: 'Deliver a', body: 'body', base: 'main' },
    })

    expect(outcome.delivered).toBe(true)
    expect(outcome.records.map(record => record.action)).toEqual(['commit', 'push', 'pr-open'])
    expect(outcome.commitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(outcome.pullRequest?.number).toBe(42)
    // The SHA is what the repository resolved, not what any command printed.
    for (const record of outcome.records) expect(record.commitSha).toBe(outcome.commitSha)
  })

  it('confirms the push against the remote rather than against the exit code', async () => {
    scriptNewPullRequest()
    writeFileSync(join(work, 'a.txt'), 'a\n')
    await delivery().deliver({
      branch: 'feat/delivery',
      files: ['a.txt'],
      message: 'feat: deliver a',
      pullRequest: { title: 't', body: 'b', base: 'main' },
    })

    expect(argvs().some(argv => argv[1] === 'rev-parse' && argv.includes('refs/remotes/origin/feat/delivery')))
      .toBe(true)
  })

  it('pushes one explicit refspec and never a force flag', async () => {
    scriptNewPullRequest()
    writeFileSync(join(work, 'a.txt'), 'a\n')
    await delivery().deliver({
      branch: 'feat/delivery',
      files: ['a.txt'],
      message: 'feat: deliver a',
      pullRequest: { title: 't', body: 'b', base: 'main' },
    })

    const push = argvs().find(argv => argv[1] === 'push')
    expect(push).toEqual(['git', 'push', '-u', 'origin', 'refs/heads/feat/delivery:refs/heads/feat/delivery'])
  })
})

describe('a branch that already has a pull request', () => {
  it('updates the existing pull request instead of opening a second one', async () => {
    ghScripts = [
      {
        match: argv => argv[2] === 'view',
        respond: () => ({
          exitCode: 0,
          stdout: JSON.stringify({ number: 7, url: 'https://example.invalid/pr/7', state: 'OPEN' }),
        }),
      },
      { match: argv => argv[2] === 'edit', respond: () => ({ exitCode: 0, stdout: '' }) },
      { match: argv => argv[2] === 'checks', respond: () => ({ exitCode: 0, stdout: '' }) },
    ]
    writeFileSync(join(work, 'a.txt'), 'a\n')

    const outcome = await delivery().deliver({
      branch: 'feat/delivery',
      files: ['a.txt'],
      message: 'feat: deliver a',
      pullRequest: { title: 't', body: 'b', base: 'main' },
    })

    expect(outcome.records.at(-1)?.action).toBe('pr-update')
    expect(outcome.pullRequest?.number).toBe(7)
    expect(argvs().some(argv => argv[0] === 'gh' && argv[2] === 'create')).toBe(false)
  })
})

describe('what a failed delivery still reports', () => {
  it('refuses before staging when the request names another branch', async () => {
    writeFileSync(join(work, 'a.txt'), 'a\n')

    const outcome = await delivery().deliver({
      branch: 'main',
      files: ['a.txt'],
      message: 'feat: deliver a',
      pullRequest: { title: 't', body: 'b', base: 'main' },
    })

    expect(outcome.delivered).toBe(false)
    expect(outcome.failure?.code).toBe('foreign-branch')
    expect(outcome.records).toEqual([])
    expect(argvs().some(argv => argv[1] === 'commit' || argv[1] === 'push')).toBe(false)
  })

  it('keeps the commit it made when the pull request step fails', async () => {
    ghScripts = [{ match: argv => argv[2] === 'view', respond: () => ({ exitCode: 1, stdout: '' }) }]
    writeFileSync(join(work, 'a.txt'), 'a\n')

    const outcome = await delivery().deliver({
      branch: 'feat/delivery',
      files: ['a.txt'],
      message: 'feat: deliver a',
      pullRequest: { title: 't', body: 'b', base: 'main' },
    })

    expect(outcome.delivered).toBe(false)
    expect(outcome.records.map(record => record.action)).toEqual(['commit', 'push'])
    expect(outcome.commitSha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('names no command output in the failure it reports', async () => {
    ghScripts = [{
      match: argv => argv[2] === 'view',
      respond: () => ({ exitCode: 1, stdout: 'gh: token ghp_SECRETVALUE rejected' }),
    }]
    writeFileSync(join(work, 'a.txt'), 'a\n')

    const outcome = await delivery().deliver({
      branch: 'feat/delivery',
      files: ['a.txt'],
      message: 'feat: deliver a',
      pullRequest: { title: 't', body: 'b', base: 'main' },
    })

    expect(outcome.summary).not.toContain('ghp_')
    expect(JSON.stringify(outcome)).not.toContain('SECRETVALUE')
  })
})

describe('the environment the commands are given', () => {
  it('injects nothing, so no ambient credential reaches a child by this package', async () => {
    scriptNewPullRequest()
    writeFileSync(join(work, 'a.txt'), 'a\n')
    await delivery().deliver({
      branch: 'feat/delivery',
      files: ['a.txt'],
      message: 'feat: deliver a',
      pullRequest: { title: 't', body: 'b', base: 'main' },
    })

    expect(issued.length).toBeGreaterThan(0)
    // No spec carries an environment this package built: `gh` authenticates
    // from its own stored configuration, and the seam scrubs the parent.
    for (const spec of issued) expect(spec.env).toBeUndefined()
    // And every command is an argv array, so no constructed value is syntax.
    for (const spec of issued) expect(Array.isArray(spec.argv)).toBe(true)
  })
})

describe('what settling a command means', () => {
  /**
   * A handle whose direct child has settled while its tree has not.
   * @param quiescence - resolves/rejects when the owned tree is accounted for.
   * @returns the handle.
   */
  function lingering(quiescence: Promise<boolean>): SubprocessHandle {
    const reader = { readFrom: () => ({ text: 'feat/delivery', nextOffset: 13, lossy: false }) }
    return {
      pid: -1,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: { stdout: reader, stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } },
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate: () => {},
      waitForExit: () => quiescence,
    }
  }

  it('does not return while a helper the command started is still running', async () => {
    let release: (quiet: boolean) => void = () => undefined
    const quiescence = new Promise<boolean>((resolve) => { release = resolve })
    const capability = new GitHubDelivery({ cwd: work, spawn: () => lingering(quiescence) })
    let settledYet = false

    const reading = capability.inspect().then((value) => {
      settledYet = true
      return value
    })
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve()

    // The direct child is gone and its output is readable, which is exactly the
    // state in which a delivery would happily start the next command — while a
    // git helper still holds the index lock.
    expect(settledYet).toBe(false)
    release(true)
    await expect(reading).resolves.toMatchObject({ branch: 'feat/delivery' })
  })

  it('reports a tree that would not come down instead of a clean command', async () => {
    const capability = new GitHubDelivery({
      cwd: work,
      spawn: () => lingering(Promise.reject(new Error('the process tree could not be reaped'))),
    })

    await expect(capability.inspect()).rejects.toMatchObject({ code: 'teardown-failed' })
  })

  it('treats a wait cut short by cancellation as a tree still standing', async () => {
    const capability = new GitHubDelivery({ cwd: work, spawn: () => lingering(Promise.resolve(false)) })

    // `false` is not an error and not a success: it is the seam saying it stopped
    // waiting, which is the one answer that must not be read as quiescence.
    await expect(capability.inspect()).rejects.toMatchObject({ code: 'teardown-failed' })
  })

  it('names no command output in the failure it reports', async () => {
    const leak = new Error('gh: token ghp_secretsecretsecret rejected')
    const capability = new GitHubDelivery({ cwd: work, spawn: () => lingering(Promise.reject(leak)) })

    let message = ''
    try {
      await capability.inspect()
    }
    catch (caught) {
      message = (caught as Error).message
    }

    // The cause is dropped rather than wrapped: this message reaches a durable
    // event, and a rejection out of `gh` can carry an authentication hint.
    expect(message).not.toContain('ghp_')
    expect(message).toContain('could not be reaped')
  })
})

describe('checkpointing a mutation before making the next one', () => {
  /**
   * A delivery whose verified mutations are handed to an observer.
   * @param onRecord - what the observer does with each record.
   * @returns the capability under test.
   */
  function observed(onRecord: (record: DeliveryRecord) => Promise<void>): GitHubDelivery {
    return new GitHubDelivery({ cwd: work, spawn: seam, onRecord })
  }

  /** The request every test here delivers. */
  const request = {
    branch: 'feat/delivery',
    files: ['a.txt'],
    message: 'feat: deliver a',
    pullRequest: { title: 't', body: 'b', base: 'main' },
  } as const

  it('hands over each mutation only once the world has confirmed it', async () => {
    scriptNewPullRequest()
    writeFileSync(join(work, 'a.txt'), 'a\n')
    const seen: { action: string; commandsBefore: number }[] = []

    const outcome = await observed(async (record) => {
      seen.push({ action: record.action, commandsBefore: issued.length })
    }).deliver(request)

    expect(seen.map(entry => entry.action)).toEqual(['commit', 'push', 'pr-open'])
    // Each one arrives after the re-read that confirmed it, not after the
    // command that was supposed to cause it.
    const revParse = argvs().findIndex(argv => argv[1] === 'rev-parse' && argv[2] === 'HEAD')
    expect(seen[0]?.commandsBefore).toBeGreaterThan(revParse)
    // And what was handed over is exactly what was returned, in order.
    expect(seen.map(entry => entry.action)).toEqual(outcome.records.map(record => record.action))
  })

  it('does not push a commit whose record could not be made durable', async () => {
    scriptNewPullRequest()
    writeFileSync(join(work, 'a.txt'), 'a\n')

    const outcome = await observed(async (record) => {
      if (record.action === 'commit') throw new Error('the journal could not reach a durable checkpoint')
    }).deliver(request)

    // The commit happened and is reported. The push did not start: a mutation
    // nobody can prove was made is the one a restart repeats.
    expect(outcome.delivered).toBe(false)
    expect(outcome.failure?.code).toBe('uncheckpointed-mutation')
    expect(outcome.records.map(record => record.action)).toEqual(['commit'])
    expect(argvs().some(argv => argv[1] === 'push')).toBe(false)
  })

  it('never offers a mutation it could not confirm', async () => {
    // The push exits zero but the remote does not hold the commit, which is the
    // case the re-read exists for. No push record may be checkpointed.
    scriptNewPullRequest()
    writeFileSync(join(work, 'a.txt'), 'a\n')
    const seen: string[] = []
    const capability = new GitHubDelivery({
      cwd: work,
      spawn: (spec) => {
        if (spec.argv[1] === 'push') {
          issued.push(spec)
          return settled(0, '')
        }
        return seam(spec)
      },
      onRecord: async (record) => { seen.push(record.action) },
    })

    const outcome = await capability.deliver(request)

    expect(outcome.failure?.code).toBe('unverified-push')
    expect(seen).toEqual(['commit'])
  })

  it('delivers exactly as before when nobody is observing', async () => {
    scriptNewPullRequest()
    writeFileSync(join(work, 'a.txt'), 'a\n')

    const outcome = await delivery().deliver(request)

    expect(outcome.delivered).toBe(true)
    expect(outcome.records.map(record => record.action)).toEqual(['commit', 'push', 'pr-open'])
  })
})
