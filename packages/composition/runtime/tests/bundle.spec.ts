import { describe, expect, it, vi } from 'vitest'
import { createExecutorRuntime, type ExecutorProvider, type ExecutorResult } from '@trick-harness/executor'
import { ProfileValidationError } from '@trick-harness/profile'
import type { HarnessProfile, RoutingPolicyDefinition } from '@trick-harness/profile'
import type { OpencodeAdapter } from '@trick-harness/provider-opencode'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  BundleCompositionError,
  composeHarnessRuntime,
  createHarnessRuntimeBundle,
  routedExecutors,
} from '../src/index.ts'
import { EXECUTOR_FIELD } from '../src/invariant.ts'

/**
 * Every product entry point the two real providers could reach, recorded rather
 * than stubbed out: the point of most of these tests is that none of them is
 * ever called by composition.
 */
function productSeams() {
  // Plain counters rather than spies: the assertion these tests make is that a
  // seam was never reached, and a counter reads the same whether the call would
  // have been bound or not.
  let spawns = 0
  let serverStarts = 0
  let connects = 0
  const spawn = (_spec: SubprocessSpawnSpec): SubprocessHandle => {
    spawns += 1
    throw new Error('composition must not spawn a Codex process')
  }
  const adapter: OpencodeAdapter = {
    startServer: () => {
      serverStarts += 1
      throw new Error('composition must not start an OpenCode server')
    },
    connect: () => {
      connects += 1
      throw new Error('composition must not connect an OpenCode client')
    },
  }
  return { spawn, adapter, reached: (): number => spawns + serverStarts + connects }
}

function bothProviders() {
  const seams = productSeams()
  return {
    seams,
    options: {
      opencode: { adapter: seams.adapter },
      codex: { spawn: seams.spawn },
    },
  }
}

function routingPolicy(overrides: Partial<RoutingPolicyDefinition> = {}): RoutingPolicyDefinition {
  return {
    rules: [{ id: 'implement', when: { stage: 'implement' }, use: { executor: 'codex', effort: 'medium' } }],
    fallbackRules: [{ id: 'implement-fallback', when: { stage: 'implement' }, use: { executor: 'opencode' } }],
    ...overrides,
  }
}

function profile(overrides: Partial<HarnessProfile> = {}): HarnessProfile {
  return {
    id: 'sample',
    policyVersion: 'sample-v1.0.0',
    routingPolicy: routingPolicy(),
    workflowPolicy: { maxRepairCycles: 2, maxExecutorStarts: 6 },
    independencePolicy: {
      low: 'fresh-context',
      medium: 'cross-executor-preferred',
      high: 'cross-executor-required',
      critical: 'cross-executor-required',
    },
    qaPolicy: { rules: [] },
    securityPolicy: { rules: [] },
    integrationPolicy: { enabled: [], rules: [] },
    trustedComposition: { excludedPluginIds: [] },
    ...overrides,
  }
}

/** A provider that is not one of the two this package knows about. */
function fakeProvider(name: string): ExecutorProvider {
  return {
    name,
    capabilities: { modelOverride: false, reasoningEffort: false, permissionModes: ['read-only'] },
    start: vi.fn(async (): Promise<ExecutorResult> => ({ status: 'completed', output: 'done' })),
  }
}

describe('load-time composition', () => {
  it('registers both configured executors', () => {
    const bundle = createHarnessRuntimeBundle(bothProviders().options)
    expect(bundle.executors).toEqual(['opencode', 'codex'])
    expect(bundle.runtime.list().map(provider => provider.name)).toEqual(['opencode', 'codex'])
  })

  it('starts no product process and touches no product seam at load', () => {
    const { seams, options } = bothProviders()
    const bundle = createHarnessRuntimeBundle(options)
    expect(seams.reached()).toBe(0)
    expect(bundle.runtime.activeRuns()).toBe(0)
  })

  it('composes an empty runtime when nothing is configured', () => {
    const bundle = createHarnessRuntimeBundle()
    expect(bundle.executors).toEqual([])
    expect(bundle.runtime.list()).toEqual([])
  })

  it('composes onto a runtime it does not own', () => {
    const runtime = createExecutorRuntime()
    const composition = composeHarnessRuntime(runtime, bothProviders().options)
    expect(composition.executors).toEqual(['opencode', 'codex'])
    expect(runtime.list()).toHaveLength(2)
  })
})

describe('every executor is optional', () => {
  it('omits Codex entirely when it is not configured', () => {
    const seams = productSeams()
    const bundle = createHarnessRuntimeBundle({ opencode: { adapter: seams.adapter } })
    expect(bundle.executors).toEqual(['opencode'])
    expect(() => bundle.runtime.get('codex')).toThrow(/not registered/)
  })

  it('omits OpenCode entirely when it is not configured', () => {
    const seams = productSeams()
    const bundle = createHarnessRuntimeBundle({ codex: { spawn: seams.spawn } })
    expect(bundle.executors).toEqual(['codex'])
    expect(() => bundle.runtime.get('opencode')).toThrow(/not registered/)
  })

  it('accepts an executor this package does not know about', () => {
    const { options } = bothProviders()
    const bundle = createHarnessRuntimeBundle({ ...options, extraProviders: [fakeProvider('claude-code')] })
    expect(bundle.executors).toEqual(['opencode', 'codex', 'claude-code'])
  })

  it('dispatches to an unknown executor on equal terms with the built-in two', async () => {
    const extra = fakeProvider('claude-code')
    const bundle = createHarnessRuntimeBundle({ extraProviders: [extra] })
    const result = await bundle.runtime.start({
      cwd: '/work/repo',
      task: 'summarise the diff',
      route: { executor: 'claude-code', permissionMode: 'read-only' },
      signal: new AbortController().signal,
    })
    expect(result).toEqual({ status: 'completed', output: 'done' })
  })
})

describe('the profile seam', () => {
  it('reads the executors a routing table can produce, fallbacks included', () => {
    expect(routedExecutors(profile())).toEqual(['codex', 'opencode'])
  })

  it('reads the same routing field the invariant companion restates', () => {
    const keyed = profile({
      routingPolicy: routingPolicy({
        rules: [{ id: 'keyed', when: {}, use: { [EXECUTOR_FIELD]: 'codex' } }],
        fallbackRules: [],
      }),
    })
    expect(routedExecutors(keyed)).toEqual(['codex'])
  })

  it('ignores rows that name no executor', () => {
    const advisory = profile({
      routingPolicy: routingPolicy({
        rules: [{ id: 'effort-only', when: {}, use: { effort: 'high' } }],
        fallbackRules: [],
      }),
    })
    expect(routedExecutors(advisory)).toEqual([])
  })

  it('accepts a composition that covers every routed executor', () => {
    const bundle = createHarnessRuntimeBundle({ ...bothProviders().options, profile: profile() })
    expect(bundle.executors).toEqual(['opencode', 'codex'])
  })

  it('refuses a composition missing an executor the profile routes to', () => {
    const seams = productSeams()
    expect(() => createHarnessRuntimeBundle({ codex: { spawn: seams.spawn }, profile: profile() }))
      .toThrow(BundleCompositionError)
  })

  it('names every missing executor rather than only the first', () => {
    expect(() => createHarnessRuntimeBundle({ profile: profile() }))
      .toThrow(/unregistered executor\(s\): codex, opencode/)
  })

  it('counts an unknown provider towards coverage', () => {
    const covered = profile({
      routingPolicy: routingPolicy({
        rules: [{ id: 'review', when: {}, use: { executor: 'claude-code' } }],
        fallbackRules: [],
      }),
    })
    const bundle = createHarnessRuntimeBundle({ extraProviders: [fakeProvider('claude-code')], profile: covered })
    expect(bundle.executors).toEqual(['claude-code'])
  })
})

describe('a profile only the compiler ever checked', () => {
  /**
   * Build a profile whose routing rules deliberately leave the type contract.
   *
   * These cases are the ones the compiler cannot reach: a profile parsed from
   * JSON, or handed over from JavaScript. The cast is the test.
   * @param rules - rule rows as an untrusted caller might supply them.
   * @returns a profile-shaped value for composition to refuse.
   */
  function smuggled(rules: readonly unknown[]): HarnessProfile {
    return profile({
      routingPolicy: { rules, fallbackRules: [] } as unknown as RoutingPolicyDefinition,
    })
  }

  it('refuses a nested policy value before a provider is constructed', () => {
    const runtime = createExecutorRuntime()
    const seams = productSeams()
    const nested = smuggled([{ id: 'implement', when: {}, use: { executor: { name: 'codex' } } }])

    expect(() => composeHarnessRuntime(runtime, { codex: { spawn: seams.spawn }, profile: nested }))
      .toThrow(ProfileValidationError)
    expect(runtime.list()).toEqual([])
    expect(seams.reached()).toBe(0)
  })

  it('names the offending policy path rather than the profile as a whole', () => {
    const runtime = createExecutorRuntime()
    const nested = smuggled([{ id: 'implement', when: {}, use: { executor: [] } }])

    expect(() => composeHarnessRuntime(runtime, { profile: nested }))
      .toThrow(/routingPolicy\.rules\[0\]\.use\.executor/)
  })

  it('reaches no product seam for a profile that routes to nothing', () => {
    const seams = productSeams()
    const empty = smuggled([{ id: 'implement', when: {}, use: {} }])

    expect(() => createHarnessRuntimeBundle({ codex: { spawn: seams.spawn }, profile: empty }))
      .toThrow(ProfileValidationError)
    expect(seams.reached()).toBe(0)
  })
})

describe('failed composition leaves nothing behind', () => {
  it('unregisters everything it registered when the profile check fails', () => {
    const runtime = createExecutorRuntime()
    const seams = productSeams()
    expect(() => composeHarnessRuntime(runtime, { codex: { spawn: seams.spawn }, profile: profile() }))
      .toThrow(BundleCompositionError)
    expect(runtime.list()).toEqual([])
  })

  it('unregisters everything it registered when a provider is rejected', () => {
    const runtime = createExecutorRuntime()
    const { options } = bothProviders()
    expect(() => composeHarnessRuntime(runtime, { ...options, extraProviders: [fakeProvider('codex')] }))
      .toThrow(/already registered/)
    expect(runtime.list()).toEqual([])
  })

  it('leaves a runtime it does not own usable after a failed composition', () => {
    const runtime = createExecutorRuntime()
    const kept = runtime.register(fakeProvider('claude-code'))
    expect(() => composeHarnessRuntime(runtime, { profile: profile() })).toThrow(BundleCompositionError)
    expect(runtime.list().map(provider => provider.name)).toEqual(['claude-code'])
    kept.dispose()
  })
})

describe('disposal', () => {
  it('removes exactly the providers it registered', () => {
    const runtime = createExecutorRuntime()
    const kept = runtime.register(fakeProvider('claude-code'))
    const composition = composeHarnessRuntime(runtime, bothProviders().options)
    composition.dispose()
    expect(runtime.list().map(provider => provider.name)).toEqual(['claude-code'])
    kept.dispose()
  })

  it('leaves no orphan registration or run behind on a bundle it owns', () => {
    const bundle = createHarnessRuntimeBundle(bothProviders().options)
    bundle.dispose()
    expect(bundle.runtime.list()).toEqual([])
    expect(bundle.runtime.activeRuns()).toBe(0)
  })

  it('aborts a run in flight when the composed bundle is disposed', async () => {
    let observed: AbortSignal | undefined
    const settled = Promise.withResolvers<ExecutorResult>()
    const slow: ExecutorProvider = {
      name: 'slow',
      capabilities: { modelOverride: false, reasoningEffort: false, permissionModes: ['read-only'] },
      start: async (request) => {
        observed = request.signal
        return settled.promise
      },
    }
    const bundle = createHarnessRuntimeBundle({ extraProviders: [slow] })
    const run = bundle.runtime.start({
      cwd: '/work/repo',
      task: 'wait',
      route: { executor: 'slow', permissionMode: 'read-only' },
      signal: new AbortController().signal,
    })
    await vi.waitFor(() => { expect(observed).toBeDefined() })
    bundle.dispose()
    expect(observed?.aborted).toBe(true)
    settled.resolve({ status: 'aborted', output: '' })
    await expect(run).resolves.toEqual({ status: 'aborted', output: '' })
  })

  it('is safe to dispose twice', () => {
    const bundle = createHarnessRuntimeBundle(bothProviders().options)
    bundle.dispose()
    expect(() => { bundle.dispose() }).not.toThrow()
  })
})
