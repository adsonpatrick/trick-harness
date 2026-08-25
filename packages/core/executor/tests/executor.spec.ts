/** Provider registration, capability validation, dispatch, and run lifecycle. */

import { describe, expect, it, vi } from 'vitest'
import {
  createExecutorRuntime,
  ExecutorCapabilityError,
  ExecutorProviderError,
} from '../src/index.ts'
import type {
  ExecutorCapabilities,
  ExecutorProvider,
  ExecutorResult,
  ExecutorRoute,
  ExecutorStartRequest,
} from '../src/types.ts'

/** Provider `start` signature, so a mock's recorded calls stay a typed tuple. */
type ProviderStart = (request: ExecutorStartRequest) => Promise<ExecutorResult>

const fullCapabilities: ExecutorCapabilities = {
  modelOverride: true,
  reasoningEffort: true,
  permissionModes: ['read-only', 'workspace-write'],
}

/** Build a provider that records what it was asked to run. */
function provider(
  name: string,
  capabilities: ExecutorCapabilities = fullCapabilities,
  start: (request: ExecutorStartRequest) => Promise<ExecutorResult> = async () =>
    ({ status: 'completed', output: 'ok' }),
): ExecutorProvider {
  return { name, capabilities, start }
}

const route: ExecutorRoute = { executor: 'codex', permissionMode: 'read-only' }

/** Build a start request, overriding whichever fields a case cares about. */
function request(overrides: Partial<ExecutorStartRequest> = {}): ExecutorStartRequest {
  return {
    cwd: '/work/repo',
    task: 'do the thing',
    route,
    signal: new AbortController().signal,
    ...overrides,
  }
}

describe('provider registration', () => {
  it('registers and looks a provider up by name', () => {
    const runtime = createExecutorRuntime()
    runtime.register(provider('codex'))
    expect(runtime.get('codex').name).toBe('codex')
  })

  it('rejects a duplicate provider name', () => {
    const runtime = createExecutorRuntime()
    runtime.register(provider('codex'))
    expect(() => runtime.register(provider('codex'))).toThrow(ExecutorProviderError)
  })

  it('rejects a blank provider name', () => {
    const runtime = createExecutorRuntime()
    expect(() => runtime.register(provider(''))).toThrow(ExecutorProviderError)
  })

  it('rejects a provider that enforces no permission mode', () => {
    const runtime = createExecutorRuntime()
    expect(() => runtime.register(provider('codex', { ...fullCapabilities, permissionModes: [] })))
      .toThrow(ExecutorCapabilityError)
  })

  it('names the missing provider on lookup', () => {
    const runtime = createExecutorRuntime()
    expect(() => runtime.get('absent')).toThrow(/absent/)
  })

  it('frees the name when a registration is disposed', () => {
    const runtime = createExecutorRuntime()
    const registration = runtime.register(provider('codex'))
    registration.dispose()
    expect(runtime.list()).toEqual([])
    expect(() => runtime.register(provider('codex'))).not.toThrow()
  })

  it('keeps a repeated dispose from evicting the replacement registration', () => {
    const runtime = createExecutorRuntime()
    const registration = runtime.register(provider('codex'))
    registration.dispose()
    runtime.register(provider('codex'))
    registration.dispose()
    expect(runtime.list()).toHaveLength(1)
  })

  it('lists providers in registration order', () => {
    const runtime = createExecutorRuntime()
    runtime.register(provider('codex'))
    runtime.register(provider('opencode'))
    expect(runtime.list().map(entry => entry.name)).toEqual(['codex', 'opencode'])
  })
})

describe('capability validation', () => {
  it('refuses a model override the provider does not honour', async () => {
    const runtime = createExecutorRuntime()
    const start = vi.fn()
    runtime.register(provider('codex', { ...fullCapabilities, modelOverride: false }, start))
    await expect(runtime.start(request({ route: { ...route, model: 'gpt-5.6-sol' } })))
      .rejects.toThrow(ExecutorCapabilityError)
    expect(start).not.toHaveBeenCalled()
  })

  it('refuses a reasoning effort the provider does not honour', async () => {
    const runtime = createExecutorRuntime()
    const start = vi.fn()
    runtime.register(provider('codex', { ...fullCapabilities, reasoningEffort: false }, start))
    await expect(runtime.start(request({ route: { ...route, reasoningEffort: 'high' } })))
      .rejects.toThrow(ExecutorCapabilityError)
    expect(start).not.toHaveBeenCalled()
  })

  it('refuses a permission mode the provider cannot enforce', async () => {
    const runtime = createExecutorRuntime()
    const start = vi.fn()
    runtime.register(provider('codex', { ...fullCapabilities, permissionModes: ['read-only'] }, start))
    await expect(runtime.start(request({ route: { ...route, permissionMode: 'workspace-write' } })))
      .rejects.toThrow(ExecutorCapabilityError)
    expect(start).not.toHaveBeenCalled()
  })

  it('allows an absent optional field against a provider that lacks the capability', async () => {
    const runtime = createExecutorRuntime()
    runtime.register(provider('codex', {
      modelOverride: false,
      reasoningEffort: false,
      permissionModes: ['read-only'],
    }))
    await expect(runtime.start(request())).resolves.toMatchObject({ status: 'completed' })
  })

  it('refuses to dispatch to an unregistered executor', async () => {
    const runtime = createExecutorRuntime()
    await expect(runtime.start(request())).rejects.toThrow(ExecutorProviderError)
  })

  it('refuses a relative working directory', async () => {
    const runtime = createExecutorRuntime()
    runtime.register(provider('codex'))
    await expect(runtime.start(request({ cwd: 'relative/path' })))
      .rejects.toThrow(/cwd/)
  })

  it('refuses an empty task', async () => {
    const runtime = createExecutorRuntime()
    runtime.register(provider('codex'))
    await expect(runtime.start(request({ task: '   ' }))).rejects.toThrow(/task/)
  })
})

describe('dispatch and run lifecycle', () => {
  it('hands the request through to the selected provider', async () => {
    const runtime = createExecutorRuntime()
    const start = vi.fn<ProviderStart>(async () => ({ status: 'completed', output: 'ok' }))
    const other = vi.fn()
    runtime.register(provider('codex', fullCapabilities, start))
    runtime.register(provider('opencode', fullCapabilities, other))
    const sent = request({ route: { ...route, model: 'gpt-5.6-terra', reasoningEffort: 'medium' } })
    await runtime.start(sent)
    expect(other).not.toHaveBeenCalled()
    expect(start.mock.calls[0]?.[0]).toMatchObject({
      cwd: sent.cwd,
      task: sent.task,
      route: sent.route,
    })
  })

  it('gives the provider a chained signal rather than the caller’s own', async () => {
    // The runtime must be able to end a run the caller has no reason to cancel,
    // so it owns the signal the provider sees.
    const runtime = createExecutorRuntime()
    const start = vi.fn<ProviderStart>(async () => ({ status: 'completed', output: 'ok' }))
    runtime.register(provider('codex', fullCapabilities, start))
    const sent = request()
    await runtime.start(sent)
    expect(start.mock.calls[0]?.[0]?.signal).not.toBe(sent.signal)
  })

  it('counts a run as active only while it is in flight', async () => {
    const runtime = createExecutorRuntime()
    let release = (): void => {}
    const pending = new Promise<ExecutorResult>((resolve) => {
      release = () => { resolve({ status: 'completed', output: 'ok' }) }
    })
    runtime.register(provider('codex', fullCapabilities, () => pending))
    expect(runtime.activeRuns()).toBe(0)
    const inFlight = runtime.start(request())
    expect(runtime.activeRuns()).toBe(1)
    release()
    await inFlight
    expect(runtime.activeRuns()).toBe(0)
  })

  it('releases the active-run slot when a provider throws', async () => {
    const runtime = createExecutorRuntime()
    runtime.register(provider('codex', fullCapabilities, () => Promise.reject(new Error('boom'))))
    await expect(runtime.start(request())).rejects.toThrow('boom')
    expect(runtime.activeRuns()).toBe(0)
  })

  it('reports an already-aborted signal without starting the provider', async () => {
    const runtime = createExecutorRuntime()
    const start = vi.fn()
    runtime.register(provider('codex', fullCapabilities, start))
    const controller = new AbortController()
    controller.abort()
    await expect(runtime.start(request({ signal: controller.signal })))
      .resolves.toMatchObject({ status: 'aborted' })
    expect(start).not.toHaveBeenCalled()
  })

  it('propagates the caller’s signal to the provider', async () => {
    const runtime = createExecutorRuntime()
    const controller = new AbortController()
    const seen: boolean[] = []
    runtime.register(provider('codex', fullCapabilities, async (received) => {
      controller.abort()
      seen.push(received.signal.aborted)
      return { status: 'aborted', output: '' }
    }))
    await runtime.start(request({ signal: controller.signal }))
    expect(seen).toEqual([true])
  })

  it('refuses to start once the runtime is disposed', async () => {
    const runtime = createExecutorRuntime()
    runtime.register(provider('codex'))
    runtime.dispose()
    await expect(runtime.start(request())).rejects.toThrow(ExecutorProviderError)
  })

  it('unregisters every provider on disposal', () => {
    const runtime = createExecutorRuntime()
    runtime.register(provider('codex'))
    runtime.register(provider('opencode'))
    runtime.dispose()
    expect(runtime.list()).toEqual([])
  })

  it('aborts in-flight runs on disposal', async () => {
    const runtime = createExecutorRuntime()
    let observed: AbortSignal | undefined
    runtime.register(provider('codex', fullCapabilities, request_ => new Promise((resolve) => {
      observed = request_.signal
      request_.signal.addEventListener('abort', () => { resolve({ status: 'aborted', output: '' }) })
    })))
    const inFlight = runtime.start(request())
    runtime.dispose()
    await expect(inFlight).resolves.toMatchObject({ status: 'aborted' })
    expect(observed?.aborted).toBe(true)
  })

  it('surfaces a provider failure as a result rather than a throw', async () => {
    const runtime = createExecutorRuntime()
    runtime.register(provider('codex', fullCapabilities, async () => ({
      status: 'error',
      output: '',
      failure: { category: 'unavailable', availability: false, safeDiagnostic: 'server refused' },
    })))
    await expect(runtime.start(request())).resolves.toMatchObject({
      status: 'error',
      failure: { availability: false },
    })
  })
})
