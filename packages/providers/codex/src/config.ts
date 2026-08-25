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
 * Error-info variants for which another attempt, here or elsewhere, is valid.
 *
 * Every name is an app-server `codexErrorInfo` variant parsed by the upstream
 * wire. The membership question is not "was this bad" but "does the executor's
 * reachability explain it": a quota ceiling, a session budget, an overloaded
 * or erroring server, and the four transport variants are all states that
 * change on their own or on a different executor. Everything else is a
 * property of the request, the workspace, or the account, and would fail the
 * same way on a fallback route — so retrying would waste a second run and
 * report the wrong cause.
 */
const AVAILABILITY_CATEGORIES: ReadonlySet<string> = new Set([
  'usageLimitExceeded',
  'sessionBudgetExceeded',
  'serverOverloaded',
  'internalServerError',
  'httpConnectionFailed',
  'responseStreamConnectionFailed',
  'responseStreamDisconnected',
  'responseTooManyFailedAttempts',
])

/**
 * Variants that must never be read as an availability problem.
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
 * Decide whether a Codex error-info variant means "try again or try elsewhere".
 * @param category - the parsed `codexErrorInfo` variant or stage category.
 * @returns true when the executor's reachability explains the failure.
 */
export function isAvailabilityFailure(category: string): boolean {
  return AVAILABILITY_CATEGORIES.has(category)
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
  return {
    category,
    availability: isAvailabilityFailure(category),
    safeDiagnostic: `codex run failed (${category})`,
    ...httpStatus === undefined ? {} : { httpStatus },
  }
}
