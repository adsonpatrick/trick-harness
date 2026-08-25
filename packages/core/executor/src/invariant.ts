/** Package-owned executor registry invariants. @module @trick-harness/executor/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@trick-harness/executor'

/** Permission modes the executor contract defines. */
const PERMISSION_MODES = new Set(['read-only', 'workspace-write'])

/** Cordis companion plugin name. */
export const name = 'executor-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Check that the registry's view of its providers stays internally consistent.
 *
 * Registration already validates a provider's declared shape. What it cannot
 * see is drift afterwards: a descriptor mutated in place, or a provider whose
 * registered name stops matching the key it is reachable under. Either one
 * makes a durable route fact name something other than what ran.
 */
function validateRegistry(ctx: Context, fail: InvariantFailure): void {
  const seen = new Set<string>()
  for (const provider of ctx.executors.list()) {
    if (typeof provider.name !== 'string' || provider.name === '') {
      fail('registered executor provider has no usable name')
    }
    if (seen.has(provider.name)) {
      fail(`executor provider name ${JSON.stringify(provider.name)} is registered more than once`)
    }
    seen.add(provider.name)
    if (ctx.executors.get(provider.name) !== provider) {
      fail(`executor provider ${JSON.stringify(provider.name)} is not reachable under its own name`)
    }
    const modes = provider.capabilities.permissionModes
    if (modes.length === 0) {
      fail(`executor provider ${JSON.stringify(provider.name)} enforces no permission mode`)
    }
    for (const mode of modes) {
      if (!PERMISSION_MODES.has(mode)) {
        fail(`executor provider ${JSON.stringify(provider.name)} declares unknown permission mode ${JSON.stringify(mode)}`)
      }
    }
  }
  if (ctx.executors.activeRuns() < 0) fail('executor runtime reports a negative active-run count')
}

/** Install validation for the executor providers registered on this runtime. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  validateRegistry(ctx, fail)
  ctx.on('internal/service', () => { validateRegistry(ctx, fail) }, { global: true })
}, { inject: ['executors'] })

/**
 * Register the executor invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
