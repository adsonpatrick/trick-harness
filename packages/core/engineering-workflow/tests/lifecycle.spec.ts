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
import type { DiagnosisContract, Finding, StageResult, WorkflowObjective } from '@trick-harness/contracts'
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
})

const OBJECTIVE: WorkflowObjective = Object.freeze({
  id: 'obj-1',
  cwd: '/repo',
  requirement: 'add the thing',
  risk: 'low',
  workload: 'heavy',
  profileId: 'test',
})

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
async function runLifecycle(objective: WorkflowObjective = OBJECTIVE): Promise<PullRequestOutcome> {
  const outcome = await runner.run({
    objective,
    plan: planPullRequestStages,
    interpret,
    task: taskFor,
    diagnose: () => DIAGNOSIS,
    repairEvidence: () => REPAIRED,
  })
  return assessPullRequest(outcome)
}

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
    expect(roles).toEqual(['implement', 'verify', 'delivery', 'review', 'verify'])
  })

  it('adds QA and security as risk rises, and always ends on a fresh verification', () => {
    expect(planPullRequestStages({ ...OBJECTIVE, risk: 'critical' }).map(stage => stage.role)).toEqual([
      'implement', 'verify', 'delivery', 'review', 'qa', 'security', 'verify',
    ])
    expect(planPullRequestStages({ ...OBJECTIVE, risk: 'critical' }).at(-1)?.stageId).toBe('verify-final')
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
      'debug-1', 'repair-1', 'delivery-2', 'review-2',
      'verify-final',
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
