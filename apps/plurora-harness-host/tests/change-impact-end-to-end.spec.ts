/**
 * Change impact, end to end, on the real Plurora policy.
 *
 * The unit tests around change impact each hold something still: the
 * classifier against a fabricated policy, the certification resolver against a
 * fabricated impact, the runner against a fabricated reader. This file holds
 * none of them still. It runs the real `WorkflowRunner` against the real
 * Plurora profile, the real routing table, the real path rules and the real
 * host handlers, over an approved Plan written to a real checkout — so what it
 * proves is what this deployment does when a change turns out to be something
 * other than what its objective said.
 *
 * It is the executable half of the Plan G verification record. Each case is one
 * way a run could otherwise be certified as smaller than it is: an auth file
 * that was never planned, a migration nobody declared, a repair that widened
 * the change after the bar had been set, a large write routed as a small one,
 * and a delivered file the Plan never approved going unmentioned.
 *
 * @module apps/plurora-harness-host/tests/change-impact-end-to-end
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
import { WorkflowRunner, buildConformanceManifest } from '@trick-harness/engineering-workflow'
import type {
  DatabaseVerificationCapabilityPort,
  DeliveryCapabilityPort,
  WorkflowOutcome,
} from '@trick-harness/engineering-workflow'
import type { ConformanceManifest, Risk, WorkflowObjective } from '@trick-harness/contracts'
import { pluroraDodObligations, pluroraProfile } from '../../../profiles/plurora/profile.ts'
import { RESULT_MARKER, createPluroraWorkflowHandlers } from '../src/workflow-handlers.ts'

/** The deployment's tier table, standing in for the one a machine is pinned to. */
const REGISTRY = Object.freeze({
  'codex.frontier': 'gpt-5.6-sol',
  'codex.balanced': 'gpt-5.6-luna',
  'opencode.workhorse': 'mimo-v2.5',
  'opencode.reasoning-fast': 'deepseek-v4-flash',
})

/** An approved Spec declaring one acceptance criterion. */
const SPEC_TEXT = ['# Spec: the departure gate', '', '- **ND1:** an absent gate reads as unknown', ''].join('\n')

/** One planned UI file, which the Plurora rules read as a medium-risk change. */
const UI = 'src/app/gate.tsx'

/** An auth file, which the Plurora rules read as critical whoever touched it. */
const AUTH = 'src/lib/auth/route-policy.ts'

/** A migration, which the Plurora rules read as a database mutation. */
const MIGRATION = 'supabase/migrations/0001_gate.sql'

/**
 * An approved Plan naming exactly the files it approves being written.
 *
 * One task, so the manifest stays small, and a real `**Files:**` block, because
 * the planned write set is parsed out of this text rather than declared beside
 * it.
 *
 * @param files - the repository paths the Plan approves.
 * @returns the Plan document.
 */
function planText(files: readonly string[]): string {
  return [
    '# Plan',
    '',
    '### Task 1: Render an absent gate as unknown',
    '',
    '**Files:**',
    '',
    ...files.map(path => `- Modify: \`${path}\``),
    '',
  ].join('\n')
}

/** The identity half of an approved document. */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

let cwd: string
let session: Session
let executors: HarnessExecutorRuntime
let started: ExecutorStartRequest[]

/** A delivery capability that publishes without touching a remote. */
const DELIVERY: DeliveryCapabilityPort = {
  deliver: async () => ({
    delivered: true,
    summary: 'the branch was pushed and its pull request updated',
    evidence: [],
    findings: [],
  }),
}

/** A database verifier that answers about a database that really existed. */
const VERIFIER: DatabaseVerificationCapabilityPort = {
  verify: async () => ({
    status: 'PASSED',
    summary: 'the migrations applied and read back',
    evidence: [],
    findings: [],
  }),
}

/** A provider that answers every start the same way. */
function provider(name: string, start: (request: ExecutorStartRequest) => Promise<ExecutorResult>): ExecutorProvider {
  return {
    name,
    capabilities: { modelOverride: true, reasoningEffort: true, permissionModes: ['read-only', 'workspace-write'] },
    start,
  }
}

/** How the host's conformance prompt opens, which is how a stage knows its role. */
const CONFORMANCE_PROMPT = 'You are the conformance stage'

/** How the host's QA prompt opens. */
const QA_PROMPT = 'You are the qa stage'

/** How the host's implementation prompt opens. */
const IMPLEMENT_PROMPT = 'You are the implement stage'

/** How the host's repair prompt opens. */
const REPAIR_PROMPT = 'You are the repair stage'

/** How the host's debug prompt opens. */
const DEBUG_PROMPT = 'You are the debug stage'

/** The envelope an ordinary stage prints to pass. */
function passing(): string {
  const envelope = { verdict: 'PASS', summary: 'the stage found nothing', findings: [], evidence: [] }
  return `Looked it over.\n${RESULT_MARKER} ${JSON.stringify(envelope)}`
}

/** The envelope a QA stage prints when it found one confirmed defect. */
function failing(): string {
  const envelope = {
    verdict: 'FAIL',
    summary: 'the gate renders empty rather than unknown',
    findings: [{
      id: 'f-1',
      class: 'BUG',
      raisedBy: 'qa',
      summary: 'an absent gate renders as an empty string',
      confirmed: true,
      evidence: [{ kind: 'test', locator: 'gate.spec.ts:absent', summary: 'red' }],
    }],
    evidence: [],
  }
  return `Ran the suite.\n${RESULT_MARKER} ${JSON.stringify(envelope)}`
}

/** The envelope a debug stage prints, which is where a diagnosis comes from. */
function diagnosing(): string {
  const envelope = {
    verdict: 'PASS',
    summary: 'the null branch falls through to the empty string',
    findings: [],
    evidence: [],
    diagnosis: {
      symptom: 'an absent gate renders as an empty string',
      reproduction: 'pnpm vitest run gate.spec.ts -t "absent"',
      expectedVsActual: 'expected "unknown", got ""',
      observedEvidence: [{ kind: 'test', locator: 'gate.spec.ts:absent', summary: 'red before the fix' }],
      affectedBoundary: 'src/app/gate.tsx',
      ruledOutHypotheses: ['stale fixture', 'locale formatting'],
      rootCauseHypothesis: 'the null branch falls through to the empty string',
      confidence: 'high',
      regressionTestSeam: 'gate.spec.ts absent suite',
      minimalRepairSurface: 'the null branch in gate.tsx',
      unknowns: [],
      securityRelevance: 'none',
    },
  }
  return `Reproduced it.\n${RESULT_MARKER} ${JSON.stringify(envelope)}`
}

/** The envelope a repair stage prints, which the completion gate reads. */
function repairing(): string {
  const envelope = {
    verdict: 'PASS',
    summary: 'the null branch renders unknown',
    findings: [],
    evidence: [],
    repair: {
      regressionTest: { kind: 'test', locator: 'gate.spec.ts:absent', summary: 'red first' },
      focusedGreen: { kind: 'test', locator: 'gate.spec.ts:absent', summary: 'green after' },
      rootCauseAddressed: true,
    },
  }
  return `Fixed it.\n${RESULT_MARKER} ${JSON.stringify(envelope)}`
}

/**
 * The envelope a conformance stage prints, answering every stated obligation.
 *
 * Built from a manifest this file composes itself rather than from the one the
 * runtime built: the coverage check between them is only worth anything if the
 * two were arrived at separately.
 *
 * @param manifest - the obligation set, composed here.
 * @returns the stage output.
 */
function conformanceOutput(manifest: ConformanceManifest): string {
  const envelope = {
    verdict: 'PASS',
    summary: 'conformance ran',
    findings: [],
    evidence: [],
    conformance: {
      specSha256: manifest.specSha256,
      planSha256: manifest.planSha256,
      items: manifest.obligations.map(obligation => ({
        id: obligation.id,
        source: obligation.source,
        requirement: obligation.requirement,
        status: 'PASS',
        implementationEvidence: [],
        verificationEvidence: [],
        summary: 'the branch satisfies this',
      })),
      verdict: 'PASS',
      summary: 'every approved obligation is met',
    },
  }
  return `Checked each obligation.\n${RESULT_MARKER} ${JSON.stringify(envelope)}`
}

/** What one end-to-end run is set up with. */
interface Scenario {
  /** The repository paths the approved Plan names. */
  readonly planned: readonly string[]
  /** What the published branch turned out to touch, one answer per delivery. */
  readonly actual: readonly (readonly string[])[]
  /** The risk the objective was opened at; low unless a case says otherwise. */
  readonly risk?: Risk
  /** Whether the first QA reading reports a confirmed defect. */
  readonly qaFailsOnce?: boolean
  /** The database verifier this deployment composed, when it composed one. */
  readonly databaseVerification?: DatabaseVerificationCapabilityPort
}

/** What one end-to-end run produced. */
interface RunRecord {
  readonly outcome: WorkflowOutcome
  /** The obligation set each conformance reading was scored against. */
  readonly manifests: readonly ConformanceManifest[]
}

/**
 * Run one whole lifecycle on the real policy, classified from real documents.
 *
 * No `plan` is supplied, which is what puts the run in its measured form: the
 * implementation half runs, the branch is published, and the certification half
 * is planned from what the delivered branch turned out to be.
 *
 * @param scenario - the planned Plan, the delivered diffs, and what failed.
 * @returns the outcome and the manifests conformance was held to.
 */
async function runLifecycle(scenario: Scenario): Promise<RunRecord> {
  const plan = planText(scenario.planned)
  await mkdir(join(cwd, 'docs'), { recursive: true })
  await writeFile(join(cwd, 'docs/spec.md'), SPEC_TEXT, 'utf8')
  await writeFile(join(cwd, 'docs/plan.md'), plan, 'utf8')
  const objective: WorkflowObjective = {
    id: 'PLU-91',
    cwd,
    requirement: 'render an absent departure gate as unknown',
    risk: scenario.risk ?? 'low',
    workload: 'light',
    profileId: 'plurora',
    approvedArtifacts: {
      spec: { path: 'docs/spec.md', sha256: sha256(SPEC_TEXT) },
      plan: { path: 'docs/plan.md', sha256: sha256(plan) },
    },
  }

  const manifest = buildConformanceManifest({
    specText: SPEC_TEXT,
    planText: plan,
    specSha256: sha256(SPEC_TEXT),
    planSha256: sha256(plan),
    dod: pluroraDodObligations,
  })

  let qaRuns = 0
  for (const name of ['codex', 'opencode']) {
    executors.register(provider(name, async (request) => {
      started.push(request)
      // A stage knows what it is from its prompt, which is the only thing a
      // real provider gets: the start request names an executor and a model,
      // never a role.
      if (request.task.startsWith(CONFORMANCE_PROMPT)) {
        return { status: 'completed', output: conformanceOutput(manifest) }
      }
      if (request.task.startsWith(DEBUG_PROMPT)) return { status: 'completed', output: diagnosing() }
      if (request.task.startsWith(REPAIR_PROMPT)) return { status: 'completed', output: repairing() }
      if (scenario.qaFailsOnce === true && request.task.startsWith(QA_PROMPT)) {
        qaRuns += 1
        if (qaRuns === 1) return { status: 'completed', output: failing() }
      }
      return { status: 'completed', output: passing() }
    }))
  }

  // One answer per delivery, so a repair that republished is classified from
  // the branch it published rather than from the one it replaced.
  let deliveries = 0
  const handlers = createPluroraWorkflowHandlers({
    changeSet: {
      actualPaths: async () => {
        const answer = scenario.actual[Math.min(deliveries, scenario.actual.length - 1)] ?? []
        deliveries += 1
        return answer
      },
    },
  })

  const manifests: ConformanceManifest[] = []
  const runner = new WorkflowRunner('wf-1', {
    profile: pluroraProfile,
    policy: routingPolicyOf(pluroraProfile, REGISTRY),
    executors,
    journal: new WorkflowJournal(session, 'wf-1', async () => true),
    capabilities: {
      delivery: DELIVERY,
      ...scenario.databaseVerification === undefined
        ? {}
        : { databaseVerification: scenario.databaseVerification },
    },
  })

  const present = Object.fromEntries(
    Object.entries(handlers).filter(([, value]) => value !== undefined),
  ) as Omit<Parameters<WorkflowRunner['run']>[0], 'objective'>
  const outcome = await runner.run({
    ...present,
    objective,
    conformance: (stage, executor, result, held) => {
      manifests.push(held)
      return handlers.conformance?.(stage, executor, result, held)
    },
  })
  return { outcome, manifests }
}

/** The roles that ran after the last time the branch was published. */
function certifiedAfterLastDelivery(outcome: WorkflowOutcome): readonly string[] {
  const at = outcome.stages.findLastIndex(stage => stage.role === 'delivery')
  return outcome.stages.slice(at + 1).map(stage => stage.role)
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'plurora-impact-'))
  session = Session.create(SessionId('s'))
  executors = createExecutorRuntime()
  started = []
})

describe('a change that turned out to be something other than its objective', () => {
  it('certifies an auth file nobody planned as the critical change it is', async () => {
    // The objective was opened as low-risk UI work and the approved Plan names
    // one component. The branch that was published also rewrites a route
    // policy. What a person is being asked to review is an auth change, and the
    // certification half is planned from that rather than from the objective.
    const { outcome } = await runLifecycle({ planned: [UI], actual: [[UI, AUTH]] })

    expect(outcome.changeImpact?.effectiveRisk).toBe('critical')
    expect(outcome.changeImpact?.surfaces).toContain('auth')
    expect(certifiedAfterLastDelivery(outcome)).toContain('security')
  })

  it('tells the certifying stages what evidence the auth surface costs', async () => {
    const { outcome } = await runLifecycle({ planned: [UI], actual: [[UI, AUTH]] })

    expect(outcome.changeImpact?.evidenceProfiles).toContain('auth-standard')
  })
})

describe('a migration nobody declared', () => {
  it('refuses to publish a schema change this deployment composed no verifier for', async () => {
    // The objective declares no database change and the run request carries no
    // `databaseChange` field. The Plan names a migration, which is a fact about
    // the change rather than a claim about it, so the gate closes anyway.
    const { outcome } = await runLifecycle({ planned: [MIGRATION], actual: [[MIGRATION]] })

    expect(outcome.state).toBe('blocked')
    expect(outcome.summary).toContain('database verification capability')
    expect(outcome.stages.map(stage => stage.role)).not.toContain('review')
  })

  it('publishes the same change once a verifier has read the migrations back', async () => {
    const { outcome } = await runLifecycle({
      planned: [MIGRATION],
      actual: [[MIGRATION]],
      databaseVerification: VERIFIER,
    })

    expect(outcome.state).toBe('completed')
    expect(outcome.changeImpact?.databaseMutation).toBe(true)
    expect(certifiedAfterLastDelivery(outcome)).toContain('conformance')
  })
})

describe('a repair that widened the change after the bar was set', () => {
  it('recertifies the branch the repair published, not the one it replaced', async () => {
    // The first delivery was the planned UI change and bought QA. QA found a
    // defect, the repair reached into a route policy, and the branch a person
    // would now review is a critical auth change — so the second certification
    // pass buys what that costs.
    const { outcome } = await runLifecycle({
      planned: [UI],
      actual: [[UI], [UI, AUTH]],
      qaFailsOnce: true,
    })

    expect(outcome.changeImpact?.effectiveRisk).toBe('critical')
    expect(certifiedAfterLastDelivery(outcome)).toContain('security')
  })

  it('never buys less on the second pass than the first pass already bought', async () => {
    // The repair took the auth file back out. What the branch touched at any
    // point in this run is still what a person is being asked to trust.
    const { outcome } = await runLifecycle({
      planned: [UI],
      actual: [[UI, AUTH], [UI]],
      qaFailsOnce: true,
    })

    expect(outcome.changeImpact?.effectiveRisk).toBe('critical')
    expect(certifiedAfterLastDelivery(outcome)).toContain('security')
  })
})

describe('a change too large for the tier that would have written it', () => {
  /** Thirteen planned files, one past the profile's medium band. */
  const THIRTEEN = Object.freeze(Array.from({ length: 13 }, (_, index) => `src/app/panel-${String(index)}.tsx`))

  it('routes an implementation of thirteen files to the workhorse', async () => {
    await runLifecycle({ planned: THIRTEEN, actual: [THIRTEEN] })

    const route = started.find(request => request.task.startsWith(IMPLEMENT_PROMPT))?.route
    expect(route?.executor).toBe('opencode')
    expect(route?.model).toBe(REGISTRY['opencode.workhorse'])
  })

  it('routes the repair of a change that size to the workhorse too', async () => {
    await runLifecycle({ planned: THIRTEEN, actual: [THIRTEEN], qaFailsOnce: true })

    const route = started.find(request => request.task.startsWith(REPAIR_PROMPT))?.route
    expect(route?.executor).toBe('opencode')
    expect(route?.model).toBe(REGISTRY['opencode.workhorse'])
  })

  it('reads thirteen files as a large write rather than as the role default', async () => {
    const { outcome } = await runLifecycle({ planned: THIRTEEN, actual: [THIRTEEN] })

    expect(outcome.changeImpact?.writeVolume).toBe('large')
  })
})

describe('a delivered file the approved Plan never named', () => {
  const EXTRA = 'src/app/unplanned-panel.tsx'

  it('keeps the unplanned file in the record the run ends on', async () => {
    const { outcome } = await runLifecycle({ planned: [UI], actual: [[UI, EXTRA]] })

    expect(outcome.changeImpact?.unplannedPaths).toStrictEqual([EXTRA])
    expect(outcome.changeImpact?.unplannedPathCount).toBe(1)
  })

  it('hands the unplanned file to conformance as evidence rather than as a verdict', async () => {
    const { manifests } = await runLifecycle({ planned: [UI], actual: [[UI, EXTRA]] })

    expect(manifests.at(-1)?.unplannedPaths).toStrictEqual([EXTRA])
  })

  it('says nothing drifted when the delivery stayed inside the Plan', async () => {
    const { outcome, manifests } = await runLifecycle({ planned: [UI], actual: [[UI]] })

    expect(outcome.changeImpact?.unplannedPaths).toStrictEqual([])
    expect(manifests.at(-1)?.unplannedPaths).toStrictEqual([])
  })
})
