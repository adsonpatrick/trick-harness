/**
 * Vocabulary for scoped GitHub certification: how one capability is bound to
 * one checkout, and what it must re-read before it is allowed to publish.
 * @module @trick-harness/github-certification/types
 */

import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

/** How one certification capability is bound to one checkout. */
export interface GitHubCertificationOptions {
  /** Absolute path of the working tree this capability reads. */
  readonly cwd: string
  /** The only repository this capability may publish a status to. */
  readonly repository: string
  /**
   * The only base branch whose pull requests this capability may certify.
   *
   * A pull request into somewhere else is a different question with a
   * different bar, and this capability has no way to tell which.
   */
  readonly baseBranch: string
  /**
   * The status context, chosen by the deployment and by nothing else.
   *
   * Not a run input, not a profile field and not a project-config key: it is
   * the exact name a branch-protection rule is configured with, so a run able
   * to choose it would be a run able to satisfy a rule by answering a
   * different question than the one being asked.
   */
  readonly context: string
  /** The subprocess seam; supply `ctx.subprocess.spawn` in a composed runtime. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Terminate escalation grace for each command this capability starts. */
  readonly graceMs?: number | undefined
}

/**
 * One pull request, as every reading agreed it stands right now.
 *
 * Built only after the repository the checkout reports, the branch it has
 * checked out, the commit that branch is on, and the pull request the API
 * holds have all been read and compared. A value of this type is the statement
 * that they matched.
 */
export interface GitHubCertificationTarget {
  readonly repository: string
  readonly pullRequestNumber: number
  readonly pullRequestUrl: string
  readonly branch: string
  readonly revision: string
  readonly baseBranch: string
}

/** Exit facts and bounded output of one certification command. */
export interface CommandResult {
  readonly argv: readonly string[]
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}
