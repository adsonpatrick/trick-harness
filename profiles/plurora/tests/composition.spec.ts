/**
 * Evidence that Plurora's real policy composes onto a real runtime.
 *
 * The composition package is tested against synthetic policy, which proves the
 * mechanism and nothing about this project: the check that matters to Plurora
 * is that the executors its own routing table names are the executors a
 * deployment actually registers. That check lives here, on the profile side of
 * the one-way boundary, because it is a statement about this project's policy
 * rather than about the composition mechanism.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  BundleCompositionError,
  composeHarness,
  createHarnessRuntimeBundle,
  routedExecutors,
} from '@trick-harness/composition'
import type { ComposedHarness } from '@trick-harness/composition'
import type { WorkflowObjective } from '@trick-harness/contracts'
import { dispatchableRoute, type ReasoningEffort } from '@trick-harness/executor'
import type { ExecutorProvider, ExecutorResult } from '@trick-harness/executor'
import { projectWorkflow } from '@trick-harness/journal'
import { DEFAULT_MODEL_REGISTRY } from '@trick-harness/routing'
import type { OpencodeAdapter } from '@trick-harness/provider-opencode'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { pluroraProfile } from '../profile.ts'

/** Product entry points recorded so the test can prove none of them is reached. */
function productSeams() {
  // Plain counters rather than spies: the assertion is that a seam was never
  // reached, which reads the same either way.
  let spawns = 0
  let serverStarts = 0
  let connects = 0
  const spawn = (_spec: SubprocessSpawnSpec): SubprocessHandle => {
    spawns += 1
    throw new Error('loading the Plurora composition must not spawn a Codex process')
  }
  const adapter: OpencodeAdapter = {
    startServer: () => {
      serverStarts += 1
      throw new Error('loading the Plurora composition must not start an OpenCode server')
    },
    connect: () => {
      connects += 1
      throw new Error('loading the Plurora composition must not connect an OpenCode client')
    },
  }
  return { spawn, adapter, reached: (): number => spawns + serverStarts + connects }
}

describe('the Plurora deployment composition', () => {
  it('routes to exactly the two executors this fork ships', () => {
    expect([...routedExecutors(pluroraProfile)].sort()).toEqual(['codex', 'opencode'])
  })

  it('loads with every routed executor registered', async () => {
    const seams = productSeams()
    const bundle = createHarnessRuntimeBundle({
      opencode: { adapter: seams.adapter },
      codex: { spawn: seams.spawn },
      profile: pluroraProfile,
    })
    expect(bundle.executors).toEqual(['opencode', 'codex'])
    await bundle.dispose()
  })

  it('starts no product process at load', async () => {
    const seams = productSeams()
    const bundle = createHarnessRuntimeBundle({
      opencode: { adapter: seams.adapter },
      codex: { spawn: seams.spawn },
      profile: pluroraProfile,
    })
    expect(seams.reached()).toBe(0)
    expect(bundle.runtime.activeRuns()).toBe(0)
    await bundle.dispose()
  })

  it('refuses to load when an executor the policy routes to is left out', () => {
    const seams = productSeams()
    expect(() => createHarnessRuntimeBundle({
      codex: { spawn: seams.spawn },
      profile: pluroraProfile,
    })).toThrow(BundleCompositionError)
  })

  it('makes every routing row dispatchable on the executor it names', async () => {
    // Every row must be dispatchable on the executor it names, and the
    // narrowing step is what keeps it so: a stated reasoning effort is advisory,
    // and a product without the knob still serves the route. This is the test
    // that would fail if a resolver ever passed a `use` row to the runtime as
    // written.
    const seams = productSeams()
    const bundle = createHarnessRuntimeBundle({
      opencode: { adapter: seams.adapter },
      codex: { spawn: seams.spawn },
      profile: pluroraProfile,
    })
    const { rules, fallbackRules } = pluroraProfile.routingPolicy
    const dropped: string[] = []
    for (const rule of [...rules, ...fallbackRules]) {
      const executor = String(rule.use['executor'])
      const narrowed = dispatchableRoute(bundle.runtime.get(executor), {
        executor,
        permissionMode: 'workspace-write',
        reasoningEffort: rule.use['effort'] as ReasoningEffort,
      })
      // Dispatched for real. The seams throw, so the run fails — but it fails
      // as `provider-error`, which only happens once the route has already
      // cleared capability validation. An unnarrowed row would instead reject
      // with `ExecutorCapabilityError` before any provider was reached.
      await expect(bundle.runtime.start({
        cwd: '/workspace',
        task: 'do the task',
        route: narrowed.route,
        signal: new AbortController().signal,
      })).resolves.toMatchObject({ status: 'error', failure: { category: 'provider-error' } })
      if (narrowed.dropped.length > 0) dropped.push(rule.id)
    }
    // Nothing is dropped today, and the reason is stated rather than assumed:
    // no OpenCode row claims a reasoning effort, because writing a number down
    // for a knob the product does not have is a claim about a run nobody can
    // check. If a row ever states one, it lands here as a dropped id rather
    // than as a silently unhonoured intent.
    expect(dropped).toEqual([])
    for (const rule of [...rules, ...fallbackRules]) {
      if (rule.use['executor'] === 'opencode') expect(rule.use['effort'], rule.id).toBeUndefined()
    }
    await bundle.dispose()
  })

  it('leaves no provider registered after disposal', async () => {
    const seams = productSeams()
    const bundle = createHarnessRuntimeBundle({
      opencode: { adapter: seams.adapter },
      codex: { spawn: seams.spawn },
      profile: pluroraProfile,
    })
    await bundle.dispose()
    expect(bundle.runtime.list()).toEqual([])
  })
})

/**
 * A product boundary that answers whatever the test told it to.
 * @param name - the executor name.
 * @param answer - what it returns for a given stage role.
 * @param seen - where each start is recorded.
 * @returns the provider.
 */
function scriptedProvider(
  name: string,
  answer: (role: string) => ExecutorResult,
  seen: { executor: string; model: string; role: string }[],
): ExecutorProvider {
  return {
    name,
    capabilities: {
      modelOverride: true,
      reasoningEffort: true,
      permissionModes: ['read-only', 'workspace-write'],
    },
    start: async (request) => {
      const role = request.task.split(':')[0] ?? ''
      seen.push({ executor: name, model: request.route.model ?? '', role })
      return answer(role)
    },
  }
}

const LIVE_OBJECTIVE: WorkflowObjective = Object.freeze({
  id: 'wf-plurora-live',
  cwd: '/repo',
  requirement: 'add the thing',
  risk: 'low',
  workload: 'medium',
  profileId: 'plurora',
})

/** One start, as the scripted providers record it. */
interface SeenStart {
  executor: string
  model: string
  role: string
}

describe('Plurora policy driving a live run', () => {
  let harnesses: ComposedHarness[] = []

  afterEach(async () => {
    const open = harnesses
    harnesses = []
    await Promise.all(open.map(async harness => harness.dispose()))
  })

  /**
   * Compose the real Plurora profile onto scripted product boundaries.
   * @param answer - what each executor returns, by executor and role.
   * @param seen - where each start is recorded.
   * @param degradedExecutors - executors the breaker already knows are out.
   * @returns the composed Harness and the session its events land in.
   */
  function live(
    answer: (executor: string, role: string) => ExecutorResult,
    seen: SeenStart[],
    degradedExecutors: readonly string[] = [],
  ): { harness: ComposedHarness; session: Session } {
    const session = Session.create(SessionId('plurora-live'))
    const harness = composeHarness({
      profile: pluroraProfile,
      registry: DEFAULT_MODEL_REGISTRY,
      session,
      flush: async () => true,
      workflow: {
        interpret: (stage, executor) => ({
          role: stage.role,
          executor,
          verdict: 'PASS',
          summary: `${stage.role} passed`,
          findings: [],
          evidence: [],
        }),
        task: stage => `${stage.role}: do the work`,
      },
      providers: {
        extraProviders: [
          scriptedProvider('opencode', role => answer('opencode', role), seen),
          scriptedProvider('codex', role => answer('codex', role), seen),
        ],
      },
      ...degradedExecutors.length === 0 ? {} : { degradedExecutors },
    })
    harnesses.push(harness)
    return { harness, session }
  }

  const passes = (executor: string): ExecutorResult => ({ status: 'completed', output: `${executor} ran` })

  it('moves a Codex judgement stage to OpenCode reasoning when Codex runs out of quota', async () => {
    const seen: SeenStart[] = []
    const { harness, session } = live(
      (executor, role) => executor === 'codex' && role === 'verify'
        ? {
          status: 'error',
          output: '',
          failure: {
            category: 'usage-limit-exceeded',
            availability: true,
            safeDiagnostic: 'codex run failed (usage-limit-exceeded)',
          },
        }
        : passes(executor),
      seen,
    )

    const outcome = await harness.run(LIVE_OBJECTIVE)

    expect(outcome.state).toBe('completed')
    // Losing Codex costs assurance, not throughput, so the substitute for
    // judgement work is the reasoning tier rather than the workhorse.
    const rerun = seen.filter(start => start.role === 'verify')
    expect(rerun.map(start => start.executor)).toEqual(['codex', 'opencode'])
    expect(rerun[1]?.model).toBe(DEFAULT_MODEL_REGISTRY['opencode.reasoning-fast'])
    const routes = projectWorkflow(session.events, outcome.workflowId).routes
    const fell = routes.filter(record => record.fallbackFrom === 'codex')
    expect(fell.length).toBe(1)
    expect(fell[0]?.executor).toBe('opencode')
  })

  it('sends heavy work to Codex when OpenCode is out, and says so durably', async () => {
    const seen: SeenStart[] = []
    const { harness, session } = live(executor => passes(executor), seen, ['opencode'])

    const outcome = await harness.run({ ...LIVE_OBJECTIVE, workload: 'heavy' })

    expect(outcome.state).toBe('completed')
    expect(seen.every(start => start.executor === 'codex')).toBe(true)
    const implemented = projectWorkflow(session.events, outcome.workflowId).routes
      .find(record => record.role === 'implement')
    expect(implemented?.executor).toBe('codex')
    expect(implemented?.fallbackFrom).toBe('opencode')
  })

  it('blocks heavy work rather than inventing a route when neither product is usable', async () => {
    const seen: SeenStart[] = []
    const { harness } = live(executor => passes(executor), seen, ['opencode', 'codex'])

    const outcome = await harness.run({ ...LIVE_OBJECTIVE, workload: 'heavy' })

    // The amended invariant: with no usable executor the run stops, and that is
    // the expected outcome rather than a defect. Nothing was dispatched.
    expect(outcome.state).toBe('blocked')
    expect(seen).toEqual([])
  })

  it('spends a human override on one stage and carries none into the next run', async () => {
    const seen: SeenStart[] = []
    const { harness, session } = live(executor => passes(executor), seen)

    const first = await harness.run(LIVE_OBJECTIVE, undefined, {
      role: 'implement',
      executor: 'codex',
      semanticModelTier: 'codex.frontier',
      reasoningEffort: 'xhigh',
    })
    const second = await harness.run(LIVE_OBJECTIVE)

    expect(first.state).toBe('completed')
    const overridden = projectWorkflow(session.events, first.workflowId).routes
      .find(record => record.role === 'implement')
    expect(overridden?.executor).toBe('codex')
    expect(overridden?.reasonCodes).toContain('override:user')
    // The next stage of the same run, and the next run entirely, are routed by
    // the table. An override that outlived its stage would have made one
    // person's situational call into this project's policy.
    const verified = projectWorkflow(session.events, first.workflowId).routes
      .find(record => record.role === 'verify')
    expect(verified?.reasonCodes).not.toContain('override:user')
    expect(second.state).toBe('completed')
    // The same objective, a second attempt, its own execution id.
    expect(second.workflowId).not.toBe(first.workflowId)
    expect(second.objectiveId).toBe(first.objectiveId)
    const next = projectWorkflow(session.events, second.workflowId).routes
      .find(record => record.role === 'implement')
    expect(next?.executor).toBe('opencode')
    expect(next?.reasonCodes).not.toContain('override:user')
  })
})

describe('the capabilities this project actually turns on', () => {
  let opened: ComposedHarness[] = []

  afterEach(async () => {
    const open = opened
    opened = []
    await Promise.all(open.map(async harness => harness.dispose()))
  })

  it('composes both deterministic capabilities and the control server from the real profile', () => {
    const seams = productSeams()
    const harness = composeHarness({
      profile: pluroraProfile,
      registry: DEFAULT_MODEL_REGISTRY,
      session: Session.create(SessionId('plurora-capabilities')),
      flush: async () => true,
      workflow: {
        interpret: (stage, executor) => ({
          role: stage.role,
          executor,
          verdict: 'PASS',
          summary: `${stage.role} passed`,
          findings: [],
          evidence: [],
        }),
        task: stage => `${stage.role}: do the work`,
      },
      providers: { opencode: { adapter: seams.adapter }, codex: { spawn: seams.spawn } },
      integrations: {
        github: { cwd: '/repo', spawn: seams.spawn },
        supabase: { cwd: '/repo', spawn: seams.spawn, projectRef: 'uljaajwwnygopsyvwsre' },
      },
      control: { host: '127.0.0.1', port: 0, token: 'a-token-long-enough' },
    })
    opened.push(harness)

    // The composition refuses a capability the profile does not enable, so this
    // is the check that the two files agree — the one no unit test of either
    // side alone can make.
    expect(harness.integrations.github).toBeDefined()
    expect(harness.integrations.supabase).toBeDefined()
    expect(harness.server).toBeDefined()
    // Composing is not running: no process, no server, no client.
    expect(seams.reached()).toBe(0)
  })
})
