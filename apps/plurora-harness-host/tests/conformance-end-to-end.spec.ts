/**
 * Conformance, end to end, on the real Plurora policy.
 *
 * Every other conformance test in this repository holds one part still and
 * checks another: the manifest builder against text, the coverage check against
 * a manifest, the handlers against a fabricated envelope. This file holds none
 * of them still. It runs the real `WorkflowRunner` against the real Plurora
 * profile, the real routing table, the real Definition of Done and the real
 * host handlers, over documents written to a real checkout on disk — so what it
 * proves is what the deployment does, not what a fixture agrees to.
 *
 * It exists as the executable half of the Plan F verification record: the
 * lifecycle case states the manifest composition and the readiness gate, and
 * the adversarial cases state the five ways a run could otherwise reach
 * `PR_READY` without having been judged against what a human approved.
 *
 * @module apps/plurora-harness-host/tests/conformance-end-to-end
 */

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { routingPolicyOf } from '@trick-harness/composition'
import { WorkflowRunner, assessPullRequest, buildConformanceManifest, planPullRequestStages } from '@trick-harness/engineering-workflow'
import type { DeliveryCapabilityPort, PullRequestOutcome } from '@trick-harness/engineering-workflow'
import type { ConformanceManifest, WorkflowObjective } from '@trick-harness/contracts'
import { pluroraDodObligations, pluroraProfile } from '../../../profiles/plurora/profile.ts'
import { RESULT_MARKER, createPluroraWorkflowHandlers } from '../src/workflow-handlers.ts'

/** The deployment's tier table, standing in for the one a machine is pinned to. */
const REGISTRY = Object.freeze({
  'codex.frontier': 'gpt-5.6-sol',
  'codex.balanced': 'gpt-5.6-luna',
  'opencode.workhorse': 'mimo-v2.5',
  'opencode.reasoning-fast': 'deepseek-v4-flash',
})

/** An approved Spec declaring exactly two acceptance criteria. */
const SPEC_TEXT = [
  '# Spec: nullable departure gate',
  '',
  '- **ND1:** the departure gate column is nullable',
  '- **ND2:** an absent gate reads as unknown rather than as empty',
  '',
].join('\n')

/** An approved Plan declaring exactly two tasks. */
const PLAN_TEXT = [
  '# Plan',
  '',
  '### Task 1: Add the migration',
  '',
  '### Task 2: Render an absent gate as unknown',
  '',
].join('\n')

/** The identity half of an approved document. */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

let cwd: string
let session: Session
let executors: HarnessExecutorRuntime
let runner: WorkflowRunner
let started: ExecutorStartRequest[]

/**
 * The obligation set a conformance stage is answering, built here rather than
 * read off the runtime.
 *
 * Building it independently is the point: the runtime builds its own from the
 * same documents, and the coverage check that stands between them is only
 * worth anything if the two were arrived at separately.
 *
 * @param spec - the Spec text on disk.
 * @param plan - the Plan text on disk.
 * @returns the manifest, hashed the way the host hashes what it read.
 */
function expectedManifest(spec = SPEC_TEXT, plan = PLAN_TEXT): ConformanceManifest {
  return buildConformanceManifest({
    specText: spec,
    planText: plan,
    specSha256: sha256(spec),
    planSha256: sha256(plan),
    dod: pluroraDodObligations,
  })
}

/**
 * A checkout holding the approved documents, and the objective naming them.
 *
 * @param spec - the Spec text to write.
 * @param plan - the Plan text to write.
 * @param overrides - objective fields this case wants changed.
 * @returns the objective, hashed against what was actually written.
 */
async function checkout(
  spec = SPEC_TEXT,
  plan = PLAN_TEXT,
  overrides: Partial<WorkflowObjective> = {},
): Promise<WorkflowObjective> {
  await mkdir(join(cwd, 'docs'), { recursive: true })
  await writeFile(join(cwd, 'docs/spec.md'), spec, 'utf8')
  await writeFile(join(cwd, 'docs/plan.md'), plan, 'utf8')
  return {
    id: 'PLU-88',
    cwd,
    requirement: 'make the departure gate nullable',
    risk: 'low',
    workload: 'light',
    profileId: 'plurora',
    approvedArtifacts: {
      spec: { path: 'docs/spec.md', sha256: sha256(spec) },
      plan: { path: 'docs/plan.md', sha256: sha256(plan) },
    },
    ...overrides,
  }
}

/** The envelope an ordinary stage prints to pass. */
function passing(role: string): string {
  const envelope = { verdict: 'PASS', summary: `${role} found nothing`, findings: [], evidence: [] }
  return `Looked it over.\n${RESULT_MARKER} ${JSON.stringify(envelope)}`
}

/** How a conformance stage answers one obligation. */
type Answer = (obligation: ConformanceManifest['obligations'][number]) => Record<string, unknown>

/** The answer that satisfies an obligation exactly as the manifest states it. */
const satisfies: Answer = obligation => ({
  id: obligation.id,
  source: obligation.source,
  requirement: obligation.requirement,
  status: 'PASS',
  implementationEvidence: [{ kind: 'diff', locator: 'db/migrations/0004_gate.sql', summary: 'the column is added nullable' }],
  verificationEvidence: [{ kind: 'test', locator: 'gate.spec.ts', summary: 'green' }],
  summary: 'the branch satisfies this',
})

/**
 * The envelope a conformance stage prints, built from the manifest it was set.
 *
 * @param manifest - the obligation set the runtime built deterministically.
 * @param answer - how each obligation is answered.
 * @param extra - items appended after the answers, for the adversarial cases.
 * @returns the stage output.
 */
function conformanceOutput(
  manifest: ConformanceManifest,
  answer: Answer = satisfies,
  extra: readonly Record<string, unknown>[] = [],
  omit: readonly string[] = [],
): string {
  const envelope = {
    verdict: 'PASS',
    summary: 'conformance ran',
    findings: [],
    evidence: [],
    conformance: {
      specSha256: manifest.specSha256,
      planSha256: manifest.planSha256,
      items: [...manifest.obligations.filter(item => !omit.includes(item.id)).map(answer), ...extra],
      verdict: 'PASS',
      summary: 'every approved obligation is met',
    },
  }
  return `Checked each obligation.\n${RESULT_MARKER} ${JSON.stringify(envelope)}`
}

/** A provider that answers every start the same way. */
function provider(name: string, start: (request: ExecutorStartRequest) => Promise<ExecutorResult>): ExecutorProvider {
  return {
    name,
    capabilities: { modelOverride: true, reasoningEffort: true, permissionModes: ['read-only', 'workspace-write'] },
    start,
  }
}

/** A delivery capability that publishes without touching a remote. */
const DELIVERY: DeliveryCapabilityPort = {
  deliver: async () => ({
    delivered: true,
    summary: 'the branch was pushed and its pull request updated',
    evidence: [],
    findings: [],
  }),
}

/**
 * Run one full lifecycle on the real policy and the real handlers.
 *
 * @param objective - the objective to run.
 * @param options - how conformance answers, and which executors are registered.
 * @returns the pull-request outcome.
 */
async function runLifecycle(
  objective: WorkflowObjective,
  options: {
    answer?: Answer
    extra?: readonly Record<string, unknown>[]
    omit?: readonly string[]
    manifest?: ConformanceManifest
    executors?: readonly string[]
  } = {},
): Promise<PullRequestOutcome> {
  const manifest = options.manifest ?? expectedManifest()
  for (const name of options.executors ?? ['codex', 'opencode']) {
    executors.register(provider(name, async (request) => {
      started.push(request)
      // A stage knows what it is from its prompt, which is the only thing a
      // real provider gets: the start request names an executor and a model,
      // never a role.
      if (!request.task.startsWith(CONFORMANCE_PROMPT)) {
        return { status: 'completed', output: passing('the stage') }
      }
      return { status: 'completed', output: conformanceOutput(manifest, options.answer, options.extra, options.omit) }
    }))
  }
  const handlers = createPluroraWorkflowHandlers()
  // A handler held as `undefined` is a handler the request does not carry, and
  // the run request tells the two apart.
  const present = Object.fromEntries(
    Object.entries(handlers).filter(([, value]) => value !== undefined),
  ) as Omit<Parameters<WorkflowRunner['run']>[0], 'objective' | 'plan'>
  const outcome = await runner.run({
    objective,
    plan: planPullRequestStages,
    ...present,
  })
  return assessPullRequest(outcome)
}

/** How the host's conformance prompt opens, which is how a stage knows its role. */
const CONFORMANCE_PROMPT = 'You are the conformance stage'

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'plurora-conformance-'))
  session = Session.create(SessionId('s'))
  executors = createExecutorRuntime()
  runner = new WorkflowRunner('wf-1', {
    profile: pluroraProfile,
    policy: routingPolicyOf(pluroraProfile, REGISTRY),
    executors,
    journal: new WorkflowJournal(session, 'wf-1', async () => true),
    capabilities: { delivery: DELIVERY },
  })
  started = []
})

describe('a pull request that reaches a human', () => {
  it('judges the branch against two Spec criteria, two Plan tasks and eight Definition of Done rows', async () => {
    const outcome = await runLifecycle(await checkout())

    const manifest = expectedManifest()
    expect(manifest.obligations.filter(item => item.source === 'spec').map(item => item.id)).toEqual(['ND1', 'ND2'])
    expect(manifest.obligations.filter(item => item.source === 'plan').map(item => item.id))
      .toEqual(['PLAN-TASK-1', 'PLAN-TASK-2'])
    expect(manifest.obligations.filter(item => item.source === 'dod').map(item => item.id))
      .toEqual(pluroraDodObligations.map(item => item.id))
    expect(manifest?.obligations).toHaveLength(12)
    expect(outcome.outcome.conformance?.expected).toEqual({ spec: 2, plan: 2, dod: 8 })
  })

  it('is ready only once conformance passed and a fresh verification passed after it', async () => {
    const outcome = await runLifecycle(await checkout())
    const ids = outcome.outcome.stages.map(stage => stage.stageId)

    expect(outcome.state).toBe('PR_READY')
    expect(ids.lastIndexOf('verify-final')).toBeGreaterThan(ids.lastIndexOf('conformance-1'))
    expect(outcome.outcome.stages.findLast(stage => stage.role === 'conformance')?.verdict).toBe('PASS')
    expect(outcome.outcome.stages.at(-1)?.verdict).toBe('PASS')
  })

  it('reads a routine conformance on the balanced Codex tier at high reasoning effort', async () => {
    await runLifecycle(await checkout())

    const route = started.findLast(request => request.task.startsWith(CONFORMANCE_PROMPT))?.route
    expect(route?.executor).toBe('codex')
    expect(route?.model).toBe(REGISTRY['codex.balanced'])
    expect(route?.reasoningEffort).toBe('high')
    expect(route?.permissionMode).toBe('read-only')
  })

  it('reads a high-risk conformance on the frontier tier at the effort that risk buys', async () => {
    await runLifecycle(await checkout(SPEC_TEXT, PLAN_TEXT, { risk: 'high' }))

    const route = started.findLast(request => request.task.startsWith(CONFORMANCE_PROMPT))?.route
    expect(route?.model).toBe(REGISTRY['codex.frontier'])
    expect(route?.reasoningEffort).toBe('xhigh')
  })

  it('journals counts and identities, never the documents or what the model said about them', async () => {
    const outcome = await runLifecycle(await checkout())

    const summary = outcome.outcome.conformance
    expect(summary?.specPath).toBe('docs/spec.md')
    expect(summary?.specSha256).toBe(sha256(SPEC_TEXT))
    expect(JSON.stringify(summary)).not.toContain('departure gate column is nullable')
    expect(JSON.stringify(summary)).not.toContain('the branch satisfies this')
  })
})

describe('the ways a branch could otherwise be called ready', () => {
  it('will not certify while an approved Plan task goes unanswered', async () => {
    // The reading answers every obligation but one, and calls itself a pass. A
    // gate that took the verdict at its word would be scoring the branch
    // against the set the model chose to talk about.
    const outcome = await runLifecycle(await checkout(), { omit: ['PLAN-TASK-2'] })

    expect(outcome.state).not.toBe('PR_READY')
    expect(outcome.state).toBe('INCONCLUSIVE')
  })

  it('will not certify against a Plan that gained a task after it was approved', async () => {
    const objective = await checkout()
    await writeFile(join(cwd, 'docs/plan.md'), PLAN_TEXT + '### Task 3: Backfill the column\n', 'utf8')

    const outcome = await runLifecycle(objective)

    expect(outcome.state).not.toBe('PR_READY')
    expect(outcome.state).toBe('BLOCKED')
  })

  it('stops before it writes anything when the approved Spec is not the approved Spec any more', async () => {
    const objective = await checkout(SPEC_TEXT, PLAN_TEXT)
    const edited = {
      ...objective,
      approvedArtifacts: { ...objective.approvedArtifacts, spec: { path: 'docs/spec.md', sha256: 'c'.repeat(64) } },
    }

    const outcome = await runLifecycle(edited)

    expect(outcome.state).toBe('BLOCKED')
    expect(outcome.outcome.stages).toEqual([])
    expect(started).toEqual([])
  })

  it('refuses a reading that answers one obligation twice', async () => {
    // Two answers under one id means one of them was scored and the other
    // silently dropped, which is a coverage count that does not mean coverage.
    const outcome = await runLifecycle(await checkout(), {
      extra: [{ ...satisfies({ id: 'ND1', source: 'spec', requirement: 'the departure gate column is nullable', required: true }) }],
    })

    expect(outcome.state).toBe('INCONCLUSIVE')
    expect(outcome.state).not.toBe('PR_READY')
  })

  it('refuses a reading that answers an obligation the approved artifacts never set', async () => {
    const outcome = await runLifecycle(await checkout(), {
      extra: [{
        id: 'ND9',
        source: 'spec',
        requirement: 'the feature is behind a flag',
        status: 'PASS',
        implementationEvidence: [],
        verificationEvidence: [],
        summary: 'invented',
      }],
    })

    expect(outcome.state).toBe('INCONCLUSIVE')
  })

  it('refuses a reading that restates an approved obligation as something easier', async () => {
    const outcome = await runLifecycle(await checkout(), {
      answer: obligation => ({ ...satisfies(obligation), requirement: 'something close enough' }),
    })

    expect(outcome.state).toBe('INCONCLUSIVE')
  })

  it('cannot certify high-risk work on the executor that wrote it when Codex is gone', async () => {
    // Codex is not registered, so every judgement role falls back onto OpenCode
    // — where the implementation ran. At high risk the profile requires a
    // cross-executor reading, and no second executor exists to give one, so the
    // run stops rather than letting the writer certify its own work. Conformance
    // is never reached, which is the strongest form of "conformance did not
    // launder this": there is nothing for it to answer about.
    const outcome = await runLifecycle(
      await checkout(SPEC_TEXT, PLAN_TEXT, { risk: 'high' }),
      { executors: ['opencode'] },
    )

    expect(outcome.state).toBe('BLOCKED')
    expect(outcome.state).not.toBe('PR_READY')
    expect(outcome.outcome.stages.map(stage => stage.role)).not.toContain('conformance')
    expect(outcome.outcome.stages.every(stage => stage.executor === 'opencode')).toBe(true)
    expect(outcome.summary).toContain('independent')
  })
})
