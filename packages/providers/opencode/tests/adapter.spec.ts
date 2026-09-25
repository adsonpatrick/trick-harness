/** SDK startup deadline, kept independent of provider/model response time. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk'
import { createSdkAdapter } from '../src/adapter.ts'
import { permissionConfig } from '../src/config.ts'
import { createOpencodeProvider } from '../src/index.ts'
import type { OpencodeClientHandle } from '../src/types.ts'

vi.mock('@opencode-ai/sdk', () => ({ createOpencodeServer: vi.fn(), createOpencodeClient: vi.fn() }))
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks() })

function clientWith(createResponse: unknown, promptResponse: unknown): OpencodeClientHandle {
  vi.mocked(createOpencodeClient).mockReturnValue({
    session: {
      create: vi.fn(async () => createResponse),
      prompt: vi.fn(async () => promptResponse),
      abort: vi.fn(async () => ({})),
    },
  } as never)
  return createSdkAdapter({ startupTimeoutMs: 1000 }).connect('http://127.0.0.1:1234', '/work')
}

describe('SDK response validation', () => {
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
    })

    expect(result).toMatchObject({
      status: 'error',
      failure: {
        category: 'other',
        code: 'opencode.prompt.response-missing-data',
        safeDiagnostic: 'OpenCode returned an incomplete SDK response',
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
    expect(createOpencodeServer).toHaveBeenCalledWith(expect.objectContaining({ timeout: 60000 }))
    const verification = expect(pending).resolves.toMatchObject({ url: 'http://127.0.0.1:49152' })
    await Promise.all([verification, vi.advanceTimersByTimeAsync(13000)])
  })

  it('reports an expired startup deadline without starting a session', async () => {
    vi.mocked(createOpencodeServer).mockRejectedValue(new Error('Timeout waiting for server to start after 1234ms'))
    const provider = createOpencodeProvider(createSdkAdapter({ startupTimeoutMs: 1234 }))
    const result = await provider.start({ cwd: '/work', task: 'unused',
      route: { executor: 'opencode', permissionMode: 'read-only' }, signal: new AbortController().signal })
    expect(result.failure).toEqual({ category: 'transport-unavailable', code: 'opencode.server.startup-timeout',
      safeDiagnostic: 'OpenCode server did not become ready before the startup deadline' })
  })

  it('does not copy a non-timeout error or an appended response into its diagnostic', async () => {
    vi.mocked(createOpencodeServer).mockRejectedValue(new Error('Timeout waiting for server to start after 1234ms SECRET=private'))
    const result = await createOpencodeProvider(createSdkAdapter({ startupTimeoutMs: 1234 })).start({
      cwd: '/work', task: 'unused', route: { executor: 'opencode', permissionMode: 'read-only' },
      signal: new AbortController().signal,
    })
    expect(result.failure).toEqual({ category: 'other', code: 'opencode.server.start-failed',
      safeDiagnostic: 'OpenCode server failed before becoming ready' })
  })

  it('keeps startup cancellation classified as aborted', async () => {
    const controller = new AbortController()
    vi.mocked(createOpencodeServer).mockImplementation(async () => { controller.abort(); throw new Error('abort') })
    const result = await createOpencodeProvider(createSdkAdapter({ startupTimeoutMs: 60000 })).start({
      cwd: '/work', task: 'unused', route: { executor: 'opencode', permissionMode: 'read-only' }, signal: controller.signal,
    })
    expect(result).toEqual({ status: 'aborted', output: '' })
  })
})
