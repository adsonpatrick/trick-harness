/**
 * The executor capability: one resolved request, one product runtime, one
 * bounded result.
 *
 * This contract sits beside upstream's `SubagentRuntime` rather than extending
 * it. Routing needs per-run model and reasoning-effort selection; pushing those
 * fields into the generic upstream request would make every subagent consumer
 * carry Trick Harness routing concerns, and would make the upstream merge
 * surface wider every release. A parallel capability keeps the fork's
 * divergence to files the fork owns.
 *
 * @module @trick-harness/executor
 */

/** Reasoning budget requested for one run, in increasing order of cost. */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Filesystem authority granted to one run. */
export type ExecutorPermissionMode = 'read-only' | 'workspace-write'

/**
 * A fully resolved routing decision.
 *
 * `model` is a product-native model identifier, already resolved from whatever
 * semantic tier a profile named. By the time a route reaches an executor the
 * policy question is settled; a provider translates, it does not decide.
 */
export interface ExecutorRoute {
  /** Registered provider name this run is dispatched to. */
  readonly executor: string
  /** Product-native model id, absent when the product default is intended. */
  readonly model?: string
  /** Reasoning budget, absent when the product default is intended. */
  readonly reasoningEffort?: ReasoningEffort
  /** Filesystem authority for this run; always explicit, never defaulted. */
  readonly permissionMode: ExecutorPermissionMode
}

/** One unit of work handed to a provider. */
export interface ExecutorStartRequest {
  /** Absolute working directory the run is rooted in. */
  readonly cwd: string
  /** The task text delivered to the product runtime. */
  readonly task: string
  /** The resolved route. */
  readonly route: ExecutorRoute
  /** Cancellation signal; aborting must terminate the owned process tree. */
  readonly signal: AbortSignal
}

/**
 * What one provider can actually honour.
 *
 * Declared rather than discovered so an unsupported route fails before a
 * process is spawned. A provider that silently ignored an unsupported model
 * override would produce a run attributed to a model that never ran it, which
 * is worse than a refusal: the durable route fact would be a lie.
 */
export interface ExecutorCapabilities {
  /** Whether `route.model` is honoured per run. */
  readonly modelOverride: boolean
  /** Whether `route.reasoningEffort` is honoured per run. */
  readonly reasoningEffort: boolean
  /** Permission modes this provider can enforce; must be non-empty. */
  readonly permissionModes: readonly ExecutorPermissionMode[]
}

/**
 * A failure described in terms safe to log, store, and show.
 *
 * Deliberately not a place for raw stderr, environment, or credentials. A
 * provider talks to products the user is authenticated against; anything that
 * escapes here reaches durable event logs and PR comments.
 */
export interface ExecutorFailure {
  /** Stable machine-readable failure class. */
  readonly category: string
  /**
   * Whether the executor's own reachability explains this failure.
   *
   * Reachability and nothing else: a quota ceiling, an overloaded server, a
   * dropped transport. A deterministic refusal is not availability, however
   * inconvenient — a route the provider cannot express, a rejected request, an
   * account a human must fix. The distinction has to hold because this field
   * drives fallback routing, and a fallback spends a second run: taking it for
   * a refusal that a different executor would also make burns the budget and
   * records the wrong cause in the durable route fact.
   */
  readonly availability: boolean
  /** Redacted human-readable diagnostic. */
  readonly safeDiagnostic: string
  /** Upstream HTTP status when the failure came from an HTTP surface. */
  readonly httpStatus?: number
}

/** The bounded outcome of one run. */
export interface ExecutorResult {
  readonly status: 'completed' | 'aborted' | 'error'
  /** Final output only, never the child transcript. */
  readonly output: string
  /** Present exactly when `status` is `'error'`. */
  readonly failure?: ExecutorFailure
}

/** One product runtime, adapted to the executor contract. */
export interface ExecutorProvider {
  /** Registered name a route selects by. */
  readonly name: string
  /** What this provider honours per run. */
  readonly capabilities: ExecutorCapabilities
  /**
   * Run one request to completion.
   * @param request - the resolved request.
   * @returns the bounded result; provider errors surface as `status: 'error'`.
   */
  start(request: ExecutorStartRequest): Promise<ExecutorResult>
}

/** Registration handle scoped to the caller that registered the provider. */
export interface ExecutorRegistration {
  dispose(): void
}
