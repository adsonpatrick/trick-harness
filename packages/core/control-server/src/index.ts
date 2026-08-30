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
import {
  ContractError, RISKS, WORKLOADS, parseApprovedArtifactSet, parseStageRouteOverride,
} from '@trick-harness/contracts'
import type {
  CertificationStatusSummary,
  ChangeImpactStatusSummary,
  ConformanceStatusSummary,
  StageRouteOverride,
  WorkflowObjective,
} from '@trick-harness/contracts'
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
 * Read the human route override a start request may carry.
 *
 * Absent is the ordinary case and means the profile's table decides. Present
 * and malformed is a refusal, not a silent fall back to the table: a caller who
 * asked for a specific executor and got a different one would have no way to
 * tell from the status that their request was dropped.
 * @param payload - The decoded request body.
 * @returns The override, or `undefined` when the request carries none.
 * @throws {ControlError} when an override is present but not usable.
 */
export function readRouteOverride(payload: unknown): StageRouteOverride | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ControlError('invalid-objective', 400, 'the request body must be a JSON object')
  }
  const value = (payload as Record<string, unknown>)['routeOverride']
  if (value === undefined) return undefined
  try {
    return parseStageRouteOverride(value)
  } catch (error) {
    const detail = error instanceof ContractError ? error.path : 'routeOverride'
    throw new ControlError('invalid-objective', 400, `the route override is not usable: ${detail}`)
  }
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
    approvedArtifacts: readApprovedArtifacts(body['approvedArtifacts']),
  })
}

/**
 * Read the approved Spec and Plan the objective is opened against.
 *
 * Refused here rather than at the conformance stage: a run that started
 * without them would reach the stage that judges the implementation against
 * approved documents with no documents to judge it by, having already spent
 * every mutation the earlier stages performed.
 *
 * @param value - The `approvedArtifacts` field as posted.
 * @returns The approved artifact set.
 * @throws {ControlError} when the field is missing or malformed, naming the
 *   field path and quoting neither a path nor a hash.
 */
function readApprovedArtifacts(value: unknown): WorkflowObjective['approvedArtifacts'] {
  try {
    return parseApprovedArtifactSet(value, 'approvedArtifacts')
  }
  catch (error: unknown) {
    if (error instanceof ContractError) {
      throw new ControlError('invalid-objective', 400, `the objective's ${error.path} is not one this workflow can run`)
    }
    throw error
  }
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
    // Rebuilt field by field rather than carried: the outcome's summary is
    // derived from a provider's answer, and a spread would render whatever else
    // travelled with it into a status a bridge shows people.
    ...outcome.conformance === undefined ? {} : { conformance: conformanceOf(outcome.conformance) },
    ...outcome.changeImpact === undefined ? {} : { changeImpact: changeImpactOf(outcome.changeImpact) },
    ...outcome.certification === undefined ? {} : { certification: certificationOf(outcome.certification) },
  })
}

/**
 * Reduce a change-impact reading to the fields this surface may say out loud.
 *
 * Rebuilt field by field for the same reason conformance is: the reading came
 * from a reader that ran a Git command, and a spread would render whatever
 * else travelled back with it — a diff, a stderr line — into a status window.
 *
 * @param summary - What the run last resolved the change to be.
 * @returns The same fields, rebuilt.
 */
function changeImpactOf(summary: ChangeImpactStatusSummary): ChangeImpactStatusSummary {
  return Object.freeze({
    source: summary.source,
    effectiveRisk: summary.effectiveRisk,
    riskFloor: summary.riskFloor,
    writeVolume: summary.writeVolume,
    surfaces: Object.freeze([...summary.surfaces]),
    taskClasses: Object.freeze([...summary.taskClasses]),
    requiredCapabilities: Object.freeze([...summary.requiredCapabilities]),
    evidenceProfiles: Object.freeze([...summary.evidenceProfiles]),
    matchedRuleIds: Object.freeze([...summary.matchedRuleIds]),
    databaseMutation: summary.databaseMutation,
    pathCount: summary.pathCount,
    unplannedPathCount: summary.unplannedPathCount,
    unplannedPaths: Object.freeze([...summary.unplannedPaths]),
  })
}

/**
 * Reduce a certification to the fields this surface may say out loud.
 *
 * Rebuilt field by field like the readings above, and for a sharper reason: the
 * certification came back from a capability that talked to GitHub, and the one
 * thing that must never reach a status window is what authenticated it. The
 * target URL is dropped here too — a poller that renders a link is a poller
 * that can be steered.
 * @param summary - What the run last published about the branch.
 * @returns The three fields, rebuilt.
 */
function certificationOf(summary: CertificationStatusSummary): CertificationStatusSummary {
  return Object.freeze({
    state: summary.state,
    revision: summary.revision,
    externalId: summary.externalId,
  })
}

/**
 * Reduce a conformance reading to the fields this surface may say out loud.
 * @param summary - The reading the run established.
 * @returns The same fields, rebuilt.
 */
function conformanceOf(summary: ConformanceStatusSummary): ConformanceStatusSummary {
  return Object.freeze({
    specPath: summary.specPath,
    specSha256: summary.specSha256,
    planPath: summary.planPath,
    planSha256: summary.planSha256,
    expected: Object.freeze({ ...summary.expected }),
    counts: Object.freeze({ ...summary.counts }),
    verdict: summary.verdict,
  })
}

/** Project a durable restart assessment onto the same schema. */
function statusOfRestart(
  workflowId: string,
  assessment: RestartAssessment,
): ControlWorkflowStatus {
  return Object.freeze({
    workflowId,
    objectiveId: assessment.objectiveId,
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
  /** Ends the run; the server holds this rather than the runner that obeys it. */
  readonly cancel: (reason: string) => void
  readonly settled: Promise<ControlWorkflowStatus>
  /** Set when this server asked for the stop, so a cancel is not read as a failure. */
  canceled: boolean
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
    for (const run of live) {
      run.canceled = true
      run.cancel('the control server is being disposed')
    }
    await Promise.allSettled(live.map(run => run.settled))
    await new Promise<void>((resolve) => {
      this.#server.close(() => {
        resolve()
      })
    })
  }

  /**
   * Start one workflow this server will own.
   *
   * The identity comes back from the Harness, never from the payload. A caller
   * that could name its own workflow id could address somebody else's run, or
   * quietly continue a finished one's history; the objective it posts is what
   * it gets to decide.
   * @param objective - The objective to run.
   * @param routeOverride - One human routing choice for a single stage, if given.
   * @returns The status the caller sees immediately, naming the minted id.
   * @throws {ControlError} when the Harness hands back an id already running here.
   */
  startWorkflow(objective: WorkflowObjective, routeOverride?: StageRouteOverride): ControlWorkflowStatus {
    const started = this.#options.start(objective, routeOverride)
    const { workflowId } = started
    if (this.#runs.has(workflowId)) {
      // The Harness handed back an id this server is already running under,
      // which means its factory repeated one. The run it just started is ended
      // and its rejection absorbed rather than left to surface as an unhandled
      // one somewhere with no request to attribute it to.
      started.cancel('the control server was handed a workflow id already in use')
      started.outcome.catch(() => undefined)
      throw new ControlError('duplicate-workflow', 409, 'a workflow of that id is already running')
    }
    const settled = started.outcome
      .then(outcome => statusOfOutcome(outcome))
      .catch(async (error: unknown) => {
        const canceled = this.#runs.get(workflowId)?.canceled === true
        // A run that threw or was cancelled wrote no terminal end, so what it
        // may have left behind is a question only the durable log can answer.
        // Reading it back here rather than assuming `false` is what keeps a
        // cancelled delivery from being reported as having touched nothing.
        const assessment = await this.#options.restart?.(workflowId).catch(() => undefined)
        return Object.freeze({
          ...runningStatus(workflowId, objective.id),
          state: canceled ? ('canceled' as const) : ('failed' as const),
          summary: canceled
            ? 'the workflow was canceled'
            : `the workflow ended without a result: ${bounded(error instanceof Error ? error.message : 'unknown failure')}`,
          requiresWorldVerification: assessment?.requiresWorldVerification ?? false,
        })
      })
      .then((status) => {
        const stored = this.#runs.get(workflowId)
        if (stored !== undefined) stored.status = status
        this.#retire(workflowId, status)
        return status
      })
    const run: LiveRun = {
      objectiveId: objective.id,
      cancel: started.cancel,
      settled,
      canceled: false,
      status: runningStatus(workflowId, objective.id),
    }
    this.#runs.set(workflowId, run)
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
    run.canceled = true
    run.cancel('the caller canceled this workflow')
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
      const body = await readBody(request)
      // Both reads happen before a workflow id exists, so a malformed override
      // refuses the request outright rather than starting a run that would then
      // be routed by a table the caller did not ask for.
      const objective = readObjective(body)
      const override = readRouteOverride(body)
      send(response, 202, this.startWorkflow(objective, override))
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
