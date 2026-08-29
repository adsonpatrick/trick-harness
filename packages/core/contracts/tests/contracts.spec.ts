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
  parseStageRouteOverride,
  parseConformanceContract,
  parseWorkflowObjective,
} from '../src/index.ts'
import type {
  DiagnosisContract,
  Finding,
  RouteDecision,
  StageResult,
  StageRouteOverride,
  WorkflowObjective,
} from '../src/index.ts'

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
  approvedArtifacts: {
    spec: { path: 'docs/superpowers/specs/2026-08-28-thing.md', sha256: 'a'.repeat(64) },
    plan: { path: 'docs/superpowers/plans/2026-08-28-thing.md', sha256: 'b'.repeat(64) },
  },
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
      'conformance',
      'delivery',
    ])
  })

  it('keeps every judging role read-only and every writing role out of that set', () => {
    expect(READ_ONLY_ROLES.every(role => ROLES.includes(role))).toBe(true)
    for (const role of ['debug', 'review', 'security', 'qa', 'verify', 'conformance'] as const) {
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

describe('reading the approved artifacts an objective was opened against', () => {
  it('requires the artifacts the work is later judged against', () => {
    // Conformance asks whether the implementation satisfies the Spec and Plan a
    // human approved. An objective that never named them makes that question
    // unanswerable, and a run reaching conformance without them would have to
    // invent its own expectation — which is the whole thing being prevented.
    const { approvedArtifacts: _dropped, ...rest } = objective
    expect(() => parseWorkflowObjective(rest)).toThrow(/objective\.approvedArtifacts/)
    for (const artifact of ['spec', 'plan'] as const) {
      const { [artifact]: _gone, ...partial } = objective.approvedArtifacts
      expect(() => parseWorkflowObjective({ ...objective, approvedArtifacts: partial }))
        .toThrow(new RegExp(`objective\.approvedArtifacts\.${artifact}`))
    }
  })

  it('requires each hash to be a lowercase 64-hex digest, which is the whole identity', () => {
    for (const sha256 of ['A'.repeat(64), 'a'.repeat(63), `${'a'.repeat(63)}z`, '', `sha256:${'a'.repeat(64)}`]) {
      const approvedArtifacts = { ...objective.approvedArtifacts, spec: { path: 'docs/s.md', sha256 } }
      expect(() => parseWorkflowObjective({ ...objective, approvedArtifacts }))
        .toThrow(/objective\.approvedArtifacts\.spec\.sha256/)
    }
  })

  it('requires a repository-relative path, since an absolute one names another machine', () => {
    for (const path of ['/etc/passwd', 'C:\\docs\\spec.md', '../outside/spec.md', 'docs/../../spec.md', './']) {
      const approvedArtifacts = { ...objective.approvedArtifacts, plan: { path, sha256: 'c'.repeat(64) } }
      expect(() => parseWorkflowObjective({ ...objective, approvedArtifacts }))
        .toThrow(/objective\.approvedArtifacts\.plan\.path/)
    }
  })

  it('rejects every way a path can name a root, not only the ways POSIX writes one', () => {
    // A backslash root and a UNC share are absolute on Windows, which is a
    // platform this harness runs on. Checking only for a leading `/` and a
    // drive letter would let both name a document outside the tree under review.
    for (const path of ['\\\\server\\share\\spec.md', '\\etc\\passwd', 'docs\\..\\..\\spec.md']) {
      const approvedArtifacts = { ...objective.approvedArtifacts, spec: { path, sha256: 'c'.repeat(64) } }
      expect(() => parseWorkflowObjective({ ...objective, approvedArtifacts }))
        .toThrow(/objective\.approvedArtifacts\.spec\.path/)
    }
  })

  it('rejects a segment a filesystem resolves to a different name than the one written', () => {
    // Windows strips a trailing dot from a name, so `docs./spec.md` opens
    // `docs/spec.md`; and everything after a colon is an NTFS alternate data
    // stream, so `docs/spec.md:hidden` opens a second stream of the approved
    // file whose bytes the hash never covered. Both are one file under a name
    // the journal would record as another.
    for (const path of ['docs./spec.md', 'docs/spec.md.', 'docs/spec.md:hidden', 'docs:alt/spec.md']) {
      const approvedArtifacts = { ...objective.approvedArtifacts, spec: { path, sha256: 'c'.repeat(64) } }
      expect(() => parseWorkflowObjective({ ...objective, approvedArtifacts }))
        .toThrow(/objective\.approvedArtifacts\.spec\.path/)
    }
  })

  it('rejects a path that is not Unicode-normalized, which is one file under two byte strings', () => {
    // A decomposed `e` plus a combining acute names the same file on macOS as
    // the composed one, and the two are different strings. Whichever spelling
    // arrives, only one can be the approved identity, so the parser takes the
    // composed one and refuses the other rather than normalizing silently.
    const decomposed = 'docs/refere\u0301ncia.md'
    expect(decomposed).not.toBe(decomposed.normalize('NFC'))
    const approvedArtifacts = { ...objective.approvedArtifacts, plan: { path: decomposed, sha256: 'c'.repeat(64) } }
    expect(() => parseWorkflowObjective({ ...objective, approvedArtifacts }))
      .toThrow(/objective\.approvedArtifacts\.plan\.path/)
  })

  it('rejects a path carrying a NUL or a control character, which no document name holds', () => {
    for (const path of ['docs/spec.md\0../../etc/passwd', 'docs/\nspec.md']) {
      const approvedArtifacts = { ...objective.approvedArtifacts, plan: { path, sha256: 'c'.repeat(64) } }
      expect(() => parseWorkflowObjective({ ...objective, approvedArtifacts }))
        .toThrow(/objective\.approvedArtifacts\.plan\.path/)
    }
  })

  it('requires a canonical path, since two spellings of one file are two identities', () => {
    // `docs/./spec.md` and `docs//spec.md` name the same document as
    // `docs/spec.md` and hash the same bytes. Accepting all three would mean
    // the path that is journalled is not the path that was approved.
    for (const path of ['docs/./spec.md', 'docs//spec.md', ' docs/spec.md']) {
      const approvedArtifacts = { ...objective.approvedArtifacts, plan: { path, sha256: 'c'.repeat(64) } }
      expect(() => parseWorkflowObjective({ ...objective, approvedArtifacts }))
        .toThrow(/objective\.approvedArtifacts\.plan\.path/)
    }
  })

  it('quotes neither the path nor the hash it rejected, since the rejection is logged', () => {
    const approvedArtifacts = { ...objective.approvedArtifacts, spec: { path: '/secret/place.md', sha256: 'nope' } }
    let failure = ''
    try {
      parseWorkflowObjective({ ...objective, approvedArtifacts })
    }
    catch (error: unknown) {
      failure = error instanceof Error ? error.message : String(error)
    }
    expect(failure).not.toBe('')
    expect(failure).not.toContain('/secret/place.md')
    expect(failure).not.toContain('nope')
  })

  it('keeps no field the artifacts did not declare', () => {
    const approvedArtifacts = {
      spec: { ...objective.approvedArtifacts.spec, transcript: 'what the model was thinking' },
      plan: objective.approvedArtifacts.plan,
    }
    const parsed = parseWorkflowObjective({ ...objective, approvedArtifacts })
    expect(Object.hasOwn(parsed.approvedArtifacts.spec, 'transcript')).toBe(false)
  })
})

describe('reading a conformance result back', () => {
  const item = {
    id: 'PLAN-3',
    source: 'plan',
    requirement: 'the delivery branch is derived, not chosen by a model',
    status: 'PASS',
    implementationEvidence: [{ kind: 'diff', locator: 'src/handlers.ts', summary: 'the derivation' }],
    verificationEvidence: [{ kind: 'test', locator: 'tests/handlers.spec.ts', summary: 'pins it' }],
    summary: 'derived from the objective id',
  }

  const contract = {
    specSha256: 'a'.repeat(64),
    planSha256: 'b'.repeat(64),
    items: [item],
    verdict: 'PASS',
    summary: 'every obligation is satisfied',
  }

  it('survives a JSON round trip unchanged', () => {
    expect(parseConformanceContract(roundTrip(contract))).toStrictEqual(contract)
  })

  it('binds the result to the documents it judged, since a verdict alone names nothing', () => {
    // A conformance PASS that does not say which Spec and Plan it was measured
    // against can be replayed against a later, different plan.
    for (const field of ['specSha256', 'planSha256'] as const) {
      const { [field]: _dropped, ...rest } = contract
      expect(() => parseConformanceContract(rest)).toThrow(new RegExp(`conformance\\.${field}`))
      expect(() => parseConformanceContract({ ...contract, [field]: 'not-a-digest' }))
        .toThrow(new RegExp(`conformance\\.${field}`))
    }
  })

  it('refuses a source or a status nobody defined', () => {
    expect(() => parseConformanceContract({ ...contract, items: [{ ...item, source: 'vibes' }] }))
      .toThrow(/conformance\.items\[0\]\.source/)
    expect(() => parseConformanceContract({ ...contract, items: [{ ...item, status: 'PROBABLY' }] }))
      .toThrow(/conformance\.items\[0\]\.status/)
    expect(() => parseConformanceContract({ ...contract, verdict: 'GREAT' })).toThrow(/conformance\.verdict/)
  })

  it('accepts MISSING, which is the status a verdict vocabulary has no word for', () => {
    // An obligation nothing addressed is not a failed obligation; conflating
    // the two would let an unimplemented requirement read as an attempted one.
    const missing = { ...item, status: 'MISSING', implementationEvidence: [], verificationEvidence: [] }
    expect(parseConformanceContract({ ...contract, items: [missing], verdict: 'FAIL' }).items[0]?.status)
      .toBe('MISSING')
  })

  it('requires every field of an item, so a partial answer is not a quiet PASS', () => {
    for (const field of ['id', 'source', 'requirement', 'status', 'summary'] as const) {
      const { [field]: _dropped, ...partial } = item
      expect(() => parseConformanceContract({ ...contract, items: [partial] }))
        .toThrow(new RegExp(`conformance\\.items\\[0\\]\\.${field}`))
    }
    for (const field of ['implementationEvidence', 'verificationEvidence'] as const) {
      const { [field]: _dropped, ...partial } = item
      expect(() => parseConformanceContract({ ...contract, items: [partial] }))
        .toThrow(new RegExp(`conformance\\.items\\[0\\]\\.${field}`))
    }
  })

  it('refuses two answers about one obligation', () => {
    // Deterministic code decides the obligation set; a result that answered an
    // id twice would leave which answer counts up to whoever read it last.
    expect(() => parseConformanceContract({ ...contract, items: [item, { ...item, status: 'FAIL' }] }))
      .toThrow(/conformance\.items/)
  })

  it('keeps no field the contract did not declare', () => {
    const parsed = parseConformanceContract({
      ...contract,
      reasoning: 'here is how I thought about it',
      items: [{ ...item, transcript: 'the whole session' }],
    })
    expect(Object.hasOwn(parsed, 'reasoning')).toBe(false)
    expect(Object.hasOwn(parsed.items[0] ?? {}, 'transcript')).toBe(false)
  })

  it('quotes nothing it rejected, since a requirement can hold whatever was pasted into it', () => {
    let failure = ''
    try {
      parseConformanceContract({ ...contract, items: [{ ...item, status: 'postgresql://u:hunter2@db/x' }] })
    }
    catch (error: unknown) {
      failure = error instanceof Error ? error.message : String(error)
    }
    expect(failure).toContain('conformance.items[0].status')
    expect(failure).not.toContain('hunter2')
  })
})

describe('reading a human routing override back', () => {
  const override: StageRouteOverride = Object.freeze({
    role: 'review',
    executor: 'codex',
    semanticModelTier: 'codex.frontier',
    reasoningEffort: 'xhigh',
  })

  it('survives a JSON round trip unchanged', () => {
    expect(parseStageRouteOverride(roundTrip(override))).toStrictEqual(override)
  })

  it('keeps only the fields it declares', () => {
    expect(parseStageRouteOverride({ ...override, permissionMode: 'workspace-write' }))
      .toStrictEqual(override)
  })

  it('accepts an override that leaves the reasoning effort to the route', () => {
    const { reasoningEffort: _dropped, ...rest } = override
    expect(parseStageRouteOverride(rest)).toStrictEqual(rest)
  })

  it('refuses an override with no semantic tier, as the router would', () => {
    const { semanticModelTier: _dropped, ...rest } = override
    expect(() => parseStageRouteOverride(rest)).toThrow(/routeOverride\.semanticModelTier/)
  })

  it('rejects a role outside the vocabulary', () => {
    expect(() => parseStageRouteOverride({ ...override, role: 'vibes' }))
      .toThrow(/routeOverride\.role/)
  })

  it('rejects a blank or missing executor', () => {
    for (const executor of ['', '   ', undefined, 7, ['codex']]) {
      expect(() => parseStageRouteOverride({ ...override, executor }))
        .toThrow(/routeOverride\.executor/)
    }
  })

  it('rejects an optional field that is present but unusable', () => {
    // Stated-but-blank is worse than absent: absent means the table decides,
    // and blank means a person asked for something nobody can resolve.
    expect(() => parseStageRouteOverride({ ...override, semanticModelTier: '  ' }))
      .toThrow(/routeOverride\.semanticModelTier/)
    expect(() => parseStageRouteOverride({ ...override, reasoningEffort: { level: 'high' } }))
      .toThrow(/routeOverride\.reasoningEffort/)
  })

  it('rejects anything that is not an object', () => {
    for (const value of [null, 'codex', 42, ['codex']]) {
      expect(() => parseStageRouteOverride(value)).toThrow(ContractError)
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
