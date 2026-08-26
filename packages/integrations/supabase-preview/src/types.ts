/**
 * Vocabulary for cloud-only Supabase preview validation: how a run is bound to
 * a parent project, what each gate observed, and where the failure to tear a
 * branch down is kept apart from the failure of the work itself.
 * @module @trick-harness/supabase-preview/types
 */

import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { PreviewError } from './commands.ts'

/** How one preview capability is bound to one project. */
export interface SupabasePreviewOptions {
  /** Absolute path of the repository whose migration history is applied. */
  readonly cwd: string
  /** The subprocess seam; supply `ctx.subprocess.spawn` in a composed runtime. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /**
   * Parent project ref. This is non-secret project configuration: it names a
   * project, it does not authenticate to one. Authentication stays with the
   * Supabase CLI's own login state, which this package never reads or copies.
   */
  readonly projectRef: string
  /** Region for the branch database, when project configuration pins one. */
  readonly region?: string | undefined
  /** Instance size for the branch database, when project configuration pins one. */
  readonly size?: string | undefined
  /** Schemas the remote lint covers. */
  readonly schema?: string | undefined
  /** Level at which the remote lint fails the gate; defaults to `error`. */
  readonly lintFailOn?: 'none' | 'warning' | 'error' | undefined
  /**
   * The project's own pgTAP/RLS suite, as argv. It is spawned with the preview
   * connection supplied through the named environment variable below, so the
   * connection never reaches an argv the project could log.
   */
  readonly testCommand?: readonly string[] | undefined
  /** Environment variable the project test command reads its connection from. */
  readonly testConnectionEnv?: string | undefined
  /** How long to wait for the branch to report healthy. */
  readonly readyTimeoutMs?: number | undefined
  /** How long between health reads while waiting. */
  readonly pollIntervalMs?: number | undefined
  /** Terminate escalation grace for each spawned command. */
  readonly graceMs?: number | undefined
}

/** One request to validate the repository's migrations on a fresh branch. */
export interface PreviewRunRequest {
  /** Name for the preview branch; one run, one branch. */
  readonly branchName: string
  /** Git branch to associate with the preview branch, when there is one. */
  readonly gitBranch?: string | undefined
  /** Cancellation for the whole run, teardown included. */
  readonly signal?: AbortSignal | undefined
}

/** A preview branch as the API reported it, with its connection withheld. */
export interface PreviewBranchIdentity {
  /** Branch id, when the API reported one. */
  readonly id: string | undefined
  /** Branch name this run created. */
  readonly name: string
  /** The preview project ref, which is never the parent's. */
  readonly projectRef: string | undefined
  /** Status word as reported, such as `FUNCTIONS_DEPLOYED` or `MIGRATIONS_FAILED`. */
  readonly status: string | undefined
  /** True once the branch reported a status this capability treats as healthy. */
  readonly healthy: boolean
}

/** What one gate observed, with output already redacted. */
export interface GateResult {
  /** Gate name, such as `migrations`, `migration-list`, `lint` or `project-tests`. */
  readonly name: string
  /** Whether the gate passed. */
  readonly passed: boolean
  /** Exit code, or null when the process was signalled. */
  readonly exitCode: number | null
  /** Bounded, redacted evidence the gate produced. */
  readonly evidence: string
}

/** Exit facts and bounded output of one spawned command. */
export interface CommandResult {
  readonly argv: readonly string[]
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}

/** What one preview run produced, and what it only failed to clean up. */
export interface PreviewOutcome {
  /**
   * `PASSED` when every gate passed, `FAILED` when a gate failed on a branch
   * that really was provisioned, and `BLOCKED` when no safe preview database
   * could be reached at all. The three are distinct because only `FAILED`
   * describes the repository's migrations.
   */
  readonly status: 'PASSED' | 'FAILED' | 'BLOCKED'
  /** The branch, when one was created. */
  readonly branch: PreviewBranchIdentity | undefined
  /** Each gate that ran, in order. */
  readonly gates: readonly GateResult[]
  /** Human-readable result, naming no connection string. */
  readonly summary: string
  /** Why the run stopped, when it did. */
  readonly failure: { readonly code: PreviewError['code']; readonly message: string } | undefined
  /**
   * What happened to the branch afterwards. Reported apart from the run's own
   * result because a leaked branch costs money and needs a person, while a
   * failed migration needs a repair cycle, and the two calls are different.
   */
  readonly cleanup: CleanupResult
}

/** Whether the branch this run created is gone. */
export interface CleanupResult {
  /** True when a delete was issued at all. */
  readonly attempted: boolean
  /** True when the delete reported success. */
  readonly succeeded: boolean
  /** Why cleanup failed, when it did; redacted. */
  readonly message: string | undefined
}
