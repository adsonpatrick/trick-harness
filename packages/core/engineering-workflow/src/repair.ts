/**
 * The gate a repair has to pass before it is allowed to write anything.
 *
 * Debugging and repair are separate acts by separate stages: a read-only
 * debugger establishes a root cause and states it as a `DiagnosisContract`, and
 * only then may a repair worker touch the tree. This module holds that rule as
 * plain functions, so the runtime can apply it before it dispatches and a caller
 * can apply the same one outside a run.
 *
 * @packageDocumentation
 */

import { AUTO_REPAIRABLE_FINDINGS, parseDiagnosisContract } from '@trick-harness/contracts'
import type { DiagnosisContract, EvidenceRef, Finding } from '@trick-harness/contracts'

/**
 * Finding classes whose repair may skip diagnosis.
 *
 * A red test that asserts the wrong constant and a lint rule pointed at a path
 * that no longer exists are defects of the scaffolding, not of the product:
 * there is no behavior to reproduce and no root cause a debugger would find that
 * the finding does not already state. Everything else — anything that changes
 * what the software does for a user — goes through a debugger first.
 */
export const MECHANICAL_FINDINGS: readonly Finding['class'][] = ['TEST_DEFECT', 'TOOLING_DEFECT']

/**
 * Finding classes whose repair changes behavior and therefore needs a test.
 *
 * These are the defects a regression test can pin. A repair to them is finished
 * only when a test that failed before it exists and passes after it.
 */
export const BEHAVIOR_FINDINGS: readonly Finding['class'][] = ['BUG', 'SECURITY_BUG']

/** A repair the gate refuses, named so a caller can tell the refusals apart. */
export class RepairError extends Error {
  /** Machine-readable cause. */
  readonly code:
    | 'not-repairable'
    | 'unconfirmed'
    | 'no-diagnosis'
    | 'incomplete-diagnosis'
    | 'unsupported-root-cause'
    | 'product-decision'

  /**
   * @param code - Machine-readable cause.
   * @param message - What was refused, stated without quoting caller data.
   */
  constructor(code: RepairError['code'], message: string) {
    super(message)
    this.name = 'RepairError'
    this.code = code
  }
}

/** What the gate decided, and what the repair still owes when it is done. */
export interface RepairAuthorization {
  /** The finding this repair is authorized against. */
  readonly findingId: string
  /** Why it was allowed, in codes a durable record can carry. */
  readonly reasonCodes: readonly string[]
  /** Whether a regression test that failed first has to exist afterwards. */
  readonly requiresRegressionTest: boolean
  /** The root cause the repair has to address, or undefined for a mechanical fix. */
  readonly rootCause: string | undefined
}

/** What a finished repair claims, offered back to the gate for judgement. */
export interface RepairEvidence {
  /** The test that failed before the fix and pins the defect. */
  readonly regressionTest?: EvidenceRef | undefined
  /** The focused run that passes after it. */
  readonly focusedGreen?: EvidenceRef | undefined
  /** Whether the change addresses the diagnosed cause rather than the symptom. */
  readonly rootCauseAddressed: boolean
}

/** Whether a finished repair may be believed, and why or why not. */
export interface RepairCompletion {
  /** True only when every obligation the authorization named was met. */
  readonly complete: boolean
  /** What is missing, one line per unmet obligation. */
  readonly gaps: readonly string[]
  /** One line a person or a journal can read. */
  readonly summary: string
}

/** Whether a string carries anything a reader could act on. */
function stated(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0
}

/**
 * Whether a finding is obvious enough that no debugger would add anything.
 *
 * Two conditions, both required: the class has to be scaffolding rather than
 * behavior, and the finding has to point at evidence. A test defect asserted
 * with nothing to look at is a claim, and a claim is exactly what diagnosis
 * exists to check.
 * @param finding - The finding a repair would act on.
 * @returns True when the finding may be repaired without a diagnosis.
 */
export function isMechanicallyObvious(finding: Finding): boolean {
  return finding.confirmed
    && MECHANICAL_FINDINGS.includes(finding.class)
    && finding.evidence.length > 0
}

/**
 * Read a diagnosis back and hold it to the parts a repair actually uses.
 *
 * Field presence is the contract parser's job. This adds the two conditions the
 * shape cannot express: a root cause nothing was eliminated to reach is a first
 * guess rather than a diagnosis, and a root cause the debugger itself rates as
 * low confidence is not support for writing to the tree.
 * @param value - The diagnosis, as the debugger stage produced it.
 * @returns The diagnosis, rebuilt from declared fields only.
 * @throws {RepairError} when a field is missing or the root cause is unsupported.
 */
export function validateDiagnosis(value: unknown): DiagnosisContract {
  let diagnosis: DiagnosisContract
  try {
    diagnosis = parseDiagnosisContract(value)
  } catch (cause) {
    throw new RepairError('incomplete-diagnosis',
      `the diagnosis is missing a required field: ${cause instanceof Error ? cause.message : 'unreadable'}`)
  }
  if (diagnosis.observedEvidence.length === 0) {
    throw new RepairError('incomplete-diagnosis', 'the diagnosis names no observed evidence')
  }
  if (diagnosis.ruledOutHypotheses.length === 0) {
    throw new RepairError('unsupported-root-cause',
      'the diagnosis eliminated no competing explanation, so its root cause is a first guess')
  }
  if (diagnosis.confidence === 'low') {
    throw new RepairError('unsupported-root-cause',
      'the debugger rates its own root cause as low confidence, which is not support for a repair')
  }
  return diagnosis
}

/**
 * Decide whether a repair may start, and what it will owe when it finishes.
 *
 * The order is deliberate. Repairability is a property of the class, reality is
 * a property of the finding, and a root cause is a property of the diagnosis;
 * each is checked where it lives, and a product decision stops the run before
 * any of it matters, because inventing product behavior is the one failure a
 * later review could not detect.
 * @param finding - The confirmed defect the repair would act on.
 * @param diagnosis - What the read-only debugger established, if it ran.
 * @returns What the repair is authorized to do and what it still owes.
 * @throws {RepairError} when the repair may not start.
 */
export function authorizeRepair(finding: Finding, diagnosis?: unknown): RepairAuthorization {
  if (!AUTO_REPAIRABLE_FINDINGS.includes(finding.class)) {
    throw new RepairError('not-repairable',
      `a ${finding.class} finding is reported and left alone, never repaired automatically`)
  }
  if (!finding.confirmed) {
    throw new RepairError('unconfirmed', 'the finding is suspected rather than established, so there is nothing to fix yet')
  }

  if (diagnosis === undefined) {
    if (!isMechanicallyObvious(finding)) {
      throw new RepairError('no-diagnosis',
        `a ${finding.class} finding needs a read-only diagnosis before a repair may write anything`)
    }
    return Object.freeze({
      findingId: finding.id,
      reasonCodes: Object.freeze(['repair:mechanically-obvious', `repair:class-${finding.class}`]),
      requiresRegressionTest: false,
      rootCause: undefined,
    })
  }

  const contract = validateDiagnosis(diagnosis)
  if (stated(contract.productDecisionDependency)) {
    throw new RepairError('product-decision',
      'the defect depends on an unmade product decision; the run stops rather than inventing the behavior')
  }
  return Object.freeze({
    findingId: finding.id,
    reasonCodes: Object.freeze([
      'repair:diagnosed',
      `repair:class-${finding.class}`,
      `repair:confidence-${contract.confidence}`,
    ]),
    requiresRegressionTest: BEHAVIOR_FINDINGS.includes(finding.class),
    rootCause: contract.rootCauseHypothesis,
  })
}

/**
 * Judge a finished repair against what it was authorized to owe.
 *
 * A symptom that stopped appearing is not a repair. Without a test that failed
 * first the change is unpinned, without a passing focused run it is unshown, and
 * without the diagnosed cause addressed it is a coincidence — so each of those
 * is a gap, and any gap leaves the repair incomplete.
 * @param authorization - What the gate allowed and required.
 * @param evidence - What the repair claims it produced.
 * @returns Whether the repair may be believed, and what is missing.
 */
export function assessRepairCompletion(
  authorization: RepairAuthorization,
  evidence: RepairEvidence,
): RepairCompletion {
  const gaps: string[] = []
  if (authorization.requiresRegressionTest && evidence.regressionTest === undefined) {
    gaps.push('no regression test pins the defect, so it can come back unseen')
  }
  // Owed wherever a diagnosis was demanded, not only where a regression test
  // was. A repair authorized on a stated root cause that does not address it is
  // a symptom that stopped appearing, whatever class of defect it was.
  if (authorization.rootCause !== undefined && !evidence.rootCauseAddressed) {
    gaps.push('the change does not address the diagnosed root cause, so the symptom may only have moved')
  }
  if (evidence.focusedGreen === undefined) {
    gaps.push('no focused run shows the repaired behavior passing')
  }
  // The summary names what this repair actually produced. A mechanical fix owes
  // no regression test, and saying it was pinned by one would put a claim in the
  // durable record that nothing in the run supports.
  const shown = [
    ...evidence.regressionTest === undefined ? [] : ['pinned by a regression test'],
    ...authorization.rootCause === undefined ? [] : ['addressed at its diagnosed cause'],
    'shown green',
  ]
  return Object.freeze({
    complete: gaps.length === 0,
    gaps: Object.freeze(gaps),
    summary: gaps.length === 0
      ? `the repair of ${authorization.findingId} is ${shown.join(', ')}`
      : `the repair of ${authorization.findingId} is incomplete: ${gaps.join('; ')}`,
  })
}
