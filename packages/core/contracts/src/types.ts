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
  'conformance',
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
export const READ_ONLY_ROLES: readonly Role[] = [
  'refine', 'plan', 'debug', 'verify', 'review', 'security', 'qa', 'conformance',
]

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

/**
 * A human's routing choice, aimed at the first stage of one role.
 *
 * Carried across a process boundary — a control-server request, a composed
 * runtime — where `RouteOverride` alone would not say which stage it meant. It
 * names a role rather than a stage id because the caller is answering "send the
 * review somewhere else this time", not addressing a stage the plan has not
 * produced yet.
 */
export interface StageRouteOverride extends RouteOverride {
  /** The role whose first dispatch this override applies to. */
  readonly role: Role
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

/**
 * One approved document, named by where it lives and what it said.
 *
 * The hash is the identity, not the path: a plan that was approved and then
 * edited is a different plan, and a conformance judgement against the edited
 * text would be answering a question nobody approved. The document itself is
 * never carried here — it is read from the workspace at the path, and the hash
 * is what says the text read back is the text that was approved.
 */
export interface ApprovedArtifactRef {
  /** Repository-relative path; never absolute and never traversing upward. */
  readonly path: string
  /** Lowercase 64-hex SHA-256 of the approved document's bytes. */
  readonly sha256: string
}

/** The documents a human approved before the work was allowed to start. */
export interface ApprovedArtifactSet {
  /** The approved specification. */
  readonly spec: ApprovedArtifactRef
  /** The approved implementation plan. */
  readonly plan: ApprovedArtifactRef
}

/**
 * Where one conformance obligation came from.
 *
 * Three sources rather than a free-text field: an obligation is traceable to
 * the approved specification, to the approved plan, or to the profile's
 * definition of done, and one that cites none of those is one nobody approved.
 */
export const CONFORMANCE_SOURCES = ['spec', 'plan', 'dod'] as const

/** One conformance obligation source. */
export type ConformanceSource = typeof CONFORMANCE_SOURCES[number]

/**
 * How one obligation came out.
 *
 * `MISSING` is why this is not the verdict vocabulary: an obligation nothing
 * addressed is not one that was attempted and failed, and reading the two
 * alike would let unimplemented work look like work that went wrong.
 */
export const CONFORMANCE_ITEM_STATUSES = [
  'PASS', 'MISSING', 'PARTIAL', 'FAIL', 'BLOCKED', 'INCONCLUSIVE',
] as const

/** One conformance item status. */
export type ConformanceItemStatus = typeof CONFORMANCE_ITEM_STATUSES[number]

/**
 * One thing the approved documents require of this implementation.
 *
 * `required` is `true` and has no other value it can hold. The obligation set
 * is built by deterministic code before the stage runs, and a model that could
 * mark an obligation optional could excuse itself from the one it did not do.
 */
export interface ConformanceObligation {
  /** Stable id, unique within the manifest. */
  readonly id: string
  /** Which approved document this obligation comes from. */
  readonly source: ConformanceSource
  /** What the document requires, in the words that will be judged. */
  readonly requirement: string
  /** Always true; an obligation the run may skip is not an obligation. */
  readonly required: true
}

/**
 * The obligations one run must answer, and the documents they were read from.
 *
 * Built before the stage is dispatched, so the expected set is not something
 * model output can shorten. The hashes bind the manifest to exact documents:
 * a manifest built from one plan and answered against another is two questions
 * with one answer.
 */
export interface ConformanceManifest {
  /** SHA-256 of the approved specification the obligations were read from. */
  readonly specSha256: string
  /** SHA-256 of the approved plan the obligations were read from. */
  readonly planSha256: string
  /** Every obligation this run must answer. */
  readonly obligations: readonly ConformanceObligation[]
  /**
   * Delivered paths the approved Plan never committed to writing.
   *
   * Deterministic scope evidence, read from the published branch by plain code
   * rather than reported by the stage that wrote it. It is handed over as a
   * fact and not as a finding: whether a file the Plan did not name breaks a
   * Plan obligation is conformance's judgement, and a classifier that decided
   * it would be inventing a product defect out of a path.
   */
  readonly unplannedPaths: readonly string[]
}

/** One obligation's answer, with what supports it. */
export interface ConformanceItem {
  /** The obligation being answered. */
  readonly id: string
  /** Which approved document it came from. */
  readonly source: ConformanceSource
  /** What was required. */
  readonly requirement: string
  /** How it came out. */
  readonly status: ConformanceItemStatus
  /** Where the implementation satisfying it lives. */
  readonly implementationEvidence: readonly EvidenceRef[]
  /** What proves it works, as distinct from what claims it does. */
  readonly verificationEvidence: readonly EvidenceRef[]
  /** The bounded reason for the status. */
  readonly summary: string
}

/**
 * What a conformance stage concluded.
 *
 * The hashes are carried rather than assumed, because this record outlives the
 * run: a `PASS` that did not name the documents it measured could be read
 * later as a pass against whatever the plan says by then.
 */
export interface ConformanceContract {
  /** SHA-256 of the specification this judged against. */
  readonly specSha256: string
  /** SHA-256 of the plan this judged against. */
  readonly planSha256: string
  /** One answer per obligation. */
  readonly items: readonly ConformanceItem[]
  /** The stage's overall judgement. */
  readonly verdict: WorkflowVerdict
  /** The bounded reason for that judgement. */
  readonly summary: string
}

/**
 * A conformance reading reduced to what may leave the run.
 *
 * A status poll and a durable log both read this, and both outlive whoever was
 * watching. So it carries which documents were judged, how many obligations
 * each of them set, how the answers came out and the verdict — and no free text
 * a provider wrote. The per-obligation requirement and summary stay in the
 * stage's own record, where a person reads them deliberately rather than having
 * them rendered into a chat window by a bridge.
 */
export interface ConformanceStatusSummary {
  /** Repository-relative path of the approved specification. */
  readonly specPath: string
  /** SHA-256 of that specification. */
  readonly specSha256: string
  /** Repository-relative path of the approved plan. */
  readonly planPath: string
  /** SHA-256 of that plan. */
  readonly planSha256: string
  /**
   * How many obligations each source set.
   *
   * Carried beside the counts so a reader can tell a complete reading from one
   * that answered fewer obligations than the documents declare.
   */
  readonly expected: Readonly<Record<ConformanceSource, number>>
  /** How many answers landed on each status. */
  readonly counts: Readonly<Record<ConformanceItemStatus, number>>
  /** The reading's overall judgement. */
  readonly verdict: WorkflowVerdict
}

/**
 * The two readings of what a change touches.
 *
 * `planned` is derived from the approved Plan before any mutation-capable
 * stage runs; `actual` is derived from the published branch after delivery.
 * They are kept apart rather than merged into one number because the gap
 * between them is itself a fact: work that reached past what was approved
 * looks exactly like work that did not, once the two are added together.
 */
export const CHANGE_IMPACT_SOURCES = ['planned', 'actual'] as const

/** Which of the two readings a set of impact facts came from. */
export type ChangeImpactSource = typeof CHANGE_IMPACT_SOURCES[number]

/**
 * What deterministic classification concluded about one set of paths.
 *
 * Every field here is produced by code from a profile's declared path rules.
 * None of it is a model's account of its own change, which is the reason the
 * type exists: the run's risk, its required stages and its evidence bar are
 * decided from these facts, and a stage that could write them could lower the
 * bar it is about to be held to.
 */
export interface ChangeImpactFacts {
  /** Which reading this is. */
  readonly source: ChangeImpactSource
  /** How many distinct repository paths were classified. */
  readonly pathCount: number
  /** Distinct surfaces the paths fall in, in policy order. */
  readonly surfaces: readonly string[]
  /** The highest risk any matched rule requires. */
  readonly riskFloor: Risk
  /** How large the change is, scored against the profile's thresholds. */
  readonly writeVolume: WriteVolume
  /** Task classes the matched rules name, in policy order. */
  readonly taskClasses: readonly string[]
  /** Capabilities the matched rules require of the runtime, in policy order. */
  readonly requiredCapabilities: readonly string[]
  /** Evidence profiles the matched rules require, in policy order. */
  readonly evidenceProfiles: readonly string[]
  /** Whether any matched rule marks this as touching database state. */
  readonly databaseMutation: boolean
  /** Ids of the rules that matched, in policy order, for a reader to trace. */
  readonly matchedRuleIds: readonly string[]
  /** Paths present in this reading that the approved plan did not name. */
  readonly unplannedPaths: readonly string[]
}

/** How many unplanned paths one bounded record keeps, whatever it was given. */
export const MAX_RECORDED_UNPLANNED_PATHS = 100

/**
 * One reading of a change, reduced to what a durable record may hold.
 *
 * Everything here is a scalar, a boolean, a count, or a bounded list of
 * repository paths. There is deliberately no field a diff, a file's contents,
 * a command's output or a model's reasoning could travel in: this record is
 * read back by a restart and rendered into a status window, and both are
 * places where a transcript must never turn up.
 */
export interface ChangeImpactStatusSummary {
  readonly source: ChangeImpactSource
  readonly effectiveRisk: Risk
  readonly riskFloor: Risk
  readonly writeVolume: WriteVolume
  /** Sorted and deduplicated, so two records of one reading compare equal. */
  readonly surfaces: readonly string[]
  readonly taskClasses: readonly string[]
  readonly requiredCapabilities: readonly string[]
  readonly evidenceProfiles: readonly string[]
  readonly matchedRuleIds: readonly string[]
  readonly databaseMutation: boolean
  readonly pathCount: number
  /**
   * How many paths this reading held that the approved Plan never named.
   *
   * Kept apart from the list because the list is capped: a record that carried
   * only the sample would let a delivery of 150 unapproved files read as 100.
   */
  readonly unplannedPathCount: number
  /** At most {@link MAX_RECORDED_UNPLANNED_PATHS} of them, sorted. */
  readonly unplannedPaths: readonly string[]
}

/**
 * The two readings resolved into the single policy the run is held to.
 *
 * Resolution is monotonic in both directions it can move: neither reading can
 * lower what the other established, and neither can lower the risk the
 * objective was opened at. A delivered change that turned out to touch
 * migrations is judged as a database change even though nobody planned it that
 * way, and a planned database change stays one even if the diff came back
 * empty.
 */
export interface EffectiveChangeImpact {
  /** What the approved plan said the change would touch. */
  readonly planned: ChangeImpactFacts
  /** What the published branch turned out to touch, once there is one. */
  readonly actual?: ChangeImpactFacts
  /** `max` of the objective's risk and both readings' floors. */
  readonly effectiveRisk: Risk
  /** `max` of both readings' write volumes. */
  readonly writeVolume: WriteVolume
  /** Union of both readings' surfaces. */
  readonly surfaces: readonly string[]
  /** Union of both readings' task classes. */
  readonly taskClasses: readonly string[]
  /** Union of both readings' required capabilities. */
  readonly requiredCapabilities: readonly string[]
  /** Union of both readings' evidence profiles. */
  readonly evidenceProfiles: readonly string[]
  /** True when either reading found database state in the change. */
  readonly databaseMutation: boolean
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
  /** The approved documents conformance later judges the implementation against. */
  readonly approvedArtifacts: ApprovedArtifactSet
  /**
   * What kind of work this is, when the caller knows it.
   *
   * Policy may read it, and classification may add to it, but neither depends
   * on it: an objective that names nothing is classified from its paths alone.
   * It is a hint that can raise the bar, never one that can lower it.
   */
  readonly taskClass?: string
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

/**
 * Every state a certification may be published in, and nothing else.
 *
 * Four states because that is what an external certifier can honestly say: the
 * run is under way, it finished and the revision is certified, it finished and
 * the revision is not, or the question could not be answered at all. The last
 * one matters most — a capability that cannot reach its certifier has not
 * learned the revision is fine, so it says `error` rather than staying quiet
 * and leaving a stale `pending` to be read as caution or as neglect depending
 * on who is reading.
 *
 * Stated as a frozen list rather than a bare union so a run can be checked
 * against it, and so nothing can widen the vocabulary at runtime. It lives here
 * rather than beside the workflow that publishes it because the durable log
 * reads it back, and the log may not depend on the runtime that wrote it.
 */
export const EXTERNAL_CERTIFICATION_STATES = Object.freeze([
  'pending',
  'success',
  'failure',
  'error',
] as const)

/** One of {@link EXTERNAL_CERTIFICATION_STATES}. */
export type ExternalCertificationState = typeof EXTERNAL_CERTIFICATION_STATES[number]

/**
 * What a certification amounts to, for anything reading the run from outside.
 *
 * Three fields, and the omissions are the design. There is no description here
 * — the certifier chose that from the state alone and it is already on the pull
 * request — and no target URL, because a status poll that handed back a link
 * would be handing a reader somewhere to be sent. What remains is the state a
 * branch-protection rule acts on, the revision it was published against, and
 * the certifier's own id for it, which is what a later read finds it by.
 */
export interface CertificationStatusSummary {
  /** The state the certifier reported back after reading its own status. */
  readonly state: ExternalCertificationState
  /** The revision certified, as the capability re-read it. */
  readonly revision: string
  /** The certifier's id for the published status. */
  readonly externalId: string
}
