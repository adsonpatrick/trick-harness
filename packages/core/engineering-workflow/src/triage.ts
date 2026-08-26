/**
 * What a run is allowed to do about each thing a stage found.
 *
 * Triage is a total function over `FindingClass`: every class has one
 * disposition, decided here rather than by whichever stage happened to raise it.
 * That is the point — a reviewer that could decide its own findings were
 * actionable would be deciding scope, and scope is not a reviewer's to expand.
 *
 * @packageDocumentation
 */

import { AUTO_REPAIRABLE_FINDINGS } from '@trick-harness/contracts'
import type { Finding, FindingClass, Risk, Role, WorkflowVerdict } from '@trick-harness/contracts'

/** What the run does about one finding. */
export type TriageDisposition = 'repair' | 'block' | 'report'

/** One finding, with the disposition triage gave it and why. */
export interface TriagedFinding {
  readonly finding: Finding
  readonly disposition: TriageDisposition
  readonly reason: string
}

/** Every finding of one stage, sorted into what the run may do about them. */
export interface Triage {
  /** Confirmed defects an automated repair may act on, worst first. */
  readonly repairable: readonly Finding[]
  /** Findings only a person can settle; their presence blocks the run. */
  readonly blocking: readonly Finding[]
  /** Findings that are carried and reported, and never acted on. */
  readonly reported: readonly Finding[]
  /** Whether a confirmed defect that changes behaviour is among them. */
  readonly material: boolean
  /** Every finding with its disposition, in the order it was raised. */
  readonly entries: readonly TriagedFinding[]
}

/**
 * Classes only a person can settle.
 *
 * A missing product or design decision is not a defect, and `UNRESOLVED` is a
 * stage saying it could not tell. All three are questions, and answering a
 * question by writing code is how a run invents a requirement.
 */
export const BLOCKING_FINDINGS: readonly FindingClass[] = [
  'PRODUCT_DECISION',
  'DESIGN_DECISION',
  'UNRESOLVED',
]

/** Classes whose confirmed instances make a `PASS` impossible. */
export const MATERIAL_FINDINGS: readonly FindingClass[] = ['BUG', 'SECURITY_BUG']

/** Roles that certify somebody else's work rather than producing it. */
export const CERTIFYING_ROLES: readonly Role[] = ['verify', 'review', 'qa', 'security']

/** Repair order: a security defect outranks a product one, which outranks scaffolding. */
const REPAIR_PRIORITY: readonly FindingClass[] = ['SECURITY_BUG', 'BUG', 'TEST_DEFECT', 'TOOLING_DEFECT']

/**
 * Decide what the run may do about one finding.
 *
 * Confirmation is checked before class because it is the stronger condition: an
 * unconfirmed defect is a suspicion, and a suspicion is reported so a person or
 * a later stage can settle it, never repaired. A blocking class blocks whether
 * or not anyone confirmed it, because the thing that is missing is a decision
 * and no amount of evidence supplies one.
 * @param finding - The finding a stage raised.
 * @returns The finding, its disposition, and the rule that produced it.
 */
export function triageFinding(finding: Finding): TriagedFinding {
  if (BLOCKING_FINDINGS.includes(finding.class)) {
    return Object.freeze({
      finding,
      disposition: 'block' as const,
      reason: `a ${finding.class} finding is a question for a person, not work for a repair`,
    })
  }
  if (!AUTO_REPAIRABLE_FINDINGS.includes(finding.class)) {
    return Object.freeze({
      finding,
      disposition: 'report' as const,
      reason: `a ${finding.class} finding is reported; acting on it would expand the approved scope`,
    })
  }
  if (!finding.confirmed) {
    return Object.freeze({
      finding,
      disposition: 'report' as const,
      reason: `this ${finding.class} finding is suspected rather than established`,
    })
  }
  return Object.freeze({
    finding,
    disposition: 'repair' as const,
    reason: `a confirmed ${finding.class} finding is inside what an automated repair may fix`,
  })
}

/**
 * Sort one stage's findings into what the run may do about them.
 * @param findings - Everything the stage raised.
 * @returns The findings by disposition, worst-first among the repairable ones.
 */
export function triage(findings: readonly Finding[]): Triage {
  const entries = findings.map(triageFinding)
  const of = (disposition: TriageDisposition): Finding[] =>
    entries.filter(entry => entry.disposition === disposition).map(entry => entry.finding)
  const repairable = of('repair').sort(
    (left, right) => REPAIR_PRIORITY.indexOf(left.class) - REPAIR_PRIORITY.indexOf(right.class),
  )
  return Object.freeze({
    repairable: Object.freeze(repairable),
    blocking: Object.freeze(of('block')),
    reported: Object.freeze(of('report')),
    material: findings.some(finding => finding.confirmed && MATERIAL_FINDINGS.includes(finding.class)),
    entries: Object.freeze(entries),
  })
}

/** A verdict after triage has had its say about the findings behind it. */
export interface ReconciledVerdict {
  readonly verdict: WorkflowVerdict
  /** True when triage disagreed with the stage that reported the verdict. */
  readonly corrected: boolean
  readonly summary: string
}

/**
 * Hold a stage's verdict to the findings it raised alongside it.
 *
 * A stage may report whatever it concluded; it may not report a `PASS` over a
 * confirmed material defect, and it may not report anything but `BLOCKED` while
 * a decision nobody made is outstanding. The vocabulary is unchanged and no new
 * verdict is invented — this only refuses the combinations that would let a run
 * claim more assurance than its own evidence supports.
 * @param claimed - What the stage said.
 * @param result - What triage made of the findings it said it alongside.
 * @param summary - The stage's own summary, kept when nothing is corrected.
 * @returns The verdict the run will act on.
 */
export function reconcileVerdict(
  claimed: WorkflowVerdict,
  result: Triage,
  summary: string,
): ReconciledVerdict {
  if (result.blocking.length > 0 && claimed !== 'BLOCKED') {
    return Object.freeze({
      verdict: 'BLOCKED' as const,
      corrected: true,
      summary: `${result.blocking.length} finding(s) need a decision nobody has made: `
        + result.blocking.map(finding => finding.summary).join('; '),
    })
  }
  if (claimed === 'PASS' && result.material) {
    return Object.freeze({
      verdict: 'FAIL' as const,
      corrected: true,
      summary: 'the stage reported PASS over a confirmed material defect, which is not a pass',
    })
  }
  return Object.freeze({ verdict: claimed, corrected: false, summary })
}

/**
 * The QA sequence, in the order the approved Spec fixed it.
 *
 * Held as data rather than prose so a caller composing a QA charter reads the
 * same order the Spec wrote and a test can pin it. The runtime does not perform
 * these steps; it names them, which is what keeps every QA stage in every
 * profile asking for the same work.
 */
export const QA_SEQUENCE: readonly string[] = [
  'changed surface',
  'impact analysis',
  'risk classification',
  'charter',
  'coverage inventory',
  'targeted checks',
  'negative and error paths',
  'boundary and state transitions',
  'applicable E2E',
  'visual and accessibility where applicable',
  'exploratory checks',
  'findings',
  'triage',
  'authorized bug repair loop',
  'retest',
  'QA verdict',
]

/** What a QA stage is expected to cover at one risk level. */
export interface QaCharter {
  readonly risk: Risk
  /** The sequence steps this run performs, in order. */
  readonly steps: readonly string[]
  /** Whether the full end-to-end suite is promoted rather than a proportionate subset. */
  readonly fullE2E: boolean
}

/**
 * Scale the QA sequence to the risk without reordering or dropping judgement.
 *
 * Low risk stays proportionate: the visual and accessibility sweep and the
 * exploratory pass are the steps whose cost is least justified when a mistake is
 * cheap. Everything that establishes what changed and what could break is
 * performed at every level, because a proportionate QA run that skipped impact
 * analysis would not know what it was being proportionate about.
 * @param risk - The objective's risk.
 * @returns The steps this QA stage performs and whether E2E is promoted.
 */
export function qaCharter(risk: Risk): QaCharter {
  const trimmed: readonly string[] = ['visual and accessibility where applicable', 'exploratory checks']
  const proportionate = risk === 'low' || risk === 'medium'
  return Object.freeze({
    risk,
    steps: Object.freeze(proportionate ? QA_SEQUENCE.filter(step => !trimmed.includes(step)) : [...QA_SEQUENCE]),
    fullE2E: risk === 'high' || risk === 'critical',
  })
}

/**
 * What an independent code review is entitled to be given, and nothing else.
 *
 * A review that reads the implementer's account of the change is reviewing the
 * account. These three are the inputs that exist independently of whoever wrote
 * the code: the requirement as approved, the diff as committed, and evidence
 * re-read from the repository in this stage's own fresh context.
 */
export const REVIEW_INPUTS: readonly string[] = [
  'the exact approved requirement',
  'the exact committed diff',
  'repository evidence re-read in a fresh context',
]

/** The file a security stage grounds its findings in, per the approved Spec. */
export const SECURITY_GROUNDING = 'SECURITY.md'
