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
  ConformanceStatusSummary,
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
  CapabilityOutcome,
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
  'harness/capability-start',
  'harness/capability-end',
  'harness/finding',
  'harness/diagnosis',
  'harness/verdict',
  'harness/delivery',
  'harness/blocker',
  'harness/conformance',
  'harness/circuit-breaker',
  'harness/workflow-end',
] as const

/** One event type this journal writes. */
export type HarnessEventType = typeof HARNESS_EVENT_TYPES[number]

/** A journal operation that cannot be completed as asked. */
export class JournalError extends Error {
  /** Machine-readable cause, so a caller can branch without parsing prose. */
  readonly code: 'unknown-event' | 'foreign-workflow' | 'flush-failed'

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
  readonly objective?:
    & Pick<WorkflowObjective, 'id' | 'cwd' | 'requirement' | 'risk' | 'workload' | 'profileId'>
    & Pick<WorkflowObjective, 'approvedArtifacts'>
  /**
   * The latest conformance reading this log holds, bounded.
   *
   * The latest rather than every one: a repair after a reading invalidates it,
   * so the standing answer for the branch is the last one written.
   */
  readonly conformance?: ConformanceStatusSummary
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
  /**
   * Capability runs started but never ended, as `stageId:capability`.
   *
   * The deterministic half of the same question `openStages` asks. A GitHub
   * push or a Supabase branch apply that began and never reported back may have
   * changed the world, and the log's job is to say so rather than to guess.
   */
  readonly openCapabilities: readonly string[]
  readonly executorStarts: number
  /** Absent while the workflow is still in flight. */
  readonly end?: { readonly state: WorkflowEndState; readonly verdict: WorkflowVerdict; readonly summary: string }
}

/**
 * Force a durable checkpoint, so an append survives losing the process.
 *
 * Resolving `false` is a refusal, not a hint: the journal treats it exactly as
 * it treats a rejection, because a checkpoint that did not happen is the same
 * fact either way and the work that was waiting on it must not proceed.
 */
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
      specPath: objective.approvedArtifacts.spec.path,
      specSha256: objective.approvedArtifacts.spec.sha256,
      planPath: objective.approvedArtifacts.plan.path,
      planSha256: objective.approvedArtifacts.plan.sha256,
    })
  }

  /**
   * Record one conformance reading.
   *
   * Rebuilt field by field like every other payload, and for the sharpest
   * version of the usual reason: the caller's summary is derived from a
   * provider's answer about the approved documents, and a spread would carry
   * whatever else that answer arrived attached to into a durable log.
   * @param summary - The bounded reading.
   */
  conformance(summary: ConformanceStatusSummary): void {
    this.#session.append('harness/conformance', {
      workflowId: this.#workflowId,
      specPath: summary.specPath,
      specSha256: summary.specSha256,
      planPath: summary.planPath,
      planSha256: summary.planSha256,
      expected: { spec: summary.expected.spec, plan: summary.expected.plan, dod: summary.expected.dod },
      counts: {
        PASS: summary.counts.PASS,
        MISSING: summary.counts.MISSING,
        PARTIAL: summary.counts.PARTIAL,
        FAIL: summary.counts.FAIL,
        BLOCKED: summary.counts.BLOCKED,
        INCONCLUSIVE: summary.counts.INCONCLUSIVE,
      },
      verdict: summary.verdict,
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
    await this.#durable()
  }

  /**
   * Checkpoint, refusing to report a durability that did not happen.
   *
   * Everything a caller does after an `await` on one of this journal's durable
   * methods is allowed to assume the fact survives the process. A flush that
   * failed quietly would turn that assumption into the one thing the journal
   * exists to prevent: a restart reasoning about a world it has no record of.
   * @throws {JournalError} when the checkpoint did not happen.
   */
  async #durable(): Promise<void> {
    let flushed: unknown
    try {
      flushed = await this.#flush()
    } catch (cause) {
      throw new JournalError('flush-failed', `the journal could not reach a durable checkpoint: ${
        cause instanceof Error ? cause.message : 'the flush rejected'
      }`)
    }
    if (flushed === false) {
      throw new JournalError('flush-failed', 'the journal could not reach a durable checkpoint')
    }
  }

  /**
   * Record the route and the start of one executor run, durably.
   *
   * The barrier every dispatch passes through. Both facts are appended and the
   * checkpoint is awaited before this resolves, so a caller that starts a
   * provider only after it resolves cannot have mutated a working tree the log
   * has no record of authorising. A failed checkpoint throws rather than
   * warning: the work is stopped, because the alternative is a run whose
   * effects nobody can attribute after a restart.
   * @param dispatch - The stage and the decision it runs on.
   * @throws {JournalError} when the checkpoint did not happen.
   */
  async beginExecutor(dispatch: StageDispatch): Promise<void> {
    this.routeDecision(dispatch)
    this.executorStart(dispatch)
    await this.#durable()
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
   * Record that a deterministic capability began work, durably.
   *
   * Flushed before the capability is allowed to act, for the same reason an
   * executor start is: a push that happened with no record of having been
   * started is a mutation a restart cannot attribute, and re-running it is how
   * one commit becomes two.
   * @param stageId - The stage the capability is working for.
   * @param capability - Which capability, e.g. `github-delivery`.
   * @param mutationPossible - Whether this work could change the world.
   * @throws {JournalError} when the checkpoint did not happen.
   */
  async beginCapability(stageId: string, capability: string, mutationPossible: boolean): Promise<void> {
    this.#session.append('harness/capability-start', {
      workflowId: this.#workflowId,
      stageId,
      capability,
      mutationPossible,
    })
    await this.#durable()
  }

  /**
   * Record that a deterministic capability finished, durably.
   *
   * No command output, no connection string, no token: what is kept is that it
   * ran, how it stopped, and how long it took.
   * @param stageId - The stage the capability was working for.
   * @param capability - Which capability finished.
   * @param status - How it stopped.
   * @param durationMs - Wall-clock duration.
   * @param failureClass - The classified failure, when it had one.
   * @throws {JournalError} when the checkpoint did not happen.
   */
  async endCapability(
    stageId: string,
    capability: string,
    status: CapabilityOutcome,
    durationMs: number,
    failureClass?: string,
  ): Promise<void> {
    this.#session.append('harness/capability-end', {
      workflowId: this.#workflowId,
      stageId,
      capability,
      status,
      durationMs,
      ...failureClass === undefined ? {} : { failureClass },
    })
    await this.#durable()
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
    await this.#durable()
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
    await this.#durable()
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
    await this.#durable()
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
    await this.#durable()
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
    await this.#durable()
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
  conformance?: ConformanceStatusSummary
  routes: RouteRecord[]
  findings: Finding[]
  diagnoses: DiagnosisContract[]
  verdicts: VerdictRecord[]
  deliveries: DeliveryRecord[]
  blockers: BlockerRecord[]
  circuits: Record<string, 'AVAILABLE' | 'DEGRADED'>
  started: string[]
  ended: string[]
  capabilityStarted: string[]
  capabilityEnded: string[]
  end?: WorkflowProjection['end']
}

/** Fold one event into the accumulator. */
function fold(state: Projected, type: HarnessEventType, data: HarnessPayload): void {
  switch (type) {
    case 'harness/workflow-start': {
      const payload = data as unknown as { objectiveId: string; profileId: string; cwd: string; requirement: string; risk: WorkflowObjective['risk']; workload: WorkflowObjective['workload']; specPath: string; specSha256: string; planPath: string; planSha256: string }
      state.objective = {
        id: payload.objectiveId,
        cwd: payload.cwd,
        requirement: payload.requirement,
        risk: payload.risk,
        workload: payload.workload,
        profileId: payload.profileId,
        approvedArtifacts: {
          spec: { path: payload.specPath, sha256: payload.specSha256 },
          plan: { path: payload.planPath, sha256: payload.planSha256 },
        },
      }
      return
    }
    case 'harness/conformance': {
      const payload = data as unknown as ConformanceStatusSummary
      state.conformance = {
        specPath: payload.specPath,
        specSha256: payload.specSha256,
        planPath: payload.planPath,
        planSha256: payload.planSha256,
        expected: payload.expected,
        counts: payload.counts,
        verdict: payload.verdict,
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
    case 'harness/capability-start': {
      const payload = data as unknown as { stageId: string; capability: string }
      state.capabilityStarted.push(`${payload.stageId}:${payload.capability}`)
      return
    }
    case 'harness/capability-end': {
      const payload = data as unknown as { stageId: string; capability: string }
      state.capabilityEnded.push(`${payload.stageId}:${payload.capability}`)
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
 * The starts no end accounts for, pairing one end to one start.
 *
 * Counted rather than set-subtracted, because the same stage may run the same
 * capability twice: two starts and one end leave one window open, and a set
 * difference would report none.
 * @param starts - The start keys, in log order.
 * @param ends - The end keys, in log order.
 * @returns The starts still unaccounted for.
 */
function unmatched(starts: readonly string[], ends: readonly string[]): string[] {
  const remaining = [...ends]
  return starts.filter((key) => {
    const index = remaining.indexOf(key)
    if (index === -1) return true
    remaining.splice(index, 1)
    return false
  })
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
    capabilityStarted: [],
    capabilityEnded: [],
  }
  for (const event of events) {
    const data = harnessPayload(event)
    if (data === undefined || data.workflowId !== workflowId) continue
    fold(state, event.type as HarnessEventType, data)
  }
  const openStages = unmatched(state.started, state.ended)
  const openCapabilities = unmatched(state.capabilityStarted, state.capabilityEnded)
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
    openCapabilities: Object.freeze(openCapabilities),
    executorStarts: state.started.length,
    ...state.objective === undefined ? {} : { objective: state.objective },
    ...state.conformance === undefined ? {} : { conformance: state.conformance },
    ...state.end === undefined ? {} : { end: state.end },
  })
}
