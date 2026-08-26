import { describe, expect, it } from 'vitest'
import type { DiagnosisContract, Finding } from '@trick-harness/contracts'
import {
  RepairError,
  assessRepairCompletion,
  authorizeRepair,
  isMechanicallyObvious,
  validateDiagnosis,
} from '../src/repair.ts'

const EVIDENCE = Object.freeze({ kind: 'test' as const, locator: 'cart.spec.ts:totals', summary: 'red' })

const DIAGNOSIS: DiagnosisContract = Object.freeze({
  symptom: 'totals are a cent short',
  reproduction: 'vitest run cart.spec.ts',
  expectedVsActual: 'expected 10.00, got 9.99',
  observedEvidence: Object.freeze([EVIDENCE]),
  affectedBoundary: 'packages/cart/src/total.ts',
  ruledOutHypotheses: Object.freeze(['locale formatting']),
  rootCauseHypothesis: 'the subtotal truncates before tax is applied',
  confidence: 'high',
  regressionTestSeam: 'cart.spec.ts totals suite',
  minimalRepairSurface: 'total.ts rounding order',
  unknowns: Object.freeze([]),
  securityRelevance: 'none',
})

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    class: 'BUG',
    raisedBy: 'verify',
    summary: 'totals are a cent short',
    confirmed: true,
    evidence: [EVIDENCE],
    ...overrides,
  }
}

describe('what a repair may act on at all', () => {
  it('refuses a class that is reported rather than repaired', () => {
    expect(() => authorizeRepair(finding({ class: 'IMPROVEMENT' }), DIAGNOSIS))
      .toThrow(expect.objectContaining({ code: 'not-repairable' }))
  })

  it('refuses a suspected finding, because there is nothing established to fix', () => {
    expect(() => authorizeRepair(finding({ confirmed: false }), DIAGNOSIS))
      .toThrow(expect.objectContaining({ code: 'unconfirmed' }))
  })
})

describe('the diagnosis a repair depends on', () => {
  it('refuses to start a behaviour repair with no diagnosis at all', () => {
    expect(() => authorizeRepair(finding())).toThrow(expect.objectContaining({ code: 'no-diagnosis' }))
  })

  it('refuses a diagnosis that is missing a required field', () => {
    const { regressionTestSeam: _omitted, ...partial } = DIAGNOSIS
    expect(() => validateDiagnosis(partial)).toThrow(expect.objectContaining({ code: 'incomplete-diagnosis' }))
  })

  it('refuses a diagnosis that observed nothing', () => {
    expect(() => validateDiagnosis({ ...DIAGNOSIS, observedEvidence: [] }))
      .toThrow(expect.objectContaining({ code: 'incomplete-diagnosis' }))
  })

  it('refuses a root cause that eliminated no competing explanation', () => {
    expect(() => validateDiagnosis({ ...DIAGNOSIS, ruledOutHypotheses: [] }))
      .toThrow(expect.objectContaining({ code: 'unsupported-root-cause' }))
  })

  it('refuses a root cause the debugger itself rates as low confidence', () => {
    expect(() => validateDiagnosis({ ...DIAGNOSIS, confidence: 'low' }))
      .toThrow(expect.objectContaining({ code: 'unsupported-root-cause' }))
  })

  it('stops instead of inventing behaviour when a product decision is missing', () => {
    expect(() => authorizeRepair(finding(), { ...DIAGNOSIS, productDecisionDependency: 'which currency?' }))
      .toThrow(expect.objectContaining({ code: 'product-decision' }))
  })

  it('authorizes a diagnosed behaviour repair and still demands a regression test', () => {
    const authorization = authorizeRepair(finding(), DIAGNOSIS)

    expect(authorization.requiresRegressionTest).toBe(true)
    expect(authorization.rootCause).toBe(DIAGNOSIS.rootCauseHypothesis)
    expect(authorization.reasonCodes).toContain('repair:diagnosed')
  })
})

describe('the mechanically obvious exception', () => {
  it('lets a confirmed test defect with evidence through without a diagnosis', () => {
    const defect = finding({ class: 'TEST_DEFECT' })

    expect(isMechanicallyObvious(defect)).toBe(true)
    expect(authorizeRepair(defect).reasonCodes).toContain('repair:mechanically-obvious')
  })

  it('does not extend the exception to a test defect with no evidence', () => {
    const defect = finding({ class: 'TEST_DEFECT', evidence: [] })

    expect(isMechanicallyObvious(defect)).toBe(false)
    expect(() => authorizeRepair(defect)).toThrow(expect.objectContaining({ code: 'no-diagnosis' }))
  })

  it('never extends the exception to a security bug', () => {
    expect(isMechanicallyObvious(finding({ class: 'SECURITY_BUG' }))).toBe(false)
  })
})

describe('when a repair may be believed', () => {
  const authorization = authorizeRepair(finding(), DIAGNOSIS)

  it('accepts a repair pinned by a regression test and shown green', () => {
    const completion = assessRepairCompletion(authorization, {
      regressionTest: EVIDENCE,
      focusedGreen: EVIDENCE,
      rootCauseAddressed: true,
    })

    expect(completion.complete).toBe(true)
    expect(completion.gaps).toEqual([])
  })

  it('calls a symptom that merely stopped appearing incomplete', () => {
    const completion = assessRepairCompletion(authorization, {
      focusedGreen: EVIDENCE,
      rootCauseAddressed: false,
    })

    expect(completion.complete).toBe(false)
    expect(completion.gaps).toHaveLength(2)
    expect(completion.summary).toContain('root cause')
  })

  it('refuses to call a repair done when nothing was run afterwards', () => {
    const mechanical = authorizeRepair(finding({ class: 'TOOLING_DEFECT' }))
    const completion = assessRepairCompletion(mechanical, { rootCauseAddressed: true })

    expect(completion.complete).toBe(false)
    expect(completion.gaps).toEqual(['no focused run shows the repaired behavior passing'])
  })

  it('does not demand a regression test of a mechanical tooling fix', () => {
    const mechanical = authorizeRepair(finding({ class: 'TOOLING_DEFECT' }))
    const completion = assessRepairCompletion(mechanical, {
      focusedGreen: EVIDENCE,
      rootCauseAddressed: false,
    })

    expect(completion.complete).toBe(true)
  })

  it('does not claim a regression test the mechanical repair never owed', () => {
    const mechanical = authorizeRepair(finding({ class: 'TOOLING_DEFECT' }))
    const completion = assessRepairCompletion(mechanical, {
      focusedGreen: EVIDENCE,
      rootCauseAddressed: false,
    })

    expect(completion.summary).not.toContain('regression test')
    expect(completion.summary).toContain('shown green')
  })

  it('still holds a diagnosed mechanical repair to the cause it was authorized on', () => {
    const diagnosed = authorizeRepair(finding({ class: 'TEST_DEFECT' }), DIAGNOSIS)
    expect(diagnosed.requiresRegressionTest).toBe(false)
    expect(diagnosed.rootCause).toBeDefined()

    const completion = assessRepairCompletion(diagnosed, {
      focusedGreen: EVIDENCE,
      rootCauseAddressed: false,
    })

    expect(completion.complete).toBe(false)
    expect(completion.gaps).toEqual(['the change does not address the diagnosed root cause, so the symptom may only have moved'])
  })
})

describe('the error itself', () => {
  it('is a named error a caller can tell apart from anything else', () => {
    const error = new RepairError('no-diagnosis', 'nope')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('RepairError')
  })
})
