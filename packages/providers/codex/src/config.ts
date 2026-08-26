/**
 * Route translation and failure classification for the Codex provider.
 *
 * @module @trick-harness/provider-codex/config
 */

import type { CodexRoutedSandbox } from '@deepseek-ai/dsh-subagent-codex'
import type { ExecutorFailure, ExecutorPermissionMode } from '@trick-harness/executor'

/** A route this provider cannot express on the Codex wire. */
export class CodexRouteError extends Error {
  /** Stable failure category for a route the provider refuses. */
  readonly code = 'CODEX_ROUTE'

  /** @param message - a safe, credential-free reason. */
  constructor(message: string) {
    super(message)
    this.name = 'CodexRouteError'
  }
}

/**
 * Translate an executor permission mode to a Codex sandbox mode.
 *
 * The names coincide because `ThreadStartParams.sandbox` is a `SandboxMode`
 * whose schema enum is `read-only | workspace-write | danger-full-access`, and
 * the executor contract's two modes are the first two of those. The mapping is
 * still written out rather than passed through: the two vocabularies are owned
 * by different projects and are free to diverge, and a silent pass-through
 * would turn that divergence into a wrong sandbox rather than a failed build.
 * @param mode - the route's requested filesystem authority.
 * @returns the Codex sandbox mode to emit on `thread/start`.
 * @throws CodexRouteError when the mode has no Codex equivalent.
 */
export function sandboxMode(mode: ExecutorPermissionMode): CodexRoutedSandbox {
  switch (mode) {
    case 'read-only':
      return 'read-only'
    case 'workspace-write':
      return 'workspace-write'
    default:
      throw new CodexRouteError(`unsupported permission mode ${JSON.stringify(String(mode))}`)
  }
}

/**
 * Every Codex error-info variant this provider recognises, and the routing
 * category it becomes.
 *
 * This is the whole translation, written as data, because the two vocabularies
 * belong to different projects. Codex names variants in camelCase and is free
 * to add more; `@trick-harness/routing` classifies a closed kebab-case set and
 * refuses anything outside it. Nothing derives one from the other by case
 * conversion: a rename upstream would then silently produce a category the
 * classifier rejects at the moment an executor is already failing.
 *
 * The membership question for the availability half is not "was this bad" but
 * "does the executor's reachability explain it": a quota ceiling, a session
 * budget, an overloaded or erroring server, and the four transport variants are
 * all states that change on their own or on a different executor. The rest are
 * properties of the request, the workspace, or the account, and would fail the
 * same way on a fallback route.
 */
const CODEX_FAILURE_MAP: Readonly<Record<string, string>> = Object.freeze({
  usageLimitExceeded: 'usage-limit-exceeded',
  sessionBudgetExceeded: 'session-budget-exceeded',
  serverOverloaded: 'server-overloaded',
  internalServerError: 'internal-server-error',
  httpConnectionFailed: 'transport-unavailable',
  responseStreamConnectionFailed: 'transport-unavailable',
  responseStreamDisconnected: 'transport-unavailable',
  responseTooManyFailedAttempts: 'transport-unavailable',
  contextWindowExceeded: 'context-window-exceeded',
  badRequest: 'bad-request',
  sandboxError: 'sandbox-denied',
  activeTurnNotSteerable: 'bad-request',
  cyberPolicy: 'cyber-policy-refusal',
  unauthorized: 'unauthorized',
  threadRollbackFailed: 'other',
})

/**
 * What an unrecognised variant becomes.
 *
 * Fail-closed on purpose: an unknown fault is reported as a real failure that
 * may not be routed around. Mapping it to an availability category instead
 * would let any future upstream variant launder itself into a second run on
 * another product.
 */
const UNRECOGNISED = 'other'

/** The routing categories that mean the executor could not serve the run. */
const AVAILABILITY_CATEGORIES: ReadonlySet<string> = new Set([
  'usage-limit-exceeded',
  'session-budget-exceeded',
  'server-overloaded',
  'internal-server-error',
  'transport-unavailable',
])

/**
 * The native variants this provider asserts are never availability failures.
 *
 * Listed explicitly rather than left to the default so the distinction is
 * asserted by the package's tests. `contextWindowExceeded` and `badRequest`
 * describe the request; `sandboxError` and `activeTurnNotSteerable` describe
 * the run's own state; `cyberPolicy` is a refusal; `unauthorized` needs a
 * human to fix an account, not a retry; `threadRollbackFailed` is a product
 * fault a second identical attempt reproduces. A completed run that did poor
 * work is not a failure at all and never reaches this map.
 */
const QUALITY_CATEGORIES: readonly string[] = [
  'contextWindowExceeded',
  'badRequest',
  'sandboxError',
  'activeTurnNotSteerable',
  'cyberPolicy',
  'unauthorized',
  'threadRollbackFailed',
]

/** The categories this provider asserts are never availability failures. */
export const NON_AVAILABILITY_CATEGORIES = QUALITY_CATEGORIES

/**
 * Translate one Codex error-info variant into the routing vocabulary.
 * @param category - the parsed `codexErrorInfo` variant, or any opaque string.
 * @returns the normalized routing category.
 */
export function normalizeFailure(category: string): string {
  return CODEX_FAILURE_MAP[category] ?? UNRECOGNISED
}

/**
 * Decide whether a Codex error-info variant means "try again or try elsewhere".
 * @param category - the parsed `codexErrorInfo` variant or stage category.
 * @returns true when the executor's reachability explains the failure.
 */
export function isAvailabilityFailure(category: string): boolean {
  return AVAILABILITY_CATEGORIES.has(normalizeFailure(category))
}

/**
 * Build the safe structured failure for a non-completed run.
 *
 * The diagnostic is composed from the parsed facts rather than forwarded from
 * the child, so no product prose, stderr, path, or protocol payload can reach
 * a durable event log through this value.
 * @param category - the parsed variant, or `unknown` when the text was opaque.
 * @param httpStatus - the upstream status when the failure carried one.
 * @returns the executor-facing failure.
 */
export function executorFailure(category: string, httpStatus?: number): ExecutorFailure {
  const normalized = normalizeFailure(category)
  return {
    category: normalized,
    availability: AVAILABILITY_CATEGORIES.has(normalized),
    safeDiagnostic: `codex run failed (${normalized})`,
    ...httpStatus === undefined ? {} : { httpStatus },
  }
}
