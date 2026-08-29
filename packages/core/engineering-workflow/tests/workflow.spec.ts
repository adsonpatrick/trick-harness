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
import type { ConformanceManifest, DiagnosisContract, Finding, StageResult, WorkflowObjective } from '@trick-harness/contracts'
import {
  WorkflowError,
  WorkflowRunner,
  assessRestart,
  permissionModeFor,
  planStages,
} from '../src/index.ts'
import type {
  DatabaseVerificationCapabilityPort,
  DeliveryCapabilityPort,
  StageSpec,
  WorkflowOutcome,
} from '../src/index.ts'

const POLICY: RoutingPolicy = Object.freeze({
  policyVersion: 'test-v1.0.0',
  rules: Object.freeze([
    Object.freeze({ id: 'verify', when: Object.freeze({ role: 'verify' }), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
    Object.freeze({ id: 'review', when: Object.freeze({ role: 'review' }), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
    Object.freeze({ id: 'debug', when: Object.freeze({ role: 'debug' }), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
    Object.freeze({ id: 'qa', when: Object.freeze({ role: 'qa' }), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
    Object.freeze({ id: 'security', when: Object.freeze({ role: 'security' }), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
    Object.freeze({ id: 'conformance', when: Object.freeze({ role: 'conformance' }), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
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
  securityPolicy: Object.freeze({
    rules: Object.freeze([]),
    // Narrow on purpose: the cart is the only ground a security defect may be
    // repaired on unattended in this fixture, and the tests below lean on the
    // fact that everywhere else is refused.
    repairRules: Object.freeze([Object.freeze({
      id: 'cart-only',
      findingClass: 'SECURITY_BUG',
      allowedBoundaries: Object.freeze(['packages/cart/**']),
    })]),
  }),
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
  workload: 'medium',
  profileId: 'test',
  approvedArtifacts: {
    spec: { path: 'docs/spec.md', sha256: 'a'.repeat(64) },
    plan: { path: 'docs/plan.md', sha256: 'b'.repeat(64) },
  },
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
  it('delivers before it certifies, and ends on a fresh verification', () => {
    expect(planStages(OBJECTIVE).map(stage => stage.role))
      .toEqual(['implement', 'verify', 'delivery', 'review', 'conformance', 'verify'])
    expect(planStages(OBJECTIVE).at(-1)?.stageId).toBe('verify-final')
  })

  it('buys QA from medium risk upwards', () => {
    const stages = planStages({ ...OBJECTIVE, risk: 'high' })
    expect(stages.map(stage => stage.role))
      .toEqual(['implement', 'verify', 'delivery', 'review', 'qa', 'conformance', 'verify'])
  })

  it('adds a security stage for a critical objective', () => {
    const stages = planStages({ ...OBJECTIVE, risk: 'critical' })
    expect(stages.map(stage => stage.role)).toEqual([
      'implement', 'verify', 'delivery', 'review', 'qa', 'security', 'conformance', 'verify',
    ])
  })

  it('reviews every objective, whatever its risk, because the branch is published either way', () => {
    expect(planStages({ ...OBJECTIVE, risk: 'low' }).map(stage => stage.role)).toContain('review')
  })

  it('names every stage uniquely so the journal can pair starts with ends', () => {
    const ids = planStages({ ...OBJECTIVE, risk: 'critical' }).map(stage => stage.stageId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

/**
 * A delivery capability that publishes without touching a remote.
 *
 * Every run in this file that reaches delivery gets one, because the runtime
 * refuses to publish without a capability and there is no executor path left
 * for it to take instead.
 */
function deliveryStub(stageIds?: string[]): DeliveryCapabilityPort {
  return {
    deliver: async (input) => {
      stageIds?.push(input.stageId)
      return { delivered: true, summary: 'the branch was pushed and its pull request updated', evidence: [], findings: [] }
    },
  }
}

const DELIVERY = deliveryStub()

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
    runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY } })
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

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })

    expect(outcome.state).toBe('completed')
    expect(outcome.verdict).toBe('PASS')
    expect(outcome.stages.map(stage => stage.role))
      .toEqual(['implement', 'verify', 'delivery', 'review', 'conformance', 'verify'])
    // No executor was asked for delivery: publishing is a bounded command
    // sequence, not a question put to a model.
    expect(seen).toEqual([
      'builder:workspace-write', 'reviewer:read-only', 'reviewer:read-only', 'reviewer:read-only',
      'reviewer:read-only',
    ])
  })

  it('hands back compact facts and never the executor output', async () => {
    executors.register(provider('builder', async () => passing('builder', 'SECRET-TRANSCRIPT')))
    executors.register(provider('reviewer', async () => passing('reviewer', 'SECRET-TRANSCRIPT')))

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })

    expect(JSON.stringify(outcome)).not.toContain('SECRET-TRANSCRIPT')
    for (const stage of outcome.stages) {
      expect(stage.durationMs).toBeGreaterThanOrEqual(0)
      expect(Object.keys(stage)).not.toContain('output')
    }
  })

  it('writes the whole run to the journal, so a projection can rebuild it', async () => {
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))

    await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })
    const projection = projectWorkflow(session.events, 'wf-1')

    expect(projection.objective?.id).toBe('obj-1')
    // Five routed stages, six verdicts: delivery reports one without being routed.
    expect(projection.routes).toHaveLength(5)
    expect(projection.verdicts).toHaveLength(6)
    // The capability window opened and closed, so nothing is left open.
    expect(projection.openCapabilities).toEqual([])
    expect(JSON.stringify(session.events)).toContain('github-delivery')
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
      task: taskFor, ...CONFORMS,
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
    runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY } })
  })

  it('stops on a cancelled run and reports it as inconclusive, not failed', async () => {
    executors.register(provider('builder', async (request) => {
      await new Promise((resolve) => { request.signal.addEventListener('abort', resolve, { once: true }) })
      return { status: 'aborted', output: '' }
    }))

    const running = runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })
    runner.cancel('caller asked')
    const outcome = await running

    expect(outcome.state).toBe('canceled')
    expect(outcome.verdict).toBe('INCONCLUSIVE')
    expect(projectWorkflow(session.events, 'wf-1').openStages).toEqual([])
  })

  it('stops with no usable executor left, and records the safe diagnostic only', async () => {
    executors.register(provider('builder', async () => ({
      status: 'error',
      output: '',
      failure: {
        category: 'transport-unavailable',
        availability: true,
        safeDiagnostic: 'provider did not start',
      },
    })))

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })

    // The single registered executor cannot serve, and there is nobody to
    // reroute to. Blocking is the expected outcome of that, not a defect: the
    // alternative is inventing a route to a product this runtime does not have.
    expect(outcome.state).toBe('blocked')
    expect(JSON.stringify(session.events)).toContain('transport-unavailable')
    expect(JSON.stringify(session.events)).toContain('provider did not start')
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
      task: taskFor, ...CONFORMS,
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
      task: taskFor, ...CONFORMS,
    })

    expect(outcome.state).toBe('completed')
    expect(outcome.repairCycles).toBe(1)
    expect(outcome.stages.map(stage => stage.role)).toEqual([
      'implement', 'verify', 'debug', 'repair', 'verify', 'delivery', 'review', 'conformance', 'verify',
    ])
    expect(outcome.stages.find(stage => stage.role === 'debug')?.permissionMode).toBe('read-only')
    expect(modes).toEqual(['read-only', 'read-only', 'read-only', 'read-only', 'read-only', 'read-only'])
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
      task: taskFor, ...CONFORMS,
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
      task: taskFor, ...CONFORMS,
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
      task: taskFor, ...CONFORMS,
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
      task: taskFor, ...CONFORMS,
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
      task: taskFor, ...CONFORMS,
    })

    expect(outcome.state).toBe('completed')
    expect(outcome.stages.map(stage => stage.role)).toEqual([
      'implement', 'verify', 'repair', 'verify', 'delivery', 'review', 'conformance', 'verify',
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
      task: taskFor, ...CONFORMS,
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
      capabilities: { delivery: DELIVERY },
    })
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))

    const outcome = await tight.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })

    expect(outcome.executorStarts).toBe(2)
    expect(outcome.state).toBe('blocked')
  })
})

describe('the lifecycle owner', () => {
  it('refuses a second concurrent run of the same workflow', async () => {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    const runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY } })
    executors.register(provider('builder', async (request) => {
      await new Promise((resolve) => { request.signal.addEventListener('abort', resolve, { once: true }) })
      return { status: 'aborted', output: '' }
    }))

    const first = runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })
    await expect(runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS }))
      .rejects.toThrow(WorkflowError)
    runner.cancel('done testing')
    await first
  })

  it('aborts the live run and leaves nothing owned when disposed', async () => {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    const runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY } })
    const aborted = vi.fn()
    let announce: () => void = () => {}
    const started = new Promise<void>((resolve) => { announce = resolve })
    executors.register(provider('builder', async (request) => {
      request.signal.addEventListener('abort', aborted, { once: true })
      announce()
      await new Promise((resolve) => { request.signal.addEventListener('abort', resolve, { once: true }) })
      return { status: 'aborted', output: '' }
    }))

    const running = runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })
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
    const runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY } })
    runner.dispose()

    await expect(runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS }))
      .rejects.toThrow(WorkflowError)
  })
})

describe('what a restart may conclude', () => {
  it('reads a completed workflow as terminal and needing no world check', async () => {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    const runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY } })
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))
    await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })

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

  it('demands a world check when even a read-only stage was in flight', () => {
    const session = Session.create(SessionId('s'))
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    journal.start(OBJECTIVE)
    journal.executorStart({
      stageId: 'review-1',
      role: 'review',
      decision: {
        executor: 'reviewer',
        semanticModelTier: 'reasoning',
        resolvedModel: 'mimo-v2.5',
        permissionMode: 'read-only',
        reasonCodes: [],
        policyVersion: 'test-v1.0.0',
      },
    })

    const assessment = assessRestart(projectWorkflow(session.events, 'wf-1'))

    // Deliberately conservative. The log records the permission the route
    // carried, not what the process on the other end actually did with it, and
    // a restart that trusts the label is trusting the wrong record.
    expect(assessment.requiresWorldVerification).toBe(true)
  })

  it('demands a world check when a preview-branch capability was in flight', async () => {
    const session = Session.create(SessionId('s'))
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    journal.start(OBJECTIVE)
    await journal.beginCapability('verify-1', 'supabase-preview', true)

    const assessment = assessRestart(projectWorkflow(session.events, 'wf-1'))

    expect(assessment.requiresWorldVerification).toBe(true)
    expect(assessment.summary).toContain('verify-1:supabase-preview')
  })

  it('demands a world check when a capability was in flight', async () => {
    const session = Session.create(SessionId('s'))
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    journal.start(OBJECTIVE)
    await journal.beginCapability('deliver-1', 'github-delivery', true)

    const assessment = assessRestart(projectWorkflow(session.events, 'wf-1'))

    // No stage was open and no delivery was recorded, yet a push may have
    // landed. Reading this as safe to retry is how one commit becomes two.
    expect(assessment.openStages).toEqual([])
    expect(assessment.requiresWorldVerification).toBe(true)
    expect(assessment.summary).toContain('deliver-1:github-delivery')
  })

  it('needs no world check once the capability reported back', async () => {
    const session = Session.create(SessionId('s'))
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    journal.start(OBJECTIVE)
    await journal.beginCapability('verify-1', 'supabase-preview', false)
    await journal.endCapability('verify-1', 'supabase-preview', 'completed', 12)

    const assessment = assessRestart(projectWorkflow(session.events, 'wf-1'))

    expect(assessment.requiresWorldVerification).toBe(false)
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
    runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY } })
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
      task: taskFor, ...CONFORMS,
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
      task: taskFor, ...CONFORMS,
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
      task: taskFor, ...CONFORMS,
    })

    expect(outcome.state).toBe('completed')
    expect(outcome.stages.map(stage => stage.role)).toEqual([
      'implement', 'verify', 'delivery', 'review', 'qa',
      'debug', 'repair', 'verify', 'delivery', 'qa',
      'conformance', 'verify',
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
      task: taskFor, ...CONFORMS,
    })

    // A tooling defect alone would have skipped diagnosis; the security bug did not.
    expect(outcome.stages.map(stage => stage.role)).toContain('debug')
    expect(outcome.state).toBe('completed')
  })

  it('stops rather than repairing a security defect outside the boundaries the policy names', async () => {
    let verifications = 0
    const repairs: string[] = []
    executors.register(provider('repairer', async () => {
      repairs.push('started')
      return passing('builder')
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
          summary: 'suite',
          findings: verifications === 1 ? [{ ...bug('f-sec', 'SECURITY_BUG') }] : [],
          evidence: [],
        }
      },
      // The diagnosis is complete and honest; it simply names ground no rule covers.
      diagnose: () => ({ ...DIAGNOSIS, affectedBoundary: 'packages/billing/src/charge.ts' }),
      repairEvidence: () => REPAIRED,
      task: taskFor, ...CONFORMS,
    })

    expect(outcome.state).toBe('blocked')
    expect(outcome.summary).toContain('security:boundary-not-allowed')
    expect(repairs).toEqual([])
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
      capabilities: { delivery: DELIVERY },
    })
    const starts: string[] = []
    executors.register(provider('builder', async (request) => {
      starts.push(request.route.permissionMode)
      return passing('builder')
    }))

    const outcome = await runner.run({
      objective: { ...OBJECTIVE, risk: 'high' },
      interpret: interpretAllPass,
      task: taskFor, ...CONFORMS,
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
      capabilities: { delivery: DELIVERY },
    })
    executors.register(provider('builder', async () => passing('builder')))

    const outcome = await runner.run({
      objective: { ...OBJECTIVE, risk: 'medium' },
      interpret: interpretAllPass,
      task: taskFor, ...CONFORMS,
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
      capabilities: { delivery: DELIVERY },
    })
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('spare', async () => passing('spare')))

    const outcome = await runner.run({
      objective: { ...OBJECTIVE, risk: 'high' },
      interpret: interpretAllPass,
      task: taskFor, ...CONFORMS,
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
      capabilities: { delivery: DELIVERY },
    })
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('spare', async () => passing('spare')))

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })

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
      capabilities: { delivery: DELIVERY },
    })
    executors.register(provider('builder', async () => passing('builder')))

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })

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
    const runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY } })
    executors.register(provider('builder', async () => passing('builder')))

    const outcome = await runner.run({
      objective: OBJECTIVE,
      plan: () => [{ stageId: 'repair-1', role: 'repair' }],
      interpret: interpretAllPass,
      task: taskFor, ...CONFORMS,
    })

    expect(outcome.state).toBe('blocked')
    expect(outcome.summary).toContain('no confirmed defect')
  })
})

describe('an executor that stops serving mid-run', () => {
  let session: Session
  let executors: HarnessExecutorRuntime
  let journal: WorkflowJournal
  let runner: WorkflowRunner

  beforeEach(() => {
    session = Session.create(SessionId('s'))
    executors = createExecutorRuntime()
    journal = new WorkflowJournal(session, 'wf-1', async () => true)
    runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY } })
  })

  function failing(name: string, category: string, availability: boolean, seen: string[]): ExecutorProvider {
    return provider(name, async () => {
      seen.push(name)
      return { status: 'error', output: '', failure: { category, availability, safeDiagnostic: `${name} declined` } }
    })
  }

  it('moves the stage to another product when the first one cannot serve', async () => {
    const seen: string[] = []
    executors.register(failing('builder', 'usage-limit-exceeded', true, seen))
    executors.register(provider('reviewer', async () => passing('reviewer')))
    executors.register(provider('spare', async () => { seen.push('spare'); return passing('spare') }))

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })

    expect(outcome.state).toBe('completed')
    expect(seen).toContain('spare')
    // The reroute is a real start against a real product, so the budget sees it:
    // two executor stages, three starts.
    expect(outcome.executorStarts).toBeGreaterThan(2)
    const events = JSON.stringify(session.events)
    expect(events).toContain('harness/route-fallback')
    expect(events).toContain('usage-limit-exceeded')
    expect(projectWorkflow(session.events, 'wf-1').circuits['builder']).toBe('DEGRADED')
  })

  it('does not ask a second product the same question after a wrong answer', async () => {
    const seen: string[] = []
    executors.register(failing('builder', 'bad-request', false, seen))
    executors.register(provider('reviewer', async () => passing('reviewer')))
    executors.register(provider('spare', async () => { seen.push('spare'); return passing('spare') }))

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })

    // A quality failure is an answer, not an outage. Rerouting it would record a
    // second opinion as a recovery, so the run ends on what the first one said.
    expect(seen).toEqual(['builder'])
    expect(outcome.state).not.toBe('completed')
    expect(JSON.stringify(session.events)).not.toContain('harness/route-fallback')
  })

  it('counts every reroute against the start budget the run was given', async () => {
    const seen: string[] = []
    executors.register(failing('builder', 'server-overloaded', true, seen))
    executors.register(failing('spare', 'server-overloaded', true, seen))

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })

    expect(seen).toEqual(['builder', 'spare'])
    expect(outcome.executorStarts).toBe(2)
    expect(outcome.state).toBe('blocked')
  })
})

describe('a human route override', () => {
  let session: Session
  let executors: HarnessExecutorRuntime
  let journal: WorkflowJournal
  let runner: WorkflowRunner
  let seen: { executor: string; permissionMode: string; model: string }[]

  beforeEach(() => {
    session = Session.create(SessionId('s'))
    executors = createExecutorRuntime()
    journal = new WorkflowJournal(session, 'wf-1', async () => true)
    runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY } })
    seen = []
    for (const name of ['builder', 'reviewer', 'spare']) {
      executors.register(provider(name, async (request) => {
        seen.push({
          executor: name,
          permissionMode: request.route.permissionMode,
          model: request.route.model ?? '',
        })
        return passing(name)
      }))
    }
  })

  const twoReviews = () => [
    { stageId: 'implement-1', role: 'implement' as const },
    { stageId: 'review-1', role: 'review' as const },
    { stageId: 'review-2', role: 'review' as const },
  ]

  it('is spent on the first stage of its role and not the next one', async () => {
    const outcome = await runner.run({
      objective: OBJECTIVE,
      interpret: interpretAllPass,
      task: taskFor,
      ...CONFORMS,
      plan: twoReviews,
      routeOverride: { role: 'review', executor: 'spare', semanticModelTier: 'implementation' },
    })

    expect(outcome.state).toBe('completed')
    // A person overrode one review, not the role. The second one is routed by
    // the table exactly as it would have been had nobody asked.
    expect(seen.map(start => start.executor)).toEqual(['builder', 'spare', 'reviewer'])
    const routes = projectWorkflow(session.events, 'wf-1').routes
    expect(routes[1]?.reasonCodes).toContain('override:user')
    expect(routes[2]?.reasonCodes).not.toContain('override:user')
  })

  it('does not reach a stage of another role', async () => {
    await runner.run({
      objective: OBJECTIVE,
      interpret: interpretAllPass,
      task: taskFor,
      ...CONFORMS,
      plan: twoReviews,
      routeOverride: { role: 'qa', executor: 'spare', semanticModelTier: 'implementation' },
    })

    expect(seen.map(start => start.executor)).toEqual(['builder', 'reviewer', 'reviewer'])
  })

  it('cannot buy a review a writable working tree', async () => {
    await runner.run({
      objective: OBJECTIVE,
      interpret: interpretAllPass,
      task: taskFor,
      ...CONFORMS,
      plan: twoReviews,
      routeOverride: { role: 'review', executor: 'builder', semanticModelTier: 'implementation' },
    })

    // The override says which product reads the work. What a reading stage is
    // allowed to do to the tree is not a routing question, and no override
    // reaches it: a review that could write would be certifying its own edits.
    const overridden = seen[1]
    expect(overridden?.executor).toBe('builder')
    expect(overridden?.model).toBe('mimo-v2.5')
    expect(overridden?.permissionMode).toBe('read-only')
  })
})

describe('the durable barrier in front of a dispatch', () => {
  it('does not start a provider until the start fact has reached the log', async () => {
    const session = Session.create(SessionId('barrier'))
    const executors = createExecutorRuntime()
    let release = (): void => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let flushes = 0
    const journal = new WorkflowJournal(session, 'wf-barrier', async () => {
      flushes += 1
      if (flushes === 1) await held
      return true
    })
    const runner = new WorkflowRunner('wf-barrier', {
      profile: PROFILE, policy: POLICY, executors, journal,
      capabilities: { delivery: DELIVERY },
    })
    const starts: string[] = []
    executors.register(provider('builder', async () => {
      starts.push('builder')
      return passing('builder')
    }))
    executors.register(provider('reviewer', async () => {
      starts.push('reviewer')
      return passing('reviewer')
    }))

    const running = runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve()

    // The implementing stage is the one that may rewrite the working tree. Its
    // authority is on disk before the process holding that authority exists,
    // so a restart that finds it open knows what it was allowed to do.
    expect(starts).toEqual([])
    release()
    const outcome = await running
    expect(starts[0]).toBe('builder')
    expect(outcome.state).toBe('completed')
  })

  it('mutates nothing when the log cannot be made durable', async () => {
    const session = Session.create(SessionId('barrier-failed'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-barrier-failed', async () => false)
    const runner = new WorkflowRunner('wf-barrier-failed', {
      profile: PROFILE, policy: POLICY, executors, journal,
      capabilities: { delivery: DELIVERY },
    })
    const starts: string[] = []
    executors.register(provider('builder', async () => {
      starts.push('builder')
      return passing('builder')
    }))

    // A checkpoint that did not happen stops the run. Downgrading it to a
    // warning would let an implementation stage rewrite a tree with no durable
    // record that it was ever authorised to.
    await expect(runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS }))
      .rejects.toThrow(/durable checkpoint/)
    expect(starts).toEqual([])
  })

  it('holds a read-only stage to the same barrier as a mutating one', async () => {
    const session = Session.create(SessionId('barrier-read'))
    const executors = createExecutorRuntime()
    let flushes = 0
    const journal = new WorkflowJournal(session, 'wf-barrier-read', async () => {
      flushes += 1
      // Passes the implementing stage, refuses the verifying one.
      return flushes < 2
    })
    const runner = new WorkflowRunner('wf-barrier-read', {
      profile: PROFILE, policy: POLICY, executors, journal,
      capabilities: { delivery: DELIVERY },
    })
    const starts: string[] = []
    executors.register(provider('builder', async () => {
      starts.push('builder')
      return passing('builder')
    }))
    executors.register(provider('reviewer', async () => {
      starts.push('reviewer')
      return passing('reviewer')
    }))

    // One rule for every start. A barrier that read the role first would make
    // the role classification itself a durability decision, and a stage
    // misclassified once would dispatch unrecorded forever after.
    await expect(runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS }))
      .rejects.toThrow(/durable checkpoint/)
    expect(starts).toEqual(['builder'])
  })
})

describe('who is allowed to publish the work', () => {
  let session: Session
  let executors: HarnessExecutorRuntime
  let journal: WorkflowJournal

  beforeEach(() => {
    session = Session.create(SessionId('s'))
    executors = createExecutorRuntime()
    journal = new WorkflowJournal(session, 'wf-1', async () => true)
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))
  })

  it('asks the capability once and asks no executor to deliver anything', async () => {
    const delivered: string[] = []
    const runner = new WorkflowRunner('wf-1', {
      profile: PROFILE, policy: POLICY, executors, journal,
      capabilities: { delivery: deliveryStub(delivered) },
    })

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })

    expect(outcome.state).toBe('completed')
    expect(delivered).toEqual(['delivery-1'])
    // Nothing named delivery was ever put to a model.
    for (const route of projectWorkflow(session.events, 'wf-1').routes) {
      expect(route.role).not.toBe('delivery')
    }
  })

  it('blocks a lifecycle that must publish when nothing was composed to publish with', async () => {
    const runner = new WorkflowRunner('wf-1', { profile: PROFILE, policy: POLICY, executors, journal })

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })

    expect(outcome.state).toBe('blocked')
    expect(outcome.summary).toContain('no delivery capability')
    // No substitute was reached for: the run stops rather than handing the
    // remote to whatever executor happened to be routable.
    expect(projectWorkflow(session.events, 'wf-1').openCapabilities).toEqual([])
    expect(JSON.stringify(session.events)).not.toContain('github-delivery')
  })

  it('fails the run when the capability reports it did not publish', async () => {
    const runner = new WorkflowRunner('wf-1', {
      profile: PROFILE, policy: POLICY, executors, journal,
      capabilities: {
        delivery: {
          deliver: async () => ({ delivered: false, summary: 'the branch was rejected by the remote', evidence: [], findings: [] }),
        },
      },
    })

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })

    expect(outcome.state).toBe('failed')
    expect(outcome.verdict).toBe('FAIL')
    expect(projectWorkflow(session.events, 'wf-1').openCapabilities).toEqual([])
  })

  it('closes the capability window even when the capability throws', async () => {
    const runner = new WorkflowRunner('wf-1', {
      profile: PROFILE, policy: POLICY, executors, journal,
      capabilities: {
        delivery: {
          deliver: async () => { throw new Error('the pull request could not be opened') },
        },
      },
    })

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })

    expect(outcome.state).toBe('failed')
    expect(projectWorkflow(session.events, 'wf-1').openCapabilities).toEqual([])
  })

  it('spends no executor-start budget on publishing', async () => {
    const runner = new WorkflowRunner('wf-1', {
      profile: PROFILE, policy: POLICY, executors, journal,
      capabilities: { delivery: DELIVERY },
    })

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })

    expect(outcome.stages).toHaveLength(6)
    // Implement, verify, review and the final verify. The budget bounds how
    // often a model is asked, and a bounded command sequence is not one of
    // those times.
    expect(outcome.executorStarts).toBe(5)
  })
})

describe('a run that changes a database', () => {
  let session: Session
  let executors: HarnessExecutorRuntime
  let journal: WorkflowJournal
  const CHANGE = { required: true, migrationPaths: ['supabase/migrations/0001_thing.sql'] } as const

  beforeEach(() => {
    session = Session.create(SessionId('s'))
    executors = createExecutorRuntime()
    journal = new WorkflowJournal(session, 'wf-1', async () => true)
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))
  })

  /**
   * A runner with a scripted database verifier.
   * @param databaseVerification - the verification capability, if any.
   * @param delivered - where delivery stage ids are recorded.
   * @returns the runner.
   */
  function runnerWith(
    databaseVerification: DatabaseVerificationCapabilityPort | undefined,
    delivered: string[],
  ): WorkflowRunner {
    return new WorkflowRunner('wf-1', {
      profile: PROFILE, policy: POLICY, executors, journal,
      capabilities: {
        delivery: deliveryStub(delivered),
        ...databaseVerification === undefined ? {} : { databaseVerification },
      },
    })
  }

  it('blocks before publishing when no database verifier was composed', async () => {
    const delivered: string[] = []
    const outcome = await runnerWith(undefined, delivered).run({
      objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS, databaseChange: CHANGE,
    })

    expect(outcome.state).toBe('blocked')
    expect(outcome.summary).toContain('no database verification capability')
    expect(delivered).toEqual([])
    // Nothing stood in for it: no executor was asked to touch a database.
    expect(JSON.stringify(session.events)).not.toContain('supabase')
  })

  it('never publishes a schema change whose migrations did not survive the preview', async () => {
    const delivered: string[] = []
    const outcome = await runnerWith({
      verify: async () => ({
        status: 'FAILED',
        summary: 'the lint gate failed on the preview branch',
        evidence: [],
        findings: [],
      }),
    }, delivered).run({
      objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS, databaseChange: CHANGE,
    })

    expect(outcome.state).toBe('failed')
    expect(outcome.verdict).toBe('FAIL')
    expect(delivered).toEqual([])
    expect(projectWorkflow(session.events, 'wf-1').openCapabilities).toEqual([])
  })

  it('blocks rather than fails when the preview could not be reached at all', async () => {
    const delivered: string[] = []
    const outcome = await runnerWith({
      verify: async () => ({
        status: 'BLOCKED',
        summary: 'no preview branch could be created for this run',
        evidence: [],
        findings: [],
      }),
    }, delivered).run({
      objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS, databaseChange: CHANGE,
    })

    expect(outcome.state).toBe('blocked')
    expect(delivered).toEqual([])
  })

  it('verifies the schema after the work is read and before the branch is published', async () => {
    const order: string[] = []
    const delivered: string[] = []
    executors = createExecutorRuntime()
    executors.register(provider('builder', async () => { order.push('implement'); return passing('builder') }))
    executors.register(provider('reviewer', async () => { order.push('verify'); return passing('reviewer') }))
    const runner = runnerWith({
      verify: async () => {
        order.push('database-verification')
        return { status: 'PASSED', summary: 'the migrations applied and every gate passed', evidence: [], findings: [] }
      },
    }, delivered)

    const outcome = await runner.run({
      objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS, databaseChange: CHANGE,
    })

    expect(outcome.state).toBe('completed')
    expect(order.slice(0, 3)).toEqual(['implement', 'verify', 'database-verification'])
    expect(delivered).toEqual(['delivery-1'])
    expect(outcome.stages.map(stage => stage.stageId)).toContain('delivery-1-database')
    // A bounded command sequence, so the budget that counts questions to models
    // is untouched by it.
    expect(outcome.executorStarts).toBe(5)
  })

  it('leaves a run that changes no database alone', async () => {
    const delivered: string[] = []
    let asked = 0
    const outcome = await runnerWith({
      verify: async () => {
        asked += 1
        return { status: 'PASSED', summary: 'never reached', evidence: [], findings: [] }
      },
    }, delivered).run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })

    expect(outcome.state).toBe('completed')
    expect(asked).toBe(0)
    expect(delivered).toEqual(['delivery-1'])
  })

  // The journalled name is what a status poll and a restart assessment later
  // repeat. A project-supplied verifier recorded under the name of the built-in
  // Supabase strategy would be a fact about a run that never happened.
  it('journals the verification under a product-neutral capability name', async () => {
    const delivered: string[] = []
    await runnerWith({
      verify: async () => ({
        status: 'PASSED', summary: 'the migrations applied and every gate passed', evidence: [], findings: [],
      }),
    }, delivered).run({
      objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS, databaseChange: CHANGE,
    })

    const names = session.events
      .filter(event => event.type === 'harness/capability-start' || event.type === 'harness/capability-end')
      .map(event => (event.data as unknown as { capability: string }).capability)

    expect(names.length).toBeGreaterThan(0)
    expect(names).toContain('database-verification')
    expect(names).not.toContain('supabase-preview')
  })
})

describe('splitting a pull-request run at delivery', () => {
  /** A profile whose paths mean something and whose surfaces cost something. */
  const IMPACT_PROFILE: HarnessProfile = Object.freeze({
    ...PROFILE,
    qaPolicy: Object.freeze({
      rules: Object.freeze([
        Object.freeze({ id: 'auth', when: Object.freeze({ surface: 'auth' }), use: Object.freeze({ evidence: 'security-review', independentReview: true, risk: 'critical' }) }),
        Object.freeze({ id: 'ui', when: Object.freeze({ surface: 'ui' }), use: Object.freeze({ evidence: 'visual-regression', independentReview: true, risk: 'medium' }) }),
      ]),
    }),
    securityPolicy: Object.freeze({
      ...PROFILE.securityPolicy,
      rules: Object.freeze([
        Object.freeze({ id: 'auth-flow', when: Object.freeze({ surface: 'auth' }), use: Object.freeze({ review: 'security', independence: 'cross-executor-required', blocking: true }) }),
      ]),
    }),
    changeImpactPolicy: Object.freeze({
      rules: Object.freeze([
        Object.freeze({ id: 'auth', paths: Object.freeze(['src/auth/**']), use: Object.freeze({ surface: 'auth', riskFloor: 'critical' }) }),
        Object.freeze({ id: 'ui', paths: Object.freeze(['src/ui/**']), use: Object.freeze({ surface: 'ui', riskFloor: 'medium' }) }),
      ]),
      writeVolume: Object.freeze({ smallMaxFiles: 3, mediumMaxFiles: 12 }),
    }),
  })

  /** A reader that answers with `planned` before the work and `actual` after. */
  function reader(planned: readonly string[], actual: readonly string[]): {
    plannedPaths: () => Promise<readonly string[]>
    actualPaths: () => Promise<readonly string[]>
  } {
    return { plannedPaths: async () => planned, actualPaths: async () => actual }
  }

  /** Run one objective to completion and hand back the roles it ran, in order. */
  async function rolesFor(
    changeImpact: ReturnType<typeof reader>,
    objective: WorkflowObjective = OBJECTIVE,
  ): Promise<readonly string[]> {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    const runner = new WorkflowRunner('wf-1', {
      profile: IMPACT_PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY },
    })
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))

    const outcome = await runner.run({
      objective, interpret: interpretAllPass, task: taskFor, changeImpact, ...CONFORMS,
    })
    expect(outcome.state).toBe('completed')
    return outcome.stages.map(stage => stage.role)
  }

  it('certifies against what was delivered, not against the risk it was opened at', async () => {
    // A low-risk objective that turned out to touch auth is an auth change. The
    // caller's own word about its risk is the one thing that cannot settle this.
    const roles = await rolesFor(reader([], ['src/auth/session.ts']))

    expect(roles).toStrictEqual([
      'implement', 'verify', 'delivery', 'review', 'qa', 'security', 'conformance', 'verify',
    ])
  })

  it('buys the QA a surface asks for without buying a security reading nobody asked for', async () => {
    const roles = await rolesFor(reader([], ['src/ui/button.tsx']))

    expect(roles).toStrictEqual(['implement', 'verify', 'delivery', 'review', 'qa', 'conformance', 'verify'])
  })

  it('still reads and verifies a change no rule spoke about', async () => {
    const roles = await rolesFor(reader(['docs/readme.md'], ['docs/readme.md']))

    expect(roles).toStrictEqual(['implement', 'verify', 'delivery', 'review', 'conformance', 'verify'])
  })

  it('keeps what the approved plan already bought when the diff no longer shows it', async () => {
    // The planned reading is part of the effective impact for the whole run. A
    // delivery that ended up not touching the auth file it was approved to
    // touch does not get to hand back the security reading that bought.
    const roles = await rolesFor(reader(['src/auth/session.ts'], ['src/ui/button.tsx']))

    expect(roles).toContain('security')
  })

  it('reads the delivered change set only after the branch is published', async () => {
    const seen: string[] = []
    const changeImpact = {
      plannedPaths: async (): Promise<readonly string[]> => { seen.push('planned'); return [] },
      actualPaths: async (): Promise<readonly string[]> => { seen.push('actual'); return ['src/ui/x.tsx'] },
    }
    await rolesFor(changeImpact)

    expect(seen).toStrictEqual(['planned', 'actual'])
  })

  it('stops rather than certifying a change it could not measure', async () => {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    const runner = new WorkflowRunner('wf-1', {
      profile: IMPACT_PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY },
    })
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))

    const outcome = await runner.run({
      objective: OBJECTIVE,
      interpret: interpretAllPass,
      task: taskFor,
      changeImpact: {
        plannedPaths: async () => [],
        actualPaths: async () => { throw new Error('git said no') },
      },
      ...CONFORMS,
    })

    expect(outcome.state).toBe('blocked')
    // The reader's own text can name a path or a provider payload, and this
    // summary reaches the journal.
    expect(outcome.summary).not.toContain('git said no')
  })

  it('runs the fixed plan when the deployment supplied no reader', async () => {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    const runner = new WorkflowRunner('wf-1', {
      profile: IMPACT_PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY },
    })
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })

    expect(outcome.stages.map(stage => stage.role)).toStrictEqual(planStages(OBJECTIVE).map(stage => stage.role))
  })
})

describe('routing a stage as what the change turned out to be', () => {
  /** A table with rows only an impact-derived fact can reach. */
  const IMPACT_POLICY: RoutingPolicy = Object.freeze({
    ...POLICY,
    rules: Object.freeze([
      Object.freeze({ id: 'large-write-implementation', when: Object.freeze({ role: 'implement', writeVolume: 'large' }), use: Object.freeze({ executor: 'workhorse', tier: 'implementation' }) }),
      Object.freeze({ id: 'auth-implementation', when: Object.freeze({ role: 'implement', taskClass: 'auth-change' }), use: Object.freeze({ executor: 'auditor', tier: 'implementation' }) }),
      ...POLICY.rules,
    ]),
  })

  const ROUTED_PROFILE: HarnessProfile = Object.freeze({
    ...PROFILE,
    routingPolicy: Object.freeze({ rules: IMPACT_POLICY.rules, fallbackRules: IMPACT_POLICY.fallbackRules }),
    changeImpactPolicy: Object.freeze({
      rules: Object.freeze([
        Object.freeze({ id: 'auth', paths: Object.freeze(['src/auth/**']), use: Object.freeze({ surface: 'auth', taskClass: 'auth-change', riskFloor: 'critical' }) }),
        Object.freeze({ id: 'bulk', paths: Object.freeze(['src/bulk/**']), use: Object.freeze({ surface: 'bulk' }) }),
      ]),
      writeVolume: Object.freeze({ smallMaxFiles: 3, mediumMaxFiles: 12 }),
    }),
  })

  /** The routes the run recorded, in the order they were taken. */
  async function routesFor(planned: readonly string[]): Promise<readonly { role: string; executor: string }[]> {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    const runner = new WorkflowRunner('wf-1', {
      profile: ROUTED_PROFILE, policy: IMPACT_POLICY, executors, journal, capabilities: { delivery: DELIVERY },
    })
    for (const name of ['builder', 'reviewer', 'workhorse', 'auditor']) {
      executors.register(provider(name, async () => passing(name)))
    }

    await runner.run({
      objective: OBJECTIVE,
      interpret: interpretAllPass,
      task: taskFor,
      changeImpact: { plannedPaths: async () => planned, actualPaths: async () => planned },
      ...CONFORMS,
    })
    return projectWorkflow(session.events, 'wf-1').routes.map(route => ({ role: route.role, executor: route.executor }))
  }

  it('routes the implementation on the class the paths named', async () => {
    const routes = await routesFor(['src/auth/session.ts'])

    expect(routes.find(route => route.role === 'implement')?.executor).toBe('auditor')
  })

  it('routes a large write on the volume the change actually has', async () => {
    const paths = Array.from({ length: 13 }, (_, index) => `src/bulk/file-${index}.ts`)
    const routes = await routesFor(paths)

    expect(routes.find(route => route.role === 'implement')?.executor).toBe('workhorse')
  })

  it('leaves a change no rule spoke about on the table it always used', async () => {
    const routes = await routesFor(['docs/readme.md'])

    expect(routes.find(route => route.role === 'implement')?.executor).toBe('builder')
  })
})

describe('a database change nobody declared', () => {
  /** A profile whose migration paths mean what they say. */
  const DB_PROFILE: HarnessProfile = Object.freeze({
    ...PROFILE,
    changeImpactPolicy: Object.freeze({
      rules: Object.freeze([
        Object.freeze({
          id: 'database-migrations',
          paths: Object.freeze(['supabase/migrations/**']),
          use: Object.freeze({
            surface: 'database',
            riskFloor: 'critical',
            requiredCapability: 'database-verification',
            evidenceProfile: 'db-standard',
            databaseMutation: true,
          }),
        }),
      ]),
      writeVolume: Object.freeze({ smallMaxFiles: 3, mediumMaxFiles: 12 }),
    }),
  })

  const MIGRATION = 'supabase/migrations/20260828090000_example.sql'

  /** A run whose planned paths include a migration and which declares nothing. */
  async function runUndeclared(options: {
    databaseVerification?: DatabaseVerificationCapabilityPort
    delivered?: string[]
  } = {}): Promise<WorkflowOutcome> {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))
    const runner = new WorkflowRunner('wf-1', {
      profile: DB_PROFILE, policy: POLICY, executors, journal,
      capabilities: {
        delivery: deliveryStub(options.delivered ?? []),
        ...options.databaseVerification === undefined
          ? {}
          : { databaseVerification: options.databaseVerification },
      },
    })

    return await runner.run({
      objective: OBJECTIVE,
      interpret: interpretAllPass,
      task: taskFor,
      changeImpact: { plannedPaths: async () => [MIGRATION], actualPaths: async () => [MIGRATION] },
      ...CONFORMS,
    })
  }

  it('blocks before publishing a classified migration with no verifier composed', async () => {
    // The caller said nothing about a database. The paths did, and the paths
    // are the half of this that cannot be talked out of what it found.
    const delivered: string[] = []
    const outcome = await runUndeclared({ delivered })

    expect(outcome.state).toBe('blocked')
    expect(outcome.summary).toContain('no database verification capability')
    expect(delivered).toEqual([])
  })

  it('runs the deterministic verifier before a classified migration is published', async () => {
    const delivered: string[] = []
    const order: string[] = []
    const outcome = await runUndeclared({
      delivered,
      databaseVerification: {
        verify: async () => {
          order.push('verify')
          return {
            status: 'PASSED', summary: 'the schema applied and the gates passed', evidence: [], findings: [],
          }
        },
      },
    })

    expect(outcome.state).toBe('completed')
    expect(order).toStrictEqual(['verify'])
    expect(delivered).toHaveLength(1)
  })
})

describe('what evidence a certifying stage is told to produce', () => {
  const EVIDENCE_PROFILE: HarnessProfile = Object.freeze({
    ...PROFILE,
    qaPolicy: Object.freeze({
      rules: Object.freeze([
        Object.freeze({ id: 'ui', when: Object.freeze({ surface: 'ui' }), use: Object.freeze({ evidence: 'visual-regression', independentReview: true, risk: 'medium' }) }),
      ]),
    }),
    changeImpactPolicy: Object.freeze({
      rules: Object.freeze([
        Object.freeze({ id: 'ui', paths: Object.freeze(['src/ui/**']), use: Object.freeze({ surface: 'ui', evidenceProfile: 'ui-standard', riskFloor: 'medium' }) }),
        Object.freeze({ id: 'auth', paths: Object.freeze(['src/auth/**']), use: Object.freeze({ surface: 'auth', evidenceProfile: 'auth-standard', riskFloor: 'critical' }) }),
      ]),
      writeVolume: Object.freeze({ smallMaxFiles: 3, mediumMaxFiles: 12 }),
    }),
  })

  /** The stage specs the run handed to the task builder, by role. */
  async function stageSpecsFor(paths: readonly string[]): Promise<Map<string, StageSpec>> {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))
    const runner = new WorkflowRunner('wf-1', {
      profile: EVIDENCE_PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY },
    })
    const seen = new Map<string, StageSpec>()

    await runner.run({
      objective: OBJECTIVE,
      interpret: interpretAllPass,
      task: (stage, objective) => { seen.set(stage.role, stage); return taskFor(stage, objective) },
      changeImpact: { plannedPaths: async () => paths, actualPaths: async () => paths },
      ...CONFORMS,
    })
    return seen
  }

  it('tells the QA stage which evidence profile the change owes', async () => {
    const specs = await stageSpecsFor(['src/ui/button.tsx'])

    expect(specs.get('qa')?.requiredEvidenceProfiles).toContain('ui-standard')
    expect(specs.get('qa')?.requiredEvidenceProfiles).toContain('visual-regression')
  })

  it('carries an auth change onto every stage that certifies it', async () => {
    const specs = await stageSpecsFor(['src/auth/session.ts'])

    for (const role of ['review', 'qa', 'security', 'conformance']) {
      expect(specs.get(role)?.requiredEvidenceProfiles, role).toContain('auth-standard')
    }
  })

  it('tells an implementation stage nothing about evidence it does not owe', async () => {
    // The bar is a fact about certifying the change, not about producing it.
    const specs = await stageSpecsFor(['src/ui/button.tsx'])

    expect(specs.get('implement')?.requiredEvidenceProfiles).toBeUndefined()
  })

  it('hands back a list a stage cannot edit', async () => {
    const specs = await stageSpecsFor(['src/auth/session.ts'])

    expect(Object.isFrozen(specs.get('qa')?.requiredEvidenceProfiles)).toBe(true)
  })
})

describe('recertifying what a repair turned the change into', () => {
  const DRIFT_PROFILE: HarnessProfile = Object.freeze({
    ...PROFILE,
    qaPolicy: Object.freeze({
      rules: Object.freeze([
        Object.freeze({ id: 'auth', when: Object.freeze({ surface: 'auth' }), use: Object.freeze({ evidence: 'security-review', independentReview: true, risk: 'critical' }) }),
        Object.freeze({ id: 'ui', when: Object.freeze({ surface: 'ui' }), use: Object.freeze({ evidence: 'visual-regression', independentReview: true, risk: 'medium' }) }),
      ]),
    }),
    securityPolicy: Object.freeze({
      ...PROFILE.securityPolicy,
      rules: Object.freeze([
        Object.freeze({ id: 'auth-flow', when: Object.freeze({ surface: 'auth' }), use: Object.freeze({ review: 'security', independence: 'cross-executor-required', blocking: true }) }),
      ]),
    }),
    changeImpactPolicy: Object.freeze({
      rules: Object.freeze([
        Object.freeze({ id: 'auth', paths: Object.freeze(['src/lib/auth/**']), use: Object.freeze({ surface: 'auth', riskFloor: 'critical' }) }),
        Object.freeze({ id: 'ui', paths: Object.freeze(['src/ui/**']), use: Object.freeze({ surface: 'ui', riskFloor: 'medium' }) }),
      ]),
      writeVolume: Object.freeze({ smallMaxFiles: 3, mediumMaxFiles: 12 }),
    }),
  })

  const UI = 'src/ui/cart-total.tsx'
  const AUTH = 'src/lib/auth/access-decision.ts'

  /** A reader whose actual answer changes between deliveries. */
  function drifting(planned: readonly string[], ...actual: readonly (readonly string[])[]): {
    plannedPaths: () => Promise<readonly string[]>
    actualPaths: () => Promise<readonly string[]>
  } {
    let call = 0
    return {
      plannedPaths: async () => planned,
      actualPaths: async () => {
        const answer = actual[Math.min(call, actual.length - 1)] as readonly string[]
        call += 1
        return answer
      },
    }
  }

  /**
   * Run one objective whose QA fails exactly once, and report what ran.
   *
   * @param changeImpact - the reader the run classifies itself from.
   * @param manifests - collects the manifest each conformance reading was given.
   * @returns the outcome, so a test can read the stages off it.
   */
  async function runWithOneQaDefect(
    changeImpact: ReturnType<typeof drifting>,
    manifests: ConformanceManifest[] = [],
  ): Promise<WorkflowOutcome> {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    const runner = new WorkflowRunner('wf-1', {
      profile: DRIFT_PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY },
    })
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))
    let qaRuns = 0

    return await runner.run({
      objective: OBJECTIVE,
      interpret: (stage, executor) => {
        if (stage.role !== 'qa') return interpretAllPass(stage, executor)
        qaRuns += 1
        return qaRuns > 1
          ? interpretAllPass(stage, executor)
          : { role: stage.role, executor, verdict: 'FAIL', summary: 'red', findings: [bug('f-1')], evidence: [] }
      },
      diagnose: () => DIAGNOSIS,
      repairEvidence: () => REPAIRED,
      task: taskFor,
      changeImpact,
      loadApprovedArtifacts: CONFORMS.loadApprovedArtifacts,
      conformance: (stage, executor, result, manifest) => {
        manifests.push(manifest)
        return CONFORMS.conformance(stage, executor, result, manifest)
      },
    })
  }

  it('recertifies a repair that quietly widened the change into auth', async () => {
    // The first pass was a medium UI change and bought QA. The repair reached
    // into an access decision, and the branch a person would now review is a
    // critical auth change — so the second pass has to buy what that costs,
    // rather than finishing the plan the smaller change had been given.
    const outcome = await runWithOneQaDefect(drifting([UI], [UI], [UI, AUTH]))

    expect(outcome.state).toBe('completed')
    const after = outcome.stages.map(stage => stage.role).slice(outcome.stages.findLastIndex(s => s.role === 'delivery'))
    expect(after).toContain('security')
    expect(after).toContain('review')
    expect(after).toContain('conformance')
  })

  it('never buys less on the second pass than the first pass already bought', async () => {
    // The repair took the access decision back out. What the branch touched at
    // any point in this run is still what a person is being asked to trust, and
    // a security reading that was owed is not unowed by a later, smaller diff.
    const outcome = await runWithOneQaDefect(drifting([UI], [UI, AUTH], [UI]))

    expect(outcome.state).toBe('completed')
    const after = outcome.stages.map(stage => stage.role).slice(outcome.stages.findLastIndex(s => s.role === 'delivery'))
    expect(after).toContain('security')
  })

  it('hands conformance the paths the delivery touched that the Plan never approved', async () => {
    const manifests: ConformanceManifest[] = []
    await runWithOneQaDefect(drifting([UI], [UI, AUTH]), manifests)

    // Normalized, relative, and reported rather than judged: whether a third
    // file breaks a Plan obligation is conformance's call, not the classifier's.
    expect(manifests.at(-1)?.unplannedPaths).toStrictEqual([AUTH])
  })

  it('tells conformance nothing drifted when the delivery stayed inside the Plan', async () => {
    const manifests: ConformanceManifest[] = []
    await runWithOneQaDefect(drifting([UI], [UI]), manifests)

    expect(manifests.at(-1)?.unplannedPaths).toStrictEqual([])
  })
})

describe('when the run writes down what it thinks the change is', () => {
  /** The harness event types one classified run appended, in order. */
  async function eventOrder(): Promise<readonly string[]> {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))
    const runner = new WorkflowRunner('wf-1', {
      profile: PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY },
    })

    await runner.run({
      objective: OBJECTIVE,
      interpret: interpretAllPass,
      task: taskFor,
      changeImpact: { plannedPaths: async () => ['src/a.ts'], actualPaths: async () => ['src/a.ts', 'src/b.ts'] },
      ...CONFORMS,
    })
    return session.events.map(event => event.type).filter(type => type.startsWith('harness/'))
  }

  it('records the planned reading before it hands anything a writable tree', async () => {
    // The order is the point. A run that started an implementation and then
    // wrote down what it believed the change was could not say, after a
    // restart, on what authority that tree was ever written to.
    const order = await eventOrder()

    expect(order.indexOf('harness/change-impact')).toBeLessThan(order.indexOf('harness/executor-start'))
  })

  it('records the delivered reading before anything certifies it', async () => {
    const order = await eventOrder()
    const lastImpact = order.lastIndexOf('harness/change-impact')

    expect(lastImpact).toBeGreaterThan(order.indexOf('harness/delivery'))
    expect(order.slice(lastImpact)).toContain('harness/verdict')
  })

  it('carries what it resolved out with the outcome', async () => {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))
    const runner = new WorkflowRunner('wf-1', {
      profile: PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY },
    })

    const outcome = await runner.run({
      objective: OBJECTIVE,
      interpret: interpretAllPass,
      task: taskFor,
      changeImpact: { plannedPaths: async () => ['src/a.ts'], actualPaths: async () => ['src/a.ts', 'src/b.ts'] },
      ...CONFORMS,
    })

    expect(outcome.changeImpact?.source).toBe('actual')
    expect(outcome.changeImpact?.unplannedPaths).toStrictEqual(['src/b.ts'])
  })

  it('leaves a run that classified nothing saying nothing about it', async () => {
    const session = Session.create(SessionId('s'))
    const executors = createExecutorRuntime()
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    executors.register(provider('builder', async () => passing('builder')))
    executors.register(provider('reviewer', async () => passing('reviewer')))
    const runner = new WorkflowRunner('wf-1', {
      profile: PROFILE, policy: POLICY, executors, journal, capabilities: { delivery: DELIVERY },
    })

    const outcome = await runner.run({ objective: OBJECTIVE, interpret: interpretAllPass, task: taskFor, ...CONFORMS })

    expect(outcome.changeImpact).toBeUndefined()
  })
})
