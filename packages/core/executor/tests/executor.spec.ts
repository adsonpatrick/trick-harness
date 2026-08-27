/** Provider registration, capability validation, dispatch, and run lifecycle. */

import { describe, expect, it, vi } from 'vitest'
import {
  cleanupFailure,
  CLEANUP_EVIDENCE_LIMIT,
  createExecutorRuntime,
  dispatchableRoute,
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

/**
 * Drain the microtask queue so a promise that *would* settle already has.
 *
 * What the quiescence tests need is the difference between "not settled yet"
 * and "never going to settle without the provider": a single `await` proves
 * neither, because a settled promise takes a few turns to reach its callback.
 * @returns Nothing; resolves once the queue has been given room to run.
 */
async function settleMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
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
    await runtime.dispose()
    await expect(runtime.start(request())).rejects.toThrow(ExecutorProviderError)
  })

  it('refuses to start once disposal has begun, before it has finished', async () => {
    const runtime = createExecutorRuntime()
    const teardown = Promise.withResolvers<ExecutorResult>()
    runtime.register(provider('codex', fullCapabilities, async () => teardown.promise))
    const inFlight = runtime.start(request())
    const disposal = runtime.dispose()
    await expect(runtime.start(request())).rejects.toThrow(ExecutorProviderError)
    teardown.resolve({ status: 'aborted', output: '' })
    await Promise.all([disposal, inFlight])
  })

  it('unregisters every provider on disposal', async () => {
    const runtime = createExecutorRuntime()
    runtime.register(provider('codex'))
    runtime.register(provider('opencode'))
    await runtime.dispose()
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
    await runtime.dispose()
    await expect(inFlight).resolves.toMatchObject({ status: 'aborted' })
    expect(observed?.aborted).toBe(true)
  })

  it('keeps a run counted until the provider settles after its own teardown', async () => {
    const runtime = createExecutorRuntime()
    const teardown = Promise.withResolvers<null>()
    let sawAbort = false
    runtime.register(provider('codex', fullCapabilities, async (received) => {
      received.signal.addEventListener('abort', () => { sawAbort = true })
      await teardown.promise
      return { status: 'aborted', output: '' }
    }))
    const inFlight = runtime.start(request())

    const disposal = runtime.dispose()
    // The signal has been delivered, but delivery is not quiescence: the
    // provider is still taking its process tree down.
    expect(sawAbort).toBe(true)
    expect(runtime.activeRuns()).toBe(1)

    let quiescent = false
    void disposal.then(() => { quiescent = true })
    await settleMicrotasks()
    expect(quiescent).toBe(false)
    expect(runtime.activeRuns()).toBe(1)

    teardown.resolve(null)
    await disposal
    expect(quiescent).toBe(true)
    expect(runtime.activeRuns()).toBe(0)
    await expect(inFlight).resolves.toMatchObject({ status: 'aborted' })
  })

  it('waits for a provider that ignores the abort entirely', async () => {
    const runtime = createExecutorRuntime()
    const finish = Promise.withResolvers<ExecutorResult>()
    runtime.register(provider('codex', fullCapabilities, async () => finish.promise))
    const inFlight = runtime.start(request())

    let quiescent = false
    const disposal = runtime.dispose()
    void disposal.then(() => { quiescent = true })
    await settleMicrotasks()
    expect(quiescent).toBe(false)

    finish.resolve({ status: 'completed', output: 'ok' })
    await disposal
    expect(runtime.activeRuns()).toBe(0)
    await expect(inFlight).resolves.toMatchObject({ status: 'completed' })
  })

  it('still reaches quiescence when the provider settles by throwing', async () => {
    const runtime = createExecutorRuntime()
    const teardown = Promise.withResolvers<null>()
    runtime.register(provider('codex', fullCapabilities, async () => {
      await teardown.promise
      throw new Error('teardown failed')
    }))
    const inFlight = runtime.start(request())
    const rejection = expect(inFlight).rejects.toThrow('teardown failed')

    const disposal = runtime.dispose()
    teardown.resolve(null)
    await expect(disposal).resolves.toBeUndefined()
    expect(runtime.activeRuns()).toBe(0)
    await rejection
  })

  it('answers a second disposal with the first one settlement', async () => {
    const runtime = createExecutorRuntime()
    const teardown = Promise.withResolvers<ExecutorResult>()
    runtime.register(provider('codex', fullCapabilities, async () => teardown.promise))
    const inFlight = runtime.start(request())

    const first = runtime.dispose()
    const second = runtime.dispose()
    expect(second).toBe(first)

    teardown.resolve({ status: 'aborted', output: '' })
    await Promise.all([first, second])
    expect(runtime.activeRuns()).toBe(0)
    await inFlight
    await expect(runtime.dispose()).resolves.toBeUndefined()
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

describe('narrowing a policy intent to a dispatchable route', () => {
  const effortless: ExecutorCapabilities = {
    modelOverride: true,
    reasoningEffort: false,
    permissionModes: ['read-only', 'workspace-write'],
  }

  it('keeps a reasoning effort the provider honours', () => {
    const narrowed = dispatchableRoute(provider('codex', fullCapabilities), {
      executor: 'codex',
      permissionMode: 'workspace-write',
      reasoningEffort: 'high',
    })
    expect(narrowed.route.reasoningEffort).toBe('high')
    expect(narrowed.dropped).toEqual([])
  })

  it('drops a reasoning effort the provider cannot honour, and says so', () => {
    const narrowed = dispatchableRoute(provider('opencode', effortless), {
      executor: 'opencode',
      permissionMode: 'workspace-write',
      reasoningEffort: 'high',
    })
    expect(narrowed.route.reasoningEffort).toBeUndefined()
    expect(narrowed.dropped).toEqual(['reasoningEffort'])
  })

  it('makes an advisory effort dispatchable instead of undispatchable', async () => {
    // The point of the whole helper: a policy that states an effort on every
    // row must not make an executor without the knob unroutable.
    const runtime = createExecutorRuntime()
    runtime.register(provider('opencode', effortless))
    const { route } = dispatchableRoute(runtime.get('opencode'), {
      executor: 'opencode',
      permissionMode: 'read-only',
      reasoningEffort: 'medium',
    })
    await expect(runtime.start({ ...request(), route })).resolves.toMatchObject({
      status: 'completed',
    })
  })

  it('never drops the model, so no run is attributed to a model that did not run it', () => {
    const narrowed = dispatchableRoute(provider('opencode', {
      modelOverride: false,
      reasoningEffort: false,
      permissionModes: ['read-only'],
    }), {
      executor: 'opencode',
      permissionMode: 'read-only',
      model: 'anthropic/claude-opus-5',
    })
    expect(narrowed.route.model).toBe('anthropic/claude-opus-5')
    expect(narrowed.dropped).toEqual([])
  })

  it('leaves a route the runtime must still refuse refusable', async () => {
    const runtime = createExecutorRuntime()
    runtime.register(provider('opencode', {
      modelOverride: false,
      reasoningEffort: false,
      permissionModes: ['read-only'],
    }))
    const { route } = dispatchableRoute(runtime.get('opencode'), {
      executor: 'opencode',
      permissionMode: 'read-only',
      model: 'anthropic/claude-opus-5',
    })
    await expect(runtime.start({ ...request(), route })).rejects.toThrow(ExecutorCapabilityError)
  })
})

describe('cleanup facts travel beside the outcome, not inside it', () => {
  const wedged = cleanupFailure('opencode-server-close', new Error('EADDRINUSE token=sk-live'))

  it.each([
    ['completed', { status: 'completed', output: 'ok' }],
    ['aborted', { status: 'aborted', output: '' }],
    ['error', {
      status: 'error',
      output: '',
      failure: { category: 'provider-error', availability: false, safeDiagnostic: 'nope' },
    }],
  ] as const)('leaves a %s run classified exactly as the provider classified it', async (
    status,
    outcome: ExecutorResult,
  ) => {
    const runtime = createExecutorRuntime()
    runtime.register(provider('codex', fullCapabilities, async () =>
      ({ ...outcome, cleanup: [wedged] })))
    const result = await runtime.start(request())
    expect(result.status).toBe(status)
    expect(result.failure).toEqual(outcome.failure)
    expect(result.cleanup).toEqual([wedged])
  })

  it('builds a durable fact from the error class name and nothing else', () => {
    const error = new Error('listen EADDRINUSE 127.0.0.1:49512 authorization=Bearer sk-live-77')
    error.name = 'ServerCloseError'
    expect(cleanupFailure('opencode-server-close', error)).toEqual({
      category: 'opencode-server-close',
      safeDiagnostic: 'opencode-server-close failed (ServerCloseError)',
    })
  })

  it('refuses a raw message even when a product hides it in the class name', () => {
    // The only field read off the error is `name`, and `name` is writable. A
    // product that assigned its message there would otherwise have found the
    // one gap in a contract whose entire purpose is that no product text passes.
    const error = new Error('inner')
    error.name = 'failed to close http://127.0.0.1:49512?token=sk-live-77'
    expect(cleanupFailure('opencode-server-close', error).safeDiagnostic)
      .toBe('opencode-server-close failed (Error)')
  })

  it('names a thrown non-error safely rather than describing it', () => {
    expect(cleanupFailure('codex-run-dispose', 'kill EPERM pid 4321').safeDiagnostic)
      .toBe('codex-run-dispose failed (Error)')
  })

  it('freezes the fact, so nothing downstream can edit the durable record', () => {
    expect(Object.isFrozen(cleanupFailure('codex-run-dispose', new Error('x')))).toBe(true)
  })
})

describe('cleanup evidence outlives the runs that produced it', () => {
  const fault = cleanupFailure('codex-run-dispose', new Error('x'))

  /**
   * A runtime whose only provider fails teardown on every run.
   * @param faults - the cleanup facts each run reports.
   * @returns the runtime, ready to dispatch.
   */
  function runtimeReporting(faults: readonly ReturnType<typeof cleanupFailure>[]) {
    const runtime = createExecutorRuntime()
    runtime.register(provider('codex', fullCapabilities, async () =>
      ({ status: 'completed', output: 'ok', cleanup: faults })))
    return runtime
  }

  it('calls a runtime clean only until something fails to tear down', async () => {
    const runtime = runtimeReporting([])
    expect(runtime.cleanupReport()).toEqual({ clean: true, total: 0, retained: [] })
    await runtime.dispose()
    expect(runtime.cleanupReport().clean).toBe(true)
  })

  it('refuses to call a settled disposal clean when teardown failed', async () => {
    const runtime = runtimeReporting([fault])
    await runtime.start(request())
    // Quiescence and cleanliness are different claims: the run did come back,
    // and it came back having left something running.
    await runtime.dispose()
    expect(runtime.cleanupReport()).toEqual({ clean: false, total: 1, retained: [fault] })
  })

  it('keeps the evidence readable after disposal, when the run is long gone', async () => {
    const runtime = runtimeReporting([fault])
    await runtime.start(request())
    await runtime.dispose()
    expect(runtime.cleanupReport().retained).toEqual([fault])
  })

  it('bounds retained evidence without ever hiding how much there was', async () => {
    const runtime = runtimeReporting([fault, fault, fault])
    for (let run = 0; run < CLEANUP_EVIDENCE_LIMIT; run += 1) await runtime.start(request())
    const report = runtime.cleanupReport()
    // The count is the honest part. Truncating the examples is a memory bound;
    // truncating the count would be the runtime under-reporting its own mess.
    expect(report.total).toBe(CLEANUP_EVIDENCE_LIMIT * 3)
    expect(report.retained).toHaveLength(CLEANUP_EVIDENCE_LIMIT)
    expect(report.clean).toBe(false)
  })

  it('hands out a frozen snapshot rather than its own evidence list', async () => {
    const runtime = runtimeReporting([fault])
    await runtime.start(request())
    const first = runtime.cleanupReport()
    expect(Object.isFrozen(first.retained)).toBe(true)
    await runtime.start(request())
    expect(first.retained).toHaveLength(1)
    expect(runtime.cleanupReport().retained).toHaveLength(2)
  })
})
