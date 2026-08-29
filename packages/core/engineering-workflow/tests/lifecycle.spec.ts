import { beforeEach, describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createExecutorRuntime } from '@trick-harness/executor'
import type {
  ExecutorProvider,
  ExecutorResult,
  ExecutorStartRequest,
  HarnessExecutorRuntime,
} from '@trick-harness/executor'
import { WorkflowJournal } from '@trick-harness/journal'
import type { HarnessProfile } from '@trick-harness/profile'
import type { RoutingPolicy } from '@trick-harness/routing'
import type { ConformanceManifest, DiagnosisContract, Finding, StageResult, WorkflowObjective } from '@trick-harness/contracts'
import { WorkflowRunner, assessPullRequest, planPullRequestStages } from '../src/index.ts'
import type { DeliveryCapabilityPort, PullRequestOutcome, StageSpec } from '../src/index.ts'

/**
 * The Plurora shape of the policy: heavy implementation and repair go to the
 * implementation tier, everything that reads goes to the reasoning tier, and a
 * degraded executor falls back within its own tier rather than across it.
 */
const POLICY: RoutingPolicy = Object.freeze({
  policyVersion: 'test-v1.0.0',
  rules: Object.freeze([
    Object.freeze({ id: 'repair', when: Object.freeze({ role: 'repair' }), use: Object.freeze({ executor: 'builder', tier: 'implementation' }) }),
    Object.freeze({ id: 'implement', when: Object.freeze({ role: 'implement' }), use: Object.freeze({ executor: 'builder', tier: 'implementation' }) }),
    Object.freeze({ id: 'verify', when: Object.freeze({ role: 'verify' }), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
    Object.freeze({ id: 'review', when: Object.freeze({ role: 'review' }), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
    Object.freeze({ id: 'debug', when: Object.freeze({ role: 'debug' }), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
    Object.freeze({ id: 'qa', when: Object.freeze({ role: 'qa' }), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
    Object.freeze({ id: 'security', when: Object.freeze({ role: 'security' }), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
    Object.freeze({ id: 'conformance', when: Object.freeze({ role: 'conformance' }), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
    Object.freeze({ id: 'default', when: Object.freeze({}), use: Object.freeze({ executor: 'builder', tier: 'implementation' }) }),
  ]),
  fallbackRules: Object.freeze([
    Object.freeze({ id: 'heavy-degraded', when: Object.freeze({ unavailable: 'builder' }), use: Object.freeze({ executor: 'spare-builder', tier: 'implementation' }) }),
    Object.freeze({ id: 'anything-degraded', when: Object.freeze({}), use: Object.freeze({ executor: 'spare-reviewer', tier: 'reasoning' }) }),
  ]),
  registry: Object.freeze({ implementation: 'mimo-v2.5', reasoning: 'deepseek-v4-flash' }),
})

const PROFILE: HarnessProfile = Object.freeze({
  id: 'test',
  policyVersion: 'test-v1.0.0',
  routingPolicy: Object.freeze({ rules: POLICY.rules, fallbackRules: POLICY.fallbackRules }),
  workflowPolicy: Object.freeze({ maxRepairCycles: 3, maxExecutorStarts: 24 }),
  independencePolicy: Object.freeze({
    low: 'fresh-context',
    medium: 'cross-executor-preferred',
    high: 'cross-executor-required',
    critical: 'cross-executor-required',
  }),
  qaPolicy: Object.freeze({ rules: Object.freeze([]) }),
  securityPolicy: Object.freeze({ rules: Object.freeze([]) }),
  integrationPolicy: Object.freeze({ enabled: Object.freeze([]), rules: Object.freeze([]) }),
  trustedComposition: Object.freeze({ excludedPluginIds: Object.freeze([]) }),
  changeImpactPolicy: Object.freeze({
    rules: Object.freeze([]),
    writeVolume: Object.freeze({ smallMaxFiles: 3, mediumMaxFiles: 12 }),
  }),
})

const OBJECTIVE: WorkflowObjective = Object.freeze({
  id: 'obj-1',
  cwd: '/repo',
  requirement: 'add the thing',
  risk: 'low',
  workload: 'heavy',
  profileId: 'test',
  approvedArtifacts: {
    spec: { path: 'docs/spec.md', sha256: 'a'.repeat(64) },
    plan: { path: 'docs/plan.md', sha256: 'b'.repeat(64) },
  },
})

/**
 * The approved documents as they stand, hashing to the identity the objective
 * was opened against. One criterion and one task is enough for a manifest.
 */
const ARTIFACTS = Object.freeze({
  specText: '- **ND1:** the work satisfies the approved specification',
  planText: '### Task 1: do the approved work',
  specSha256: 'a'.repeat(64),
  planSha256: 'b'.repeat(64),
})

/** A conformance reading that answers every obligation the manifest states. */
const CONFORMS = {
  loadApprovedArtifacts: async (): Promise<typeof ARTIFACTS> => ARTIFACTS,
  conformance: (
    _stage: StageSpec,
    _executor: string,
    _result: unknown,
    manifest: ConformanceManifest,
  ): unknown => ({
    specSha256: manifest.specSha256,
    planSha256: manifest.planSha256,
    items: manifest.obligations.map(obligation => ({
      id: obligation.id,
      source: obligation.source,
      requirement: obligation.requirement,
      status: 'PASS',
      implementationEvidence: [],
      verificationEvidence: [],
      summary: 'satisfied',
    })),
    verdict: 'PASS',
    summary: 'the branch satisfies the approved artifacts',
  }),
}

const DIAGNOSIS: DiagnosisContract = Object.freeze({
  symptom: 'rounding is off by a cent on the last item',
  reproduction: 'pnpm vitest run cart.spec.ts -t "totals"',
  expectedVsActual: 'expected 10.00, got 9.99',
  observedEvidence: Object.freeze([
    Object.freeze({ kind: 'test' as const, locator: 'cart.spec.ts:totals', summary: 'red before the fix' }),
  ]),
  affectedBoundary: 'packages/cart/src/total.ts',
  ruledOutHypotheses: Object.freeze(['locale formatting']),
  rootCauseHypothesis: 'the subtotal truncates before the tax is applied',
  confidence: 'high',
  regressionTestSeam: 'cart.spec.ts totals suite',
  minimalRepairSurface: 'total.ts rounding order',
  unknowns: Object.freeze([]),
  securityRelevance: 'none',
})

const REPAIRED = Object.freeze({
  regressionTest: Object.freeze({ kind: 'test' as const, locator: 'cart.spec.ts:totals', summary: 'red first' }),
  focusedGreen: Object.freeze({ kind: 'test' as const, locator: 'cart.spec.ts:totals', summary: 'green after' }),
  rootCauseAddressed: true,
})

/**
 * A confirmed defect a repair may act on.
 * @param id - the finding id.
 * @param raisedBy - the role that found it.
 * @returns the finding.
 */
function bug(id: string, raisedBy: Finding['raisedBy'] = 'review'): Finding {
  return {
    id,
    class: 'BUG',
    raisedBy,
    summary: `${id}: totals are a cent short`,
    confirmed: true,
    evidence: [{ kind: 'test', locator: 'cart.spec.ts:totals', summary: 'red' }],
  }
}

/**
 * An improvement nobody asked for, which is carried and never implemented.
 * @param id - the finding id.
 * @returns the finding.
 */
function improvement(id: string): Finding {
  return {
    id,
    class: 'IMPROVEMENT',
    raisedBy: 'review',
    summary: `${id}: this module would read better split in two`,
    confirmed: true,
    evidence: [],
  }
}

/**
 * A question only a person can answer.
 * @param id - the finding id.
 * @returns the finding.
 */
function productDecision(id: string): Finding {
  return {
    id,
    class: 'PRODUCT_DECISION',
    raisedBy: 'review',
    summary: `${id}: should an empty cart show zero or a dash?`,
    confirmed: false,
    evidence: [],
  }
}

/**
 * A provider that answers every start the same way.
 * @param name - the executor name.
 * @param start - what it does.
 * @returns the provider.
 */
function provider(name: string, start: (request: ExecutorStartRequest) => Promise<ExecutorResult>): ExecutorProvider {
  return {
    name,
    capabilities: { modelOverride: true, reasoningEffort: true, permissionModes: ['read-only', 'workspace-write'] },
    start,
  }
}

let session: Session
let executors: HarnessExecutorRuntime
let journal: WorkflowJournal
let runner: WorkflowRunner
let started: ExecutorStartRequest[]

/** Findings each stage id reports, consumed once so a re-run can differ. */
let scripted: Map<string, readonly Finding[]>

/**
 * Interpret a stage from the script: findings decide the verdict.
 * @param stage - the stage that ran.
 * @param executor - the executor that ran it.
 * @returns the stage result.
 */
function interpret(stage: StageSpec, executor: string): StageResult {
  const findings = scripted.get(stage.stageId) ?? []
  const material = findings.some(finding => finding.class === 'BUG' || finding.class === 'SECURITY_BUG')
  const blocking = findings.some(finding => finding.class === 'PRODUCT_DECISION')
  return {
    role: stage.role,
    executor,
    verdict: blocking ? 'BLOCKED' : material ? 'FAIL' : 'PASS',
    summary: `${stage.role} ran`,
    findings,
    evidence: [],
  }
}

/**
 * The prompt text for one stage.
 * @param stage - the stage.
 * @param objective - the objective.
 * @returns the task text.
 */
function taskFor(stage: StageSpec, objective: WorkflowObjective): string {
  return `${stage.role}: ${objective.requirement}`
}

/**
 * The role a dispatched request carries, read back from the task text the plan
 * composed for it. A start request names its executor and its model, never its
 * role, so the task line is where the two are tied together.
 * @param request - the request a provider was started with.
 * @returns the role that stage played.
 */
function roleOf(request: ExecutorStartRequest): string {
  return request.task.split(':')[0] ?? ''
}

/**
 * Run one pull-request lifecycle against the scripted findings.
 * @param objective - the objective to run.
 * @returns the pull-request outcome.
 */
async function runLifecycle(
  objective: WorkflowObjective = OBJECTIVE,
  overrides: { [K in keyof typeof CONFORMS]?: (typeof CONFORMS)[K] | undefined } = {},
): Promise<PullRequestOutcome> {
  // An override of `undefined` means "run without this handler at all", which
  // is a different request from one that passes the key holding nothing.
  const handlers = Object.fromEntries(
    Object.entries({ ...CONFORMS, ...overrides }).filter(([, value]) => value !== undefined),
  ) as Partial<typeof CONFORMS>
  const outcome = await runner.run({
    objective,
    plan: planPullRequestStages,
    interpret,
    task: taskFor,
    ...handlers,
    diagnose: () => DIAGNOSIS,
    repairEvidence: () => REPAIRED,
  })
  return assessPullRequest(outcome)
}

/** One stage that passed, for an outcome assembled by hand rather than run. */
const PASSING = Object.freeze({
  stageId: 'verify-1',
  role: 'verify' as const,
  executor: 'reviewer',
  permissionMode: 'read-only' as const,
  verdict: 'PASS' as const,
  summary: 'verify ran',
  findings: Object.freeze([]),
  evidence: Object.freeze([]),
  durationMs: 1,
})

/** A delivery capability that publishes without touching a remote. */
function deliveryStub(stageIds?: string[]): DeliveryCapabilityPort {
  return {
    deliver: async (input) => {
      stageIds?.push(input.stageId)
      return { delivered: true, summary: 'the branch was pushed and its pull request updated', evidence: [], findings: [] }
    },
  }
}

const DELIVERY = deliveryStub()

beforeEach(() => {
  session = Session.create(SessionId('s'))
  executors = createExecutorRuntime()
  journal = new WorkflowJournal(session, 'wf-1', async () => true)
  runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY } })
  started = []
  scripted = new Map()
  for (const name of ['builder', 'reviewer', 'spare-builder', 'spare-reviewer']) {
    executors.register(provider(name, async (request) => {
      started.push(request)
      return { status: 'completed', output: `${name} ran` }
    }))
  }
})

describe('the pull request lifecycle plan', () => {
  it('delivers the branch before anything certifies it', () => {
    const roles = planPullRequestStages(OBJECTIVE).map(stage => stage.role)

    expect(roles.indexOf('delivery')).toBeLessThan(roles.indexOf('review'))
    expect(roles).toEqual(['implement', 'verify', 'delivery', 'review', 'conformance', 'verify'])
  })

  it('adds QA and security as risk rises, and always ends on a fresh verification', () => {
    expect(planPullRequestStages({ ...OBJECTIVE, risk: 'critical' }).map(stage => stage.role)).toEqual([
      'implement', 'verify', 'delivery', 'review', 'qa', 'security', 'conformance', 'verify',
    ])
    expect(planPullRequestStages({ ...OBJECTIVE, risk: 'critical' }).at(-1)?.stageId).toBe('verify-final')
  })

  it.each(['low', 'medium', 'high', 'critical'] as const)('publishes before it certifies at %s risk', (risk) => {
    const roles = planPullRequestStages({ ...OBJECTIVE, risk }).map(stage => stage.role)

    expect(roles.indexOf('delivery')).toBeLessThan(roles.indexOf('review'))
    expect(roles.at(-1)).toBe('verify')
    expect(roles.lastIndexOf('verify')).toBeGreaterThan(roles.indexOf('delivery'))
  })

  it('buys QA from medium upwards and security only at critical', () => {
    const rolesAt = (risk: WorkflowObjective['risk']) =>
      planPullRequestStages({ ...OBJECTIVE, risk }).map(stage => stage.role)

    expect(rolesAt('low')).not.toContain('qa')
    expect(rolesAt('medium')).toContain('qa')
    expect(rolesAt('high')).toContain('qa')
    expect(rolesAt('high')).not.toContain('security')
    expect(rolesAt('critical')).toContain('security')
  })

  it('names every stage uniquely, so the journal can pair each start with its end', () => {
    const ids = planPullRequestStages({ ...OBJECTIVE, risk: 'critical' }).map(stage => stage.stageId)

    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('what only gets reported', () => {
  it('reaches PR READY with an improvement outstanding and never repairs it', async () => {
    scripted.set('review-1', [improvement('imp-only')])

    const result = await runLifecycle()

    expect(result.state).toBe('PR_READY')
    expect(result.outcome.repairCycles).toBe(0)
    expect(result.outcome.stages.map(stage => stage.role)).not.toContain('repair')
    expect(result.reportedFindings.map(finding => finding.id)).toEqual(['imp-only'])
  })
})

describe('the reading that closes the run', () => {
  it('verifies once more after the last repair, with a fresh run of its own', async () => {
    scripted.set('review-1', [bug('bug-a')])

    const result = await runLifecycle()
    const ids = result.outcome.stages.map(stage => stage.stageId)

    // The final verification is a stage of its own, started after the repair
    // and after the re-delivery, so nothing is called ready on a reading taken
    // before the branch reached its current state.
    expect(ids.at(-1)).toBe('verify-final')
    expect(ids.indexOf('verify-final')).toBeGreaterThan(ids.indexOf('repair-1'))
    expect(ids.indexOf('verify-final')).toBeGreaterThan(ids.indexOf('delivery-2'))
    // It reads rather than writes, and it is not the executor that last wrote.
    const final = started.at(-1)
    expect(final?.route.permissionMode).toBe('read-only')
    expect(final?.route.executor).not.toBe('builder')
  })
})

describe('two confirmed bugs and one improvement', () => {
  it('repairs both bugs, reports the improvement, and does not implement it', async () => {
    scripted.set('review-1', [bug('bug-a'), bug('bug-b'), improvement('imp-a')])
    scripted.set('review-2', [bug('bug-b'), improvement('imp-a')])
    scripted.set('review-3', [improvement('imp-a')])

    const result = await runLifecycle()

    expect(result.state).toBe('PR_READY')
    expect(result.outcome.repairCycles).toBe(2)
    expect(result.openDefects).toEqual([])
    expect(result.reportedFindings.map(finding => finding.id)).toEqual(['imp-a'])
    expect(result.summary).toContain('reported and not implemented')
  })

  it('re-delivers the branch after each repair, so the next review reads the fix', async () => {
    scripted.set('review-1', [bug('bug-a')])

    const result = await runLifecycle()
    const roles = result.outcome.stages.map(stage => stage.stageId)

    expect(roles).toEqual([
      'implement-1', 'verify-1', 'delivery-1', 'review-1',
      'debug-1', 'repair-1', 'verify-2', 'delivery-2', 'review-2',
      'conformance-1', 'verify-final',
    ])
  })

  it('runs the repair on the implementation tier and every reading on the reasoning tier', async () => {
    scripted.set('review-1', [bug('bug-a')])

    await runLifecycle()
    const byRole = new Map(started.map(request => [roleOf(request), request.route]))

    expect(byRole.get('repair')?.model).toBe('mimo-v2.5')
    expect(byRole.get('implement')?.model).toBe('mimo-v2.5')
    expect(byRole.get('review')?.model).toBe('deepseek-v4-flash')
    expect(byRole.get('debug')?.model).toBe('deepseek-v4-flash')
  })

  it('falls back within the implementation tier when the heavy executor is degraded', async () => {
    scripted.set('review-1', [bug('bug-a')])
    runner = new WorkflowRunner('wf-1', {
      profile: PROFILE, policy: POLICY, executors, journal, degradedExecutors: ['builder'],
      capabilities: { delivery: DELIVERY },
    })

    await runLifecycle()
    const repair = started.find(request => roleOf(request) === 'repair')

    expect(repair?.route.executor).toBe('spare-builder')
    expect(repair?.route.model).toBe('mimo-v2.5')
  })
})

describe('a finding only a person can settle', () => {
  it('starts no repair for a product decision and never reaches PR READY', async () => {
    scripted.set('review-1', [productDecision('pd-a')])

    const result = await runLifecycle()

    expect(result.state).toBe('BLOCKED')
    expect(result.outcome.repairCycles).toBe(0)
    expect(result.outcome.stages.map(stage => stage.role)).not.toContain('repair')
    expect(result.openDefects.map(finding => finding.id)).toEqual(['pd-a'])
  })
})

describe('the repair ceiling', () => {
  it('cannot reach PR READY when a bug survives every cycle', async () => {
    for (const stageId of ['review-1', 'review-2', 'review-3', 'review-4']) {
      scripted.set(stageId, [bug('bug-forever')])
    }

    const result = await runLifecycle()

    expect(result.state).not.toBe('PR_READY')
    expect(result.state).toBe('BLOCKED')
    expect(result.outcome.repairCycles).toBe(PROFILE.workflowPolicy.maxRepairCycles)
    expect(result.openDefects.map(finding => finding.id)).toContain('bug-forever')
  })
})


describe('conformance standing between a green run and a ready pull request', () => {
  it('reads conformance last, after every stage that could still open a repair', () => {
    // Last on purpose: conformance answers about the branch as it stands, and
    // a reading taken before a review that has yet to find anything would be
    // an answer about a tree the pull request may not end up holding.
    const roles = planPullRequestStages({ ...OBJECTIVE, risk: 'critical' }).map(stage => stage.role)

    expect(roles.at(-2)).toBe('conformance')
    expect(roles.at(-1)).toBe('verify')
    expect(roles.indexOf('conformance')).toBeGreaterThan(roles.indexOf('security'))
  })

  it('establishes nothing, and is not ready, when the run cannot read a conformance result', async () => {
    const result = await runLifecycle(OBJECTIVE, { conformance: undefined })

    expect(result.state).not.toBe('PR_READY')
    expect(result.state).toBe('INCONCLUSIVE')
    expect(result.outcome.verdict).toBe('INCONCLUSIVE')
  })

  it('is not ready when the result does not answer every approved obligation', async () => {
    // A model that answered some of the obligations has said nothing about the
    // rest, and a gate that took that for a pass would be scoring the work
    // against a set the model picked.
    const result = await runLifecycle(OBJECTIVE, {
      conformance: (_stage, _executor, _result, manifest) => ({
        specSha256: manifest.specSha256,
        planSha256: manifest.planSha256,
        items: [],
        verdict: 'PASS',
        summary: 'nothing was checked',
      }),
    })

    expect(result.state).toBe('INCONCLUSIVE')
    expect(result.outcome.stages.map(stage => stage.stageId)).not.toContain('verify-final')
  })

  it('is not ready when the result says the branch does not satisfy what was approved', async () => {
    const result = await runLifecycle(OBJECTIVE, {
      conformance: (_stage, _executor, _result, manifest) => ({
        specSha256: manifest.specSha256,
        planSha256: manifest.planSha256,
        items: manifest.obligations.map(obligation => ({
          id: obligation.id,
          source: obligation.source,
          requirement: obligation.requirement,
          status: 'MISSING',
          implementationEvidence: [],
          verificationEvidence: [],
          summary: 'nothing addressed this',
        })),
        verdict: 'FAIL',
        summary: 'the approved obligations are not met',
      }),
    })

    expect(result.state).not.toBe('PR_READY')
    // The stage claimed a pass and the contract did not. The run believes the
    // weaker of the two, because the contract is what the stage established.
    expect(result.outcome.stages.findLast(stage => stage.role === 'conformance')?.verdict).toBe('FAIL')
  })

  it('stops before it writes anything when the approved Spec is not the approved Spec any more', async () => {
    // Checked before the stage rather than after: an implementation guided by
    // a Plan somebody edited mid-run is work against obligations nobody
    // approved, and by the time it has written, that work exists.
    const result = await runLifecycle(OBJECTIVE, {
      loadApprovedArtifacts: async () => ({ ...ARTIFACTS, specSha256: 'c'.repeat(64) }),
    })

    expect(result.state).toBe('BLOCKED')
    expect(result.outcome.stages).toEqual([])
    expect(started).toEqual([])
  })

  it('reads the approved documents again before conformance, not once at the start', async () => {
    let reads = 0
    const result = await runLifecycle(OBJECTIVE, {
      loadApprovedArtifacts: async () => {
        reads += 1
        // Two reads gate the two stages that write — the implementation and
        // the delivery. The Plan changes after both, so only a run that reads
        // it again for conformance can notice.
        return reads <= 2 ? ARTIFACTS : { ...ARTIFACTS, planSha256: 'c'.repeat(64) }
      },
    })
    const roles = result.outcome.stages.map(stage => stage.role)

    expect(result.state).toBe('BLOCKED')
    // Past everything that writes, and stopped before conformance scored the
    // work against a Plan that is no longer the approved one.
    expect(roles).toContain('review')
    expect(roles).not.toContain('conformance')
  })

  it('reads conformance again after a repair, so the answer describes the branch as it now stands', async () => {
    // The defect is found by the last verification, which runs after
    // conformance has already answered once. The fix invalidates that answer.
    scripted.set('verify-final', [bug('bug-late', 'verify')])

    const result = await runLifecycle()
    const roles = result.outcome.stages.map(stage => stage.role)

    expect(roles.filter(role => role === 'conformance')).toHaveLength(2)
    expect(roles.lastIndexOf('conformance')).toBeGreaterThan(roles.lastIndexOf('repair'))
    expect(result.state).toBe('PR_READY')
  })

  it('is not ready when something changed the branch after conformance answered', () => {
    // Stated against a synthesized run rather than a real one, because the
    // runner is not the only thing that can produce an outcome: a projection
    // rebuilt from a journal is read by this same function.
    const result = assessPullRequest({
      workflowId: 'wf-1',
      objectiveId: 'obj-1',
      state: 'completed',
      verdict: 'PASS',
      summary: 'all stages passed',
      stages: [
        { ...PASSING, stageId: 'conformance-1', role: 'conformance' },
        { ...PASSING, stageId: 'delivery-2', role: 'delivery' },
      ],
      repairCycles: 1,
      executorStarts: 2,
    })

    expect(result.state).toBe('INCONCLUSIVE')
    expect(result.summary).toContain('conformance does not stand for the branch as it is now')
  })

  it('is not ready when nothing established conformance at all', () => {
    const result = assessPullRequest({
      workflowId: 'wf-1',
      objectiveId: 'obj-1',
      state: 'completed',
      verdict: 'PASS',
      summary: 'all stages passed',
      stages: [PASSING],
      repairCycles: 0,
      executorStarts: 1,
    })

    expect(result.state).toBe('INCONCLUSIVE')
  })
})
