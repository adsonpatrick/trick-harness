/**
 * The shared vocabulary of the engineering workflow.
 *
 * Every enumeration here is declared as a frozen array first and a union type
 * second. The array is what a parser validates against and what a test
 * enumerates, so a value added to the vocabulary cannot be added to the type
 * alone and quietly skip both. These names travel in durable session events and
 * are read back by a later process, which is why they are strings a human can
 * read in a log rather than numbers.
 *
 * @module @trick-harness/contracts
 */

/** The engineering role a stage plays; determines authority and independence. */
export const ROLES = [
  'refine',
  'plan',
  'implement',
  'debug',
  'repair',
  'verify',
  'review',
  'security',
  'qa',
  'delivery',
] as const

/** One engineering role. */
export type Role = typeof ROLES[number]

/**
 * Roles that may never mutate a workspace.
 *
 * Read-only is a property of the role, not of the run: a debugger that could
 * edit would blur diagnosis into repair, and a reviewer that could edit would
 * be reviewing its own work. Repair is a separate stage with its own run.
 */
export const READ_ONLY_ROLES: readonly Role[] = ['refine', 'plan', 'debug', 'verify', 'review', 'security', 'qa']

/** How much work a task represents, independent of how risky it is. */
export const WORKLOADS = ['light', 'medium', 'heavy'] as const

/** One workload class. */
export type Workload = typeof WORKLOADS[number]

/** How much damage a mistake in this work would do. */
export const RISKS = ['low', 'medium', 'high', 'critical'] as const

/** One risk class. */
export type Risk = typeof RISKS[number]

/** How much a task is expected to write, independent of workload. */
export const WRITE_VOLUMES = ['none', 'small', 'medium', 'large'] as const

/** One write-volume class. */
export type WriteVolume = typeof WRITE_VOLUMES[number]

/**
 * How independent a certifying stage must be from the work it certifies.
 *
 * `fresh-context` is the floor and is never optional: a stage that certifies
 * its own output is not evidence of anything. The two cross-executor levels
 * differ only in what happens when no independent route exists — preferred
 * degrades, required cannot.
 */
export const INDEPENDENCE_REQUIREMENTS = [
  'fresh-context',
  'cross-executor-preferred',
  'cross-executor-required',
] as const

/** One independence requirement. */
export type IndependenceRequirement = typeof INDEPENDENCE_REQUIREMENTS[number]

/**
 * The terminal judgement of a stage or a whole workflow.
 *
 * `INCONCLUSIVE` and `BLOCKED` are distinct on purpose. Inconclusive means the
 * work could not be judged — an interrupted run, a missing gate. Blocked means
 * it was judged and cannot proceed without a decision only a person can make.
 * Collapsing them would turn "nobody knows" into "somebody decided".
 */
export const WORKFLOW_VERDICTS = ['PASS', 'PARTIAL', 'FAIL', 'INCONCLUSIVE', 'BLOCKED'] as const

/** One workflow or stage verdict. */
export type WorkflowVerdict = typeof WORKFLOW_VERDICTS[number]

/**
 * What a review, QA, or security finding actually is.
 *
 * The taxonomy exists to answer one question — may this be repaired
 * automatically? — and the answer is encoded in {@link AUTO_REPAIRABLE_FINDINGS}
 * rather than inferred from the name. A class that describes a decision
 * (product, design, intentional) or a preference (improvement, refactor, style)
 * is never automatically actioned, because deciding it would be inventing
 * product behaviour rather than fixing a defect.
 */
export const FINDING_CLASSES = [
  'BUG',
  'SECURITY_BUG',
  'TEST_DEFECT',
  'TOOLING_DEFECT',
  'PRODUCT_DECISION',
  'DESIGN_DECISION',
  'INTENTIONAL_BEHAVIOR',
  'IMPROVEMENT',
  'REFACTOR_SUGGESTION',
  'STYLE_ONLY',
  'FALSE_POSITIVE',
  'UNRESOLVED',
] as const

/** One finding class. */
export type FindingClass = typeof FINDING_CLASSES[number]

/**
 * Finding classes an automated repair may act on at all.
 *
 * Membership is necessary and not sufficient: a `BUG` still has to be confirmed
 * and a `SECURITY_BUG` still has to be specified well enough to fix, which is a
 * property of the individual finding rather than of its class. Everything
 * outside this list is reported and left alone.
 */
export const AUTO_REPAIRABLE_FINDINGS: readonly FindingClass[] = [
  'BUG',
  'SECURITY_BUG',
  'TEST_DEFECT',
  'TOOLING_DEFECT',
]

/** The kinds of evidence a stage can point at. */
export const EVIDENCE_KINDS = ['test', 'diff', 'log', 'file', 'pr', 'commit', 'gate'] as const

/** One kind of evidence. */
export type EvidenceKind = typeof EVIDENCE_KINDS[number]

/** How well the evidence supports a hypothesis. */
export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const

/** One confidence level. */
export type ConfidenceLevel = typeof CONFIDENCE_LEVELS[number]

/** Whether a defect or its repair has security consequences. */
export const SECURITY_RELEVANCES = ['none', 'possible', 'confirmed'] as const

/** One security-relevance level. */
export type SecurityRelevance = typeof SECURITY_RELEVANCES[number]

/**
 * Filesystem authority a route may grant.
 *
 * Two values and not three. A deployment-owned bypass mode exists in the
 * executor layer, and routing is deliberately unable to name it: a per-run
 * policy decision may choose between supervised authority levels, and may never
 * escalate to the one that has none.
 */
export const ROUTED_PERMISSION_MODES = ['read-only', 'workspace-write'] as const

/** One routed permission mode. */
export type RoutedPermissionMode = typeof ROUTED_PERMISSION_MODES[number]

/**
 * A pointer to evidence that outlives the run that produced it.
 *
 * Deliberately a reference and not the evidence itself. Durable state holds
 * observable facts, and a transcript is neither bounded nor a fact; a locator a
 * later reader can follow is both.
 */
export interface EvidenceRef {
  /** What kind of evidence this points at. */
  readonly kind: EvidenceKind
  /** Stable locator: a path, a test id, a SHA, a PR number, a gate name. */
  readonly locator: string
  /** One line describing what a reader would find there. */
  readonly summary: string
}

/** One thing a review, QA, or security stage found. */
export interface Finding {
  /** Stable id, unique within the workflow, used to close the loop on it. */
  readonly id: string
  /** What this finding is, which decides whether it may be auto-repaired. */
  readonly class: FindingClass
  /** The role of the stage that raised it. */
  readonly raisedBy: Role
  /** One-line statement of the defect or observation. */
  readonly summary: string
  /** Whether a stage established this is real, rather than suspected. */
  readonly confirmed: boolean
  /** Evidence a later reader can follow; may be empty for an unconfirmed finding. */
  readonly evidence: readonly EvidenceRef[]
}

/**
 * What a read-only debugger established before any repair is allowed to start.
 *
 * Every field is required because a diagnosis missing any one of them is not a
 * diagnosis: without a reproduction the fix cannot be shown to work, without a
 * regression seam it cannot be kept working, and without ruled-out hypotheses
 * the root cause is a guess that happened to be first. `unknowns` is required
 * and may be empty — an empty list is a claim, and an absent one is silence.
 */
export interface DiagnosisContract {
  /** What was observed to be wrong. */
  readonly symptom: string
  /** How to make it happen again, deterministically. */
  readonly reproduction: string
  /** What should happen, and what happens instead. */
  readonly expectedVsActual: string
  /** What the debugger actually saw, as followable references. */
  readonly observedEvidence: readonly EvidenceRef[]
  /** The module, layer, or seam the defect lives in. */
  readonly affectedBoundary: string
  /** Explanations considered and eliminated, with why. */
  readonly ruledOutHypotheses: readonly string[]
  /** The explanation the evidence supports. */
  readonly rootCauseHypothesis: string
  /** How well the evidence supports it. */
  readonly confidence: ConfidenceLevel
  /** Where a regression test can be attached so this cannot come back unseen. */
  readonly regressionTestSeam: string
  /** The smallest coherent surface a fix would touch. */
  readonly minimalRepairSurface: string
  /** What remains unexplained; empty is a claim that nothing does. */
  readonly unknowns: readonly string[]
  /** Whether fixing this has security consequences. */
  readonly securityRelevance: SecurityRelevance
  /**
   * A product or design decision the repair would have to make.
   *
   * Present and material means the workflow stops at `BLOCKED`: inventing the
   * decision would ship a guess about what the product should do.
   */
  readonly productDecisionDependency?: string
}

/** Everything a routing decision is allowed to depend on. */
export interface RoutingContext {
  /** The role being routed. */
  readonly role: Role
  /** Free-form task classification, recorded but never able to override policy. */
  readonly taskClass?: string
  /** How much work this is. */
  readonly workload: Workload
  /** How much damage a mistake would do. */
  readonly risk: Risk
  /** How much this stage is expected to write. */
  readonly writeVolume: WriteVolume
  /** How independent this stage must be from the work it judges. */
  readonly independenceRequirement: IndependenceRequirement
  /** Which executor did the implementation, when a stage must differ from it. */
  readonly implementationExecutor?: string
  /** How many times this work has already been attempted. */
  readonly priorAttempts: number
  /** Executors that already failed this work, and are not tried again first. */
  readonly priorRouteFailures: readonly string[]
  /** Executors currently known to be out of quota or otherwise degraded. */
  readonly degradedExecutors: readonly string[]
  /** Capabilities the route must be able to honour. */
  readonly requiredCapabilities: readonly string[]
  /** An explicit human override for this one run. */
  readonly userOverride?: RouteOverride
}

/** A human's explicit routing choice for one run. */
export interface RouteOverride {
  /** The executor to use. */
  readonly executor: string
  /** The semantic tier to resolve, when the override names one. */
  readonly semanticModelTier?: string
  /** The reasoning effort to request, when the override names one. */
  readonly reasoningEffort?: string
}

/**
 * The decision, with enough recorded about it to explain it later.
 *
 * `reasonCodes` and `policyVersion` are not decoration. A route that cannot say
 * why it was chosen, under which version of the policy, is unauditable the
 * moment the policy changes — and routing policy changes far more often than
 * routing mechanism.
 */
export interface RouteDecision {
  /** The executor this work is dispatched to. */
  readonly executor: string
  /** The semantic tier the policy selected. */
  readonly semanticModelTier: string
  /** The product-native model that tier resolved to. */
  readonly resolvedModel: string
  /** The reasoning effort requested; advisory where a product has no field for it. */
  readonly reasoningEffort?: string
  /** The filesystem authority this run gets. */
  readonly permissionMode: RoutedPermissionMode
  /** Machine-readable reasons this route was chosen, in order of application. */
  readonly reasonCodes: readonly string[]
  /** The version of the routing policy that produced this decision. */
  readonly policyVersion: string
  /** Present when this decision replaced a primary route that was unavailable. */
  readonly fallbackFrom?: string
}

/** What a workflow was asked to accomplish, as approved before it started. */
export interface WorkflowObjective {
  /** Stable workflow id, durable across restarts. */
  readonly id: string
  /** Absolute workspace root the workflow operates in. */
  readonly cwd: string
  /** What the workflow is meant to achieve. */
  readonly requirement: string
  /** How much damage a mistake in this work would do. */
  readonly risk: Risk
  /** How much work this represents. */
  readonly workload: Workload
  /** Profile whose policy governs this workflow. */
  readonly profileId: string
}

/**
 * The bounded result of one stage.
 *
 * `summary` and `evidence` are what survives; the child's transcript does not
 * and has no field to survive in. A stage that needs to say more says it in
 * evidence a later reader can follow.
 */
export interface StageResult {
  /** The role that ran. */
  readonly role: Role
  /** The executor that ran it. */
  readonly executor: string
  /** The stage's own judgement. */
  readonly verdict: WorkflowVerdict
  /** Bounded human-readable outcome. */
  readonly summary: string
  /** Findings this stage raised. */
  readonly findings: readonly Finding[]
  /** Evidence supporting the verdict. */
  readonly evidence: readonly EvidenceRef[]
}
