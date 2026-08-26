/**
 * Named provider registry and dispatch for the executor capability.
 *
 * The runtime owns three things a provider must not: which provider a route
 * selects, whether that provider can actually honour the route, and the
 * lifetime of runs in flight. Providers translate one validated request into
 * one product runtime and nothing more.
 *
 * @module @trick-harness/executor
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  ExecutorCleanupFailure,
  ExecutorPermissionMode,
  ExecutorProvider,
  ExecutorRegistration,
  ExecutorResult,
  ExecutorRoute,
  ExecutorStartRequest,
  ReasoningEffort,
} from './types.ts'

export type * from './types.ts'
export { cleanupFailure } from './cleanup.ts'

/** Thrown when provider registration or selection is invalid. */
export class ExecutorProviderError extends Error {
  /** Stable machine-readable failure code. */
  readonly code = 'EXECUTOR_PROVIDER' as const

  /**
   * Construct a provider registration or selection failure.
   * @param message - what went wrong, naming the provider where one is known.
   */
  constructor(message: string) {
    super(message)
    this.name = 'ExecutorProviderError'
  }
}

/** Thrown when a route asks for something the selected provider cannot honour. */
export class ExecutorCapabilityError extends Error {
  /** Stable machine-readable failure code. */
  readonly code = 'EXECUTOR_CAPABILITY' as const

  /**
   * Construct a capability mismatch failure.
   * @param provider - the selected provider name.
   * @param detail - the capability the route required.
   */
  constructor(provider: string, detail: string) {
    super(`executor ${JSON.stringify(provider)}: ${detail}`)
    this.name = 'ExecutorCapabilityError'
  }
}

/**
 * How many cleanup facts one runtime keeps.
 *
 * Bounded because this is evidence held for the lifetime of a runtime that may
 * dispatch thousands of runs, and unbounded evidence is a leak. The count is
 * kept separately from the retained facts so the truncation is never the silent
 * kind: a report of 900 faults with 64 examples still says 900.
 */
export const CLEANUP_EVIDENCE_LIMIT = 64

/** What a runtime observed of its providers' teardown, across every run. */
export interface ExecutorCleanupReport {
  /**
   * Whether teardown has been clean for every run this runtime dispatched.
   *
   * The only thing that licenses calling a settled disposal quiescent-clean.
   * Quiescence says the runs came back; this says they came back tidy, and the
   * two are different claims.
   */
  readonly clean: boolean
  /** Every cleanup fault seen, including ones too old to still be retained. */
  readonly total: number
  /** The retained faults, oldest first, capped at {@link CLEANUP_EVIDENCE_LIMIT}. */
  readonly retained: readonly ExecutorCleanupFailure[]
}

/** Validated provider registry with capability-checked dispatch. */
export interface HarnessExecutorRuntime {
  /**
   * Register one provider under its declared name.
   * @param provider - the provider to register.
   * @returns a handle whose disposal unregisters exactly this registration.
   */
  register(provider: ExecutorProvider): ExecutorRegistration
  /**
   * Look one provider up by name.
   * @param name - the registered provider name.
   * @returns the provider.
   */
  get(name: string): ExecutorProvider
  /**
   * List every registered provider.
   * @returns the providers, ordered by registration.
   */
  list(): readonly ExecutorProvider[]
  /**
   * Validate a request and dispatch it to the routed provider.
   * @param request - the resolved request.
   * @returns the provider's bounded result.
   */
  start(request: ExecutorStartRequest): Promise<ExecutorResult>
  /**
   * Count runs currently in flight.
   * @returns the number of active runs.
   */
  activeRuns(): number
  /**
   * Report what this runtime has seen of its providers' teardown.
   *
   * Readable at any time, and outliving the runs themselves: the point is that
   * after `dispose()` has resolved a verifier can ask whether quiescence was
   * also clean, which a per-run result cannot answer once the run is gone.
   * @returns the standing cleanup evidence.
   */
  cleanupReport(): ExecutorCleanupReport
  /**
   * Unregister every provider, abort every run in flight, and wait for them.
   *
   * Quiescence, not signal delivery: the promise settles only once every run
   * that was active has come back through its provider's own teardown, so a
   * caller that awaits it knows no owned process tree is still coming down.
   * Idempotent — a second call is answered with the first one's settlement.
   * @returns Nothing; resolves when the runtime is quiet.
   */
  dispose(): Promise<void>
}

/** Reject a provider whose declared shape cannot be dispatched to. */
function validateProvider(provider: ExecutorProvider): void {
  if (typeof provider.name !== 'string' || provider.name.trim() !== provider.name || provider.name === '') {
    throw new ExecutorProviderError('executor provider name must be non-blank and already trimmed')
  }
  if (provider.capabilities.permissionModes.length === 0) {
    throw new ExecutorCapabilityError(provider.name, 'provider must enforce at least one permission mode')
  }
}

/** Reject a request whose shape a provider should never have to defend against. */
function validateRequest(request: ExecutorStartRequest): void {
  // Absolute-path check by hand rather than via node:path, so the rule reads the
  // same on both separators and a POSIX request stays valid when planned on
  // Windows and executed on Linux.
  if (!/^(?:\/|[A-Za-z]:[\\/])/.test(request.cwd)) {
    throw new ExecutorProviderError(`executor request cwd must be an absolute path, got ${JSON.stringify(request.cwd)}`)
  }
  if (request.task.trim() === '') {
    throw new ExecutorProviderError('executor request task must not be blank')
  }
}

/** Reject a route the selected provider cannot honour, before anything is spawned. */
function validateRoute(provider: ExecutorProvider, request: ExecutorStartRequest): void {
  const { capabilities } = provider
  const { model, reasoningEffort, permissionMode } = request.route
  if (model !== undefined && !capabilities.modelOverride) {
    throw new ExecutorCapabilityError(provider.name, 'provider does not honour a per-run model override')
  }
  if (reasoningEffort !== undefined && !capabilities.reasoningEffort) {
    throw new ExecutorCapabilityError(provider.name, 'provider does not honour a per-run reasoning effort')
  }
  if (!capabilities.permissionModes.includes(permissionMode)) {
    throw new ExecutorCapabilityError(
      provider.name,
      `provider cannot enforce permission mode ${JSON.stringify(permissionMode)}`,
    )
  }
}

/**
 * What a routing policy asked for, before any provider has been consulted.
 *
 * Identical in shape to {@link ExecutorRoute} and deliberately a separate type:
 * a policy states intent, and a route is what an executor was actually asked to
 * do. Conflating them is how an unhonoured preference becomes an unnoticed lie
 * in the durable record.
 */
export interface ExecutorRouteIntent {
  /** Registered provider name this run is dispatched to. */
  readonly executor: string
  /** Product-native model id, absent when the product default is intended. */
  readonly model?: string
  /** Reasoning budget the policy asked for; advisory, see {@link dispatchableRoute}. */
  readonly reasoningEffort?: ReasoningEffort
  /** Filesystem authority for this run; always explicit, never defaulted. */
  readonly permissionMode: ExecutorPermissionMode
}

/** A route a given provider can honour, plus what the intent lost on the way. */
export interface DispatchableRoute {
  /** The route to dispatch. */
  readonly route: ExecutorRoute
  /**
   * Intent fields dropped because the provider does not honour them.
   *
   * Never empty-and-forgotten: the caller is expected to record these on the
   * run's durable route fact, so "this ran without the effort the policy asked
   * for" stays visible afterwards rather than being inferred from a provider's
   * capability table months later.
   */
  readonly dropped: readonly 'reasoningEffort'[]
}

/**
 * Narrow a policy's routing intent to what one provider can actually honour.
 *
 * Only `reasoningEffort` is droppable, and the asymmetry with `model` is the
 * whole point. A reasoning budget is a request about how hard to think: a
 * product with no field for it still does the work, and a policy that states
 * one for every row should not make an executor undispatchable for lacking a
 * knob. A model identifies *who did the work*; dropping it would leave a run
 * attributed to a model that never ran it, so it is passed through untouched
 * and the runtime refuses the route — which is the existing behaviour and stays
 * that way.
 *
 * Call this where policy is resolved, not inside a provider: a provider that
 * decided for itself which parts of a route to ignore would be deciding policy.
 * @param provider - the provider the intent names.
 * @param intent - what the routing policy asked for.
 * @returns the honourable route and the intent fields it had to give up.
 */
export function dispatchableRoute(
  provider: ExecutorProvider,
  intent: ExecutorRouteIntent,
): DispatchableRoute {
  const honoursEffort = intent.reasoningEffort === undefined || provider.capabilities.reasoningEffort
  return {
    route: {
      executor: intent.executor,
      permissionMode: intent.permissionMode,
      ...intent.model === undefined ? {} : { model: intent.model },
      ...honoursEffort && intent.reasoningEffort !== undefined
        ? { reasoningEffort: intent.reasoningEffort }
        : {},
    },
    dropped: honoursEffort ? Object.freeze([]) : Object.freeze(['reasoningEffort' as const]),
  }
}

/** One stored registration, identity-tagged so a stale handle is inert. */
interface ProviderEntry {
  readonly provider: ExecutorProvider
}

/**
 * One run the runtime owns, and the two handles disposal needs from it.
 *
 * The controller alone was not enough: aborting it says the run has been asked
 * to stop, and a runtime that treated the asking as the answer would report
 * quiescence while a process tree was still being taken down.
 */
interface ActiveRun {
  /** The runtime's own controller, chained to the caller's signal. */
  readonly controller: AbortController
  /** Resolves once the provider call has left its `finally` path. */
  readonly settled: Promise<void>
}

/**
 * Create a standalone executor runtime.
 *
 * Independent of Cordis so dispatch and capability rules can be exercised in a
 * plain unit test without standing up a context.
 * @returns an empty runtime.
 */
export function createExecutorRuntime(): HarnessExecutorRuntime {
  const entries = new Map<string, ProviderEntry>()
  const inFlight = new Set<ActiveRun>()
  // Doubles as the disposed flag: once it exists no run may start, and every
  // later caller is handed the same settlement rather than a second teardown.
  let disposal: Promise<void> | undefined
  // Evidence, not state: nothing the runtime does branches on these, and they
  // are deliberately not cleared by disposal, because the question they answer
  // is asked after disposal.
  const retainedCleanup: ExecutorCleanupFailure[] = []
  let totalCleanup = 0

  return {
    register(provider: ExecutorProvider): ExecutorRegistration {
      validateProvider(provider)
      if (entries.has(provider.name)) {
        throw new ExecutorProviderError(`executor ${JSON.stringify(provider.name)} is already registered`)
      }
      const entry: ProviderEntry = { provider }
      entries.set(provider.name, entry)
      return {
        dispose(): void {
          if (entries.get(provider.name) === entry) entries.delete(provider.name)
        },
      }
    },

    get(name: string): ExecutorProvider {
      const entry = entries.get(name)
      if (entry === undefined) {
        throw new ExecutorProviderError(`executor ${JSON.stringify(name)} is not registered`)
      }
      return entry.provider
    },

    list(): readonly ExecutorProvider[] {
      return Object.freeze([...entries.values()].map(entry => entry.provider))
    },

    async start(request: ExecutorStartRequest): Promise<ExecutorResult> {
      if (disposal !== undefined) throw new ExecutorProviderError('executor runtime is disposed')
      validateRequest(request)
      const provider = this.get(request.route.executor)
      validateRoute(provider, request)

      // Checked after validation so a malformed request is still reported as
      // malformed: a caller who aborted early still wants to know their route
      // was wrong.
      if (request.signal.aborted) return { status: 'aborted', output: '' }

      // The runtime's own controller is chained to the caller's so that
      // disposal can end a run the caller has no reason to cancel.
      const controller = new AbortController()
      const forward = (): void => { controller.abort(request.signal.reason) }
      request.signal.addEventListener('abort', forward, { once: true })
      // Settled from the `finally` below rather than from the call itself: the
      // run is over when the provider has finished cleaning up after it, and
      // that is a moment only the provider's own unwinding can report.
      const finished = Promise.withResolvers<void>()
      const run: ActiveRun = { controller, settled: finished.promise }
      inFlight.add(run)
      try {
        const result = await provider.start({ ...request, signal: controller.signal })
        // Recorded on the way past, not interpreted: the runtime keeps the fact
        // so it survives the run, and hands the caller the same result it was
        // given, with the same status the provider decided.
        for (const failure of result.cleanup ?? []) {
          totalCleanup += 1
          if (retainedCleanup.length < CLEANUP_EVIDENCE_LIMIT) retainedCleanup.push(failure)
        }
        return result
      } finally {
        request.signal.removeEventListener('abort', forward)
        // Removed before the settlement is announced, so a disposer waking on
        // that promise never sees a run it is waiting for still counted.
        inFlight.delete(run)
        finished.resolve()
      }
    },

    activeRuns(): number {
      return inFlight.size
    },

    cleanupReport(): ExecutorCleanupReport {
      return Object.freeze({
        clean: totalCleanup === 0,
        total: totalCleanup,
        retained: Object.freeze([...retainedCleanup]),
      })
    },

    dispose(): Promise<void> {
      // The whole body up to the first `await` runs synchronously, so by the
      // time any caller can observe the runtime again it is already refusing
      // new runs and every owned controller has been aborted exactly once.
      disposal ??= (async (): Promise<void> => {
        entries.clear()
        const active = [...inFlight]
        for (const { controller } of active) controller.abort()
        // `allSettled` because a run that ends by throwing still ended; the
        // caller's own promise carries that error, and disposal reports
        // quiescence rather than a verdict on the work.
        await Promise.allSettled(active.map(({ settled }) => settled))
      })()
      return disposal
    },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    executors: ExecutorRuntime
  }
}

/** Cordis service exposing the executor runtime as `ctx.executors`. */
export class ExecutorRuntime extends Service implements HarnessExecutorRuntime {
  private readonly runtime = createExecutorRuntime()

  /**
   * Create and install the executor runtime service.
   * @param ctx - Cordis context that owns the service.
   */
  constructor(ctx: Context) {
    super(ctx, 'executors')
  }

  /**
   * Register one provider under its declared name.
   * @param provider - the provider to register.
   * @returns a handle whose disposal unregisters exactly this registration.
   */
  register(provider: ExecutorProvider): ExecutorRegistration {
    return this.runtime.register(provider)
  }

  /**
   * Look one provider up by name.
   * @param name - the registered provider name.
   * @returns the provider.
   */
  get(name: string): ExecutorProvider {
    return this.runtime.get(name)
  }

  /**
   * List every registered provider.
   * @returns the providers, ordered by registration.
   */
  list(): readonly ExecutorProvider[] {
    return this.runtime.list()
  }

  /**
   * Validate a request and dispatch it to the routed provider.
   * @param request - the resolved request.
   * @returns the provider's bounded result.
   */
  start(request: ExecutorStartRequest): Promise<ExecutorResult> {
    return this.runtime.start(request)
  }

  /**
   * Count runs currently in flight.
   * @returns the number of active runs.
   */
  activeRuns(): number {
    return this.runtime.activeRuns()
  }

  /**
   * Report what this runtime has seen of its providers' teardown.
   * @returns the standing cleanup evidence.
   */
  cleanupReport(): ExecutorCleanupReport {
    return this.runtime.cleanupReport()
  }

  /**
   * End every run in flight when the owning context stops, and wait for them.
   *
   * Returned rather than fired off, so Cordis holds the fiber open until the
   * runtime is actually quiet: a context that finished stopping while a
   * provider was still killing a process tree would leave that tree orphaned
   * with nothing left to attribute it to.
   * @returns Nothing; resolves when the runtime is quiet.
   */
  stop(): Promise<void> {
    return this.runtime.dispose()
  }

  /**
   * Unregister every provider, abort every run in flight, and wait for them.
   * @returns Nothing; resolves when the runtime is quiet.
   */
  dispose(): Promise<void> {
    return this.runtime.dispose()
  }
}
