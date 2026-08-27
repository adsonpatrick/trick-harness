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
