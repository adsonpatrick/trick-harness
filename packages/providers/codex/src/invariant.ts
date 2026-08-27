/** Package-owned Codex provider invariants. @module @trick-harness/provider-codex/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@trick-harness/provider-codex'

/**
 * The provider name and permission modes this companion expects to find.
 *
 * Restated rather than imported from `./index.ts` on purpose: an invariant that
 * imports the value it validates cannot detect a change to that value, it can
 * only agree with whatever the package now claims. The package's own tests hold
 * the two views in step, so drift surfaces as a failing test rather than as a
 * silently weakened check.
 */
/** The provider name this companion expects to find registered. */
export const EXPECTED_EXECUTOR = 'codex'
/** The permission modes this companion expects the provider to declare. */
export const EXPECTED_PERMISSION_MODES: readonly string[] = ['read-only', 'workspace-write']

/** Cordis companion plugin name. */
export const name = 'provider-codex-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Check what this provider claims against what the Codex wire can express.
 *
 * The executor runtime refuses or dispatches a route on the strength of these
 * three declarations alone. A `permissionModes` entry this package cannot map
 * to a `SandboxMode` would be dispatched and then fail after a process had
 * already started; a withdrawn model or effort override would leave every
 * routed run's durable route fact naming a selection that never reached the
 * wire. Both are checked rather than assumed.
 * @param ctx - Cordis context carrying the executor registry.
 * @param fail - report a violation.
 */
function validateProvider(ctx: Context, fail: InvariantFailure): void {
  const registered = ctx.executors.list().find(entry => entry.name === EXPECTED_EXECUTOR)
  if (registered === undefined) return
  if (!registered.capabilities.modelOverride) {
    fail('codex provider declares no model override, but emits one on turn/start')
  }
  if (!registered.capabilities.reasoningEffort) {
    fail('codex provider declares no reasoning-effort support, but emits one on turn/start')
  }
  for (const mode of registered.capabilities.permissionModes) {
    if (!EXPECTED_PERMISSION_MODES.includes(mode)) {
      fail(`codex provider declares permission mode ${JSON.stringify(mode)}, which it cannot map`)
    }
  }
}

/** Install validation for the Codex provider on this runtime. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  validateProvider(ctx, fail)
  ctx.on('internal/service', () => { validateProvider(ctx, fail) }, { global: true })
}, { inject: ['executors'] })

/**
 * Register the Codex provider invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
