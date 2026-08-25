/** Package-owned project-profile invariants. @module @trick-harness/profile/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { ProfileValidationError, validateProfile } from './index.ts'

const PACKAGE_NAME = '@trick-harness/profile'

/** Cordis companion plugin name. */
export const name = 'profile-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Check every profile a runtime currently holds.
 *
 * The registry validates on registration, so this re-check exists to catch the
 * cases registration cannot see: a profile mutated in place after the fact, and
 * two profiles that pass validation individually while colliding on the policy
 * version that route decisions are attributed to.
 */
function validateRegistered(ctx: Context, fail: InvariantFailure): void {
  const policyVersions = new Map<string, string>()
  for (const profile of ctx.profiles.list()) {
    try {
      validateProfile(profile)
    } catch (cause) {
      if (!(cause instanceof ProfileValidationError)) throw cause
      fail(`registered profile ${JSON.stringify(profile.id)} is invalid: ${cause.message}`)
    }
    const owner = policyVersions.get(profile.policyVersion)
    if (owner !== undefined) {
      fail(`profiles ${JSON.stringify(owner)} and ${JSON.stringify(profile.id)} share policy version ${JSON.stringify(profile.policyVersion)}`)
    }
    policyVersions.set(profile.policyVersion, profile.id)
  }
}

/** Install validation for the profiles registered on this runtime. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  validateRegistered(ctx, fail)
  ctx.on('internal/service', () => validateRegistered(ctx, fail), { global: true })
}, { inject: ['profiles'] })

/**
 * Register the profile invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
