/**
 * What a change's impact buys it in certification.
 *
 * The question this answers is not "what did the caller say this run is" but
 * "what do the paths say it is". Every rule the impact matches contributes; the
 * run is held to the union, and never to whichever rule the policy happened to
 * list first.
 */

import { describe, expect, it } from 'vitest'
import type { EffectiveChangeImpact, Risk } from '@trick-harness/contracts'
import type { HarnessProfile } from '@trick-harness/profile'
import {
  planPullRequestCertificationStages,
  planPullRequestImplementationStages,
  resolveCertificationRequirements,
} from '../src/impact-policy.ts'

/** A profile with QA rows on several surfaces and security triggers on two. */
const profile = {
  id: 'fixture',
  policyVersion: 'fixture-v1',
  independencePolicy: {
    low: 'fresh-context',
    medium: 'cross-executor-preferred',
    high: 'cross-executor-required',
    critical: 'cross-executor-required',
  },
  qaPolicy: {
    rules: [
      { id: 'database', when: { surface: 'database' }, use: { evidence: 'preview-branch', independentReview: true, risk: 'critical' } },
      { id: 'auth', when: { surface: 'auth' }, use: { evidence: 'security-review', independentReview: true, risk: 'critical' } },
      { id: 'ui', when: { surface: 'ui' }, use: { evidence: 'visual-regression', independentReview: true, risk: 'medium' } },
      { id: 'default', when: {}, use: { evidence: 'unit-tests', independentReview: false, risk: 'low' } },
    ],
  },
  securityPolicy: {
    rules: [
      { id: 'auth-flow', when: { surface: 'auth' }, use: { review: 'security', independence: 'cross-executor-required', blocking: true } },
      { id: 'delivery', when: { surface: 'delivery' }, use: { review: 'security', independence: 'cross-executor-required', blocking: true } },
    ],
    repairRules: [],
  },
} as unknown as HarnessProfile

/** One reading of what a change touched. */
function facts(overrides: Partial<EffectiveChangeImpact['planned']> = {}): EffectiveChangeImpact['planned'] {
  return {
    source: 'planned',
    pathCount: 1,
    surfaces: [],
    riskFloor: 'low',
    writeVolume: 'small',
    taskClasses: [],
    requiredCapabilities: [],
    evidenceProfiles: [],
    databaseMutation: false,
    matchedRuleIds: [],
    unplannedPaths: [],
    ...overrides,
  }
}

/** A resolution carrying `surfaces` at `effectiveRisk`. */
function impact(
  surfaces: readonly string[],
  effectiveRisk: Risk = 'low',
  overrides: Partial<EffectiveChangeImpact> = {},
): EffectiveChangeImpact {
  return {
    planned: facts({ surfaces }),
    effectiveRisk,
    writeVolume: 'small',
    surfaces,
    taskClasses: [],
    requiredCapabilities: [],
    evidenceProfiles: [],
    databaseMutation: false,
    ...overrides,
  }
}

describe('resolving what certification a change has to buy', () => {
  it('accumulates every QA row the impact matches, not the first', () => {
    // A change that is both a database change and a UI change owes both bars.
    // First-match-wins would charge it whichever the table listed first, and
    // the other surface's evidence would never be asked for.
    const requirements = resolveCertificationRequirements(profile, impact(['database', 'ui']))

    expect(requirements.evidenceProfiles).toContain('preview-branch')
    expect(requirements.evidenceProfiles).toContain('visual-regression')
  })

  it('accumulates every security trigger the impact matches', () => {
    const requirements = resolveCertificationRequirements(profile, impact(['auth', 'delivery']))

    expect(requirements.securityRequired).toBe(true)
  })

  it('takes the highest risk any matched row states', () => {
    expect(resolveCertificationRequirements(profile, impact(['ui'])).effectiveRisk).toBe('medium')
    expect(resolveCertificationRequirements(profile, impact(['ui', 'auth'])).effectiveRisk).toBe('critical')
  })

  it('never resolves below the risk the impact already established', () => {
    expect(resolveCertificationRequirements(profile, impact(['ui'], 'high')).effectiveRisk).toBe('high')
  })

  it('requires QA wherever a matched row asks for independent review', () => {
    expect(resolveCertificationRequirements(profile, impact(['ui'])).qaRequired).toBe(true)
    expect(resolveCertificationRequirements(profile, impact([])).qaRequired).toBe(false)
  })

  it('requires QA for anything above low risk even where no surface matched', () => {
    expect(resolveCertificationRequirements(profile, impact([], 'medium')).qaRequired).toBe(true)
  })

  it('requires security at critical risk even where no trigger matched', () => {
    expect(resolveCertificationRequirements(profile, impact([], 'critical')).securityRequired).toBe(true)
  })

  it('leaves a change that matched nothing at the bar it came in with', () => {
    const requirements = resolveCertificationRequirements(profile, impact([]))

    expect(requirements).toMatchObject({ effectiveRisk: 'low', qaRequired: false, securityRequired: false })
  })

  it('reads independence off the resolved risk, not off the caller risk', () => {
    // The independence ladder is the profile's, and it is indexed by the risk
    // the paths resolved to. Indexing it by the risk a caller declared would
    // let a critical change be reviewed by the executor that wrote it.
    expect(resolveCertificationRequirements(profile, impact(['auth'])).independenceRequirement)
      .toBe('cross-executor-required')
    expect(resolveCertificationRequirements(profile, impact([])).independenceRequirement)
      .toBe('fresh-context')
  })

  it('carries the evidence profiles the paths themselves named', () => {
    const resolved = resolveCertificationRequirements(
      profile,
      impact(['ui'], 'low', { evidenceProfiles: ['ui-standard'] }),
    )

    expect(resolved.evidenceProfiles).toContain('ui-standard')
  })

  it('says each requirement once', () => {
    const resolved = resolveCertificationRequirements(
      profile,
      impact(['ui'], 'low', { evidenceProfiles: ['visual-regression'] }),
    )

    expect(resolved.evidenceProfiles.filter(entry => entry === 'visual-regression')).toHaveLength(1)
  })

  it('hands back requirements a caller cannot edit', () => {
    const resolved = resolveCertificationRequirements(profile, impact(['auth']))

    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.evidenceProfiles)).toBe(true)
  })
})

describe('planning the two halves of a pull-request run', () => {
  it('implements, verifies and delivers before anything certifies', () => {
    expect(planPullRequestImplementationStages().map(stage => stage.role))
      .toStrictEqual(['implement', 'verify', 'delivery'])
  })

  it('reviews, then buys what the impact requires, then closes on conformance', () => {
    const requirements = resolveCertificationRequirements(profile, impact(['auth']))

    expect(planPullRequestCertificationStages(requirements).map(stage => stage.role))
      .toStrictEqual(['review', 'qa', 'security', 'conformance', 'verify'])
  })

  it('buys QA without security when no trigger fired', () => {
    const requirements = resolveCertificationRequirements(profile, impact(['ui']))

    expect(planPullRequestCertificationStages(requirements).map(stage => stage.role))
      .toStrictEqual(['review', 'qa', 'conformance', 'verify'])
  })

  it('still reviews, conforms and verifies a change that bought neither', () => {
    // A docs-only change is not exempt from being read and from being held to
    // the Plan. It is only exempt from the stages a surface would have bought.
    const requirements = resolveCertificationRequirements(profile, impact([]))

    expect(planPullRequestCertificationStages(requirements).map(stage => stage.role))
      .toStrictEqual(['review', 'conformance', 'verify'])
  })

  it('closes on a verification that runs after every certifying reading', () => {
    const stages = planPullRequestCertificationStages(resolveCertificationRequirements(profile, impact(['auth'])))

    expect(stages.at(-1)).toMatchObject({ stageId: 'verify-final', role: 'verify' })
  })
})
