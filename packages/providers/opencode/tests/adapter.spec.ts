/** SDK startup deadline, kept independent of provider/model response time. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpencodeServer } from '@opencode-ai/sdk'
import { createSdkAdapter } from '../src/adapter.ts'
import { permissionConfig } from '../src/config.ts'
import { createOpencodeProvider } from '../src/index.ts'

vi.mock('@opencode-ai/sdk', () => ({ createOpencodeServer: vi.fn(), createOpencodeClient: vi.fn() }))
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks() })

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
    expect(result.failure).toEqual({ category: 'provider-error', availability: false,
      safeDiagnostic: 'OpenCode server did not become ready within 1234 ms; increase the startup timeout or inspect OpenCode startup' })
  })

  it('does not copy a non-timeout error or an appended response into its diagnostic', async () => {
    vi.mocked(createOpencodeServer).mockRejectedValue(new Error('Timeout waiting for server to start after 1234ms SECRET=private'))
    const result = await createOpencodeProvider(createSdkAdapter({ startupTimeoutMs: 1234 })).start({
      cwd: '/work', task: 'unused', route: { executor: 'opencode', permissionMode: 'read-only' },
      signal: new AbortController().signal,
    })
    expect(result.failure?.safeDiagnostic).toBe('opencode run failed (Error)')
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
