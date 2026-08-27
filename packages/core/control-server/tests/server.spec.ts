import { afterEach, describe, expect, it } from 'vitest'
import type { StageRouteOverride } from '@trick-harness/contracts'
import type { RestartAssessment, WorkflowOutcome } from '@trick-harness/engineering-workflow'
import { ControlError, HarnessControlServer } from '../src/index.ts'
import type { ControlServerOptions, ControlWorkflowStatus } from '../src/index.ts'

const OBJECTIVE = {
  id: 'wf-1',
  cwd: '/repo',
  requirement: 'add the thing',
  risk: 'low',
  workload: 'light',
  profileId: 'test',
}

/**
 * A finished workflow, as the runner would hand one back.
 * @param workflowId - the workflow the outcome belongs to.
 * @returns the outcome.
 */
function outcome(workflowId: string): WorkflowOutcome {
  return {
    workflowId,
    objectiveId: workflowId,
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

afterEach(async () => {
  const open = servers
  servers = []
  await Promise.all(open.map(async server => server.dispose()))
})

describe('what the control server will bind', () => {
  it('refuses any address that is not loopback', () => {
    expect(() => new HarnessControlServer({ start: async () => outcome('x'), host: '0.0.0.0' }))
      .toThrow(ControlError)
    expect(() => new HarnessControlServer({ start: async () => outcome('x'), host: '10.0.0.4' }))
      .toThrow(/loopback/)
  })

  it('mints a token per process and refuses a request that does not carry it', async () => {
    const { base } = await serve({ start: async () => outcome('wf-1') })

    const health = await fetch(`${base}/health`)
    const workflows = await fetch(`${base}/workflows`, { method: 'POST', body: '{}' })

    expect(health.status).toBe(200)
    expect(workflows.status).toBe(401)
  })
})

describe('an objective the server will not run', () => {
  it('refuses a missing field and a value outside its closed set', async () => {
    const { base, auth } = await serve({ start: async () => outcome('wf-1') })

    const missing = await fetch(`${base}/workflows`, {
      method: 'POST', headers: auth, body: JSON.stringify({ ...OBJECTIVE, requirement: '  ' }),
    })
    const unknownRisk = await fetch(`${base}/workflows`, {
      method: 'POST', headers: auth, body: JSON.stringify({ ...OBJECTIVE, risk: 'apocalyptic' }),
    })
    const notJson = await fetch(`${base}/workflows`, { method: 'POST', headers: auth, body: 'nope' })

    expect(missing.status).toBe(400)
    expect(unknownRisk.status).toBe(400)
    expect(notJson.status).toBe(400)
    expect(((await missing.json()) as { error: string }).error).toBe('invalid-objective')
  })

  it('starts nothing when the objective is refused', async () => {
    const started: string[] = []
    const { base, auth } = await serve({
      start: async (objective) => {
        started.push(objective.id)
        return outcome(objective.id)
      },
    })

    await fetch(`${base}/workflows`, {
      method: 'POST', headers: auth, body: JSON.stringify({ ...OBJECTIVE, cwd: '' }),
    })

    expect(started).toEqual([])
  })
})

describe('run, status and cancel', () => {
  it('returns a durable workflow id and then the finished projection', async () => {
    const { base, auth } = await serve({ start: async objective => outcome(objective.id) })

    const created = await fetch(`${base}/workflows`, {
      method: 'POST', headers: auth, body: JSON.stringify(OBJECTIVE),
    })
    const accepted = (await created.json()) as ControlWorkflowStatus
    const read = await fetch(`${base}/workflows/wf-1`, { headers: auth })
    const status = (await read.json()) as ControlWorkflowStatus

    expect(created.status).toBe(202)
    expect(accepted.workflowId).toBe('wf-1')
    expect(accepted.state).toBe('running')
    expect(status.state).toBe('completed')
    expect(status.verdict).toBe('PASS')
    expect(status.stages.map(stage => stage.stageId)).toEqual(['implement-1'])
  })

  it('cancels an owned run and waits for it to settle before answering', async () => {
    let settled = false
    const { base, auth } = await serve({
      start: async (objective, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            resolve()
          }, { once: true })
        })
        settled = true
        return { ...outcome(objective.id), state: 'canceled', verdict: 'INCONCLUSIVE' }
      },
    })

    await fetch(`${base}/workflows`, { method: 'POST', headers: auth, body: JSON.stringify(OBJECTIVE) })
    const canceled = await fetch(`${base}/workflows/wf-1/cancel`, { method: 'POST', headers: auth })
    const status = (await canceled.json()) as ControlWorkflowStatus

    expect(settled).toBe(true)
    expect(status.state).toBe('canceled')
  })

  it('answers 404 for a workflow it neither runs nor has a record of', async () => {
    const { base, auth } = await serve({ start: async objective => outcome(objective.id) })

    const missing = await fetch(`${base}/workflows/wf-nobody`, { headers: auth })
    const cancel = await fetch(`${base}/workflows/wf-nobody/cancel`, { method: 'POST', headers: auth })

    expect(missing.status).toBe(404)
    expect(cancel.status).toBe(404)
    expect(((await missing.json()) as { error: string }).error).toBe('unknown-workflow')
  })

  it('keeps concurrent workflow ids apart and refuses a duplicate id', async () => {
    const release = new Map<string, () => void>()
    const { base, auth } = await serve({
      start: async (objective) => {
        await new Promise<void>((resolve) => {
          release.set(objective.id, resolve)
        })
        return outcome(objective.id)
      },
    })

    await fetch(`${base}/workflows`, { method: 'POST', headers: auth, body: JSON.stringify(OBJECTIVE) })
    await fetch(`${base}/workflows`, {
      method: 'POST', headers: auth, body: JSON.stringify({ ...OBJECTIVE, id: 'wf-2' }),
    })
    const duplicate = await fetch(`${base}/workflows`, {
      method: 'POST', headers: auth, body: JSON.stringify(OBJECTIVE),
    })

    expect(duplicate.status).toBe(409)
    expect(((await fetch(`${base}/workflows/wf-1`, { headers: auth })).status)).toBe(200)
    expect(((await fetch(`${base}/workflows/wf-2`, { headers: auth })).status)).toBe(200)
    for (const resolve of release.values()) resolve()
  })

  it('lets a finished id be started again instead of holding 409 forever', async () => {
    const { base, auth } = await serve({ start: async objective => outcome(objective.id) })

    const first = await fetch(`${base}/workflows`, {
      method: 'POST', headers: auth, body: JSON.stringify(OBJECTIVE),
    })
    await fetch(`${base}/workflows/wf-1`, { headers: auth })
    const again = await fetch(`${base}/workflows`, {
      method: 'POST', headers: auth, body: JSON.stringify(OBJECTIVE),
    })

    expect(first.status).toBe(202)
    expect(again.status).toBe(202)
  })

  it('answers cancel on a finished run with its status rather than a 404', async () => {
    const { base, auth } = await serve({ start: async objective => outcome(objective.id) })

    await fetch(`${base}/workflows`, { method: 'POST', headers: auth, body: JSON.stringify(OBJECTIVE) })
    await fetch(`${base}/workflows/wf-1`, { headers: auth })
    const canceled = await fetch(`${base}/workflows/wf-1/cancel`, { method: 'POST', headers: auth })

    expect(canceled.status).toBe(200)
    expect(((await canceled.json()) as ControlWorkflowStatus).state).toBe('completed')
  })

  it('reports live runs on /health, not everything it has ever run', async () => {
    const { base, auth } = await serve({ start: async objective => outcome(objective.id) })

    await fetch(`${base}/workflows`, { method: 'POST', headers: auth, body: JSON.stringify(OBJECTIVE) })
    await fetch(`${base}/workflows/wf-1`, { headers: auth })
    const health = (await (await fetch(`${base}/health`)).json()) as { workflows: number }

    expect(health.workflows).toBe(0)
  })
})

describe('what a restart may say', () => {
  it('surfaces an interrupted workflow instead of resuming it', async () => {
    const assessment: RestartAssessment = {
      state: 'interrupted',
      verdict: 'INCONCLUSIVE',
      openStages: ['repair-1'],
      requiresWorldVerification: true,
      summary: 'a repair was in flight when the process stopped',
    }
    const started: string[] = []
    const { base, auth } = await serve({
      start: async (objective) => {
        started.push(objective.id)
        return outcome(objective.id)
      },
      restart: async () => assessment,
    })

    const read = await fetch(`${base}/workflows/wf-earlier`, { headers: auth })
    const status = (await read.json()) as ControlWorkflowStatus

    expect(status.state).toBe('interrupted')
    expect(status.requiresWorldVerification).toBe(true)
    expect(started).toEqual([])
  })
})

describe('what disposal owes', () => {
  it('cancels every owned run and waits for quiescence before closing', async () => {
    let running = 0
    const server = new HarnessControlServer({
      start: async (objective, signal) => {
        running += 1
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            resolve()
          }, { once: true })
        })
        running -= 1
        return { ...outcome(objective.id), state: 'canceled', verdict: 'INCONCLUSIVE' }
      },
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
      start: async objective => ({
        ...outcome(objective.id),
        summary: 'x'.repeat(2000),
      }),
    })

    await fetch(`${base}/workflows`, { method: 'POST', headers: auth, body: JSON.stringify(OBJECTIVE) })
    const status = await server.statusOf('wf-1')

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
    const seen: (StageRouteOverride | undefined)[] = []
    const { base, auth } = await serve({
      start: async (objective, _signal, routeOverride) => {
        seen.push(routeOverride)
        return outcome(objective.id)
      },
    })
    const routeOverride = {
      role: 'review',
      executor: 'codex',
      semanticModelTier: 'codex.frontier',
      reasoningEffort: 'xhigh',
    }

    const response = await fetch(`${base}/workflows`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ ...OBJECTIVE, routeOverride }),
    })

    expect(response.status).toBe(202)
    await started(seen)
    expect(seen).toEqual([routeOverride])
  })

  it('starts nothing at all when the override is malformed', async () => {
    let starts = 0
    const { base, auth } = await serve({
      start: async (objective) => { starts += 1; return outcome(objective.id) },
    })

    const response = await fetch(`${base}/workflows`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ ...OBJECTIVE, routeOverride: { role: 'vibes', executor: 'codex' } }),
    })

    // A refusal, not a quiet fall back to the table: the caller asked for a
    // specific executor, and a status that said 'running' would not tell them
    // their request had been dropped.
    expect(response.status).toBe(400)
    expect(starts).toBe(0)
  })

  it('runs on the profile table when no override is sent', async () => {
    const seen: (StageRouteOverride | undefined)[] = []
    const { base, auth } = await serve({
      start: async (objective, _signal, routeOverride) => {
        seen.push(routeOverride)
        return outcome(objective.id)
      },
    })

    await fetch(`${base}/workflows`, { method: 'POST', headers: auth, body: JSON.stringify(OBJECTIVE) })

    await started(seen)
    expect(seen).toEqual([undefined])
  })
})
