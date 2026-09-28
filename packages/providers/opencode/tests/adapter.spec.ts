/** SDK startup deadline, kept independent of provider/model response time. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { createSdkAdapter } from '../src/adapter.ts'
import { permissionConfig } from '../src/config.ts'
import { createOpencodeProvider } from '../src/index.ts'
import { OpencodeTransportFailureError } from '../src/runtime-errors.ts'
import type { OpencodeClientHandle } from '../src/types.ts'

vi.mock('@opencode-ai/sdk', () => ({ createOpencodeServer: vi.fn(), createOpencodeClient: vi.fn() }))
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks() })

function clientWith(createResponse: unknown, promptResponse: unknown): OpencodeClientHandle {
  vi.mocked(createOpencodeClient).mockReturnValue({
    session: {
      create: vi.fn(async () => createResponse),
      prompt: vi.fn(async () => promptResponse),
      abort: vi.fn(async () => ({})),
    },
  } as never)
  return createSdkAdapter({ startupTimeoutMs: 1000 })
    .connect('http://127.0.0.1:1234', '/work', new AbortController().signal)
}

describe('SDK response validation', () => {
  it('captures HTTP status before the SDK can read an untrusted response body', async () => {
    clientWith({ data: { id: 'ses_1' } }, { data: { parts: [] } })
    const request = new Request('http://127.0.0.1/session/ses_1/message')
    const fetcher = vi.mocked(createOpencodeClient).mock.calls[0]?.[0]?.fetch
    const cancel = vi.fn(async () => undefined)
    const read = vi.fn()
    const response = { ok: false, status: 429, body: { cancel }, text: read } as unknown as Response
    vi.stubGlobal('fetch', vi.fn(async () => response))

    await expect(fetcher?.(request)).rejects.toMatchObject({ name: 'OpencodeHttpStatusError', status: 429 })
    expect(cancel).toHaveBeenCalledOnce()
    expect(read).not.toHaveBeenCalled()
  })

  it.each([
    ['ECONNRESET', 'connection-failed'],
    ['ECONNREFUSED', 'connection-failed'],
    ['ETIMEDOUT', 'request-timeout'],
    ['UND_ERR_CONNECT_TIMEOUT', 'request-timeout'],
  ] as const)('normalizes allowlisted Node transport code %s', async (code, normalized) => {
    clientWith({ data: { id: 'ses_1' } }, { data: { parts: [] } })
    const fetcher = vi.mocked(createOpencodeClient).mock.calls[0]?.[0]?.fetch
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw Object.assign(new TypeError('raw detail'), { cause: { code } })
    }))

    await expect(fetcher?.(new Request('http://127.0.0.1')))
      .rejects.toEqual(expect.objectContaining({
        name: 'OpencodeTransportFailureError', code: normalized,
      } satisfies Partial<OpencodeTransportFailureError>))
  })

  it('does not treat an arbitrary top-level error code as a Node transport signal', async () => {
    clientWith({ data: { id: 'ses_1' } }, { data: { parts: [] } })
    const fetcher = vi.mocked(createOpencodeClient).mock.calls[0]?.[0]?.fetch
    const untrusted = Object.assign(new TypeError('private'), { code: 'ECONNRESET' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw untrusted }))

    await expect(fetcher?.(new Request('http://127.0.0.1'))).rejects.toBe(untrusted)
  })

  it.each([undefined, '', '  '])('rejects a missing or blank session id (%s)', async (id) => {
    const client = clientWith({ data: id === undefined ? {} : { id } }, { data: { parts: [] } })
    await expect(client.createSession('/work')).rejects.toMatchObject({ name: 'OpencodeMalformedResponseError' })
  })

  it('rejects a prompt response without data using a typed adapter error', async () => {
    const client = clientWith({ data: { id: 'ses_1' } }, {})
    await expect(client.prompt({ sessionId: 'ses_1', directory: '/work', text: 'task' }))
      .rejects.toMatchObject({ name: 'OpencodeMalformedResponseError', code: 'prompt-response-missing-data' })
  })

  it('rejects non-array prompt parts using a typed adapter error', async () => {
    const client = clientWith({ data: { id: 'ses_1' } }, { data: { parts: {} } })
    await expect(client.prompt({ sessionId: 'ses_1', directory: '/work', text: 'task' }))
      .rejects.toMatchObject({ name: 'OpencodeMalformedResponseError', code: 'prompt-response-missing-data' })
  })

  it('recognizes the pinned SDK assistant-message abort discriminator without persisting its message', async () => {
    vi.mocked(createOpencodeServer).mockResolvedValue({ url: 'http://127.0.0.1:49152', close: vi.fn() })
    clientWith({ data: { id: 'ses_1' } }, {
      data: { parts: [], error: { name: 'MessageAbortedError', data: { message: 'private provider detail' } } },
    })
    const result = await createOpencodeProvider(createSdkAdapter({ startupTimeoutMs: 1000 })).start({
      cwd: '/work', task: 'task', route: { executor: 'opencode', permissionMode: 'read-only' },
      signal: new AbortController().signal, deadlineAtMs: Date.now() + 60_000,
    })

    expect(result.failure).toMatchObject({
      category: 'other', code: 'opencode.prompt.session-aborted', failurePhase: 'SESSION_ABORT',
    })
    expect(JSON.stringify(result)).not.toContain('private provider detail')
  })

  it('maps only the pinned SDK APIError status and drops its response body', async () => {
    vi.mocked(createOpencodeServer).mockResolvedValue({ url: 'http://127.0.0.1:49152', close: vi.fn() })
    clientWith({ data: { id: 'ses_1' } }, {
      data: { parts: [], error: { name: 'APIError', data: {
        message: 'private', statusCode: 503, isRetryable: true, responseBody: 'token=private',
      } } },
    })
    const result = await createOpencodeProvider(createSdkAdapter({ startupTimeoutMs: 1000 })).start({
      cwd: '/work', task: 'task', route: { executor: 'opencode', permissionMode: 'read-only' },
      signal: new AbortController().signal, deadlineAtMs: Date.now() + 60_000,
    })

    expect(result.failure).toMatchObject({
      category: 'server-overloaded', code: 'opencode.http.server-overloaded',
      httpStatus: 503, failurePhase: 'PROMPT',
    })
    expect(JSON.stringify(result)).not.toContain('token=private')
  })

  it.each([
    ['UnknownError', 'opencode.prompt.provider-unknown', 'OpenCode provider returned an unknown error'],
    ['MessageOutputLengthError', 'opencode.prompt.output-length', 'OpenCode provider stopped at its output length limit'],
  ] as const)('preserves the allowlisted %s discriminator without its private message', async (name, code, safeDiagnostic) => {
    vi.mocked(createOpencodeServer).mockResolvedValue({ url: 'http://127.0.0.1:49152', close: vi.fn() })
    clientWith({ data: { id: 'ses_1' } }, {
      data: { parts: [], error: { name, data: { message: 'provider secret=private' } } },
    })
    const result = await createOpencodeProvider(createSdkAdapter({ startupTimeoutMs: 1000 })).start({
      cwd: '/work', task: 'task', route: { executor: 'opencode', permissionMode: 'read-only' },
      signal: new AbortController().signal, deadlineAtMs: Date.now() + 60_000,
    })

    expect(result.failure).toMatchObject({ category: 'other', code, safeDiagnostic, failurePhase: 'PROMPT' })
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('keeps an unrecognized provider discriminator generic and private', async () => {
    vi.mocked(createOpencodeServer).mockResolvedValue({ url: 'http://127.0.0.1:49152', close: vi.fn() })
    clientWith({ data: { id: 'ses_1' } }, {
      data: { parts: [], error: { name: 'PrivateServiceCredentialError', data: { message: 'secret=private' } } },
    })
    const result = await createOpencodeProvider(createSdkAdapter({ startupTimeoutMs: 1000 })).start({
      cwd: '/work', task: 'task', route: { executor: 'opencode', permissionMode: 'read-only' },
      signal: new AbortController().signal, deadlineAtMs: Date.now() + 60_000,
    })

    expect(result.failure).toMatchObject({
      category: 'other', code: 'opencode.prompt.failed',
      safeDiagnostic: 'OpenCode prompt failed before returning a valid result', failurePhase: 'PROMPT',
    })
    expect(JSON.stringify(result)).not.toContain('PrivateServiceCredentialError')
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('identifies an unclassified rejected prompt call without retaining exception details', async () => {
    vi.mocked(createOpencodeServer).mockResolvedValue({ url: 'http://127.0.0.1:49152', close: vi.fn() })
    clientWith({ data: { id: 'ses_1' } }, Promise.reject(new TypeError('credential=private transport detail')))
    const result = await createOpencodeProvider(createSdkAdapter({ startupTimeoutMs: 1000 })).start({
      cwd: '/work', task: 'task', route: { executor: 'opencode', permissionMode: 'read-only' },
      signal: new AbortController().signal, deadlineAtMs: Date.now() + 60_000,
    })

    expect(result.failure).toMatchObject({
      category: 'other', code: 'opencode.prompt.rejected-unclassified',
      safeDiagnostic: 'OpenCode prompt call failed without a recognized error signal', failurePhase: 'PROMPT',
    })
    expect(JSON.stringify(result)).not.toContain('credential')
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('translates only the exact SDK MessageAbortedError name without exposing its message', async () => {
    const aborted = Object.assign(new Error('private prompt detail'), { name: 'MessageAbortedError' })
    const client = clientWith({ data: { id: 'ses_1' } }, Promise.reject(aborted))
    await expect(client.prompt({ sessionId: 'ses_1', directory: '/work', text: 'task' }))
      .rejects.toMatchObject({ name: 'OpencodeSessionAbortedError', message: 'OpenCode aborted the active session before returning a valid result' })
  })

  it('classifies an incomplete prompt response with a stable provider failure', async () => {
    vi.mocked(createOpencodeServer).mockResolvedValue({ url: 'http://127.0.0.1:49152', close: vi.fn() })
    clientWith({ data: { id: 'ses_1' } }, {})
    const result = await createOpencodeProvider(createSdkAdapter({ startupTimeoutMs: 1000 })).start({
      cwd: '/work', task: 'task', route: { executor: 'opencode', permissionMode: 'read-only' },
      signal: new AbortController().signal,
      deadlineAtMs: Date.now() + 60_000,
    })

    expect(result).toMatchObject({
      status: 'error',
      failure: {
        category: 'other',
        code: 'opencode.prompt.response-missing-data',
        safeDiagnostic: 'OpenCode returned an incomplete SDK response',
        failurePhase: 'PROMPT',
      },
    })
  })
})

describe('SDK startup deadline', () => {
  it('allows a thirteen-second cold start within the configured deadline', async () => {
    vi.useFakeTimers()
    vi.mocked(createOpencodeServer).mockImplementation(async options => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { reject(new Error('startup deadline exceeded')) }, options?.timeout ?? 5000)
      setTimeout(() => { clearTimeout(timeout); resolve({ url: 'http://127.0.0.1:49152', close: vi.fn() }) }, 13000)
    }))
    const adapter = createSdkAdapter({ startupTimeoutMs: 60000 })
    const pending = adapter.startServer({
      hostname: '127.0.0.1', port: 0, signal: new AbortController().signal,
      config: { permission: permissionConfig('workspace-write') },
    })
    expect(createOpencodeServer).toHaveBeenCalledWith(expect.objectContaining({ timeout: 60001 }))
    const verification = expect(pending).resolves.toMatchObject({ url: 'http://127.0.0.1:49152' })
    await Promise.all([verification, vi.advanceTimersByTimeAsync(13000)])
  })

  it('reports an expired startup deadline without starting a session', async () => {
    vi.mocked(createOpencodeServer).mockImplementation(async options => await new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => { reject(new Error('untrusted startup detail')) }, { once: true })
    }))
    const provider = createOpencodeProvider(createSdkAdapter({ startupTimeoutMs: 5 }))
    const result = await provider.start({ cwd: '/work', task: 'unused',
      route: { executor: 'opencode', permissionMode: 'read-only' }, signal: new AbortController().signal,
      deadlineAtMs: Date.now() + 60_000 })
    expect(result.failure).toEqual({ category: 'transport-unavailable', code: 'opencode.server.startup-timeout',
      safeDiagnostic: 'OpenCode server did not become ready before the startup deadline', failurePhase: 'STARTUP' })
  })

  it('does not copy a non-timeout error or an appended response into its diagnostic', async () => {
    vi.mocked(createOpencodeServer).mockRejectedValue(new Error('Timeout waiting for server to start after 1234ms SECRET=private'))
    const result = await createOpencodeProvider(createSdkAdapter({ startupTimeoutMs: 1234 })).start({
      cwd: '/work', task: 'unused', route: { executor: 'opencode', permissionMode: 'read-only' },
      signal: new AbortController().signal, deadlineAtMs: Date.now() + 60_000,
    })
    expect(result.failure).toEqual({ category: 'other', code: 'opencode.server.start-failed',
      safeDiagnostic: 'OpenCode server failed before becoming ready', failurePhase: 'STARTUP' })
  })

  it('keeps startup cancellation classified as aborted', async () => {
    const controller = new AbortController()
    vi.mocked(createOpencodeServer).mockImplementation(async () => { controller.abort(); throw new Error('abort') })
    const result = await createOpencodeProvider(createSdkAdapter({ startupTimeoutMs: 60000 })).start({
      cwd: '/work', task: 'unused', route: { executor: 'opencode', permissionMode: 'read-only' }, signal: controller.signal,
      deadlineAtMs: Date.now() + 60_000,
    })
    expect(result).toEqual({ status: 'aborted', output: '' })
  })
})

describe('managed server process-tree ownership', () => {
  it('waits for the whole process tree before issuing a quiescence proof', async () => {
    const specs: SubprocessSpawnSpec[] = []
    let resolveDone = (): void => undefined
    const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      resolveDone = () => { resolve({ exitCode: 0, signal: null }) }
    })
    const spawn = (spec: SubprocessSpawnSpec): SubprocessHandle => {
      specs.push(spec)
      return {
        pid: 4321,
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        collected: {
          stdout: { readFrom: () => ({ text: 'opencode server listening on http://127.0.0.1:43210\n', nextOffset: 52, lossy: false }) },
        },
        done,
        terminate: vi.fn(),
        waitForExit: vi.fn(async () => { resolveDone(); return true }),
      }
    }
    const adapter = createSdkAdapter({ startupTimeoutMs: 1000, spawn, cwd: '/work', disposeGraceMs: 50 })
    const server = await adapter.startServer({
      hostname: '127.0.0.1', port: 0, signal: new AbortController().signal,
      config: { permission: permissionConfig('workspace-write') },
    })

    expect(specs[0]).toMatchObject({
      argv: ['opencode', 'serve', '--hostname=127.0.0.1', '--port=0'],
      cwd: '/work', graceMs: 50,
    })
    const proof = await server.close()
    expect(proof).toMatchObject({ processId: 4321 })
    expect(typeof proof?.observedAtMs).toBe('number')
  })
})
