/**
 * Runnable keyless snapshot for what a person sees while a Harness workflow runs.
 *
 * Everything here goes through the real entry path: a composed Harness, a real
 * loopback control server, and real HTTP requests against it. The only fakes are
 * the executor providers, which stand exactly at the product boundary where a
 * real run would start somebody's coding agent — no product process, no
 * credential, no network beyond the loopback socket this test opened itself.
 *
 * The transcript is three surfaces: the bounded status the control server hands
 * a bridge, the findings a report renders from the run's own outcome, and what a
 * degraded executor looks like once the profile's fallback table has answered.
 *
 * All three settle at BLOCKED, and that is the point rather than a shortfall.
 * This composition has no delivery capability, and publishing is a capability
 * port and never a stage handed to an executor, so the lifecycle stops at
 * `delivery-1` and says so. A transcript that showed the branch published here
 * would be showing a model having improvised a mutation nobody granted.
 */

import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import type { Finding, StageResult, WorkflowObjective } from '@trick-harness/contracts'
import type { ControlWorkflowStatus } from '@trick-harness/control-server'
import { assessPullRequest, planPullRequestStages } from '@trick-harness/engineering-workflow'
import type { StageSpec } from '@trick-harness/engineering-workflow'
import type { ExecutorProvider } from '@trick-harness/executor'
import type { HarnessProfile } from '@trick-harness/profile'
import { composeHarness } from '@trick-harness/composition'
import type { ComposedHarness } from '@trick-harness/composition'

const root = resolve(import.meta.dirname, '..')
const expected = join(root, 'scripts/snapshots/harness-control-transcript/transcript.expected.json')
const refreshing = process.env['DSH_SNAPSHOT'] === 'record' || process.env['DSH_SNAPSHOT'] === 'refresh'

const RULES = Object.freeze([
  Object.freeze({ id: 'implement', when: Object.freeze({ role: 'implement' }), use: Object.freeze({ executor: 'builder', tier: 'implementation' }) }),
  Object.freeze({ id: 'repair', when: Object.freeze({ role: 'repair' }), use: Object.freeze({ executor: 'builder', tier: 'implementation' }) }),
  Object.freeze({ id: 'delivery', when: Object.freeze({ role: 'delivery' }), use: Object.freeze({ executor: 'builder', tier: 'implementation' }) }),
  Object.freeze({ id: 'default', when: Object.freeze({}), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
])

const FALLBACKS = Object.freeze([
  Object.freeze({ id: 'builder-degraded', when: Object.freeze({ unavailable: 'builder' }), use: Object.freeze({ executor: 'spare-builder', tier: 'implementation' }) }),
  Object.freeze({ id: 'reviewer-degraded', when: Object.freeze({}), use: Object.freeze({ executor: 'reviewer', tier: 'reasoning' }) }),
])

const PROFILE: HarnessProfile = Object.freeze({
  id: 'plurora-transcript',
  policyVersion: 'plurora-transcript-v1.0.0',
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
  integrationPolicy: Object.freeze({ enabled: Object.freeze(['control-server']), rules: Object.freeze([]) }),
  trustedComposition: Object.freeze({ excludedPluginIds: Object.freeze([]) }),
})

const REGISTRY = Object.freeze({ implementation: 'mimo-v2.5', reasoning: 'deepseek-v4-flash' })

const OBJECTIVE: WorkflowObjective = Object.freeze({
  id: 'wf-transcript-1',
  cwd: '/repo',
  requirement: 'add the thing the review will object to',
  risk: 'low',
  workload: 'heavy',
  profileId: 'plurora-transcript',
})

const DEFECT: Finding = Object.freeze({
  id: 'finding-1',
  class: 'TEST_DEFECT',
  raisedBy: 'review',
  summary: 'the new test asserts a constant the module no longer exports',
  confirmed: true,
  evidence: Object.freeze([
    Object.freeze({ kind: 'test', locator: 'packages/thing/tests/thing.spec.ts', summary: 'the failing assertion' } as const),
  ]),
})

const GREEN = Object.freeze({ kind: 'test', locator: 'packages/thing/tests/thing.spec.ts', summary: 'the focused run, green' } as const)

/**
 * A product boundary that answers without starting anything.
 * @param name - The executor name a route may address.
 * @returns The provider.
 */
function fakeProvider(name: string): ExecutorProvider {
  return {
    name,
    capabilities: { modelOverride: true, reasoningEffort: true, permissionModes: ['read-only', 'workspace-write'] },
    start: () => Promise.resolve({ status: 'completed' as const, output: `${name} finished` }),
  }
}

/**
 * The first review objects; every later reading of the branch is clean.
 * @param stage - The stage that ran.
 * @param executor - The executor that ran it.
 * @returns What the stage contributes to the run.
 */
function interpret(stage: StageSpec, executor: string): StageResult {
  const objecting = stage.stageId === 'review-1'
  return {
    role: stage.role,
    executor,
    verdict: objecting ? 'FAIL' : 'PASS',
    summary: objecting
      ? 'the branch is published but one test asserts a stale constant'
      : `${stage.role} found nothing outstanding`,
    findings: objecting ? [DEFECT] : [],
    evidence: [],
  }
}

/**
 * Compose one Harness whose only fakes stand at the product boundary.
 * @param degradedExecutors - Executors the breaker has already marked degraded.
 * @returns The composed Harness.
 */
function harnessWith(degradedExecutors: readonly string[], idPrefix: string): ComposedHarness {
  // The Harness mints the execution id, and by default that is a UUID a
  // snapshot could never record. A deterministic factory is the supported way
  // to make the identity readable without pretending the objective supplies it.
  let minted = 0
  return composeHarness({
    workflowIdFactory: () => {
      minted += 1
      return `${idPrefix}-${String(minted)}`
    },
    profile: PROFILE,
    registry: REGISTRY,
    session: Session.create(SessionId('transcript')),
    flush: () => Promise.resolve(true),
    workflow: {
      interpret,
      task: (stage, objective) => `${stage.role}: ${objective.requirement}`,
      plan: planPullRequestStages,
      repairEvidence: () => ({ focusedGreen: GREEN, rootCauseAddressed: true }),
    },
    providers: {
      extraProviders: [fakeProvider('builder'), fakeProvider('reviewer'), fakeProvider('spare-builder')],
    },
    control: { host: '127.0.0.1' },
    degradedExecutors,
  })
}

/**
 * Drive one objective through the real control-server entry path.
 * @param harness - The composed Harness serving the request.
 * @param objective - What to run.
 * @returns The bounded status the server hands a bridge once the run has settled.
 */
async function statusThroughHttp(
  harness: ComposedHarness,
  objective: WorkflowObjective,
): Promise<ControlWorkflowStatus> {
  const server = harness.server
  if (server === undefined) throw new Error('the profile enables a control server')
  const { host, port } = await server.listen()
  const headers = { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' }
  const base = `http://${host}:${String(port)}`
  const created = await fetch(`${base}/workflows`, { method: 'POST', headers, body: JSON.stringify(objective) })
  expect(created.status).toBe(202)
  // The run is named by the id the Harness minted and handed back, never by the
  // objective's own id: the same objective may be run more than once, so a read
  // addressed to `objective.id` names nothing and answers 404.
  const { workflowId } = (await created.json()) as ControlWorkflowStatus
  for (;;) {
    const read = await fetch(`${base}/workflows/${workflowId}`, { headers })
    expect(read.status).toBe(200)
    const status = (await read.json()) as ControlWorkflowStatus
    if (status.state !== 'running') return status
  }
}

describe('harness control transcript runnable snapshot', () => {
  it('records the status, the block and the fallback a person actually sees', async () => {
    const certified = harnessWith([], 'wf-transcript')
    const degraded = harnessWith(['builder'], 'wf-degraded')
    let transcript: string
    try {
      const status = await statusThroughHttp(certified, OBJECTIVE)
      const outcome = await certified.run({ ...OBJECTIVE, id: 'wf-transcript-2' })
      const degradedStatus = await statusThroughHttp(degraded, { ...OBJECTIVE, id: 'wf-transcript-3' })
      const pullRequest = assessPullRequest(outcome)
      transcript = `${JSON.stringify({
        status,
        pullRequest: {
          ...pullRequest,
          // Wall-clock is the one field a machine decides; a snapshot that
          // carried it would fail on a slow morning rather than on a change.
          outcome: {
            ...pullRequest.outcome,
            stages: pullRequest.outcome.stages.map(({ durationMs: _durationMs, ...stage }) => stage),
          },
        },
        fallback: {
          degradedExecutors: ['builder'],
          state: degradedStatus.state,
          verdict: degradedStatus.verdict,
          stages: degradedStatus.stages.map(stage => ({ stageId: stage.stageId, role: stage.role, executor: stage.executor })),
        },
      }, undefined, 2)}\n`
    } finally {
      await certified.dispose()
      await degraded.dispose()
    }

    expect(transcript).not.toContain('Bearer')
    if (refreshing) {
      await mkdir(dirname(expected), { recursive: true })
      await writeFile(expected, transcript)
    } else {
      await access(expected)
    }
    await expect(transcript).toMatchFileSnapshot(expected)
  })
})
