import type {
  EvidenceRef,
  Finding,
  Role,
  RoutedPermissionMode,
  StageResult,
  StageRouteOverride,
  WorkflowObjective,
  WorkflowVerdict,
} from '@trick-harness/contracts'
import type {
  ChangeImpactStatusSummary,
  ConformanceManifest,
  ConformanceObligation,
  ConformanceStatusSummary,
} from '@trick-harness/contracts'
import type { ExecutorResult } from '@trick-harness/executor'
import type { WorkflowEndState } from '@trick-harness/journal'
import type { RepairEvidence } from './repair.ts'

/** One stage the plan intends to run, named before anything is dispatched. */
export interface StageSpec {
  readonly stageId: string
  readonly role: Role
  /**
   * The evidence profiles this stage owes, named by the change's own impact.
   *
   * Present only on stages that certify a change: what evidence a change owes
   * is resolved from what it turned out to be, which is not known while it is
   * still being produced. Profile names, never commands — the runtime that
   * holds the profile decides what producing one costs.
   */
  readonly requiredEvidenceProfiles?: readonly string[]
}

/**
 * What a finished stage contributes to the run.
 *
 * This is the whole of what a stage hands back: no output, no transcript, no
 * provider payload. A later stage reasons about its predecessors from these
 * fields alone, which is what keeps one stage's context out of the next one's.
 */
export interface StageFacts {
  readonly stageId: string
  readonly role: Role
  readonly executor: string
  readonly permissionMode: RoutedPermissionMode
  readonly verdict: WorkflowVerdict
  readonly summary: string
  readonly findings: readonly Finding[]
  readonly evidence: readonly EvidenceRef[]
  readonly durationMs: number
}

/**
 * Turns a provider's raw result into the stage's verdict and evidence.
 *
 * The runtime never parses executor output itself. A caller that knows the
 * executor's shape supplies this, and whatever it returns is all the runtime
 * carries forward.
 */
export type StageInterpreter = (
  stage: StageSpec,
  executor: string,
  result: ExecutorResult,
) => StageResult

/** How the run finished, with the facts each stage contributed. */
export interface WorkflowOutcome {
  readonly workflowId: string
  readonly objectiveId: string
  readonly state: WorkflowEndState
  readonly verdict: WorkflowVerdict
  readonly summary: string
  readonly stages: readonly StageFacts[]
  readonly repairCycles: number
  readonly executorStarts: number
  /**
   * The latest conformance reading, bounded.
   *
   * Absent when nothing established conformance, which is a different fact
   * from a reading that found nothing satisfied.
   */
  readonly conformance?: ConformanceStatusSummary
  /**
   * What the change turned out to be, as the run last resolved it.
   *
   * Absent when the run classified nothing at all, which is a different fact
   * from a change that classified to nothing.
   */
  readonly changeImpact?: ChangeImpactStatusSummary
}

/** What a restart may conclude about a workflow it finds in a durable log. */
export interface RestartAssessment {
  /** The execution this assessment is about. */
  readonly workflowId: string
  /**
   * The logical objective that execution was one attempt at.
   *
   * Carried so a reader who has only an execution id can still say what was
   * being attempted. Two assessments sharing an objective id are two attempts
   * at one thing, which is a fact worth being able to see.
   */
  readonly objectiveId: string
  /** `terminal` when the log records an end; `interrupted` when it does not. */
  readonly state: 'terminal' | 'interrupted'
  readonly verdict: WorkflowVerdict
  /** Stages started and never ended — the work whose effect is unknown. */
  readonly openStages: readonly string[]
  /**
   * True when a stage was in flight, or a mutation was recorded, and the world
   * must be re-read before anything is retried.
   */
  readonly requiresWorldVerification: boolean
  readonly summary: string
}

/** What the runtime needs to dispatch one objective. */
export interface WorkflowRunRequest {
  readonly objective: WorkflowObjective
  /** The executor that did the implementing, when a read-only stage must avoid it. */
  readonly implementationExecutor?: string
  readonly interpret: StageInterpreter
  /**
   * The stage plan, when the run is not the default working-tree one.
   *
   * Supply `planPullRequestStages` to certify a published branch instead. The
   * plan is still a function of the objective alone, so a replay of the same
   * objective under the same plan runs the same stages.
   */
  readonly plan?: (objective: WorkflowObjective) => readonly StageSpec[]
  /** Prompt text per role; the runtime never composes task text itself. */
  readonly task: (stage: StageSpec, objective: WorkflowObjective) => string
  /**
   * One human routing choice, spent on the first stage of its role.
   *
   * Single-consumption on purpose. A person overriding a route is answering a
   * situation — this review needs the frontier tier, this once — and an
   * override that stayed in force would silently become policy for every later
   * stage of that role, including the repair cycles nobody asked about. The
   * profile's table is never edited to honour it.
   */
  readonly routeOverride?: StageRouteOverride
  /**
   * Reads the debugger stage's result back as a diagnosis, if it produced one.
   *
   * The runtime never parses a diagnosis out of provider output. A caller that
   * knows the executor's shape supplies this, and returning `undefined` is a
   * legitimate answer: a debugger that established nothing has established
   * nothing, and the repair gate refuses on that rather than proceeding.
   */
  readonly diagnose?: (stage: StageSpec, executor: string, result: ExecutorResult) => unknown
  /**
   * Reads a finished repair's own claims back, for the completion gate.
   *
   * Absent, a repair is judged to have produced no regression test and no
   * focused green run, because silence is not evidence.
   */
  readonly repairEvidence?: (stage: StageSpec, executor: string, result: ExecutorResult) => RepairEvidence
  /**
   * That this run changes a database, so it may not publish unverified.
   *
   * Declared by the caller rather than inferred from a diff: a runtime guessing
   * at which files are migrations would sometimes guess that a schema change is
   * not one, and the failure mode of that guess is a migration reaching a real
   * database with nothing having read it back.
   */
  readonly databaseChange?: WorkflowDatabaseChange
  /**
   * Reads the two sets of repository paths a run's impact is classified from.
   *
   * Supplied by a deployment that knows where the checkout is; the runtime
   * never opens a repository. Both answers are lists of paths and nothing else:
   * what they mean is decided here, from the profile's declared rules, so no
   * reader — and no stage — can hand back a classification of its own work.
   *
   * Absent, the run uses the fixed risk-driven plan. Present, the run splits at
   * delivery and its certification is planned from what was actually published.
   */
  readonly changeImpact?: ChangeImpactReader
  /**
   * Reads the approved Spec and Plan back, with the hashes they carry now.
   *
   * The runtime never opens a file. A caller that knows where the checkout is
   * supplies this, and the runtime compares what comes back with the identity
   * the objective was approved under. It is called again before conformance
   * rather than once at the start, because the documents can change under a
   * run and a conformance reading taken against an edited Plan is a reading of
   * obligations nobody approved.
   */
  readonly loadApprovedArtifacts?: (
    objective: WorkflowObjective,
    signal: AbortSignal,
  ) => Promise<ApprovedArtifactTexts>
  /**
   * Reads the conformance stage's result back as a contract.
   *
   * The manifest is handed in so the caller can put the obligations in front of
   * the model; what comes back is parsed and held to that manifest before it
   * becomes stage facts. Returning something that is not a valid contract is
   * not a pass — the run ends INCONCLUSIVE, because nothing established
   * whether the implementation satisfies what was approved.
   */
  readonly conformance?: (
    stage: StageSpec,
    executor: string,
    result: ExecutorResult,
    manifest: ConformanceManifest,
  ) => unknown
  /**
   * The Definition of Done these obligations are judged against, on top of the
   * approved Spec and Plan.
   *
   * Supplied by the caller because it is profile policy: it is the standing bar
   * a project holds every objective to, and reading it out of the same
   * documents an objective is judged against would let one pull request lower
   * the bar it is being measured by. Absent means the obligations are the
   * Spec's and the Plan's alone.
   */
  readonly dodObligations?: readonly ConformanceObligation[]
}

/** The approved documents as they stand right now, with the identity they carry. */
export interface ApprovedArtifactTexts {
  readonly specText: string
  readonly planText: string
  readonly specSha256: string
  readonly planSha256: string
}

/**
 * What the runtime tells a delivery capability about the stage asking for it.
 *
 * Deliberately thin. The runtime does not know which files changed or what the
 * pull request should say — those are the caller's, the same way task text is —
 * so it names the stage and the objective and nothing more. Whatever turns that
 * into a branch, a write set and a pull request lives on the composition side,
 * where the project's own answer to that question already is.
 */
export interface WorkflowDeliveryInput {
  readonly stageId: string
  readonly objective: WorkflowObjective
}

/** What a delivery capability reports back, in the vocabulary a stage records. */
export interface WorkflowDeliveryResult {
  /** True when the commit, the push and the pull request all landed. */
  readonly delivered: boolean
  /** Bounded human-readable outcome, naming no credential or command output. */
  readonly summary: string
  /** Anything the capability wants a later stage to be able to follow. */
  readonly evidence: readonly EvidenceRef[]
  /** Findings the failure raised, when it failed. */
  readonly findings: readonly Finding[]
}

/**
 * Publishing work is a deterministic act, so it is a port rather than a prompt.
 *
 * An LLM executor handed a shell to run `git push` with is an executor with
 * unbounded authority over the remote, and the bound is the whole point: the
 * capability behind this port may push the current branch and open or update
 * its pull request, and has no way to express force-pushing, rewriting history
 * or merging.
 */
export interface DeliveryCapabilityPort {
  deliver(input: WorkflowDeliveryInput, signal: AbortSignal): Promise<WorkflowDeliveryResult>
}

/**
 * A run that changes a database, and says so before it publishes anything.
 *
 * Carries paths, never credentials. Where the isolated branch lives, who may
 * reach it and what authenticates to it are the capability's own configuration,
 * read from the places the CLI already reads them; a connection string that
 * arrived in a run request would be one a journal, a status poll or an error
 * summary could later repeat.
 */
export interface WorkflowDatabaseChange {
  readonly required: true
  readonly migrationPaths: readonly string[]
}

/** What the runtime tells a database verification capability about the stage. */
export interface WorkflowDatabaseVerificationInput {
  readonly stageId: string
  readonly objective: WorkflowObjective
}

/** What a database verification capability reports back. */
export interface WorkflowDatabaseVerificationResult {
  /** `PASSED`, `FAILED` against a database that really existed, or `BLOCKED`. */
  readonly status: 'PASSED' | 'FAILED' | 'BLOCKED'
  readonly summary: string
  readonly evidence: readonly EvidenceRef[]
  readonly findings: readonly Finding[]
}

/**
 * Validating migrations is deterministic too, and bounded the same way.
 *
 * How the migrations are validated is the deployment's choice, not the
 * runtime's: an isolated preview branch, a shared development database reached
 * through a fixed project command, or anything else that can answer in these
 * bounded terms. The runtime asks the question and reads the verdict; it never
 * learns which strategy answered it.
 */
export interface DatabaseVerificationCapabilityPort {
  verify(
    input: WorkflowDatabaseVerificationInput,
    signal: AbortSignal,
  ): Promise<WorkflowDatabaseVerificationResult>
}

/** @deprecated Use {@link WorkflowDatabaseVerificationInput}. Kept for one cycle. */
export type WorkflowDatabasePreviewInput = WorkflowDatabaseVerificationInput

/** @deprecated Use {@link WorkflowDatabaseVerificationResult}. Kept for one cycle. */
export type WorkflowDatabasePreviewResult = WorkflowDatabaseVerificationResult

/** @deprecated Use {@link DatabaseVerificationCapabilityPort}. Kept for one cycle. */
export type DatabasePreviewCapabilityPort = DatabaseVerificationCapabilityPort

/**
 * Every state a certification may be published in, and nothing else.
 *
 * Four states because that is what an external certifier can honestly say: the
 * run is under way, it finished and the revision is certified, it finished and
 * the revision is not, or the question could not be answered at all. The last
 * one matters most — a capability that cannot reach its certifier has not
 * learned the revision is fine, so it says `error` rather than staying quiet
 * and leaving a stale `pending` to be read as caution or as neglect depending
 * on who is reading.
 *
 * Stated as a frozen list rather than a bare union so a run can be checked
 * against it, and so nothing can widen the vocabulary at runtime.
 */
export const EXTERNAL_CERTIFICATION_STATES = Object.freeze([
  'pending',
  'success',
  'failure',
  'error',
] as const)

/** One of {@link EXTERNAL_CERTIFICATION_STATES}. */
export type ExternalCertificationState = typeof EXTERNAL_CERTIFICATION_STATES[number]

/**
 * What the runtime tells a certification capability, and nothing more.
 *
 * Deliberately thin: a state the runtime chose, and the revision it believes it
 * is talking about. There is no description, no summary and no URL here,
 * because everything a certification publishes outside the harness is chosen by
 * the capability from the state alone. A field a run could fill is a field a
 * model's output could reach, and a commit status is read by people deciding
 * whether to merge.
 */
export interface WorkflowCertificationInput {
  readonly objective: WorkflowObjective
  readonly state: ExternalCertificationState
  /**
   * The revision this certification is meant for, when the run already knows it.
   *
   * The capability re-reads the revision itself either way; this is what it
   * checks that reading against. A run that has certified a revision and then
   * finds the branch has moved has not certified the branch, and must not be
   * able to publish as though it had.
   */
  readonly expectedRevision?: string
}

/** What a certification capability reports back about what it published. */
export interface WorkflowCertificationResult {
  /** The revision the capability actually certified, as it re-read it. */
  readonly revision: string
  /** The certifier's own id for the status, so a later read can find it. */
  readonly externalId: string
  /** Where a person can see it. */
  readonly url?: string
  readonly evidence: readonly EvidenceRef[]
}

/**
 * Certifying a revision outside the harness is deterministic, so it is a port.
 *
 * Separate from {@link DeliveryCapabilityPort} on purpose. Delivery may move a
 * branch; this may not move anything at all. It publishes one status against
 * one revision, and has no way to express a commit, a push, a pull-request
 * edit, a merge, a release or a deploy — which is what makes it safe to let a
 * branch-protection rule require it.
 */
/**
 * Whether the run is ready, as the workflow owner alone computes it.
 *
 * Internal to the harness: `summary` is journal-facing prose that may name
 * stages and findings, and is never copied into anything published outside.
 * Built by {@link certificationDecision} from the same predicate that permits
 * `PR_READY`, never from a second checklist that agrees with it today.
 */
export interface WorkflowCertificationDecision {
  readonly ready: boolean
  readonly verdict: WorkflowVerdict
  readonly summary: string
}

export interface CertificationCapabilityPort {
  publish(
    input: WorkflowCertificationInput,
    signal: AbortSignal,
  ): Promise<WorkflowCertificationResult>
}

/**
 * The deterministic capabilities a run may reach, if a deployment supplied them.
 *
 * Absent is not the same as unnecessary. A lifecycle that needs one and does not
 * have it is BLOCKED, never rerouted to an executor that could approximate it.
 */
export interface WorkflowCapabilities {
  readonly delivery?: DeliveryCapabilityPort
  readonly databaseVerification?: DatabaseVerificationCapabilityPort
  readonly certification?: CertificationCapabilityPort
}

/**
 * Where the two readings of a change's paths come from.
 *
 * The planned reading is taken from the Plan a person approved, before any
 * mutation-capable stage runs; the actual one from the published branch, after
 * delivery. Both are asked for paths, never for conclusions: a stage that could
 * describe its own change could describe a smaller one, and a smaller change
 * scores as lower risk with a thinner evidence bar.
 */
export interface ChangeImpactReader {
  /**
   * The paths the approved Plan says this objective will touch.
   *
   * @param objective - the approved objective.
   * @param signal - the run's abort signal.
   */
  plannedPaths(objective: WorkflowObjective, signal: AbortSignal): Promise<readonly string[]>
  /**
   * The paths the published branch turned out to touch.
   *
   * @param objective - the approved objective.
   * @param signal - the run's abort signal.
   */
  actualPaths(objective: WorkflowObjective, signal: AbortSignal): Promise<readonly string[]>
}
