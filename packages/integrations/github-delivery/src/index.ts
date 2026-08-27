/**
 * Scoped GitHub delivery: the narrow set of git and `gh` operations an
 * automated run may perform on its own feature branch, and nothing wider.
 *
 * A run that finished its work still has to land it somewhere a person can
 * look at. That is the whole of this package: stage an approved write set,
 * commit it, push the branch it is already on, and open or update the pull
 * request for it. Merging, releasing, deploying, rewriting history and
 * touching a protected branch are not slow paths here — they are absent.
 *
 * Nothing is reported from intent. Every fact this package emits is re-read
 * from git or from GitHub after the operation that was supposed to produce it,
 * because the only question a restart needs answered is what the world holds,
 * and a command's exit code does not answer it.
 *
 * GitHub authentication stays native to `gh`: this package never reads a
 * token, never places one in an environment it constructs, and never writes
 * command output that could carry one into a durable event.
 * @module @trick-harness/github-delivery
 */

import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { DeliveryRecord } from '@trick-harness/journal'
import {
  DeliveryError,
  PROTECTED_BRANCHES,
  addArgv,
  assertDeliverableBranch,
  approvedWriteSet,
  checksArgv,
  commitArgv,
  currentBranchArgv,
  prCreateArgv,
  prUpdateArgv,
  prViewArgv,
  pushArgv,
  revParseArgv,
  stagedPathsArgv,
  statusArgv,
} from './commands.ts'
import type { PullRequestSpec } from './commands.ts'

export * from './commands.ts'
export type * from './types.ts'

import type {
  CommandResult,
  DeliveryOutcome,
  DeliveryRequest,
  GitHubDeliveryOptions,
  PullRequestIdentity,
} from './types.ts'

/** Bytes of a command's output this package will hold in memory. */
const MAX_OUTPUT_BYTES = 64 * 1024

/** Default grace for the terminate escalation on a delivery command. */
const DEFAULT_GRACE_MS = 5_000

/**
 * Read one settled stream, or the empty string when it was not collected.
 * @param handle - Settled subprocess handle.
 * @param stream - Which collected stream to read.
 * @returns The stream text, trimmed of trailing newlines.
 */
function readStream(handle: SubprocessHandle, stream: 'stdout' | 'stderr'): string {
  return (handle.collected[stream]?.readFrom(0).text ?? '').replace(/\s+$/, '')
}

/**
 * Parse the pull request identity out of `gh pr view --json`.
 *
 * Anything unparseable is treated as "there is no pull request" rather than as
 * an error, because `gh` also exits non-zero and prints prose when a branch
 * simply has none, and inventing a PR number from a parse guess is worse than
 * opening a second one a person can close.
 * @param json - Raw stdout of the view command.
 * @returns The identity, or undefined when none could be read.
 */
function parsePullRequest(json: string): PullRequestIdentity | undefined {
  if (json.trim() === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  }
  catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  const number = record['number']
  const url = record['url']
  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) return undefined
  return { number, url: typeof url === 'string' ? url : undefined, created: false }
}

/**
 * The scoped delivery capability, bound to one workspace.
 *
 * One instance owns one working directory. The branch it may write is not a
 * constructor option because it is not the caller's to assert: it is read from
 * the workspace at the start of every delivery and compared with what the
 * caller asked for.
 */
export class GitHubDelivery {
  readonly #cwd: string
  readonly #spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  readonly #protectedBranches: readonly string[]
  readonly #graceMs: number
  readonly #env: NodeJS.ProcessEnv | undefined

  /**
   * @param options - The workspace, the subprocess seam, and the protected set.
   */
  constructor(options: GitHubDeliveryOptions) {
    this.#cwd = options.cwd
    this.#spawn = options.spawn
    this.#protectedBranches = options.protectedBranches ?? PROTECTED_BRANCHES
    this.#graceMs = options.graceMs ?? DEFAULT_GRACE_MS
    this.#env = options.env
  }

  /**
   * Run one already-constructed command and collect its bounded output.
   *
   * `argv` is handed to the subprocess seam as an array, which is never shell
   * interpreted, so a branch name or a commit message written by a model is a
   * value here and cannot become syntax.
   * @param argv - Fully constructed command.
   * @param signal - Cancellation for the run.
   * @returns Exit code and collected streams.
   */
  async #run(argv: readonly string[], signal?: AbortSignal): Promise<CommandResult> {
    const collect = { maxBytes: MAX_OUTPUT_BYTES } as const
    const handle = this.#spawn({
      argv,
      cwd: this.#cwd,
      stdio: { stdin: 'ignore', stdout: collect, stderr: collect },
      graceMs: this.#graceMs,
      ...signal === undefined ? {} : { signal },
      // Deliberately absent unless the caller supplied one: the subprocess
      // seam scrubs credential-shaped entries from the parent environment, and
      // `gh` reads its own stored authentication rather than an injected token.
      ...this.#env === undefined ? {} : { env: this.#env },
    })
    const outcome = await handle.done
    // `done` says the direct child closed. It does not say the tree it started
    // is gone, and git is a program that starts helpers: a delivery that read
    // `done` and moved on would run its next command against an index another
    // process still holds. Quiescence is what settlement means here.
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
   * A wait that ends any other way — a rejection, or the seam saying it stopped
   * waiting — is a tree still standing. Neither is converted into a successful
   * command: whatever the child's exit code said, the world is not in a state
   * this capability may keep acting on.
   *
   * The run's cancellation signal is deliberately not passed along. A cancelled
   * delivery still owns whatever it started, and releasing the operation while
   * that tree is still up would hand the workspace back to a caller who has no
   * way of knowing something is still writing to it.
   * @param handle - The settled subprocess handle.
   * @throws DeliveryError when the tree cannot be observed to have exited.
   */
  async #quiescent(handle: SubprocessHandle): Promise<void> {
    let exited: boolean
    try {
      exited = await handle.waitForExit()
    }
    catch {
      // The cause is deliberately not carried into the message: it comes from a
      // command whose stderr may hold an authentication URL, and this string
      // reaches a durable event.
      throw new DeliveryError('teardown-failed', 'the process tree of a delivery command could not be reaped')
    }
    if (!exited) {
      throw new DeliveryError('teardown-failed', 'the wait for a delivery command`s process tree ended before it exited')
    }
  }

  /**
   * Run a command that must succeed, or fail the delivery.
   * @param argv - Fully constructed command.
   * @param what - What the command was for, for the failure message.
   * @param signal - Cancellation for the run.
   * @returns The command's stdout.
   * @throws DeliveryError when the command exits non-zero.
   */
  async #must(argv: readonly string[], what: string, signal?: AbortSignal): Promise<string> {
    const result = await this.#run(argv, signal)
    if (result.exitCode !== 0) {
      // The message names the operation and the exit code, never the output:
      // stderr from `gh` can carry an authentication URL or a token hint, and
      // this string reaches a durable event.
      throw new DeliveryError('command-failed', `${what} failed with exit code ${String(result.exitCode)}`)
    }
    return result.stdout
  }

  /**
   * Read the branch the workspace has checked out, and check it is one this
   * delivery may write.
   * @param requested - Branch the caller asked to deliver.
   * @param signal - Cancellation for the run.
   * @returns The validated branch name.
   * @throws DeliveryError when the branch is detached, foreign or protected.
   */
  async validateBranch(requested: string, signal?: AbortSignal): Promise<string> {
    const checkedOut = (await this.#must(currentBranchArgv(), 'reading the current branch', signal)).trim()
    assertDeliverableBranch(requested, checkedOut, this.#protectedBranches)
    return checkedOut
  }

  /**
   * Stage exactly the approved write set, then read back what is staged.
   *
   * The read-back is the point. `git add` succeeds whether or not it staged
   * what the caller meant, and a delivery that committed a wider set than it
   * was scoped to would have carried unrelated work into a reviewed PR.
   * @param files - Repository-relative paths the run is scoped to write.
   * @param signal - Cancellation for the run.
   * @returns The staged paths, as git reports them.
   * @throws DeliveryError when the staged set is not the approved set.
   */
  async stage(files: readonly string[], signal?: AbortSignal): Promise<readonly string[]> {
    const approved = approvedWriteSet(files)
    await this.#must(addArgv(approved), 'staging the approved write set', signal)
    const staged = (await this.#must(stagedPathsArgv(), 'reading the staged set', signal))
      .split('\n')
      .map(line => line.trim())
      .filter(line => line !== '')
      .sort()
    const same = staged.length === approved.length && staged.every((path, index) => path === approved[index])
    if (!same) {
      throw new DeliveryError(
        'unexpected-stage',
        `the index holds ${String(staged.length)} paths after staging ${String(approved.length)} approved ones`,
      )
    }
    return staged
  }

  /**
   * Deliver one run's work: stage, commit, push, and open or update its PR.
   *
   * The steps are ordered so that nothing irreversible happens before the
   * branch has been validated, and every step's outcome is re-read from the
   * world rather than inferred from the command that caused it. A failure
   * after the commit still reports the commit: the records are what happened,
   * not what was intended to happen.
   * @param request - The branch, the write set, the message and the PR to open.
   * @returns What was delivered, what failed, and what only failed to be described.
   */
  async deliver(request: DeliveryRequest): Promise<DeliveryOutcome> {
    const records: DeliveryRecord[] = []
    const metadataFailures: string[] = []
    const { signal } = request
    let commitSha: string | undefined
    let pullRequest: PullRequestIdentity | undefined

    try {
      const branch = await this.validateBranch(request.branch, signal)
      await this.stage(request.files, signal)
      await this.#must(commitArgv(request.message), 'recording the commit', signal)

      // Re-read: the commit is what HEAD now resolves to, not what commit said.
      commitSha = (await this.#must(revParseArgv('HEAD'), 'reading the new commit', signal)).trim()
      records.push({ action: 'commit', branch, commitSha })

      await this.#must(pushArgv(branch, this.#protectedBranches), 'pushing the branch', signal)
      const remoteSha = (await this.#run(revParseArgv(`refs/remotes/origin/${branch}`), signal)).stdout.trim()
      if (remoteSha !== commitSha) {
        throw new DeliveryError(
          'unverified-push',
          'the remote branch does not hold the commit that was just pushed, so the push is not confirmed',
        )
      }
      records.push({ action: 'push', branch, commitSha })

      pullRequest = await this.#pullRequest(branch, request.pullRequest, signal)
      records.push({
        action: pullRequest.created ? 'pr-open' : 'pr-update',
        branch,
        commitSha,
        prNumber: pullRequest.number,
        ...pullRequest.url === undefined ? {} : { prUrl: pullRequest.url },
      })

      // Everything past this point is description, not delivery. Reading CI
      // state is useful and can fail on its own — a checks API that is slow or
      // a run that has not been scheduled yet — and none of that unmakes the
      // commit, the push or the pull request that already exist. Reporting it
      // as a delivery failure would send a run to repair work that landed.
      try {
        const checks = await this.#run(checksArgv(branch), signal)
        if (checks.exitCode === null) {
          metadataFailures.push('the CI state for this branch could not be read; delivery itself is unaffected')
        }
      }
      catch {
        metadataFailures.push('the CI state for this branch could not be read; delivery itself is unaffected')
      }
    }
    catch (error) {
      if (!(error instanceof DeliveryError)) throw error
      return {
        delivered: false,
        records,
        commitSha,
        pullRequest,
        summary: error.message,
        failure: { code: error.code, message: error.message },
        metadataFailures,
      }
    }

    return {
      delivered: true,
      records,
      commitSha,
      pullRequest,
      summary: `delivered ${String(records.length)} operations on ${request.branch}`,
      failure: undefined,
      metadataFailures,
    }
  }

  /**
   * Open the branch's pull request, or update the one it already has.
   *
   * A branch with an existing PR gets that PR updated rather than a second one
   * opened, because a delivery runs again after every repair cycle and a run
   * that opened a PR per cycle would bury the review it was asking for.
   * @param branch - Validated head branch.
   * @param spec - Title, body and base branch.
   * @param signal - Cancellation for the run.
   * @returns The pull request identity, re-read from GitHub.
   * @throws DeliveryError when the pull request could not be opened or read back.
   */
  async #pullRequest(
    branch: string,
    spec: PullRequestSpec,
    signal?: AbortSignal,
  ): Promise<PullRequestIdentity> {
    const existing = parsePullRequest((await this.#run(prViewArgv(branch), signal)).stdout)
    if (existing !== undefined) {
      await this.#must(prUpdateArgv(existing.number, spec), 'updating the pull request', signal)
      return { ...existing, created: false }
    }
    await this.#must(prCreateArgv(branch, spec), 'opening the pull request', signal)

    // Re-read: the PR number and URL are GitHub's to state, and `gh pr create`
    // prints a URL that is convenient rather than authoritative.
    const opened = parsePullRequest((await this.#run(prViewArgv(branch), signal)).stdout)
    if (opened === undefined) {
      throw new DeliveryError('command-failed', 'the pull request could not be read back after being opened')
    }
    return { ...opened, created: true }
  }

  /**
   * Describe the workspace without changing it.
   *
   * Separated from {@link deliver} because a caller that only wants to know
   * whether there is anything to deliver should not be running a code path
   * that can commit.
   * @param signal - Cancellation for the run.
   * @returns The checked-out branch and the porcelain status lines.
   */
  async inspect(signal?: AbortSignal): Promise<{ branch: string; dirty: readonly string[] }> {
    const branch = (await this.#must(currentBranchArgv(), 'reading the current branch', signal)).trim()
    const status = await this.#run(statusArgv(), signal)
    return { branch, dirty: status.stdout.split('\n').filter(line => line.trim() !== '') }
  }
}
