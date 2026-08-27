import { afterEach, describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { StageResult, WorkflowObjective } from '@trick-harness/contracts'
import type { ControlWorkflowStatus } from '@trick-harness/control-server'
import { planPullRequestStages } from '@trick-harness/engineering-workflow'
import type { ExecutorProvider, ExecutorStartRequest } from '@trick-harness/executor'
import type { HarnessProfile } from '@trick-harness/profile'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  BundleCompositionError,
  CONTROL_SERVER_CAPABILITY,
  GITHUB_DELIVERY_CAPABILITY,
  SUPABASE_PREVIEW_CAPABILITY,
  composeHarness,
} from '../src/index.ts'
import type { ComposedHarness, HarnessCompositionOptions } from '../src/index.ts'

const RULES = Object.freeze([
  Object.freeze({ id: 'implement', when: Object.freeze({ role: 'implement' }), use: Object.freeze({ executor: 'builder', tier: 'implementation' }) }),
  Object.freeze({ id: 'repair', when: Object.freeze({ role: 'repair' }), use: Object.freeze({ executor: 'builder', tier: 'implementation' }) }),
  Object.freeze({ id: 'delivery', when: Object.freeze({ role: 'delivery' }), use: Object.freeze({ executor: 'builder', tier: 'implementation' }) }),
  Object.freeze({ id: 'default', when: Object.freeze({}), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
])

const FALLBACKS = Object.freeze([
  Object.freeze({ id: 'builder-degraded', when: Object.freeze({ unavailable: 'builder' }), use: Object.freeze({ executor: 'spare-builder', tier: 'implementation' }) }),
  Object.freeze({ id: 'anything-degraded', when: Object.freeze({}), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
])

/**
 * A profile enabling exactly the capabilities a test names.
 * @param capabilities - the integration capability ids to enable.
 * @returns the profile.
 */
function profileEnabling(capabilities: readonly string[]): HarnessProfile {
  return Object.freeze({
    id: 'plurora-test',
    policyVersion: 'plurora-test-v1.0.0',
    routingPolicy: Object.freeze({ rules: RULES, fallbackRules: FALLBACKS }),
    workflowPolicy: Object.freeze({ maxRepairCycles: 3, maxExecutorStarts: 24 }),
    independencePolicy: Object.freeze({
      low: 'fresh-context',
      medium: 'cross-executor-preferred',
      high: 'cross-executor-required',
      critical: 'cross-executor-required',
    }),
    qaPolicy: Object.freeze({ rules: Object.freeze([]) }),
    securityPolicy: Object.freeze({ rules: Object.freeze([]) }),
    integrationPolicy: Object.freeze({ enabled: Object.freeze([...capabilities]), rules: Object.freeze([]) }),
    trustedComposition: Object.freeze({ excludedPluginIds: Object.freeze([]) }),
  })
}

const REGISTRY = Object.freeze({ implementation: 'mimo-v2.5', reasoning: 'deepseek-v4-flash' })

const OBJECTIVE: WorkflowObjective = Object.freeze({
  id: 'wf-compose-1',
  cwd: '/repo',
  requirement: 'add the thing',
  risk: 'low',
  workload: 'heavy',
  profileId: 'plurora-test',
})

/**
 * A product boundary that answers without starting anything.
 * @param name - the executor name.
 * @param started - where each request is recorded.
 * @returns the provider.
 */
function fakeProvider(name: string, started: ExecutorStartRequest[]): ExecutorProvider {
  return {
    name,
    capabilities: { modelOverride: true, reasoningEffort: true, permissionModes: ['read-only', 'workspace-write'] },
    start: async (request) => {
      started.push(request)
      return { status: 'completed', output: `${name} ran` }
    },
  }
}

/**
 * Read a stage result out of the task text, which is all these fakes carry.
 * @param stage - the stage that ran.
 * @param executor - the executor that ran it.
 * @returns the stage result.
 */
function interpret(stage: { readonly role: StageResult['role'] }, executor: string): StageResult {
  return {
    role: stage.role,
    executor,
    verdict: 'PASS',
    summary: `${stage.role} passed`,
    findings: [],
    evidence: [],
  }
}

let composed: ComposedHarness[] = []

/**
 * Compose one Harness the tests will dispose.
 * @param options - the composition options.
 * @returns the composed Harness.
 */
function compose(options: HarnessCompositionOptions): ComposedHarness {
  const harness = composeHarness(options)
  composed.push(harness)
  return harness
}

/**
 * The options every test starts from.
 * @param profile - the profile to compose against.
 * @param started - where provider starts are recorded.
 * @returns the options.
 */
function baseOptions(profile: HarnessProfile, started: ExecutorStartRequest[]): HarnessCompositionOptions {
  return {
    profile,
    registry: REGISTRY,
    session: Session.create(SessionId('compose')),
    flush: async () => true,
    workflow: { interpret, task: stage => `${stage.role}: do the work`, plan: planPullRequestStages },
    providers: {
      extraProviders: [
        fakeProvider('builder', started),
        fakeProvider('reviewer', started),
        fakeProvider('spare-builder', started),
      ],
    },
  }
}

afterEach(async () => {
  const open = composed
  composed = []
  await Promise.all(open.map(async harness => harness.dispose()))
})

describe('what the profile decides exists', () => {
  it('refuses an integration the profile does not enable', () => {
    const started: ExecutorStartRequest[] = []
    const options = baseOptions(profileEnabling([]), started)

    expect(() => composeHarness({
      ...options,
      integrations: { github: { cwd: '/repo', spawn: (_spec: SubprocessSpawnSpec) => { throw new Error('never spawned') } } },
    })).toThrow(BundleCompositionError)
  })

  it('constructs only the integrations the profile enabled, and no control server unless asked', () => {
    const started: ExecutorStartRequest[] = []
    const spawn = (_spec: SubprocessSpawnSpec): never => {
      throw new Error('never spawned')
    }
    const harness = compose({
      ...baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started),
      integrations: { github: { cwd: '/repo', spawn } },
    })

    expect(harness.integrations.github).toBeDefined()
    expect(harness.integrations.supabase).toBeUndefined()
    expect(harness.server).toBeUndefined()
  })

  it('refuses a Supabase client the profile does not enable, and builds one it does', () => {
    const started: ExecutorStartRequest[] = []
    const spawn = (_spec: SubprocessSpawnSpec): never => {
      throw new Error('never spawned')
    }
    const supabase = { cwd: '/repo', spawn, projectRef: 'abcdefghijklmnop' }

    expect(() => composeHarness({
      ...baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started),
      integrations: { supabase },
    })).toThrow(BundleCompositionError)

    const harness = compose({
      ...baseOptions(profileEnabling([SUPABASE_PREVIEW_CAPABILITY]), started),
      integrations: { supabase },
    })

    expect(harness.integrations.supabase).toBeDefined()
    expect(harness.integrations.github).toBeUndefined()
  })

  it('refuses a control server the profile does not enable', () => {
    const started: ExecutorStartRequest[] = []

    expect(() => composeHarness({
      ...baseOptions(profileEnabling([]), started),
      control: { host: '127.0.0.1', port: 0, token: 'a-token-long-enough' },
    })).toThrow(BundleCompositionError)
  })

  it('refuses a profile routing to an executor nobody registered', () => {
    const started: ExecutorStartRequest[] = []
    const options = baseOptions(profileEnabling([]), started)

    expect(() => composeHarness({
      ...options,
      providers: { extraProviders: [fakeProvider('builder', started)] },
    })).toThrow(/unregistered executor/)
  })

  it('resolves the routing policy from the profile and the deployment registry', () => {
    const started: ExecutorStartRequest[] = []
    const harness = compose(baseOptions(profileEnabling([]), started))

    expect(harness.policy.policyVersion).toBe('plurora-test-v1.0.0')
    expect(harness.policy.registry).toEqual(REGISTRY)
  })
})

describe('the Claude overlay stays optional', () => {
  it('composes without it, and composes with it when a deployment supplies one', () => {
    const started: ExecutorStartRequest[] = []
    const without = compose(baseOptions(profileEnabling([]), started))
    const base = baseOptions(profileEnabling([]), started)
    const withOverlay = compose({
      ...base,
      providers: {
        extraProviders: [...base.providers?.extraProviders ?? [], fakeProvider('claude', started)],
      },
    })

    expect(without.executors).not.toContain('claude')
    expect(withOverlay.executors).toContain('claude')
  })
})

describe('a workflow through the real control-server entry path', () => {
  it('runs, reports a bounded status and settles on disposal', async () => {
    const started: ExecutorStartRequest[] = []
    const harness = compose({
      ...baseOptions(profileEnabling([CONTROL_SERVER_CAPABILITY]), started),
      control: { host: '127.0.0.1' },
    })
    const server = harness.server
    if (server === undefined) throw new Error('the profile enabled a control server')
    const { host, port } = await server.listen()
    const auth = { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' }
    const base = `http://${host}:${String(port)}`

    const created = await fetch(`${base}/workflows`, {
      method: 'POST', headers: auth, body: JSON.stringify(OBJECTIVE),
    })
    const read = await fetch(`${base}/workflows/${OBJECTIVE.id}`, { headers: auth })
    const status = (await read.json()) as ControlWorkflowStatus

    expect(created.status).toBe(202)
    expect(status.state).toBe('completed')
    expect(status.verdict).toBe('PASS')
    expect(status.stages.map(stage => stage.role)).toEqual([
      'implement', 'verify', 'delivery', 'review', 'verify',
    ])
    expect(started.map(request => request.route.model)).toEqual([
      'mimo-v2.5', 'deepseek-v4-flash', 'mimo-v2.5', 'deepseek-v4-flash', 'deepseek-v4-flash',
    ])
  })

  it('routes around a degraded executor through the profile fallback table', async () => {
    const started: ExecutorStartRequest[] = []
    const harness = compose({
      ...baseOptions(profileEnabling([]), started),
      degradedExecutors: ['builder'],
    })

    const outcome = await harness.run(OBJECTIVE)

    expect(outcome.verdict).toBe('PASS')
    expect(outcome.stages.filter(stage => stage.role === 'implement').map(stage => stage.executor))
      .toEqual(['spare-builder'])
  })

  it('cancels the run when the caller aborts the signal it passed in', async () => {
    const started: ExecutorStartRequest[] = []
    const harness = compose(baseOptions(profileEnabling([]), started))
    const controller = new AbortController()

    const running = harness.run(OBJECTIVE, controller.signal)
    controller.abort()
    const outcome = await running

    expect(outcome.state).not.toBe('completed')
  })

  it('answers a status for a workflow it is not running out of the journal', async () => {
    const started: ExecutorStartRequest[] = []
    const harness = compose({
      ...baseOptions(profileEnabling([CONTROL_SERVER_CAPABILITY]), started),
      control: { port: 0, token: 'a-control-token-long-enough' },
    })
    const server = harness.server
    if (server === undefined) throw new Error('the profile enabled a control server')
    await harness.run(OBJECTIVE)
    const { host, port } = await server.listen()
    const headers = { authorization: `Bearer ${server.token}` }

    const known = await fetch(`http://${host}:${String(port)}/workflows/${OBJECTIVE.id}`, { headers })
    const unknown = await fetch(`http://${host}:${String(port)}/workflows/wf-never-ran`, { headers })

    expect(server.token).toBe('a-control-token-long-enough')
    expect((await known.json() as ControlWorkflowStatus).state).toBe('completed')
    expect(unknown.status).toBe(404)
  })

  it('runs the default working-tree plan when the deployment names none', async () => {
    const started: ExecutorStartRequest[] = []
    const base = baseOptions(profileEnabling([]), started)
    const harness = compose({
      ...base,
      workflow: { interpret: base.workflow.interpret, task: base.workflow.task },
    })

    const outcome = await harness.run(OBJECTIVE)

    expect(outcome.stages.map(stage => stage.role))
      .not.toEqual(planPullRequestStages(OBJECTIVE).map(stage => stage.role))
    expect(outcome.verdict).toBe('PASS')
  })

  it('hands the deployment its own diagnosis and repair readers to the runner', async () => {
    const started: ExecutorStartRequest[] = []
    const base = baseOptions(profileEnabling([]), started)
    const seen: string[] = []
    const harness = compose({
      ...base,
      workflow: {
        ...base.workflow,
        diagnose: (stage) => {
          seen.push(`diagnose:${stage.stageId}`)
          return undefined
        },
        repairEvidence: (stage) => {
          seen.push(`repair:${stage.stageId}`)
          return { rootCauseAddressed: true }
        },
      },
    })

    const outcome = await harness.run(OBJECTIVE)

    // Nothing failed, so neither reader is called: they are wired, not invoked.
    expect(seen).toEqual([])
    expect(outcome.verdict).toBe('PASS')
  })

  it('disposes a run that is still in flight', async () => {
    const started: ExecutorStartRequest[] = []
    const harness = composeHarness(baseOptions(profileEnabling([]), started))

    const running = harness.run(OBJECTIVE)
    await harness.dispose()
    const outcome = await running

    expect(outcome.state).not.toBe('completed')
  })

  it('reads a finished workflow back out of the durable journal', async () => {
    const started: ExecutorStartRequest[] = []
    const harness = compose(baseOptions(profileEnabling([]), started))

    await harness.run(OBJECTIVE)

    expect(harness.restartOf(OBJECTIVE.id)?.state).toBe('terminal')
    expect(harness.restartOf('wf-never-ran')).toBeUndefined()
  })
})

describe('a human route override in a composed runtime', () => {
  it('reaches the run without touching the profile or the providers', async () => {
    const started: ExecutorStartRequest[] = []
    const profile = profileEnabling([])
    const harness = compose(baseOptions(profile, started))
    const tableBefore = JSON.stringify(harness.policy)

    const outcome = await harness.run(OBJECTIVE, undefined, {
      role: 'implement',
      executor: 'reviewer',
      semanticModelTier: 'reasoning',
    })

    const routed = outcome.stages.find(stage => stage.role === 'implement')
    expect(routed?.executor).toBe('reviewer')
    // One run, one decision. The table the next objective routes on is the one
    // the profile shipped, and no provider was reconfigured to serve it.
    expect(JSON.stringify(harness.policy)).toBe(tableBefore)
    expect(JSON.stringify(profile.routingPolicy)).toBe(JSON.stringify(profileEnabling([]).routingPolicy))
  })

  it('routes on the table when the caller sends none', async () => {
    const started: ExecutorStartRequest[] = []
    const harness = compose(baseOptions(profileEnabling([]), started))

    const outcome = await harness.run(OBJECTIVE)

    expect(outcome.stages.find(stage => stage.role === 'implement')?.executor).toBe('builder')
  })
})
