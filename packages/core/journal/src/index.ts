/**
 * The durable workflow journal.
 *
 * Two halves that must stay in step: {@link WorkflowJournal} appends the
 * `harness/*` events a run produces, and {@link projectWorkflow} rebuilds the
 * run's state from those events and nothing else. Anything the projection
 * cannot see is not durable, which is the point — a workflow that resumed from
 * live memory would resume differently after a restart than after a compaction.
 *
 * @module @trick-harness/journal
 */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  DiagnosisContract,
  EvidenceRef,
  Finding,
  RouteDecision,
  Role,
  RoutedPermissionMode,
  WorkflowObjective,
  WorkflowVerdict,
} from '@trick-harness/contracts'
import type {
  BlockerKind,
  DeliveryAction,
  ExecutorOutcome,
  WorkflowEndState,
} from './types.ts'

export * from './types.ts'

/**
 * Every event type this journal writes, in lifecycle order.
 *
 * Stated as data because the build's persistence read path refuses a log
 * containing a type it does not know: a harness assembled without this
 * package's declaration merge fails to reconstruct a session that used it,
 * rather than quietly reading back a run with its findings missing.
 */
export const HARNESS_EVENT_TYPES = [
  'harness/workflow-start',
  'harness/route-decision',
  'harness/route-fallback',
  'harness/executor-start',
  'harness/executor-end',
  'harness/finding',
  'harness/diagnosis',
  'harness/verdict',
  'harness/delivery',
  'harness/blocker',
  'harness/circuit-breaker',
  'harness/workflow-end',
] as const

/** One event type this journal writes. */
export type HarnessEventType = typeof HARNESS_EVENT_TYPES[number]

/** A journal operation that cannot be completed as asked. */
export class JournalError extends Error {
  /** Machine-readable cause, so a caller can branch without parsing prose. */
  readonly code: 'unknown-event' | 'foreign-workflow'

  /**
   * @param code - Machine-readable cause.
   * @param message - Human-readable detail, naming no payload value.
   */
  constructor(code: JournalError['code'], message: string) {
    super(message)
    this.name = 'JournalError'
    this.code = code
  }
}

/**
 * Whether one event type belongs to this journal's vocabulary.
 * @param type - The session event type to test.
 * @returns True when this journal both writes and can interpret it.
 */
export function isHarnessEventType(type: string): type is HarnessEventType {
  return (HARNESS_EVENT_TYPES as readonly string[]).includes(type)
}

/** How a stage's route was reached, as the projection reads it back. */
export interface RouteRecord {
  readonly stageId: string
  readonly role: Role
  readonly executor: string
  readonly resolvedModel: string
  readonly permissionMode: RoutedPermissionMode
  readonly reasonCodes: readonly string[]
  readonly policyVersion: string
  readonly fallbackFrom?: string
}

/** One stage's verdict as the projection reads it back. */
export interface VerdictRecord {
  readonly stageId: string
  readonly role: Role
  readonly verdict: WorkflowVerdict
  readonly summary: string
  readonly evidence: readonly EvidenceRef[]
}

/** What delivery was observed to have done, after re-reading the world. */
export interface DeliveryRecord {
  readonly action: DeliveryAction
  readonly branch: string
  readonly commitSha?: string
  readonly prNumber?: number
  readonly prUrl?: string
}

/** Something a person has to decide before the run can continue. */
export interface BlockerRecord {
  readonly stageId?: string
  readonly kind: BlockerKind
  readonly summary: string
  readonly evidence: readonly EvidenceRef[]
}

/** The whole state of one workflow, rebuilt from its events. */
export interface WorkflowProjection {
  readonly workflowId: string
  /** Absent when the log holds no start event for this workflow. */
  readonly objective?: Pick<WorkflowObjective, 'id' | 'cwd' | 'requirement' | 'risk' | 'workload' | 'profileId'>
  readonly routes: readonly RouteRecord[]
  readonly findings: readonly Finding[]
  readonly diagnoses: readonly DiagnosisContract[]
  readonly verdicts: readonly VerdictRecord[]
  readonly deliveries: readonly DeliveryRecord[]
  readonly blockers: readonly BlockerRecord[]
  /** Executor to the circuit state its last recorded transition left it in. */
  readonly circuits: Readonly<Record<string, 'AVAILABLE' | 'DEGRADED'>>
  /** Executor runs started but never ended — the work a restart must verify. */
  readonly openStages: readonly string[]
  readonly executorStarts: number
  /** Absent while the workflow is still in flight. */
  readonly end?: { readonly state: WorkflowEndState; readonly verdict: WorkflowVerdict; readonly summary: string }
}

/** Force a durable checkpoint, so an append survives losing the process. */
export type JournalFlush = () => Promise<unknown>

/** What one stage was dispatched as. */
export interface StageDispatch {
  readonly stageId: string
  readonly role: Role
  readonly decision: RouteDecision
}

/**
 * Append-only writer for one workflow's durable facts.
 *
 * Every payload is rebuilt field by field from what the type declares, so a
 * caller that hands over a richer object — a stage result still carrying its
 * transcript, a finding with the model's working attached — writes the declared
 * fields and nothing else. Dropping at the boundary is the only place the drop
 * can be guaranteed; a convention about what callers pass is not one.
 */
export class WorkflowJournal {
  readonly #session: Session
  readonly #workflowId: string
  readonly #flush: JournalFlush

  /**
   * @param session - The session whose event log is the durable record.
   * @param workflowId - The workflow every event this journal writes belongs to.
   * @param flush - Durability checkpoint, awaited where losing the fact would
   *   make a restart act on a world it cannot see.
   */
  constructor(session: Session, workflowId: string, flush: JournalFlush) {
    this.#session = session
    this.#workflowId = workflowId
    this.#flush = flush
  }

  /** The workflow this journal writes for. */
  get workflowId(): string {
    return this.#workflowId
  }

  /**
   * Record that a workflow was accepted.
   * @param objective - The objective it was accepted for.
   */
  start(objective: WorkflowObjective): void {
    this.#session.append('harness/workflow-start', {
      workflowId: this.#workflowId,
      objectiveId: objective.id,
      profileId: objective.profileId,
      cwd: objective.cwd,
      requirement: objective.requirement,
      risk: objective.risk,
      workload: objective.workload,
    })
  }

  /**
   * Record the route a stage was dispatched on.
   * @param dispatch - The stage and the decision that routed it.
   */
  routeDecision(dispatch: StageDispatch): void {
    const { decision } = dispatch
    this.#session.append('harness/route-decision', {
      workflowId: this.#workflowId,
      stageId: dispatch.stageId,
      role: dispatch.role,
      executor: decision.executor,
      semanticModelTier: decision.semanticModelTier,
      resolvedModel: decision.resolvedModel,
      permissionMode: decision.permissionMode,
      reasonCodes: [...decision.reasonCodes],
      policyVersion: decision.policyVersion,
      ...decision.reasoningEffort === undefined ? {} : { reasoningEffort: decision.reasoningEffort },
    })
  }

  /**
   * Record a route taken around an unavailable executor, durably.
   *
   * Flushed because a fallback is the fact that explains a lowered verdict. A
   * run that recovered the verdict but lost the reason reads as an unexplained
   * downgrade, which is indistinguishable from a bug in the harness.
   * @param dispatch - The stage and the fallback decision it ran on.
   * @param failureClass - The availability failure that caused the fallback.
   * @param impact - What the fallback cost in independence and assurance.
   */
  async routeFallback(
    dispatch: StageDispatch,
    failureClass: string,
    impact: { independence: 'preserved' | 'reduced' | 'lost'; assurance: 'unchanged' | 'lowered' },
  ): Promise<void> {
    const { decision } = dispatch
    this.#session.append('harness/route-fallback', {
      workflowId: this.#workflowId,
      stageId: dispatch.stageId,
      requestedExecutor: decision.fallbackFrom ?? decision.executor,
      fallbackExecutor: decision.executor,
      failureClass,
      independenceImpact: impact.independence,
      assuranceImpact: impact.assurance,
      reasonCodes: [...decision.reasonCodes],
      policyVersion: decision.policyVersion,
    })
    await this.#flush()
  }

  /**
   * Record that an executor run began.
   * @param dispatch - The stage and the decision it runs on.
   */
  executorStart(dispatch: StageDispatch): void {
    const { decision } = dispatch
    this.#session.append('harness/executor-start', {
      workflowId: this.#workflowId,
      stageId: dispatch.stageId,
      role: dispatch.role,
      executor: decision.executor,
      resolvedModel: decision.resolvedModel,
      permissionMode: decision.permissionMode,
    })
  }

  /**
   * Record that an executor run ended.
   * @param stageId - The stage that ended.
   * @param executor - The executor that ran it.
   * @param outcome - How it stopped.
   * @param durationMs - Wall-clock duration of the run.
   * @param failureClass - The classified failure, when it had one.
   */
  executorEnd(
    stageId: string,
    executor: string,
    outcome: ExecutorOutcome,
    durationMs: number,
    failureClass?: string,
  ): void {
    this.#session.append('harness/executor-end', {
      workflowId: this.#workflowId,
      stageId,
      executor,
      outcome,
      durationMs,
      ...failureClass === undefined ? {} : { failureClass },
    })
  }

  /**
   * Record one triaged finding.
   * @param stageId - The stage that raised it.
   * @param finding - The finding, carrying its evidence references.
   */
  finding(stageId: string, finding: Finding): void {
    this.#session.append('harness/finding', {
      workflowId: this.#workflowId,
      stageId,
      finding: {
        id: finding.id,
        class: finding.class,
        raisedBy: finding.raisedBy,
        summary: finding.summary,
        confirmed: finding.confirmed,
        evidence: finding.evidence.map(reference => ({ ...reference })),
      },
    })
  }

  /**
   * Record one completed diagnosis, durably.
   *
   * Flushed because this is the contract a repair is authorised by. Losing it
   * would let a restart repair from a root cause nobody can now read.
   * @param stageId - The stage that produced it.
   * @param diagnosis - The diagnosis contract.
   */
  async diagnosis(stageId: string, diagnosis: DiagnosisContract): Promise<void> {
    this.#session.append('harness/diagnosis', {
      workflowId: this.#workflowId,
      stageId,
      diagnosis: {
        symptom: diagnosis.symptom,
        reproduction: diagnosis.reproduction,
        expectedVsActual: diagnosis.expectedVsActual,
        observedEvidence: diagnosis.observedEvidence.map(reference => ({ ...reference })),
        affectedBoundary: diagnosis.affectedBoundary,
        ruledOutHypotheses: [...diagnosis.ruledOutHypotheses],
        rootCauseHypothesis: diagnosis.rootCauseHypothesis,
        confidence: diagnosis.confidence,
        regressionTestSeam: diagnosis.regressionTestSeam,
        minimalRepairSurface: diagnosis.minimalRepairSurface,
        unknowns: [...diagnosis.unknowns],
        securityRelevance: diagnosis.securityRelevance,
        ...diagnosis.productDecisionDependency === undefined
          ? {}
          : { productDecisionDependency: diagnosis.productDecisionDependency },
      },
    })
    await this.#flush()
  }

  /**
   * Record one stage's verdict, durably.
   * @param stageId - The stage that reached it.
   * @param role - The role that judged.
   * @param verdict - The verdict, already capped to what its route supports.
   * @param summary - One bounded sentence, not the stage's narration.
   * @param evidence - What the verdict rests on.
   * @param lowered - Whether a weakened route capped this verdict.
   */
  async verdict(
    stageId: string,
    role: Role,
    verdict: WorkflowVerdict,
    summary: string,
    evidence: readonly EvidenceRef[],
    lowered?: boolean,
  ): Promise<void> {
    this.#session.append('harness/verdict', {
      workflowId: this.#workflowId,
      stageId,
      role,
      verdict,
      summary,
      evidence: evidence.map(reference => ({ ...reference })),
      ...lowered === undefined ? {} : { lowered },
    })
    await this.#flush()
  }

  /**
   * Record one delivery mutation, durably, from re-read world state.
   *
   * Flushed because this is the only way a restart tells a push that happened
   * from one that was about to. Anything else risks a second push of work that
   * is already on the remote.
   * @param record - What the world was observed to hold afterwards.
   */
  async delivery(record: DeliveryRecord): Promise<void> {
    this.#session.append('harness/delivery', {
      workflowId: this.#workflowId,
      action: record.action,
      branch: record.branch,
      ...record.commitSha === undefined ? {} : { commitSha: record.commitSha },
      ...record.prNumber === undefined ? {} : { prNumber: record.prNumber },
      ...record.prUrl === undefined ? {} : { prUrl: record.prUrl },
    })
    await this.#flush()
  }

  /**
   * Record something a person has to decide, durably.
   * @param record - The blocker and its evidence.
   */
  async blocker(record: BlockerRecord): Promise<void> {
    this.#session.append('harness/blocker', {
      workflowId: this.#workflowId,
      kind: record.kind,
      summary: record.summary,
      evidence: record.evidence.map(reference => ({ ...reference })),
      ...record.stageId === undefined ? {} : { stageId: record.stageId },
    })
    await this.#flush()
  }

  /**
   * Record one circuit transition.
   * @param executor - The executor whose circuit moved.
   * @param from - The state it left.
   * @param to - The state it entered.
   * @param reason - Machine-readable cause, e.g. `failure:usage-limit-exceeded`.
   */
  circuitBreaker(
    executor: string,
    from: 'AVAILABLE' | 'DEGRADED',
    to: 'AVAILABLE' | 'DEGRADED',
    reason: string,
  ): void {
    this.#session.append('harness/circuit-breaker', {
      workflowId: this.#workflowId,
      executor,
      from,
      to,
      reason,
    })
  }

  /**
   * Record that the workflow stopped, durably.
   * @param state - How it stopped.
   * @param verdict - The verdict it stopped on.
   * @param summary - One bounded sentence.
   */
  async end(state: WorkflowEndState, verdict: WorkflowVerdict, summary: string): Promise<void> {
    this.#session.append('harness/workflow-end', {
      workflowId: this.#workflowId,
      state,
      verdict,
      summary,
    })
    await this.#flush()
  }
}

/** A `harness/*` event narrowed to its payload, which always names a workflow. */
type HarnessPayload = { workflowId: string } & Record<string, unknown>

/** Read one event's payload, refusing a harness type this build cannot interpret. */
function harnessPayload(event: SessionEvent): HarnessPayload | undefined {
  if (!event.type.startsWith('harness/')) return undefined
  if (!isHarnessEventType(event.type)) {
    // Skipping it would reconstruct a workflow with a fact missing and no sign
    // that anything was missing — the failure mode the whole journal exists to
    // rule out.
    throw new JournalError('unknown-event', `event type ${JSON.stringify(event.type)} is not a known harness event`)
  }
  return event.data as HarnessPayload
}

/** Mutable accumulator behind {@link projectWorkflow}. */
interface Projected {
  objective?: WorkflowProjection['objective']
  routes: RouteRecord[]
  findings: Finding[]
  diagnoses: DiagnosisContract[]
  verdicts: VerdictRecord[]
  deliveries: DeliveryRecord[]
  blockers: BlockerRecord[]
  circuits: Record<string, 'AVAILABLE' | 'DEGRADED'>
  started: string[]
  ended: string[]
  end?: WorkflowProjection['end']
}

/** Fold one event into the accumulator. */
function fold(state: Projected, type: HarnessEventType, data: HarnessPayload): void {
  switch (type) {
    case 'harness/workflow-start': {
      const payload = data as unknown as { objectiveId: string; profileId: string; cwd: string; requirement: string; risk: WorkflowObjective['risk']; workload: WorkflowObjective['workload'] }
      state.objective = {
        id: payload.objectiveId,
        cwd: payload.cwd,
        requirement: payload.requirement,
        risk: payload.risk,
        workload: payload.workload,
        profileId: payload.profileId,
      }
      return
    }
    case 'harness/route-decision': {
      const payload = data as unknown as RouteRecord
      state.routes.push({
        stageId: payload.stageId,
        role: payload.role,
        executor: payload.executor,
        resolvedModel: payload.resolvedModel,
        permissionMode: payload.permissionMode,
        reasonCodes: payload.reasonCodes,
        policyVersion: payload.policyVersion,
      })
      return
    }
    case 'harness/route-fallback': {
      const payload = data as unknown as { stageId: string; requestedExecutor: string }
      for (let index = state.routes.length - 1; index >= 0; index -= 1) {
        const route = state.routes[index]
        if (route !== undefined && route.stageId === payload.stageId) {
          state.routes[index] = { ...route, fallbackFrom: payload.requestedExecutor }
          break
        }
      }
      return
    }
    case 'harness/executor-start': {
      state.started.push((data as unknown as { stageId: string }).stageId)
      return
    }
    case 'harness/executor-end': {
      state.ended.push((data as unknown as { stageId: string }).stageId)
      return
    }
    case 'harness/finding': {
      state.findings.push((data as unknown as { finding: Finding }).finding)
      return
    }
    case 'harness/diagnosis': {
      state.diagnoses.push((data as unknown as { diagnosis: DiagnosisContract }).diagnosis)
      return
    }
    case 'harness/verdict': {
      const { workflowId: _id, ...record } = data
      state.verdicts.push(record as unknown as VerdictRecord)
      return
    }
    case 'harness/delivery': {
      const { workflowId: _id, ...record } = data
      state.deliveries.push(record as unknown as DeliveryRecord)
      return
    }
    case 'harness/blocker': {
      const { workflowId: _id, ...record } = data
      state.blockers.push(record as unknown as BlockerRecord)
      return
    }
    case 'harness/circuit-breaker': {
      const payload = data as unknown as { executor: string; to: 'AVAILABLE' | 'DEGRADED' }
      state.circuits[payload.executor] = payload.to
      return
    }
    case 'harness/workflow-end': {
      const { workflowId: _id, ...record } = data
      state.end = record as unknown as WorkflowProjection['end']
    }
  }
}

/**
 * Rebuild one workflow's state from a session's event log.
 *
 * The projection reads `harness/*` events and nothing else, so pruning tool
 * results or compacting the conversation cannot remove a finding, a diagnosis,
 * or the evidence a verdict rests on. It also never treats a `harness/*` type
 * it does not recognise as noise: a log written by a harness that knew more
 * than this one is a log this one cannot honestly reconstruct.
 * @param events - The session's events, in log order.
 * @param workflowId - The workflow to project; other workflows are ignored.
 * @returns The reconstructed state, with in-flight stages named.
 * @throws {JournalError} when the log holds a `harness/*` type this build does not know.
 */
export function projectWorkflow(events: readonly SessionEvent[], workflowId: string): WorkflowProjection {
  const state: Projected = {
    routes: [],
    findings: [],
    diagnoses: [],
    verdicts: [],
    deliveries: [],
    blockers: [],
    circuits: {},
    started: [],
    ended: [],
  }
  for (const event of events) {
    const data = harnessPayload(event)
    if (data === undefined || data.workflowId !== workflowId) continue
    fold(state, event.type as HarnessEventType, data)
  }
  const ended = [...state.ended]
  const openStages = state.started.filter((stageId) => {
    const index = ended.indexOf(stageId)
    if (index === -1) return true
    ended.splice(index, 1)
    return false
  })
  return Object.freeze({
    workflowId,
    routes: Object.freeze(state.routes),
    findings: Object.freeze(state.findings),
    diagnoses: Object.freeze(state.diagnoses),
    verdicts: Object.freeze(state.verdicts),
    deliveries: Object.freeze(state.deliveries),
    blockers: Object.freeze(state.blockers),
    circuits: Object.freeze(state.circuits),
    openStages: Object.freeze(openStages),
    executorStarts: state.started.length,
    ...state.objective === undefined ? {} : { objective: state.objective },
    ...state.end === undefined ? {} : { end: state.end },
  })
}
