import { describe, expect, it } from 'vitest'

import {
  AUTO_REPAIRABLE_FINDINGS,
  ContractError,
  FINDING_CLASSES,
  INDEPENDENCE_REQUIREMENTS,
  READ_ONLY_ROLES,
  RISKS,
  ROLES,
  WORKFLOW_VERDICTS,
  WORKLOADS,
  WRITE_VOLUMES,
  parseDiagnosisContract,
  parseFinding,
  parseRouteDecision,
  parseStageResult,
  parseWorkflowObjective,
} from '../src/index.ts'
import type { DiagnosisContract, Finding, RouteDecision, StageResult, WorkflowObjective } from '../src/index.ts'

/** A finding that satisfies every required field, for mutation in individual tests. */
const finding: Finding = {
  id: 'f-1',
  class: 'BUG',
  raisedBy: 'review',
  summary: 'the retry counter resets on every attempt',
  confirmed: true,
  evidence: [{ kind: 'test', locator: 'retry.spec.ts:42', summary: 'fails on the second attempt' }],
}

/** A complete diagnosis, for mutation in individual tests. */
const diagnosis: DiagnosisContract = {
  symptom: 'the workflow retries forever',
  reproduction: 'run the repair stage twice with a failing gate',
  expectedVsActual: 'expected three cycles, observed unbounded cycles',
  observedEvidence: [{ kind: 'log', locator: 'run-7.log', summary: 'cycle counter stays at 1' }],
  affectedBoundary: 'the repair transition in the workflow state machine',
  ruledOutHypotheses: ['the gate itself is flaky: it fails deterministically'],
  rootCauseHypothesis: 'the counter is reset by the stage that reads it',
  confidence: 'high',
  regressionTestSeam: 'workflow.spec.ts, the bounded-repair describe block',
  minimalRepairSurface: 'the cycle accounting in the repair transition',
  unknowns: [],
  securityRelevance: 'none',
}

/** A complete route decision, for mutation in individual tests. */
const decision: RouteDecision = {
  executor: 'opencode',
  semanticModelTier: 'heavy-implementation',
  resolvedModel: 'mimo-v2.5',
  reasoningEffort: 'high',
  permissionMode: 'workspace-write',
  reasonCodes: ['role:implement', 'workload:heavy'],
  policyVersion: '2026-08-25.1',
}

/** A complete stage result, for mutation in individual tests. */
const stage: StageResult = {
  role: 'review',
  executor: 'codex',
  verdict: 'FAIL',
  summary: 'one confirmed bug in the retry accounting',
  findings: [finding],
  evidence: [{ kind: 'diff', locator: 'abc1234', summary: 'the reviewed change' }],
}

/** A complete objective, for mutation in individual tests. */
const objective: WorkflowObjective = {
  id: 'wf-1',
  cwd: '/workspace',
  requirement: 'bound the repair cycles',
  risk: 'high',
  workload: 'medium',
  profileId: 'plurora',
}

/** Serialize and re-read, which is what the durable boundary actually does. */
function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

describe('the shared vocabulary', () => {
  const vocabularies = {
    ROLES,
    WORKLOADS,
    RISKS,
    WRITE_VOLUMES,
    INDEPENDENCE_REQUIREMENTS,
    WORKFLOW_VERDICTS,
    FINDING_CLASSES,
  }

  for (const [name, values] of Object.entries(vocabularies)) {
    it(`declares ${name} without duplicates or blanks`, () => {
      expect(new Set(values).size).toBe(values.length)
      expect(values.every(value => value.trim().length > 0)).toBe(true)
    })
  }

  it('names every role a stage can play', () => {
    expect(ROLES).toStrictEqual([
      'refine',
      'plan',
      'implement',
      'debug',
      'repair',
      'verify',
      'review',
      'security',
      'qa',
      'delivery',
    ])
  })

  it('keeps every judging role read-only and every writing role out of that set', () => {
    expect(READ_ONLY_ROLES.every(role => ROLES.includes(role))).toBe(true)
    for (const role of ['debug', 'review', 'security', 'qa', 'verify'] as const) {
      expect(READ_ONLY_ROLES).toContain(role)
    }
    for (const role of ['implement', 'repair', 'delivery'] as const) {
      expect(READ_ONLY_ROLES).not.toContain(role)
    }
  })

  it('distinguishes an unjudgeable run from one blocked on a human decision', () => {
    expect(WORKFLOW_VERDICTS).toContain('INCONCLUSIVE')
    expect(WORKFLOW_VERDICTS).toContain('BLOCKED')
  })

  it('lets automated repair touch only defects, never decisions or preferences', () => {
    expect(AUTO_REPAIRABLE_FINDINGS.every(value => FINDING_CLASSES.includes(value))).toBe(true)
    expect([...AUTO_REPAIRABLE_FINDINGS]).toStrictEqual(['BUG', 'SECURITY_BUG', 'TEST_DEFECT', 'TOOLING_DEFECT'])
    for (const value of ['PRODUCT_DECISION', 'DESIGN_DECISION', 'INTENTIONAL_BEHAVIOR'] as const) {
      expect(AUTO_REPAIRABLE_FINDINGS).not.toContain(value)
    }
    for (const value of ['IMPROVEMENT', 'REFACTOR_SUGGESTION', 'STYLE_ONLY'] as const) {
      expect(AUTO_REPAIRABLE_FINDINGS).not.toContain(value)
    }
  })
})

describe('reading a serialized finding back', () => {
  it('survives a JSON round trip unchanged', () => {
    expect(parseFinding(roundTrip(finding))).toStrictEqual(finding)
  })

  it('rejects anything that is not an object', () => {
    for (const value of [null, undefined, 'finding', 7, [finding]]) {
      expect(() => parseFinding(value)).toThrow(ContractError)
    }
  })

  it('rejects a class outside the taxonomy', () => {
    expect(() => parseFinding({ ...finding, class: 'PROBABLY_FINE' })).toThrow(/finding\.class/)
  })

  it('rejects a role outside the vocabulary', () => {
    expect(() => parseFinding({ ...finding, raisedBy: 'vibes' })).toThrow(/finding\.raisedBy/)
  })

  it('rejects a blank summary, because an unreadable finding cannot be triaged', () => {
    expect(() => parseFinding({ ...finding, summary: '   ' })).toThrow(/finding\.summary/)
  })

  it('rejects a confirmation flag that is not a boolean', () => {
    expect(() => parseFinding({ ...finding, confirmed: 'yes' })).toThrow(/finding\.confirmed/)
  })

  it('names the offending element when one piece of evidence is malformed', () => {
    const evidence = [finding.evidence[0], { kind: 'seance', locator: 'x', summary: 'y' }]
    expect(() => parseFinding({ ...finding, evidence })).toThrow(/finding\.evidence\[1\]\.kind/)
  })

  it('drops fields the contract does not declare', () => {
    const parsed = parseFinding({ ...finding, transcript: 'the model was thinking about...' })
    expect(parsed).toStrictEqual(finding)
    expect(Object.hasOwn(parsed, 'transcript')).toBe(false)
  })
})

describe('reading a serialized diagnosis back', () => {
  it('survives a JSON round trip unchanged', () => {
    expect(parseDiagnosisContract(roundTrip(diagnosis))).toStrictEqual(diagnosis)
  })

  it('keeps a product-decision dependency when one is present', () => {
    const blocked = { ...diagnosis, productDecisionDependency: 'nobody has decided what happens on the third retry' }
    expect(parseDiagnosisContract(roundTrip(blocked))).toStrictEqual(blocked)
  })

  it('requires every field that makes a diagnosis actionable', () => {
    for (const field of [
      'symptom',
      'reproduction',
      'expectedVsActual',
      'affectedBoundary',
      'rootCauseHypothesis',
      'regressionTestSeam',
      'minimalRepairSurface',
    ] as const) {
      const { [field]: _dropped, ...rest } = diagnosis
      expect(() => parseDiagnosisContract(rest)).toThrow(new RegExp(`diagnosis\\.${field}`))
    }
  })

  it('requires an explicit empty unknowns list rather than silence', () => {
    const { unknowns: _dropped, ...rest } = diagnosis
    expect(() => parseDiagnosisContract(rest)).toThrow(/diagnosis\.unknowns/)
    expect(parseDiagnosisContract({ ...rest, unknowns: [] }).unknowns).toStrictEqual([])
  })

  it('rejects a confidence or security relevance outside its vocabulary', () => {
    expect(() => parseDiagnosisContract({ ...diagnosis, confidence: 'certain' })).toThrow(/diagnosis\.confidence/)
    expect(() => parseDiagnosisContract({ ...diagnosis, securityRelevance: 'maybe' }))
      .toThrow(/diagnosis\.securityRelevance/)
  })

  it('rejects a ruled-out hypothesis that is not a string', () => {
    expect(() => parseDiagnosisContract({ ...diagnosis, ruledOutHypotheses: ['fine', 3] }))
      .toThrow(/diagnosis\.ruledOutHypotheses\[1\]/)
  })

  it('drops fields the contract does not declare', () => {
    const parsed = parseDiagnosisContract({ ...diagnosis, reasoning: 'first I considered...' })
    expect(Object.hasOwn(parsed, 'reasoning')).toBe(false)
  })
})

describe('reading a serialized route decision back', () => {
  it('survives a JSON round trip unchanged', () => {
    expect(parseRouteDecision(roundTrip(decision))).toStrictEqual(decision)
  })

  it('keeps the effort optional, because not every product has the knob', () => {
    const { reasoningEffort: _dropped, ...rest } = decision
    expect(parseRouteDecision(rest)).toStrictEqual(rest)
  })

  it('records the executor a fallback replaced', () => {
    const fallen = { ...decision, executor: 'opencode', fallbackFrom: 'codex' }
    expect(parseRouteDecision(roundTrip(fallen)).fallbackFrom).toBe('codex')
  })

  it('requires a policy version, because a route nobody can date cannot be audited', () => {
    const { policyVersion: _dropped, ...rest } = decision
    expect(() => parseRouteDecision(rest)).toThrow(/route\.policyVersion/)
  })

  it('requires at least one reason code', () => {
    expect(() => parseRouteDecision({ ...decision, reasonCodes: [] })).toThrow(/route\.reasonCodes/)
  })

  it('requires the resolved model, so no run is attributed to a tier alone', () => {
    const { resolvedModel: _dropped, ...rest } = decision
    expect(() => parseRouteDecision(rest)).toThrow(/route\.resolvedModel/)
  })

  it('rejects a permission mode a route may not grant', () => {
    for (const mode of ['danger-full-access', 'bypass', '']) {
      expect(() => parseRouteDecision({ ...decision, permissionMode: mode })).toThrow(/route\.permissionMode/)
    }
  })
})

describe('reading a serialized stage result back', () => {
  it('survives a JSON round trip unchanged', () => {
    expect(parseStageResult(roundTrip(stage))).toStrictEqual(stage)
  })

  it('rejects a verdict outside the vocabulary', () => {
    expect(() => parseStageResult({ ...stage, verdict: 'probably ok' })).toThrow(/stage\.verdict/)
  })

  it('names the offending finding when one is malformed', () => {
    expect(() => parseStageResult({ ...stage, findings: [{ ...finding, class: 'NOPE' }] }))
      .toThrow(/stage\.findings\[0\]\.class/)
  })

  it('accepts a stage that found nothing', () => {
    const clean = { ...stage, verdict: 'PASS' as const, findings: [], summary: 'no findings' }
    expect(parseStageResult(roundTrip(clean)).findings).toStrictEqual([])
  })

  it('drops fields the contract does not declare, transcripts included', () => {
    const parsed = parseStageResult({ ...stage, transcript: ['turn 1', 'turn 2'] })
    expect(Object.hasOwn(parsed, 'transcript')).toBe(false)
  })
})

describe('reading a serialized objective back', () => {
  it('survives a JSON round trip unchanged', () => {
    expect(parseWorkflowObjective(roundTrip(objective))).toStrictEqual(objective)
  })

  it('rejects a risk or workload outside its vocabulary', () => {
    expect(() => parseWorkflowObjective({ ...objective, risk: 'spicy' })).toThrow(/objective\.risk/)
    expect(() => parseWorkflowObjective({ ...objective, workload: 'enormous' })).toThrow(/objective\.workload/)
  })

  it('requires a workspace and a profile', () => {
    for (const field of ['cwd', 'profileId', 'id', 'requirement'] as const) {
      const { [field]: _dropped, ...rest } = objective
      expect(() => parseWorkflowObjective(rest)).toThrow(new RegExp(`objective\\.${field}`))
    }
  })
})

describe('the error a rejected contract throws', () => {
  it('carries the field path as data, not only in the message', () => {
    try {
      parseFinding({ ...finding, class: 'NOPE' })
      expect.unreachable('a finding with an unknown class must not parse')
    }
    catch (error) {
      expect(error).toBeInstanceOf(ContractError)
      expect((error as ContractError).path).toBe('finding.class')
    }
  })

  it('does not quote the rejected value when the field could hold anything', () => {
    const secret = 'sk-live-0000000000000000'
    try {
      parseFinding({ ...finding, confirmed: secret })
      expect.unreachable('a non-boolean confirmation must not parse')
    }
    catch (error) {
      expect((error as ContractError).message).not.toContain(secret)
    }
  })
})
