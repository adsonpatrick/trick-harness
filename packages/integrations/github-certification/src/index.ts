/**
 * Scoped GitHub certification: publish one commit status against one verified
 * pull-request head, and nothing wider.
 *
 * This is the package a branch-protection rule points at. That is what decides
 * its shape: it is the only thing standing between an automated run and a
 * merge button, so it may publish a status and it may do nothing else. There
 * is no commit, no push, no pull-request edit, no merge, no release and no
 * deploy here — not disabled, not guarded, absent. Merging stays with a person,
 * and a capability with no way to express a merge cannot be talked into one.
 *
 * Nothing is taken on trust. Before every publication the repository this
 * checkout reports, the branch it has checked out, the commit that branch is
 * on, and the pull request's own state, base, head branch and head SHA are all
 * re-read and compared. A run that certified a revision and then found the
 * branch had moved has not certified the branch, and the readings are what
 * make that a refusal rather than a stale green tick.
 *
 * Nothing is reported from intent either. The status is read back from GitHub
 * after it is posted, because a POST that exited zero is not the same fact as
 * a status a reviewer will see.
 *
 * GitHub authentication stays native to `gh`: this package never reads a token,
 * never constructs an environment to place one in, and never writes command
 * output anywhere it could carry one into a durable event.
 * @module @trick-harness/github-certification
 */

import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { EvidenceRef } from '@trick-harness/contracts'
import type {
  CertificationCapabilityPort,
  WorkflowCertificationInput,
  WorkflowCertificationResult,
} from '@trick-harness/engineering-workflow'
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
} from './commands.ts'

export * from './commands.ts'
export type * from './types.ts'

import type { CommandResult, GitHubCertificationOptions, GitHubCertificationTarget } from './types.ts'

/** Bytes of a command's output this package will hold in memory. */
const MAX_OUTPUT_BYTES = 64 * 1024

/** Default grace for the terminate escalation on a certification command. */
const DEFAULT_GRACE_MS = 5_000

/**
 * Read one settled stream, or the empty string when it was not collected.
 * @param handle - Settled subprocess handle.
 * @param stream - Which collected stream to read.
 * @returns The stream text, trimmed of trailing whitespace.
 */
function readStream(handle: SubprocessHandle, stream: 'stdout' | 'stderr'): string {
  return (handle.collected[stream]?.readFrom(0).text ?? '').replace(/\s+$/, '')
}

/**
 * Parse JSON that came from a command, without letting a parse failure become
 * a fact.
 * @param text - Raw stdout.
 * @returns The parsed value, or undefined when it was not JSON.
 */
function parsed(text: string): unknown {
  if (text.trim() === '') return undefined
  try {
    return JSON.parse(text)
  }
  catch {
    return undefined
  }
}

/**
 * Read one property of a value that may not be an object at all.
 * @param value - The parsed value.
 * @param key - The property to read.
 * @returns The property, or undefined.
 */
function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return (value as Record<string, unknown>)[key]
}

/** One status as GitHub reports it back. */
interface PublishedStatus {
  readonly id: string
  readonly state: string
  readonly context: string
}

/**
 * Read the statuses array GitHub returns, keeping only what is well-formed.
 *
 * GitHub returns them newest first. That ordering is what the read-back relies
 * on, so nothing here re-sorts: a status list that arrived in another order is
 * a different API than the one this was written against, and quietly guessing
 * which entry is newest would turn that into a wrong answer instead of a
 * visible one.
 * @param text - Raw stdout of the statuses read.
 * @returns The statuses, newest first.
 */
function readStatuses(text: string): readonly PublishedStatus[] {
  const value = parsed(text)
  if (!Array.isArray(value)) return []
  const statuses: PublishedStatus[] = []
  for (const entry of value) {
    const id = field(entry, 'id')
    const state = field(entry, 'state')
    const context = field(entry, 'context')
    if (typeof state !== 'string' || typeof context !== 'string') continue
    // The id is read only as the two shapes GitHub actually returns. Coercing
    // anything else would put whatever arrived into the durable record as the
    // identity a later read is supposed to find the status by.
    if (typeof id !== 'number' && typeof id !== 'string') continue
    statuses.push({ id: String(id), state, context })
  }
  return statuses
}

/**
 * The scoped certification capability, bound to one checkout and one context.
 *
 * One instance certifies one repository's pull requests into one base branch,
 * under one status context. None of those four is a per-call argument, because
 * none of them is the run's to choose: they are what the deployment decided
 * this capability is for, and a call able to change them would be a call able
 * to answer a branch-protection rule by certifying something else.
 */
export class GitHubCertification implements CertificationCapabilityPort {
  readonly #cwd: string
  readonly #repository: string
  readonly #baseBranch: string
  readonly #context: string
  readonly #spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  readonly #graceMs: number

  /**
   * @param options - The checkout, the repository, the base branch, the status
   *   context and the subprocess seam.
   * @throws CertificationError when the repository or the context is not one
   *   this capability could ever publish against.
   */
  constructor(options: GitHubCertificationOptions) {
    this.#cwd = options.cwd
    this.#repository = assertRepository(options.repository)
    if (options.baseBranch.trim() === '') {
      throw new CertificationError('invalid-identity', 'a certification is bound to a base branch, and this one names none')
    }
    if (options.context.trim() === '' || options.context.length > CERTIFICATION_CONTEXT_MAX) {
      throw new CertificationError(
        'invalid-identity',
        `a certification context is between 1 and ${String(CERTIFICATION_CONTEXT_MAX)} characters`,
      )
    }
    this.#baseBranch = options.baseBranch
    this.#context = options.context
    this.#spawn = options.spawn
    this.#graceMs = options.graceMs ?? DEFAULT_GRACE_MS
  }

  /**
   * Run one already-constructed command and collect its bounded output.
   *
   * `argv` is handed to the subprocess seam as an array, which is never shell
   * interpreted. No environment is constructed: the seam scrubs
   * credential-shaped entries from the parent, and `gh` reads its own stored
   * authentication, so there is nothing for this package to supply and nothing
   * for it to leak.
   * @param argv - Fully constructed command.
   * @param signal - Cancellation for the run.
   * @returns Exit code and collected streams.
   * @throws CertificationError when the command's process tree cannot be reaped.
   */
  async #run(argv: readonly string[], signal?: AbortSignal): Promise<CommandResult> {
    const collect = { maxBytes: MAX_OUTPUT_BYTES } as const
    const handle = this.#spawn({
      argv,
      cwd: this.#cwd,
      stdio: { stdin: 'ignore', stdout: collect, stderr: collect },
      graceMs: this.#graceMs,
      ...signal === undefined ? {} : { signal },
    })
    const outcome = await handle.done
    // `done` says the direct child closed, not that the tree it started is
    // gone. `gh` and `git` both start helpers, and a reading taken while one is
    // still running is a reading of a workspace something else is still
    // touching.
    await this.#quiescent(handle)
    return {
      argv,
      exitCode: outcome.exitCode,
      stdout: readStream(handle, 'stdout'),
      stderr: readStream(handle, 'stderr'),
    }
  }

  /**
   * Wait for one command's owned process tree to be gone.
   *
   * The run's cancellation signal is deliberately not passed along: a cancelled
   * certification still owns whatever it started, and releasing while that tree
   * is up would hand the checkout back to a caller with no way to know
   * something is still reading it.
   * @param handle - The settled subprocess handle.
   * @throws CertificationError when the tree cannot be observed to have exited.
   */
  async #quiescent(handle: SubprocessHandle): Promise<void> {
    let exited: boolean
    try {
      exited = await handle.waitForExit()
    }
    catch {
      // The cause is deliberately not carried: it comes from a command whose
      // stderr may hold an authentication URL, and this string is journalled.
      throw new CertificationError('teardown-failed', 'the process tree of a certification command could not be reaped')
    }
    if (!exited) {
      throw new CertificationError(
        'teardown-failed',
        'the wait for a certification command process tree ended before it exited',
      )
    }
  }

  /**
   * Run a command that must succeed, or fail the certification.
   * @param argv - Fully constructed command.
   * @param what - What the command was for, for the failure message.
   * @param signal - Cancellation for the run.
   * @returns The command's stdout.
   * @throws CertificationError when the command exits non-zero.
   */
  async #must(argv: readonly string[], what: string, signal?: AbortSignal): Promise<string> {
    const result = await this.#run(argv, signal)
    if (result.exitCode !== 0) {
      // The message names the operation and the exit code, never the output:
      // stderr from `gh` can carry an authentication URL or a token hint, and
      // this string reaches a durable event.
      throw new CertificationError('command-failed', `${what} failed with exit code ${String(result.exitCode)}`)
    }
    return result.stdout
  }

  /**
   * Re-read every identity a status depends on, and refuse unless they agree.
   *
   * Five readings, each of which can independently make the publication wrong:
   * the repository the checkout is actually in, the branch it has checked out,
   * the commit that branch is on, and the pull request's own state, base and
   * head. None of them is cached between calls, because the whole hazard this
   * guards against is the branch having moved since the last time anyone
   * looked.
   * @param expectedRevision - The revision the run believes it is certifying.
   * @param signal - Cancellation for the run.
   * @returns The target, once every reading agreed on it.
   * @throws CertificationError when any reading disagrees with any other.
   */
  async #target(expectedRevision: string | undefined, signal?: AbortSignal): Promise<GitHubCertificationTarget> {
    const repository = (await this.#must(repositoryIdentityArgv(), 'reading the repository identity', signal)).trim()
    if (repository !== this.#repository) {
      throw new CertificationError(
        'foreign-repository',
        `this capability certifies ${JSON.stringify(this.#repository)} and the checkout reports a different repository`,
      )
    }

    const branch = (await this.#must(currentBranchArgv(), 'reading the current branch', signal)).trim()
    if (branch === '') {
      throw new CertificationError('detached-head', 'the checkout has no branch, so there is no pull request to certify')
    }
    if (branch === this.#baseBranch) {
      throw new CertificationError(
        'foreign-base',
        'the checkout is on the base branch, which is merged into rather than certified',
      )
    }

    const head = assertRevision((await this.#must(localHeadArgv(), 'reading the local head', signal)).trim())

    const identity = await this.#run(currentPrIdentityArgv(), signal)
    const view = identity.exitCode === 0 ? parsed(identity.stdout) : undefined
    const number = field(view, 'number')
    const url = field(view, 'url')
    if (typeof number !== 'number' || typeof url !== 'string') {
      throw new CertificationError('no-pull-request', 'the branch has no pull request, so there is nothing to certify')
    }
    const pullRequestNumber = assertPullRequestNumber(number)

    // Read again through the API rather than trusting the branch-relative view:
    // this is the reading that names the repository and the number explicitly,
    // and it is the one that carries the head SHA GitHub itself holds.
    const state = parsed(await this.#must(
      pullRequestStateArgv(this.#repository, pullRequestNumber),
      'reading the pull request',
      signal,
    ))
    if (field(state, 'state') !== 'open') {
      throw new CertificationError('pull-request-closed', 'the pull request is not open, so it is not awaiting certification')
    }
    if (field(field(state, 'base'), 'ref') !== this.#baseBranch) {
      throw new CertificationError(
        'foreign-base',
        `this capability certifies pull requests into ${JSON.stringify(this.#baseBranch)} and this one targets another branch`,
      )
    }
    if (field(field(state, 'head'), 'ref') !== branch) {
      throw new CertificationError(
        'branch-mismatch',
        'the pull request head is a different branch than the one this checkout has out',
      )
    }
    const remoteHead = field(field(state, 'head'), 'sha')
    if (typeof remoteHead !== 'string' || assertRevision(remoteHead) !== head) {
      throw new CertificationError(
        'revision-mismatch',
        'the pull request head is a different commit than the one this checkout is on',
      )
    }
    if (expectedRevision !== undefined && expectedRevision !== head) {
      throw new CertificationError(
        'revision-mismatch',
        'the branch moved after the run established what it was certifying, so that reading no longer describes it',
      )
    }
    // Validated separately from the shape check above: the URL is published as
    // a status field, and `createStatusArgv` refuses anything that is not a
    // GitHub pull-request URL rather than trusting this one to be.
    return Object.freeze({
      repository: this.#repository,
      pullRequestNumber,
      pullRequestUrl: url,
      branch,
      revision: head,
      baseBranch: this.#baseBranch,
    })
  }

  /**
   * Publish one commit status against the verified pull-request head.
   *
   * The order is the contract. Everything that can refuse runs before the one
   * thing that changes the world, and the world is then re-read: a POST that
   * exited zero is not the fact a reviewer will act on, the status GitHub
   * actually holds is.
   * @param input - The objective, the state, and the revision the run expects.
   * @param signal - Cancellation for the run.
   * @returns What was published, as it was read back.
   * @throws CertificationError when any identity disagrees, the command fails,
   *   or the published status does not read back as the state that was asked for.
   */
  async publish(
    input: WorkflowCertificationInput,
    signal?: AbortSignal,
  ): Promise<WorkflowCertificationResult> {
    const state = assertCertificationState(input.state)
    const target = await this.#target(input.expectedRevision, signal)

    await this.#must(
      createStatusArgv(target.repository, target.revision, {
        state,
        context: this.#context,
        description: STATUS_DESCRIPTIONS[state],
        targetUrl: target.pullRequestUrl,
      }),
      'publishing the certification status',
      signal,
    )

    const published = readStatuses(await this.#must(
      readStatusesArgv(target.repository, target.revision),
      'reading the published certification back',
      signal,
    ))
    // The latest entry for this context, and only this context: a repository
    // has other statuses, and a certification that read someone else's would
    // report a state it never published.
    const mine = published.find(entry => entry.context === this.#context)
    if (mine === undefined || mine.state !== state) {
      throw new CertificationError(
        'unverified-status',
        `the certification was posted as ${JSON.stringify(state)} and does not read back that way`,
      )
    }

    return Object.freeze({
      revision: target.revision,
      externalId: mine.id,
      url: target.pullRequestUrl,
      evidence: Object.freeze([
        {
          kind: 'gate',
          locator: `${this.#context}@${target.revision}`,
          summary: `certification published as ${state}`,
        },
        {
          kind: 'pr',
          locator: `${target.repository}#${String(target.pullRequestNumber)}`,
          summary: `pull request into ${target.baseBranch} at the certified head`,
        },
      ] satisfies readonly EvidenceRef[]),
    })
  }
}
