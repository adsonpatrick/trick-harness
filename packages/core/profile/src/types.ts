/**
 * The generic project-policy seam.
 *
 * Core owns mechanism; a profile owns the project's choices. Everything here is
 * declarative data: deterministic tables a runtime reads, never model-authored
 * source a runtime executes. That is what keeps a profile reviewable and keeps
 * the trusted workflow state machine out of a profile's reach.
 *
 * @module @trick-harness/profile
 */

/**
 * One deterministic policy row: match the routing facts in `when`, apply `use`.
 *
 * Both sides are flat scalar maps so a profile stays diffable and so no rule
 * can smuggle behavior past review as a function body.
 */
export interface PolicyRuleDefinition {
  /** Stable identifier, unique within its rule list, used in durable route facts. */
  readonly id: string
  /** Routing facts this rule matches; an empty object matches everything. */
  readonly when: Readonly<Record<string, string | number | boolean>>
  /**
   * Decision fields this rule contributes when it matches.
   *
   * These are the recorded routing decision, not an executor request. Whatever
   * translates a matched rule into an `ExecutorRoute` supplies only the fields
   * the selected provider declares support for, and drops the rest as advisory:
   * a policy may state a reasoning effort for a run that a given product has no
   * way to express, and that must not make the whole route undispatchable. The
   * full `use` row is still what gets recorded as the durable route fact, so
   * the stated intent survives even where a product could not honour it.
   */
  readonly use: Readonly<Record<string, string | number | boolean>>
}

/** Primary routes plus the routes taken when a primary executor is unavailable. */
export interface RoutingPolicyDefinition {
  readonly rules: readonly PolicyRuleDefinition[]
  readonly fallbackRules: readonly PolicyRuleDefinition[]
}

/** Bounds that make remediation loops terminate rather than run until quota dies. */
export interface WorkflowPolicyDefinition {
  readonly maxRepairCycles: number
  readonly maxExecutorStarts: number
}

/**
 * Review independence required at each risk level.
 *
 * The literal types are the point: a profile cannot weaken high-risk work to
 * fresh-context-only review by editing a policy table.
 */
export interface IndependencePolicyDefinition {
  readonly low: 'fresh-context'
  readonly medium: 'cross-executor-preferred'
  readonly high: 'cross-executor-required'
  readonly critical: 'cross-executor-required'
}

/** Risk-to-evidence rules for the independent QA stage. */
export interface QaPolicyDefinition {
  readonly rules: readonly PolicyRuleDefinition[]
}

/** Triggers selecting security-sensitive review for a changed surface. */
export interface SecurityPolicyDefinition {
  readonly rules: readonly PolicyRuleDefinition[]
}

/** Which reusable integrations this project enables, and under what constraints. */
export interface IntegrationPolicyDefinition {
  /** Integration capability ids the project turns on; an empty list disables all. */
  readonly enabled: readonly string[]
  readonly rules: readonly PolicyRuleDefinition[]
}

/**
 * Plugins excluded from this project's trusted composition.
 *
 * Present even when empty: an absent list reads as "nothing was considered",
 * and the exclusion of self-modifying runtime plugins is a decision that must
 * be stated rather than inferred.
 */
export interface TrustedCompositionDefinition {
  readonly excludedPluginIds: readonly string[]
}

/** One project's complete, validated policy set. */
export interface HarnessProfile {
  /** Lowercase kebab-case project id, recorded in durable workflow-start facts. */
  readonly id: string
  /** `<name>-v<major>.<minor>.<patch>`, recorded alongside every route decision. */
  readonly policyVersion: string
  readonly routingPolicy: RoutingPolicyDefinition
  readonly workflowPolicy: WorkflowPolicyDefinition
  readonly independencePolicy: IndependencePolicyDefinition
  readonly qaPolicy: QaPolicyDefinition
  readonly securityPolicy: SecurityPolicyDefinition
  readonly integrationPolicy: IntegrationPolicyDefinition
  readonly trustedComposition: TrustedCompositionDefinition
}

/** Registration handle scoped to the caller that registered the profile. */
export interface ProfileRegistration {
  dispose(): void
}

/** Validated lookup over the profiles a runtime currently holds. */
export interface HarnessProfileRegistry {
  /**
   * Validate and register one profile.
   * @param profile - the candidate profile.
   * @returns a handle whose disposal unregisters exactly this registration.
   */
  register(profile: HarnessProfile): ProfileRegistration
  /**
   * Look one profile up by id.
   * @param id - the profile id.
   * @returns the registered profile.
   */
  get(id: string): HarnessProfile
  /**
   * List every registered profile.
   * @returns the profiles, ordered by registration.
   */
  list(): readonly HarnessProfile[]
}
