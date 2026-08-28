/**
 * Minimal Codex app-server 0.147.0 protocol adapter. The shared JSON-RPC
 * transport owns framing and request correlation; this module owns only the
 * product methods, current thread/turn association, unattended approval
 * responses, and terminal-answer selection.
 *
 * @module @deepseek-ai/dsh-subagent-codex/wire
 */

import type { Readable, Writable } from 'node:stream'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import type { CodexPermissionMode, CodexRouting } from './run.ts'

type JsonObject = Record<string, unknown>

/** Product facts owned by the Codex wire after publication. */
export interface CodexWireFailureFacts {
  readonly stage: 'turn-start' | 'turn'
  readonly category: string
  readonly httpStatus?: number | undefined
}

const THREAD_PERMISSION_PARAMS: Readonly<Record<CodexPermissionMode, JsonObject>> = {
  never: { approvalPolicy: 'never' },
  'approve-for-me': {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
    sandbox: 'workspace-write',
  },
  'dangerously-bypass-approvals-and-sandbox': {
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  },
}

const STDERR_PERMISSION_SIGNATURES = [
  {
    text: 'approval policy is Never; reject command',
    request: 'command execution',
    decision: 'denied',
    reason: 'Codex rejected an escalation because the selected policy never asks for approval',
  },
  {
    text: 'recorded sandbox violation:',
    request: 'sandbox execution',
    decision: 'failed',
    reason: 'Codex reported a sandbox violation',
  },
] as const

const STDERR_SIGNATURE_TAIL_CHARS = Math.max(
  ...STDERR_PERMISSION_SIGNATURES.map(signature => signature.text.length),
) - 1

function stderrSignatureTail(value: string): string {
  for (
    let length = Math.min(STDERR_SIGNATURE_TAIL_CHARS, value.length)
    ; length > 0
    ; length -= 1
  ) {
    const tail = value.slice(-length)
    if (STDERR_PERMISSION_SIGNATURES.some(signature =>
      tail.length < signature.text.length && signature.text.startsWith(tail))) {
      return tail
    }
  }
  return ''
}

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`subagent-codex: app-server returned invalid ${label}`)
  }
  return value as JsonObject
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`subagent-codex: app-server returned invalid ${label}`)
  }
  return value
}

/** One entry of the authenticated Codex model catalogue. */
export interface CodexCatalogModel {
  /** The id a route names. */
  readonly id: string
  /** The reasoning efforts this model advertises, which may be empty. */
  readonly reasoningEfforts: readonly string[]
}

/** Read one `model/list` entry, holding it to the pinned `Model` shape. */
function catalogModel(value: unknown): CodexCatalogModel {
  const entry = object(value, 'model/list entry')
  const efforts = entry.supportedReasoningEfforts
  if (!Array.isArray(efforts)) {
    throw new Error('subagent-codex: app-server returned invalid model/list entry')
  }
  return {
    id: string(entry.id, 'model/list entry id'),
    reasoningEfforts: efforts.map(effort =>
      string(object(effort, 'model/list entry effort').reasoningEffort, 'model/list entry effort')),
  }
}

function unattendedDecision(params: JsonObject): 'cancel' | 'decline' {
  const available = params.availableDecisions
  if (available === undefined || available === null) return 'decline'
  if (Array.isArray(available)) {
    if (available.includes('cancel')) return 'cancel'
    if (available.includes('decline')) return 'decline'
  }
  throw new Error('subagent-codex: app-server offered no unattended approval decision')
}

function numericHttpStatus(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value <= 65_535
    ? value
    : undefined
}

function objectFailureInfo(value: JsonObject): {
  readonly category: string
  readonly httpStatus?: number | undefined
} {
  const keys = Object.keys(value)
  const category = keys[0]
  if (keys.length !== 1 || category === undefined) {
    return { category: 'unknown' }
  }
  const detail = value[category]
  if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) {
    return { category: 'unknown' }
  }
  const fields = detail as JsonObject
  switch (category) {
    case 'httpConnectionFailed':
    case 'responseStreamConnectionFailed':
    case 'responseStreamDisconnected':
    case 'responseTooManyFailedAttempts':
    {
      const httpStatus = numericHttpStatus(fields.httpStatusCode)
      return httpStatus === undefined
        ? { category }
        : { category, httpStatus }
    }
    case 'activeTurnNotSteerable':
      return { category }
    default:
      return { category: 'unknown' }
  }
}

function failureInfo(turn: JsonObject): {
  readonly category: string
  readonly httpStatus?: number | undefined
} {
  if (turn.status !== 'failed') return { category: 'unknown' }
  const error = turn.error
  if (error === null || typeof error !== 'object' || Array.isArray(error)) {
    return { category: 'unknown' }
  }
  const info = (error as JsonObject).codexErrorInfo
  if (typeof info === 'string') {
    switch (info) {
      case 'contextWindowExceeded':
      case 'sessionBudgetExceeded':
      case 'usageLimitExceeded':
      case 'serverOverloaded':
      case 'cyberPolicy':
      case 'internalServerError':
      case 'unauthorized':
      case 'badRequest':
      case 'threadRollbackFailed':
      case 'sandboxError':
      case 'other':
        return { category: info }
      default:
        return { category: 'unknown' }
    }
  }
  return info !== null && typeof info === 'object' && !Array.isArray(info)
    ? objectFailureInfo(info as JsonObject)
    : { category: 'unknown' }
}

function unattendedDiagnostic(
  mode: CodexPermissionMode,
  request: 'command approval' | 'file approval' | 'permission grant' | 'user input' | 'MCP elicitation' | 'command execution' | 'file change' | 'sandbox execution',
  decision: 'cancelled' | 'declined' | 'denied' | 'empty response' | 'failed',
  reason: string,
): string {
  return `Codex unattended decision (mode: ${mode}; request: ${request}; decision: ${decision}): ${reason}`
}

function thrown(value: unknown): Error {
  /* v8 ignore next -- typed protocol and stream failures reject with Error. */
  return value instanceof Error ? value : new Error(String(value))
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(`subagent-codex: app-server request aborted: ${String(signal.reason)}`)
}

async function raceAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void pending.catch(() => {})
    throw abortError(signal)
  }
  let rejectAbort!: (error: Error) => void
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const onAbort = (): void => { rejectAbort(abortError(signal)) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([pending, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * One app-server connection and its single ephemeral thread/turn.
 *
 * The class deliberately exposes no generic request surface. Supporting
 * another product method must first become part of the provider contract.
 */
export class CodexAppServerWire {
  private readonly transport: JsonRpcLineTransport
  private readonly fatal = Promise.withResolvers<never>()
  private threadId: string | undefined
  private turnId: string | undefined
  private pendingTurnId: string | undefined
  private turnCompleted: PromiseWithResolvers<{
    readonly params: JsonObject
    readonly order: number
  }> | undefined
  private readonly earlyTurnNotifications: Array<{
    readonly method: string
    readonly params: JsonObject
    readonly order: number
  }> = []
  private lastFinalAnswer: string | undefined
  private lastUnphasedAnswer: string | undefined
  private diagnostic: string | undefined
  private failure: CodexWireFailureFacts | undefined
  private diagnosticOrder = 0
  private observationOrder = 0
  private pendingDiagnostic: {
    readonly order: number
    readonly request: Parameters<typeof unattendedDiagnostic>[1]
    readonly decision: Parameters<typeof unattendedDiagnostic>[2]
    readonly reason: string
  } | undefined
  private stderrTail = ''
  private inputEnded = false
  private terminalObserved = false
  private closed = false

  constructor(
    private readonly input: Readable,
    output: Writable,
    private readonly permissionMode: CodexPermissionMode,
    private readonly routing: CodexRouting = {},
  ) {
    this.transport = new JsonRpcLineTransport(input, output)
    // Fatal protocol state can arrive after the current guarded operation has
    // already settled. Keep the shared rejection observed without inserting
    // another promise-adoption hop into active races.
    void this.fatal.promise.catch(() => {})
    this.transport.onRequest((method, params) => this.handleServerRequest(method, params))
    this.transport.onNotification((method, params) => {
      try {
        this.handleNotification(method, params)
      } catch (error: unknown) {
        this.fail(thrown(error))
      }
    })
    this.input.on('error', this.onInputError)
    this.input.on('end', this.onInputEnd)
    // Pipe errors can race protocol closure and process teardown. Retain both
    // error listeners for the lifetime of their per-run streams so no late
    // EPIPE or read failure becomes an unhandled EventEmitter error.
    output.on('error', this.onOutputError)
  }

  /** Start reading app-server frames. */
  start(): void {
    this.transport.start()
  }

  /**
   * Whether protocol output ended before a terminal turn notification.
   * @returns `true` only for an early protocol close without a terminal turn.
   */
  endedBeforeTerminal(): boolean {
    return this.inputEnded && !this.terminalObserved
  }

  /**
   * Perform the required app-server initialize/initialized handshake.
   * @param signal - unpublished-start cancellation.
   */
  async initialize(signal: AbortSignal): Promise<void> {
    object(await this.guarded(this.transport.request('initialize', {
      clientInfo: {
        name: 'deepseek-harness',
        title: 'DeepSeek Harness',
        version: '0.0.1',
      },
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
      },
    }, signal), signal), 'initialize response')
    this.transport.notify('initialized')
    await this.guarded(this.transport.flush(), signal)
  }

  /**
   * Read the authenticated model catalogue.
   *
   * The one read-only product method on this wire, and it stays read-only in a
   * way worth stating: it needs no thread, starts no turn, spends no tokens and
   * writes nothing to the account. A deployment can therefore check at boot
   * that the models its policy routes to actually exist for the signed-in user,
   * rather than discovering it at the stage that needed one.
   *
   * Shapes follow the app-server JSON schema generated from the pinned
   * `@openai/codex` build (`codex app-server generate-json-schema`), not from
   * upstream's current types: `ModelListParams` carries an optional cursor and
   * `ModelListResponse` carries `data` plus an optional `nextCursor`.
   *
   * @param signal - cancellation for the whole paged read.
   * @returns every advertised model id and the reasoning efforts it supports.
   */
  async listModels(signal: AbortSignal): Promise<readonly CodexCatalogModel[]> {
    const models: CodexCatalogModel[] = []
    const seenCursors = new Set<string>()
    let cursor: string | undefined
    for (;;) {
      const params: JsonObject = cursor === undefined ? {} : { cursor }
      const response = object(
        await this.guarded(this.transport.request('model/list', params, signal), signal),
        'model/list response',
      )
      const data = response.data
      if (!Array.isArray(data)) {
        throw new Error('subagent-codex: app-server returned invalid model/list response')
      }
      for (const entry of data) models.push(catalogModel(entry))
      const next = response.nextCursor
      if (next === undefined || next === null) return models
      cursor = string(next, 'model/list cursor')
      // A server that keeps handing back the same cursor would page forever.
      // Refusing is better than truncating: a catalogue silently cut short
      // would fail a tier the account can actually serve.
      if (seenCursors.has(cursor)) {
        throw new Error('subagent-codex: app-server repeated a model/list cursor')
      }
      seenCursors.add(cursor)
    }
  }

  /**
   * Create the run's private ephemeral thread and retain its identity.
   * @param cwd - parent Session workspace.
   * @param signal - unpublished-start cancellation.
   */
  async startThread(cwd: string, signal: AbortSignal): Promise<void> {
    const response = object(await this.guarded(this.transport.request('thread/start', {
      cwd,
      ephemeral: true,
      ...THREAD_PERMISSION_PARAMS[this.permissionMode],
      // A routed sandbox is applied last because it is the more specific
      // decision: the deployment's permission mode says how a run is
      // supervised, and the route says what this one run may reach.
      //
      // What routing can and cannot do, precisely. It can never reach
      // `danger-full-access`, which stays exclusive to the deployment-owned
      // bypass mode — so against that mode a route only ever narrows. Against
      // `approve-for-me` it can narrow to `read-only`. Against `never`, which
      // emits no sandbox at all and leaves the choice to the user's own Codex
      // configuration, a routed `workspace-write` can grant more authority than
      // that configuration would have: an unrouted run under `never` inherits
      // the user's setting, and a routed one states its own. That is the
      // intended contract — the route is the authority decision for the run —
      // but it is a grant, not merely a restriction, and is written down here
      // as one.

      ...this.routing.sandbox === undefined ? {} : { sandbox: this.routing.sandbox },
    }, signal), signal), 'thread/start response')
    const thread = object(response.thread, 'thread/start thread')
    const id = string(thread.id, 'thread/start thread id')
    if (thread.ephemeral !== true) {
      throw new Error('subagent-codex: app-server did not create an ephemeral thread')
    }
    this.threadId = id
  }

  /**
   * Submit the one text-only task and wait for this thread/turn's authoritative
   * terminal notification.
   * @param texts - already validated task text blocks.
   * @param signal - local cancellation for the published run.
   * @returns the shared subagent result.
   */
  async runTurn(
    texts: readonly string[],
    signal: AbortSignal,
  ): Promise<SubagentResult> {
    const completion = Promise.withResolvers<{
      readonly params: JsonObject
      readonly order: number
    }>()
    this.turnCompleted = completion
    const threadId = this.threadId as string
    try {
      const response = object(await this.guarded(this.transport.request('turn/start', {
        threadId,
        input: texts.map(text => ({ type: 'text', text, text_elements: [] })),
        // `model` and `effort` are the two optional `TurnStartParams` fields
        // verified against the pinned app-server schema. They are omitted
        // entirely when unrouted so an unrouted run emits the exact frame it
        // emitted before this seam existed, and so neither field is ever sent
        // as an explicit null the server would read as "clear the override".
        ...this.routing.model === undefined ? {} : { model: this.routing.model },
        ...this.routing.effort === undefined ? {} : { effort: this.routing.effort },
      }, signal), signal), 'turn/start response')
      const turn = object(response.turn, 'turn/start turn')
      this.commitTurnId(string(turn.id, 'turn/start turn id'))
    } catch (error: unknown) {
      this.recordFailure({ stage: 'turn-start', category: 'unknown' })
      throw error
    }

    let completed: {
      readonly params: JsonObject
      readonly order: number
    }
    let terminal: JsonObject
    try {
      completed = await this.guarded(completion.promise, signal)
      terminal = object(completed.params.turn, 'turn/completed turn')
    } catch (error: unknown) {
      this.recordFailure({ stage: 'turn', category: 'unknown' })
      throw error
    }
    const status = terminal.status
    if (status !== 'completed') {
      const parsed = failureInfo(terminal)
      this.recordFailure(parsed.httpStatus === undefined
        ? { stage: 'turn', category: parsed.category }
        : {
          stage: 'turn',
          category: parsed.category,
          httpStatus: parsed.httpStatus,
        })
      if (parsed.category === 'sandboxError') {
        this.recordDiagnostic(
          'sandbox execution',
          'failed',
          'Codex reported a sandbox failure',
          completed.order,
        )
      }
      if (parsed.category === 'contextWindowExceeded') {
        return { output: this.collectOutput(), stopReason: 'max-tokens' }
      }
      const detail = status === 'failed' ? `: ${parsed.category}` : ''
      throw new Error(`subagent-codex: Codex turn ended with status ${String(status)}${detail}`)
    }
    const output = this.collectOutput()
    if (output.length === 0) {
      this.recordFailure({ stage: 'turn', category: 'unknown' })
      throw new Error('subagent-codex: Codex completed without a final answer')
    }
    return { output, stopReason: 'completed' }
  }

  /**
   * Best-effort remote cancellation. Local settlement and process teardown
   * remain authoritative when the child no longer accepts protocol requests.
   */
  interrupt(): void {
    if (this.threadId === undefined || this.turnId === undefined || this.closed) return
    void this.transport.request('turn/interrupt', {
      threadId: this.threadId,
      turnId: this.turnId,
    }).catch(() => {})
  }

  /**
   * The best non-commentary answer observed so far, preserving exact bytes.
   * @returns the selected final or nullable-phase text block, if any.
   */
  collectOutput(): ContentBlock[] {
    const selected = this.lastFinalAnswer ?? this.lastUnphasedAnswer
    return selected !== undefined && selected.trim().length > 0
      ? [{ type: 'text', text: selected }]
      : []
  }

  /**
   * The latest safe unattended permission fact observed for this run.
   * @returns provider-authored diagnostic text, when one was observed.
   */
  collectDiagnostic(): string | undefined {
    return this.diagnostic
  }

  /**
   * The structured failure fact observed for this published turn.
   * Call only after a non-completed return or rejection from {@link runTurn}.
   * @returns the fixed stage/category pair and optional HTTP status.
   */
  collectFailure(): CodexWireFailureFacts {
    return this.failure as CodexWireFailureFacts
  }

  /**
   * Observe product stderr while retaining only enough tail to recognize fixed
   * permission signatures. The raw text is never copied into the diagnostic.
   * @param chunk - one decoded stderr chunk already forwarded to the host.
   */
  observeStderr(chunk: string): void {
    const observed = `${this.stderrTail}${chunk}`
    let latestIndex = -1
    let latest: (typeof STDERR_PERMISSION_SIGNATURES)[number] | undefined
    for (const signature of STDERR_PERMISSION_SIGNATURES) {
      const index = observed.lastIndexOf(signature.text)
      if (index > latestIndex) {
        latestIndex = index
        latest = signature
      }
    }
    if (latest !== undefined) {
      this.recordDiagnostic(latest.request, latest.decision, latest.reason)
    }
    this.stderrTail = stderrSignatureTail(observed)
  }

  /** Detach JSON-RPC listeners and reject outstanding requests. Idempotent. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.input.off('end', this.onInputEnd)
    this.transport.close()
  }

  private async guarded<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    const withFatal = Promise.race([this.fatal.promise, pending])
    return raceAbort(withFatal, signal)
  }

  private fail(error: Error): void {
    this.fatal.reject(error)
  }

  private readonly onInputError = (error: Error): void => {
    this.fail(error)
  }

  private readonly onOutputError = (error: Error): void => {
    this.fail(error)
  }

  private readonly onInputEnd = (): void => {
    this.inputEnded = true
    this.fail(new Error('subagent-codex: app-server protocol stream closed'))
  }

  private observePendingTurnId(id: string): void {
    if (this.turnCompleted === undefined) {
      throw new Error('subagent-codex: app-server referenced a turn before turn/start')
    }
    if (this.pendingTurnId !== undefined && this.pendingTurnId !== id) {
      throw new Error('subagent-codex: app-server referenced conflicting turns')
    }
    this.pendingTurnId = id
  }

  private commitTurnId(id: string): void {
    if (this.pendingTurnId !== undefined && this.pendingTurnId !== id) {
      throw new Error('subagent-codex: turn/start response did not match the active turn')
    }
    this.turnId = id
    const pendingDiagnostic = this.pendingDiagnostic
    this.pendingDiagnostic = undefined
    if (pendingDiagnostic !== undefined) {
      this.recordDiagnostic(
        pendingDiagnostic.request,
        pendingDiagnostic.decision,
        pendingDiagnostic.reason,
        pendingDiagnostic.order,
      )
    }
    const notifications = this.earlyTurnNotifications.splice(0)
    for (const notification of notifications) {
      this.handleNotification(
        notification.method,
        notification.params,
        notification.order,
      )
    }
  }

  /**
   * Validate the request's thread and turn association.
   * @returns `true` when the matching turn is still provisional, so the caller
   * defers its diagnostic until `commitTurnId()`.
   */
  private validateRunIds(
    params: JsonObject,
    nullableTurn = false,
  ): boolean {
    if (params.threadId !== this.threadId) {
      throw new Error('subagent-codex: app-server request referenced another thread')
    }
    if (nullableTurn && params.turnId === null) return false
    const id = string(params.turnId, 'server request turn id')
    if (this.turnId === undefined) {
      this.observePendingTurnId(id)
      return true
    }
    if (id !== this.turnId) {
      throw new Error('subagent-codex: app-server request referenced another turn')
    }
    return false
  }

  private recordRequestDiagnostic(
    provisional: boolean,
    request: Parameters<typeof unattendedDiagnostic>[1],
    decision: Parameters<typeof unattendedDiagnostic>[2],
    reason: string,
  ): void {
    const order = this.nextObservationOrder()
    if (provisional) {
      this.pendingDiagnostic = {
        order,
        request,
        decision,
        reason,
      }
      return
    }
    this.recordDiagnostic(request, decision, reason, order)
  }

  private recordDiagnostic(
    request: Parameters<typeof unattendedDiagnostic>[1],
    decision: Parameters<typeof unattendedDiagnostic>[2],
    reason: string,
    order = this.nextObservationOrder(),
  ): void {
    if (order < this.diagnosticOrder) return
    this.diagnosticOrder = order
    this.diagnostic = unattendedDiagnostic(
      this.permissionMode,
      request,
      decision,
      reason,
    )
  }

  private recordFailure(facts: CodexWireFailureFacts): void {
    this.failure = facts
  }

  private nextObservationOrder(): number {
    this.observationOrder += 1
    return this.observationOrder
  }

  private recordDeclinedItem(item: JsonObject, order?: number): boolean {
    if (item.type === 'commandExecution' && item.status === 'declined') {
      this.recordDiagnostic(
        'command execution',
        'declined',
        'Codex declined the command under the selected permission mode',
        order,
      )
      return true
    }
    if (item.type === 'fileChange' && item.status === 'declined') {
      this.recordDiagnostic(
        'file change',
        'declined',
        'Codex declined the file change under the selected permission mode',
        order,
      )
      return true
    }
    return false
  }

  private handleServerRequest(method: string, params: JsonObject): Promise<unknown> {
    try {
      switch (method) {
        case 'item/commandExecution/requestApproval':
        {
          const provisional = this.validateRunIds(params)
          const decision = unattendedDecision(params)
          this.recordRequestDiagnostic(
            provisional,
            'command approval',
            decision === 'cancel' ? 'cancelled' : 'declined',
            'the provider does not grant interactive approval',
          )
          return Promise.resolve({ decision })
        }
        case 'item/fileChange/requestApproval':
        {
          const provisional = this.validateRunIds(params)
          const decision = unattendedDecision(params)
          this.recordRequestDiagnostic(
            provisional,
            'file approval',
            decision === 'cancel' ? 'cancelled' : 'declined',
            'the provider does not grant interactive approval',
          )
          return Promise.resolve({ decision })
        }
        case 'item/permissions/requestApproval':
          this.recordRequestDiagnostic(
            this.validateRunIds(params),
            'permission grant',
            'denied',
            'the provider grants no additional turn permissions',
          )
          return Promise.resolve({ permissions: {}, scope: 'turn' })
        case 'item/tool/requestUserInput':
          this.recordRequestDiagnostic(
            this.validateRunIds(params),
            'user input',
            'empty response',
            'the provider does not collect interactive answers',
          )
          return Promise.resolve({ answers: {} })
        case 'mcpServer/elicitation/request':
          this.recordRequestDiagnostic(
            this.validateRunIds(params, true),
            'MCP elicitation',
            'declined',
            'the provider does not collect interactive MCP input',
          )
          return Promise.resolve({ action: 'decline', content: null, _meta: null })
        default:
          throw new Error(`subagent-codex: unsupported app-server request ${JSON.stringify(method)}`)
      }
    } catch (error: unknown) {
      const normalized = thrown(error)
      this.fail(normalized)
      return Promise.reject(normalized)
    }
  }

  private handleNotification(
    method: string,
    params: JsonObject,
    order?: number,
  ): void {
    if (method === 'turn/started') {
      const threadId = string(params.threadId, 'turn/started thread id')
      if (threadId !== this.threadId) return
      const turn = object(params.turn, 'turn/started turn')
      if (this.turnCompleted !== undefined && this.turnId === undefined) {
        this.observePendingTurnId(string(turn.id, 'turn/started turn id'))
      }
      return
    }
    if (method === 'item/completed') {
      const threadId = string(params.threadId, 'item/completed thread id')
      if (threadId !== this.threadId) return
      const id = string(params.turnId, 'item/completed turn id')
      if (this.turnId === undefined) {
        if (this.turnCompleted !== undefined) {
          this.observePendingTurnId(id)
          this.earlyTurnNotifications.push({
            method,
            params,
            order: this.nextObservationOrder(),
          })
        }
        return
      }
      if (id !== this.turnId) return
      const item = object(params.item, 'item/completed item')
      if (this.recordDeclinedItem(item, order)) return
      if (item.type !== 'agentMessage') return
      const text = typeof item.text === 'string'
        ? item.text
        : (() => { throw new Error('subagent-codex: app-server returned an invalid agent message') })()
      if (item.phase === 'final_answer') {
        this.lastFinalAnswer = text
      } else if (item.phase === null) {
        this.lastUnphasedAnswer = text
      } else if (item.phase !== 'commentary') {
        throw new Error(`subagent-codex: app-server returned an unknown agent message phase ${JSON.stringify(item.phase)}`)
      }
      return
    }
    if (method !== 'turn/completed') return
    const threadId = string(params.threadId, 'turn/completed thread id')
    if (threadId !== this.threadId) return
    const turn = object(params.turn, 'turn/completed turn')
    const id = string(turn.id, 'turn/completed turn id')
    const turnCompleted = this.turnCompleted
    if (turnCompleted === undefined) return
    if (this.turnId === undefined) {
      this.observePendingTurnId(id)
      this.earlyTurnNotifications.push({
        method,
        params,
        order: this.nextObservationOrder(),
      })
      return
    }
    if (id !== this.turnId) return
    this.terminalObserved = true
    if (!['completed', 'interrupted', 'failed'].includes(String(turn.status))) {
      throw new Error(`subagent-codex: app-server returned invalid terminal turn status ${String(turn.status)}`)
    }
    turnCompleted.resolve({
      params,
      order: order ?? this.nextObservationOrder(),
    })
  }
}
