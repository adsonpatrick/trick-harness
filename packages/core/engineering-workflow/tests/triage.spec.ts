import { describe, expect, it } from 'vitest'
import { AUTO_REPAIRABLE_FINDINGS, FINDING_CLASSES } from '@trick-harness/contracts'
import type { Finding, FindingClass } from '@trick-harness/contracts'
import {
  BLOCKING_FINDINGS,
  CERTIFYING_ROLES,
  QA_SEQUENCE,
  REVIEW_INPUTS,
  SECURITY_GROUNDING,
  qaCharter,
  reconcileVerdict,
  triage,
  triageFinding,
} from '../src/triage.ts'

function finding(findingClass: FindingClass, confirmed = true, id = `f-${findingClass}`): Finding {
  return {
    id,
    class: findingClass,
    raisedBy: 'review',
    summary: `a ${findingClass}`,
    confirmed,
    evidence: [{ kind: 'diff', locator: 'src/thing.ts', summary: 'the change' }],
  }
}

describe('triage over every finding class', () => {
  it('gives every declared class exactly one disposition', () => {
    for (const findingClass of FINDING_CLASSES) {
      const entry = triageFinding(finding(findingClass))
      expect(['repair', 'block', 'report']).toContain(entry.disposition)
      expect(entry.reason).not.toBe('')
    }
  })

  it('repairs exactly the confirmed auto-repairable classes and nothing else', () => {
    const repaired = FINDING_CLASSES.filter(
      findingClass => triageFinding(finding(findingClass)).disposition === 'repair',
    )

    expect([...repaired].sort()).toEqual([...AUTO_REPAIRABLE_FINDINGS].sort())
  })

  it('blocks on the classes that are questions rather than defects', () => {
    const blocked = FINDING_CLASSES.filter(
      findingClass => triageFinding(finding(findingClass)).disposition === 'block',
    )

    expect([...blocked].sort()).toEqual([...BLOCKING_FINDINGS].sort())
  })

  it('reports and never repairs intentional behaviour, improvements, refactors and style', () => {
    for (const findingClass of ['INTENTIONAL_BEHAVIOR', 'IMPROVEMENT', 'REFACTOR_SUGGESTION', 'STYLE_ONLY'] as const) {
      expect(triageFinding(finding(findingClass)).disposition).toBe('report')
    }
  })

  it('reports a false positive rather than acting on it', () => {
    expect(triageFinding(finding('FALSE_POSITIVE')).disposition).toBe('report')
  })

  it('reports rather than repairs a defect nobody confirmed', () => {
    expect(triageFinding(finding('BUG', false)).disposition).toBe('report')
    expect(triageFinding(finding('SECURITY_BUG', false)).disposition).toBe('report')
  })

  it('blocks a product decision whether or not anyone confirmed it', () => {
    expect(triageFinding(finding('PRODUCT_DECISION', false)).disposition).toBe('block')
  })
})

describe('sorting one stage of findings', () => {
  it('puts a security defect ahead of an ordinary one', () => {
    const result = triage([finding('TOOLING_DEFECT'), finding('BUG'), finding('SECURITY_BUG')])

    expect(result.repairable.map(item => item.class)).toEqual(['SECURITY_BUG', 'BUG', 'TOOLING_DEFECT'])
  })

  it('calls a run material only when a confirmed behaviour defect is present', () => {
    expect(triage([finding('BUG')]).material).toBe(true)
    expect(triage([finding('BUG', false)]).material).toBe(false)
    expect(triage([finding('TEST_DEFECT')]).material).toBe(false)
    expect(triage([]).material).toBe(false)
  })

  it('keeps every finding, whatever it decided about it', () => {
    const findings = FINDING_CLASSES.map(findingClass => finding(findingClass))
    const result = triage(findings)

    expect(result.entries).toHaveLength(findings.length)
    expect(result.repairable.length + result.blocking.length + result.reported.length).toBe(findings.length)
  })
})

describe('holding a verdict to its own findings', () => {
  it('refuses a PASS reported over a confirmed material defect', () => {
    const result = reconcileVerdict('PASS', triage([finding('BUG')]), 'all good')

    expect(result.verdict).toBe('FAIL')
    expect(result.corrected).toBe(true)
  })

  it('allows a PASS over findings that are only reported', () => {
    const result = reconcileVerdict('PASS', triage([finding('STYLE_ONLY')]), 'all good')

    expect(result.verdict).toBe('PASS')
    expect(result.corrected).toBe(false)
    expect(result.summary).toBe('all good')
  })

  it('turns any verdict into BLOCKED while a decision is outstanding', () => {
    for (const claimed of ['PASS', 'PARTIAL', 'FAIL', 'INCONCLUSIVE'] as const) {
      expect(reconcileVerdict(claimed, triage([finding('DESIGN_DECISION')]), 's').verdict).toBe('BLOCKED')
    }
  })

  it('invents no verdict outside the approved vocabulary', () => {
    const vocabulary = ['PASS', 'PARTIAL', 'FAIL', 'INCONCLUSIVE', 'BLOCKED']
    for (const claimed of ['PASS', 'PARTIAL', 'FAIL', 'INCONCLUSIVE', 'BLOCKED'] as const) {
      expect(vocabulary).toContain(reconcileVerdict(claimed, triage([finding('BUG')]), 's').verdict)
    }
  })
})

describe('the QA charter', () => {
  it('keeps the sequence the approved Spec fixed, in order', () => {
    expect(QA_SEQUENCE.slice(0, 5)).toEqual([
      'changed surface', 'impact analysis', 'risk classification', 'charter', 'coverage inventory',
    ])
    expect(QA_SEQUENCE.at(-1)).toBe('QA verdict')
    expect(QA_SEQUENCE).toContain('negative and error paths')
    expect(QA_SEQUENCE).toContain('boundary and state transitions')
    expect(QA_SEQUENCE).toContain('applicable E2E')
  })

  it('stays proportionate at low risk without dropping impact analysis', () => {
    const charter = qaCharter('low')

    expect(charter.fullE2E).toBe(false)
    expect(charter.steps).toContain('impact analysis')
    expect(charter.steps).not.toContain('exploratory checks')
  })

  it('promotes the full sequence at high and critical risk', () => {
    for (const risk of ['high', 'critical'] as const) {
      const charter = qaCharter(risk)
      expect(charter.fullE2E).toBe(true)
      expect(charter.steps).toEqual(QA_SEQUENCE)
    }
  })

  it('never reorders the steps it keeps', () => {
    const kept = qaCharter('medium').steps
    const positions = kept.map(step => QA_SEQUENCE.indexOf(step))

    expect(positions).toEqual([...positions].sort((left, right) => left - right))
  })
})

describe('what the certifying stages are given', () => {
  it('names the requirement, the diff and fresh repository evidence as review inputs', () => {
    expect(REVIEW_INPUTS).toHaveLength(3)
    expect(REVIEW_INPUTS.join(' ')).toContain('requirement')
    expect(REVIEW_INPUTS.join(' ')).toContain('diff')
    expect(REVIEW_INPUTS.join(' ')).toContain('fresh context')
  })

  it('grounds the security stage in the repository security policy', () => {
    expect(SECURITY_GROUNDING).toBe('SECURITY.md')
  })

  it('counts every role that certifies somebody else as certifying, and no writer', () => {
    expect([...CERTIFYING_ROLES].sort()).toEqual(['qa', 'review', 'security', 'verify'])
  })
})
