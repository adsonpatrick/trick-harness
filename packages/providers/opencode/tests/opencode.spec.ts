/** OpenCode provider: route translation, scoped configuration, and teardown. */

import { createExecutorRuntime } from '@trick-harness/executor'
import type { ExecutorStartRequest } from '@trick-harness/executor'
import { describe, expect, it } from 'vitest'
import { permissionConfig, parseModel } from '../src/config.ts'
import { createOpencodeProvider, OPENCODE_CAPABILITIES, OPENCODE_EXECUTOR } from '../src/index.ts'
import { OpencodeRouteError } from '../src/config.ts'
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
}

/** Behaviour a case wants to vary in the fake product. */
interface FakeOptions {
  readonly parts?: readonly OpencodeMessagePart[]
  readonly onPrompt?: (request: OpencodePromptRequest) => Promise<void>
  readonly startServerFails?: Error
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
  const seen: Recorder = { servers: [], prompts: [], aborted: [], closes: 0, connects: [] }
  const adapter: OpencodeAdapter = {
    async startServer(serverOptions) {
      seen.servers.push(serverOptions)
      if (options.startServerFails !== undefined) throw options.startServerFails
      return Promise.resolve({
        url: 'http://127.0.0.1:49512',
        close: () => { seen.closes += 1 },
      })
    },
    connect(url, directory) {
      seen.connects.push({ url, directory })
      return {
        createSession: () => Promise.resolve('ses_1'),
        async prompt(request) {
          seen.prompts.push(request)
          await options.onPrompt?.(request)
          return { parts: options.parts ?? [{ type: 'text', text: 'done' }] }
        },
        abortSession: (sessionId) => {
          seen.aborted.push(sessionId)
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
    expect(result.failure?.category).toBe('route-unsupported')
    expect(seen.servers).toEqual([])
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
    expect(result.failure?.availability).toBe(false)
    expect(result.failure?.safeDiagnostic).not.toContain('sk-secret')
    expect(result.failure?.safeDiagnostic).not.toContain('ECONNREFUSED')
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
    const { adapter, seen } = fakeAdapter()
    await createOpencodeProvider(adapter).start(request({ signal: controller.signal }))
    expect(seen.servers[0]?.signal).toBe(controller.signal)
  })
})
