/**
 * The routing mechanism's own types: what a policy is resolved against, and
 * what goes wrong when it cannot be.
 *
 * @module @trick-harness/routing
 */

import type { RoutingContext } from '@trick-harness/contracts'

/**
 * Semantic tier to the product-native model that serves it.
 *
 * The indirection is the point. A workflow names `codex.frontier`, never a
 * model id, so a model generation change is one edit here rather than a rewrite
 * across every project's policy table — and the decision of *what* frontier
 * means for a product stays in one place a reviewer can read end to end.
 */
export type ModelRegistry = Readonly<Record<string, string>>

/** Everything the router needs to turn one context into one decision. */
export interface RoutingPolicy {
  /** `<name>-v<major>.<minor>.<patch>`, recorded on every decision it produces. */
  readonly policyVersion: string
  /** Primary rules, ordered most-specific first. */
  readonly rules: readonly PolicyRule[]
  /** Rules consulted when a primary executor cannot serve the run. */
  readonly fallbackRules: readonly PolicyRule[]
  /** Tier-to-model resolution for this run. */
  readonly registry: ModelRegistry
}

/** One deterministic policy row, structurally the profile's `PolicyRuleDefinition`. */
export interface PolicyRule {
  readonly id: string
  readonly when: Readonly<Record<string, string | number | boolean>>
  readonly use: Readonly<Record<string, string | number | boolean>>
}

/**
 * The routing facts a rule's `when` may match on.
 *
 * A closed set, and unknown keys are rejected rather than ignored. A rule
 * matching on a fact nobody supplies would never fire, and a rule that never
 * fires is indistinguishable from a rule that always agrees — the policy would
 * look like it covered a case it silently did not.
 */
export const MATCHABLE_FACTS = [
  'role',
  'taskClass',
  'workload',
  'risk',
  'writeVolume',
  'independenceRequirement',
  'implementationExecutor',
  'priorAttempts',
  'unavailable',
] as const

/** One matchable fact name. */
export type MatchableFact = typeof MATCHABLE_FACTS[number]

/** The flattened facts one routing context presents to the rule table. */
export type RoutingFacts = Readonly<Partial<Record<MatchableFact, string | number | boolean>>>

/** A policy the router cannot apply, or a context it cannot route. */
export class RoutingError extends Error {
  /** Machine-readable cause, so a caller can distinguish policy bugs from bad input. */
  readonly code: 'unknown-fact' | 'unknown-tier' | 'no-rule' | 'incomplete-rule' | 'permission-escalation' | 'invalid-override'

  /**
   * @param code - Machine-readable cause.
   * @param message - What went wrong, stated without quoting caller data.
   */
  constructor(code: RoutingError['code'], message: string) {
    super(message)
    this.name = 'RoutingError'
    this.code = code
  }
}

/** Re-exported for the router's own signature. */
export type { RoutingContext }
