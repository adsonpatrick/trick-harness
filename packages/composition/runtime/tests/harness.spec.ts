import { afterEach, describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { StageResult, WorkflowObjective } from '@trick-harness/contracts'
import type { ControlWorkflowStatus } from '@trick-harness/control-server'
import { planPullRequestStages } from '@trick-harness/engineering-workflow'
import type { ExecutorProvider, ExecutorStartRequest } from '@trick-harness/executor'
import { WorkflowJournal, projectWorkflow } from '@trick-harness/journal'
import type { HarnessProfile } from '@trick-harness/profile'
import type { DeliveryRequest } from '@trick-harness/github-delivery'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
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
 * A settled command over a fixed answer, shaped like the subprocess seam.
 * @param stdout - what the command wrote.
 * @returns the handle.
 */
function answered(stdout: string): SubprocessHandle {
  const empty = { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) }
  return {
    pid: -1,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: { stdout: { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) }, stderr: empty },
    done: Promise.resolve({ exitCode: 0, signal: null }),
    terminate: () => {},
    waitForExit: () => Promise.resolve(true),
  }
}

/**
 * Every command a successful delivery issues, answered without a remote.
 *
 * This is not a GitHub test — those live next to the capability. It is here so
 * a composed run can reach the end of its lifecycle, which it cannot do without
 * something to publish with.
 * @param spec - the command the capability constructed.
 * @returns the handle.
 */
function deliveringSpawn(spec: SubprocessSpawnSpec): SubprocessHandle {
  const argv = spec.argv.join(' ')
  if (argv.includes('--abbrev-ref')) return answered('feature')
  if (argv.includes('--cached --name-only') || argv.includes('diff --cached')) return answered('src/thing.ts')
  if (argv.includes('rev-parse')) return answered('4b825dc642cb6eb9a060e54bf8d69288fbee4904')
  if (argv.startsWith('gh pr view')) return answered('{"number":7,"url":"https://example.invalid/pr/7","state":"OPEN","headRefName":"feature"}')
  return answered('')
}

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
  // A profile that enabled delivery gets something to deliver with, because the
  // runtime blocks a lifecycle that must publish and cannot.
  const delivering = profile.integrationPolicy.enabled.includes(GITHUB_DELIVERY_CAPABILITY)
  return {
    profile,
    registry: REGISTRY,
    session: Session.create(SessionId('compose')),
    flush: async () => true,
    workflow: {
      interpret,
      task: stage => `${stage.role}: do the work`,
      plan: planPullRequestStages,
      describeDelivery: (input): Omit<DeliveryRequest, 'signal'> => ({
        branch: 'feature',
        files: ['src/thing.ts'],
        message: `deliver ${input.stageId}`,
        pullRequest: { title: 'the thing', body: 'what it does', base: 'main' },
      }),
    },
    ...delivering
      ? { integrations: { github: { cwd: '/repo', spawn: deliveringSpawn } } }
      : {},
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
      ...baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started),
      control: { host: '127.0.0.1', port: 0, token: 'a-token-long-enough' },
    })).toThrow(BundleCompositionError)
  })

  it('refuses a profile routing to an executor nobody registered', () => {
    const started: ExecutorStartRequest[] = []
    const options = baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started)

    expect(() => composeHarness({
      ...options,
      providers: { extraProviders: [fakeProvider('builder', started)] },
    })).toThrow(/unregistered executor/)
  })

  it('resolves the routing policy from the profile and the deployment registry', () => {
    const started: ExecutorStartRequest[] = []
    const harness = compose(baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started))

    expect(harness.policy.policyVersion).toBe('plurora-test-v1.0.0')
    expect(harness.policy.registry).toEqual(REGISTRY)
  })
})

describe('the Claude overlay stays optional', () => {
  it('composes without it, and composes with it when a deployment supplies one', () => {
    const started: ExecutorStartRequest[] = []
    const without = compose(baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started))
    const base = baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started)
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

/**
 * Poll one workflow's status until it is no longer running.
 *
 * The POST answers before the run does anything, so reading once would be a
 * guess about scheduling rather than a wait for a result.
 * @param base - the server's base URL.
 * @param workflowId - the execution to read.
 * @param auth - the authorised headers.
 * @returns the settled status.
 */
async function settledStatus(
  base: string,
  workflowId: string,
  auth: Record<string, string>,
): Promise<ControlWorkflowStatus> {
  const deadline = Date.now() + 5000
  for (;;) {
    const read = await fetch(`${base}/workflows/${workflowId}`, { headers: auth })
    const status = (await read.json()) as ControlWorkflowStatus
    if (status.state !== 'running' || Date.now() > deadline) return status
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('a workflow through the real control-server entry path', () => {
  it('runs, reports a bounded status and settles on disposal', async () => {
    const started: ExecutorStartRequest[] = []
    const harness = compose({
      ...baseOptions(profileEnabling([CONTROL_SERVER_CAPABILITY, GITHUB_DELIVERY_CAPABILITY]), started),
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
    const accepted = (await created.json()) as ControlWorkflowStatus
    const status = await settledStatus(base, accepted.workflowId, auth)

    expect(created.status).toBe(202)
    // The identity came back from the Harness. Nothing in the posted body
    // decided it, and the objective's own id is carried beside it.
    expect(accepted.workflowId).not.toBe(OBJECTIVE.id)
    expect(accepted.objectiveId).toBe(OBJECTIVE.id)
    expect(status.state).toBe('completed')
    expect(status.verdict).toBe('PASS')
    expect(status.stages.map(stage => stage.role)).toEqual([
      'implement', 'verify', 'delivery', 'review', 'verify',
    ])
    // Four starts for five stages: delivery is the one nothing was asked about.
    expect(started.map(request => request.route.model)).toEqual([
      'mimo-v2.5', 'deepseek-v4-flash', 'deepseek-v4-flash', 'deepseek-v4-flash',
    ])
  })

  it('routes around a degraded executor through the profile fallback table', async () => {
    const started: ExecutorStartRequest[] = []
    const harness = compose({
      ...baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started),
      degradedExecutors: ['builder'],
    })

    const outcome = await harness.run(OBJECTIVE)

    expect(outcome.verdict).toBe('PASS')
    expect(outcome.stages.filter(stage => stage.role === 'implement').map(stage => stage.executor))
      .toEqual(['spare-builder'])
  })

  it('cancels the run when the caller aborts the signal it passed in', async () => {
    const started: ExecutorStartRequest[] = []
    const harness = compose(baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started))
    const controller = new AbortController()

    const running = harness.run(OBJECTIVE, controller.signal)
    controller.abort()
    const outcome = await running

    expect(outcome.state).not.toBe('completed')
  })

  it('answers a status for a workflow it is not running out of the journal', async () => {
    const started: ExecutorStartRequest[] = []
    const harness = compose({
      ...baseOptions(profileEnabling([CONTROL_SERVER_CAPABILITY, GITHUB_DELIVERY_CAPABILITY]), started),
      control: { port: 0, token: 'a-control-token-long-enough' },
    })
    const server = harness.server
    if (server === undefined) throw new Error('the profile enabled a control server')
    const finished = await harness.run(OBJECTIVE)
    const { host, port } = await server.listen()
    const headers = { authorization: `Bearer ${server.token}` }

    // Addressed by the id the Harness minted, not by the objective's: the
    // objective may have been run more than once, and only the execution id
    // says which of those attempts is being asked about.
    const known = await fetch(`http://${host}:${String(port)}/workflows/${finished.workflowId}`, { headers })
    const unknown = await fetch(`http://${host}:${String(port)}/workflows/wf-never-ran`, { headers })

    expect(server.token).toBe('a-control-token-long-enough')
    expect((await known.json() as ControlWorkflowStatus).state).toBe('completed')
    expect(unknown.status).toBe(404)
  })

  it('runs the default working-tree plan when the deployment names none', async () => {
    const started: ExecutorStartRequest[] = []
    const base = baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started)
    const harness = compose({
      ...base,
      workflow: {
        interpret: base.workflow.interpret,
        task: base.workflow.task,
        ...base.workflow.describeDelivery === undefined ? {} : { describeDelivery: base.workflow.describeDelivery },
      },
    })

    const outcome = await harness.run(OBJECTIVE)

    expect(outcome.stages.map(stage => stage.role))
      .not.toEqual(planPullRequestStages(OBJECTIVE).map(stage => stage.role))
    expect(outcome.verdict).toBe('PASS')
  })

  it('hands the deployment its own diagnosis and repair readers to the runner', async () => {
    const started: ExecutorStartRequest[] = []
    const base = baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started)
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
    const harness = composeHarness(baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started))

    const running = harness.run(OBJECTIVE)
    await harness.dispose()
    const outcome = await running

    expect(outcome.state).not.toBe('completed')
  })

  it('reads a finished workflow back out of the durable journal', async () => {
    const started: ExecutorStartRequest[] = []
    const harness = compose(baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started))

    const finished = await harness.run(OBJECTIVE)

    expect(harness.restartOf(finished.workflowId)?.state).toBe('terminal')
    expect(harness.restartOf(OBJECTIVE.id)).toBeUndefined()
    expect(harness.restartOf('wf-never-ran')).toBeUndefined()
  })
})

describe('a human route override in a composed runtime', () => {
  it('reaches the run without touching the profile or the providers', async () => {
    const started: ExecutorStartRequest[] = []
    const profile = profileEnabling([GITHUB_DELIVERY_CAPABILITY])
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
    expect(JSON.stringify(profile.routingPolicy)).toBe(JSON.stringify(profileEnabling([GITHUB_DELIVERY_CAPABILITY]).routingPolicy))
  })

  it('routes on the table when the caller sends none', async () => {
    const started: ExecutorStartRequest[] = []
    const harness = compose(baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started))

    const outcome = await harness.run(OBJECTIVE)

    expect(outcome.stages.find(stage => stage.role === 'implement')?.executor).toBe('builder')
  })
})

describe('what identifies one execution', () => {
  it('runs the same objective twice under two ids that share no history', async () => {
    const started: ExecutorStartRequest[] = []
    const session = Session.create(SessionId('identity'))
    const ids = ['wf-101', 'wf-102']
    const harness = compose({
      ...baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started),
      session,
      workflowIdFactory: () => ids.shift() ?? 'exhausted',
    })

    const first = await harness.run(OBJECTIVE)
    const second = await harness.run(OBJECTIVE)

    // An objective is what a person asked for and may ask for again; a workflow
    // id is one attempt at it. Sharing them would append the second attempt's
    // facts onto the first one's record, and no reader could then tell which
    // run a verdict belonged to.
    expect(first.workflowId).toBe('wf-101')
    expect(second.workflowId).toBe('wf-102')
    expect(first.objectiveId).toBe(second.objectiveId)
    expect(first.objectiveId).toBe(OBJECTIVE.id)
    const one = projectWorkflow(session.events, 'wf-101')
    const two = projectWorkflow(session.events, 'wf-102')
    expect(one.executorStarts).toBeGreaterThan(0)
    expect(two.executorStarts).toBe(one.executorStarts)
    expect(one.end?.state).toBe('completed')
    expect(two.end?.state).toBe('completed')
  })

  it('refuses an id the session already holds a run under', async () => {
    const started: ExecutorStartRequest[] = []
    const session = Session.create(SessionId('identity-repeat'))
    const harness = compose({
      ...baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started),
      session,
      workflowIdFactory: () => 'wf-same',
    })

    await harness.run(OBJECTIVE)

    // Reusing the id would not be a collision anybody notices: the second run
    // would simply continue the first one's history, and its restart assessment
    // would answer for both.
    await expect(harness.run(OBJECTIVE)).rejects.toThrow(BundleCompositionError)
  })
})

describe('what survives a composed run losing its process', () => {
  it('reads two attempts at one objective back as two independent restarts', async () => {
    const started: ExecutorStartRequest[] = []
    const session = Session.create(SessionId('composed-restart'))
    const ids = ['wf-201', 'wf-202']
    const harness = compose({
      ...baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started),
      session,
      workflowIdFactory: () => ids.shift() ?? 'exhausted',
    })

    await harness.run(OBJECTIVE)
    await harness.run(OBJECTIVE)

    const one = harness.restartOf('wf-201')
    const two = harness.restartOf('wf-202')

    // Two rows in one Session, each answering for itself. A reader holding only
    // an execution id can still say which objective it was an attempt at.
    expect(one?.state).toBe('terminal')
    expect(two?.state).toBe('terminal')
    expect(one?.objectiveId).toBe(OBJECTIVE.id)
    expect(two?.objectiveId).toBe(OBJECTIVE.id)
    expect(one?.requiresWorldVerification).toBe(false)
    expect(two?.requiresWorldVerification).toBe(false)
    expect(harness.restartOf(OBJECTIVE.id)).toBeUndefined()
  })

  it('starts no provider when the log cannot be made durable before dispatch', async () => {
    const started: ExecutorStartRequest[] = []
    const session = Session.create(SessionId('composed-barrier'))
    const harness = compose({
      ...baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started),
      session,
      // The first checkpoint this run asks for is the one in front of its first
      // dispatch. Refusing it is refusing to let anything touch the tree.
      flush: async () => false,
      workflowIdFactory: () => 'wf-301',
    })

    await expect(harness.run(OBJECTIVE)).rejects.toThrow(/durable checkpoint/)

    expect(started).toEqual([])
  })

  it('reconstructs an interrupted capability window and demands the world be checked', () => {
    const started: ExecutorStartRequest[] = []
    const session = Session.create(SessionId('composed-capability'))
    const harness = compose({
      ...baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started),
      session,
    })

    // A run that asked GitHub to push and never heard back, written the way the
    // Harness writes it and then simply stopping — which is what process loss
    // looks like from the log's side.
    const journal = new WorkflowJournal(session, 'wf-lost', async () => true)
    journal.start(OBJECTIVE)
    void journal.beginCapability('deliver-1', GITHUB_DELIVERY_CAPABILITY, true)

    const assessment = harness.restartOf('wf-lost')

    expect(assessment?.state).toBe('interrupted')
    expect(assessment?.verdict).toBe('INCONCLUSIVE')
    expect(assessment?.openStages).toEqual([])
    // Nothing in the log says the push failed. Nothing says it succeeded either,
    // and retrying on that record is how one commit becomes two.
    expect(assessment?.requiresWorldVerification).toBe(true)
    expect(assessment?.summary).toContain(`deliver-1:${GITHUB_DELIVERY_CAPABILITY}`)
  })
})

describe('an objective written for another deployment', () => {
  it('starts nothing at all when it names a profile this Harness was not composed from', async () => {
    const started: ExecutorStartRequest[] = []
    const options = baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started)
    const harness = compose(options)

    await expect(harness.run({ ...OBJECTIVE, profileId: 'other' })).rejects.toThrow(BundleCompositionError)

    // Every rule the run would have been held to — which executors it may
    // reach, what delivery may touch — comes from a policy this objective
    // never agreed to, so the refusal has to come before anything is spent.
    expect(started).toEqual([])
    expect(options.session.events.some(event => event.type === 'harness/workflow-start')).toBe(false)
  })

  it('mints no execution id for an objective it refuses', async () => {
    const started: ExecutorStartRequest[] = []
    const ids = ['wf-refused', 'wf-accepted']
    let next = 0
    const harness = compose({
      ...baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started),
      workflowIdFactory: () => ids[next++] ?? 'wf-overflow',
    })

    await expect(harness.run({ ...OBJECTIVE, profileId: 'other' })).rejects.toThrow(BundleCompositionError)
    const outcome = await harness.run(OBJECTIVE)

    // The first id was never spent, so the accepted run gets it. An id burned
    // on a refusal would leave a gap nothing accounts for.
    expect(outcome.workflowId).toBe('wf-refused')
    expect(harness.restartOf('wf-accepted')).toBeUndefined()
  })

  it('runs normally when the objective names the composed profile', async () => {
    const started: ExecutorStartRequest[] = []
    const harness = compose(baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started))

    const outcome = await harness.run({ ...OBJECTIVE, profileId: 'plurora-test' })

    expect(outcome.verdict).toBe('PASS')
    expect(started.length).toBeGreaterThan(0)
  })
})

describe('publishing from a composed deployment', () => {
  it('writes every confirmed mutation into the journal of the run that caused it', async () => {
    const started: ExecutorStartRequest[] = []
    const options = baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started)
    const harness = compose(options)

    const outcome = await harness.run(OBJECTIVE)
    const projection = projectWorkflow(options.session.events, outcome.workflowId)

    expect(outcome.verdict).toBe('PASS')
    expect(projection.deliveries.map(record => record.action)).toEqual(['commit', 'push', 'pr-update'])
    // The branch is the one the deployment described, not one the runtime chose.
    for (const record of projection.deliveries) expect(record.branch).toBe('feature')
    // No delivery stage was ever put to an executor.
    for (const request of started) expect(request.task).not.toContain('delivery')
  })

  it('cannot publish when the deployment says nothing about what to publish', async () => {
    const started: ExecutorStartRequest[] = []
    const base = baseOptions(profileEnabling([GITHUB_DELIVERY_CAPABILITY]), started)
    const harness = compose({
      ...base,
      workflow: {
        interpret: base.workflow.interpret,
        task: base.workflow.task,
        ...base.workflow.plan === undefined ? {} : { plan: base.workflow.plan },
      },
    })

    const outcome = await harness.run(OBJECTIVE)

    expect(outcome.state).toBe('blocked')
    expect(outcome.summary).toContain('no delivery capability')
  })
})
