/**
 * Vocabulary for cloud-only Supabase preview validation: how a run is bound to
 * a parent project, what each gate observed, and where the failure to tear a
 * branch down is kept apart from the failure of the work itself.
 * @module @trick-harness/supabase-preview/types
 */

import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { PreviewError } from './commands.ts'

/**
 * One hosted thing this capability made, changed or took away.
 *
 * Deliberately narrow. A record names the preview project and the branch, and
 * nothing else: it is written to a durable log, and the connection string, the
 * database password and the CLI's access token are all values that would be
 * read back by whoever reads that log next.
 */
export interface SupabaseMutationRecord {
  readonly action: 'preview-created' | 'migrations-applied' | 'preview-deleted'
  /** The child project ref, which the run has already proven is not the parent. */
  readonly previewProjectRef: string
  /** The branch name this run owns. */
  readonly branchName?: string
}

/**
 * Somewhere durable for one confirmed hosted mutation to be written down.
 *
 * Called after the mutation has been verified and before the next one is
 * attempted, and awaited. A rejection stops the run: a branch nobody recorded
 * is a branch nobody knows to delete.
 */
export type SupabaseMutationObserver = (record: SupabaseMutationRecord) => Promise<void>

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
  /** Where each confirmed hosted mutation is checkpointed before the next one. */
  readonly onMutation?: SupabaseMutationObserver | undefined
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

/**
 * The ordered vocabulary of things a preview run has to get past.
 *
 * Named as a closed set because the run is a sequence with dependencies, not a
 * checklist: a lint result read off a branch whose migrations did not apply
 * describes a schema that does not exist, and the only honest thing to say
 * about the gates after a failure is that they were not asked.
 *
 * `types` is reserved. This capability does not generate types yet, so it never
 * appears in a run's completed or skipped set.
 */
export type PreviewGate =
  | 'create'
  | 'identity'
  | 'health'
  | 'migration-push'
  | 'migration-list'
  | 'lint'
  | 'project-tests'
  | 'types'
  | 'cleanup'

/** What one gate observed, with output already redacted. */
export interface GateResult {
  /** Which gate this was. */
  readonly name: PreviewGate
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
  /** Each command gate that ran, in order. */
  readonly gates: readonly GateResult[]
  /**
   * Gates this run got past, in order.
   *
   * A gate that ran and failed is not here; it is named by {@link primaryFailure}.
   */
  readonly completedGates: readonly PreviewGate[]
  /**
   * Gates that would have run and were never asked, because a gate they depend
   * on failed first. Empty on a run that got all the way through.
   */
  readonly skippedGates: readonly PreviewGate[]
  /**
   * The one gate that stopped this run, when one did.
   *
   * Separate from {@link cleanupFailure} on purpose: cleanup is orthogonal, and
   * a run whose branch could not be deleted still failed — or passed — for its
   * own reasons.
   */
  readonly primaryFailure: { readonly gate: PreviewGate; readonly message: string } | undefined
  /** Why the branch could not be taken away, when it could not; redacted. */
  readonly cleanupFailure: string | undefined
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
