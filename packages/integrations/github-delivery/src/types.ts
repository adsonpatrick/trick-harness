/**
 * Vocabulary for scoped GitHub delivery: what a run asks to be delivered, what
 * the world was observed to hold afterwards, and where a failure to describe
 * the result is kept apart from a failure to produce it.
 * @module @trick-harness/github-delivery/types
 */

import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { DeliveryRecord } from '@trick-harness/journal'
import type { DeliveryError, PullRequestSpec } from './commands.ts'

/**
 * Somewhere durable for one confirmed mutation to be written down.
 *
 * Called after the world has been re-read and before the next mutation is
 * attempted, and awaited. A rejection stops the delivery: the alternative is a
 * push whose commit no record accounts for, which is exactly the state a
 * restart cannot reason about.
 */
export type DeliveryRecordObserver = (record: DeliveryRecord) => Promise<void>

/** How one delivery capability is bound to one workspace. */
export interface GitHubDeliveryOptions {
  /** Absolute path of the working tree this capability may write. */
  readonly cwd: string
  /** The subprocess seam; supply `ctx.subprocess.spawn` in a composed runtime. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Branch names that may never be mutated; defaults to the built-in set. */
  readonly protectedBranches?: readonly string[] | undefined
  /** Terminate escalation grace for each delivery command. */
  readonly graceMs?: number | undefined
  /**
   * Explicit child environment. Absent by default on purpose: the subprocess
   * seam scrubs credential-shaped entries from the parent environment, and
   * `gh` authenticates from its own stored configuration. Supplying a token
   * here would put a credential on a command line's environment for no gain.
   */
  readonly env?: NodeJS.ProcessEnv | undefined
  /** Where each confirmed mutation is checkpointed before the next one starts. */
  readonly onRecord?: DeliveryRecordObserver | undefined
}

/** One run's request to deliver its work. */
export interface DeliveryRequest {
  /** Branch the caller believes it is on; validated against the workspace. */
  readonly branch: string
  /** Repository-relative paths this run is scoped to write. */
  readonly files: readonly string[]
  /** Commit message, passed as one argv element and never interpreted. */
  readonly message: string
  /** What the pull request should say, whether it is opened or updated. */
  readonly pullRequest: PullRequestSpec
  /** Cancellation for the whole delivery. */
  readonly signal?: AbortSignal | undefined
}

/** One pull request, as GitHub reported it back. */
export interface PullRequestIdentity {
  readonly number: number
  readonly url: string | undefined
  /** True when this delivery opened it; false when it updated one that existed. */
  readonly created: boolean
}

/** Exit facts and bounded output of one delivery command. */
export interface CommandResult {
  readonly argv: readonly string[]
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}

/** What one delivery produced, and what it only failed to describe. */
export interface DeliveryOutcome {
  /** True when the commit, the push and the pull request all landed. */
  readonly delivered: boolean
  /** Durable records, each re-read from the world rather than from intent. */
  readonly records: readonly DeliveryRecord[]
  /** The commit HEAD resolved to, when one was made. */
  readonly commitSha: string | undefined
  /** The pull request, when one was opened or updated. */
  readonly pullRequest: PullRequestIdentity | undefined
  /** Human-readable result, naming no command output. */
  readonly summary: string
  /** Why delivery stopped, when it did. */
  readonly failure: { readonly code: DeliveryError['code']; readonly message: string } | undefined
  /**
   * Descriptions that could not be read after a delivery that did happen.
   * Kept apart from {@link failure} because a run told that its delivery
   * failed would repair work that is already on the remote.
   */
  readonly metadataFailures: readonly string[]
}
