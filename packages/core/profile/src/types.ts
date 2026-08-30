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
   * These are the recorded routing decision, not an executor request. What
   * translates a matched rule into an `ExecutorRoute` is `dispatchableRoute`
   * in `@trick-harness/executor`, which supplies only the fields the selected
   * provider declares support for and reports the rest as dropped: a policy may
   * state a reasoning effort for a run that a given product has no way to
   * express, and that must not make the whole route undispatchable. A model is
   * the one field never dropped — a run attributed to a model that did not run
   * it is a worse outcome than a refused route — so the runtime refuses that
   * case instead. The full `use` row is still what gets recorded as the durable
   * route fact, so the stated intent survives even where a product could not
   * honour it.
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

/**
 * One boundary a security defect may be repaired automatically inside.
 *
 * Stated as a rule rather than decided per run. The alternative is a repair
 * whose authority comes from the diagnosis that asked for it, which is a model
 * deciding what a model may change: an allowlist a person wrote and a reviewer
 * can read is the only thing that makes the decision reviewable in advance.
 */
export interface SecurityRepairRule {
  /** Stable id, unique within the policy, recorded in the authorization. */
  readonly id: string
  /** The class this rule speaks for; only security defects need one. */
  readonly findingClass: 'SECURITY_BUG'
  /**
   * Boundaries the repair may touch, as `*`/`**` path patterns.
   *
   * Matched against the boundary the diagnosis declared, not against anything
   * a stage summarised. An empty list authorises nothing, which is the same
   * answer as having no rule at all.
   */
  readonly allowedBoundaries: readonly string[]
}

/** Triggers selecting security-sensitive review for a changed surface. */
export interface SecurityPolicyDefinition {
  readonly rules: readonly PolicyRuleDefinition[]
  /**
   * Where a security defect may be repaired without a person deciding.
   *
   * Absent or empty is fail-closed and means nowhere: a security repair with no
   * rule behind it does not start. A profile that wants automatic security
   * repair has to name the ground it is allowed on.
   */
  readonly repairRules?: readonly SecurityRepairRule[]
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

/**
 * Risk levels a path rule may raise a run to.
 *
 * Restated here rather than imported from `@trick-harness/contracts`, which
 * this package deliberately does not depend on: a profile is policy data a
 * runtime reads, and the seam stays one-directional. The two statements are
 * held together by the contracts invariant, which pins the ladder itself.
 */
export type ChangeImpactRiskFloor = 'low' | 'medium' | 'high' | 'critical'

/**
 * One path rule: what a repository path means for the run that touches it.
 *
 * Rules accumulate rather than winning outright, which is the difference
 * between this and routing. A file under `src/features/auth/` is both an auth
 * surface and a UI surface, and a policy that had to pick one would drop the
 * half that matters.
 */
export interface ChangeImpactRuleDefinition {
  /** Stable identifier, unique within the policy, recorded in durable facts. */
  readonly id: string
  /**
   * Repository-relative glob patterns this rule matches.
   *
   * Relative and POSIX-formed. A pattern rooted at a filesystem or a Windows
   * volume can only ever match nothing, so it is refused rather than accepted
   * as a surface that silently never applies.
   */
  readonly paths: readonly string[]
  /** What matching contributes; an empty row would contribute nothing. */
  readonly use: Readonly<{
    /** The surface these paths belong to, e.g. `auth`, `database`. */
    surface?: string
    /** The lowest risk a run touching these paths may be judged at. */
    riskFloor?: ChangeImpactRiskFloor
    /** The kind of work touching these paths is. */
    taskClass?: string
    /** A capability the runtime must hold to verify this change. */
    requiredCapability?: string
    /** The evidence bar a change touching these paths has to clear. */
    evidenceProfile?: string
    /** Whether touching these paths changes database state. */
    databaseMutation?: boolean
  }>
}

/** Path rules plus the thresholds that score how large a change is. */
export interface ChangeImpactPolicyDefinition {
  readonly rules: readonly ChangeImpactRuleDefinition[]
  /**
   * File-count bands.
   *
   * `smallMaxFiles` must be below `mediumMaxFiles`: equal bounds make the
   * medium band unreachable while the policy still reads as having three, which
   * is a policy nobody wrote, arrived at by arithmetic.
   */
  readonly writeVolume: Readonly<{
    smallMaxFiles: number
    mediumMaxFiles: number
  }>
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
  /**
   * What the project's repository paths mean for risk, stages and evidence.
   *
   * Required rather than optional, and required even when its rule list is
   * empty. An absent block would classify a migration and a README the same
   * way, and the run would proceed at whatever risk its caller asked for —
   * which is the thing deterministic classification exists to stop being
   * possible.
   */
  readonly changeImpactPolicy: ChangeImpactPolicyDefinition
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
