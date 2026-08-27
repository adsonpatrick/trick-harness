/**
 * A loopback HTTP surface for the Harness: start a workflow, ask how it is
 * going, ask it to stop.
 *
 * The server binds a loopback address and nothing else, and refuses to start if
 * asked to bind anything wider. That is the whole of its security model, plus a
 * bearer token minted per process and never written down: a control surface
 * that can spawn executors with write authority over a working tree is not a
 * thing to expose to a network, and there is no configuration here that would
 * let somebody do it by accident.
 *
 * A status is a projection, not a stream. It carries verdicts, summaries and
 * counters; it has no field for provider output, and none for a finding's
 * evidence. A restart surfaces a workflow with no recorded end as `interrupted`
 * rather than resuming it, because the log can say what was started and cannot
 * say what it did to the world.
 *
 * @module @trick-harness/control-server
 */

import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { RISKS, WORKLOADS } from '@trick-harness/contracts'
import type { WorkflowObjective } from '@trick-harness/contracts'
import type { RestartAssessment, WorkflowOutcome } from '@trick-harness/engineering-workflow'
import { ControlError, LOOPBACK_HOSTS } from './types.ts'
import type {
  ControlServerOptions,
  ControlStageStatus,
  ControlWorkflowStatus,
} from './types.ts'

export * from './types.ts'

/** Longest request body the server will read, in bytes. */
const MAX_BODY_BYTES = 64 * 1024

/** Longest summary the status projection carries. */
const MAX_SUMMARY_CHARS = 500

/** Most stages one status names; a longer run is truncated to the newest. */
const MAX_STAGES = 50

/**
 * Finished workflows whose status stays readable in memory.
 *
 * A run leaves the live set the moment it settles, so the liveness a supervisor
 * reads is the truth and a workflow id becomes reusable once nothing holds it.
 * Its last status is kept a while longer for the caller that asks right after,
 * and the oldest is dropped past this bound — the durable journal, not this
 * map, is what answers about a run this process no longer has.
 */
const MAX_FINISHED = 200

/** Bound one free-text field to what a status is for. */
function bounded(text: string): string {
  return text.length <= MAX_SUMMARY_CHARS ? text : `${text.slice(0, MAX_SUMMARY_CHARS)}…`
}

/** Read one required non-empty string from a decoded body. */
function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ControlError('invalid-objective', 400, `the objective must state a non-empty ${key}`)
  }
  return value
}

/**
 * Read a posted objective, refusing anything the workflow could not run.
 *
 * Validation happens before a workflow id exists, so a malformed request never
 * produces a durable record of a run that was never attempted.
 * @param payload - The decoded request body.
 * @returns The objective, structurally complete.
 * @throws {ControlError} when a field is missing or outside its closed set.
 */
export function readObjective(payload: unknown): WorkflowObjective {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ControlError('invalid-objective', 400, 'the request body must be a JSON object')
  }
  const body = payload as Record<string, unknown>
  const risk = requiredString(body, 'risk')
  const workload = requiredString(body, 'workload')
  if (!(RISKS as readonly string[]).includes(risk)) {
    throw new ControlError('invalid-objective', 400, 'the objective states a risk outside the approved set')
  }
  if (!(WORKLOADS as readonly string[]).includes(workload)) {
    throw new ControlError('invalid-objective', 400, 'the objective states a workload outside the approved set')
  }
  return Object.freeze({
    id: requiredString(body, 'id'),
    cwd: requiredString(body, 'cwd'),
    requirement: requiredString(body, 'requirement'),
    risk: risk as WorkflowObjective['risk'],
    workload: workload as WorkflowObjective['workload'],
    profileId: requiredString(body, 'profileId'),
  })
}

/** Project a finished workflow onto the bounded status schema. */
function statusOfOutcome(outcome: WorkflowOutcome): ControlWorkflowStatus {
  const stages: ControlStageStatus[] = outcome.stages.slice(-MAX_STAGES).map(stage => Object.freeze({
    stageId: stage.stageId,
    role: stage.role,
    executor: stage.executor,
    verdict: stage.verdict,
    summary: bounded(stage.summary),
  }))
  return Object.freeze({
    workflowId: outcome.workflowId,
    objectiveId: outcome.objectiveId,
    state: outcome.state,
    verdict: outcome.verdict,
    summary: bounded(outcome.summary),
    stages: Object.freeze(stages),
    repairCycles: outcome.repairCycles,
    executorStarts: outcome.executorStarts,
    requiresWorldVerification: false,
  })
}

/** Project a durable restart assessment onto the same schema. */
function statusOfRestart(
  workflowId: string,
  assessment: RestartAssessment,
): ControlWorkflowStatus {
  return Object.freeze({
    workflowId,
    objectiveId: workflowId,
    state: assessment.state === 'interrupted' ? 'interrupted' : 'completed',
    verdict: assessment.verdict,
    summary: bounded(assessment.summary),
    stages: Object.freeze([]),
    repairCycles: 0,
    executorStarts: 0,
    requiresWorldVerification: assessment.requiresWorldVerification,
  })
}

/** One workflow this process owns. */
interface LiveRun {
  readonly objectiveId: string
  readonly controller: AbortController
  readonly settled: Promise<ControlWorkflowStatus>
  status: ControlWorkflowStatus
}

/** The status a run has while it is still going. */
function runningStatus(workflowId: string, objectiveId: string): ControlWorkflowStatus {
  return Object.freeze({
    workflowId,
    objectiveId,
    state: 'running',
    verdict: 'INCONCLUSIVE',
    summary: 'the workflow is running',
    stages: Object.freeze([]),
    repairCycles: 0,
    executorStarts: 0,
    requiresWorldVerification: false,
  })
}

/** A loopback control surface over one Harness. */
export class HarnessControlServer {
  readonly #options: ControlServerOptions
  readonly #host: string
  readonly #token: string
  readonly #runs = new Map<string, LiveRun>()
  readonly #finished = new Map<string, ControlWorkflowStatus>()
  readonly #server: Server
  #port = 0

  /**
   * @param options - What to start, what to read back, and where to bind.
   * @throws {ControlError} when asked to bind anything but a loopback host.
   */
  constructor(options: ControlServerOptions) {
    const host = options.host ?? '127.0.0.1'
    if (!(LOOPBACK_HOSTS as readonly string[]).includes(host)) {
      throw new ControlError('not-loopback', 400, 'the control server binds loopback addresses only')
    }
    this.#options = options
    this.#host = host
    this.#token = options.token ?? randomUUID()
    this.#server = createServer((request, response) => {
      void this.#handle(request, response)
    })
  }

  /** The per-process bearer token; read here, never persisted. */
  get token(): string {
    return this.#token
  }

  /** The bound port, or `0` before {@link listen}. */
  get port(): number {
    return this.#port
  }

  /**
   * Bind the loopback socket.
   * @returns The host and port actually bound.
   */
  async listen(): Promise<{ host: string; port: number }> {
    await new Promise<void>((resolve, reject) => {
      this.#server.once('error', reject)
      this.#server.listen(this.#options.port ?? 0, this.#host, () => {
        resolve()
      })
    })
    const address = this.#server.address()
    this.#port = typeof address === 'object' && address !== null ? address.port : 0
    return { host: this.#host, port: this.#port }
  }

  /**
   * Cancel every owned run, wait for it to settle, and close the socket.
   *
   * The wait is the point. Closing the listener while an executor is still
   * running would leave a process tree nobody owns and a working tree nobody is
   * watching, so disposal is not finished until every run it started has come
   * back with something.
   */
  async dispose(): Promise<void> {
    // Snapshotted before the first abort, because a run that settles between
    // the abort and the wait retires itself out of the live set, and disposal
    // would then return without having waited for the one it just canceled.
    const live = [...this.#runs.values()]
    for (const run of live) run.controller.abort()
    await Promise.allSettled(live.map(run => run.settled))
    await new Promise<void>((resolve) => {
      this.#server.close(() => {
        resolve()
      })
    })
  }

  /**
   * Start one workflow this server will own.
   * @param objective - The objective to run.
   * @returns The status the caller sees immediately.
   * @throws {ControlError} when a workflow of that id is already running here.
   */
  startWorkflow(objective: WorkflowObjective): ControlWorkflowStatus {
    if (this.#runs.has(objective.id)) {
      throw new ControlError('duplicate-workflow', 409, 'a workflow of that id is already running')
    }
    const controller = new AbortController()
    const settled = Promise.resolve()
      .then(async () => statusOfOutcome(await this.#options.start(objective, controller.signal)))
      .catch((error: unknown) => Object.freeze({
        ...runningStatus(objective.id, objective.id),
        state: controller.signal.aborted ? ('canceled' as const) : ('failed' as const),
        summary: controller.signal.aborted
          ? 'the workflow was canceled'
          : `the workflow ended without a result: ${bounded(error instanceof Error ? error.message : 'unknown failure')}`,
      }))
      .then((status) => {
        const stored = this.#runs.get(objective.id)
        if (stored !== undefined) stored.status = status
        this.#retire(objective.id, status)
        return status
      })
    const run: LiveRun = {
      objectiveId: objective.id,
      controller,
      settled,
      status: runningStatus(objective.id, objective.id),
    }
    this.#runs.set(objective.id, run)
    return run.status
  }

  /**
   * Move a settled run out of the live set, keeping its last status.
   *
   * Retiring rather than holding is what keeps a long-lived server honest: the
   * live count stays the count of runs actually going, and an id that finished
   * can be run again instead of colliding with its own record forever.
   * @param workflowId - The workflow that settled.
   * @param status - The status it settled on.
   */
  #retire(workflowId: string, status: ControlWorkflowStatus): void {
    this.#runs.delete(workflowId)
    this.#finished.set(workflowId, status)
    while (this.#finished.size > MAX_FINISHED) {
      const oldest = this.#finished.keys().next()
      if (oldest.done === true) break
      this.#finished.delete(oldest.value)
    }
  }

  /**
   * Read a workflow's status: the live run if this process owns it, the last
   * status if it finished here, the durable projection otherwise.
   * @param workflowId - The workflow to read.
   * @returns The bounded status.
   * @throws {ControlError} when no live run and no durable record names it.
   */
  async statusOf(workflowId: string): Promise<ControlWorkflowStatus> {
    const run = this.#runs.get(workflowId)
    if (run !== undefined) return run.status
    const finished = this.#finished.get(workflowId)
    if (finished !== undefined) return finished
    const assessment = await this.#options.restart?.(workflowId)
    if (assessment === undefined) {
      throw new ControlError('unknown-workflow', 404, 'no workflow of that id is running or recorded')
    }
    return statusOfRestart(workflowId, assessment)
  }

  /**
   * Cancel one owned workflow and wait for it to settle.
   * @param workflowId - The workflow to cancel.
   * @returns The status it settled on.
   * @throws {ControlError} when this process is not running that workflow.
   */
  async cancelWorkflow(workflowId: string): Promise<ControlWorkflowStatus> {
    const run = this.#runs.get(workflowId)
    if (run === undefined) {
      // A run that already finished is not an error to cancel; it is a caller
      // that asked a moment too late, and the status it settled on is the
      // honest answer to what happened to it.
      const finished = this.#finished.get(workflowId)
      if (finished !== undefined) return finished
      throw new ControlError('unknown-workflow', 404, 'no workflow of that id is running here')
    }
    run.controller.abort()
    return await run.settled
  }

  /** Route one request, turning any refusal into a status code and a code word. */
  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      await this.#route(request, response)
    } catch (error) {
      if (error instanceof ControlError) {
        send(response, error.status, { error: error.code, message: error.message })
        return
      }
      send(response, 500, { error: 'unavailable', message: 'the control server could not serve the request' })
    }
  }

  /** Dispatch one request to the handler that owns its path. */
  async #route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = (request.url ?? '/').split('?')[0] ?? '/'
    const method = request.method ?? 'GET'

    if (method === 'GET' && path === '/health') {
      send(response, 200, { status: 'ok', workflows: this.#runs.size })
      return
    }

    this.#authorize(request)

    if (method === 'POST' && path === '/workflows') {
      const objective = readObjective(await readBody(request))
      send(response, 202, this.startWorkflow(objective))
      return
    }

    const cancel = /^\/workflows\/([^/]+)\/cancel$/.exec(path)
    if (method === 'POST' && cancel?.[1] !== undefined) {
      send(response, 200, await this.cancelWorkflow(decodeURIComponent(cancel[1])))
      return
    }

    const status = /^\/workflows\/([^/]+)$/.exec(path)
    if (method === 'GET' && status?.[1] !== undefined) {
      send(response, 200, await this.statusOf(decodeURIComponent(status[1])))
      return
    }

    throw new ControlError('unknown-workflow', 404, 'no such control endpoint')
  }

  /** Refuse anything that does not carry this process's token. */
  #authorize(request: IncomingMessage): void {
    const header = request.headers.authorization ?? ''
    if (header !== `Bearer ${this.#token}`) {
      throw new ControlError('unauthorized', 401, 'the request did not carry this process\'s control token')
    }
  }
}

/** Write one JSON response. */
function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(payload)
}

/**
 * Read a bounded JSON body.
 * @param request - The incoming request.
 * @returns The decoded body.
 * @throws {ControlError} when the body is too large or is not JSON.
 */
async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) {
      throw new ControlError('invalid-objective', 413, 'the request body is larger than the control server accepts')
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw new ControlError('invalid-objective', 400, 'the request body is not valid JSON')
  }
}
