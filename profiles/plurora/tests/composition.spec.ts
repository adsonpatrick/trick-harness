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
import type {
  DiagnosisContract, EvidenceRef, Finding, StageResult, WorkflowObjective,
} from '@trick-harness/contracts'
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
  seen: { executor: string; model: string; role: string; task: string }[],
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
      seen.push({ executor: name, model: request.route.model ?? '', role, task: request.task })
      return answer(role)
    },
  }
}

/** A parent project and the isolated branch a preview run creates under it. */
const PARENT_REF = 'abcdefghijklmnop'
const PREVIEW_REF = 'qrstuvwxyzabcdef'

const EVIDENCE: EvidenceRef = Object.freeze({ kind: 'test', locator: 'thing.spec.ts', summary: 'red' })

const DIAGNOSIS: DiagnosisContract = Object.freeze({
  symptom: 'the thing is wrong',
  reproduction: 'vitest run thing.spec.ts',
  expectedVsActual: 'expected right, got wrong',
  observedEvidence: Object.freeze([EVIDENCE]),
  affectedBoundary: 'src/thing.ts',
  ruledOutHypotheses: Object.freeze(['the caller']),
  rootCauseHypothesis: 'the thing rounds too early',
  confidence: 'high',
  regressionTestSeam: 'thing.spec.ts',
  minimalRepairSurface: 'thing.ts',
  unknowns: Object.freeze([]),
  securityRelevance: 'none',
})

const REPAIRED = Object.freeze({
  regressionTest: EVIDENCE,
  focusedGreen: Object.freeze({ kind: 'test' as const, locator: 'thing.spec.ts', summary: 'green' }),
  rootCauseAddressed: true,
})

/**
 * A confirmed defect of one class, shaped as a stage would report it.
 * @param id - the finding id.
 * @param cls - the class the stage assigned it.
 * @returns the finding.
 */
function defect(id: string, cls: Finding['class']): Finding {
  return {
    id, class: cls, raisedBy: 'verify', summary: `${id} is wrong`, confirmed: true, evidence: [EVIDENCE],
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
  /** The whole prompt, so a test can prove what authority it does not carry. */
  task: string
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
   * @param overrides - what this run reads differently from the default.
   * @param overrides.interpret - how each stage result is read, when the default all-pass is not what the test needs.
   * @param overrides.database - whether this run declares a schema change and composes the isolated preview for it.
   * @returns the composed Harness and the session its events land in.
   */
  function live(
    answer: (executor: string, role: string) => ExecutorResult,
    seen: SeenStart[],
    degradedExecutors: readonly string[] = [],
    overrides: {
      interpret?: (stage: { role: string; stageId: string }, executor: string) => StageResult
      database?: boolean
    } = {},
  ): { harness: ComposedHarness; session: Session } {
    const session = Session.create(SessionId('plurora-live'))
    const harness = composeHarness({
      profile: pluroraProfile,
      registry: DEFAULT_MODEL_REGISTRY,
      session,
      flush: async () => true,
      workflow: {
        interpret: overrides.interpret ?? ((stage, executor) => ({
          role: stage.role,
          executor,
          verdict: 'PASS',
          summary: `${stage.role} passed`,
          findings: [],
          evidence: [],
        })),
        task: stage => `${stage.role}: do the work`,
        describeDelivery: input => ({
          branch: 'feature',
          files: ['src/thing.ts'],
          message: `deliver ${input.stageId}`,
          pullRequest: { title: 'the thing', body: 'what it does', base: 'main' },
        }),
        ...overrides.database === true
          ? {
            describeDatabasePreview: () => ({ branchName: 'preview-run' }),
            databaseChange: () => ({ required: true, migrationPaths: ['supabase/migrations/0001_thing.sql'] }),
          }
          : {},
        diagnose: () => DIAGNOSIS,
        repairEvidence: () => REPAIRED,
      },
      // A lifecycle that publishes needs something to publish with, and this
      // deployment's profile enables delivery. The commands are answered here
      // rather than sent anywhere: what this file tests is routing, not GitHub.
      integrations: {
        github: { cwd: '/repo', spawn: deliveringSpawn },
        ...overrides.database === true
          ? {
            supabase: {
              cwd: '/repo', spawn: previewSpawn, projectRef: PARENT_REF,
              pollIntervalMs: 1, readyTimeoutMs: 50,
            },
          }
          : {},
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
   * @param spec - the command the capability constructed.
   * @returns the handle.
   */
  function deliveringSpawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const argv = spec.argv.join(' ')
    if (argv.includes('--abbrev-ref')) return answered('feature')
    if (argv.includes('diff --cached')) return answered('src/thing.ts')
    if (argv.includes('rev-parse')) return answered('4b825dc642cb6eb9a060e54bf8d69288fbee4904')
    if (argv.startsWith('gh pr view')) return answered('{"number":7,"url":"https://example.invalid/pr/7","state":"OPEN","headRefName":"feature"}')
    return answered('')
  }

  /**
   * Every command an isolated preview run issues, answered without a cloud.
   * @param spec - the command the capability constructed.
   * @returns the handle.
   */
  function previewSpawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    if (spec.argv.includes('branches') && spec.argv.includes('get')) {
      return answered(JSON.stringify({
        id: 'br_1',
        project_ref: PREVIEW_REF,
        status: 'MIGRATIONS_PASSED',
        db_url: `postgresql://postgres:s3cr3t@db.${PREVIEW_REF}.supabase.co:5432/postgres`,
      }))
    }
    return answered('')
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
    // Three readings: the one that ran out of quota, its substitute, and the
    // fresh verification the lifecycle ends on.
    expect(rerun.map(start => start.executor)).toEqual(['codex', 'opencode', 'opencode'])
    expect(rerun[1]?.model).toBe(DEFAULT_MODEL_REGISTRY['opencode.reasoning-fast'])
    const routes = projectWorkflow(session.events, outcome.workflowId).routes
    // Every reading after the quota ran out is rerouted, and each reroute is
    // named rather than silent.
    const fell = routes.filter(record => record.fallbackFrom === 'codex')
    expect(fell.length).toBeGreaterThan(0)
    for (const record of fell) expect(record.executor).toBe('opencode')
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

  /**
   * A live composition with the default all-pass answers from both executors.
   * @param seen - where each start is recorded.
   * @param overrides - what this run reads differently from the default.
   * @returns the composed Harness and its session.
   */
  function liveFor(
    seen: SeenStart[],
    overrides: Parameters<typeof live>[3] = {},
  ): { harness: ComposedHarness; session: Session } {
    return live(executor => passes(executor), seen, [], overrides)
  }

  /**
   * The all-pass reading of one stage.
   * @param role - the stage's role.
   * @param executor - who ran it.
   * @returns the result.
   */
  function passing(role: string, executor: string): StageResult {
    return { role, executor, verdict: 'PASS', summary: `${role} passed`, findings: [], evidence: [] } as StageResult
  }

  describe('authority this deployment does not hand to a model', () => {
    /**
     * A prompt carries no authority to mutate anything outside the working tree.
     * @param seen - every start this run made.
     */
    function noMutationAuthorityInPrompts(seen: readonly SeenStart[]): void {
      for (const start of seen) {
        expect(start.role, 'no model is ever routed to publish').not.toBe('delivery')
        for (const forbidden of ['git push', 'gh pr', 'git commit', 'supabase', 'psql', 'postgresql://']) {
          expect(start.task.toLowerCase(), `start for ${start.role}`).not.toContain(forbidden)
        }
      }
    }

    it('publishes only through the capability, and asks no model to do it', async () => {
      const seen: SeenStart[] = []
      const { harness, session } = liveFor(seen)

      const outcome = await harness.run(LIVE_OBJECTIVE)
      const projection = projectWorkflow(session.events, outcome.workflowId)

      expect(outcome.state).toBe('completed')
      expect(projection.deliveries.map(record => record.action)).toEqual(['commit', 'push', 'pr-update'])
      expect(projection.openCapabilities).toEqual([])
      noMutationAuthorityInPrompts(seen)
    })

    it('verifies a schema change on an isolated preview, and asks no model to reach a database', async () => {
      const seen: SeenStart[] = []
      const { harness, session } = liveFor(seen, { database: true })

      const outcome = await harness.run(LIVE_OBJECTIVE)
      const ids = outcome.stages.map(stage => stage.stageId)

      expect(outcome.state).toBe('completed')
      expect(ids.indexOf('delivery-1-database')).toBeLessThan(ids.indexOf('delivery-1'))
      noMutationAuthorityInPrompts(seen)
      // The isolated branch is the only execution database, and nothing about it
      // reaches the durable record.
      const written = JSON.stringify(session.events)
      expect(written).toContain('supabase:preview-created')
      expect(written).not.toContain('postgresql://')
      expect(written).not.toContain('s3cr3t')
    })

    it('starts no repair for a security defect, because this profile authorizes none', async () => {
      const seen: SeenStart[] = []
      let readings = 0
      const { harness } = liveFor(seen, {
        interpret: (stage, executor) => {
          if (stage.role !== 'verify') return passing(stage.role, executor)
          readings += 1
          return readings === 1
            ? {
              role: stage.role, executor, verdict: 'FAIL', summary: 'a secret leaks',
              findings: [defect('f-sec', 'SECURITY_BUG')], evidence: [],
            }
            : passing(stage.role, executor)
        },
      })

      const outcome = await harness.run(LIVE_OBJECTIVE)

      expect(outcome.state).toBe('blocked')
      expect(outcome.summary).toContain('security')
      expect(outcome.stages.map(stage => stage.role)).not.toContain('repair')
      expect(seen.map(start => start.role)).not.toContain('repair')
    })

    it('repairs an ordinary defect, republishes it, and reads it again before it closes', async () => {
      const seen: SeenStart[] = []
      let reviews = 0
      const { harness } = liveFor(seen, {
        interpret: (stage, executor) => {
          if (stage.role !== 'review') return passing(stage.role, executor)
          reviews += 1
          return reviews === 1
            ? {
              role: stage.role, executor, verdict: 'FAIL', summary: 'the thing is wrong',
              findings: [defect('f-bug', 'BUG')], evidence: [],
            }
            : passing(stage.role, executor)
        },
      })

      const outcome = await harness.run({ ...LIVE_OBJECTIVE, risk: 'high' })
      const ids = outcome.stages.map(stage => stage.stageId)

      expect(outcome.state).toBe('completed')
      expect(outcome.repairCycles).toBe(1)
      expect(ids).toEqual([
        'implement-1', 'verify-1', 'delivery-1', 'review-1',
        'debug-1', 'repair-1', 'verify-2', 'delivery-2', 'review-2',
        'qa-1', 'verify-final',
      ])
      noMutationAuthorityInPrompts(seen)
    })

    it('adds a security reading at critical risk and still closes on a fresh verification', async () => {
      const seen: SeenStart[] = []
      const { harness } = liveFor(seen)

      const outcome = await harness.run({ ...LIVE_OBJECTIVE, risk: 'critical' })

      expect(outcome.state).toBe('completed')
      expect(outcome.stages.map(stage => stage.role)).toEqual([
        'implement', 'verify', 'delivery', 'review', 'qa', 'security', 'verify',
      ])
      expect(outcome.stages.at(-1)?.stageId).toBe('verify-final')
      noMutationAuthorityInPrompts(seen)
    })
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

  it('runs the whole preview validation without ever naming a database but the branch', async () => {
    const issued: (readonly string[])[] = []
    const branchJson = JSON.stringify({
      id: 'br_1',
      project_ref: 'zyxwvutsrqponmlk',
      status: 'MIGRATIONS_PASSED',
      db_url: 'postgresql://postgres:s3cr3t@db.zyxwvutsrqponmlk.supabase.co:5432/postgres',
    })
    const spawn = (spec: SubprocessSpawnSpec): SubprocessHandle => {
      issued.push(spec.argv)
      const stdout = spec.argv.includes('get') ? branchJson : ''
      const reader = { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) }
      return {
        pid: 1,
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        collected: { stdout: reader, stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } },
        done: Promise.resolve({ exitCode: 0, signal: null }),
        terminate: () => {},
        waitForExit: () => Promise.resolve(true),
      } as unknown as SubprocessHandle
    }
    const seams = productSeams()
    const harness = composeHarness({
      profile: pluroraProfile,
      registry: DEFAULT_MODEL_REGISTRY,
      session: Session.create(SessionId('plurora-preview-safety')),
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
        github: { cwd: '/repo', spawn },
        supabase: { cwd: '/repo', spawn, projectRef: 'uljaajwwnygopsyvwsre', pollIntervalMs: 0 },
      },
      control: { host: '127.0.0.1', port: 0, token: 'a-token-long-enough' },
    })
    opened.push(harness)

    const outcome = await harness.integrations.supabase?.run({ branchName: 'pr-42' })

    expect(outcome?.status).toBe('PASSED')
    // Every command the real profile's capability issued, read back as one
    // string. The forbidden paths are the ones that need Docker or that point
    // at a database somebody else is using, and the assertion is that the
    // composed capability has no way to reach them — not that this run chose
    // not to.
    const commands = issued.map(argv => argv.join(' ')).join('\n')
    for (const forbidden of ['--local', '--linked', 'supabase start', 'db reset', 'test db', 'neurovia-dev']) {
      expect(commands).not.toContain(forbidden)
    }
    // The parent ref appears only where branches are created and asked about.
    for (const argv of issued) {
      if (!argv.includes('uljaajwwnygopsyvwsre')) continue
      expect(argv).toContain('branches')
    }
  })

  /** Compose the real profile with inert seams and a listening control server. */
  function listening(): ComposedHarness {
    const seams = productSeams()
    const harness = composeHarness({
      profile: pluroraProfile,
      registry: DEFAULT_MODEL_REGISTRY,
      session: Session.create(SessionId('plurora-control')),
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
    return harness
  }

  it('answers a caller who does not hold the token with nothing about the run', async () => {
    const harness = listening()
    const endpoint = await harness.server?.listen()

    // Bound to loopback rather than to every interface: the control surface can
    // cancel a run, and reaching it should require already being on the machine.
    expect(endpoint?.host).toBe('127.0.0.1')
    const response = await fetch(`http://127.0.0.1:${endpoint?.port}/status`)
    expect(response.status).toBe(401)
    expect(await response.text()).not.toContain('a-token-long-enough')
  })

  it('leaves no listener behind, so a disposed deployment holds no port open', async () => {
    const harness = listening()
    const endpoint = await harness.server?.listen()
    const port = endpoint?.port

    await harness.dispose()

    // The port is the observable part of quiescence: a deployment that reported
    // itself shut down while still accepting control requests would still be
    // able to start work nobody is watching.
    await expect(fetch(`http://127.0.0.1:${port}/status`)).rejects.toThrow()
  })
})
