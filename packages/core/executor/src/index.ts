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
  ExecutorProvider,
  ExecutorRegistration,
  ExecutorResult,
  ExecutorStartRequest,
} from './types.ts'

export type * from './types.ts'

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
  /** Unregister every provider and abort every run in flight. */
  dispose(): void
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

/** One stored registration, identity-tagged so a stale handle is inert. */
interface ProviderEntry {
  readonly provider: ExecutorProvider
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
  const inFlight = new Set<AbortController>()
  let disposed = false

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
      if (disposed) throw new ExecutorProviderError('executor runtime is disposed')
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
      inFlight.add(controller)
      try {
        return await provider.start({ ...request, signal: controller.signal })
      } finally {
        request.signal.removeEventListener('abort', forward)
        inFlight.delete(controller)
      }
    },

    activeRuns(): number {
      return inFlight.size
    },

    dispose(): void {
      disposed = true
      entries.clear()
      for (const controller of inFlight) controller.abort()
      inFlight.clear()
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

  /** Abort every run in flight when the owning context stops. */
  stop(): void {
    this.runtime.dispose()
  }

  /** Unregister every provider and abort every run in flight. */
  dispose(): void {
    this.runtime.dispose()
  }
}
