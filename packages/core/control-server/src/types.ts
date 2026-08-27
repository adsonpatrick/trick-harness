/**
 * What the loopback control server accepts, and what it is allowed to say back.
 *
 * @module @trick-harness/control-server
 */

import type { StageRouteOverride, WorkflowObjective, WorkflowVerdict } from '@trick-harness/contracts'
import type { RestartAssessment, WorkflowOutcome } from '@trick-harness/engineering-workflow'

/** The address family the server is permitted to bind. */
export const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost'] as const

/** How a workflow looks to whoever asked about it. */
export type ControlWorkflowState =
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'blocked'
  | 'interrupted'

/**
 * One stage, as far as a status reader is concerned.
 *
 * Deliberately narrower than `StageFacts`: findings and evidence refs belong to
 * the run's durable record, not to a status poll, and a bridge that rendered
 * them would be rendering somebody's private reasoning into a chat window.
 */
export interface ControlStageStatus {
  readonly stageId: string
  readonly role: string
  readonly executor: string
  readonly verdict: WorkflowVerdict
  readonly summary: string
}

/**
 * The bounded status an OpenCode bridge may render.
 *
 * Every string field is truncated, the stage list is capped, and there is no
 * field for provider output. A status is a thing a person glances at; it is not
 * a transport for a transcript.
 */
export interface ControlWorkflowStatus {
  readonly workflowId: string
  readonly objectiveId: string
  readonly state: ControlWorkflowState
  readonly verdict: WorkflowVerdict
  readonly summary: string
  readonly stages: readonly ControlStageStatus[]
  readonly repairCycles: number
  readonly executorStarts: number
  /**
   * True when the record cannot settle what the world now looks like — a stage
   * was in flight, or a mutation was recorded, when the process stopped.
   */
  readonly requiresWorldVerification: boolean
}

/**
 * What starts one workflow on behalf of an HTTP caller.
 *
 * The override is passed rather than applied: the server's part is to refuse a
 * malformed one before any durable record exists, and the workflow's part is to
 * decide which single stage it reaches.
 */
export type ControlWorkflowStarter = (
  objective: WorkflowObjective,
  signal: AbortSignal,
  routeOverride?: StageRouteOverride,
) => Promise<WorkflowOutcome>

/**
 * What the durable journal can say about a workflow this process is not running.
 *
 * Returning `undefined` means the server has never heard of the id, which is a
 * 404. Returning an assessment for a workflow with no recorded end is how a
 * restart surfaces interrupted work instead of resuming it.
 */
export type ControlRestartReader = (workflowId: string) => Promise<RestartAssessment | undefined>

/** How the server is built. */
export interface ControlServerOptions {
  /** Starts a Harness-owned workflow; the server owns its abort signal. */
  readonly start: ControlWorkflowStarter
  /** Reads durable state for a workflow this process is not running. */
  readonly restart?: ControlRestartReader
  /** Loopback host to bind; anything else is refused. */
  readonly host?: string
  /** Port to bind; `0` takes an ephemeral one. */
  readonly port?: number
  /**
   * Bearer token required on every request but `GET /health`.
   *
   * Absent, the server mints one per process. It is never written anywhere: a
   * caller reads it from the server object it constructed, in this process.
   */
  readonly token?: string
}

/** A request the server refused, stated without quoting the caller's payload. */
export class ControlError extends Error {
  /** Machine-readable cause, so a caller can tell a bad request from a bad state. */
  readonly code:
    | 'invalid-objective'
    | 'unknown-workflow'
    | 'duplicate-workflow'
    | 'not-loopback'
    | 'unauthorized'
    | 'unavailable'

  /** The HTTP status this refusal maps to. */
  readonly status: number

  /**
   * @param code - Machine-readable cause.
   * @param status - HTTP status this maps to.
   * @param message - What went wrong, free of caller data.
   */
  constructor(code: ControlError['code'], status: number, message: string) {
    super(message)
    this.name = 'ControlError'
    this.code = code
    this.status = status
  }
}
