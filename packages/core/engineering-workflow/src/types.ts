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
import type { ExecutorResult } from '@trick-harness/executor'
import type { WorkflowEndState } from '@trick-harness/journal'
import type { RepairEvidence } from './repair.ts'

/** One stage the plan intends to run, named before anything is dispatched. */
export interface StageSpec {
  readonly stageId: string
  readonly role: Role
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

/** What the runtime tells a database preview capability about the stage. */
export interface WorkflowDatabasePreviewInput {
  readonly stageId: string
  readonly objective: WorkflowObjective
}

/** What a database preview capability reports back. */
export interface WorkflowDatabasePreviewResult {
  /** `PASSED`, `FAILED` on a branch that really existed, or `BLOCKED`. */
  readonly status: 'PASSED' | 'FAILED' | 'BLOCKED'
  readonly summary: string
  readonly evidence: readonly EvidenceRef[]
  readonly findings: readonly Finding[]
}

/** Validating migrations is deterministic too, and bounded the same way. */
export interface DatabasePreviewCapabilityPort {
  verify(input: WorkflowDatabasePreviewInput, signal: AbortSignal): Promise<WorkflowDatabasePreviewResult>
}

/**
 * The deterministic capabilities a run may reach, if a deployment supplied them.
 *
 * Absent is not the same as unnecessary. A lifecycle that needs one and does not
 * have it is BLOCKED, never rerouted to an executor that could approximate it.
 */
export interface WorkflowCapabilities {
  readonly delivery?: DeliveryCapabilityPort
  readonly databasePreview?: DatabasePreviewCapabilityPort
}
