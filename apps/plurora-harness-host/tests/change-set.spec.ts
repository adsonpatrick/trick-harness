/**
 * What the published branch actually changed, read from Git by this host.
 *
 * The planned set comes from a document a person approved; this is the other
 * half, and it exists because the two disagree more often than anyone expects.
 * Nothing here asks a model what it changed, and nothing here writes: the
 * reader runs two read-only Git commands and parses their bytes.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { ChangeSetError, createGitChangeSetReader, parseNameStatus } from '../src/change-set.ts'

const PROJECT_ROOT = '/srv/plurora/checkout'
const BRANCH = 'main'
const MERGE_BASE = 'a'.repeat(40)

/** One `--name-status -z` record: the status token, then its paths. */
function record(...fields: readonly string[]): string {
  return `${fields.join('\0')}\0`
}

interface FakeGit {
  readonly specs: SubprocessSpawnSpec[]
  readonly terminate: ReturnType<typeof vi.fn>
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
}

/**
 * A Git that answers each invocation from `outputs`, in order.
 *
 * Two calls are expected — the merge base, then the diff — so the double is
 * keyed by call index rather than by inspecting the argv, which would let a
 * reader that ran the wrong command still look correct here.
 */
function fakeGit(options: {
  outputs?: readonly string[]
  exitCodes?: readonly (number | null)[]
  lossy?: boolean
  spawnError?: Error
  quiescent?: boolean
} = {}): FakeGit {
  const specs: SubprocessSpawnSpec[] = []
  const terminate = vi.fn()
  const spawn = (spec: SubprocessSpawnSpec): SubprocessHandle => {
    const index = specs.length
    specs.push(spec)
    if (options.spawnError !== undefined) throw options.spawnError
    const outcome: SubprocessOutcome = { exitCode: options.exitCodes?.[index] ?? 0, signal: null }
    return {
      pid: 100 + index,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        stdout: {
          readFrom: () => ({
            text: options.outputs?.[index] ?? '',
            nextOffset: 0,
            lossy: options.lossy ?? false,
          }),
        },
      },
      done: Promise.resolve(outcome),
      terminate,
      waitForExit: vi.fn(async () => options.quiescent !== false),
    }
  }
  return { specs, terminate, spawn }
}

/** Read the change set from a Git that answers with `diff`. */
async function read(git: FakeGit, signal = AbortSignal.timeout(1_000)): Promise<readonly string[]> {
  const reader = createGitChangeSetReader({
    projectRoot: PROJECT_ROOT,
    protectedBranch: BRANCH,
    disposeGraceMs: 5_000,
    spawn: git.spawn,
  })
  return await reader.actualPaths(signal)
}

/** A Git whose merge base resolves and whose diff prints `diff`. */
function gitWith(diff: string, overrides: Parameters<typeof fakeGit>[0] = {}): FakeGit {
  return fakeGit({ outputs: [`${MERGE_BASE}\n`, diff], ...overrides })
}

describe('reading a name-status record stream', () => {
  it('reads the one path an added, modified or typechanged record names', () => {
    const text = record('A', 'src/added.ts') + record('M', 'src/changed.ts') + record('T', 'src/retyped.ts')

    expect(parseNameStatus(text)).toStrictEqual(['src/added.ts', 'src/changed.ts', 'src/retyped.ts'])
  })

  it('reads the path a deletion names', () => {
    // Deleting a file is a change to the surface that file was on. A reader
    // that skipped deletions would score removing an auth guard, an RLS policy
    // or a workflow file as a change touching nothing, and a change touching
    // nothing carries the lowest risk floor and the thinnest evidence bar.
    expect(parseNameStatus(record('D', 'src/lib/auth/session.ts'))).toStrictEqual(['src/lib/auth/session.ts'])
  })

  it('reads both paths a rename or a copy names', () => {
    // A rename touches two paths and Git prints them as one record. Reading
    // only the new one would leave the old path looking untouched, which for a
    // moved auth file means the auth surface disappears from the reading.
    const text = record('R100', 'src/lib/auth/old.ts', 'src/lib/auth/new.ts')
      + record('C075', 'src/a.ts', 'src/b.ts')

    expect(parseNameStatus(text)).toStrictEqual([
      'src/lib/auth/old.ts',
      'src/lib/auth/new.ts',
      'src/a.ts',
      'src/b.ts',
    ])
  })

  it('separates records on NUL rather than on anything a filename may contain', () => {
    // `-z` exists for this: a newline is a legal character in a path, and a
    // line-based reader can be handed a filename that fabricates records.
    const text = record('M', 'src/we ird\nname.ts')

    expect(parseNameStatus(text)).toStrictEqual(['src/we ird\nname.ts'])
  })

  it('says each path once however many records touched it', () => {
    expect(parseNameStatus(record('M', 'src/x.ts') + record('R100', 'src/x.ts', 'src/x.ts'))).toStrictEqual(['src/x.ts'])
  })

  it('normalizes what it read to one repository-relative spelling', () => {
    expect(parseNameStatus(record('M', './src/x.ts'))).toStrictEqual(['src/x.ts'])
  })

  it('reads an empty diff as an empty change set', () => {
    expect(parseNameStatus('')).toStrictEqual([])
    expect(parseNameStatus('\0')).toStrictEqual([])
  })

  it('refuses a record whose status it does not understand', () => {
    for (const text of [record('Z', 'src/x.ts'), record('', 'src/x.ts'), record('MM', 'src/x.ts')]) {
      expect(() => parseNameStatus(text)).toThrow(ChangeSetError)
    }
  })

  it('refuses a record that stops before naming its paths', () => {
    for (const text of ['M\0', 'R100\0src/old.ts\0', 'M\0src/x.ts\0A']) {
      expect(() => parseNameStatus(text)).toThrow(ChangeSetError)
    }
  })

  it('refuses a path Git could not have produced from inside the repository', () => {
    expect(() => parseNameStatus(record('M', '../outside.ts'))).toThrow(ChangeSetError)
    expect(() => parseNameStatus(record('M', '/etc/passwd'))).toThrow(ChangeSetError)
  })

  it('names what it refused without quoting what it read', () => {
    // Git output is repository content, and this refusal is journalled.
    try {
      parseNameStatus(record('M', '../keys/sk-live-000111.ts'))
      expect.unreachable('the traversing path should have been refused')
    }
    catch (error: unknown) {
      expect(error).toBeInstanceOf(ChangeSetError)
      expect((error as Error).message).not.toContain('sk-live')
    }
  })
})

describe('asking Git what the branch changed', () => {
  it('runs the merge base and the diff, in the checkout, with no shell', async () => {
    const git = gitWith(record('M', 'src/x.ts'))
    await read(git)

    expect(git.specs).toHaveLength(2)
    for (const spec of git.specs) {
      expect(spec.cwd).toBe(PROJECT_ROOT)
      expect(Array.isArray(spec.argv)).toBe(true)
      expect(spec.argv[0]).toBe('git')
      expect(spec.argv.join(' ')).not.toMatch(/[|&;><$`]/)
    }
    expect(git.specs[0]?.argv).toStrictEqual(['git', 'merge-base', 'HEAD', `origin/${BRANCH}`])
    expect(git.specs[1]?.argv).toStrictEqual([
      'git', 'diff', '--name-status', '-z', '--diff-filter=ACDMRTUXB', `${MERGE_BASE}..HEAD`,
    ])
  })

  it('asks about the configured branch and about no other ref', async () => {
    const git = gitWith('')
    await read(git)

    for (const spec of git.specs) {
      const argv = spec.argv.join(' ')
      expect(argv.includes('origin/main') || !argv.includes('origin/')).toBe(true)
    }
  })

  it('runs no command that could change a ref, a file or the index', async () => {
    const git = gitWith(record('M', 'src/x.ts'))
    await read(git)

    const forbidden = ['fetch', 'checkout', 'switch', 'reset', 'merge', 'rebase', 'pull', 'push', 'commit', 'clean', 'update-ref']
    for (const spec of git.specs) {
      for (const verb of forbidden) expect(spec.argv, verb).not.toContain(verb)
    }
  })

  it('never reads standard input and bounds what it collects', async () => {
    const git = gitWith('')
    await read(git)

    for (const spec of git.specs) {
      expect(spec.stdio?.stdin).toBe('ignore')
      expect(typeof spec.stdio?.stdout).toBe('object')
    }
  })

  it('carries the caller signal into every command it starts', async () => {
    const signal = AbortSignal.timeout(1_000)
    const git = gitWith('')
    await read(git, signal)

    for (const spec of git.specs) expect(spec.signal).toBe(signal)
  })

  it('waits for the whole process tree before believing the output', async () => {
    const git = gitWith(record('M', 'src/x.ts'), { quiescent: false })

    await expect(read(git)).rejects.toBeInstanceOf(ChangeSetError)
  })

  it('refuses a diff that outgrew the bound it was read under', async () => {
    // A truncated diff is a smaller change set than the one delivered, and a
    // smaller change set is a lower risk. Half a reading is worse than none.
    const git = gitWith(record('M', 'src/x.ts'), { lossy: true })

    await expect(read(git)).rejects.toBeInstanceOf(ChangeSetError)
  })

  it('refuses when Git could not answer', async () => {
    await expect(read(fakeGit({ exitCodes: [1] }))).rejects.toBeInstanceOf(ChangeSetError)
    await expect(read(gitWith('', { exitCodes: [0, 128] }))).rejects.toBeInstanceOf(ChangeSetError)
    await expect(read(fakeGit({ spawnError: new Error('spawn ENOENT') }))).rejects.toBeInstanceOf(ChangeSetError)
  })

  it('refuses a merge base that is not one commit', async () => {
    for (const text of ['', 'not-a-sha\n', `${MERGE_BASE} ${MERGE_BASE}\n`]) {
      await expect(read(fakeGit({ outputs: [text, ''] }))).rejects.toBeInstanceOf(ChangeSetError)
    }
  })

  it('quotes neither Git output nor the checkout path when it refuses', async () => {
    const git = fakeGit({ outputs: ['sk-live-000111222\n', ''] })
    try {
      await read(git)
      expect.unreachable('the malformed merge base should have been refused')
    }
    catch (error: unknown) {
      expect(error).toBeInstanceOf(ChangeSetError)
      expect((error as Error).message).not.toContain('sk-live')
    }
  })

  it('terminates what it started even on the paths that gave up on the answer', async () => {
    const git = gitWith('', { exitCodes: [0, 128] })
    await expect(read(git)).rejects.toBeInstanceOf(ChangeSetError)

    expect(git.terminate).toHaveBeenCalled()
  })

  it('hands back the change set the diff described', async () => {
    const git = gitWith(record('M', 'src/proxy.ts') + record('R100', 'src/a.ts', 'src/b.ts'))

    expect(await read(git)).toStrictEqual(['src/proxy.ts', 'src/a.ts', 'src/b.ts'])
  })
})
