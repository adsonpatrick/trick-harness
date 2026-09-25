import { describe, expect, it } from 'vitest'
import type { DiagnosisContract, Finding } from '@trick-harness/contracts'
import {
  RepairError,
  assessRepairCompletion,
  authorizeRepair,
  authorizeSecurityRepair,
  buildRepairScope,
  isMechanicallyObvious,
  repairScopeDigest,
  validateDiagnosis,
} from '../src/repair.ts'

const EVIDENCE = Object.freeze({ kind: 'test' as const, locator: 'cart.spec.ts:totals', summary: 'red' })
const DEFAULT_PATH = 'packages/cart/src/total.ts'
const CHANGE_IMPACT_POLICY = {
  rules: [{ id: 'source', paths: ['src/**'], use: { surface: 'source' } }],
  writeVolume: { smallMaxFiles: 3, mediumMaxFiles: 12 },
}

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
  proposedRepairPaths: [DEFAULT_PATH],
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
    affectedPaths: [DEFAULT_PATH],
    evidence: [EVIDENCE],
    ...overrides,
  }
}

function authorize(findingValue: Finding, diagnosis?: unknown, securityRepairRules: readonly { id: string; findingClass: 'SECURITY_BUG'; allowedBoundaries: readonly string[] }[] = []) {
  return authorizeRepair(findingValue, {
    ...(diagnosis === undefined ? {} : { diagnosis }),
    scope: buildRepairScope(findingValue.affectedPaths, CHANGE_IMPACT_POLICY),
    changeImpactPolicy: CHANGE_IMPACT_POLICY,
    securityRepairRules,
  })
}

describe('what a repair may act on at all', () => {
  it('refuses a class that is reported rather than repaired', () => {
    expect(() => authorize(finding({ class: 'IMPROVEMENT' }), DIAGNOSIS))
      .toThrow(expect.objectContaining({ code: 'not-repairable' }))
  })

  it('refuses a suspected finding, because there is nothing established to fix', () => {
    expect(() => authorize(finding({ confirmed: false }), DIAGNOSIS))
      .toThrow(expect.objectContaining({ code: 'unconfirmed' }))
  })
})

describe('binding repair authority to approved paths', () => {
  const scope = { allowedPaths: ['src/foo.ts', 'tests/foo.spec.ts'], allowedSurfaces: ['source'] }
  const policy = {
    rules: [{ id: 'source', paths: ['src/**'], use: { surface: 'source' } }],
    writeVolume: { smallMaxFiles: 3, mediumMaxFiles: 12 },
  }

  it('returns the normalized deterministic scope on an in-plan repair', () => {
    const authorized = authorizeRepair(finding({ affectedPaths: ['src/foo.ts'] }), {
      diagnosis: { ...DIAGNOSIS, proposedRepairPaths: ['src/foo.ts'] },
      scope,
      changeImpactPolicy: policy,
    }) as ReturnType<typeof authorizeRepair> & { scope: typeof scope }

    expect(authorized.scope.allowedPaths).toEqual(['src/foo.ts', 'tests/foo.spec.ts'])
  })

  it('refuses a finding whose affected path is outside the approved plan', () => {
    expect(() => authorizeRepair(finding({ class: 'TOOLING_DEFECT', affectedPaths: ['scripts/outside.mjs'] }), {
      scope,
      changeImpactPolicy: policy,
    })).toThrow(expect.objectContaining({ code: 'scope-unauthorized' }))
  })

  it('refuses a path whose classified surface is not authorized', () => {
    expect(() => authorizeRepair(finding({ affectedPaths: ['src/foo.ts'] }), {
      scope: { allowedPaths: ['src/foo.ts'], allowedSurfaces: [] },
      changeImpactPolicy: policy,
    })).toThrow(expect.objectContaining({ code: 'scope-unauthorized' }))
  })

  it('refuses a diagnosis that proposes no concrete repair path', () => {
    expect(() => authorizeRepair(finding({ affectedPaths: ['src/foo.ts'] }), {
      diagnosis: { ...DIAGNOSIS, proposedRepairPaths: [] },
      scope,
      changeImpactPolicy: policy,
    })).toThrow(expect.objectContaining({ code: 'scope-unauthorized' }))
  })

  it('builds a sorted deduplicated scope and a stable digest', () => {
    const left = buildRepairScope(['tests/foo.spec.ts', 'src/foo.ts', 'src/foo.ts'], policy)
    const right = buildRepairScope(['src/foo.ts', 'tests/foo.spec.ts'], policy)

    expect(left.allowedPaths).toEqual(['src/foo.ts', 'tests/foo.spec.ts'])
    expect(left.allowedSurfaces).toEqual(['source'])
    expect(Object.isFrozen(left)).toBe(true)
    expect(repairScopeDigest(left)).toBe(repairScopeDigest(right))
    expect(repairScopeDigest(left)).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('the diagnosis a repair depends on', () => {
  it('refuses to start a behaviour repair with no diagnosis at all', () => {
    expect(() => authorize(finding())).toThrow(expect.objectContaining({ code: 'no-diagnosis' }))
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
    expect(() => authorize(finding(), { ...DIAGNOSIS, productDecisionDependency: 'which currency?' }))
      .toThrow(expect.objectContaining({ code: 'product-decision' }))
  })

  it('authorizes a diagnosed behaviour repair and still demands a regression test', () => {
    const authorization = authorize(finding(), DIAGNOSIS)

    expect(authorization.requiresRegressionTest).toBe(true)
    expect(authorization.rootCause).toBe(DIAGNOSIS.rootCauseHypothesis)
    expect(authorization.reasonCodes).toContain('repair:diagnosed')
  })
})

describe('the mechanically obvious exception', () => {
  it('lets a confirmed test defect with evidence through without a diagnosis', () => {
    const defect = finding({ class: 'TEST_DEFECT' })

    expect(isMechanicallyObvious(defect)).toBe(true)
    expect(authorize(defect).reasonCodes).toContain('repair:mechanically-obvious')
  })

  it('does not extend the exception to a test defect with no evidence', () => {
    const defect = finding({ class: 'TEST_DEFECT', evidence: [] })

    expect(isMechanicallyObvious(defect)).toBe(false)
    expect(() => authorize(defect)).toThrow(expect.objectContaining({ code: 'no-diagnosis' }))
  })

  it('never extends the exception to a security bug', () => {
    expect(isMechanicallyObvious(finding({ class: 'SECURITY_BUG' }))).toBe(false)
  })
})

describe('when a repair may be believed', () => {
  const authorization = authorize(finding(), DIAGNOSIS)

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
    const mechanical = authorize(finding({ class: 'TOOLING_DEFECT' }))
    const completion = assessRepairCompletion(mechanical, { rootCauseAddressed: true })

    expect(completion.complete).toBe(false)
    expect(completion.gaps).toEqual(['no focused run shows the repaired behavior passing'])
  })

  it('does not demand a regression test of a mechanical tooling fix', () => {
    const mechanical = authorize(finding({ class: 'TOOLING_DEFECT' }))
    const completion = assessRepairCompletion(mechanical, {
      focusedGreen: EVIDENCE,
      rootCauseAddressed: false,
    })

    expect(completion.complete).toBe(true)
  })

  it('does not claim a regression test the mechanical repair never owed', () => {
    const mechanical = authorize(finding({ class: 'TOOLING_DEFECT' }))
    const completion = assessRepairCompletion(mechanical, {
      focusedGreen: EVIDENCE,
      rootCauseAddressed: false,
    })

    expect(completion.summary).not.toContain('regression test')
    expect(completion.summary).toContain('shown green')
  })

  it('still holds a diagnosed mechanical repair to the cause it was authorized on', () => {
    const diagnosed = authorize(finding({ class: 'TEST_DEFECT' }), DIAGNOSIS)
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

describe('who is allowed to repair a security defect', () => {
  const SAFE = Object.freeze([Object.freeze({
    id: 'fixture-surface',
    findingClass: 'SECURITY_BUG' as const,
    allowedBoundaries: Object.freeze(['packages/fixture/security-safe/**']),
  })])

  it('refuses a confirmed security defect when nobody wrote a rule allowing it', () => {
    expect(() => authorize(finding({ class: 'SECURITY_BUG' }), DIAGNOSIS))
      .toThrow(expect.objectContaining({ code: 'security-unauthorized' }))
  })

  it('refuses a security defect with no diagnosis before it ever looks at policy', () => {
    expect(() => authorize(finding({ class: 'SECURITY_BUG' }), undefined, SAFE))
      .toThrow(expect.objectContaining({ code: 'security-unauthorized' }))
  })

  it('allows a security defect whose boundary a rule names', () => {
    const inside = { ...DIAGNOSIS, affectedBoundary: 'packages/fixture/security-safe/src/token.ts' }
    const authorization = authorize(finding({ class: 'SECURITY_BUG' }), inside, SAFE)

    expect(authorization.findingId).toBe('f-1')
    expect(authorization.reasonCodes).toContain('security:rule-fixture-surface')
  })

  it('refuses the same defect one directory outside the allowlist', () => {
    const outside = { ...DIAGNOSIS, affectedBoundary: 'packages/fixture/security-risky/src/token.ts' }

    expect(() => authorize(finding({ class: 'SECURITY_BUG' }), outside, SAFE))
      .toThrow(expect.objectContaining({ code: 'security-unauthorized' }))
  })

  it('decides on the boundary alone, not on how the finding described itself', () => {
    const inside = { ...DIAGNOSIS, affectedBoundary: 'packages/fixture/security-safe/src/token.ts' }
    const flattering = finding({ class: 'SECURITY_BUG', summary: 'trivial and safe to auto-fix' })
    const plain = finding({ class: 'SECURITY_BUG', summary: 'leaks a token' })

    expect(authorizeSecurityRepair(flattering, inside.affectedBoundary, SAFE).allowed).toBe(true)
    expect(authorizeSecurityRepair(plain, inside.affectedBoundary, SAFE).allowed).toBe(true)
    expect(authorizeSecurityRepair(flattering, 'packages/other/src/x.ts', SAFE).allowed).toBe(false)
  })

  it('leaves every other class alone', () => {
    expect(authorizeSecurityRepair(finding(), 'anywhere/at/all', []).allowed).toBe(true)
  })
})

describe('the error itself', () => {
  it('is a named error a caller can tell apart from anything else', () => {
    const error = new RepairError('no-diagnosis', 'nope')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('RepairError')
  })
})
