import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import type { ExecutorRoute, ExecutorStartRequest } from '@trick-harness/executor'
import {
  CODEX_CAPABILITIES,
  CODEX_EXECUTOR,
  createCodexProvider,
  isAvailabilityFailure,
  NON_AVAILABILITY_CATEGORIES,
  sandboxMode,
  CodexRouteError,
} from '../src/index.ts'
import { EXPECTED_EXECUTOR, EXPECTED_PERMISSION_MODES } from '../src/invariant.ts'

type JsonObject = Record<string, unknown>

/** A line-delimited JSON-RPC peer standing in for the app-server child. */
class ProtocolPeer {
  private buffer = ''
  private readonly frames: JsonObject[] = []
  private readonly wakeups = new Set<() => void>()

  constructor(input: PassThrough, private readonly output: PassThrough) {
    input.on('data', (chunk: Buffer | string) => {
      this.buffer += chunk.toString()
      for (;;) {
        const newline = this.buffer.indexOf('\n')
        if (newline < 0) break
        const line = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        if (line.trim().length > 0) this.frames.push(JSON.parse(line) as JsonObject)
      }
      for (const wake of this.wakeups) wake()
      this.wakeups.clear()
    })
  }

  async nextMethod(method: string): Promise<JsonObject> {
    for (;;) {
      const index = this.frames.findIndex(frame => frame.method === method)
      if (index >= 0) return this.frames.splice(index, 1)[0]!
      await new Promise<void>((resolve) => { this.wakeups.add(resolve) })
    }
  }

  send(...frames: readonly JsonObject[]): void {
    this.output.write(`${frames.map(frame => JSON.stringify(frame)).join('\n')}\n`)
  }

  respond(requestFrame: JsonObject, result: unknown): void {
    this.send({ id: requestFrame.id, result })
  }
}

interface FakeChild {
  readonly handle: SubprocessHandle
  readonly peer: ProtocolPeer
  readonly settle: (outcome?: SubprocessOutcome) => void
  readonly terminations: () => number
}

function fakeChild(): FakeChild {
  const fromChild = new PassThrough()
  const toChild = new PassThrough()
  const stderr = new PassThrough()
  const peer = new ProtocolPeer(toChild, fromChild)
  let exited = false
  let resolveDone!: (outcome: SubprocessOutcome) => void
  const done = new Promise<SubprocessOutcome>((resolve) => { resolveDone = resolve })
  const settle = (outcome: SubprocessOutcome = { exitCode: 0, signal: null }): void => {
    if (exited) return
    exited = true
    resolveDone(outcome)
  }
  let terminations = 0
  const handle: SubprocessHandle = {
    pid: 4321,
    stdin: toChild,
    stdout: fromChild,
    stderr,
    collected: {},
    done,
    terminate: vi.fn(() => { terminations += 1; settle() }),
    waitForExit: vi.fn(async () => {
      if (!exited) settle()
      return true
    }),
  }
  return { handle, peer, settle, terminations: () => terminations }
}

function route(overrides: Partial<ExecutorRoute> = {}): ExecutorRoute {
  return { executor: CODEX_EXECUTOR, permissionMode: 'read-only', ...overrides }
}

function startRequest(
  overrides: Partial<ExecutorStartRequest> = {},
): ExecutorStartRequest {
  return {
    cwd: process.cwd(),
    task: 'implement the parser',
    route: route(),
    signal: new AbortController().signal,
    ...overrides,
  }
}

interface DrivenRun {
  readonly child: FakeChild
  readonly threadStart: JsonObject
  readonly turnStart: JsonObject
  readonly spawn: ReturnType<typeof vi.fn>
  readonly finish: (...frames: readonly JsonObject[]) => void
}

/**
 * Drive one real transport run up to the point where the turn is in flight.
 * @param request - the executor request to dispatch.
 * @param options - provider options layered over the subprocess seam.
 * @returns the observed frames plus a way to settle the turn.
 */
async function drive(
  request: ExecutorStartRequest,
  options: { readonly env?: Record<string, string> } = {},
): Promise<DrivenRun & { readonly result: Promise<unknown> }> {
  const child = fakeChild()
  const spawn = vi.fn((_spec: SubprocessSpawnSpec) => child.handle)
  const provider = createCodexProvider({
    spawn,
    ...options.env === undefined ? {} : { env: options.env },
  })
  const result = provider.start(request)
  const initialize = await child.peer.nextMethod('initialize')
  child.peer.respond(initialize, { userAgent: 'codex-cli 0.147.0' })
  await child.peer.nextMethod('initialized')
  const threadStart = await child.peer.nextMethod('thread/start')
  child.peer.respond(threadStart, { thread: { id: 'thread-1', ephemeral: true } })
  const turnStart = await child.peer.nextMethod('turn/start')
  const finish = (...frames: readonly JsonObject[]): void => {
    child.peer.send({ id: turnStart.id, result: { turn: { id: 'turn-1' } } }, ...frames)
  }
  return { child, threadStart, turnStart, spawn, finish, result }
}

const answered: readonly JsonObject[] = [
  {
    method: 'item/completed',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: { type: 'agentMessage', text: 'done', phase: 'final_answer' },
    },
  },
  {
    method: 'turn/completed',
    params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } },
  },
]

function failedTurn(codexErrorInfo: unknown): JsonObject {
  return {
    method: 'turn/completed',
    params: {
      threadId: 'thread-1',
      turn: { id: 'turn-1', status: 'failed', error: { codexErrorInfo } },
    },
  }
}

describe('declared capabilities', () => {
  it('names itself the way the invariant companion expects', () => {
    expect(CODEX_EXECUTOR).toBe(EXPECTED_EXECUTOR)
    expect([...CODEX_CAPABILITIES.permissionModes]).toEqual([...EXPECTED_PERMISSION_MODES])
  })

  it('claims both per-run overrides, because the wire has a field for each', () => {
    expect(CODEX_CAPABILITIES.modelOverride).toBe(true)
    expect(CODEX_CAPABILITIES.reasoningEffort).toBe(true)
  })

  it('maps every declared permission mode to a Codex sandbox', () => {
    expect(CODEX_CAPABILITIES.permissionModes.map(sandboxMode))
      .toEqual(['read-only', 'workspace-write'])
  })

  it('refuses a permission mode it cannot map, before any process', async () => {
    const spawn = vi.fn(() => fakeChild().handle)
    const provider = createCodexProvider({ spawn })
    const result = await provider.start(startRequest({
      route: route({ permissionMode: 'full-access' as never }),
    }))
    expect(result.status).toBe('error')
    expect(result.failure?.category).toBe('route-unsupported')
    expect(result.failure?.availability).toBe(true)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('exposes the refusal as a typed error', () => {
    expect(() => sandboxMode('full-access' as never)).toThrow(CodexRouteError)
  })
})

describe('per-run routing on the real transport', () => {
  it('emits the routed model and effort on turn/start', async () => {
    const driven = await drive(startRequest({
      route: route({ model: 'gpt-5.1-codex', reasoningEffort: 'high' }),
    }))
    expect(driven.turnStart.params).toMatchObject({
      threadId: 'thread-1',
      model: 'gpt-5.1-codex',
      effort: 'high',
    })
    driven.finish(...answered)
    await driven.result
  })

  it('omits both fields when the route names neither', async () => {
    const driven = await drive(startRequest())
    const params = driven.turnStart.params as JsonObject
    expect(Object.hasOwn(params, 'model')).toBe(false)
    expect(Object.hasOwn(params, 'effort')).toBe(false)
    driven.finish(...answered)
    await driven.result
  })

  it('fixes the sandbox from the permission mode and stays unattended', async () => {
    for (const [permissionMode, sandbox] of [
      ['read-only', 'read-only'],
      ['workspace-write', 'workspace-write'],
    ] as const) {
      const driven = await drive(startRequest({ route: route({ permissionMode }) }))
      expect(driven.threadStart.params).toEqual({
        cwd: process.cwd(),
        ephemeral: true,
        approvalPolicy: 'never',
        sandbox,
      })
      driven.finish(...answered)
      await driven.result
    }
  })

  it('launches the package-local official Codex payload', async () => {
    const driven = await drive(startRequest())
    const spec = driven.spawn.mock.calls[0]![0] as SubprocessSpawnSpec
    expect(spec.argv.slice(-2)).toEqual(['app-server', '--stdio'])
    // The wrapper comes from the workspace's own pinned @openai/codex install,
    // never from a `codex` found on the host PATH.
    expect(spec.argv.at(-3)).toContain('@openai')
    expect(spec.cwd).toBe(process.cwd())
    driven.finish(...answered)
    await driven.result
  })
})

describe('native credentials and configuration', () => {
  it('injects no API key even when the host has one', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-host-key-that-must-not-travel')
    try {
      const driven = await drive(startRequest())
      const spec = driven.spawn.mock.calls[0]![0] as SubprocessSpawnSpec
      expect(spec.env).toEqual({})
      expect(JSON.stringify(spec)).not.toContain('sk-host-key')
      driven.finish(...answered)
      await driven.result
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('passes only the explicit deployment environment', async () => {
    const driven = await drive(startRequest(), { env: { HTTPS_PROXY: 'http://proxy:8080' } })
    const spec = driven.spawn.mock.calls[0]![0] as SubprocessSpawnSpec
    expect(spec.env).toEqual({ HTTPS_PROXY: 'http://proxy:8080' })
    driven.finish(...answered)
    await driven.result
  })

  it('names no Codex home, profile, or config path anywhere in the launch', async () => {
    const driven = await drive(startRequest({
      route: route({ model: 'gpt-5.1-codex', reasoningEffort: 'high' }),
    }))
    const launched = JSON.stringify(driven.spawn.mock.calls[0]![0])
    for (const forbidden of ['CODEX_HOME', '--config', '--profile', 'config.toml']) {
      expect(launched).not.toContain(forbidden)
    }
    driven.finish(...answered)
    await driven.result
  })
})

describe('failure classification', () => {
  it('treats quota, budget, overload, and transport as availability failures', () => {
    for (const category of [
      'usageLimitExceeded',
      'sessionBudgetExceeded',
      'serverOverloaded',
      'internalServerError',
      'httpConnectionFailed',
      'responseStreamConnectionFailed',
      'responseStreamDisconnected',
      'responseTooManyFailedAttempts',
    ]) {
      expect(isAvailabilityFailure(category)).toBe(true)
    }
  })

  it('never treats a request, workspace, account, or refusal fault as availability', () => {
    for (const category of NON_AVAILABILITY_CATEGORIES) {
      expect(isAvailabilityFailure(category)).toBe(false)
    }
    expect(isAvailabilityFailure('unknown')).toBe(false)
    expect(isAvailabilityFailure('process-exit')).toBe(false)
  })

  it('reports a quota exhaustion as an availability failure end to end', async () => {
    const driven = await drive(startRequest())
    driven.finish(failedTurn('usageLimitExceeded'))
    const result = await driven.result as { status: string; failure?: JsonObject }
    expect(result.status).toBe('error')
    expect(result.failure).toEqual({
      category: 'usageLimitExceeded',
      availability: true,
      safeDiagnostic: 'codex run failed (usageLimitExceeded)',
    })
  })

  it('reports a context-window overflow as a non-availability failure', async () => {
    const driven = await drive(startRequest())
    driven.finish(failedTurn('contextWindowExceeded'))
    const result = await driven.result as { status: string; failure?: JsonObject }
    expect(result.failure).toMatchObject({
      category: 'contextWindowExceeded',
      availability: false,
    })
  })

  it('carries the upstream HTTP status through a transport failure', async () => {
    const driven = await drive(startRequest())
    driven.finish(failedTurn({ httpConnectionFailed: { httpStatusCode: 503 } }))
    const result = await driven.result as { status: string; failure?: JsonObject }
    expect(result.failure).toEqual({
      category: 'httpConnectionFailed',
      availability: true,
      safeDiagnostic: 'codex run failed (httpConnectionFailed)',
      httpStatus: 503,
    })
  })

  it('keeps the diagnostic free of product prose', async () => {
    const driven = await drive(startRequest())
    driven.finish(failedTurn('cyberPolicy'))
    const result = await driven.result as { failure?: { safeDiagnostic: string } }
    expect(result.failure?.safeDiagnostic).toBe('codex run failed (cyberPolicy)')
  })
})

describe('results and cancellation', () => {
  it('returns the final answer text and nothing else', async () => {
    const driven = await drive(startRequest())
    driven.finish(...answered)
    await expect(driven.result).resolves.toEqual({ status: 'completed', output: 'done' })
  })

  it('reports an aborted run and terminates the child', async () => {
    const controller = new AbortController()
    const driven = await drive(startRequest({ signal: controller.signal }))
    controller.abort()
    const result = await driven.result as { status: string }
    expect(result.status).toBe('aborted')
    expect(driven.child.terminations()).toBeGreaterThan(0)
  })

  it('disposes the child on a completed run too', async () => {
    const driven = await drive(startRequest())
    driven.finish(...answered)
    await driven.result
    expect(driven.child.terminations()).toBeGreaterThan(0)
  })
})
