import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ExecutorProvider, ExecutorStartRequest, ExecutorResult } from '@trick-harness/executor'
import { createExecutorRuntime } from '@trick-harness/executor'
import { WorkflowJournal } from '@trick-harness/journal'
import type { WorkspaceSnapshot } from '@trick-harness/engineering-workflow'
import { WorkflowRunner, buildConformanceManifest } from '@trick-harness/engineering-workflow'
import type { DeliveryCapabilityPort, WorkspaceStateReader } from '@trick-harness/engineering-workflow'
import type { WorkflowObjective } from '@trick-harness/contracts'
import { routingPolicyOf } from '@trick-harness/composition'
import { pluroraDodObligations, pluroraProfile } from '../../../profiles/plurora/profile.ts'
import { RESULT_MARKER, createPluroraWorkflowHandlers } from '../src/workflow-handlers.ts'

const REGISTRY = Object.freeze({
  'codex.frontier': 'gpt-5.6-sol',
  'codex.balanced': 'gpt-5.6-luna',
  'opencode.workhorse': 'mimo-v2.5',
  'opencode.reasoning-fast': 'deepseek-v4-flash',
})
const SPEC_TEXT = '# Activation hardening\n\n- **AC1:** only the approved feature path changes\n'
const PLAN_TEXT = [
  '# Approved plan',
  '',
  '### Task 1: Implement the feature',
  '',
  '**Files:**',
  '- Modify: `src/feature.ts`',
  '',
].join('\n')

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function result(envelope: Record<string, unknown>): ExecutorResult {
  return { status: 'completed', output: `${RESULT_MARKER} ${JSON.stringify(envelope)}` }
}

function stageResult(verdict = 'PASS', overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { verdict, summary: 'stage established its result', findings: [], constraints: [], evidence: [], ...overrides }
}

function diagnosis(): Record<string, unknown> {
  return {
    symptom: 'the feature path is incorrect',
    reproduction: 'run the focused feature test',
    expectedVsActual: 'the feature test passes but currently fails',
    observedEvidence: [{ kind: 'test', locator: 'tests/feature.spec.ts', summary: 'reproduces the defect' }],
    affectedBoundary: 'src/feature.ts',
    ruledOutHypotheses: ['the test fixture is not the cause'],
    rootCauseHypothesis: 'the feature implementation is incorrect',
    confidence: 'high',
    regressionTestSeam: 'tests/feature.spec.ts',
    minimalRepairSurface: 'src/feature.ts',
    proposedRepairPaths: ['src/feature.ts'],
    unknowns: [],
    securityRelevance: 'none',
  }
}

async function workspace(root: string): Promise<WorkflowObjective> {
  await mkdir(join(root, 'docs'), { recursive: true })
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'docs/spec.md'), SPEC_TEXT, 'utf8')
  await writeFile(join(root, 'docs/plan.md'), PLAN_TEXT, 'utf8')
  return {
    id: 'activation-hardening-e2e',
    cwd: root,
    requirement: 'implement the approved feature',
    risk: 'low',
    workload: 'light',
    profileId: 'plurora',
    approvedArtifacts: {
      spec: { path: 'docs/spec.md', sha256: sha256(SPEC_TEXT) },
      plan: { path: 'docs/plan.md', sha256: sha256(PLAN_TEXT) },
    },
  }
}

function stateReader(snapshots: readonly WorkspaceSnapshot[]): WorkspaceStateReader {
  const queue = [...snapshots]
  return { snapshot: async () => queue.shift() ?? snapshots.at(-1) ?? { revision: 'a'.repeat(40), entries: [] } }
}

function defect(): Record<string, unknown> {
  return {
    id: 'BUG-1',
    class: 'BUG',
    raisedBy: 'verify',
    summary: 'the feature behavior is incorrect',
    confirmed: true,
    affectedPaths: ['src/feature.ts'],
    evidence: [{ kind: 'test', locator: 'tests/feature.spec.ts', summary: 'regression reproduced' }],
  }
}

describe('activation hardening workflow regression', () => {
  let root: string | undefined
  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true })
    root = undefined
  })

  it('keeps sandbox-limited verification inconclusive and never dispatches repair or delivery', async () => {
    root = await mkdtemp(join(tmpdir(), 'activation-hardening-inconclusive-'))
    const objective = await workspace(root)
    const starts: ExecutorStartRequest[] = []
    const executors = createExecutorRuntime()
    const constraints = [{
      id: 'C-1', class: 'SANDBOX_LIMITATION', raisedBy: 'verify',
      summary: 'the sandbox cannot reach the required external runtime', evidence: [],
    }]
    for (const name of ['codex', 'opencode']) {
      executors.register(provider(name, starts, request => result(roleOf(request.task) === 'verify'
        ? stageResult('PASS', { constraints })
        : stageResult())))
    }
    const snapshots = [{ revision: 'a'.repeat(40), entries: [] }]
    let deliveries = 0
    const delivery: DeliveryCapabilityPort = {
      deliver: async () => {
        deliveries += 1
        return { delivered: true, summary: 'published', findings: [], evidence: [] }
      },
    }
    const session = Session.create(SessionId('activation-e2e'))
    const runner = new WorkflowRunner('activation-inconclusive', {
      profile: pluroraProfile,
      policy: routingPolicyOf(pluroraProfile, REGISTRY),
      executors,
      journal: new WorkflowJournal(session, 'activation-inconclusive', async () => true),
      capabilities: { delivery },
    })
    const handlers = createPluroraWorkflowHandlers({ branch: 'test/activation-hardening' })
    const outcome = await runner.run({
      objective,
      task: handlers.task,
      interpret: handlers.interpret,
      ...handlers.loadApprovedArtifacts === undefined ? {} : { loadApprovedArtifacts: handlers.loadApprovedArtifacts },
      ...handlers.conformance === undefined ? {} : { conformance: handlers.conformance },
      ...handlers.dodObligations === undefined ? {} : { dodObligations: handlers.dodObligations },
      ...handlers.changeImpact === undefined ? {} : { changeImpact: handlers.changeImpact },
      workspaceState: stateReader(snapshots),
    })

    expect(outcome.verdict, outcome.summary).toBe('INCONCLUSIVE')
    expect(outcome.repairCycles).toBe(0)
    expect(outcome.stages.map(stage => stage.role)).toEqual(['implement', 'verify'])
    expect(starts.some(start => /You are the (debug|repair) stage/.test(start.task))).toBe(false)
    expect(deliveries).toBe(0)
    runner.dispose()
  })

  it('preserves an authorized repair path and delivers it after focused evidence and fresh verification', async () => {
    root = await mkdtemp(join(tmpdir(), 'activation-hardening-repair-'))
    const objective = await workspace(root)
    const starts: ExecutorStartRequest[] = []
    let verifies = 0
    const executors = createExecutorRuntime()
    for (const name of ['codex', 'opencode']) {
      executors.register(provider(name, starts, (request) => {
        const role = roleOf(request.task)
        if (role === 'verify' && verifies++ === 0) {
          return result(stageResult('FAIL', { findings: [defect()] }))
        }
        if (role === 'debug') return result(stageResult('PASS', { diagnosis: diagnosis() }))
        if (role === 'repair') {
          return result(stageResult('PASS', {
            repair: {
              rootCauseAddressed: true,
              regressionTest: { kind: 'test', locator: 'tests/feature.spec.ts', summary: 'fails before the fix' },
              focusedGreen: { kind: 'test', locator: 'tests/feature.spec.ts', summary: 'passes after the fix' },
            },
          }))
        }
        if (role === 'conformance') return result(conformanceEnvelope(objective))
        return result(stageResult())
      }))
    }
    const revision = 'a'.repeat(40)
    const afterDeliveryRevision = 'b'.repeat(40)
    const state = stateReader([
      { revision, entries: [] },
      { revision, entries: [] },
      { revision, entries: [{ path: 'src/feature.ts', fingerprint: 'repaired' }] },
      { revision, entries: [{ path: 'src/feature.ts', fingerprint: 'repaired' }] },
      { revision: afterDeliveryRevision, entries: [] },
    ])
    const delivered: (readonly string[] | undefined)[] = []
    const delivery: DeliveryCapabilityPort = {
      deliver: async (input) => {
        delivered.push(input.changedPaths)
        return { delivered: true, summary: 'published', findings: [], evidence: [] }
      },
    }
    const session = Session.create(SessionId('activation-repair-e2e'))
    const runner = new WorkflowRunner('activation-repair', {
      profile: pluroraProfile,
      policy: routingPolicyOf(pluroraProfile, REGISTRY),
      executors,
      journal: new WorkflowJournal(session, 'activation-repair', async () => true),
      capabilities: { delivery },
    })
    const handlers = createPluroraWorkflowHandlers({
      branch: 'test/activation-hardening',
      changeSet: {
        actualPaths: async () => ['src/feature.ts'],
      },
    })
    const outcome = await runner.run({
      objective,
      task: handlers.task,
      interpret: handlers.interpret,
      ...handlers.diagnose === undefined ? {} : { diagnose: handlers.diagnose },
      ...handlers.repairEvidence === undefined ? {} : { repairEvidence: handlers.repairEvidence },
      ...handlers.loadApprovedArtifacts === undefined ? {} : { loadApprovedArtifacts: handlers.loadApprovedArtifacts },
      ...handlers.conformance === undefined ? {} : { conformance: handlers.conformance },
      ...handlers.dodObligations === undefined ? {} : { dodObligations: handlers.dodObligations },
      ...handlers.changeImpact === undefined ? {} : { changeImpact: handlers.changeImpact },
      workspaceState: state,
    })

    expect(outcome.state, outcome.summary).toBe('completed')
    expect(outcome.verdict).toBe('PASS')
    expect(outcome.repairCycles).toBe(1)
    expect(outcome.stages.map(stage => stage.role)).toContain('repair')
    expect(delivered).toEqual([['src/feature.ts']])
    const repairTask = starts.find(start => start.task.startsWith('You are the repair stage'))?.task ?? ''
    expect(repairTask).toContain('src/feature.ts')
    runner.dispose()
  })
})

function provider(
  name: string,
  starts: ExecutorStartRequest[],
  run: (request: ExecutorStartRequest) => ExecutorResult,
): ExecutorProvider {
  return {
    name,
    capabilities: { modelOverride: true, reasoningEffort: true, permissionModes: ['read-only', 'workspace-write'] },
    start: async (request) => {
      starts.push(request)
      return run(request)
    },
  }
}

function roleOf(task: string): string | undefined {
  return /^You are the (\w+) stage/m.exec(task)?.[1]
}

function conformanceEnvelope(objective: WorkflowObjective): Record<string, unknown> {
  const manifest = buildConformanceManifest({
    specText: SPEC_TEXT,
    planText: PLAN_TEXT,
    specSha256: objective.approvedArtifacts.spec.sha256,
    planSha256: objective.approvedArtifacts.plan.sha256,
    dod: pluroraDodObligations,
  })
  return {
    ...stageResult(),
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
        summary: 'the approved obligation is satisfied',
      })),
      verdict: 'PASS',
      summary: 'every approved obligation is satisfied',
    },
  }
}
