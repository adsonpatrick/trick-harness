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

/**
 * What reasoning effort each routed tier is asked for.
 *
 * Read off the profile's own routing table for the same reason the tiers are:
 * an effort written into a rule is a demand this deployment has to be able to
 * meet, and a list of demands maintained beside the table would drift from it
 * silently. A tier no rule states an effort for is absent rather than empty —
 * the policy asked for nothing, and inventing a default would refuse a
 * deployment over a demand nobody made.
 *
 * @param profile - the profile whose routing policy is being served.
 * @returns tier name to the efforts its rules ask for, for tiers that ask.
 */
export function requestedEfforts(profile: HarnessProfile): ReadonlyMap<string, readonly string[]> {
  const wanted = new Map<string, string[]>()
  for (const rule of [...profile.routingPolicy.rules, ...profile.routingPolicy.fallbackRules]) {
    const tier = rule.use['tier']
    const effort = rule.use['effort']
    if (typeof tier !== 'string' || typeof effort !== 'string') continue
    const efforts = wanted.get(tier) ?? []
    if (!efforts.includes(effort)) efforts.push(effort)
    wanted.set(tier, efforts)
  }
  return wanted
}

/**
 * Read-only access to what the signed-in accounts can actually be asked for.
 *
 * Both halves are native catalogues: OpenCode's own provider configuration and
 * Codex's `model/list`. Neither is a list this repository maintains, because a
 * list maintained here would go stale silently and a stale one is worse than
 * none — it would pass boot and fail the run.
 */
export interface ModelCatalogReader {
  /** Every `provider/model` pair the authenticated OpenCode server offers. */
  opencodeModels(): Promise<readonly string[]>
  /** Every model the authenticated Codex account advertises. */
  codexModels(): Promise<readonly { id: string; reasoningEfforts: readonly string[] }[]>
}

/** The native catalogues a routed tier can be served from. */
type Catalogue = 'codex' | 'opencode'

/**
 * Which native catalogue each routed tier is served from.
 *
 * Taken from the executor the routing rule names, not from the tier's spelling:
 * the tier string is a label the profile chose, and reading a `codex.` prefix as
 * proof of a Codex route would validate against the wrong account the first time
 * someone names a tier for what it does rather than for who runs it.
 *
 * @param profile - the profile whose routing table is being served.
 * @returns tier name to catalogue, for every tier the table routes to.
 */
function tierCatalogues(profile: HarnessProfile): ReadonlyMap<string, Catalogue> {
  const catalogues = new Map<string, Catalogue>()
  for (const rule of [...profile.routingPolicy.rules, ...profile.routingPolicy.fallbackRules]) {
    const tier = rule.use['tier']
    const executor = rule.use['executor']
    if (typeof tier !== 'string') continue
    if (executor === 'codex' || executor === 'opencode') catalogues.set(tier, executor)
  }
  return catalogues
}

/**
 * Check every routed tier against the native catalogue that has to serve it.
 *
 * This is the gate that separates "the deployment names a model" from "the
 * account can be asked for it". A registry can be complete and still be wrong —
 * a typo, a model retired upstream, an account that never had access — and
 * every one of those failures would otherwise land mid-run on the stage that
 * needed the model, long after the boot that could have refused.
 *
 * A catalogue is read at most once, and only when some tier is served from it,
 * so a deployment that routes nowhere near Codex never touches a Codex account.
 *
 * @param registry - the tier-to-model registry this deployment would run with.
 * @param profile - the profile whose routing table the registry has to serve.
 * @param reader - read-only access to the native catalogues.
 * @throws {ModelRegistryError} when any routed tier does not resolve natively.
 */
export async function assertModelsAvailable(
  registry: ModelRegistry,
  profile: HarnessProfile,
  reader: ModelCatalogReader,
): Promise<void> {
  const catalogues = tierCatalogues(profile)
  const wanted = new Map<Catalogue, string[]>()
  const failures: string[] = []
  for (const tier of routedTiers(profile)) {
    const model = registry[tier]?.trim() ?? ''
    const catalogue = catalogues.get(tier)
    if (model === '') failures.push(`${tier} names no model`)
    else if (catalogue === undefined) failures.push(`${tier} is routed to no known executor`)
    else wanted.set(catalogue, [...wanted.get(catalogue) ?? [], tier])
  }

  const efforts = requestedEfforts(profile)
  for (const [catalogue, tiers] of wanted) {
    // Kept per model rather than unioned across the catalogue: one read serves
    // every tier on this account, and an effort checked against the union would
    // pass a model advertising none of it as long as some other model did.
    const advertised = new Map((await read(catalogue, reader)).map(model => [model.id, model.reasoningEfforts]))
    for (const tier of tiers) {
      const model = registry[tier]?.trim() ?? ''
      const supported = advertised.get(model)
      if (supported === undefined) {
        failures.push(`${tier} wants a ${catalogue} model this account cannot be asked for`)
        continue
      }
      // Refused rather than served at whatever the model does advertise: a
      // silent downgrade is this host deciding a stage may reason less than the
      // approved policy says it must, with nothing in the run saying so.
      const unmet = (efforts.get(tier) ?? []).filter(effort => !supported.includes(effort))
      if (unmet.length > 0) {
        failures.push(`${tier} is routed at reasoning effort ${unmet.join(', ')} and its model advertises no such effort`)
      }
    }
  }

  if (failures.length > 0) {
    throw new ModelRegistryError(
      `profile ${JSON.stringify(profile.id)} cannot be served as deployed: ${failures.join('; ')}`,
    )
  }
}

/**
 * Read one native catalogue, reporting a failure without carrying it out.
 *
 * The cause is dropped deliberately: a catalogue read fails through an
 * authenticated client, and its error can carry a token, a header or a server
 * URL. This message reaches a boot log, so it says which catalogue went dark
 * and nothing else.
 *
 * @param catalogue - which native catalogue to read.
 * @param reader - read-only access to the native catalogues.
 * @returns what the catalogue advertises, model by model.
 * @throws {ModelRegistryError} when the catalogue could not be read.
 */
async function read(
  catalogue: Catalogue,
  reader: ModelCatalogReader,
): Promise<readonly { id: string; reasoningEfforts: readonly string[] }[]> {
  try {
    // OpenCode's provider configuration states no reasoning effort, and the
    // routing table asks none of it. An empty list is what it advertises, not a
    // gap this host fills in with a guess.
    if (catalogue === 'opencode') return (await reader.opencodeModels()).map(id => ({ id, reasoningEfforts: [] }))
    return await reader.codexModels()
  } catch {
    throw new ModelRegistryError(`the ${catalogue} model catalogue could not be read, so nothing was validated`)
  }
}
