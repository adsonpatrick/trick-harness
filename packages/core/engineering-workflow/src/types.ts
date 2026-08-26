import type {
  EvidenceRef,
  Finding,
  Role,
  RoutedPermissionMode,
  StageResult,
  WorkflowObjective,
  WorkflowVerdict,
} from '@trick-harness/contracts'
import type { ExecutorResult } from '@trick-harness/executor'
import type { WorkflowEndState } from '@trick-harness/journal'

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
  /** Prompt text per role; the runtime never composes task text itself. */
  readonly task: (stage: StageSpec, objective: WorkflowObjective) => string
}
