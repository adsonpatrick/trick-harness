/** Package-owned routing invariants. @module @trick-harness/routing/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { DEFAULT_MODEL_REGISTRY, MATCHABLE_FACTS } from './index.ts'

const PACKAGE_NAME = '@trick-harness/routing'

/** Cordis companion plugin name. */
export const name = 'routing-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * The tiers every shipped registry must serve, restated rather than imported.
 *
 * A policy table names tiers; a registry resolves them. Dropping a tier from
 * the registry does not break a build — it breaks one route, at dispatch, for
 * whichever run happened to ask for it. Stating the set here turns that into a
 * startup failure.
 */
const EXPECTED_TIERS = [
  'codex.fast',
  'codex.balanced',
  'codex.frontier',
  'opencode.reasoning-fast',
  'opencode.workhorse',
]

/** The matchable-fact set restated; see {@link EXPECTED_TIERS}. */
const EXPECTED_FACTS = [
  'role',
  'taskClass',
  'workload',
  'risk',
  'writeVolume',
  'independenceRequirement',
  'implementationExecutor',
  'priorAttempts',
  'unavailable',
]

/** Check the routing mechanism's own shipped tables. */
const install: InvariantInstaller = (_ctx: Context, fail: InvariantFailure) => {
  for (const tier of EXPECTED_TIERS) {
    const model = DEFAULT_MODEL_REGISTRY[tier]
    if (model === undefined || model.trim().length === 0) {
      fail(`the default model registry no longer resolves semantic tier ${JSON.stringify(tier)}`)
    }
  }
  for (const tier of Object.keys(DEFAULT_MODEL_REGISTRY)) {
    if (!EXPECTED_TIERS.includes(tier)) {
      fail(`the default model registry serves tier ${JSON.stringify(tier)} that no policy was told about`)
    }
  }
  if (
    MATCHABLE_FACTS.length !== EXPECTED_FACTS.length
    || !MATCHABLE_FACTS.every((fact, index) => fact === EXPECTED_FACTS[index])
  ) {
    // Widening this set silently is the failure mode that matters: a rule
    // matching on a fact nobody supplies never fires, and a rule that never
    // fires reads exactly like one that always agrees.
    fail(`the matchable routing facts no longer match the set pinned here: got ${MATCHABLE_FACTS.join(', ')}`)
  }
}

/**
 * Register the routing invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
