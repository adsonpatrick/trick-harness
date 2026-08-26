/**
 * Deterministic executor routing.
 *
 * `route` is a pure function: one context and one policy in, one
 * {@link RouteDecision} out, with no process started, no product contacted, and
 * nothing recorded. That is deliberate. A model may classify an ambiguous task
 * and its classification may reach the context, but the route itself is a
 * versioned policy decision — reproducible from the same inputs, explainable
 * afterwards from `reasonCodes` and `policyVersion` alone.
 *
 * @module @trick-harness/routing
 */

import { READ_ONLY_ROLES } from '@trick-harness/contracts'
import type { RouteDecision, RoutedPermissionMode, RoutingContext } from '@trick-harness/contracts'
import { MATCHABLE_FACTS, RoutingError } from './types.ts'
import type { ModelRegistry, PolicyRule, RoutingFacts, RoutingPolicy } from './types.ts'

export * from './types.ts'

/**
 * The tier aliases this repository ships, as of 2026-08-25.
 *
 * Shipped here and not in a project's policy table because which model serves
 * `codex.frontier` is a fact about the product, not a choice one project makes.
 * Every consumer takes a registry as a parameter, so a deployment that
 * disagrees supplies its own without touching a workflow.
 */
export const DEFAULT_MODEL_REGISTRY: ModelRegistry = Object.freeze({
  'codex.fast': 'GPT-5.6 Luna',
  'codex.balanced': 'GPT-5.6 Terra',
  'codex.frontier': 'GPT-5.6 Sol',
  'opencode.reasoning-fast': 'DeepSeek V4 Flash',
  'opencode.workhorse': 'MiMo V2.5',
})

/**
 * Flatten a context into the facts a rule table may match on.
 *
 * Optional context fields are omitted rather than defaulted, so a rule matching
 * `implementationExecutor` simply does not fire when nothing implemented yet —
 * as against matching some stand-in value nobody wrote down.
 */
function factsOf(context: RoutingContext): RoutingFacts {
  return {
    role: context.role,
    workload: context.workload,
    risk: context.risk,
    writeVolume: context.writeVolume,
    independenceRequirement: context.independenceRequirement,
    priorAttempts: context.priorAttempts,
    ...context.taskClass === undefined ? {} : { taskClass: context.taskClass },
    ...context.implementationExecutor === undefined
      ? {}
      : { implementationExecutor: context.implementationExecutor },
  }
}

/**
 * Whether one rule matches the facts, rejecting a `when` key nobody supplies.
 * @param rule - The candidate rule.
 * @param facts - The flattened routing facts.
 * @returns True when every condition holds.
 * @throws {RoutingError} when the rule matches on a fact outside the closed set.
 */
function matches(rule: PolicyRule, facts: RoutingFacts): boolean {
  for (const [key, expected] of Object.entries(rule.when)) {
    if (!(MATCHABLE_FACTS as readonly string[]).includes(key)) {
      throw new RoutingError(
        'unknown-fact',
        `routing rule ${JSON.stringify(rule.id)} matches on unknown fact ${JSON.stringify(key)}`,
      )
    }
    if (facts[key as keyof RoutingFacts] !== expected) return false
  }
  return true
}

/** Read a required string field from a rule's `use` block. */
function used(rule: PolicyRule, key: string): string {
  const value = rule.use[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RoutingError(
      'incomplete-rule',
      `routing rule ${JSON.stringify(rule.id)} must state a non-empty ${key}`,
    )
  }
  return value
}

/** Read the optional reasoning effort a rule states. */
function usedEffort(rule: PolicyRule): string | undefined {
  return rule.use['effort'] === undefined ? undefined : used(rule, 'effort')
}

/**
 * The filesystem authority a role gets, which policy may state but never widen.
 *
 * Read-only is a property of the role. A reviewer that could edit would be
 * reviewing its own work, and a debugger that could edit would have turned
 * diagnosis into repair — so a policy row asking for write authority on such a
 * role is a policy bug, and is refused rather than quietly honoured or quietly
 * downgraded.
 * @param context - The run being routed.
 * @param rule - The matched rule, which may restate the mode but not raise it.
 * @returns The permission mode this run gets.
 * @throws {RoutingError} when a rule tries to grant a read-only role write access.
 */
function permissionFor(context: RoutingContext, rule: PolicyRule): RoutedPermissionMode {
  const required: RoutedPermissionMode = READ_ONLY_ROLES.includes(context.role) ? 'read-only' : 'workspace-write'
  const stated = rule.use['permissionMode']
  if (stated !== undefined && stated !== required) {
    throw new RoutingError(
      'permission-escalation',
      `routing rule ${JSON.stringify(rule.id)} states a permission mode role ${JSON.stringify(context.role)} may not have`,
    )
  }
  return required
}

/** Resolve one semantic tier through the registry, or refuse the route. */
function resolveModel(registry: ModelRegistry, tier: string): string {
  const model = registry[tier]
  if (model === undefined) {
    throw new RoutingError('unknown-tier', `no model is registered for semantic tier ${JSON.stringify(tier)}`)
  }
  return model
}

/**
 * Find the first rule that matches, in table order.
 *
 * First match wins, and rules are ordered most-specific first by the profile
 * that wrote them. The alternative — scoring specificity here — would make the
 * routing of a run depend on a ranking rule nobody can see in the diff.
 */
function firstMatch(rules: readonly PolicyRule[], facts: RoutingFacts): PolicyRule | undefined {
  return rules.find(rule => matches(rule, facts))
}

/**
 * Build the decision one matched rule produces.
 * @param context - The run being routed.
 * @param policy - The policy in force.
 * @param rule - The matched rule.
 * @param reasonCodes - Reasons accumulated so far, in order of application.
 * @returns The decision, with the tier resolved and the mode derived.
 */
function decide(
  context: RoutingContext,
  policy: RoutingPolicy,
  rule: PolicyRule,
  reasonCodes: readonly string[],
): RouteDecision {
  const tier = used(rule, 'tier')
  const effort = usedEffort(rule)
  return Object.freeze({
    executor: used(rule, 'executor'),
    semanticModelTier: tier,
    resolvedModel: resolveModel(policy.registry, tier),
    permissionMode: permissionFor(context, rule),
    reasonCodes: Object.freeze([...reasonCodes, `rule:${rule.id}`, `tier:${tier}`]),
    policyVersion: policy.policyVersion,
    ...effort === undefined ? {} : { reasoningEffort: effort },
  })
}

/**
 * Apply an explicit human override for one run.
 *
 * An override wins over the table, and only for the run it was given for — it
 * is not written back into policy and does not survive into the next stage. It
 * still resolves through the registry rather than naming a model directly, so
 * an override cannot attribute a run to a model this deployment does not serve,
 * and it still cannot raise a read-only role's authority.
 */
function overrideDecision(context: RoutingContext, policy: RoutingPolicy): RouteDecision | undefined {
  const override = context.userOverride
  if (override === undefined) return undefined
  if (override.executor.trim().length === 0) {
    throw new RoutingError('invalid-override', 'a routing override must name a non-empty executor')
  }
  const tier = override.semanticModelTier
  if (tier === undefined) {
    throw new RoutingError('invalid-override', 'a routing override must name the semantic tier it wants')
  }
  return Object.freeze({
    executor: override.executor,
    semanticModelTier: tier,
    resolvedModel: resolveModel(policy.registry, tier),
    permissionMode: READ_ONLY_ROLES.includes(context.role)
      ? ('read-only' as const)
      : ('workspace-write' as const),
    reasonCodes: Object.freeze(['override:user', `tier:${tier}`]),
    policyVersion: policy.policyVersion,
    ...override.reasoningEffort === undefined ? {} : { reasoningEffort: override.reasoningEffort },
  })
}

/**
 * Re-route a certifying stage away from the executor that did the work.
 *
 * Independence is what makes a review evidence of anything, so when the table's
 * first match lands on the implementer the router looks further down the same
 * table for a rule that matches and names someone else. When no such rule
 * exists the run is not failed here: a `independence:unsatisfied` reason code
 * is recorded instead, and the workflow decides whether a certification without
 * independence can still pass. Refusing to route would turn a missing second
 * opinion into an outage; hiding it would turn it into a false PASS.
 */
function independentAlternative(
  context: RoutingContext,
  policy: RoutingPolicy,
  facts: RoutingFacts,
  chosen: RouteDecision,
): RouteDecision | undefined {
  const implementer = context.implementationExecutor
  if (implementer === undefined || chosen.executor !== implementer) return undefined
  const requirement = context.independenceRequirement
  if (requirement === 'fresh-context') return undefined
  const alternative = policy.rules.find(rule =>
    matches(rule, facts) && rule.use['executor'] !== implementer)
    ?? policy.fallbackRules.find(rule =>
      matches(rule, { ...facts, unavailable: implementer }) && rule.use['executor'] !== implementer)
  if (alternative === undefined) return undefined
  return decide(context, policy, alternative, [`independence:${requirement}`])
}

/**
 * Route one run.
 * @param context - Everything the decision is allowed to depend on.
 * @param policy - The versioned rule table and its model registry.
 * @returns The decision, explainable from its own reason codes.
 * @throws {RoutingError} when the policy cannot be applied to this context.
 */
export function route(context: RoutingContext, policy: RoutingPolicy): RouteDecision {
  const override = overrideDecision(context, policy)
  if (override !== undefined) return override

  const facts = factsOf(context)
  const rule = firstMatch(policy.rules, facts)
  if (rule === undefined) {
    throw new RoutingError('no-rule', `no routing rule matches role ${JSON.stringify(context.role)}`)
  }
  const chosen = decide(context, policy, rule, [`role:${context.role}`])

  const independent = independentAlternative(context, policy, facts, chosen)
  if (independent !== undefined) return independent
  if (
    context.implementationExecutor === chosen.executor
    && context.independenceRequirement !== 'fresh-context'
  ) {
    return Object.freeze({
      ...chosen,
      reasonCodes: Object.freeze([...chosen.reasonCodes, 'independence:unsatisfied']),
    })
  }
  return chosen
}
