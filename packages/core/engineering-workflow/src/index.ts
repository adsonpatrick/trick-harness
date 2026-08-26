/**
 * The deterministic engineering workflow runtime.
 *
 * One objective becomes a fixed stage plan, each stage is routed by policy,
 * dispatched to an executor, and reduced to compact facts. The runtime owns
 * exactly one live run and the signal that ends it, writes every observable
 * fact to the durable journal as it happens, and refuses to keep going past the
 * budgets the profile set.
 *
 * @packageDocumentation
 */

import { READ_ONLY_ROLES } from '@trick-harness/contracts'
import type {
  EvidenceRef,
  Finding,
  Role,
  RoutedPermissionMode,
  StageResult,
  WorkflowObjective,
  WorkflowVerdict,
  WriteVolume,
} from '@trick-harness/contracts'
import { dispatchableRoute } from '@trick-harness/executor'
import type { ExecutorResult, HarnessExecutorRuntime, ReasoningEffort } from '@trick-harness/executor'
import type { WorkflowJournal, WorkflowProjection } from '@trick-harness/journal'
import type { BlockerKind, WorkflowEndState } from '@trick-harness/journal'
import type { HarnessProfile } from '@trick-harness/profile'
import { route } from '@trick-harness/routing'
import type { RoutingPolicy } from '@trick-harness/routing'
import type { RoutingContext } from '@trick-harness/contracts'

export type * from './types.ts'

import type {
  RestartAssessment,
  StageFacts,
  StageSpec,
  WorkflowOutcome,
  WorkflowRunRequest,
} from './types.ts'

/** Something the runtime refuses to do, named so a caller can tell them apart. */
export class WorkflowError extends Error {
  /** Machine-readable cause. */
  readonly code: 'run-in-progress' | 'disposed' | 'unroutable'

  /**
   * @param code - Machine-readable cause.
   * @param message - What was refused, stated without quoting caller data.
   */
  constructor(code: WorkflowError['code'], message: string) {
    super(message)
    this.name = 'WorkflowError'
    this.code = code
  }
}

/**
 * The filesystem authority a role gets, derived from the role and nothing else.
 *
 * A reviewer that could edit would be reviewing its own work and a debugger
 * that could edit would have turned diagnosis into repair, so this is a fact
 * about the role rather than a setting a run may choose. The router refuses a
 * policy row that disagrees; this is the same rule stated where the runtime
 * builds its request.
 * @param role - The role the stage runs as.
 * @returns The permission mode the provider must be started in.
 */
export function permissionModeFor(role: Role): RoutedPermissionMode {
  return READ_ONLY_ROLES.includes(role) ? 'read-only' : 'workspace-write'
}

/** How much of the tree a role is expected to touch, for the routing table. */
function writeVolumeFor(role: Role): WriteVolume {
  if (permissionModeFor(role) === 'read-only') return 'none'
  return role === 'delivery' ? 'small' : 'medium'
}

/**
 * The stages one objective runs, decided before anything is dispatched.
 *
 * The plan is a function of the objective's risk alone, so the same objective
 * plans the same way on every machine and in every replay. Higher risk adds
 * certification rather than changing what implementation does: a review at
 * high, and a security stage on top of it at critical.
 * @param objective - The approved objective.
 * @returns The stages in the order they will run.
 */
export function planStages(objective: WorkflowObjective): readonly StageSpec[] {
  const stages: StageSpec[] = [
    { stageId: 'implement-1', role: 'implement' },
    { stageId: 'verify-1', role: 'verify' },
  ]
  if (objective.risk === 'high' || objective.risk === 'critical') {
    stages.push({ stageId: 'review-1', role: 'review' })
  }
  if (objective.risk === 'critical') {
    stages.push({ stageId: 'security-1', role: 'security' })
  }
  stages.push({ stageId: 'delivery-1', role: 'delivery' })
  return Object.freeze(stages)
}

/** The blocker a stage's own findings say it is. */
function blockerKindOf(findings: readonly Finding[]): BlockerKind {
  if (findings.some(finding => finding.class === 'PRODUCT_DECISION')) return 'product-decision'
  if (findings.some(finding => finding.class === 'DESIGN_DECISION')) return 'design-decision'
  return 'external'
}

/**
 * What a restart may conclude about a workflow it finds in a durable log.
 *
 * A workflow with no recorded end did not fail — nobody observed it fail. It is
 * interrupted and inconclusive, and the difference matters: a failed run may be
 * retried on its record, while an interrupted one may not, because a stage that
 * was in flight or a delivery that was recorded may have changed the world in
 * ways the log cannot settle. Those cases demand the world be re-read before
 * anything is retried, which is a thing only the caller can do.
 * @param projection - The workflow rebuilt from its durable events.
 * @returns What is known, and whether the world must be checked first.
 */
export function assessRestart(projection: WorkflowProjection): RestartAssessment {
  const { end } = projection
  const interrupted = projection.openStages.length > 0
  const mutated = projection.deliveries.length > 0
  if (end !== undefined) {
    return Object.freeze({
      state: 'terminal' as const,
      verdict: end.verdict,
      openStages: Object.freeze([]),
      requiresWorldVerification: false,
      summary: end.summary,
    })
  }
  const reasons: string[] = []
  if (interrupted) reasons.push(`stages still open: ${projection.openStages.join(', ')}`)
  for (const delivery of projection.deliveries) reasons.push(`recorded ${delivery.action} on ${delivery.branch}`)
  return Object.freeze({
    state: 'interrupted' as const,
    verdict: 'INCONCLUSIVE' as const,
    openStages: projection.openStages,
    requiresWorldVerification: interrupted || mutated,
    summary: reasons.length === 0
      ? 'workflow ended without a recorded terminal state and left no observed effect'
      : `workflow was interrupted; verify the world before retrying — ${reasons.join('; ')}`,
  })
}

/** Everything the runtime needs, supplied once when the runner is built. */
export interface WorkflowRuntimeOptions {
  readonly profile: HarnessProfile
  readonly policy: RoutingPolicy
  readonly executors: HarnessExecutorRuntime
  readonly journal: WorkflowJournal
  /** Executors the breaker has marked degraded for this run. */
  readonly degradedExecutors?: readonly string[]
  /** Injectable clock, so a stage's duration is measurable in a test. */
  readonly now?: () => number
}

/** One stage's dispatch, after routing and before the executor is asked. */
interface Dispatched {
  readonly facts: StageFacts
  readonly canceled: boolean
  readonly failed: boolean
}

/**
 * Owner of one workflow's lifecycle.
 *
 * A runner owns at most one live run and the `AbortController` that ends it.
 * That is the whole of the ownership rule: cancellation and disposal have one
 * place to reach, and a second concurrent run is refused rather than allowed to
 * interleave two stage plans over the same working tree.
 */
export class WorkflowRunner {
  readonly #workflowId: string
  readonly #options: WorkflowRuntimeOptions
  readonly #now: () => number
  #controller: AbortController | undefined
  #disposed = false

  /**
   * @param workflowId - The id every journal event is written under.
   * @param options - Policy, executors and the journal this run writes to.
   */
  constructor(workflowId: string, options: WorkflowRuntimeOptions) {
    this.#workflowId = workflowId
    this.#options = options
    this.#now = options.now ?? (() => Date.now())
  }

  /**
   * Whether a run is currently owned by this runner.
   * @returns True while this runner owns a live run and the signal that ends it.
   */
  isRunning(): boolean {
    return this.#controller !== undefined
  }

  /**
   * End the live run, if there is one.
   * @param reason - Why, recorded as the abort reason the provider sees.
   */
  cancel(reason: string): void {
    this.#controller?.abort(new WorkflowError('run-in-progress', reason))
  }

  /**
   * Release the runner and end anything it owns.
   *
   * Disposal terminates the run rather than detaching from it: a runner that
   * let go of a live executor would leave a process nobody owns writing to the
   * tree the next run is about to read.
   */
  dispose(): void {
    this.#disposed = true
    this.cancel('runner disposed')
  }

  /**
   * Run one objective to a terminal state.
   * @param request - The objective, its interpreter and its task text.
   * @returns What each stage contributed and how the run ended.
   * @throws {WorkflowError} when the runner is disposed or already running.
   */
  async run(request: WorkflowRunRequest): Promise<WorkflowOutcome> {
    if (this.#disposed) throw new WorkflowError('disposed', 'this workflow runner has been disposed')
    if (this.#controller !== undefined) {
      throw new WorkflowError('run-in-progress', 'this workflow runner already owns a live run')
    }
    const controller = new AbortController()
    this.#controller = controller
    try {
      return await this.#drive(request, controller.signal)
    } finally {
      this.#controller = undefined
    }
  }

  /** Walk the stage queue until something terminal happens. */
  async #drive(request: WorkflowRunRequest, signal: AbortSignal): Promise<WorkflowOutcome> {
    const { objective } = request
    const { journal, profile } = this.#options
    const { maxRepairCycles, maxExecutorStarts } = profile.workflowPolicy

    journal.start(objective)
    const queue = [...planStages(objective)]
    const stages: StageFacts[] = []
    let repairCycles = 0
    let executorStarts = 0
    let verifications = 1

    while (queue.length > 0) {
      const stage = queue.shift() as StageSpec
      if (executorStarts >= maxExecutorStarts) {
        return await this.#blocked(
          objective, stages, repairCycles, executorStarts, 'budget-exhausted',
          `the run reached its ${maxExecutorStarts} executor-start budget before ${stage.role} could run`,
        )
      }

      executorStarts += 1
      const dispatched = await this.#dispatch(stage, request, signal, repairCycles)
      stages.push(dispatched.facts)

      if (dispatched.canceled) {
        return await this.#end(objective, stages, repairCycles, executorStarts, 'canceled', 'INCONCLUSIVE',
          `the run was canceled during ${stage.role}`)
      }
      if (dispatched.failed) {
        return await this.#end(objective, stages, repairCycles, executorStarts, 'failed', 'FAIL',
          dispatched.facts.summary)
      }

      const { verdict } = dispatched.facts
      if (verdict === 'BLOCKED') {
        const kind = blockerKindOf(dispatched.facts.findings)
        await journal.blocker({
          stageId: stage.stageId,
          kind,
          summary: dispatched.facts.summary,
          evidence: dispatched.facts.evidence,
        })
        return await this.#end(objective, stages, repairCycles, executorStarts, 'blocked', 'BLOCKED',
          dispatched.facts.summary)
      }

      if (verdict === 'FAIL' || verdict === 'PARTIAL') {
        if (stage.role !== 'verify') {
          return await this.#end(objective, stages, repairCycles, executorStarts, 'failed', 'FAIL',
            dispatched.facts.summary)
        }
        if (repairCycles >= maxRepairCycles) {
          return await this.#blocked(
            objective, stages, repairCycles, executorStarts, 'budget-exhausted',
            `verification still fails after ${maxRepairCycles} repair cycles; a person has to look`,
          )
        }
        repairCycles += 1
        verifications += 1
        queue.unshift(
          { stageId: `repair-${repairCycles}`, role: 'repair' },
          { stageId: `verify-${verifications}`, role: 'verify' },
        )
        continue
      }

      // The remaining verdicts are PASS and INCONCLUSIVE. INCONCLUSIVE from a
      // certifying stage is not a pass, and is not a defect either — there is
      // nothing to repair, so the run stops with what it knows.
      if (verdict === 'INCONCLUSIVE') {
        return await this.#end(objective, stages, repairCycles, executorStarts, 'failed', 'INCONCLUSIVE',
          dispatched.facts.summary)
      }
    }

    return await this.#end(objective, stages, repairCycles, executorStarts, 'completed', 'PASS',
      `all ${stages.length} stages passed`)
  }

  /** Route, start, and reduce one stage to facts. */
  async #dispatch(
    stage: StageSpec,
    request: WorkflowRunRequest,
    signal: AbortSignal,
    priorAttempts: number,
  ): Promise<Dispatched> {
    const { journal, executors, policy } = this.#options
    const context = this.#routingContext(stage, request, priorAttempts)
    const decision = route(context, policy)
    const dispatch = { stageId: stage.stageId, role: stage.role, decision }

    journal.routeDecision(dispatch)
    if (decision.fallbackFrom !== undefined) {
      await journal.routeFallback(dispatch, 'executor-unavailable', {
        independence: READ_ONLY_ROLES.includes(stage.role) ? 'reduced' : 'preserved',
        assurance: READ_ONLY_ROLES.includes(stage.role) ? 'lowered' : 'unchanged',
      })
    }

    const provider = executors.get(decision.executor)
    const { route: executorRoute } = dispatchableRoute(provider, {
      executor: decision.executor,
      model: decision.resolvedModel,
      permissionMode: decision.permissionMode,
      ...decision.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: decision.reasoningEffort as ReasoningEffort },
    })

    journal.executorStart(dispatch)
    const startedAt = this.#now()
    const result = await executors.start({
      cwd: request.objective.cwd,
      task: request.task(stage, request.objective),
      route: executorRoute,
      signal,
    })
    const durationMs = Math.max(0, this.#now() - startedAt)

    return await this.#reduce(stage, decision.executor, decision.permissionMode, result, durationMs, request)
  }

  /** Turn one provider result into the compact facts the run carries forward. */
  async #reduce(
    stage: StageSpec,
    executor: string,
    permissionMode: RoutedPermissionMode,
    result: ExecutorResult,
    durationMs: number,
    request: WorkflowRunRequest,
  ): Promise<Dispatched> {
    const { journal } = this.#options

    if (result.status === 'aborted') {
      journal.executorEnd(stage.stageId, executor, 'canceled', durationMs)
      return {
        facts: facts(stage, executor, permissionMode, 'INCONCLUSIVE', 'the stage was canceled', [], [], durationMs),
        canceled: true,
        failed: false,
      }
    }

    if (result.status === 'error') {
      const failure = result.failure
      journal.executorEnd(stage.stageId, executor, 'failed', durationMs, failure?.category)
      const summary = failure?.safeDiagnostic ?? 'the executor failed without a diagnostic'
      await journal.verdict(stage.stageId, stage.role, 'FAIL', summary, [])
      return {
        facts: facts(stage, executor, permissionMode, 'FAIL', summary, [], [], durationMs),
        canceled: false,
        failed: true,
      }
    }

    journal.executorEnd(stage.stageId, executor, 'completed', durationMs)
    const interpreted: StageResult = request.interpret(stage, executor, result)
    for (const finding of interpreted.findings) journal.finding(stage.stageId, finding)
    await journal.verdict(
      stage.stageId, stage.role, interpreted.verdict, interpreted.summary, interpreted.evidence,
    )
    return {
      facts: facts(
        stage, executor, permissionMode, interpreted.verdict, interpreted.summary,
        interpreted.findings, interpreted.evidence, durationMs,
      ),
      canceled: false,
      failed: false,
    }
  }

  /** The routing context one stage presents, built from the role and profile. */
  #routingContext(stage: StageSpec, request: WorkflowRunRequest, priorAttempts: number): RoutingContext {
    const { objective } = request
    const { profile, degradedExecutors = [] } = this.#options
    const implementer = request.implementationExecutor
    return {
      role: stage.role,
      workload: objective.workload,
      risk: objective.risk,
      writeVolume: writeVolumeFor(stage.role),
      independenceRequirement: profile.independencePolicy[objective.risk],
      priorAttempts,
      priorRouteFailures: Object.freeze([]),
      degradedExecutors,
      requiredCapabilities: Object.freeze([]),
      ...implementer === undefined || !READ_ONLY_ROLES.includes(stage.role)
        ? {}
        : { implementationExecutor: implementer },
    }
  }

  /** Record a blocker and finish. */
  async #blocked(
    objective: WorkflowObjective,
    stages: readonly StageFacts[],
    repairCycles: number,
    executorStarts: number,
    kind: BlockerKind,
    summary: string,
  ): Promise<WorkflowOutcome> {
    await this.#options.journal.blocker({ kind, summary, evidence: [] })
    return await this.#end(objective, stages, repairCycles, executorStarts, 'blocked', 'BLOCKED', summary)
  }

  /** Write the terminal event and hand back the outcome. */
  async #end(
    objective: WorkflowObjective,
    stages: readonly StageFacts[],
    repairCycles: number,
    executorStarts: number,
    state: WorkflowEndState,
    verdict: WorkflowVerdict,
    summary: string,
  ): Promise<WorkflowOutcome> {
    await this.#options.journal.end(state, verdict, summary)
    return Object.freeze({
      workflowId: this.#workflowId,
      objectiveId: objective.id,
      state,
      verdict,
      summary,
      stages: Object.freeze([...stages]),
      repairCycles,
      executorStarts,
    })
  }
}

/** Build one stage's facts, field by field, so nothing else can ride along. */
function facts(
  stage: StageSpec,
  executor: string,
  permissionMode: RoutedPermissionMode,
  verdict: WorkflowVerdict,
  summary: string,
  findings: readonly Finding[],
  evidence: readonly EvidenceRef[],
  durationMs: number,
): StageFacts {
  return Object.freeze({
    stageId: stage.stageId,
    role: stage.role,
    executor,
    permissionMode,
    verdict,
    summary,
    findings: Object.freeze(findings.map(finding => Object.freeze({
      id: finding.id,
      class: finding.class,
      raisedBy: finding.raisedBy,
      summary: finding.summary,
      confirmed: finding.confirmed,
      evidence: Object.freeze(finding.evidence.map(reference => Object.freeze({ ...reference }))),
    }))),
    evidence: Object.freeze(evidence.map(reference => Object.freeze({ ...reference }))),
    durationMs,
  })
}
