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
  CONFIDENCE_LEVELS,
  EVIDENCE_KINDS,
  FINDING_CLASSES,
  RISKS,
  ROLES,
  ROUTED_PERMISSION_MODES,
  SECURITY_RELEVANCES,
  WORKFLOW_VERDICTS,
  WORKLOADS,
} from './types.ts'
import type {
  DiagnosisContract,
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
  })
}
