/**
 * The tier-to-model registry this deployment runs with.
 *
 * The routing policy speaks in semantic tiers and never in model ids, so the
 * registry is where a tier becomes a model a product can actually be asked for.
 * That makes it the one place a deployment can silently under-serve the policy:
 * a tier the policy routes to and the registry does not name is a route that
 * cannot dispatch, and it fails at the moment a run reaches that stage rather
 * than at boot. So the registry is checked against the profile's own table
 * rather than against a list maintained beside it — a routing rule added to the
 * profile shows up here as a boot failure, not as a surprise mid-run.
 *
 * @module apps/plurora-harness-host/model-registry
 */

import type { ModelRegistry } from '@trick-harness/routing'
import type { HarnessProfile } from '@trick-harness/profile'
import type { PluroraDeploymentConfig } from './config.ts'

/** Raised when the registry does not serve the tiers the profile routes to. */
export class ModelRegistryError extends Error {
  override readonly name = 'ModelRegistryError'
}

/**
 * Every semantic tier the profile's routing table can ask for.
 *
 * Both the primary rules and the fallback rules count: a fallback tier missing
 * from the registry turns an executor outage — already the worst moment — into
 * an undispatchable route.
 *
 * @param profile - the profile whose routing policy is being served.
 * @returns the distinct tier names, in the order the table first names them.
 */
export function routedTiers(profile: HarnessProfile): readonly string[] {
  const rules = [...profile.routingPolicy.rules, ...profile.routingPolicy.fallbackRules]
  // A `use` row is a flat scalar map, so `tier` is only a tier when it is a
  // string. A row that names none resolves no model and is not this gate's
  // business; a row that names a number is a malformed profile, and passing it
  // through as `"3"` would invent a tier nobody wrote.
  const tiers = rules.map(rule => rule.use['tier']).filter(tier => typeof tier === 'string')
  return [...new Set(tiers)]
}

/**
 * Build the registry this deployment runs with, refusing an incomplete one.
 *
 * @param config - the validated deployment config.
 * @param profile - the profile whose routing policy the registry has to serve.
 * @returns the tier-to-model registry.
 * @throws {ModelRegistryError} when a routed tier has no model behind it.
 */
export function buildModelRegistry(config: PluroraDeploymentConfig, profile: HarnessProfile): ModelRegistry {
  const missing = routedTiers(profile).filter(tier => config.modelRegistry[tier] === undefined)
  if (missing.length > 0) {
    throw new ModelRegistryError(
      `profile ${JSON.stringify(profile.id)} routes to ${missing.join(', ')}, `
      + 'and this deployment names no model for them',
    )
  }
  return Object.freeze({ ...config.modelRegistry })
}
