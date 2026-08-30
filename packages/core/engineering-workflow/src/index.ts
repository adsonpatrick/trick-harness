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

import { ChangeImpactError, classifyChangeImpact, mergeChangeImpact } from '@trick-harness/change-impact'
import { READ_ONLY_ROLES, parseConformanceContract, summarizeChangeImpact } from '@trick-harness/contracts'
import type {
  ChangeImpactFacts,
  ChangeImpactSource,
  ChangeImpactStatusSummary,
  ConformanceManifest,
  ConformanceStatusSummary,
  DiagnosisContract,
  EffectiveChangeImpact,
  EvidenceRef,
  Finding,
  Risk,
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
import {
  RoutingError,
  capVerdict,
  degradedExecutors as degradedIn,
  disablesExecutor,
  isAvailabilityFailure,
  openCircuit,
  recordFailure,
  recordSuccess,
  route,
} from '@trick-harness/routing'
import type { ExecutorCircuit, RoutingPolicy } from '@trick-harness/routing'
import type { RouteDecision, RoutingContext, StageRouteOverride } from '@trick-harness/contracts'

export type * from './types.ts'
// The one value in `types.ts`: the certification vocabulary is checked
// against at runtime, not only referred to in a signature.
export { EXTERNAL_CERTIFICATION_STATES } from './types.ts'
export * from './repair.ts'
export * from './triage.ts'
export * from './lifecycle.ts'
export * from './impact-policy.ts'
export * from './conformance.ts'

import {
  assessRepairCompletion,
  authorizeRepair,
  isMechanicallyObvious,
  RepairError,
  validateDiagnosis,
} from './repair.ts'
import type { RepairAuthorization, RepairEvidence } from './repair.ts'
import { certificationDecision, externalCertificationState, planPullRequestStages } from './lifecycle.ts'
import {
  impactRoutingFacts,
  planPullRequestCertificationStages,
  planPullRequestImplementationStages,
  applyCertificationRequirements,
  resolveCertificationRequirements,
  retainStrongerImpact,
} from './impact-policy.ts'
import {
  ConformanceError,
  buildConformanceManifest,
  summarizeConformance,
  validateConformanceCoverage,
} from './conformance.ts'
import type { ApprovedArtifactTexts } from './types.ts'
import { CERTIFYING_ROLES, reconcileVerdict, triage } from './triage.ts'

import type {
  CertificationCapabilityPort,
  ChangeImpactReader,
  ExternalCertificationState,
  DatabaseVerificationCapabilityPort,
  DeliveryCapabilityPort,
  RestartAssessment,
  StageFacts,
  StageSpec,
  WorkflowCapabilities,
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
 * The default lifecycle is pull-request centric: the branch is delivered as
 * soon as implementation verifies, and every certifying stage after that reads
 * the same published diff a person would. A review of an unpublished working
 * tree reviews something nobody else can see, and a repair that follows one is
 * re-delivered before it is re-read.
 *
 * The plan is a function of the objective's risk alone, so the same objective
 * plans the same way on every machine and in every replay. Higher risk adds
 * certification rather than changing what implementation does: QA from medium,
 * a security stage at critical. Whatever ran, the run ends on a fresh
 * verification, so nothing is called ready on a reading taken before the last
 * repair.
 *
 * A database change adds no stage here. The isolated preview is a capability
 * the delivery stage runs before it publishes, not a stage a model could be
 * routed to.
 * @param objective - The approved objective.
 * @returns The stages in the order they will run.
 */
export function planStages(objective: WorkflowObjective): readonly StageSpec[] {
  return planPullRequestStages(objective)
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
  // A capability that began and never reported back counts the same as an open
  // stage: the difference between the two is who was holding the tool, not
  // whether the world may have moved while nobody was recording it.
  const interrupted = projection.openStages.length > 0 || projection.openCapabilities.length > 0
  const mutated = projection.deliveries.length > 0
  // An id, not a fallback to the execution id: a projection with no start
  // event is not a workflow this harness can speak for, and `restartOf` refuses
  // it before ever reaching here.
  const identity = {
    workflowId: projection.workflowId,
    objectiveId: projection.objective?.id ?? projection.workflowId,
  }
  if (end !== undefined) {
    return Object.freeze({
      ...identity,
      state: 'terminal' as const,
      verdict: end.verdict,
      openStages: Object.freeze([]),
      requiresWorldVerification: false,
      summary: end.summary,
    })
  }
  const reasons: string[] = []
  if (projection.openStages.length > 0) reasons.push(`stages still open: ${projection.openStages.join(', ')}`)
  if (projection.openCapabilities.length > 0) {
    reasons.push(`capabilities still open: ${projection.openCapabilities.join(', ')}`)
  }
  for (const delivery of projection.deliveries) reasons.push(`recorded ${delivery.action} on ${delivery.branch}`)
  return Object.freeze({
    ...identity,
    state: 'interrupted' as const,
    verdict: 'INCONCLUSIVE' as const,
    openStages: projection.openStages,
    requiresWorldVerification: interrupted || mutated,
    summary: reasons.length === 0
      ? 'workflow ended without a recorded terminal state and left no observed effect'
      : `workflow was interrupted; verify the world before retrying — ${reasons.join('; ')}`,
  })
}

/**
 * What one workflow learns about its executors while it runs.
 *
 * Scoped to a single `run` rather than to the runner, because an outage is a
 * fact about a window of time and not about the process. A map living on the
 * runner would let a quota ceiling hit at nine in the morning still be routing
 * work away from an executor that recovered hours ago, and nothing in a later
 * run would ever look at it again to find out.
 */
/**
 * Every executor name the policy can produce.
 *
 * Read from the table rather than from a list someone maintains beside it, so a
 * new row naming a new product needs no second edit here to be checked.
 * @param policy - the resolved routing policy.
 * @returns the distinct executor names the table may route to.
 */
function executorNames(policy: RoutingPolicy): readonly string[] {
  const named = [...policy.rules, ...policy.fallbackRules]
    .map(rule => rule.use.executor)
    .filter((name): name is string => typeof name === 'string')
  return [...new Set(named)]
}

interface AvailabilityState {
  /** Breaker state per executor, for failures the executor can recover from. */
  readonly circuits: Map<string, ExecutorCircuit>
  /**
   * Executors removed from the pool for the rest of the run.
   *
   * Separate from the circuits because these do not recover on a probe. An
   * unauthorized account is fixed by a person, not by waiting, so probing it
   * would spend the start budget confirming something already known.
   */
  readonly disabled: Set<string>
  /**
   * Executor starts this run spent on rerouting, beyond each stage's first.
   *
   * Mutable, and read by the loop that owns the budget rather than returned
   * through the dispatch result, because a reroute that ends in a routing
   * refusal never produces a result to carry it: the starts were still spent,
   * and a budget that forgot them would let an outage loop for free.
   */
  rerouteStarts: number
}

/**
 * What the run's change was measured to be, as it stands.
 *
 * A box for the same reason the override is one: the reading is replaced once,
 * after delivery, and every stage routed after that has to see the replacement
 * rather than the one taken before any of the work existed.
 */
interface ImpactBox {
  impact?: EffectiveChangeImpact
}

/**
 * The human override a run was given, and whether it has been spent.
 *
 * A box rather than a plain value because the routing context is built deep in
 * the dispatch path: the one place that can say "this stage took it" is the
 * one place that resolved a route with it, and that has to be visible to the
 * next stage of the same role.
 */
interface OverrideBox {
  readonly override: StageRouteOverride | undefined
  spent: boolean
}

/** A certification this run published as pending and has yet to answer. */
interface PendingCertification {
  /** The delivery stage that published it, so the terminal window is named for it. */
  readonly stageId: string
  /** The revision the capability reported having marked. */
  readonly revision: string
  /** The capability that marked it, which is the only one that may answer it. */
  readonly capability: CertificationCapabilityPort
}

/** Fresh availability state for one run. */
function availabilityState(): AvailabilityState {
  return { circuits: new Map(), disabled: new Set(), rerouteStarts: 0 }
}

/** Everything the runtime needs, supplied once when the runner is built. */
export interface WorkflowRuntimeOptions {
  readonly profile: HarnessProfile
  readonly policy: RoutingPolicy
  readonly executors: HarnessExecutorRuntime
  readonly journal: WorkflowJournal
  /**
   * The deterministic capabilities this deployment composed, if any.
   *
   * A lifecycle stage that needs one and does not find it here is blocked. It is
   * never handed to an executor with a shell instead: a model told to publish the
   * work has authority over the remote that nothing in this file bounds, and the
   * bound is the reason the capability exists.
   */
  readonly capabilities?: WorkflowCapabilities
  /**
   * Whether this deployment's work may only be certified externally.
   *
   * Composed here rather than read off a request, a profile field or a project
   * config, for the same reason the capability itself is: a run able to say it
   * does not need certifying is a run able to answer a branch-protection rule
   * by declining to be asked. A deployment that sets this and composes no
   * certification capability is blocked, not quietly exempted.
   */
  readonly requireCertification?: boolean
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
  /**
   * The provider result, kept only for the caller's own readers.
   *
   * It never reaches `StageFacts` and never reaches the journal; the diagnosis
   * and repair-evidence readers are handed it inside the same turn and what they
   * return is what the run carries forward.
   */
  readonly result: ExecutorResult | undefined
  /** Why the stage was never started, when routing could not honour policy. */
  readonly refusal: string | undefined
  /**
   * The route this stage actually ran on, and the run it was routed for.
   *
   * Carried out of dispatch because the assurance a verdict can claim depends
   * on both: a PASS reached on a fallback route is a weaker fact than the same
   * PASS reached on the route the risk level called for.
   */
  readonly routed: { readonly context: RoutingContext; readonly decision: RouteDecision } | undefined
}

/** The blocker kind each repair-gate refusal is recorded as. */
function blockerKindOfRepairError(error: RepairError): BlockerKind {
  return error.code === 'product-decision' ? 'product-decision' : 'external'
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

  /**
   * The latest conformance reading, bounded, once one has been established.
   *
   * Held on the runner rather than threaded through every terminal path: a
   * reading survives whatever the run does afterwards, and a run that failed
   * after conformance answered still has an answer worth reporting. One runner
   * serves one workflow, so there is nothing here to leak into another.
   */
  #conformance: ConformanceStatusSummary | undefined

  /** The last reading of what this change is, for the outcome to carry out. */
  #changeImpact: ChangeImpactStatusSummary | undefined

  /**
   * The certification this run has left open on a revision, if any.
   *
   * Held on the runner rather than threaded through the terminal paths for one
   * reason: there are many ways for a run to end and only one of them is the
   * happy one, and a pending status that is never answered is indistinguishable
   * from work still in progress. Every ending goes through the same finish
   * path, and this is what that path reads to know it owes GitHub an answer.
   */
  #pending: PendingCertification | undefined
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
    this.#pending = undefined
    try {
      return await this.#drive(request, controller.signal)
    }
    catch (error) {
      // The one ending that does not pass through `#end`. A run that came apart
      // still marked a revision pending, and leaving that status standing would
      // hold the pull request in a state that reads as "still working".
      await this.#answerPending(request.objective, 'error')
      throw error
    }
    finally {
      this.#pending = undefined
      this.#controller = undefined
    }
  }

  /** Walk the stage queue until something terminal happens. */
  async #drive(request: WorkflowRunRequest, signal: AbortSignal): Promise<WorkflowOutcome> {
    const { objective } = request
    const { journal, profile } = this.#options
    const { maxRepairCycles, maxExecutorStarts } = profile.workflowPolicy

    journal.start(objective)
    // A run that can read its own change set plans in two halves: what it does,
    // then what that turned out to be worth certifying. Everything else keeps
    // the fixed risk-driven plan, and an explicit caller plan still wins.
    const measured = request.plan === undefined && request.changeImpact !== undefined
    const queue = measured
      ? [...planPullRequestImplementationStages()]
      : [...(request.plan ?? planStages)(objective)]
    const stages: StageFacts[] = []
    let repairCycles = 0
    let executorStarts = 0
    const attempts = new Map<Role, number>()
    // The repair session: one defect, what a debugger established about it, and
    // what the gate allowed. All three are cleared when a repair stage ends, so
    // the next cycle cannot inherit the last cycle's authority.
    let defect: Finding | undefined
    let diagnosis: DiagnosisContract | undefined
    let authorization: RepairAuthorization | undefined
    // The executor that last wrote to the tree, so the verifier that follows a
    // repair is routed as an independent reader rather than back to the writer.
    let lastMutator: string | undefined
    // Whether the branch has been published. Once it has, a repair is followed
    // by a fresh delivery, so the stage that re-reads the work reads the diff a
    // person would now see rather than the one that provoked the repair.
    let delivered = false
    // The revision this run has marked pending, and may therefore later speak
    // about. Replaced by each redelivery: a repair publishes a second branch,
    // and a status about the branch it replaced is a status about work nobody
    // will merge.
    let certifiedRevision: string | undefined
    let certificationStarted = false
    // Whether the isolated preview has already passed for this run. A repair
    // and a fresh delivery do not re-verify a schema nothing touched again.
    let schemaVerified = false
    // Whether conformance has already been read once. After it has, a repair is
    // followed by a fresh reading, because the answer it gave was about the
    // branch as it stood before the fix.
    let conformanceRead = false
    const availability = availabilityState()
    const humanOverride: OverrideBox = { override: request.routeOverride, spent: false }
    // The approved documents as they last read, held so the conformance stage
    // scores against the same bytes the implementation was gated on.
    let approved: ApprovedArtifactTexts | undefined
    // What the paths say this change is. The planned reading is taken before
    // anything writes, so the run cannot be classified from work it has already
    // done; the actual one after delivery, once there is a branch to read.
    // Carried as a box rather than a value: it is re-read after delivery, and
    // every stage routed afterwards has to see the reading that replaced it.
    const measurement: ImpactBox = {}
    let plannedPaths: readonly string[] | undefined
    // How many times the certification half has been planned. A repair is
    // followed by a fresh delivery, and the branch that delivery published is
    // classified again, so the half that certifies it is planned again too.
    let certificationPasses = 0
    if (measured) {
      const read = await this.#classify(
        'planned', request, reader => reader.plannedPaths(objective, signal),
      )
      if (typeof read === 'string') {
        return await this.#blocked(objective, stages, repairCycles, executorStarts, 'external', read)
      }
      plannedPaths = read.paths
      measurement.impact = mergeChangeImpact({ objectiveRisk: objective.risk, planned: read.facts })
      // Checkpointed before the loop starts, so the first writable tree this
      // run hands out is authorised by a classification the log already holds.
      await this.#record(read.facts, measurement.impact.effectiveRisk)
    }

    while (queue.length > 0) {
      const stage = queue.shift() as StageSpec
      if (executorStarts >= maxExecutorStarts) {
        return await this.#blocked(
          objective, stages, repairCycles, executorStarts, 'budget-exhausted',
          `the run reached its ${maxExecutorStarts} executor-start budget before ${stage.role} could run`,
        )
      }

      // The approved documents are re-read before anything that writes and
      // before conformance, not once at the start: they can change under a run,
      // and an implementation guided by an edited Plan — or a conformance
      // reading taken against one — is work against obligations nobody
      // approved. The run stops before the stage rather than after it.
      if (permissionModeFor(stage.role) === 'workspace-write' || stage.role === 'conformance') {
        const read = await this.#readApprovedArtifacts(request, objective, signal)
        if (typeof read === 'string') {
          return await this.#blocked(objective, stages, repairCycles, executorStarts, 'external', read)
        }
        approved = read
      }

      if (stage.role === 'repair') {
        // A repair stage with no open defect is a plan asking for a writable
        // tree and naming nothing to fix. The internal plans never do it; a
        // caller-supplied `plan` can, and it is refused rather than allowed to
        // fail as a type error on the way into the gate.
        if (defect === undefined) {
          return await this.#blocked(
            objective, stages, repairCycles, executorStarts, 'external',
            `stage ${stage.stageId} repairs, but no confirmed defect is open for it to act on`,
          )
        }
        // The gate runs before dispatch, so a repair that may not start never
        // gets a writable working tree in the first place.
        try {
          authorization = authorizeRepair(defect, diagnosis, profile.securityPolicy.repairRules)
        } catch (error) {
          if (!(error instanceof RepairError)) throw error
          return await this.#blocked(
            objective, stages, repairCycles, executorStarts, blockerKindOfRepairError(error), error.message,
          )
        }
      }

      if (stage.role === 'delivery') {
        // The schema is verified before the branch is published, not after: a
        // pull request is what a person reviews and a reviewer reading a
        // migration nobody has applied anywhere is reading a guess.
        // Either the caller declared a schema change, or the change set was
        // classified as one. There is deliberately no caller field that can
        // turn the second half off: a migration in the tree is a fact about
        // the change, not a claim about it.
        const databaseRequired
          = request.databaseChange?.required === true || measurement.impact?.databaseMutation === true
        if (databaseRequired && !schemaVerified) {
          const verifier = this.#options.capabilities?.databaseVerification
          if (verifier === undefined) {
            return await this.#blocked(
              objective, stages, repairCycles, executorStarts, 'external',
              'this run changes a database, and this deployment composed no database verification capability '
              + 'to verify it against',
            )
          }
          const verified = await this.#verifySchema(stage, objective, signal, verifier)
          stages.push(verified.facts)
          await journal.verdict(
            `${stage.stageId}-database`, 'verify', verified.facts.verdict, verified.facts.summary,
            verified.facts.evidence,
          )
          if (verified.canceled) {
            return await this.#end(objective, stages, repairCycles, executorStarts, 'canceled', 'INCONCLUSIVE',
              'the run was canceled while its schema change was being verified')
          }
          if (verified.facts.verdict === 'BLOCKED') {
            return await this.#blocked(
              objective, stages, repairCycles, executorStarts, 'external', verified.facts.summary,
            )
          }
          if (verified.facts.verdict !== 'PASS') {
            return await this.#end(objective, stages, repairCycles, executorStarts, 'failed', 'FAIL',
              verified.facts.summary)
          }
          schemaVerified = true
        }
        const capability = this.#options.capabilities?.delivery
        if (capability === undefined) {
          return await this.#blocked(
            objective, stages, repairCycles, executorStarts, 'external',
            `stage ${stage.stageId} publishes the work, and this deployment composed no delivery capability to do it`,
          )
        }
        const published = await this.#publish(stage, objective, signal, capability)
        stages.push(published.facts)
        // Recorded like any other stage's verdict: a projection rebuilding the
        // run should not have to know which stages were routed to see them all.
        await journal.verdict(
          stage.stageId, stage.role, published.facts.verdict, published.facts.summary, published.facts.evidence,
        )
        if (published.canceled) {
          return await this.#end(objective, stages, repairCycles, executorStarts, 'canceled', 'INCONCLUSIVE',
            `the run was canceled during ${stage.role}`)
        }
        if (published.facts.verdict !== 'PASS') {
          return await this.#end(objective, stages, repairCycles, executorStarts, 'failed', 'FAIL',
            published.facts.summary)
        }
        delivered = true
        // The branch exists now, so there is finally a revision to name, and
        // nobody has reviewed it yet, so there is still time to say the answer
        // is not known. Both halves matter: this is the window in which a
        // pending status is the truth.
        const certifier = this.#options.capabilities?.certification
        if (this.#options.requireCertification === true && certifier === undefined) {
          return await this.#blocked(
            objective, stages, repairCycles, executorStarts, 'external',
            'this deployment requires its work to be certified externally, and composed no certification '
            + 'capability to certify it with',
          )
        }
        if (certifier !== undefined) {
          const pending = await this.#certify(stage.stageId, objective, signal, certifier, 'pending')
          if (pending.revision === undefined) {
            // Not a softer verdict and not a warning. A run that could not say
            // "not yet" cannot later be trusted to have said "yes", so it stops
            // here rather than continuing towards a readiness it has no way to
            // publish.
            return await this.#blocked(
              objective, stages, repairCycles, executorStarts, 'external', pending.summary,
            )
          }
          certificationStarted = true
          certifiedRevision = pending.revision
          this.#pending = { stageId: stage.stageId, revision: pending.revision, capability: certifier }
        }
        if (measured) {
          // Only now: what the branch turned out to touch is a fact about a
          // branch, and before delivery there is none. The planned reading
          // stays part of the resolution, so a delivery that touched less than
          // it was approved to touch cannot hand back what that already bought.
          // Re-read after every delivery, not only the first: a repair
          // publishes a second branch, and certifying that one against the
          // classification of the branch it replaced certifies a diff nobody
          // will look at.
          const read = await this.#classify(
            'actual', request, reader => reader.actualPaths(objective, signal), plannedPaths,
          )
          if (typeof read === 'string') {
            return await this.#blocked(objective, stages, repairCycles, executorStarts, 'external', read)
          }
          const previous = measurement.impact as EffectiveChangeImpact
          const resolved = mergeChangeImpact({
            objectiveRisk: objective.risk,
            planned: previous.planned,
            actual: read.facts,
          })
          const merged = certificationPasses === 0
            ? resolved
            : retainStrongerImpact(previous, resolved)
          certificationPasses += 1
          // Resolved once and then folded back in, so the risk the certifying
          // stages are routed at — and the independence their reviewers are
          // held to — is the one the matched QA rows established rather than
          // the lower one the paths alone did.
          const requirements = resolveCertificationRequirements(profile, merged)
          measurement.impact = applyCertificationRequirements(merged, requirements)
          // Checkpointed before the certification half is planned, for the
          // same reason: the bar those stages are held to is read off this.
          await this.#record(read.facts, measurement.impact.effectiveRisk)
          // Everything still queued at this point certifies the branch that
          // was just replaced, so it is dropped rather than resumed: the whole
          // certification half is planned again from the reading that describes
          // what a person would now be asked to review.
          queue.length = 0
          queue.push(...planPullRequestCertificationStages(requirements, certificationPasses))
        }
        continue
      }

      // A stage that certifies the work speaks about a revision, and where
      // certification is required, the only revision it may speak about is the
      // one this run has already marked pending. Checked per stage rather than
      // once after delivery: a repair replaces the branch mid-run, and the
      // stages queued behind it must be answering for the branch that exists.
      if (
        this.#options.requireCertification === true
        && CERTIFYING_ROLES.includes(stage.role)
        && delivered
        && (!certificationStarted || certifiedRevision === undefined)
      ) {
        return await this.#blocked(
          objective, stages, repairCycles, executorStarts, 'external',
          `stage ${stage.stageId} certifies work this run has not marked pending certification`,
        )
      }

      executorStarts += 1
      const reroutesBefore = availability.rerouteStarts
      let dispatched: Dispatched
      try {
        dispatched = await this.#dispatch(
          stage, request, signal, repairCycles, lastMutator, availability,
          maxExecutorStarts - executorStarts, humanOverride, measurement,
        )
      } catch (error) {
        // A policy that cannot answer for this stage — a degraded executor no
        // fallback row covers, a tier the registry does not know — is a refusal,
        // not a crash. Letting it leave `run` would end the workflow with no
        // terminal event at all, and a restart would then read a deterministic
        // refusal as an interrupted run whose effect on the world is unknown.
        if (!(error instanceof RoutingError)) throw error
        // Account the reroutes before reporting: they were spent whether or not
        // the last one found anywhere to go.
        executorStarts += availability.rerouteStarts - reroutesBefore
        return await this.#blocked(
          objective, stages, repairCycles, executorStarts, 'external',
          `${stage.role} could not be routed: ${error.message}`,
        )
      }
      executorStarts += availability.rerouteStarts - reroutesBefore
      stages.push(dispatched.facts)
      if (dispatched.refusal !== undefined) {
        return await this.#blocked(
          objective, stages, repairCycles, executorStarts, 'external', dispatched.refusal,
        )
      }
      if (permissionModeFor(stage.role) === 'workspace-write' && !dispatched.canceled) {
        lastMutator = dispatched.facts.executor
      }
      if (dispatched.canceled) {
        return await this.#end(objective, stages, repairCycles, executorStarts, 'canceled', 'INCONCLUSIVE',
          `the run was canceled during ${stage.role}`)
      }
      if (dispatched.failed) {
        return await this.#end(objective, stages, repairCycles, executorStarts, 'failed', 'FAIL',
          dispatched.facts.summary)
      }

      if (stage.role === 'conformance') {
        const folded = await this.#readConformance(
          stage, request, approved, dispatched, objective, stages, repairCycles, executorStarts,
          measurement,
        )
        if ('outcome' in folded) return folded.outcome
        // The contract is what the stage established; the executor's own
        // verdict is a claim about it, and the weaker of the two stands.
        dispatched = { ...dispatched, facts: folded.facts }
        stages[stages.length - 1] = folded.facts
        conformanceRead = true
      }

      // Triage has the last word on a stage's verdict. A stage may report what it
      // concluded; it may not report a PASS over a confirmed material defect, and
      // it may not carry on while a decision nobody made is outstanding.
      const triaged = triage(dispatched.facts.findings)
      const reconciled = reconcileVerdict(dispatched.facts.verdict, triaged, dispatched.facts.summary)
      if (reconciled.corrected) {
        await journal.verdict(stage.stageId, stage.role, reconciled.verdict, reconciled.summary, [])
      }
      const verdict = reconciled.verdict

      // What the route can support has the last word after triage has had its
      // say. A PASS reached on a fallback route, or by a reader that turned out
      // to be the writer, is a weaker fact than the same PASS on the route the
      // risk level called for — and at critical risk a security assurance that
      // nobody qualified gave is not an assurance. The run stops here rather
      // than opening a repair cycle: there is no defect to fix, only assurance
      // the run did not obtain, and that is a thing a person decides about.
      if (dispatched.routed !== undefined) {
        const supported = capVerdict(verdict, dispatched.routed.context, dispatched.routed.decision)
        if (supported !== verdict) {
          const cause = dispatched.routed.decision.fallbackFrom === undefined
            ? 'no reader independent of the executor that did the work was available'
            : `${dispatched.routed.decision.fallbackFrom} was degraded and a substitute answered`
          const summary = `${stage.role} passed, but on a route that cannot support it: ${cause}`
          await journal.verdict(stage.stageId, stage.role, supported, summary, [])
          return supported === 'BLOCKED'
            ? await this.#blocked(objective, stages, repairCycles, executorStarts, 'external', summary)
            : await this.#end(objective, stages, repairCycles, executorStarts, 'failed', supported, summary)
        }
      }

      if (verdict === 'BLOCKED') {
        const kind = blockerKindOf(triaged.blocking.length > 0 ? triaged.blocking : dispatched.facts.findings)
        await journal.blocker({
          stageId: stage.stageId,
          kind,
          summary: reconciled.summary,
          evidence: dispatched.facts.evidence,
        })
        return await this.#end(objective, stages, repairCycles, executorStarts, 'blocked', 'BLOCKED',
          reconciled.summary)
      }

      if (stage.role === 'debug' && verdict === 'PASS') {
        const produced = request.diagnose?.(stage, dispatched.facts.executor, dispatched.result as ExecutorResult)
        if (produced === undefined) {
          return await this.#blocked(
            objective, stages, repairCycles, executorStarts, 'external',
            'the debugger finished without stating a diagnosis, so no repair is authorized',
          )
        }
        try {
          diagnosis = validateDiagnosis(produced)
        } catch (error) {
          if (!(error instanceof RepairError)) throw error
          return await this.#blocked(
            objective, stages, repairCycles, executorStarts, blockerKindOfRepairError(error), error.message,
          )
        }
        await journal.diagnosis(stage.stageId, diagnosis)
        continue
      }

      if (stage.role === 'repair' && (verdict === 'PASS' || verdict === 'PARTIAL')) {
        const claimed: RepairEvidence = request.repairEvidence?.(
          stage, dispatched.facts.executor, dispatched.result as ExecutorResult,
        ) ?? { rootCauseAddressed: false }
        const completion = assessRepairCompletion(authorization as RepairAuthorization, claimed)
        // The repair session ends here whatever it concluded; the verifier that
        // follows starts from the tree, not from this stage's authority.
        defect = undefined
        diagnosis = undefined
        authorization = undefined
        if (!completion.complete) {
          await journal.verdict(stage.stageId, stage.role, 'INCONCLUSIVE', completion.summary, [])
          return await this.#end(objective, stages, repairCycles, executorStarts, 'failed', 'INCONCLUSIVE',
            completion.summary)
        }
        continue
      }

      if (verdict === 'FAIL' || verdict === 'PARTIAL') {
        // Any certifying stage may open a repair cycle, not only verification:
        // a review, a QA pass and a security stage each find defects the stage
        // before them did not, and a defect found later is not a lesser defect.
        if (!CERTIFYING_ROLES.includes(stage.role)) {
          return await this.#end(objective, stages, repairCycles, executorStarts, 'failed', 'FAIL',
            reconciled.summary)
        }
        if (repairCycles >= maxRepairCycles) {
          return await this.#blocked(
            objective, stages, repairCycles, executorStarts, 'budget-exhausted',
            `${stage.role} still fails after ${maxRepairCycles} repair cycles; a person has to look`,
          )
        }
        // A repair acts on a named defect. A stage that failed without naming
        // one has reported that something is wrong, which is not the same as
        // having said what to fix, and guessing is how a repair invents work.
        const repairable = triaged.repairable[0]
        if (repairable === undefined) {
          return await this.#blocked(
            objective, stages, repairCycles, executorStarts, 'external',
            `${stage.role} failed without naming a confirmed defect an automated repair may act on`,
          )
        }
        defect = repairable
        diagnosis = undefined
        authorization = undefined
        repairCycles += 1
        const retry = (attempts.get(stage.role) ?? 1) + 1
        attempts.set(stage.role, retry)
        // Mechanically obvious scaffolding defects skip diagnosis; everything
        // that changes behavior gets a read-only debugger first. The stage that
        // found the defect is re-run afterwards, by a fresh stage of its own
        // role, so nothing is certified on the strength of a pre-repair reading.
        // A repair is verified before it is published. The stage that found the
        // defect is not the one that proves the fix compiles and passes, and
        // publishing an unverified repair puts a broken diff in front of a
        // person. When verification is itself the stage that failed, its own
        // re-run is that proof and a second one would say nothing new.
        const reverify = stage.role === 'verify'
          ? []
          : [{ stageId: `verify-${(attempts.get('verify') ?? 1) + 1}`, role: 'verify' as const }]
        if (reverify.length > 0) attempts.set('verify', (attempts.get('verify') ?? 1) + 1)
        queue.unshift(
          ...isMechanicallyObvious(repairable)
            ? []
            : [{ stageId: `debug-${repairCycles}`, role: 'debug' as const }],
          { stageId: `repair-${repairCycles}`, role: 'repair' },
          ...reverify,
          // A published branch is re-delivered before it is re-read: a review
          // that ran against the pre-repair diff would be certifying a state
          // the pull request no longer holds.
          ...delivered ? [{ stageId: `delivery-${repairCycles + 1}`, role: 'delivery' as const }] : [],
          // A conformance reading taken before this repair describes a branch
          // that no longer exists, so it is taken again before the stage that
          // found the defect re-runs and before anything certifies the result.
          ...conformanceRead && stage.role !== 'conformance'
            ? [{ stageId: `conformance-${repairCycles + 1}`, role: 'conformance' as const }]
            : [],
          { stageId: `${stage.role}-${retry}`, role: stage.role },
        )
        continue
      }

      // The remaining verdicts are PASS and INCONCLUSIVE. INCONCLUSIVE from a
      // certifying stage is not a pass, and is not a defect either — there is
      // nothing to repair, so the run stops with what it knows.
      if (verdict === 'INCONCLUSIVE') {
        return await this.#end(objective, stages, repairCycles, executorStarts, 'failed', 'INCONCLUSIVE',
          reconciled.summary)
      }
    }

    return await this.#end(objective, stages, repairCycles, executorStarts, 'completed', 'PASS',
      `all ${stages.length} stages passed`)
  }

  /**
   * Journal one reading of the change, and hold it for the outcome.
   *
   * @param facts - the reading, as the classifier produced it.
   * @param effectiveRisk - the risk the run resolved to on it.
   */
  async #record(facts: ChangeImpactFacts, effectiveRisk: Risk): Promise<void> {
    this.#changeImpact = summarizeChangeImpact(facts, effectiveRisk)
    await this.#options.journal.changeImpact({ ...facts, effectiveRisk })
  }

  /**
   * Read one set of repository paths and classify what it means.
   *
   * @param source - which of the two readings this is.
   * @param request - the run request, which supplies the reader.
   * @param read - the reader call this reading is taken from.
   * @param approvedPlannedPaths - the planned set, when there is one to compare against.
   * @returns the paths and the facts, or the refusal to state as a blocker.
   */
  async #classify(
    source: ChangeImpactSource,
    request: WorkflowRunRequest,
    read: (reader: ChangeImpactReader) => Promise<readonly string[]>,
    approvedPlannedPaths?: readonly string[],
  ): Promise<{ paths: readonly string[]; facts: ChangeImpactFacts } | string> {
    const reader = request.changeImpact as ChangeImpactReader
    let paths: readonly string[]
    try {
      paths = await read(reader)
    } catch {
      // The reader's own error text is not repeated: it comes from a project
      // checkout and this summary reaches the journal.
      return `the ${source} change set could not be read, so nothing can be certified against it`
    }
    try {
      return {
        paths,
        facts: classifyChangeImpact({
          source,
          paths,
          policy: this.#options.profile.changeImpactPolicy,
          ...approvedPlannedPaths === undefined ? {} : { approvedPlannedPaths },
        }),
      }
    } catch (error) {
      if (!(error instanceof ChangeImpactError)) throw error
      // Same reason: the message can name a repository path.
      return `the ${source} change set names a path this profile cannot classify`
    }
  }

  /**
   * Re-read the approved documents and check they are still the approved ones.
   *
   * @param request - The run request, which supplies the reader.
   * @param objective - The objective, which carries the approved identity.
   * @param signal - The run's abort signal.
   * @returns The documents, or the refusal to state as a blocker.
   */
  async #readApprovedArtifacts(
    request: WorkflowRunRequest,
    objective: WorkflowObjective,
    signal: AbortSignal,
  ): Promise<ApprovedArtifactTexts | string> {
    const read = request.loadApprovedArtifacts
    if (read === undefined) {
      return 'this run has no way to read the approved Spec and Plan back, so nothing can be gated on them'
    }
    let loaded: ApprovedArtifactTexts
    try {
      loaded = await read(objective, signal)
    } catch {
      // The reader's own error text is not repeated: it can name a path, a
      // provider payload or anything else a caller put in it, and this summary
      // reaches the journal.
      return 'the approved Spec and Plan could not be read back'
    }
    const { spec, plan } = objective.approvedArtifacts
    if (loaded.specSha256 !== spec.sha256) {
      return 'the approved Spec is not the document this objective was approved against'
    }
    if (loaded.planSha256 !== plan.sha256) {
      return 'the approved Plan is not the document this objective was approved against'
    }
    return loaded
  }

  /**
   * Read a conformance stage's result back and hold it to the approved artifacts.
   *
   * @param stage - The conformance stage that ran.
   * @param request - The run request, which supplies the reader.
   * @param approved - The documents this run was gated on.
   * @param dispatched - What the stage produced.
   * @param objective - The objective, for the terminal event.
   * @param stages - The facts so far, for the terminal event.
   * @param repairCycles - Repair cycles so far, for the terminal event.
   * @param executorStarts - Executor starts so far, for the terminal event.
   * @returns The stage's folded facts, or the outcome the run ends on.
   */
  async #readConformance(
    stage: StageSpec,
    request: WorkflowRunRequest,
    approved: ApprovedArtifactTexts | undefined,
    dispatched: Dispatched,
    objective: WorkflowObjective,
    stages: readonly StageFacts[],
    repairCycles: number,
    executorStarts: number,
    measurement: ImpactBox,
  ): Promise<{ facts: StageFacts } | { outcome: WorkflowOutcome }> {
    /**
     * End the run without establishing conformance.
     *
     * @param summary - Why nothing was established.
     * @returns The outcome to return.
     */
    const unestablished = async (summary: string): Promise<{ outcome: WorkflowOutcome }> => ({
      outcome: await this.#end(
        objective, stages, repairCycles, executorStarts, 'failed', 'INCONCLUSIVE', summary,
      ),
    })

    const read = request.conformance
    if (read === undefined || approved === undefined) {
      return await unestablished('this run has no way to read a conformance result, so none was established')
    }
    let manifest: ConformanceManifest
    try {
      // The Definition of Done is deterministic profile policy and joins the
      // manifest with it. A run that supplies none is judged against the Spec
      // and the Plan alone, which is a weaker bar and never a silently wider one.
      manifest = buildConformanceManifest({
        ...approved,
        dod: request.dodObligations ?? [],
        // What the delivered branch touched that the approved Plan never named.
        // Handed over as evidence, not as a verdict: conformance decides what a
        // widened write set means for the obligations it is scoring.
        unplannedPaths: measurement.impact?.actual?.unplannedPaths ?? [],
      })
    } catch (error) {
      if (!(error instanceof ConformanceError)) throw error
      return await unestablished(`the approved artifacts state no obligation set: ${error.message}`)
    }
    let contract
    try {
      contract = validateConformanceCoverage(
        manifest,
        parseConformanceContract(read(stage, dispatched.facts.executor, dispatched.result as ExecutorResult, manifest)),
      )
    } catch (error) {
      if (!(error instanceof ConformanceError) && !(error instanceof Error)) throw error
      // The refusal names the rule, never the payload it was refused over.
      const cause = error instanceof ConformanceError ? error.code : 'unreadable'
      return await unestablished(`conformance produced no result that could be held to the approved artifacts: ${cause}`)
    }
    this.#conformance = summarizeConformance(objective.approvedArtifacts, manifest, contract)
    this.#options.journal.conformance(this.#conformance)
    const verdict = weaker(dispatched.facts.verdict, contract.verdict)
    if (verdict === dispatched.facts.verdict) return { facts: dispatched.facts }
    await this.#options.journal.verdict(stage.stageId, stage.role, verdict, contract.summary, [])
    return {
      facts: facts(
        stage, dispatched.facts.executor, dispatched.facts.permissionMode, verdict, contract.summary,
        dispatched.facts.findings, dispatched.facts.evidence, dispatched.facts.durationMs,
      ),
    }
  }

  /** Route, start, and reduce one stage to facts. */
  async #dispatch(
    stage: StageSpec,
    request: WorkflowRunRequest,
    signal: AbortSignal,
    priorAttempts: number,
    lastMutator: string | undefined,
    availability: AvailabilityState,
    extraStarts: number,
    humanOverride: OverrideBox,
    measurement: ImpactBox,
  ): Promise<Dispatched> {
    let spent = 0
    for (;;) {
      const attempt = await this.#attempt(
        stage, request, signal, priorAttempts, lastMutator, availability, humanOverride, measurement,
      )
      // Only an executor that could not serve the run is retried, and only
      // while the budget the profile set still has room. A wrong answer is not
      // retried at all: asking a second product the same question and taking
      // its answer would report a second opinion as a recovery.
      // Counted here rather than before the call: a reroute that never found
      // anywhere to go throws out of `#attempt` without starting anything, and
      // charging the budget for a start nobody made would be a lie in the
      // direction that ends runs early.
      if (spent > 0) availability.rerouteStarts += 1
      if (!attempt.reroutable || spent >= extraStarts) return attempt.dispatched
      spent += 1
    }
  }

  /** One routed start, and whether its failure permits another. */
  async #attempt(
    stage: StageSpec,
    request: WorkflowRunRequest,
    signal: AbortSignal,
    priorAttempts: number,
    lastMutator: string | undefined,
    availability: AvailabilityState,
    humanOverride: OverrideBox,
    measurement: ImpactBox,
  ): Promise<{ readonly dispatched: Dispatched; readonly reroutable: boolean }> {
    const { journal, executors, policy } = this.#options
    const context = this.#routingContext(
      stage, request, priorAttempts, lastMutator, availability, humanOverride, measurement,
    )
    const decision = route(context, policy)
    // Spent only once a route actually resolved. An override the router refused
    // has changed nothing, and burning it there would leave the run with an
    // authority a person granted and nobody used.
    if (context.userOverride !== undefined) humanOverride.spent = true
    const dispatch = { stageId: stage.stageId, role: stage.role, decision }

    const provider = executors.get(decision.executor)
    const { route: executorRoute } = dispatchableRoute(provider, {
      executor: decision.executor,
      model: decision.resolvedModel,
      permissionMode: decision.permissionMode,
      ...decision.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: decision.reasoningEffort as ReasoningEffort },
    })

    if (
      context.independenceRequirement === 'cross-executor-required'
      && decision.reasonCodes.includes('independence:unsatisfied')
    ) {
      // Routing already said it could not find a reader other than the writer.
      // At this level that is a refusal, not a note: the stage is never started,
      // because a certification the implementer produced would be recorded as
      // assurance the run never actually obtained.
      const summary = `no executor independent of ${decision.executor} is available to ${stage.role}, `
        + 'and this objective requires one'
      // The route is still recorded: what was refused, and why, is a fact about
      // this run. No start is, because nothing started.
      journal.routeDecision(dispatch)
      await journal.verdict(stage.stageId, stage.role, 'BLOCKED', summary, [])
      return {
        dispatched: {
          facts: facts(stage, decision.executor, decision.permissionMode, 'BLOCKED', summary, [], [], 0),
          canceled: false,
          failed: false,
          result: undefined,
          refusal: summary,
          routed: { context, decision },
        },
        reroutable: false,
      }
    }

    // The durable barrier, and the last thing before a provider is allowed to
    // touch the working tree. Route and start are on disk before the process
    // that could mutate it exists, so a restart that finds an open stage knows
    // both that it began and what authority it began with. A checkpoint that
    // fails throws out of the run rather than letting it mutate unrecorded.
    await journal.beginExecutor(dispatch)
    if (decision.fallbackFrom !== undefined) {
      await journal.routeFallback(dispatch, this.#fallbackReason(availability, decision.fallbackFrom), {
        independence: READ_ONLY_ROLES.includes(stage.role) ? 'reduced' : 'preserved',
        assurance: READ_ONLY_ROLES.includes(stage.role) ? 'lowered' : 'unchanged',
      })
    }
    const startedAt = this.#now()
    const result = await executors.start({
      cwd: request.objective.cwd,
      task: request.task(stage, request.objective),
      route: executorRoute,
      signal,
    })
    const durationMs = Math.max(0, this.#now() - startedAt)
    const reroutable = this.#observe(availability, decision.executor, result)

    return {
      dispatched: await this.#reduce(stage, { context, decision }, result, durationMs, request),
      reroutable,
    }
  }

  /**
   * Fold one provider outcome into the run's picture of its executors.
   *
   * Everything recorded here is something the run observed. Nothing is inferred
   * from elapsed time, and nothing is inferred from a provider's prose: a
   * category the provider stated is the only evidence this uses.
   * @param availability - The run's live circuit and disabled-executor state.
   * @param executor - The executor that just ran.
   * @param result - What it returned.
   * @returns Whether this stage may be started again on a different executor.
   */
  #observe(availability: AvailabilityState, executor: string, result: ExecutorResult): boolean {
    const { journal } = this.#options
    const now = this.#now()
    const circuit = availability.circuits.get(executor) ?? openCircuit(executor, now)

    const record = (outcome: { circuit: ExecutorCircuit; transitions: readonly { from: 'AVAILABLE' | 'DEGRADED'; to: 'AVAILABLE' | 'DEGRADED'; reason: string }[] }): void => {
      availability.circuits.set(executor, outcome.circuit)
      for (const change of outcome.transitions) {
        journal.circuitBreaker(executor, change.from, change.to, change.reason)
      }
    }

    if (result.status === 'completed') {
      // A run that served is the only evidence that clears a degraded circuit.
      record(recordSuccess(circuit, now))
      return false
    }
    const category = result.status === 'error' ? result.failure?.category : undefined
    if (category === undefined) return false

    // A category outside the vocabulary is a provider bug, and the run must not
    // be the place it is discovered: an unclassifiable failure is treated as
    // final, which is the fail-closed reading.
    let available: boolean
    let disabling: boolean
    try {
      available = isAvailabilityFailure(category)
      disabling = disablesExecutor(category)
    } catch {
      return false
    }

    if (disabling) {
      availability.disabled.add(executor)
      journal.circuitBreaker(executor, circuit.state, 'DEGRADED', `failure:${category}`)
      // The executor leaves the pool, and this run still ends here: rerouting
      // now would hand the same task to another product and report its answer
      // as recovery from a credential problem.
      return false
    }
    if (!available) return false

    record(recordFailure(circuit, category, now))
    return true
  }

  /** The cause a fallback is recorded under, taken from what degraded it. */
  #fallbackReason(availability: AvailabilityState, from: string): string {
    // Falls back to the bare fact when the executor was named degraded by the
    // caller rather than by anything this run watched happen. Naming a category
    // there would invent a cause the run never observed.
    return availability.circuits.get(from)?.failureClass ?? 'degraded-executor'
  }

  /** Turn one provider result into the compact facts the run carries forward. */
  async #reduce(
    stage: StageSpec,
    routed: { readonly context: RoutingContext; readonly decision: RouteDecision },
    result: ExecutorResult,
    durationMs: number,
    request: WorkflowRunRequest,
  ): Promise<Dispatched> {
    const { journal } = this.#options
    const executor = routed.decision.executor
    const permissionMode = routed.decision.permissionMode

    if (result.status === 'aborted') {
      journal.executorEnd(stage.stageId, executor, 'canceled', durationMs)
      return {
        facts: facts(stage, executor, permissionMode, 'INCONCLUSIVE', 'the stage was canceled', [], [], durationMs),
        canceled: true,
        failed: false,
        result: undefined,
        refusal: undefined,
        routed,
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
        result: undefined,
        refusal: undefined,
        routed,
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
      result,
      refusal: undefined,
      routed,
    }
  }

  /** The routing context one stage presents, built from the role and profile. */
  #routingContext(
    stage: StageSpec,
    request: WorkflowRunRequest,
    priorAttempts: number,
    lastMutator: string | undefined,
    availability: AvailabilityState,
    humanOverride: OverrideBox,
    measurement: ImpactBox,
  ): RoutingContext {
    const { objective } = request
    const { profile, degradedExecutors = [], executors, policy } = this.#options
    // Four sources, all of them observed rather than assumed: what the caller
    // was already told before the run, what the breaker learned during it, what
    // has been taken out of the pool entirely, and which executors this runtime
    // has no provider for at all. The last one is the same fact as the others
    // stated earlier: a name with nothing registered behind it cannot serve a
    // stage, so routing to it and discovering that at dispatch would turn a
    // composition gap into a crash halfway through a run.
    const registered = new Set(executors.list().map(provider => provider.name))
    const unregistered = executorNames(policy).filter(name => !registered.has(name))
    const degraded = Object.freeze([...new Set([
      ...degradedExecutors,
      ...degradedIn([...availability.circuits.values()]),
      ...availability.disabled,
      ...unregistered,
    ])])
    const implementer = lastMutator ?? request.implementationExecutor
    // The override reaches exactly one context: the first stage of its role
    // that gets routed. Later stages of the same role route on the table.
    const { override } = humanOverride
    const applies = override !== undefined && !humanOverride.spent && override.role === stage.role
      ? override
      : undefined
    // What the change was measured to be, when it has been. Before the first
    // reading — and in a run with no reader at all — the stage presents what
    // the caller declared, which is the behaviour this harness had all along.
    const impact = measurement.impact
    const measured = impact === undefined
      ? {
        risk: objective.risk,
        writeVolume: writeVolumeFor(stage.role),
        independenceRequirement: profile.independencePolicy[objective.risk],
        requiredCapabilities: Object.freeze([]) as readonly string[],
        ...objective.taskClass === undefined ? {} : { taskClass: objective.taskClass },
      }
      : impactRoutingFacts(stage, objective, profile, impact)
    return {
      role: stage.role,
      workload: objective.workload,
      ...measured,
      priorAttempts,
      priorRouteFailures: Object.freeze([]),
      degradedExecutors: degraded,
      ...implementer === undefined || !READ_ONLY_ROLES.includes(stage.role)
        ? {}
        : { implementationExecutor: implementer },
      ...applies === undefined ? {} : { userOverride: applies },
    }
  }

  /** Record a blocker and finish. */
  /**
   * Publish the work through the capability, with the journal opened around it.
   *
   * No executor start is counted: the budget bounds how many times a model is
   * asked to think, and this is a bounded command sequence that either did what
   * it says or reports that it did not. The `capability-start` record is flushed
   * before the capability may act, so a run that dies mid-push leaves a window a
   * restart can see is open rather than a silence it has to guess about.
   */
  async #publish(
    stage: StageSpec,
    objective: WorkflowObjective,
    signal: AbortSignal,
    capability: DeliveryCapabilityPort,
  ): Promise<{ readonly facts: StageFacts; readonly canceled: boolean }> {
    const { journal } = this.#options
    const clock = this.#options.now ?? Date.now
    const name = 'github-delivery'
    await journal.beginCapability(stage.stageId, name, true)
    const started = clock()
    const base = { stageId: stage.stageId, role: stage.role, executor: name, permissionMode: 'workspace-write' } as const
    try {
      const result = await capability.deliver({ stageId: stage.stageId, objective }, signal)
      const durationMs = clock() - started
      await journal.endCapability(
        stage.stageId, name, result.delivered ? 'completed' : 'error', durationMs,
        result.delivered ? undefined : 'delivery-refused',
      )
      return {
        facts: {
          ...base,
          verdict: result.delivered ? 'PASS' : 'FAIL',
          summary: result.summary,
          findings: result.findings,
          evidence: result.evidence,
          durationMs,
        },
        canceled: false,
      }
    }
    catch (error) {
      const durationMs = clock() - started
      const canceled = signal.aborted
      await journal.endCapability(
        stage.stageId, name, canceled ? 'aborted' : 'error', durationMs,
        canceled ? 'canceled' : 'delivery-error',
      )
      return {
        facts: {
          ...base,
          verdict: 'INCONCLUSIVE',
          // The capability's own message is bounded by contract; nothing from a
          // command's output or environment reaches it.
          summary: canceled
            ? 'delivery was canceled before it could publish'
            : error instanceof Error ? error.message : 'delivery ended without saying why',
          findings: [],
          evidence: [],
          durationMs,
        },
        canceled,
      }
    }
  }

  /**
   * Publish one external certification state, with the journal opened around it.
   *
   * The `capability-start` record is flushed before the capability may post, so
   * a run that dies between the POST and its own bookkeeping leaves a window a
   * restart can see is open. That ordering is the whole point: a status may
   * exist on GitHub that this run never got to record, and an open window says
   * so where a silence would not.
   *
   * No executor start is counted and no model is consulted. What is published
   * is a state and a revision the capability read for itself.
   */
  async #certify(
    owner: string,
    objective: WorkflowObjective,
    signal: AbortSignal,
    capability: CertificationCapabilityPort,
    state: ExternalCertificationState,
    expectedRevision?: string,
  ): Promise<{ readonly revision: string | undefined; readonly summary: string }> {
    const { journal } = this.#options
    const clock = this.#options.now ?? Date.now
    const name = 'github-certification'
    const stageId = `${owner}-certification`
    await journal.beginCapability(stageId, name, true)
    const started = clock()
    try {
      const result = await capability.publish(
        expectedRevision === undefined
          ? { objective, state }
          : { objective, state, expectedRevision },
        signal,
      )
      await journal.endCapability(stageId, name, 'completed', clock() - started)
      return { revision: result.revision, summary: `certification published as ${state}` }
    }
    catch (error) {
      const canceled = signal.aborted
      await journal.endCapability(
        stageId, name, canceled ? 'aborted' : 'error', clock() - started,
        canceled ? 'canceled' : 'certification-error',
      )
      return {
        revision: undefined,
        // The capability's own message is bounded by contract and names no
        // command output, no path and no credential.
        summary: canceled
          ? 'the run was canceled before its certification could be published'
          : error instanceof Error ? error.message : 'the certification ended without saying why',
      }
    }
  }

  /**
   * Verify the schema change against a real database, with the window journaled.
   *
   * Like publishing, this is a bounded command sequence rather than a question
   * put to a model, so it spends no executor-start budget. A capability that
   * cannot reach a database at all reports `BLOCKED`, which is a different fact
   * from a migration that applied and then failed its checks. Which database it
   * reached is the capability's own business.
   */
  async #verifySchema(
    stage: StageSpec,
    objective: WorkflowObjective,
    signal: AbortSignal,
    capability: DatabaseVerificationCapabilityPort,
  ): Promise<{ readonly facts: StageFacts; readonly canceled: boolean }> {
    const { journal } = this.#options
    const clock = this.#options.now ?? Date.now
    const name = 'database-verification'
    const stageId = `${stage.stageId}-database`
    await journal.beginCapability(stageId, name, true)
    const started = clock()
    const base = { stageId, role: 'verify', executor: name, permissionMode: 'read-only' } as const
    try {
      const result = await capability.verify({ stageId, objective }, signal)
      const durationMs = clock() - started
      await journal.endCapability(
        stageId, name, result.status === 'PASSED' ? 'completed' : 'error', durationMs,
        result.status === 'PASSED' ? undefined : `database-${result.status.toLowerCase()}`,
      )
      return {
        facts: {
          ...base,
          verdict: result.status === 'PASSED' ? 'PASS' : result.status === 'BLOCKED' ? 'BLOCKED' : 'FAIL',
          summary: result.summary,
          findings: result.findings,
          evidence: result.evidence,
          durationMs,
        },
        canceled: false,
      }
    }
    catch (error) {
      const durationMs = clock() - started
      const canceled = signal.aborted
      await journal.endCapability(
        stageId, name, canceled ? 'aborted' : 'error', durationMs,
        canceled ? 'canceled' : 'database-error',
      )
      return {
        facts: {
          ...base,
          verdict: canceled ? 'INCONCLUSIVE' : 'BLOCKED',
          summary: canceled
            ? 'the schema verification was canceled before it finished'
            : error instanceof Error ? error.message : 'the database verification ended without saying why',
          findings: [],
          evidence: [],
          durationMs,
        },
        canceled,
      }
    }
  }

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
    let endState = state
    let endVerdict = verdict
    let endSummary = summary
    const pending = this.#pending
    if (pending !== undefined) {
      // Built before anything is published, because what is published is a
      // projection of it: readiness is the existing predicate's answer about
      // this exact run, not a second opinion assembled here.
      const candidate = this.#outcome(objective, stages, repairCycles, executorStarts, state, verdict, summary)
      const published = await this.#answerPending(objective, externalCertificationState({
        ready: certificationDecision(candidate).ready,
        verdict,
        operationalFailure: false,
        canceled: state === 'canceled',
      }))
      if (published !== undefined) {
        // A success this run could not publish, or published against a head it
        // never read, is not a success. The verdict a person reads is lowered
        // to match what the repository will actually show them.
        endState = 'failed'
        endVerdict = 'INCONCLUSIVE'
        endSummary = published
      }
    }
    await this.#options.journal.end(endState, endVerdict, endSummary)
    return this.#outcome(objective, stages, repairCycles, executorStarts, endState, endVerdict, endSummary)
  }

  /**
   * Answer the pending certification this run left open, if it left one.
   *
   * The publication is attempted on a fresh signal rather than the run's own.
   * A canceled run is exactly the case where the status most needs replacing,
   * and a terminal publication that inherits the cancellation would abandon the
   * pull request holding the pending status the cancellation was supposed to
   * clear.
   * @param objective - The objective, which the capability re-reads its target from.
   * @param state - The state this run's ending maps to.
   * @returns Why the run's own verdict must be lowered, or undefined when it need not be.
   */
  async #answerPending(
    objective: WorkflowObjective,
    state: ExternalCertificationState,
  ): Promise<string | undefined> {
    const pending = this.#pending
    if (pending === undefined) return undefined
    // Cleared first: one terminal answer per run, whatever happens below.
    this.#pending = undefined
    const result = await this.#certify(
      `${pending.stageId}-final`, objective, new AbortController().signal, pending.capability, state,
      pending.revision,
    )
    if (state !== 'success') return undefined
    if (result.revision === undefined) {
      return 'this run could not publish the certification for the revision it delivered, so nothing here says '
        + 'the branch is ready'
    }
    if (result.revision !== pending.revision) {
      return 'the pull request head moved after this run certified it, so what was reviewed is not what is there'
    }
    return undefined
  }

  /** Assemble the outcome record, so every ending reports the same shape. */
  #outcome(
    objective: WorkflowObjective,
    stages: readonly StageFacts[],
    repairCycles: number,
    executorStarts: number,
    state: WorkflowEndState,
    verdict: WorkflowVerdict,
    summary: string,
  ): WorkflowOutcome {
    return Object.freeze({
      workflowId: this.#workflowId,
      objectiveId: objective.id,
      state,
      verdict,
      summary,
      stages: Object.freeze([...stages]),
      repairCycles,
      executorStarts,
      ...this.#conformance === undefined ? {} : { conformance: this.#conformance },
      ...this.#changeImpact === undefined ? {} : { changeImpact: this.#changeImpact },
    })
  }
}

/**
 * Verdicts from the least assurance to the most, so two can be compared.
 *
 * A conformance stage that passed and a contract that did not are two claims
 * about one reading, and the run believes the weaker one.
 */
const ASSURANCE: readonly WorkflowVerdict[] = ['BLOCKED', 'FAIL', 'INCONCLUSIVE', 'PARTIAL', 'PASS']

/**
 * The weaker of two verdicts.
 *
 * @param left - One verdict.
 * @param right - The other.
 * @returns Whichever claims less.
 */
function weaker(left: WorkflowVerdict, right: WorkflowVerdict): WorkflowVerdict {
  return ASSURANCE.indexOf(left) <= ASSURANCE.indexOf(right) ? left : right
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
