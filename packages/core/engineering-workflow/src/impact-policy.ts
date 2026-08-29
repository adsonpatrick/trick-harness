/**
 * What a change's measured impact requires of the run that produced it.
 *
 * The profile states, per surface, what QA bar a change owes and whether it
 * needs a security reading. This module reads those tables against the impact
 * facts and resolves one set of requirements. Two properties are the whole
 * point of doing it here rather than at each call site:
 *
 * - **Rules accumulate.** Unlike routing, where the first matching row wins, a
 *   change that touches two surfaces owes both bars. Picking one would let a
 *   change be certified as whichever half the table happened to list first.
 * - **Nothing resolves downward.** Every ladder is merged with `max` and every
 *   list with a union, so no reading can remove what another established.
 *
 * @module @trick-harness/engineering-workflow/impact-policy
 */

import { RISKS } from '@trick-harness/contracts'
import type { EffectiveChangeImpact, IndependenceRequirement, Risk } from '@trick-harness/contracts'
import type { HarnessProfile, PolicyRuleDefinition } from '@trick-harness/profile'
import type { StageSpec } from './types.ts'

/** What certification a run has to buy, resolved from its measured impact. */
export interface CertificationRequirements {
  /** The risk the run is held at: the impact's, raised by any matched QA row. */
  readonly effectiveRisk: Risk
  /** Whether an independent QA stage runs. */
  readonly qaRequired: boolean
  /** Whether a security reading runs. */
  readonly securityRequired: boolean
  /** Every evidence profile the impact and the matched QA rows name, deduplicated. */
  readonly evidenceProfiles: readonly string[]
  /** How independent the certifying stages must be, read off the resolved risk. */
  readonly independenceRequirement: IndependenceRequirement
}

/**
 * Whether `rule` speaks about any of the surfaces this change touched.
 *
 * A row with an empty `when` is the profile's default and speaks about every
 * change; a row keyed on a surface speaks only about changes carrying it.
 *
 * @param rule - the policy row.
 * @param surfaces - the surfaces the impact resolved to.
 * @returns true when the row applies to this change.
 */
function matches(rule: PolicyRuleDefinition, surfaces: readonly string[]): boolean {
  const wanted = rule.when['surface']
  if (wanted === undefined) return Object.keys(rule.when).length === 0
  return surfaces.includes(String(wanted))
}

/**
 * The higher of two risks on the profile-pinned ladder.
 *
 * @param left - one risk.
 * @param right - the other.
 * @returns whichever sits further up.
 */
function higherRisk(left: Risk, right: Risk): Risk {
  return RISKS.indexOf(left) >= RISKS.indexOf(right) ? left : right
}

/**
 * Resolve what certification this change's impact requires.
 *
 * @param profile - the project's QA, security and independence tables.
 * @param impact - the resolved impact of the change, planned and actual.
 * @returns the requirements, frozen, so no later stage can lower its own bar.
 */
export function resolveCertificationRequirements(
  profile: HarnessProfile,
  impact: EffectiveChangeImpact,
): CertificationRequirements {
  const evidence = new Set<string>(impact.evidenceProfiles)
  let risk = impact.effectiveRisk
  let independentReviewAsked = false

  for (const rule of profile.qaPolicy.rules) {
    if (!matches(rule, impact.surfaces)) continue
    const stated = rule.use['risk']
    if (typeof stated === 'string' && (RISKS as readonly string[]).includes(stated)) {
      risk = higherRisk(risk, stated as Risk)
    }
    const profileName = rule.use['evidence']
    if (typeof profileName === 'string' && profileName !== '') evidence.add(profileName)
    if (rule.use['independentReview'] === true) independentReviewAsked = true
  }

  const securityTriggered = profile.securityPolicy.rules.some(rule => matches(rule, impact.surfaces))

  return Object.freeze({
    effectiveRisk: risk,
    // Above `low` the run buys QA whether or not a surface matched: an impact
    // that already resolved to medium is not made ordinary by the absence of a
    // row naming it.
    qaRequired: independentReviewAsked || risk !== 'low',
    // Critical work is read for security even where no trigger named the
    // surface, which is the behaviour the fixed lifecycle had before impact
    // could speak at all.
    securityRequired: securityTriggered || risk === 'critical',
    evidenceProfiles: Object.freeze([...evidence]),
    independenceRequirement: profile.independencePolicy[risk],
  })
}

/**
 * The stages that produce and publish the change.
 *
 * Fixed, and deliberately independent of impact: what a change turns out to be
 * is not known until it exists, so nothing here may be decided from it.
 *
 * @returns the implementation half of a pull-request run.
 */
export function planPullRequestImplementationStages(): readonly StageSpec[] {
  return Object.freeze([
    { stageId: 'implement-1', role: 'implement' },
    { stageId: 'verify-1', role: 'verify' },
    { stageId: 'delivery-1', role: 'delivery' },
  ] as const satisfies readonly StageSpec[])
}

/**
 * The stages that certify the published change.
 *
 * Planned after delivery, when the actual change set has been read, so the bar
 * is set by what was delivered rather than by what was intended.
 *
 * @param requirements - what the measured impact requires.
 * @returns the certification half, always closing on a final verification.
 */
export function planPullRequestCertificationStages(
  requirements: CertificationRequirements,
): readonly StageSpec[] {
  const stages: StageSpec[] = [{ stageId: 'review-1', role: 'review' }]
  if (requirements.qaRequired) stages.push({ stageId: 'qa-1', role: 'qa' })
  if (requirements.securityRequired) stages.push({ stageId: 'security-1', role: 'security' })
  stages.push({ stageId: 'conformance-1', role: 'conformance' })
  // Last, and after every certifying reading: a verification that ran before a
  // stage could still change something attests to a tree nobody certified.
  stages.push({ stageId: 'verify-final', role: 'verify' })
  return Object.freeze(stages)
}
