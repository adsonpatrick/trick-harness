/** OpenCode provider: route translation, scoped configuration, and teardown. */

import { createExecutorRuntime } from '@trick-harness/executor'
import type { ExecutorStartRequest } from '@trick-harness/executor'
import { describe, expect, it } from 'vitest'
import { permissionConfig, parseModel } from '../src/config.ts'
import {
  createOpencodeProvider,
  OPENCODE_CAPABILITIES,
  OPENCODE_EXECUTOR,
  OPENCODE_SERVER_CLOSE_CLEANUP,
  OPENCODE_SESSION_ABORT_CLEANUP,
} from '../src/index.ts'
import { OpencodeRouteError } from '../src/config.ts'
import { OpencodeHttpStatusError } from '../src/runtime-errors.ts'
import { EXPECTED_EXECUTOR, EXPECTED_PERMISSION_MODES } from '../src/invariant.ts'
import type {
  OpencodeAdapter,
  OpencodeMessagePart,
  OpencodePromptRequest,
  OpencodeServerOptions,
} from '../src/types.ts'

/** What a fake adapter saw, so a test can assert on the seam rather than on mocks. */
interface Recorder {
  readonly servers: OpencodeServerOptions[]
  readonly prompts: OpencodePromptRequest[]
  readonly aborted: string[]
  closes: number
  readonly connects: { url: string; directory: string }[]
  readonly signals: AbortSignal[]
}

/** Behaviour a case wants to vary in the fake product. */
interface FakeOptions {
  readonly parts?: readonly OpencodeMessagePart[]
  readonly onPrompt?: (request: OpencodePromptRequest, signal: AbortSignal) => Promise<void>
  readonly promptFails?: Error
  readonly sessionCreateFails?: Error
  readonly startServerFails?: Error
  /** Make the scoped server refuse to close, the way a wedged port does. */
  readonly closeFails?: Error
  /** Report process-tree exit only after the fake server has joined. */
  readonly closeProof?: { readonly processId: number; readonly observedAtMs: number }
  /** Make the session abort fail, the way an already-torn-down transport does. */
  readonly abortFails?: Error
}

/**
 * Build an adapter that stands in for a real OpenCode server.
 *
 * Tests drive the provider through this seam so the code under test is the
 * provider's own translation and lifecycle logic, not a mock of it.
 * @param options - behaviour this case needs.
 * @returns the fake adapter and the record of what it received.
 */
function fakeAdapter(options: FakeOptions = {}): { adapter: OpencodeAdapter; seen: Recorder } {
  const seen: Recorder = { servers: [], prompts: [], aborted: [], closes: 0, connects: [], signals: [] }
  const adapter: OpencodeAdapter = {
    async startServer(serverOptions) {
      seen.servers.push(serverOptions)
      if (options.startServerFails !== undefined) throw options.startServerFails
      return Promise.resolve({
        url: 'http://127.0.0.1:49512',
        close: async () => {
          seen.closes += 1
          if (options.closeFails !== undefined) return Promise.reject(options.closeFails)
          return options.closeProof
        },
      })
    },
    connect(url, directory, signal) {
      seen.connects.push({ url, directory })
      seen.signals.push(signal)
      return {
        createSession: () => options.sessionCreateFails === undefined
          ? Promise.resolve('ses_1') : Promise.reject(options.sessionCreateFails),
        async prompt(request) {
          seen.prompts.push(request)
          await options.onPrompt?.(request, signal)
          if (options.promptFails !== undefined) throw options.promptFails
          return { parts: options.parts ?? [{ type: 'text', text: 'done' }] }
        },
        abortSession: (sessionId) => {
          seen.aborted.push(sessionId)
          if (options.abortFails !== undefined) return Promise.reject(options.abortFails)
          return Promise.resolve()
        },
      }
    },
  }
  return { adapter, seen }
}

/** Build a start request, overriding whichever fields a case cares about. */
function request(overrides: Partial<ExecutorStartRequest> = {}): ExecutorStartRequest {
  return {
    cwd: '/work/repo',
    task: 'implement the parser',
    route: { executor: OPENCODE_EXECUTOR, permissionMode: 'read-only' },
    signal: new AbortController().signal,
    deadlineAtMs: Date.now() + 60_000,
    ...overrides,
  }
}

describe('declared capabilities', () => {
  it('declares no reasoning-effort support, because the SDK has no such field', () => {
    expect(OPENCODE_CAPABILITIES.reasoningEffort).toBe(false)
  })

  it('keeps the invariant companion’s restated expectations in step with the package', () => {
    // The companion deliberately does not import these, so that it validates
    // the declaration rather than agreeing with it. This is where the two views
    // are held together.
    expect(EXPECTED_EXECUTOR).toBe(OPENCODE_EXECUTOR)
    expect(EXPECTED_PERMISSION_MODES).toEqual(OPENCODE_CAPABILITIES.permissionModes)
  })

  it('makes the runtime refuse a reasoning effort before anything is spawned', async () => {
    const { adapter, seen } = fakeAdapter()
    const runtime = createExecutorRuntime()
    runtime.register(createOpencodeProvider(adapter))
    await expect(runtime.start(request({
      route: { executor: OPENCODE_EXECUTOR, permissionMode: 'read-only', reasoningEffort: 'high' },
    }))).rejects.toThrow()
    expect(seen.servers).toEqual([])
  })
})

describe('per-run model routing', () => {
  it('supplies the routed model on the prompt and nowhere else', async () => {
    // The model must reach the session that runs the task. If it reached only
    // the server, or nothing at all, the durable route fact would name a model
    // that never ran the work.
    const { adapter, seen } = fakeAdapter()
    const provider = createOpencodeProvider(adapter)
    await provider.start(request({
      route: {
        executor: OPENCODE_EXECUTOR,
        permissionMode: 'read-only',
        model: 'anthropic/claude-opus-5',
      },
    }))
    expect(seen.prompts[0]?.model).toEqual({ providerID: 'anthropic', modelID: 'claude-opus-5' })
    expect(JSON.stringify(seen.servers[0]?.config)).not.toContain('claude-opus-5')
  })

  it('leaves the model off the prompt when the route names none', async () => {
    const { adapter, seen } = fakeAdapter()
    await createOpencodeProvider(adapter).start(request())
    expect(seen.prompts[0]?.model).toBeUndefined()
  })

  it('roots the session and the prompt in the requested working directory', async () => {
    const { adapter, seen } = fakeAdapter()
    await createOpencodeProvider(adapter).start(request({ cwd: '/srv/project' }))
    expect(seen.connects[0]?.directory).toBe('/srv/project')
    expect(seen.prompts[0]?.directory).toBe('/srv/project')
  })

  it('refuses a bare model id rather than guessing a provider', () => {
    expect(() => parseModel('claude-opus-5')).toThrow(OpencodeRouteError)
    expect(() => parseModel('anthropic/')).toThrow(OpencodeRouteError)
    expect(() => parseModel('/claude-opus-5')).toThrow(OpencodeRouteError)
  })

  it('reports an untranslatable model as a route failure, not a crash', async () => {
    const { adapter, seen } = fakeAdapter()
    const result = await createOpencodeProvider(adapter).start(request({
      route: { executor: OPENCODE_EXECUTOR, permissionMode: 'read-only', model: 'bare-name' },
    }))
    expect(result.status).toBe('error')
    expect(result.failure).toMatchObject({ category: 'bad-request', code: 'opencode.route.unsupported' })
    // Reachable and refusing: a fallback would pay for a second run to hear the
    // same refusal from a different product.
    expect(result.failure?.code).toBe('opencode.route.unsupported')
    expect(seen.servers).toEqual([])
  })
})

describe('bounded provider failure classification', () => {
  it.each([
    [408, 'transport-unavailable', 'opencode.http.timeout'],
    [429, 'usage-limit-exceeded', 'opencode.http.usage-limit'],
    [503, 'server-overloaded', 'opencode.http.server-overloaded'],
    [500, 'internal-server-error', 'opencode.http.server-failure'],
    [401, 'unauthorized', 'opencode.http.unauthorized'],
    [400, 'bad-request', 'opencode.http.bad-request'],
  ] as const)('maps HTTP %s to a bounded category and PROMPT phase', async (status, category, code) => {
    const { adapter } = fakeAdapter({ promptFails: new OpencodeHttpStatusError(status) })
    const result = await createOpencodeProvider(adapter).start(request())

    expect(result.failure).toMatchObject({ category, code, httpStatus: status, failurePhase: 'PROMPT' })
    expect(result.failure?.safeDiagnostic).not.toContain(String(status))
  })

  it('keeps an unclassified error in other without persisting its message or attacker fields', async () => {
    const unsafe = Object.assign(new Error('token=secret response-body=private'), { status: 429, code: 'EAGAIN' })
    const { adapter } = fakeAdapter({ promptFails: unsafe })
    const result = await createOpencodeProvider(adapter).start(request())

    expect(result.failure).toMatchObject({
      category: 'other', code: 'opencode.prompt.rejected-unclassified', failurePhase: 'PROMPT',
      safeDiagnostic: 'OpenCode prompt call failed without a recognized error signal',
    })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('labels unexpected session abort and session creation errors at their boundaries', async () => {
    const aborted = Object.assign(new Error('private'), { name: 'MessageAbortedError' })
    const abortResult = await createOpencodeProvider(fakeAdapter({ promptFails: aborted }).adapter).start(request())
    const createResult = await createOpencodeProvider(fakeAdapter({ sessionCreateFails: new Error('private') }).adapter)
      .start(request())

    expect(abortResult.failure).toMatchObject({ category: 'other', failurePhase: 'SESSION_ABORT' })
    expect(createResult.failure).toMatchObject({
      category: 'other', code: 'opencode.session.create-failed', failurePhase: 'SESSION_CREATE',
    })
  })
})

describe('Harness-owned attempt deadline', () => {
  it('aborts a prompt that never settles and joins the writer before returning timeout', async () => {
    const observedAtMs = Date.now() + 60
    const { adapter, seen } = fakeAdapter({
      closeProof: { processId: 987, observedAtMs },
      onPrompt: async (_request, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
      },
    })
    const pending = createOpencodeProvider(adapter).start(request({ deadlineAtMs: Date.now() + 20 }))
    const result = await Promise.race([
      pending,
      new Promise<'unbounded'>(resolve => setTimeout(() => { resolve('unbounded') }, 250)),
    ])

    expect(result).not.toBe('unbounded')
    expect(result).toMatchObject({
      status: 'error',
      failure: { category: 'transport-unavailable', code: 'opencode.attempt.deadline-exceeded', failurePhase: 'PROMPT' },
      writerQuiescence: { kind: 'owned-process-tree-exited', processId: 987 },
    })
    expect(seen.closes).toBe(1)
  })
})

describe('scoped configuration', () => {
  it('carries the permission block as in-memory server config', async () => {
    // Scoping is the whole point: nothing this provider does may write to the
    // user's OpenCode configuration, so the only channel is this object.
    const { adapter, seen } = fakeAdapter()
    await createOpencodeProvider(adapter).start(request())
    expect(seen.servers[0]?.config.permission).toEqual(permissionConfig('read-only'))
  })

  it('binds the server to loopback on an OS-chosen port', async () => {
    const { adapter, seen } = fakeAdapter()
    await createOpencodeProvider(adapter).start(request())
    expect(seen.servers[0]?.hostname).toBe('127.0.0.1')
    expect(seen.servers[0]?.port).toBe(0)
  })

  it('denies every write path under read-only', () => {
    expect(permissionConfig('read-only')).toEqual({
      edit: 'deny',
      bash: 'deny',
      webfetch: 'deny',
      doom_loop: 'deny',
      external_directory: 'deny',
    })
  })

  it('opens only edit and bash under workspace-write', () => {
    expect(permissionConfig('workspace-write')).toEqual({
      edit: 'allow',
      bash: 'allow',
      webfetch: 'deny',
      doom_loop: 'deny',
      external_directory: 'deny',
    })
  })

  it('states every permission field rather than leaving one to a product default', () => {
    for (const mode of OPENCODE_CAPABILITIES.permissionModes) {
      const block: Record<string, unknown> = { ...permissionConfig(mode) }
      for (const field of ['edit', 'bash', 'webfetch', 'doom_loop', 'external_directory']) {
        expect(block[field]).toBeDefined()
      }
    }
  })

  it('fails loud on a permission mode it cannot map', () => {
    expect(() => permissionConfig('sandbox-off' as never)).toThrow(OpencodeRouteError)
  })
})

describe('results', () => {
  it('returns the final message text, not the child transcript', async () => {
    const { adapter } = fakeAdapter({
      parts: [
        { type: 'reasoning', text: 'thinking out loud' },
        { type: 'tool', text: 'ran a command' },
        { type: 'text', text: 'the parser is implemented' },
      ],
    })
    const result = await createOpencodeProvider(adapter).start(request())
    expect(result).toEqual({ status: 'completed', output: 'the parser is implemented' })
  })

  it('reports a product failure as a safe diagnostic carrying no raw detail', async () => {
    const leak = new Error('connect ECONNREFUSED with OPENAI_API_KEY=sk-secret')
    const { adapter } = fakeAdapter({ startServerFails: leak })
    const result = await createOpencodeProvider(adapter).start(request())
    expect(result.status).toBe('error')
    expect(result.failure?.category).toBe('other')
    expect(result.failure?.safeDiagnostic).not.toContain('sk-secret')
    expect(result.failure?.safeDiagnostic).not.toContain('ECONNREFUSED')
  })

  it('classifies an SDK session abort as an error rather than caller cancellation', async () => {
    const aborted = Object.assign(new Error('private session detail'), { name: 'MessageAbortedError' })
    const { adapter } = fakeAdapter({ promptFails: aborted })
    const result = await createOpencodeProvider(adapter).start(request())

    expect(result).toMatchObject({
      status: 'error',
      failure: {
        category: 'other',
        code: 'opencode.prompt.session-aborted',
        safeDiagnostic: 'OpenCode aborted the active session before returning a valid result',
      },
    })
    expect(JSON.stringify(result)).not.toContain('private session detail')
  })

  it('uses a stable safe taxonomy for unknown prompt errors', async () => {
    const unsafe = Object.assign(new Error('OPENAI_API_KEY=sk-secret'), { name: 'PrivateServiceCredentialError' })
    const { adapter } = fakeAdapter({ promptFails: unsafe })
    const result = await createOpencodeProvider(adapter).start(request())

    expect(result).toMatchObject({
      status: 'error',
      failure: {
        category: 'other',
        code: 'opencode.prompt.rejected-unclassified',
        safeDiagnostic: 'OpenCode prompt call failed without a recognized error signal',
      },
    })
    expect(JSON.stringify(result)).not.toContain('sk-secret')
    expect(JSON.stringify(result)).not.toContain('PrivateServiceCredentialError')
  })
})

describe('cancellation and teardown', () => {
  it('closes the server on a successful run', async () => {
    const { adapter, seen } = fakeAdapter()
    await createOpencodeProvider(adapter).start(request())
    expect(seen.closes).toBe(1)
  })

  it('closes the server when the run fails', async () => {
    const { adapter, seen } = fakeAdapter({
      onPrompt: () => Promise.reject(new Error('boom')),
    })
    const result = await createOpencodeProvider(adapter).start(request())
    expect(result.status).toBe('error')
    expect(seen.closes).toBe(1)
  })

  it('aborts the session and closes the server when the run is cancelled', async () => {
    const controller = new AbortController()
    const { adapter, seen } = fakeAdapter({
      onPrompt: async () => {
        controller.abort()
        await Promise.resolve()
      },
    })
    const result = await createOpencodeProvider(adapter).start(
      request({ signal: controller.signal }),
    )
    expect(result).toEqual({ status: 'aborted', output: '' })
    expect(seen.aborted).toEqual(['ses_1'])
    expect(seen.closes).toBe(1)
  })

  it('does not abort a session that already returned on its own', async () => {
    const { adapter, seen } = fakeAdapter()
    await createOpencodeProvider(adapter).start(request())
    expect(seen.aborted).toEqual([])
  })

  it('hands the run signal to the server it owns', async () => {
    const controller = new AbortController()
    const { adapter, seen } = fakeAdapter({ onPrompt: async () => { controller.abort() } })
    await createOpencodeProvider(adapter).start(request({ signal: controller.signal }))
    expect(seen.servers[0]?.signal).not.toBe(controller.signal)
    expect(seen.servers[0]?.signal.aborted).toBe(true)
  })
})

/**
 * Build a teardown error carrying the sort of text a real one carries.
 * @param name - the error class name the product would use.
 * @returns the error, whose message must not survive into the result.
 */
function wedged(name: string): Error {
  const error = new Error('listen EADDRINUSE 127.0.0.1:49512 authorization=Bearer sk-live-77')
  error.name = name
  return error
}

describe('teardown failures are observable, not swallowed', () => {
  it('exposes writer quiescence only after the owned process tree exits', async () => {
    const observedAtMs = Date.now()
    const { adapter } = fakeAdapter({
      promptFails: new Error('transport disappeared'),
      closeProof: { processId: 4321, observedAtMs },
    })
    const result = await createOpencodeProvider(adapter).start(request())
    expect(result.status).toBe('error')
    expect(result.writerQuiescence).toEqual({
      kind: 'owned-process-tree-exited', processId: 4321, observedAtMs,
    })
  })

  it('leaves a completed run completed and says the server would not close', async () => {
    const { adapter } = fakeAdapter({ closeFails: wedged('ServerCloseError') })
    const result = await createOpencodeProvider(adapter).start(request())
    // The run answered. Downgrading it would lose a correct answer to report a
    // janitorial problem, and the caller needs both facts, not one of them.
    expect(result.status).toBe('completed')
    expect(result.output).toBe('done')
    expect(result.cleanup).toEqual([{
      category: OPENCODE_SERVER_CLOSE_CLEANUP,
      safeDiagnostic: 'opencode-server-close failed (ServerCloseError)',
      failurePhase: 'CLEANUP',
    }])
    expect(result.writerQuiescence).toBeUndefined()
  })

  it('carries no byte of the raw exception into the durable fact', async () => {
    const { adapter } = fakeAdapter({ closeFails: wedged('ServerCloseError') })
    const result = await createOpencodeProvider(adapter).start(request())
    const durable = JSON.stringify(result)
    expect(durable).not.toContain('EADDRINUSE')
    expect(durable).not.toContain('49512')
    expect(durable).not.toContain('sk-live-77')
  })

  it('quotes nothing at all when the error class name is prose', async () => {
    // `name` is writable, so it is only conventionally a class name. A product
    // that assigned its message to it would otherwise smuggle that message
    // through the one field this fact does read.
    const { adapter } = fakeAdapter({
      closeFails: wedged('failed to close http://127.0.0.1:49512'),
    })
    const result = await createOpencodeProvider(adapter).start(request())
    expect(result.cleanup?.[0]?.safeDiagnostic).toBe('opencode-server-close failed (Error)')
  })

  it('gives a cleanup fault no availability field, so it cannot reroute a run', async () => {
    const { adapter } = fakeAdapter({ closeFails: wedged('ServerCloseError') })
    const result = await createOpencodeProvider(adapter).start(request())
    // Not `availability: false` — absent. A field that is not there cannot be
    // read by fallback routing under any later refactor of that routing.
    expect(Object.keys(result.cleanup?.[0] ?? {})).toEqual(['category', 'safeDiagnostic', 'failurePhase'])
    expect(result.failure).toBeUndefined()
  })

  it('records both faults when a cancelled run cannot abort or close either', async () => {
    const controller = new AbortController()
    const { adapter } = fakeAdapter({
      abortFails: wedged('SessionAbortError'),
      closeFails: wedged('ServerCloseError'),
      onPrompt: async () => {
        controller.abort()
        await Promise.resolve()
      },
    })
    const result = await createOpencodeProvider(adapter).start(
      request({ signal: controller.signal }),
    )
    expect(result.status).toBe('aborted')
    expect(result.cleanup?.map(fault => fault.category))
      .toEqual([OPENCODE_SESSION_ABORT_CLEANUP, OPENCODE_SERVER_CLOSE_CLEANUP])
  })

  it('says nothing at all when teardown was clean', async () => {
    const { adapter } = fakeAdapter()
    const result = await createOpencodeProvider(adapter).start(request())
    // Absent rather than empty: the presence of the field is the fact, and an
    // empty list would make every clean run carry evidence of nothing.
    expect(result.cleanup).toBeUndefined()
  })

  it('still closes the server after a session abort that failed', async () => {
    const controller = new AbortController()
    const { adapter, seen } = fakeAdapter({
      abortFails: wedged('SessionAbortError'),
      onPrompt: async () => {
        controller.abort()
        await Promise.resolve()
      },
    })
    await createOpencodeProvider(adapter).start(request({ signal: controller.signal }))
    expect(seen.closes).toBe(1)
  })
})
