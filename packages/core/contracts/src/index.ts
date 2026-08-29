/**
 * The engineering workflow contracts, and the boundary that reads them back.
 *
 * Types alone are a compile-time claim, and every value these contracts
 * describe crosses a runtime boundary at least once: it is written to a durable
 * session event, read back by a later process, or produced by a model that was
 * asked for a shape. A parser is what makes the claim true on the far side.
 *
 * Two properties are deliberate and are asserted by tests. A parser rebuilds
 * the value from the fields the contract declares, so an unknown field — a
 * transcript, a stray reasoning dump, whatever a producer decided to attach —
 * does not survive into durable state. And a rejection names the field path
 * without quoting the value, because these errors are themselves logged, and a
 * field that can hold anything can hold a secret.
 *
 * @module @trick-harness/contracts
 */

import {
  CHANGE_IMPACT_SOURCES,
  CONFIDENCE_LEVELS,
  CONFORMANCE_ITEM_STATUSES,
  CONFORMANCE_SOURCES,
  EVIDENCE_KINDS,
  FINDING_CLASSES,
  RISKS,
  ROLES,
  ROUTED_PERMISSION_MODES,
  SECURITY_RELEVANCES,
  WORKFLOW_VERDICTS,
  WORKLOADS,
  WRITE_VOLUMES,
} from './types.ts'
import type {
  ApprovedArtifactRef,
  ApprovedArtifactSet,
  ChangeImpactFacts,
  ConformanceContract,
  ConformanceItem,
  DiagnosisContract,
  EffectiveChangeImpact,
  EvidenceRef,
  Finding,
  RouteDecision,
  StageResult,
  StageRouteOverride,
  WorkflowObjective,
} from './types.ts'

export * from './types.ts'

/**
 * A serialized contract that does not satisfy the shape it claims.
 *
 * `path` is carried as data and not only inside the message, so a caller can
 * route on the field that failed — a diagnosis missing its reproduction is a
 * different problem from one whose confidence is a word nobody defined.
 */
export class ContractError extends Error {
  /** Dotted path of the offending field, e.g. `finding.evidence[1].kind`. */
  readonly path: string

  /**
   * @param path - Dotted path of the offending field.
   * @param expectation - What the field must be, stated without quoting what it was.
   */
  constructor(path: string, expectation: string) {
    super(`${path} ${expectation}`)
    this.name = 'ContractError'
    this.path = path
  }
}

/** Narrow an unknown to a plain object, or reject it. */
function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ContractError(path, 'must be an object')
  }
  return value as Record<string, unknown>
}

/** Read a required non-empty string field. */
function text(source: Record<string, unknown>, key: string, path: string): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ContractError(`${path}.${key}`, 'must be a non-empty string')
  }
  return value
}

/** Read a bounded classification label: non-blank and short enough to be one. */
function label(source: Record<string, unknown>, key: string, path: string): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > LABEL_MAX_LENGTH) {
    throw new ContractError(`${path}.${key}`, `must be a non-empty string of at most ${LABEL_MAX_LENGTH} characters`)
  }
  return value
}

/** Read a required boolean field. */
function flag(source: Record<string, unknown>, key: string, path: string): boolean {
  const value = source[key]
  if (typeof value !== 'boolean') throw new ContractError(`${path}.${key}`, 'must be a boolean')
  return value
}

/** Read a required field whose value must come from a closed vocabulary. */
function member<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  path: string,
): T {
  const value = source[key]
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ContractError(`${path}.${key}`, `must be one of ${allowed.join(', ')}`)
  }
  return value as T
}

/** Read a required array field, parsing each element under its own indexed path. */
function list<T>(
  source: Record<string, unknown>,
  key: string,
  path: string,
  parse: (item: unknown, itemPath: string) => T,
): readonly T[] {
  const value = source[key]
  if (!Array.isArray(value)) throw new ContractError(`${path}.${key}`, 'must be an array')
  return Object.freeze(value.map((item, index) => parse(item, `${path}.${key}[${index}]`)))
}

/** Read a required count: a whole number that cannot be negative. */
function count(source: Record<string, unknown>, key: string, path: string): number {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ContractError(`${path}.${key}`, 'must be a whole number that is not negative')
  }
  return value
}

/**
 * Longest a free-form classification label may be.
 *
 * These labels are written into durable facts and read back by processes that
 * budget for them. An unbounded one is a place to put a document.
 */
const LABEL_MAX_LENGTH = 64

/** Parse one element that must itself be a non-empty string. */
function textItem(item: unknown, path: string): string {
  if (typeof item !== 'string' || item.trim().length === 0) {
    throw new ContractError(path, 'must be a non-empty string')
  }
  return item
}

/**
 * Read one evidence reference back.
 * @param value - The serialized reference.
 * @param path - Field path to report a rejection under.
 * @returns The reference, rebuilt from declared fields only.
 * @throws {ContractError} when a field is missing or outside its vocabulary.
 */
export function parseEvidenceRef(value: unknown, path = 'evidence'): EvidenceRef {
  const source = asRecord(value, path)
  return Object.freeze({
    kind: member(source, 'kind', EVIDENCE_KINDS, path),
    locator: text(source, 'locator', path),
    summary: text(source, 'summary', path),
  })
}

/**
 * Read one finding back.
 * @param value - The serialized finding.
 * @param path - Field path to report a rejection under.
 * @returns The finding, rebuilt from declared fields only.
 * @throws {ContractError} when a field is missing or outside its vocabulary.
 */
export function parseFinding(value: unknown, path = 'finding'): Finding {
  const source = asRecord(value, path)
  return Object.freeze({
    id: text(source, 'id', path),
    class: member(source, 'class', FINDING_CLASSES, path),
    raisedBy: member(source, 'raisedBy', ROLES, path),
    summary: text(source, 'summary', path),
    confirmed: flag(source, 'confirmed', path),
    evidence: list(source, 'evidence', path, parseEvidenceRef),
  })
}

/**
 * Read one diagnosis back.
 *
 * `unknowns` is required even when empty. An empty list is a debugger stating
 * that nothing is left unexplained; an absent one is a debugger that never
 * addressed the question, and the two must not read alike downstream.
 * @param value - The serialized diagnosis.
 * @param path - Field path to report a rejection under.
 * @returns The diagnosis, rebuilt from declared fields only.
 * @throws {ContractError} when a field is missing or outside its vocabulary.
 */
export function parseDiagnosisContract(value: unknown, path = 'diagnosis'): DiagnosisContract {
  const source = asRecord(value, path)
  const dependency = source['productDecisionDependency']
  return Object.freeze({
    symptom: text(source, 'symptom', path),
    reproduction: text(source, 'reproduction', path),
    expectedVsActual: text(source, 'expectedVsActual', path),
    observedEvidence: list(source, 'observedEvidence', path, parseEvidenceRef),
    affectedBoundary: text(source, 'affectedBoundary', path),
    ruledOutHypotheses: list(source, 'ruledOutHypotheses', path, textItem),
    rootCauseHypothesis: text(source, 'rootCauseHypothesis', path),
    confidence: member(source, 'confidence', CONFIDENCE_LEVELS, path),
    regressionTestSeam: text(source, 'regressionTestSeam', path),
    minimalRepairSurface: text(source, 'minimalRepairSurface', path),
    unknowns: list(source, 'unknowns', path, textItem),
    securityRelevance: member(source, 'securityRelevance', SECURITY_RELEVANCES, path),
    ...dependency === undefined
      ? {}
      : { productDecisionDependency: text(source, 'productDecisionDependency', path) },
  })
}

/**
 * Read one route decision back.
 *
 * `reasonCodes` must be non-empty and `policyVersion` must be present, because
 * this record is what explains a route after the policy that produced it has
 * moved on. A decision that cannot say why or under which version is not
 * auditable, and routing policy changes far more often than routing mechanism.
 * @param value - The serialized decision.
 * @param path - Field path to report a rejection under.
 * @returns The decision, rebuilt from declared fields only.
 * @throws {ContractError} when a field is missing or outside its vocabulary.
 */
export function parseRouteDecision(value: unknown, path = 'route'): RouteDecision {
  const source = asRecord(value, path)
  const reasonCodes = list(source, 'reasonCodes', path, textItem)
  if (reasonCodes.length === 0) throw new ContractError(`${path}.reasonCodes`, 'must name at least one reason')
  const effort = source['reasoningEffort']
  const fallbackFrom = source['fallbackFrom']
  return Object.freeze({
    executor: text(source, 'executor', path),
    semanticModelTier: text(source, 'semanticModelTier', path),
    resolvedModel: text(source, 'resolvedModel', path),
    permissionMode: member(source, 'permissionMode', ROUTED_PERMISSION_MODES, path),
    reasonCodes,
    policyVersion: text(source, 'policyVersion', path),
    ...effort === undefined ? {} : { reasoningEffort: text(source, 'reasoningEffort', path) },
    ...fallbackFrom === undefined ? {} : { fallbackFrom: text(source, 'fallbackFrom', path) },
  })
}

/**
 * Read one stage result back.
 * @param value - The serialized result.
 * @param path - Field path to report a rejection under.
 * @returns The result, rebuilt from declared fields only.
 * @throws {ContractError} when a field is missing or outside its vocabulary.
 */
export function parseStageResult(value: unknown, path = 'stage'): StageResult {
  const source = asRecord(value, path)
  return Object.freeze({
    role: member(source, 'role', ROLES, path),
    executor: text(source, 'executor', path),
    verdict: member(source, 'verdict', WORKFLOW_VERDICTS, path),
    summary: text(source, 'summary', path),
    findings: list(source, 'findings', path, parseFinding),
    evidence: list(source, 'evidence', path, parseEvidenceRef),
  })
}

/**
 * Read one human routing override back.
 *
 * The semantic tier is required even though `RouteOverride` types it as
 * optional: the router refuses an override that does not name one, so accepting
 * it here would only move the rejection to a point where the caller is no
 * longer around to be told. The reasoning effort stays optional, and is held to
 * the same non-empty-string rule when it is present.
 * @param value - The serialized override.
 * @param path - Field path to report a rejection under.
 * @returns The override, rebuilt from declared fields only.
 * @throws {ContractError} when a field is missing or outside its vocabulary.
 */
export function parseStageRouteOverride(value: unknown, path = 'routeOverride'): StageRouteOverride {
  const source = asRecord(value, path)
  const effort = source['reasoningEffort']
  return Object.freeze({
    role: member(source, 'role', ROLES, path),
    executor: text(source, 'executor', path),
    semanticModelTier: text(source, 'semanticModelTier', path),
    ...effort === undefined ? {} : { reasoningEffort: text(source, 'reasoningEffort', path) },
  })
}

/** A lowercase 64-hex SHA-256 digest and nothing else. */
const SHA256 = /^[0-9a-f]{64}$/

/** Read a required field that must be a SHA-256 digest. */
function digest(source: Record<string, unknown>, key: string, path: string): string {
  const value = text(source, key, path)
  if (!SHA256.test(value)) {
    throw new ContractError(`${path}.${key}`, 'must be a lowercase 64-character hexadecimal SHA-256')
  }
  return value
}

/** A Windows drive designator, which makes whatever follows it absolute. */
const DRIVE_LETTER = /^[a-zA-Z]:/

/**
 * Whether `value` holds a character no document name does.
 *
 * By code point rather than by a control-character class: a NUL truncates the
 * path for whoever opens it, and the rest are unprintable in the journal a
 * person later reads.
 *
 * @param value - one path segment.
 * @returns whether it holds a control character.
 */
function hasControlCharacter(value: string): boolean {
  // By code unit rather than by code point: every character being looked for
  // is ASCII, and a surrogate half is not one of them.
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7F) return true
  }
  return false
}

/**
 * Read one approved artifact reference back.
 *
 * The path is held to repository-relative because this value decides what the
 * host opens and hashes: an absolute path names a document on the machine
 * rather than in the tree under review, and a traversal segment names one
 * outside it. Neither the path nor the hash is quoted in a rejection, because
 * a rejection is logged and a path is a place a secret can hide.
 *
 * @param value - The serialized reference.
 * @param path - Field path to report a rejection under.
 * @returns The reference, rebuilt from declared fields only.
 * @throws {ContractError} when a field is missing, malformed, or escapes the repository.
 */
export function parseApprovedArtifactRef(value: unknown, path = 'artifact'): ApprovedArtifactRef {
  const source = asRecord(value, path)
  const location = text(source, 'path', path)
  // Stated as what a segment may be rather than as a list of what it may not.
  // A check that enumerated `/` and a drive letter would still admit
  // `\\server\share` and `\etc`, both roots on a platform this harness runs
  // on; and one that only refused `..` would admit `docs/./spec.md` — the same
  // bytes under a second spelling, so the path journalled would not be the
  // path approved.
  //
  // A trailing dot and a colon are refused for the same reason, and not as
  // Windows trivia: Windows drops the dot and reads everything after the colon
  // as an alternate data stream, so either names a file other than the one
  // spelled. The path is required to be in NFC rather than normalized into it,
  // because normalizing would accept two byte strings as one approved identity.
  const segments = location.split(/[/\\]/)
  const named = segments.every(segment =>
    segment !== '' && segment !== '.' && segment !== '..'
    && segment === segment.trim()
    && !segment.endsWith('.')
    && !segment.includes(':')
    && !hasControlCharacter(segment))
  if (!named || DRIVE_LETTER.test(location) || location !== location.normalize('NFC')) {
    throw new ContractError(`${path}.path`, 'must be a repository-relative path of ordinary name segments')
  }
  return Object.freeze({ path: location, sha256: digest(source, 'sha256', path) })
}

/**
 * Read one set of change-impact facts back.
 *
 * Everything here was produced by deterministic classification, and this parser
 * is what keeps it that way across a durable boundary: a producer that attached
 * its reasoning, its own path list, or a field the classifier has no name for
 * finds none of it on the far side.
 *
 * @param value - The serialized facts.
 * @param path - Field path to report a rejection under.
 * @returns The facts, rebuilt from declared fields only.
 * @throws {ContractError} when a field is missing or outside its vocabulary.
 */
export function parseChangeImpactFacts(value: unknown, path = 'impact'): ChangeImpactFacts {
  const source = asRecord(value, path)
  return Object.freeze({
    source: member(source, 'source', CHANGE_IMPACT_SOURCES, path),
    pathCount: count(source, 'pathCount', path),
    surfaces: list(source, 'surfaces', path, textItem),
    riskFloor: member(source, 'riskFloor', RISKS, path),
    writeVolume: member(source, 'writeVolume', WRITE_VOLUMES, path),
    taskClasses: list(source, 'taskClasses', path, textItem),
    requiredCapabilities: list(source, 'requiredCapabilities', path, textItem),
    evidenceProfiles: list(source, 'evidenceProfiles', path, textItem),
    databaseMutation: flag(source, 'databaseMutation', path),
    matchedRuleIds: list(source, 'matchedRuleIds', path, textItem),
    unplannedPaths: list(source, 'unplannedPaths', path, textItem),
  })
}

/**
 * Read the resolved impact of a change back.
 *
 * `planned` is required because it exists before the first mutation-capable
 * stage runs; `actual` is optional because before delivery there is no
 * published branch to read, and a reading invented to fill the field would be
 * an unearned claim that nothing was touched.
 *
 * @param value - The serialized resolution.
 * @param path - Field path to report a rejection under.
 * @returns The resolution, rebuilt from declared fields only.
 * @throws {ContractError} when a field is missing or outside its vocabulary.
 */
export function parseEffectiveChangeImpact(value: unknown, path = 'effectiveImpact'): EffectiveChangeImpact {
  const source = asRecord(value, path)
  const actual = source['actual']
  return Object.freeze({
    planned: parseChangeImpactFacts(source['planned'], `${path}.planned`),
    ...actual === undefined ? {} : { actual: parseChangeImpactFacts(actual, `${path}.actual`) },
    effectiveRisk: member(source, 'effectiveRisk', RISKS, path),
    writeVolume: member(source, 'writeVolume', WRITE_VOLUMES, path),
    surfaces: list(source, 'surfaces', path, textItem),
    taskClasses: list(source, 'taskClasses', path, textItem),
    requiredCapabilities: list(source, 'requiredCapabilities', path, textItem),
    evidenceProfiles: list(source, 'evidenceProfiles', path, textItem),
    databaseMutation: flag(source, 'databaseMutation', path),
  })
}

/**
 * Read the approved artifact set back.
 *
 * @param value - The serialized set.
 * @param path - Field path to report a rejection under.
 * @returns The set, rebuilt from declared fields only.
 * @throws {ContractError} when either document is missing or malformed.
 */
export function parseApprovedArtifactSet(value: unknown, path = 'approvedArtifacts'): ApprovedArtifactSet {
  const source = asRecord(value, path)
  return Object.freeze({
    spec: parseApprovedArtifactRef(source['spec'], `${path}.spec`),
    plan: parseApprovedArtifactRef(source['plan'], `${path}.plan`),
  })
}

/**
 * Read one conformance item back.
 *
 * @param value - The serialized item.
 * @param path - Field path to report a rejection under.
 * @returns The item, rebuilt from declared fields only.
 * @throws {ContractError} when a field is missing or outside its vocabulary.
 */
function parseConformanceItem(value: unknown, path: string): ConformanceItem {
  const source = asRecord(value, path)
  return Object.freeze({
    id: text(source, 'id', path),
    source: member(source, 'source', CONFORMANCE_SOURCES, path),
    requirement: text(source, 'requirement', path),
    status: member(source, 'status', CONFORMANCE_ITEM_STATUSES, path),
    implementationEvidence: list(source, 'implementationEvidence', path, parseEvidenceRef),
    verificationEvidence: list(source, 'verificationEvidence', path, parseEvidenceRef),
    summary: text(source, 'summary', path),
  })
}

/**
 * Read one conformance result back.
 *
 * The two hashes are required because this record outlives the run that wrote
 * it: a `PASS` that did not name the documents it measured reads, later, as a
 * pass against whatever the plan says by then. And an obligation may be
 * answered once — two answers for one id leave which one counts to whoever
 * happens to read the list last.
 *
 * @param value - The serialized result.
 * @param path - Field path to report a rejection under.
 * @returns The result, rebuilt from declared fields only.
 * @throws {ContractError} when a field is missing, outside its vocabulary, or
 *   answers one obligation twice.
 */
export function parseConformanceContract(value: unknown, path = 'conformance'): ConformanceContract {
  const source = asRecord(value, path)
  const items = list(source, 'items', path, parseConformanceItem)
  const answered = new Set(items.map(item => item.id))
  if (answered.size !== items.length) {
    throw new ContractError(`${path}.items`, 'must answer each obligation exactly once')
  }
  return Object.freeze({
    specSha256: digest(source, 'specSha256', path),
    planSha256: digest(source, 'planSha256', path),
    items,
    verdict: member(source, 'verdict', WORKFLOW_VERDICTS, path),
    summary: text(source, 'summary', path),
  })
}

/**
 * Read one workflow objective back.
 * @param value - The serialized objective.
 * @param path - Field path to report a rejection under.
 * @returns The objective, rebuilt from declared fields only.
 * @throws {ContractError} when a field is missing or outside its vocabulary.
 */
export function parseWorkflowObjective(value: unknown, path = 'objective'): WorkflowObjective {
  const source = asRecord(value, path)
  return Object.freeze({
    id: text(source, 'id', path),
    cwd: text(source, 'cwd', path),
    requirement: text(source, 'requirement', path),
    risk: member(source, 'risk', RISKS, path),
    workload: member(source, 'workload', WORKLOADS, path),
    profileId: text(source, 'profileId', path),
    approvedArtifacts: parseApprovedArtifactSet(source['approvedArtifacts'], `${path}.approvedArtifacts`),
    // Absent stays absent. Reading a missing class as `''` would put a label
    // nobody chose into durable facts, and policy would then match on it.
    ...source['taskClass'] === undefined ? {} : { taskClass: label(source, 'taskClass', path) },
  })
}
