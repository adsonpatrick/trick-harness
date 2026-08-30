/**
 * The exact command vocabulary certification is allowed to speak, as pure argv
 * construction and the validation that guards it.
 *
 * This package publishes one commit status against one revision. That is a
 * small enough act to state entirely as data, and stating it that way is the
 * point: a branch-protection rule can require this context, which means the
 * commands here are the ones standing between an automated run and a merge
 * button. Everything a person is supposed to do — commit, push, edit a pull
 * request, merge, release, deploy — is not a slow path here, it is absent.
 *
 * Every value that reaches a command is validated before it is interpolated,
 * and every field the status carries is chosen from a fixed table rather than
 * derived from a run. A description a model could influence is a description a
 * reviewer could be misled by, and a commit status is read by people deciding
 * whether to merge.
 * @module @trick-harness/github-certification/commands
 */

import { EXTERNAL_CERTIFICATION_STATES } from '@trick-harness/engineering-workflow'
import type { ExternalCertificationState } from '@trick-harness/engineering-workflow'

/**
 * What each state says on GitHub, and the only thing it may say.
 *
 * Fixed strings rather than anything assembled from the run. The summary the
 * harness keeps for its own journal names stages and findings, and is useful
 * exactly because it does; a status description is published to a page anyone
 * with read access can see, so it says which of four things happened and
 * nothing about what the work was.
 */
export const STATUS_DESCRIPTIONS: Readonly<Record<ExternalCertificationState, string>> = Object.freeze({
  pending: 'Harness engineering certification in progress',
  success: 'Harness engineering certification passed',
  failure: 'Harness engineering certification did not pass',
  error: 'Harness engineering certification could not complete',
})

/**
 * The longest context this package will publish.
 *
 * GitHub's own limit is larger; this is narrower because the context is what a
 * branch-protection rule is configured with by hand, and a name too long to
 * read in that dialog is a rule nobody can confirm is the right one.
 */
export const CERTIFICATION_CONTEXT_MAX = 100

/** The longest description GitHub will show, and the bound the plan states. */
export const CERTIFICATION_DESCRIPTION_MAX = 120

/** `owner/repo`, and nothing that a path or a URL could also be read as. */
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/

/** A full, lowercase, unabbreviated commit id. */
const REVISION = /^[0-9a-f]{40}$/

/** A pull-request URL on GitHub itself, over TLS, in one named repository. */
const pullRequestUrlOf = (repository: string, number?: number): string =>
  `https://github.com/${repository}/pull/${number === undefined ? '' : String(number)}`

/** A pull-request number, as the tail of a URL that named one. */
const PULL_REQUEST_NUMBER = /^[1-9][0-9]*$/

/**
 * Check that a URL is the pull request it is supposed to be pointing at.
 *
 * Shape alone is not enough. The URL is read from `gh pr view`, which resolves
 * whichever pull request the current branch belongs to — and in a fork that is
 * one in the parent repository. A status carrying that URL sends a reviewer to
 * somebody else's pull request under this deployment's own context, so the
 * repository and the number are both compared rather than merely parsed.
 * @param repository - Validated `owner/repo` this certification is bound to.
 * @param number - The pull-request number that was read alongside the URL.
 * @param url - The URL as `gh` reported it.
 * @returns The same URL, once it is known to name that pull request.
 * @throws CertificationError when it names anything else.
 */
export function assertPullRequestUrl(repository: string, number: number, url: string): string {
  if (url !== pullRequestUrlOf(assertRepository(repository), assertPullRequestNumber(number))) {
    throw new CertificationError(
      'invalid-identity',
      'the pull-request URL that was read names a different pull request than the one this capability certifies',
    )
  }
  return url
}

/** A certification that cannot be published as asked, or cannot be trusted. */
export class CertificationError extends Error {
  /** Machine-readable cause, so a caller can branch without parsing prose. */
  readonly code:
    | 'invalid-identity'
    | 'foreign-repository'
    | 'detached-head'
    | 'no-pull-request'
    | 'pull-request-closed'
    | 'foreign-base'
    | 'branch-mismatch'
    | 'revision-mismatch'
    | 'unverified-status'
    | 'command-failed'
    | 'teardown-failed'

  /**
   * @param code - Machine-readable cause.
   * @param message - Human-readable detail, naming no credential or command output.
   */
  constructor(code: CertificationError['code'], message: string) {
    super(message)
    this.name = 'CertificationError'
    this.code = code
  }
}

/**
 * Check that a repository is `owner/repo` before it is put into a path.
 *
 * The value reaches an API path, so the shape is the guard: a string carrying
 * a slash too many, a `..`, a query or a scheme names an endpoint nobody
 * configured. Refused here rather than at the seam, because a path that was
 * never built cannot be requested by mistake later.
 * @param repository - The repository as a caller or a remote reported it.
 * @returns The same string, once it is known to be one.
 * @throws CertificationError when it is not `owner/repo`.
 */
export function assertRepository(repository: string): string {
  if (!REPOSITORY.test(repository)) {
    throw new CertificationError(
      'invalid-identity',
      `${JSON.stringify(repository)} is not an owner/repo pair, so nothing may be published against it`,
    )
  }
  return repository
}

/**
 * Check that a pull-request number is one GitHub could have issued.
 * @param number - The number as `gh` reported it.
 * @returns The same number, once it is known to be a positive integer.
 * @throws CertificationError when it is not.
 */
export function assertPullRequestNumber(number: number): number {
  if (!Number.isInteger(number) || number <= 0) {
    throw new CertificationError('invalid-identity', 'a pull-request number is a positive integer, and this one is not')
  }
  return number
}

/**
 * Check that a revision is a full commit id.
 *
 * Abbreviated ids are refused rather than expanded. A status is published
 * against one revision and read back against the same one, and a prefix is a
 * value that can start out unambiguous and stop being so as the branch grows.
 * @param revision - The revision as git or GitHub reported it.
 * @returns The same string, once it is known to be a full commit id.
 * @throws CertificationError when it is not 40 lowercase hex characters.
 */
export function assertRevision(revision: string): string {
  if (!REVISION.test(revision)) {
    throw new CertificationError(
      'invalid-identity',
      'a certification names a full commit id, and what was read is not one',
    )
  }
  return revision
}

/**
 * Check that a state is one of the four this harness can publish.
 * @param state - The state a caller asked for.
 * @returns The same state, once it is known to be in the vocabulary.
 * @throws CertificationError when it is outside it.
 */
export function assertCertificationState(state: string): ExternalCertificationState {
  const known = EXTERNAL_CERTIFICATION_STATES.find(entry => entry === state)
  if (known === undefined) {
    throw new CertificationError('invalid-identity', 'that is not a state a certification may be published in')
  }
  return known
}

/**
 * Read the branch currently checked out, by name.
 *
 * `--show-current` rather than `rev-parse --abbrev-ref HEAD` because the two
 * disagree in exactly the case that matters: a detached head prints the empty
 * string here and the literal `HEAD` there, and an empty answer is harder to
 * mistake for a branch.
 * @returns The `git branch --show-current` command.
 */
export const currentBranchArgv = (): readonly string[] => ['git', 'branch', '--show-current']

/**
 * Read the commit the workspace is actually on.
 * @returns The `git rev-parse HEAD` command.
 */
export const localHeadArgv = (): readonly string[] => ['git', 'rev-parse', 'HEAD']

/**
 * Ask the remote which repository this checkout is.
 *
 * Asked rather than assumed. The configured repository says which one this
 * deployment may certify; this says which one it is standing in, and a
 * certification published without comparing the two is a status posted to
 * whichever repository the checkout happened to be pointed at.
 * @returns The `gh repo view` command, printing only the name.
 */
export const repositoryIdentityArgv = (): readonly string[] =>
  ['gh', 'repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']

/**
 * Read the pull request of the branch currently checked out.
 * @returns The `gh pr view` command, in JSON mode.
 */
export const currentPrIdentityArgv = (): readonly string[] => ['gh', 'pr', 'view', '--json', 'number,url']

/**
 * Read one pull request in full, by its own number.
 *
 * The `gh pr view` reading above is convenient and branch-relative; this one is
 * the authority, because it names the repository and the number explicitly and
 * answers with the base ref, the head ref and the head SHA the API itself
 * holds.
 * @param repository - Validated `owner/repo`.
 * @param number - Validated pull-request number.
 * @returns The `gh api` command for that pull request.
 * @throws CertificationError when either value is not what it claims to be.
 */
export function pullRequestStateArgv(repository: string, number: number): readonly string[] {
  return ['gh', 'api', `repos/${assertRepository(repository)}/pulls/${String(assertPullRequestNumber(number))}`]
}

/**
 * Read the statuses already published against one revision.
 * @param repository - Validated `owner/repo`.
 * @param revision - Validated full commit id.
 * @returns The `gh api` command for that revision's statuses.
 * @throws CertificationError when either value is not what it claims to be.
 */
export function readStatusesArgv(repository: string, revision: string): readonly string[] {
  return ['gh', 'api', `repos/${assertRepository(repository)}/commits/${assertRevision(revision)}/statuses`]
}

/** Every field one published status carries, and there are no others. */
export interface StatusBody {
  readonly state: ExternalCertificationState
  readonly context: string
  readonly description: string
  readonly targetUrl: string
}

/**
 * Publish one commit status, with every field fixed before it is built.
 *
 * The description is checked against {@link STATUS_DESCRIPTIONS} rather than
 * merely bounded, and the target URL against a GitHub pull-request URL rather
 * than merely parsed. Both are the fields where something a run produced could
 * otherwise end up on a page a reviewer reads as the harness speaking, and a
 * length limit would let a short lie through.
 * @param repository - Validated `owner/repo`.
 * @param revision - Validated full commit id.
 * @param body - The status fields, all of them fixed by the caller.
 * @returns The `gh api --method POST` command.
 * @throws CertificationError when any field is not one this package may publish.
 */
export function createStatusArgv(repository: string, revision: string, body: StatusBody): readonly string[] {
  const owner = assertRepository(repository)
  const sha = assertRevision(revision)
  const state = assertCertificationState(body.state)
  if (body.context.trim() === '' || body.context.length > CERTIFICATION_CONTEXT_MAX) {
    throw new CertificationError(
      'invalid-identity',
      `a certification context is between 1 and ${String(CERTIFICATION_CONTEXT_MAX)} characters`,
    )
  }
  if (body.description !== STATUS_DESCRIPTIONS[state] || body.description.length > CERTIFICATION_DESCRIPTION_MAX) {
    throw new CertificationError(
      'invalid-identity',
      'a status description is one of the fixed strings for its state, and this is not one of them',
    )
  }
  // Bound to `owner`, not merely to GitHub: a well-formed URL for another
  // repository is exactly the value a fork's `gh pr view` hands back, and it
  // would be published as where to go to read this certification.
  const prefix = pullRequestUrlOf(owner)
  if (
    !body.targetUrl.startsWith(prefix)
    || !PULL_REQUEST_NUMBER.test(body.targetUrl.slice(prefix.length))
  ) {
    throw new CertificationError(
      'invalid-identity',
      'a status points at a pull request of the repository it certifies, and that URL does not',
    )
  }
  return [
    'gh', 'api', '--method', 'POST',
    '-H', 'Accept: application/vnd.github+json',
    `repos/${owner}/statuses/${sha}`,
    '-f', `state=${state}`,
    '-f', `context=${body.context}`,
    '-f', `description=${body.description}`,
    '-f', `target_url=${body.targetUrl}`,
  ]
}
