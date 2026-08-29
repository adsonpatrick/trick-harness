import { afterEach, describe, expect, it } from 'vitest'
import type { StageRouteOverride, WorkflowObjective } from '@trick-harness/contracts'
import type { RestartAssessment, WorkflowOutcome } from '@trick-harness/engineering-workflow'
import { ControlError, HarnessControlServer } from '../src/index.ts'
import type {
  ControlServerOptions,
  ControlStartedWorkflow,
  ControlWorkflowStarter,
  ControlWorkflowStatus,
} from '../src/index.ts'

const OBJECTIVE = {
  id: 'obj-1',
  cwd: '/repo',
  requirement: 'add the thing',
  risk: 'low',
  workload: 'light',
  profileId: 'test',
  approvedArtifacts: {
    spec: { path: 'docs/spec.md', sha256: 'a'.repeat(64) },
    plan: { path: 'docs/plan.md', sha256: 'b'.repeat(64) },
  },
}

/**
 * A finished workflow, as the runner would hand one back.
 * @param workflowId - the execution the outcome belongs to.
 * @param objectiveId - the logical objective that execution attempted.
 * @returns the outcome.
 */
function outcome(workflowId: string, objectiveId: string): WorkflowOutcome {
  return {
    workflowId,
    objectiveId,
    state: 'completed',
    verdict: 'PASS',
    summary: 'everything passed',
    stages: [
      {
        stageId: 'implement-1',
        role: 'implement',
        executor: 'builder',
        permissionMode: 'workspace-write',
        verdict: 'PASS',
        summary: 'implemented',
        findings: [],
        evidence: [],
        durationMs: 1,
      },
    ],
    repairCycles: 0,
    executorStarts: 1,
  }
}

/** One start, as the fake starter was given it. */
interface StartRecord {
  readonly objective: WorkflowObjective
  readonly workflowId: string
  readonly routeOverride: StageRouteOverride | undefined
}

/**
 * A starter that mints its own execution ids, the way the Harness does.
 *
 * The id never comes from the objective. Deriving one there is the defect this
 * whole surface is being corrected for: the same objective may be attempted
 * more than once, and a status poll has to be able to say which attempt.
 * @param ids - the execution ids to hand out, in order.
 * @param run - what a started run does; by default it finishes immediately.
 * @param seen - where each start is recorded.
 * @returns the starter.
 */
function starter(
  ids: string[],
  run: (record: StartRecord, canceled: Promise<string>) => Promise<WorkflowOutcome>
    = async record => outcome(record.workflowId, record.objective.id),
  seen: StartRecord[] = [],
): ControlWorkflowStarter {
  return (objective, routeOverride): ControlStartedWorkflow => {
    const workflowId = ids.shift() ?? 'wf-exhausted'
    const record: StartRecord = { objective, workflowId, routeOverride }
    seen.push(record)
    let stop: (reason: string) => void = () => undefined
    const canceled = new Promise<string>((resolve) => {
      stop = resolve
    })
    return {
      workflowId,
      outcome: run(record, canceled),
      cancel: (reason: string): void => {
        stop(reason)
      },
    }
  }
}

let servers: HarnessControlServer[] = []

/**
 * Start a server on an ephemeral loopback port.
 * @param options - what the server runs and reads.
 * @returns the server and the base URL to call it on.
 */
async function serve(options: ControlServerOptions): Promise<{
  server: HarnessControlServer
  base: string
  auth: Record<string, string>
}> {
  const server = new HarnessControlServer(options)
  servers.push(server)
  const { host, port } = await server.listen()
  return {
    server,
    base: `http://${host}:${String(port)}`,
    auth: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
  }
}

/**
 * Post one objective and read the status the server answered with.
 * @param base - the server's base URL.
 * @param auth - the authorised headers.
 * @param body - the request body.
 * @returns the HTTP status and the parsed control status.
 */
async function post(
  base: string,
  auth: Record<string, string>,
  body: unknown = OBJECTIVE,
): Promise<{ code: number; status: ControlWorkflowStatus }> {
  const response = await fetch(`${base}/workflows`, {
    method: 'POST', headers: auth, body: JSON.stringify(body),
  })
  return { code: response.status, status: (await response.json()) as ControlWorkflowStatus }
}

afterEach(async () => {
  const open = servers
  servers = []
  await Promise.all(open.map(async server => server.dispose()))
})

describe('what the control server will bind', () => {
  it('refuses any address that is not loopback', () => {
    expect(() => new HarnessControlServer({ start: starter(['wf-1']), host: '0.0.0.0' }))
      .toThrow(ControlError)
    expect(() => new HarnessControlServer({ start: starter(['wf-1']), host: '10.0.0.4' }))
      .toThrow(/loopback/)
  })

  it('mints a token per process and refuses a request that does not carry it', async () => {
    const { base } = await serve({ start: starter(['wf-1']) })

    const health = await fetch(`${base}/health`)
    const workflows = await fetch(`${base}/workflows`, { method: 'POST', body: '{}' })

    expect(health.status).toBe(200)
    expect(workflows.status).toBe(401)
  })
})

describe('an objective the server will not run', () => {
  it('refuses a missing field and a value outside its closed set', async () => {
    const { base, auth } = await serve({ start: starter(['wf-1']) })

    const missing = await post(base, auth, { ...OBJECTIVE, requirement: '  ' })
    const unknownRisk = await post(base, auth, { ...OBJECTIVE, risk: 'apocalyptic' })
    const notJson = await fetch(`${base}/workflows`, { method: 'POST', headers: auth, body: 'nope' })

    expect(missing.code).toBe(400)
    expect(unknownRisk.code).toBe(400)
    expect(notJson.status).toBe(400)
    expect((missing.status as unknown as { error: string }).error).toBe('invalid-objective')
  })

  it('refuses an objective that named no approved Spec and Plan', async () => {
    // Conformance judges the implementation against approved documents. An
    // objective without them would reach that stage with nothing to judge it
    // by, so the refusal belongs here, before a workflow id exists.
    const { base, auth } = await serve({ start: starter(['wf-1']) })
    const { approvedArtifacts: _dropped, ...bare } = OBJECTIVE

    const missing = await post(base, auth, bare)
    const malformed = await post(base, auth, {
      ...OBJECTIVE,
      approvedArtifacts: { spec: { path: '/etc/passwd', sha256: 'nope' }, plan: OBJECTIVE.approvedArtifacts.plan },
    })

    expect(missing.code).toBe(400)
    expect(malformed.code).toBe(400)
    expect((malformed.status as unknown as { error: string }).error).toBe('invalid-objective')
    // The rejection is logged, and a path is a place a secret can hide.
    expect(JSON.stringify(malformed.status)).not.toContain('/etc/passwd')
  })

  it('starts nothing when the objective is refused', async () => {
    const seen: StartRecord[] = []
    const { base, auth } = await serve({ start: starter(['wf-1'], undefined, seen) })

    await post(base, auth, { ...OBJECTIVE, cwd: '' })

    expect(seen).toEqual([])
  })
})

describe('run, status and cancel', () => {
  it('answers with the id the Harness minted, not the one the objective carries', async () => {
    const { base, auth } = await serve({ start: starter(['wf-run-1']) })

    const created = await post(base, auth)
    const read = await fetch(`${base}/workflows/${created.status.workflowId}`, { headers: auth })
    const status = (await read.json()) as ControlWorkflowStatus

    expect(created.code).toBe(202)
    expect(created.status.workflowId).toBe('wf-run-1')
    // The objective's own id is carried, and it is not the identity. A caller
    // that addressed `obj-1` would be naming a thing that may have been
    // attempted several times.
    expect(created.status.objectiveId).toBe('obj-1')
    expect(created.status.state).toBe('running')
    expect(status.state).toBe('completed')
    expect(status.verdict).toBe('PASS')
    expect(status.stages.map(stage => stage.stageId)).toEqual(['implement-1'])
  })

  it('gives the same objective posted twice two ids that answer separately', async () => {
    const { base, auth } = await serve({
      start: starter(['wf-run-1', 'wf-run-2'], async (record) => {
        const finished = outcome(record.workflowId, record.objective.id)
        return record.workflowId === 'wf-run-2'
          ? { ...finished, state: 'failed', verdict: 'FAIL', summary: 'the retry failed', stages: [] }
          : finished
      }),
    })

    const first = await post(base, auth)
    await fetch(`${base}/workflows/${first.status.workflowId}`, { headers: auth })
    const second = await post(base, auth)
    const one = (await (await fetch(`${base}/workflows/wf-run-1`, { headers: auth })).json()) as ControlWorkflowStatus
    const two = (await (await fetch(`${base}/workflows/wf-run-2`, { headers: auth })).json()) as ControlWorkflowStatus

    expect(first.status.workflowId).not.toBe(second.status.workflowId)
    expect(first.status.objectiveId).toBe(second.status.objectiveId)
    // Each id answers for its own attempt only. A status that merged them would
    // report the retry's failure against the attempt that passed.
    expect(one.verdict).toBe('PASS')
    expect(one.stages.length).toBe(1)
    expect(two.verdict).toBe('FAIL')
    expect(two.stages).toEqual([])
  })

  it('cancels the owned run the generated id names, and waits for it to settle', async () => {
    let settled = false
    const { base, auth } = await serve({
      start: starter(['wf-run-1'], async (record, canceled) => {
        await canceled
        settled = true
        return { ...outcome(record.workflowId, record.objective.id), state: 'canceled', verdict: 'INCONCLUSIVE' }
      }),
    })

    const created = await post(base, auth)
    const canceled = await fetch(`${base}/workflows/${created.status.workflowId}/cancel`, {
      method: 'POST', headers: auth,
    })
    const status = (await canceled.json()) as ControlWorkflowStatus

    expect(settled).toBe(true)
    expect(status.state).toBe('canceled')
    expect(status.workflowId).toBe('wf-run-1')
  })

  it('answers 404 for a workflow it neither runs nor has a record of', async () => {
    const { base, auth } = await serve({ start: starter(['wf-run-1']) })

    const missing = await fetch(`${base}/workflows/wf-nobody`, { headers: auth })
    const cancel = await fetch(`${base}/workflows/wf-nobody/cancel`, { method: 'POST', headers: auth })

    expect(missing.status).toBe(404)
    expect(cancel.status).toBe(404)
    expect(((await missing.json()) as { error: string }).error).toBe('unknown-workflow')
  })

  it('keeps concurrent runs apart and refuses an id a starter handed out twice', async () => {
    const release: (() => void)[] = []
    const { base, auth } = await serve({
      start: starter(['wf-run-1', 'wf-run-2', 'wf-run-1'], async (record) => {
        await new Promise<void>((resolve) => {
          release.push(resolve)
        })
        return outcome(record.workflowId, record.objective.id)
      }),
    })

    await post(base, auth)
    await post(base, auth)
    const duplicate = await post(base, auth)

    // A starter that repeats a live id is broken, and continuing would give two
    // runs one status. The refusal is the server refusing to lose one of them.
    expect(duplicate.code).toBe(409)
    expect((await fetch(`${base}/workflows/wf-run-1`, { headers: auth })).status).toBe(200)
    expect((await fetch(`${base}/workflows/wf-run-2`, { headers: auth })).status).toBe(200)
    for (const resolve of release) resolve()
  })

  it('answers cancel on a finished run with its status rather than a 404', async () => {
    const { base, auth } = await serve({ start: starter(['wf-run-1']) })

    const created = await post(base, auth)
    await fetch(`${base}/workflows/${created.status.workflowId}`, { headers: auth })
    const canceled = await fetch(`${base}/workflows/${created.status.workflowId}/cancel`, {
      method: 'POST', headers: auth,
    })

    expect(canceled.status).toBe(200)
    expect(((await canceled.json()) as ControlWorkflowStatus).state).toBe('completed')
  })

  it('reports live runs on /health, not everything it has ever run', async () => {
    const { base, auth } = await serve({ start: starter(['wf-run-1']) })

    const created = await post(base, auth)
    await fetch(`${base}/workflows/${created.status.workflowId}`, { headers: auth })
    const health = (await (await fetch(`${base}/health`)).json()) as { workflows: number }

    expect(health.workflows).toBe(0)
  })
})

describe('what a restart may say', () => {
  it('surfaces an interrupted workflow instead of resuming it', async () => {
    const assessment: RestartAssessment = {
      workflowId: 'wf-earlier',
      objectiveId: 'obj-earlier',
      state: 'interrupted',
      verdict: 'INCONCLUSIVE',
      openStages: ['repair-1'],
      requiresWorldVerification: true,
      summary: 'a repair was in flight when the process stopped',
    }
    const seen: StartRecord[] = []
    const { base, auth } = await serve({
      start: starter(['wf-run-1'], undefined, seen),
      restart: async () => assessment,
    })

    const read = await fetch(`${base}/workflows/wf-earlier`, { headers: auth })
    const status = (await read.json()) as ControlWorkflowStatus

    expect(status.state).toBe('interrupted')
    expect(status.requiresWorldVerification).toBe(true)
    // The durable record names the objective; the status does not invent one
    // out of the execution id it was asked about.
    expect(status.objectiveId).toBe('obj-earlier')
    expect(seen).toEqual([])
  })

  it('reads a canceled run`s world check out of the durable log, not out of nothing', async () => {
    const { base, auth } = await serve({
      start: starter(['wf-run-1'], async (_record, canceled) => {
        const reason = await canceled
        throw new Error(reason)
      }),
      restart: async workflowId => ({
        workflowId,
        objectiveId: 'obj-1',
        state: 'interrupted',
        verdict: 'INCONCLUSIVE',
        openStages: [],
        // A delivery was in flight when the cancel landed.
        requiresWorldVerification: true,
        summary: 'capabilities still open: deliver-1:github-delivery',
      }),
    })

    const created = await post(base, auth)
    const canceled = await fetch(`${base}/workflows/${created.status.workflowId}/cancel`, {
      method: 'POST', headers: auth,
    })
    const status = (await canceled.json()) as ControlWorkflowStatus

    // A cancel is not proof that nothing happened. Reporting `false` here would
    // tell an operator their aborted delivery left no trace.
    expect(status.state).toBe('canceled')
    expect(status.requiresWorldVerification).toBe(true)
  })

  it('carries no event payload into the status it hands back', async () => {
    const { base, auth } = await serve({
      start: starter(['wf-run-1']),
      restart: async workflowId => ({
        workflowId,
        objectiveId: 'obj-earlier',
        state: 'interrupted',
        verdict: 'INCONCLUSIVE',
        openStages: ['deliver-1'],
        requiresWorldVerification: true,
        summary: 'workflow was interrupted; verify the world before retrying',
      }),
    })

    const read = await fetch(`${base}/workflows/wf-earlier`, { headers: auth })
    const status = (await read.json()) as ControlWorkflowStatus

    // The bounded schema and nothing else: no route payloads, no findings, no
    // capability records, nothing an event carried.
    expect(Object.keys(status).sort()).toStrictEqual([
      'executorStarts',
      'objectiveId',
      'repairCycles',
      'requiresWorldVerification',
      'stages',
      'state',
      'summary',
      'verdict',
      'workflowId',
    ])
  })
})

describe('what disposal owes', () => {
  it('cancels every owned run and waits for quiescence before closing', async () => {
    let running = 0
    const server = new HarnessControlServer({
      start: starter(['wf-run-1'], async (record, canceled) => {
        running += 1
        await canceled
        running -= 1
        return { ...outcome(record.workflowId, record.objective.id), state: 'canceled', verdict: 'INCONCLUSIVE' }
      }),
    })
    const { port } = await server.listen()
    const auth = { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' }
    await fetch(`http://127.0.0.1:${String(port)}/workflows`, {
      method: 'POST', headers: auth, body: JSON.stringify(OBJECTIVE),
    })

    await server.dispose()

    expect(running).toBe(0)
    await expect(fetch(`http://127.0.0.1:${String(port)}/health`)).rejects.toThrow()
  })
})

describe('what a status is allowed to carry', () => {
  it('bounds the summary and carries no provider output', async () => {
    const { base, auth, server } = await serve({
      start: starter(['wf-run-1'], async record => ({
        ...outcome(record.workflowId, record.objective.id),
        summary: 'x'.repeat(2000),
      })),
    })

    const created = await post(base, auth)
    const status = await server.statusOf(created.status.workflowId)

    expect(status.summary.length).toBeLessThanOrEqual(501)
    expect(JSON.stringify(status)).not.toContain('findings')
    expect(JSON.stringify(status)).not.toContain('evidence')
  })
})

/**
 * Wait for the server to hand a start to its starter.
 *
 * The POST answers 202 before the run begins, so a fixed sleep would be a
 * guess about scheduling that fails under load rather than a wait.
 * @param seen - where the starter records what it was given.
 */
async function started(seen: readonly unknown[]): Promise<void> {
  const deadline = Date.now() + 2000
  while (seen.length === 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('a start request that carries a human route override', () => {
  it('hands the override to the starter alongside the objective', async () => {
    const seen: StartRecord[] = []
    const { base, auth } = await serve({ start: starter(['wf-run-1'], undefined, seen) })
    const routeOverride = {
      role: 'review',
      executor: 'codex',
      semanticModelTier: 'codex.frontier',
      reasoningEffort: 'xhigh',
    }

    const response = await post(base, auth, { ...OBJECTIVE, routeOverride })

    expect(response.code).toBe(202)
    await started(seen)
    expect(seen.map(record => record.routeOverride)).toEqual([routeOverride])
  })

  it('starts nothing at all when the override is malformed', async () => {
    const seen: StartRecord[] = []
    const { base, auth } = await serve({ start: starter(['wf-run-1'], undefined, seen) })

    const response = await post(base, auth, {
      ...OBJECTIVE,
      routeOverride: { role: 'vibes', executor: 'codex' },
    })

    // A refusal, not a quiet fall back to the table: the caller asked for a
    // specific executor, and a status that said 'running' would not tell them
    // their request had been dropped.
    expect(response.code).toBe(400)
    expect(seen).toEqual([])
  })

  it('runs on the profile table when no override is sent', async () => {
    const seen: StartRecord[] = []
    const { base, auth } = await serve({ start: starter(['wf-run-1'], undefined, seen) })

    await post(base, auth)

    await started(seen)
    expect(seen.map(record => record.routeOverride)).toEqual([undefined])
  })
})

/**
 * Read one workflow's status back.
 * @param base - the server's base URL.
 * @param auth - the bearer header.
 * @param workflowId - the execution to read.
 * @returns the status the server rendered.
 */
async function readStatus(
  base: string,
  auth: Record<string, string>,
  workflowId: string,
): Promise<ControlWorkflowStatus> {
  const read = await fetch(base + '/workflows/' + workflowId, { headers: auth })
  return (await read.json()) as ControlWorkflowStatus
}

describe('what a status poll may say about conformance', () => {
  const CONFORMANCE = {
    specPath: 'docs/spec.md',
    specSha256: 'a'.repeat(64),
    planPath: 'docs/plan.md',
    planSha256: 'b'.repeat(64),
    expected: { spec: 2, plan: 2, dod: 8 },
    counts: { PASS: 12, MISSING: 0, PARTIAL: 0, FAIL: 0, BLOCKED: 0, INCONCLUSIVE: 0 },
    verdict: 'PASS' as const,
  }

  it('refuses a Spec path that climbs out of the repository', async () => {
    // An approved artifact is read back from disk mid-run. A path that escapes
    // the working tree would have the gate reading a document nobody approved,
    // and the refusal has to happen before a workflow id exists.
    const { base, auth } = await serve({ start: starter(['wf-1']) })
    for (const path of ['../../etc/shadow', 'docs/../../secrets.md', 'C:\keys\id_rsa']) {
      const refused = await post(base, auth, {
        ...OBJECTIVE,
        approvedArtifacts: { spec: { path, sha256: 'a'.repeat(64) }, plan: OBJECTIVE.approvedArtifacts.plan },
      })
      expect(refused.code, path).toBe(400)
      expect(JSON.stringify(refused.status), path).not.toContain(path)
    }
  })

  it('reports hashes, expected counts and a verdict, and nothing the model wrote', async () => {
    const { base, auth } = await serve({
      start: starter(['wf-1'], async record => ({
        ...outcome(record.workflowId, record.objective.id),
        conformance: CONFORMANCE,
      })),
    })
    await post(base, auth, OBJECTIVE)
    const status = await readStatus(base, auth, 'wf-1')

    expect(status.conformance).toEqual(CONFORMANCE)
  })

  it('says nothing about conformance for a run that never established it', async () => {
    // Absent rather than a zeroed summary: a reader must be able to tell a run
    // that has not been judged from one judged and found to satisfy nothing.
    const { base, auth } = await serve({ start: starter(['wf-1']) })
    await post(base, auth, OBJECTIVE)
    expect((await readStatus(base, auth, 'wf-1')).conformance).toBeUndefined()
  })

  it('carries no per-obligation text into a status a bridge may render', async () => {
    const { base, auth } = await serve({
      start: starter(['wf-1'], async record => ({
        ...outcome(record.workflowId, record.objective.id),
        conformance: {
          ...CONFORMANCE,
          items: [{ id: 'ND1', requirement: 'the free text a provider returned', summary: 'and its narration' }],
          transcript: 'what the model said',
        },
      } as never)),
    })
    await post(base, auth, OBJECTIVE)
    const rendered = JSON.stringify(await readStatus(base, auth, 'wf-1'))

    expect(rendered).not.toContain('narration')
    expect(rendered).not.toContain('transcript')
    expect(rendered).toContain('"verdict":"PASS"')
  })
})
