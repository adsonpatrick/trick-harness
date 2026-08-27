import { describe, expect, it } from 'vitest'
import {
  DENIED_PUSH_ARGS,
  DeliveryError,
  PROTECTED_BRANCHES,
  addArgv,
  approvedWriteSet,
  assertAllowed,
  assertDeliverableBranch,
  assertWritablePath,
  commitArgv,
  isProtectedBranch,
  prCreateArgv,
  prUpdateArgv,
  prViewArgv,
  pushArgv,
  stagedPathsArgv,
} from '../src/commands.ts'

/**
 * Pull the code off a thrown DeliveryError, failing loudly on anything else.
 * @param run - the call under test.
 * @returns the error code.
 */
function codeOf(run: () => unknown): string {
  try {
    run()
  }
  catch (error) {
    if (error instanceof DeliveryError) return error.code
    throw error
  }
  throw new Error('expected a DeliveryError')
}

describe('the branch a delivery may write', () => {
  it('refuses every protected branch, whatever case it is written in', () => {
    for (const branch of PROTECTED_BRANCHES) {
      expect(isProtectedBranch(branch)).toBe(true)
      expect(isProtectedBranch(branch.toUpperCase())).toBe(true)
    }
  })

  it('refuses to push main even when the workspace really is on main', () => {
    expect(codeOf(() =>{  assertDeliverableBranch('main', 'main') })).toBe('protected-branch')
    expect(codeOf(() => pushArgv('master'))).toBe('protected-branch')
  })

  it('refuses a branch the workspace does not have checked out', () => {
    expect(codeOf(() =>{  assertDeliverableBranch('feat/a', 'feat/b') })).toBe('foreign-branch')
  })

  it('refuses a detached head, which belongs to no branch at all', () => {
    expect(codeOf(() =>{  assertDeliverableBranch('feat/a', 'HEAD') })).toBe('detached-head')
  })

  it('accepts an ordinary feature branch the workspace is on', () => {
    expect(() => { assertDeliverableBranch('feat/harness', 'feat/harness') }).not.toThrow()
  })
})

describe('the exact set a delivery stages', () => {
  it('refuses an empty write set rather than staging everything', () => {
    expect(codeOf(() => approvedWriteSet([]))).toBe('empty-write-set')
  })

  it('refuses a path that leaves the repository', () => {
    expect(codeOf(() =>{  assertWritablePath('../../etc/passwd') })).toBe('invalid-path')
    expect(codeOf(() =>{  assertWritablePath('src/../../out.ts') })).toBe('invalid-path')
  })

  it('refuses an absolute path on either platform', () => {
    expect(codeOf(() =>{  assertWritablePath('/etc/passwd') })).toBe('invalid-path')
    expect(codeOf(() =>{  assertWritablePath('C:\\Windows\\system.ini') })).toBe('invalid-path')
  })

  it('refuses a path that would be read as an option', () => {
    expect(codeOf(() =>{  assertWritablePath('--all') })).toBe('invalid-path')
  })

  it('de-duplicates and sorts so the staged set can be compared with the index', () => {
    expect(approvedWriteSet(['b.ts', 'a.ts', 'b.ts'])).toEqual(['a.ts', 'b.ts'])
  })

  it('separates the write set from options with a bare double dash', () => {
    expect(addArgv(['src/a.ts'])).toEqual(['git', 'add', '--', 'src/a.ts'])
  })
})

describe('commands as argv, never as a shell string', () => {
  it('passes a commit message with shell syntax in it as one element', () => {
    const message = 'fix: $(rm -rf /) `whoami` && echo "owned"'
    const argv = commitArgv(message)

    expect(argv).toEqual(['git', 'commit', '-m', message])
    expect(argv.filter(part => part === message)).toHaveLength(1)
  })

  it('passes a PR body with backticks and newlines as one element', () => {
    const body = 'line one\n`code`\n$(id)'
    const argv = prCreateArgv('feat/a', { title: 'title', body, base: 'main' })

    expect(argv[argv.indexOf('--body') + 1]).toBe(body)
  })
})

describe('the operations that are absent rather than guarded', () => {
  it('constructs a push that names its own branch and carries no force flag', () => {
    const argv = pushArgv('feat/harness')

    expect(argv).toEqual(['git', 'push', '-u', 'origin', 'refs/heads/feat/harness:refs/heads/feat/harness'])
    for (const denied of DENIED_PUSH_ARGS) expect(argv).not.toContain(denied)
  })

  it('refuses a push that anyone widened with a force flag', () => {
    for (const denied of ['--force', '-f', '--force-with-lease']) {
      expect(codeOf(() => { assertAllowed(['git', 'push', 'origin', 'HEAD', denied]) })).toBe('denied-operation')
    }
  })

  it('refuses the value forms of the force flags, which are the ones anyone would actually write', () => {
    // `--force-with-lease` is nearly always written with the ref it leases
    // against. A guard that only knew the bare spelling would stop the form
    // nobody uses and allow the form everybody does.
    for (const denied of [
      '--force-with-lease=refs/heads/master',
      '--force-if-includes=refs/heads/master',
      '--force=anything',
    ]) {
      expect(codeOf(() => { assertAllowed(['git', 'push', 'origin', 'HEAD', denied]) })).toBe('denied-operation')
    }
  })

  it('refuses a refspec that deletes the remote branch without saying delete', () => {
    expect(codeOf(() => { assertAllowed(['git', 'push', 'origin', ':refs/heads/master']) })).toBe('denied-operation')
  })

  it('still allows the push this capability actually constructs', () => {
    expect(() => {
      assertAllowed(['git', 'push', '-u', 'origin', 'refs/heads/feature:refs/heads/feature'])
    }).not.toThrow()
  })

  it('refuses merge, rebase and reset outright', () => {
    for (const subcommand of ['merge', 'rebase', 'reset']) {
      expect(codeOf(() => { assertAllowed(['git', subcommand, 'origin/main']) })).toBe('denied-operation')
    }
  })

  it('sees the subcommand behind leading configuration flags', () => {
    expect(codeOf(() => { assertAllowed(['git', '-c', 'core.hooksPath=/dev/null', 'merge', 'main']) }))
      .toBe('denied-operation')
    expect(codeOf(() => { assertAllowed(['git', '-c', 'a=1', '-c', 'b=2', 'push', 'origin', '--force']) }))
      .toBe('denied-operation')
  })

  it('refuses merging, releasing and deploying through gh', () => {
    expect(codeOf(() => { assertAllowed(['gh', 'pr', 'merge', '1']) })).toBe('denied-operation')
    expect(codeOf(() => { assertAllowed(['gh', 'release', 'create', 'v1']) })).toBe('denied-operation')
    expect(codeOf(() => { assertAllowed(['gh', 'workflow', 'run', 'deploy']) })).toBe('denied-operation')
  })
})

describe('the pull request commands', () => {
  it('reads a branch pull request in JSON so its identity is not scraped from prose', () => {
    const argv = prViewArgv('feat/a')

    expect(argv.slice(0, 4)).toEqual(['gh', 'pr', 'view', 'feat/a'])
    expect(argv).toContain('--json')
  })

  it('updates by number rather than opening a second pull request', () => {
    const argv = prUpdateArgv(7, { title: 't', body: 'b', base: 'main' })

    expect(argv.slice(0, 4)).toEqual(['gh', 'pr', 'edit', '7'])
    expect(argv).not.toContain('create')
  })
})

describe('reading the staged set back', () => {
  it('turns off path quoting, so a non-ASCII path reads back as itself', () => {
    const argv = stagedPathsArgv()

    expect(argv).toEqual(['git', '-c', 'core.quotePath=false', 'diff', '--cached', '--name-only'])
    expect(() => { assertAllowed(argv) }).not.toThrow()
  })
})
