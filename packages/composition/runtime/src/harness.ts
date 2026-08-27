/**
 * The whole-Harness composition: contracts, executors, routing, journal,
 * workflow, integrations and the control server, assembled from one profile.
 *
 * The profile decides what exists. Routing rules and the model registry become
 * the policy the runner routes against; `integrationPolicy.enabled` decides
 * whether an integration is constructed at all, so a project that has not
 * enabled Supabase preview validation does not get a Supabase client it merely
 * never calls. Configuration supplies the seams — a subprocess runtime, a
 * session, the interpreter that reads a provider's output — and this module
 * supplies none of them, because inventing a default for any of them would be
 * this package deciding something a deployment owns.
 *
 * Nothing here starts a product process, opens a socket or writes a journal
 * entry. Composition is assembly; the first process appears on the first
 * dispatch and the first socket on `listen`.
 *
 * @module @trick-harness/composition
 */

import { randomUUID } from 'node:crypto'
import type { Session } from '@deepseek-ai/dsh-session'
import type { StageRouteOverride, WorkflowObjective } from '@trick-harness/contracts'
import { HarnessControlServer } from '@trick-harness/control-server'
import type { ControlServerOptions, ControlWorkflowStatus } from '@trick-harness/control-server'
import {
  WorkflowRunner,
  assessRestart,
} from '@trick-harness/engineering-workflow'
import type {
  RestartAssessment,
  StageInterpreter,
  StageSpec,
  WorkflowOutcome,
  WorkflowRunRequest,
} from '@trick-harness/engineering-workflow'
import { createExecutorRuntime } from '@trick-harness/executor'
import type { ExecutorResult, HarnessExecutorRuntime } from '@trick-harness/executor'
import { GitHubDelivery } from '@trick-harness/github-delivery'
import type { GitHubDeliveryOptions } from '@trick-harness/github-delivery'
import { WorkflowJournal, projectWorkflow } from '@trick-harness/journal'
import type { JournalFlush } from '@trick-harness/journal'
import { validateProfile } from '@trick-harness/profile'
import type { HarnessProfile } from '@trick-harness/profile'
import type { ModelRegistry, RoutingPolicy } from '@trick-harness/routing'
import { SupabasePreview } from '@trick-harness/supabase-preview'
import type { SupabasePreviewOptions } from '@trick-harness/supabase-preview'
import { BundleCompositionError, composeHarnessRuntime } from './index.ts'
import type { HarnessRuntimeBundleOptions } from './index.ts'

/** Integration capability id for scoped GitHub delivery. */
export const GITHUB_DELIVERY_CAPABILITY = 'github-delivery'

/** Integration capability id for cloud-only Supabase preview validation. */
export const SUPABASE_PREVIEW_CAPABILITY = 'supabase-preview'

/** Integration capability id for the loopback control server. */
export const CONTROL_SERVER_CAPABILITY = 'control-server'

/**
 * What reads a provider's output back into the run.
 *
 * None of these has a default. The runtime never parses executor output, and a
 * stand-in interpreter would be this package guessing at a product's shape on
 * a deployment's behalf.
 */
export interface HarnessWorkflowHandlers {
  readonly interpret: StageInterpreter
  readonly task: (stage: StageSpec, objective: WorkflowObjective) => string
  /** The stage plan; `planPullRequestStages` certifies a published branch. */
  readonly plan?: (objective: WorkflowObjective) => readonly StageSpec[]
  readonly diagnose?: (stage: StageSpec, executor: string, result: ExecutorResult) => unknown
  readonly repairEvidence?: WorkflowRunRequest['repairEvidence']
}

/** Integration seams a profile may enable. */
export interface HarnessIntegrationOptions {
  readonly github?: GitHubDeliveryOptions
  readonly supabase?: SupabasePreviewOptions
}

/** Where the control server binds, when the profile enables one. */
export interface HarnessControlOptions {
  readonly host?: string
  readonly port?: number
  readonly token?: string
}

/** Everything one composed Harness is assembled from. */
export interface HarnessCompositionOptions {
  /** The project's policy; the only thing that decides what exists. */
  readonly profile: HarnessProfile
  /** Semantic tier to product-native model, for this deployment. */
  readonly registry: ModelRegistry
  /** The session workflow events are journalled into. */
  readonly session: Session
  /** How journal writes are made durable. */
  readonly flush: JournalFlush
  /** What reads provider output back into the run. */
  readonly workflow: HarnessWorkflowHandlers
  /** Which executors to register; an empty composition is a valid one. */
  readonly providers?: HarnessRuntimeBundleOptions
  /** Integration seams, honoured only where the profile enables them. */
  readonly integrations?: HarnessIntegrationOptions
  /** Control-server binding, honoured only where the profile enables one. */
  readonly control?: HarnessControlOptions
  /** Executors the breaker has already marked degraded. */
  readonly degradedExecutors?: readonly string[]
  /**
   * Mints the id of one execution attempt.
   *
   * Defaults to `randomUUID`. An objective is a thing a person asks for and may
   * ask for again; an execution is one attempt at it, and the two cannot share
   * an id without the second attempt appending its facts onto the first one's
   * history. A deployment overrides this only to make ids readable or ordered,
   * never to reuse one: a repeat is refused rather than merged.
   */
  readonly workflowIdFactory?: () => string
}

/** One assembled Harness and everything it owns. */
export interface ComposedHarness {
  /** The populated executor runtime. */
  readonly runtime: HarnessExecutorRuntime
  /** The registered executor names, in registration order. */
  readonly executors: readonly string[]
  /** The routing policy this profile and registry produce. */
  readonly policy: RoutingPolicy
  /** The integrations the profile actually enabled. */
  readonly integrations: {
    readonly github?: GitHubDelivery
    readonly supabase?: SupabasePreview
  }
  /** The control server, present only when the profile enables one. */
  readonly server?: HarnessControlServer
  /**
   * Run one objective to a terminal state.
   * @param objective - What to run.
   * @param signal - Cancels the run and everything it owns.
   * @param routeOverride - One human routing choice, spent on a single stage.
   */
  run(
    objective: WorkflowObjective,
    signal?: AbortSignal,
    routeOverride?: StageRouteOverride,
  ): Promise<WorkflowOutcome>
  /** Read durable state for a workflow no longer running here. */
  restartOf(workflowId: string): RestartAssessment | undefined
  /** End everything this composition owns, and wait for it. */
  dispose(): Promise<void>
}

/**
 * Turn a profile's routing table and a deployment's registry into one policy.
 * @param profile - The project's policy.
 * @param registry - Semantic tier to product-native model.
 * @returns The versioned policy the router resolves against.
 */
export function routingPolicyOf(profile: HarnessProfile, registry: ModelRegistry): RoutingPolicy {
  return Object.freeze({
    policyVersion: profile.policyVersion,
    rules: profile.routingPolicy.rules,
    fallbackRules: profile.routingPolicy.fallbackRules,
    registry,
  })
}

/** Whether the profile turned one integration capability on. */
function enabled(profile: HarnessProfile, capability: string): boolean {
  return profile.integrationPolicy.enabled.includes(capability)
}

/**
 * Refuse configuration the profile does not authorise.
 *
 * An integration configured but not enabled is a disagreement between two
 * files, and guessing which one meant it is how a project ends up talking to a
 * hosted database it thought it had turned off.
 */
function assertAuthorised(profile: HarnessProfile, options: HarnessCompositionOptions): void {
  if (options.integrations?.github !== undefined && !enabled(profile, GITHUB_DELIVERY_CAPABILITY)) {
    throw new BundleCompositionError(
      `profile ${JSON.stringify(profile.id)} does not enable ${GITHUB_DELIVERY_CAPABILITY}`,
    )
  }
  if (options.integrations?.supabase !== undefined && !enabled(profile, SUPABASE_PREVIEW_CAPABILITY)) {
    throw new BundleCompositionError(
      `profile ${JSON.stringify(profile.id)} does not enable ${SUPABASE_PREVIEW_CAPABILITY}`,
    )
  }
  if (options.control !== undefined && !enabled(profile, CONTROL_SERVER_CAPABILITY)) {
    throw new BundleCompositionError(
      `profile ${JSON.stringify(profile.id)} does not enable ${CONTROL_SERVER_CAPABILITY}`,
    )
  }
}

/**
 * Refuse an objective that was written for a different deployment.
 *
 * The objective carries the profile it was authored against, and this Harness
 * was composed from exactly one. When the two disagree, every rule the run is
 * about to be held to — which executors it may reach, which integrations are
 * enabled, what delivery is allowed to touch — comes from a policy the
 * objective never agreed to. Checked before an id is minted so that a
 * mismatched objective leaves nothing behind: no durable start, no executor,
 * no hosted mutation.
 * @param objective - What was asked for.
 * @param profile - The profile this Harness was composed from.
 * @throws {BundleCompositionError} when the two name different profiles.
 */
function assertObjectiveProfile(objective: WorkflowObjective, profile: HarnessProfile): void {
  if (objective.profileId !== profile.id) {
    throw new BundleCompositionError(
      `objective profile ${JSON.stringify(objective.profileId)} does not match composed profile ${JSON.stringify(profile.id)}`,
    )
  }
}

/**
 * Compose one Harness from one profile.
 *
 * @param options - The profile, the seams, and what the profile is allowed to enable.
 * @returns The assembled Harness.
 * @throws {BundleCompositionError} when configuration exceeds what the profile enables,
 * or when the profile routes to an executor nobody registered.
 */
export function composeHarness(options: HarnessCompositionOptions): ComposedHarness {
  const { profile, session, flush, workflow } = options
  // Ahead of the trust check, because that check reads the profile too: policy
  // that is not well-formed data cannot be asked what it authorises.
  validateProfile(profile)
  assertAuthorised(profile, options)

  const runtime = createExecutorRuntime()
  const composition = composeHarnessRuntime(runtime, { ...options.providers, profile })
  const policy = routingPolicyOf(profile, options.registry)

  const github = options.integrations?.github === undefined
    ? undefined
    : new GitHubDelivery(options.integrations.github)
  const supabase = options.integrations?.supabase === undefined
    ? undefined
    : new SupabasePreview(options.integrations.supabase)

  // Each in-flight run is held with the promise that settles it, because
  // disposal has to wait for that promise rather than for the runner object:
  // unregistering a provider under a run still dispatching would fail it with
  // an unregistered-executor error instead of ending it as canceled.
  const runners = new Map<WorkflowRunner, Promise<unknown>>()

  // The override is handed to the run and nowhere else. It never edits the
  // profile's routing table and never touches a provider's configuration: the
  // authority a person granted is for this run, and a composition that wrote it
  // down anywhere durable would have turned one decision into a default.
  const mintWorkflowId = options.workflowIdFactory ?? randomUUID
  // Ids handed out this process, kept beyond the run that used them. The
  // durable log answers for a previous process; this set answers for a factory
  // that repeats an id within one, which the log cannot yet see because the
  // first run may not have flushed its start.
  const minted = new Set<string>()

  /**
   * Mint one execution id, refusing a repeat rather than appending to it.
   * @returns The id this attempt is recorded under.
   */
  const nextWorkflowId = (): string => {
    const workflowId = mintWorkflowId()
    const taken = minted.has(workflowId)
      || projectWorkflow(session.events, workflowId).objective !== undefined
    if (taken) {
      throw new BundleCompositionError(`workflow id ${JSON.stringify(workflowId)} already exists`)
    }
    minted.add(workflowId)
    return workflowId
  }

  /**
   * Start one execution and hand back its identity immediately.
   *
   * Synchronous up to the id on purpose: a caller — the control server above
   * all — has to be able to name the run it just asked for before the run has
   * done anything, and an id that only appeared in the outcome would leave a
   * status poll with nothing to address in between.
   * @param objective - What to run.
   * @param routeOverride - One human routing choice, spent on a single stage.
   * @returns The minted id, the promise it settles on, and how to end it.
   */
  const begin = (
    objective: WorkflowObjective,
    routeOverride?: StageRouteOverride,
  ): { workflowId: string; outcome: Promise<WorkflowOutcome>; cancel: (reason: string) => void } => {
    assertObjectiveProfile(objective, profile)
    const workflowId = nextWorkflowId()
    const journal = new WorkflowJournal(session, workflowId, flush)
    const runner = new WorkflowRunner(workflowId, {
      profile,
      policy,
      executors: runtime,
      journal,
      ...options.degradedExecutors === undefined ? {} : { degradedExecutors: options.degradedExecutors },
    })
    const settled = runner.run({
      objective,
      interpret: workflow.interpret,
      task: workflow.task,
      ...workflow.plan === undefined ? {} : { plan: workflow.plan },
      ...workflow.diagnose === undefined ? {} : { diagnose: workflow.diagnose },
      ...workflow.repairEvidence === undefined ? {} : { repairEvidence: workflow.repairEvidence },
      ...routeOverride === undefined ? {} : { routeOverride },
    })
    runners.set(runner, settled)
    const outcome = settled.finally(() => {
      runners.delete(runner)
      runner.dispose()
    })
    return {
      workflowId,
      outcome,
      cancel: (reason: string): void => {
        runner.cancel(reason)
      },
    }
  }

  const run = async (
    objective: WorkflowObjective,
    signal?: AbortSignal,
    routeOverride?: StageRouteOverride,
  ): Promise<WorkflowOutcome> => {
    const started = begin(objective, routeOverride)
    const stop = (): void => {
      started.cancel('the caller canceled this workflow')
    }
    if (signal?.aborted === true) stop()
    signal?.addEventListener('abort', stop, { once: true })
    try {
      return await started.outcome
    } finally {
      signal?.removeEventListener('abort', stop)
    }
  }

  const restartOf = (workflowId: string): RestartAssessment | undefined => {
    const projection = projectWorkflow(session.events, workflowId)
    if (projection.objective === undefined) return undefined
    return assessRestart(projection)
  }

  const serverOptions: ControlServerOptions = {
    start: begin,
    restart: (workflowId: string): Promise<RestartAssessment | undefined> =>
      Promise.resolve(restartOf(workflowId)),
    ...options.control?.host === undefined ? {} : { host: options.control.host },
    ...options.control?.port === undefined ? {} : { port: options.control.port },
    ...options.control?.token === undefined ? {} : { token: options.control.token },
  }
  const server = enabled(profile, CONTROL_SERVER_CAPABILITY)
    ? new HarnessControlServer(serverOptions)
    : undefined

  return {
    runtime,
    executors: composition.executors,
    policy,
    integrations: Object.freeze({
      ...github === undefined ? {} : { github },
      ...supabase === undefined ? {} : { supabase },
    }),
    ...server === undefined ? {} : { server },
    run,
    restartOf,
    async dispose(): Promise<void> {
      // The server first: it owns runs it started, and disposing it settles
      // them before anything they are still writing to is taken away.
      await server?.dispose()
      // Then the runs a caller started directly. Each is canceled and waited
      // for, because unregistering a provider under a run still dispatching
      // would fail it with an unregistered-executor error rather than end it.
      const inFlight = [...runners.entries()]
      for (const [runner] of inFlight) runner.cancel('the harness is being disposed')
      await Promise.allSettled(inFlight.map(([, promise]) => promise))
      for (const [runner] of inFlight) runner.dispose()
      runners.clear()
      composition.dispose()
      // Last, and awaited: the runtime is what owns the process trees, and a
      // composition that resolved before they were down would be telling its
      // caller the machine was quiet while it was still running.
      await runtime.dispose()
    },
  }
}

/** Re-exported so a caller can render a status without importing the server. */
export type { ControlWorkflowStatus }
