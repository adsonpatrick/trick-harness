import { describe, expect, it } from 'vitest'
import {
  CERTIFICATION_CONTEXT_MAX,
  CertificationError,
  STATUS_DESCRIPTIONS,
  assertCertificationState,
  assertPullRequestNumber,
  assertRepository,
  assertRevision,
  createStatusArgv,
  currentBranchArgv,
  currentPrIdentityArgv,
  localHeadArgv,
  pullRequestStateArgv,
  readStatusesArgv,
  repositoryIdentityArgv,
} from '../src/commands.ts'

const SHA = 'a'.repeat(40)

describe('the command vocabulary certification is allowed to speak', () => {
  it('reads the checked-out branch by name, not by resolving HEAD', () => {
    expect(currentBranchArgv()).toEqual(['git', 'branch', '--show-current'])
  })

  it('reads the local head as a commit', () => {
    expect(localHeadArgv()).toEqual(['git', 'rev-parse', 'HEAD'])
  })

  it('asks the remote which repository this checkout actually is', () => {
    expect(repositoryIdentityArgv()).toEqual(
      ['gh', 'repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
    )
  })

  it('reads the pull request of the current branch', () => {
    expect(currentPrIdentityArgv()).toEqual(['gh', 'pr', 'view', '--json', 'number,url'])
  })

  it('reads one pull request by its own number', () => {
    expect(pullRequestStateArgv('owner/repo', 7)).toEqual(['gh', 'api', 'repos/owner/repo/pulls/7'])
  })

  it('reads the statuses already published against one revision', () => {
    expect(readStatusesArgv('owner/repo', SHA)).toEqual(['gh', 'api', `repos/owner/repo/commits/${SHA}/statuses`])
  })

  it('posts a status whose every field is fixed by the caller, never by output', () => {
    const argv = createStatusArgv('owner/repo', SHA, {
      state: 'success',
      context: 'plurora/harness-certification',
      description: STATUS_DESCRIPTIONS.success,
      targetUrl: 'https://github.com/owner/repo/pull/7',
    })

    expect(argv).toEqual([
      'gh', 'api', '--method', 'POST',
      '-H', 'Accept: application/vnd.github+json',
      `repos/owner/repo/statuses/${SHA}`,
      '-f', 'state=success',
      '-f', 'context=plurora/harness-certification',
      '-f', 'description=Harness engineering certification passed',
      '-f', 'target_url=https://github.com/owner/repo/pull/7',
    ])
  })

  it('has no command for anything a person is supposed to do', () => {
    const every = [
      currentBranchArgv(), localHeadArgv(), repositoryIdentityArgv(), currentPrIdentityArgv(),
      pullRequestStateArgv('owner/repo', 7), readStatusesArgv('owner/repo', SHA),
      createStatusArgv('owner/repo', SHA, {
        state: 'pending',
        context: 'c',
        description: STATUS_DESCRIPTIONS.pending,
        targetUrl: 'https://github.com/owner/repo/pull/7',
      }),
    ].flat()

    for (const forbidden of ['commit', 'push', 'merge', 'release', 'workflow', 'edit', 'deploy', 'tag', 'rebase', 'reset']) {
      expect(every).not.toContain(forbidden)
    }
  })
})

describe('what the descriptions may say', () => {
  it('states one fixed sentence per state and nothing derived from a run', () => {
    expect(STATUS_DESCRIPTIONS).toEqual({
      pending: 'Harness engineering certification in progress',
      success: 'Harness engineering certification passed',
      failure: 'Harness engineering certification did not pass',
      error: 'Harness engineering certification could not complete',
    })
  })

  it('keeps every one of them inside what GitHub will show', () => {
    for (const description of Object.values(STATUS_DESCRIPTIONS)) {
      expect(description.length).toBeLessThanOrEqual(120)
    }
  })

  it('cannot be widened at runtime by whoever holds the module', () => {
    expect(Object.isFrozen(STATUS_DESCRIPTIONS)).toBe(true)
  })
})

describe('validating identity before it is ever interpolated', () => {
  it('accepts an ordinary owner/repo', () => {
    expect(assertRepository('an-owner/a-product')).toBe('an-owner/a-product')
  })

  it.each([
    ['', 'empty'],
    ['owner', 'no slash'],
    ['owner/repo/extra', 'a third segment'],
    ['owner/../repo', 'a traversal'],
    ['owner/re po', 'whitespace'],
    ['-owner/repo', 'a leading dash'],
    ['owner/repo?x=1', 'a query'],
    ['https://github.com/owner/repo', 'a URL'],
  ])('refuses %j because it has %s', (repository) => {
    expect(() => assertRepository(repository)).toThrow(CertificationError)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses %p as a pull-request number', (number) => {
    expect(() => assertPullRequestNumber(number)).toThrow(CertificationError)
  })

  it('accepts a positive integer pull-request number', () => {
    expect(assertPullRequestNumber(7)).toBe(7)
  })

  it.each([
    '',
    'HEAD',
    'a'.repeat(39),
    'a'.repeat(41),
    `${'a'.repeat(39)}Z`,
    'A'.repeat(40),
    `${'a'.repeat(39)}/`,
  ])('refuses %j as a revision', (revision) => {
    expect(() => assertRevision(revision)).toThrow(CertificationError)
  })

  it('accepts a full lowercase hex revision', () => {
    expect(assertRevision(SHA)).toBe(SHA)
  })

  it('refuses a state outside the published vocabulary', () => {
    expect(() => assertCertificationState('merged')).toThrow(CertificationError)
    expect(() => assertCertificationState('SUCCESS')).toThrow(CertificationError)
    for (const state of ['pending', 'success', 'failure', 'error'] as const) {
      expect(assertCertificationState(state)).toBe(state)
    }
  })

  it('refuses to build a status command for an unvalidated repository or revision', () => {
    const body = {
      state: 'pending',
      context: 'c',
      description: STATUS_DESCRIPTIONS.pending,
      targetUrl: 'https://github.com/owner/repo/pull/7',
    } as const
    expect(() => createStatusArgv('not-a-repo', SHA, body)).toThrow(CertificationError)
    expect(() => createStatusArgv('owner/repo', 'HEAD', body)).toThrow(CertificationError)
    expect(() => readStatusesArgv('owner/repo', 'HEAD')).toThrow(CertificationError)
    expect(() => pullRequestStateArgv('owner/repo', 0)).toThrow(CertificationError)
  })

  it('refuses a description that is not one of the fixed strings', () => {
    expect(() => createStatusArgv('owner/repo', SHA, {
      state: 'success',
      context: 'c',
      description: 'looks good to me',
      targetUrl: 'https://github.com/owner/repo/pull/7',
    })).toThrow(CertificationError)
  })

  it('refuses a target URL that is not an https GitHub pull-request URL', () => {
    for (const targetUrl of [
      'http://github.com/owner/repo/pull/7',
      'file:///etc/passwd',
      'https://evil.test/owner/repo/pull/7',
      '/repo/pull/7',
      '',
    ]) {
      expect(() => createStatusArgv('owner/repo', SHA, {
        state: 'pending',
        context: 'c',
        description: STATUS_DESCRIPTIONS.pending,
        targetUrl,
      })).toThrow(CertificationError)
    }
  })

  it('refuses a pull-request URL that belongs to another repository', () => {
    // The URL is read from `gh pr view`, which resolves a branch's pull request
    // and will happily name one in a parent repository when the checkout is a
    // fork. A status carrying that URL points a reviewer at somebody else's
    // pull request while claiming to certify this one's head.
    expect(() => createStatusArgv('owner/repo', SHA, {
      state: 'pending',
      context: 'c',
      description: STATUS_DESCRIPTIONS.pending,
      targetUrl: 'https://github.com/upstream/repo/pull/7',
    })).toThrow(CertificationError)
  })

  it('bounds the context, because it is what a branch-protection rule names', () => {
    expect(CERTIFICATION_CONTEXT_MAX).toBeLessThanOrEqual(255)
    expect(() => createStatusArgv('owner/repo', SHA, {
      state: 'pending',
      context: 'c'.repeat(CERTIFICATION_CONTEXT_MAX + 1),
      description: STATUS_DESCRIPTIONS.pending,
      targetUrl: 'https://github.com/owner/repo/pull/7',
    })).toThrow(CertificationError)
  })
})
