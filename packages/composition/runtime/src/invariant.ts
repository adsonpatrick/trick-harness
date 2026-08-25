/** Package-owned composition invariants. @module @trick-harness/composition/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@trick-harness/composition'

/**
 * The routing field this companion expects a policy row to select an executor
 * with.
 *
 * Restated rather than imported from `./index.ts` on purpose: an invariant that
 * imports the value it validates cannot detect a change to that value, it can
 * only agree with whatever the package now claims. The package's own tests hold
 * the two views in step, so drift surfaces as a failing test rather than as a
 * silently weakened check.
 */
export const EXECUTOR_FIELD = 'executor'

/** Cordis companion plugin name. */
export const name = 'bundle-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Check that every executor a registered profile can route to exists.
 *
 * This is the one thing composition is for, and it is checked against the live
 * runtime rather than against the options a bundle was built from: a profile
 * registered later, or a provider disposed by a scope unload, changes the
 * answer without any bundle call being made. A fallback row is included,
 * because a fallback is dispatched exactly when something has already failed.
 * @param ctx - Cordis context carrying the executor and profile registries.
 * @param fail - report a violation.
 */
function validateComposition(ctx: Context, fail: InvariantFailure): void {
  const profiles = ctx.profiles.list()
  if (profiles.length === 0) return
  const registered = new Set(ctx.executors.list().map(provider => provider.name))
  if (registered.size === 0) return
  for (const profile of profiles) {
    const { rules, fallbackRules } = profile.routingPolicy
    for (const rule of [...rules, ...fallbackRules]) {
      const executor = rule.use[EXECUTOR_FIELD]
      if (typeof executor !== 'string' || registered.has(executor)) continue
      fail(
        `profile ${JSON.stringify(profile.id)} rule ${JSON.stringify(rule.id)} routes to unregistered executor ${JSON.stringify(executor)}`,
      )
    }
  }
}

/** Install composition validation on this runtime. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  validateComposition(ctx, fail)
  ctx.on('internal/service', () => { validateComposition(ctx, fail) }, { global: true })
}, { inject: ['executors', 'profiles'] })

/**
 * Register the composition invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
