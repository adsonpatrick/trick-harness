import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createExecutorRuntime } from '@trick-harness/executor'
import type {
  ExecutorProvider,
  ExecutorResult,
  ExecutorStartRequest,
  HarnessExecutorRuntime,
} from '@trick-harness/executor'
import { WorkflowJournal, projectWorkflow } from '@trick-harness/journal'
import type { HarnessProfile } from '@trick-harness/profile'
import type { RoutingPolicy } from '@trick-harness/routing'
import type { DiagnosisContract, Finding, StageResult, WorkflowObjective } from '@trick-harness/contracts'
import {
  WorkflowError,
  WorkflowRunner,
  assessRestart,
  permissionModeFor,
  planStages,
} from '../src/index.ts'
import type { StageSpec } from '../src/index.ts'

const POLICY: RoutingPolicy = Object.freeze({
  policyVersion: 'test-v1.0.0',
  rules: Object.freeze([
    Object.freeze({ id: 'verify', when: Object.freeze({ role: 'verify' }), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
    Object.freeze({ id: 'review', when: Object.freeze({ role: 'review' }), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
    Object.freeze({ id: 'debug', when: Object.freeze({ role: 'debug' }), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
    Object.freeze({ id: 'qa', when: Object.freeze({ role: 'qa' }), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
    Object.freeze({ id: 'security', when: Object.freeze({ role: 'security' }), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
    Object.freeze({ id: 'default', when: Object.freeze({}), use: Object.freeze({ executor: 'builder', tier: 'implementation' }) }),
  ]),
  fallbackRules: Object.freeze([
    Object.freeze({ id: 'anything-degraded', when: Object.freeze({}), use: Object.freeze({ executor: 'spare', tier: 'implementation' }) }),
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
  workload: 'medium',
  profileId: 'test',
})

function provider(name: string, start: (request: ExecutorStartRequest) => Promise<ExecutorResult>): ExecutorProvider {
  return {
    name,
    capabilities: {
      modelOverride: true,
      reasoningEffort: true,
      permissionModes: ['read-only', 'workspace-write'],
    },
    start,
  }
}

function passing(role: string, output = 'done'): ExecutorResult {
  return { status: 'completed', output: `${role}: ${output}` }
}

function interpretAllPass(stage: StageSpec, executor: string): StageResult {
  return {
    role: stage.role,
    executor,
    verdict: 'PASS',
    summary: `${stage.role} ok`,
    findings: [],
    evidence: [],
  }
}

function taskFor(stage: StageSpec, objective: WorkflowObjective): string {
  return `${stage.role}: ${objective.requirement}`
}

const DIAGNOSIS: DiagnosisContract = Object.freeze({
  symptom: 'rounding is off by a cent on the last item',
  reproduction: 'pnpm vitest run cart.spec.ts -t "totals"',
  expectedVsActual: 'expected 10.00, got 9.99',
  observedEvidence: Object.freeze([
    Object.freeze({ kind: 'test' as const, locator: 'cart.spec.ts:totals', summary: 'red before the fix' }),
  ]),
  affectedBoundary: 'packages/cart/src/total.ts',
  ruledOutHypotheses: Object.freeze(['locale formatting', 'stale fixture']),
  rootCauseHypothesis: 'the subtotal truncates before the tax is applied',
  confidence: 'high',
  regressionTestSeam: 'cart.spec.ts totals suite',
  minimalRepairSurface: 'total.ts rounding order',
  unknowns: Object.freeze([]),
  securityRelevance: 'none',
})

function bug(id = 'f-1', findingClass: Finding['class'] = 'BUG'): Finding {
  return {
    id,
    class: findingClass,
    raisedBy: 'verify',
    summary: 'totals are a cent short',
    confirmed: true,
    evidence: [{ kind: 'test', locator: 'cart.spec.ts:totals', summary: 'red' }],
  }
}

const REPAIRED = Object.freeze({
  regressionTest: Object.freeze({ kind: 'test' as const, locator: 'cart.spec.ts:totals', summary: 'red first' }),
  focusedGreen: Object.freeze({ kind: 'test' as const, locator: 'cart.spec.ts:totals', summary: 'green after' }),
  rootCauseAddressed: true,
})

describe('the stage plan', () => {
  it('runs implement, verify and delivery for an ordinary objective', () => {
    expect(planStages(OBJECTIVE).map(stage => stage.role)).toEqual(['implement', 'verify', 'delivery'])
  })

  it('inserts an independent review before delivery when risk is high', () => {
    const stages = planStages({ ...OBJECTIVE, risk: 'high' })
    expect(stages.map(stage => stage.role)).toEqual(['implement', 'verify', 'review', 'qa', 'delivery'])
  })

  it('adds a security stage for a critical objective', () => {
    const stages = planStages({ ...OBJECTIVE, risk: 'critical' })
    expect(stages.map(stage => stage.role)).toEqual([
      'implement', 'verify', 'review', 'qa', 'security', 'delivery',
    ])
  })

  it('names every stage uniquely so the journal can pair starts with ends', () => {
    const ids = planStages({ ...OBJECTIVE, risk: 'critical' }).map(stage => stage.stageId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('role-specific permission modes', () => {
  it('gives every read-only role a read-only provider mode', () => {
    for (const role of ['refine', 'plan', 'debug', 'verify', 'review', 'security', 'qa'] as const) {
      expect(permissionModeFor(role)).toBe('read-only')
    }
  })

  it('gives only the mutating roles workspace write', () => {
    for (const role of ['implement', 'repair', 'delivery'] as const) {
      expect(permissionModeFor(role)).toBe('workspace-write')
    }
  })
})

describe('a normal run', () => {
  let session: Session
  let executors: HarnessExecutorRuntime
  let journal: WorkflowJournal
  let runner: WorkflowRunner

  beforeEach(() => {
    session = Session.create(SessionId('s'))
    executors = createExecutorRuntime()
    journal = new WorkflowJournal(session, 'wf-1', async () => true)
    runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal })
  })

  it('walks implement to verify to delivery and completes', async () => {
    const seen: string[] = []
    executors.register(provider('builder', async (request) => {
      seen.push(`builder:${request.route.permissionMode}`)
      return passing('builder')
    }))
    executors.register(provider('reviewer', async (request) => {
      seen.push(`reviewer:${request.route.permissionMode}`)
      return passing('reviewer')
    }))

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor })

    expect(outcome.state).toBe('completed')
    expect(outcome.verdict).toBe('PASS')
    expect(outcome.stages.map(stage => stage.role)).toEqual(['implement', 'verify', 'delivery'])
    expect(seen).toEqual(['builder:workspace-write', 'reviewer:read-only', 'builder:workspace-write'])
  })

  it('hands back compact facts and never the executor output', async () => {
    executors.register(provider('builder', async () => passing('builder', 'SECRET-TRANSCRIPT')))
    executors.register(provider('reviewer', async () => passing('reviewer', 'SECRET-TRANSCRIPT')))

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor })

    expect(JSON.stringify(outcome)).not.toContain('SECRET-TRANSCRIPT')
    for (const stage of outcome.stages) {
      expect(stage.durationMs).toBeGreaterThanOrEqual(0)
      expect(Object.keys(stage)).not.toContain('output')
    }
  })

  it('writes the whole run to the journal, so a projection can rebuild it', async () => {
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))

    await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor })
    const projection = projectWorkflow(session.events, 'wf-1')

    expect(projection.objective?.id).toBe('obj-1')
    expect(projection.routes).toHaveLength(3)
    expect(projection.verdicts).toHaveLength(3)
    expect(projection.openStages).toEqual([])
    expect(projection.end?.state).toBe('completed')
  })

  it('routes a read-only stage away from the implementer when asked', async () => {
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))

    const outcome = await runner.run({
      objective: { ...OBJECTIVE, risk: 'high' },
      implementationExecutor: 'builder',
      interpret: interpretAllPass,
      task: taskFor,
    })

    const review = outcome.stages.find(stage => stage.role === 'review')
    expect(review?.executor).not.toBe('builder')
  })
})

describe('a run that goes wrong', () => {
  let session: Session
  let executors: HarnessExecutorRuntime
  let journal: WorkflowJournal
  let runner: WorkflowRunner

  beforeEach(() => {
    session = Session.create(SessionId('s'))
    executors = createExecutorRuntime()
    journal = new WorkflowJournal(session, 'wf-1', async () => true)
    runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal })
  })

  it('stops on a cancelled run and reports it as inconclusive, not failed', async () => {
    executors.register(provider('builder', async (request) => {
      await new Promise((resolve) => { request.signal.addEventListener('abort', resolve, { once: true }) })
      return { status: 'aborted', output: '' }
    }))

    const running = runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor })
    runner.cancel('caller asked')
    const outcome = await running

    expect(outcome.state).toBe('canceled')
    expect(outcome.verdict).toBe('INCONCLUSIVE')
    expect(projectWorkflow(session.events, 'wf-1').openStages).toEqual([])
  })

  it('ends the run when an executor errors and records the safe diagnostic only', async () => {
    executors.register(provider('builder', async () => ({
      status: 'error',
      output: '',
      failure: {
        category: 'transport-unavailable',
        availability: true,
        safeDiagnostic: 'provider did not start',
      },
    })))

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor })

    expect(outcome.state).toBe('failed')
    expect(outcome.verdict).toBe('FAIL')
    expect(JSON.stringify(session.events)).toContain('transport-unavailable')
  })

  it('blocks rather than guessing when a stage returns a product decision', async () => {
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))

    const outcome = await runner.run({
      objective: OBJECTIVE,
      interpret: (stage, executor) => stage.role === 'verify'
        ? {
          role: stage.role,
          executor,
          verdict: 'BLOCKED',
          summary: 'the requirement does not say which currency to round to',
          findings: [{
            id: 'f-1',
            class: 'PRODUCT_DECISION',
            raisedBy: 'verify',
            summary: 'rounding currency unspecified',
            confirmed: true,
            evidence: [],
          }],
          evidence: [],
        }
        : interpretAllPass(stage, executor),
      task: taskFor,
    })

    expect(outcome.state).toBe('blocked')
    expect(outcome.verdict).toBe('BLOCKED')
    expect(outcome.stages.map(stage => stage.role)).toEqual(['implement', 'verify'])
    const projection = projectWorkflow(session.events, 'wf-1')
    expect(projection.blockers[0]?.kind).toBe('product-decision')
  })

  it('repairs a failed verification through a read-only diagnosis first', async () => {
    let verifications = 0
    const modes: string[] = []
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async (request) => {
      modes.push(request.route.permissionMode)
      return passing('reviewer')
    }))

    const outcome = await runner.run({
      objective: OBJECTIVE,
      interpret: (stage, executor) => {
        if (stage.role !== 'verify') return interpretAllPass(stage, executor)
        verifications += 1
        return {
          role: stage.role,
          executor,
          verdict: verifications === 1 ? 'FAIL' : 'PASS',
          summary: verifications === 1 ? 'focused suite red' : 'focused suite green',
          findings: verifications === 1 ? [bug()] : [],
          evidence: [],
        }
      },
      diagnose: () => DIAGNOSIS,
      repairEvidence: () => REPAIRED,
      task: taskFor,
    })

    expect(outcome.state).toBe('completed')
    expect(outcome.repairCycles).toBe(1)
    expect(outcome.stages.map(stage => stage.role)).toEqual([
      'implement', 'verify', 'debug', 'repair', 'verify', 'delivery',
    ])
    expect(outcome.stages.find(stage => stage.role === 'debug')?.permissionMode).toBe('read-only')
    expect(modes).toEqual(['read-only', 'read-only', 'read-only'])
    for (const stage of outcome.stages) expect(stage.permissionMode).toBe(permissionModeFor(stage.role))
    expect(JSON.stringify(session.events)).toContain('harness/diagnosis')
  })

  it('blocks rather than repairing when the failed verification names no defect', async () => {
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))

    const outcome = await runner.run({
      objective: OBJECTIVE,
      interpret: (stage, executor) => stage.role === 'verify'
        ? { role: stage.role, executor, verdict: 'FAIL', summary: 'still red', findings: [], evidence: [] }
        : interpretAllPass(stage, executor),
      task: taskFor,
    })

    expect(outcome.state).toBe('blocked')
    expect(outcome.repairCycles).toBe(0)
    expect(outcome.stages.map(stage => stage.role)).toEqual(['implement', 'verify'])
  })

  it('blocks when the debugger finishes without stating a diagnosis', async () => {
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))

    const outcome = await runner.run({
      objective: OBJECTIVE,
      interpret: (stage, executor) => stage.role === 'verify'
        ? { role: stage.role, executor, verdict: 'FAIL', summary: 'red', findings: [bug()], evidence: [] }
        : interpretAllPass(stage, executor),
      diagnose: () => undefined,
      task: taskFor,
    })

    expect(outcome.state).toBe('blocked')
    expect(outcome.stages.map(stage => stage.role)).toEqual(['implement', 'verify', 'debug'])
    expect(outcome.stages.some(stage => stage.role === 'repair')).toBe(false)
  })

  it('blocks before any mutation when the defect depends on an unmade product decision', async () => {
    const started: string[] = []
    executors.register(provider('builder', async (request) => {
      started.push(request.route.permissionMode)
      return passing('builder')
    }))
    executors.register(provider('reviewer', async () => passing('reviewer')))

    const outcome = await runner.run({
      objective: OBJECTIVE,
      interpret: (stage, executor) => stage.role === 'verify'
        ? { role: stage.role, executor, verdict: 'FAIL', summary: 'red', findings: [bug()], evidence: [] }
        : interpretAllPass(stage, executor),
      diagnose: () => ({ ...DIAGNOSIS, productDecisionDependency: 'nobody said which currency to round to' }),
      task: taskFor,
    })

    expect(outcome.state).toBe('blocked')
    expect(outcome.stages.some(stage => stage.role === 'repair')).toBe(false)
    // Only the original implement stage ever held write authority.
    expect(started.filter(mode => mode === 'workspace-write')).toHaveLength(1)
    expect(projectWorkflow(session.events, 'wf-1').blockers.at(-1)?.kind).toBe('product-decision')
  })

  it('treats a repair with no regression test as incomplete rather than done', async () => {
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))

    const outcome = await runner.run({
      objective: OBJECTIVE,
      interpret: (stage, executor) => stage.role === 'verify'
        ? { role: stage.role, executor, verdict: 'FAIL', summary: 'red', findings: [bug()], evidence: [] }
        : interpretAllPass(stage, executor),
      diagnose: () => DIAGNOSIS,
      repairEvidence: () => ({ focusedGreen: REPAIRED.focusedGreen, rootCauseAddressed: true }),
      task: taskFor,
    })

    expect(outcome.state).toBe('failed')
    expect(outcome.verdict).toBe('INCONCLUSIVE')
    expect(outcome.summary).toContain('regression test')
  })

  it('repairs a mechanically obvious test defect without a debugger', async () => {
    let verifications = 0
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))

    const outcome = await runner.run({
      objective: OBJECTIVE,
      interpret: (stage, executor) => {
        if (stage.role !== 'verify') return interpretAllPass(stage, executor)
        verifications += 1
        return {
          role: stage.role,
          executor,
          verdict: verifications === 1 ? 'FAIL' : 'PASS',
          summary: 'suite',
          findings: verifications === 1 ? [bug('f-2', 'TEST_DEFECT')] : [],
          evidence: [],
        }
      },
      repairEvidence: () => REPAIRED,
      task: taskFor,
    })

    expect(outcome.state).toBe('completed')
    expect(outcome.stages.map(stage => stage.role)).toEqual([
      'implement', 'verify', 'repair', 'verify', 'delivery',
    ])
  })

  it('stops at the repair budget instead of looping', async () => {
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))

    const outcome = await runner.run({
      objective: OBJECTIVE,
      interpret: (stage, executor) => stage.role === 'verify'
        ? { role: stage.role, executor, verdict: 'FAIL', summary: 'still red', findings: [bug()], evidence: [] }
        : interpretAllPass(stage, executor),
      diagnose: () => DIAGNOSIS,
      repairEvidence: () => REPAIRED,
      task: taskFor,
    })

    expect(outcome.repairCycles).toBe(PROFILE.workflowPolicy.maxRepairCycles)
    expect(outcome.state).toBe('blocked')
    const projection = projectWorkflow(session.events, 'wf-1')
    expect(projection.blockers.at(-1)?.kind).toBe('budget-exhausted')
  })

  it('stops at the executor-start budget', async () => {
    const tight = new WorkflowRunner('wf-1', {
      profile: { ...PROFILE, workflowPolicy: { maxRepairCycles: 3, maxExecutorStarts: 2 } },
      policy: POLICY,
      executors,
      journal,
    })
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))

    const outcome = await tight.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor })

    expect(outcome.executorStarts).toBe(2)
    expect(outcome.state).toBe('blocked')
  })
})

describe('the lifecycle owner', () => {
  it('refuses a second concurrent run of the same workflow', async () => {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    const runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal })
    executors.register(provider('builder', async (request) => {
      await new Promise((resolve) => { request.signal.addEventListener('abort', resolve, { once: true }) })
      return { status: 'aborted', output: '' }
    }))

    const first = runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor })
    await expect(runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor }))
      .rejects.toThrow(WorkflowError)
    runner.cancel('done testing')
    await first
  })

  it('aborts the live run and leaves nothing owned when disposed', async () => {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    const runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal })
    const aborted = vi.fn()
    let announce: () => void = () => {}
    const started = new Promise<void>((resolve) => { announce = resolve })
    executors.register(provider('builder', async (request) => {
      request.signal.addEventListener('abort', aborted, { once: true })
      announce()
      await new Promise((resolve) => { request.signal.addEventListener('abort', resolve, { once: true }) })
      return { status: 'aborted', output: '' }
    }))

    const running = runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor })
    await started
    runner.dispose()
    await running

    expect(aborted).toHaveBeenCalledOnce()
    expect(runner.isRunning()).toBe(false)
    expect(executors.activeRuns()).toBe(0)
  })

  it('refuses to start after disposal', async () => {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    const runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal })
    runner.dispose()

    await expect(runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor }))
      .rejects.toThrow(WorkflowError)
  })
})

describe('what a restart may conclude', () => {
  it('reads a completed workflow as terminal and needing no world check', async () => {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    const runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal })
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))
    await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor })

    const assessment = assessRestart(projectWorkflow(session.events, 'wf-1'))

    expect(assessment.state).toBe('terminal')
    expect(assessment.requiresWorldVerification).toBe(false)
  })

  it('reads a workflow with no end as interrupted and inconclusive', () => {
    const session = Session.create(SessionId('s'))
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    journal.start(OBJECTIVE)

    const assessment = assessRestart(projectWorkflow(session.events, 'wf-1'))

    expect(assessment.state).toBe('interrupted')
    expect(assessment.verdict).toBe('INCONCLUSIVE')
  })

  it('demands a world check when a stage was in flight', () => {
    const session = Session.create(SessionId('s'))
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    journal.start(OBJECTIVE)
    journal.executorStart({
      stageId: 'implement-1',
      role: 'implement',
      decision: {
        executor: 'builder',
        semanticModelTier: 'implementation',
        resolvedModel: 'mimo-v2.5',
        permissionMode: 'workspace-write',
        reasonCodes: [],
        policyVersion: 'test-v1.0.0',
      },
    })

    const assessment = assessRestart(projectWorkflow(session.events, 'wf-1'))

    expect(assessment.openStages).toEqual(['implement-1'])
    expect(assessment.requiresWorldVerification).toBe(true)
  })

  it('demands a world check when a mutation was already recorded', async () => {
    const session = Session.create(SessionId('s'))
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    journal.start(OBJECTIVE)
    await journal.delivery({ action: 'push', branch: 'feat/x', commitSha: 'abc123' })

    const assessment = assessRestart(projectWorkflow(session.events, 'wf-1'))

    expect(assessment.requiresWorldVerification).toBe(true)
    expect(assessment.summary).toContain('push')
  })
})

describe('triage inside a run', () => {
  let session: Session
  let executors: HarnessExecutorRuntime
  let journal: WorkflowJournal
  let runner: WorkflowRunner

  beforeEach(() => {
    session = Session.create(SessionId('s'))
    executors = createExecutorRuntime()
    journal = new WorkflowJournal(session, 'wf-1', async () => true)
    runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal })
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))
  })

  it('refuses a stage that reports PASS over a confirmed material defect', async () => {
    const outcome = await runner.run({
      objective: OBJECTIVE,
      interpret: (stage, executor) => stage.role === 'verify'
        ? { role: stage.role, executor, verdict: 'PASS', summary: 'looks fine', findings: [bug()], evidence: [] }
        : interpretAllPass(stage, executor),
      diagnose: () => DIAGNOSIS,
      repairEvidence: () => REPAIRED,
      task: taskFor,
    })

    // The claimed PASS became a FAIL, which is what opened the repair cycle.
    expect(outcome.repairCycles).toBeGreaterThan(0)
    expect(outcome.stages.map(stage => stage.role)).toContain('debug')
  })

  it('blocks on a product decision however the stage graded itself', async () => {
    const outcome = await runner.run({
      objective: OBJECTIVE,
      interpret: (stage, executor) => stage.role === 'verify'
        ? {
          role: stage.role,
          executor,
          verdict: 'PASS',
          summary: 'shipped it',
          findings: [{ ...bug(), class: 'PRODUCT_DECISION', summary: 'which currency rounds?' }],
          evidence: [],
        }
        : interpretAllPass(stage, executor),
      task: taskFor,
    })

    expect(outcome.state).toBe('blocked')
    expect(outcome.repairCycles).toBe(0)
    expect(projectWorkflow(session.events, 'wf-1').blockers.at(-1)?.kind).toBe('product-decision')
  })

  it('opens a repair cycle for a QA failure and re-runs QA afterwards', async () => {
    let qaRuns = 0
    const outcome = await runner.run({
      objective: { ...OBJECTIVE, risk: 'medium' },
      interpret: (stage, executor) => {
        if (stage.role !== 'qa') return interpretAllPass(stage, executor)
        qaRuns += 1
        return {
          role: stage.role,
          executor,
          verdict: qaRuns === 1 ? 'FAIL' : 'PASS',
          summary: qaRuns === 1 ? 'negative path throws' : 'negative path handled',
          findings: qaRuns === 1 ? [{ ...bug(), raisedBy: 'qa' }] : [],
          evidence: [],
        }
      },
      diagnose: () => DIAGNOSIS,
      repairEvidence: () => REPAIRED,
      task: taskFor,
    })

    expect(outcome.state).toBe('completed')
    expect(outcome.stages.map(stage => stage.role)).toEqual([
      'implement', 'verify', 'qa', 'debug', 'repair', 'qa', 'delivery',
    ])
    expect(outcome.stages.filter(stage => stage.role === 'qa').map(stage => stage.stageId))
      .toEqual(['qa-1', 'qa-2'])
  })

  it('repairs the worst defect first when a stage names several', async () => {
    let verifications = 0
    const outcome = await runner.run({
      objective: OBJECTIVE,
      interpret: (stage, executor) => {
        if (stage.role !== 'verify') return interpretAllPass(stage, executor)
        verifications += 1
        return {
          role: stage.role,
          executor,
          verdict: verifications === 1 ? 'FAIL' : 'PASS',
          summary: 'suite',
          findings: verifications === 1
            ? [{ ...bug('f-tool', 'TOOLING_DEFECT') }, { ...bug('f-sec', 'SECURITY_BUG') }]
            : [],
          evidence: [],
        }
      },
      diagnose: () => DIAGNOSIS,
      repairEvidence: () => REPAIRED,
      task: taskFor,
    })

    // A tooling defect alone would have skipped diagnosis; the security bug did not.
    expect(outcome.stages.map(stage => stage.role)).toContain('debug')
    expect(outcome.state).toBe('completed')
  })
})

describe('independence the profile actually requires', () => {
  const SOLO_POLICY: RoutingPolicy = Object.freeze({
    policyVersion: 'solo-v1.0.0',
    rules: Object.freeze([
      Object.freeze({ id: 'only', when: Object.freeze({}), use: Object.freeze({ executor: 'builder', tier: 'implementation' }) }),
    ]),
    fallbackRules: Object.freeze([]),
    registry: Object.freeze({ implementation: 'mimo-v2.5', reasoning: 'deepseek-v4-flash' }),
  })

  it('refuses to certify with the implementer when the objective requires someone else', async () => {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    const runner = new WorkflowRunner('wf-1', {
      profile: PROFILE, policy: SOLO_POLICY, executors, journal,
    })
    const starts: string[] = []
    executors.register(provider('builder', async (request) => {
      starts.push(request.route.permissionMode)
      return passing('builder')
    }))

    const outcome = await runner.run({
      objective: { ...OBJECTIVE, risk: 'high' },
      interpret: interpretAllPass,
      task: taskFor,
    })

    expect(outcome.state).toBe('blocked')
    expect(outcome.summary).toContain('independent')
    // Implementation ran; the certifying stage was never started at all.
    expect(starts).toEqual(['workspace-write'])
  })

  it('accepts the implementer as a reader when the objective only prefers otherwise', async () => {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    const runner = new WorkflowRunner('wf-1', {
      profile: PROFILE, policy: SOLO_POLICY, executors, journal,
    })
    executors.register(provider('builder', async () => passing('builder')))

    const outcome = await runner.run({
      objective: { ...OBJECTIVE, risk: 'medium' },
      interpret: interpretAllPass,
      task: taskFor,
    })

    expect(outcome.state).toBe('completed')
  })
})

describe('a pass the route it ran on cannot support', () => {
  it('caps a high-risk certification answered by a fallback executor', async () => {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    const runner = new WorkflowRunner('wf-1', {
      profile: PROFILE, policy: POLICY, executors, journal, degradedExecutors: ['reviewer'],
    })
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('spare', async () => passing('spare')))

    const outcome = await runner.run({
      objective: { ...OBJECTIVE, risk: 'high' },
      interpret: interpretAllPass,
      task: taskFor,
    })

    expect(outcome.state).toBe('failed')
    expect(outcome.verdict).toBe('PARTIAL')
    expect(outcome.summary).toContain('degraded')
  })

  it('leaves an ordinary low-risk pass alone even on a fallback route', async () => {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    const runner = new WorkflowRunner('wf-1', {
      profile: PROFILE, policy: POLICY, executors, journal, degradedExecutors: ['reviewer'],
    })
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('spare', async () => passing('spare')))

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor })

    expect(outcome.state).toBe('completed')
    expect(outcome.verdict).toBe('PASS')
  })
})

describe('a stage the policy cannot answer for', () => {
  it('blocks with a terminal event rather than letting the routing error escape', async () => {
    const NO_FALLBACK: RoutingPolicy = Object.freeze({
      policyVersion: 'no-fallback-v1.0.0',
      rules: POLICY.rules,
      fallbackRules: Object.freeze([]),
      registry: POLICY.registry,
    })
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    const runner = new WorkflowRunner('wf-1', {
      profile: PROFILE, policy: NO_FALLBACK, executors, journal, degradedExecutors: ['builder'],
    })
    executors.register(provider('builder', async () => passing('builder')))

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor })

    expect(outcome.state).toBe('blocked')
    expect(outcome.summary).toContain('could not be routed')
    // The terminal event is the point: without it a restart would read a
    // deterministic refusal as a run whose effect on the world is unknown.
    const projection = projectWorkflow(session.events, 'wf-1')
    expect(projection.end?.state).toBe('blocked')
    expect(projection.blockers).toHaveLength(1)
  })
})

describe('a plan that asks for a repair with nothing to repair', () => {
  it('refuses the stage instead of failing as a type error inside the gate', async () => {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    const runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal })
    executors.register(provider('builder', async () => passing('builder')))

    const outcome = await runner.run({
      objective: OBJECTIVE,
      plan: () => [{ stageId: 'repair-1', role: 'repair' }],
      interpret: interpretAllPass,
      task: taskFor,
    })

    expect(outcome.state).toBe('blocked')
    expect(outcome.summary).toContain('no confirmed defect')
  })
})
