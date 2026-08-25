/** Package-owned OpenCode provider invariants. @module @trick-harness/provider-opencode/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@trick-harness/provider-opencode'

/**
 * The provider name and the permission modes this companion expects to find.
 *
 * These are restated rather than imported from `./index.ts` on purpose. An
 * invariant that imports the very value it validates cannot detect a change to
 * that value — it would simply agree with whatever the package now claims. The
 * package's own tests assert these two views still match, so drift surfaces as
 * a failing test rather than as a silently weakened check.
 */
/** The provider name this companion expects to find registered. */
export const EXPECTED_EXECUTOR = 'opencode'
/** The permission modes this companion expects the provider to declare. */
export const EXPECTED_PERMISSION_MODES: readonly string[] = ['read-only', 'workspace-write']

/** Cordis companion plugin name. */
export const name = 'provider-opencode-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Check what this provider claims it can honour against what it can express.
 *
 * The executor runtime trusts a provider's declared capabilities and refuses a
 * route on that basis alone. If this package ever declared `reasoningEffort`
 * true, the runtime would dispatch efforts that `@opencode-ai/sdk` has no field
 * to carry, and every such run's durable route fact would name an effort that
 * was silently dropped. The declaration is therefore checked, not assumed.
 * @param ctx - Cordis context carrying the executor registry.
 * @param fail - report a violation.
 */
function validateProvider(ctx: Context, fail: InvariantFailure): void {
  const registered = ctx.executors.list().find(entry => entry.name === EXPECTED_EXECUTOR)
  if (registered === undefined) return
  if (registered.capabilities.reasoningEffort) {
    fail('opencode provider declares reasoning-effort support, which its SDK has no field for')
  }
  if (!registered.capabilities.modelOverride) {
    fail('opencode provider declares no model override, but supplies a model on every prompt')
  }
  for (const mode of registered.capabilities.permissionModes) {
    if (!EXPECTED_PERMISSION_MODES.includes(mode)) {
      fail(`opencode provider declares permission mode ${JSON.stringify(mode)}, which it cannot map`)
    }
  }
}

/** Install validation for the OpenCode provider on this runtime. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  validateProvider(ctx, fail)
  ctx.on('internal/service', () => { validateProvider(ctx, fail) }, { global: true })
}, { inject: ['executors'] })

/**
 * Register the OpenCode provider invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
