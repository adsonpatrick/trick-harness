/**
 * Evidence that Plurora's real policy composes onto a real runtime.
 *
 * The composition package is tested against synthetic policy, which proves the
 * mechanism and nothing about this project: the check that matters to Plurora
 * is that the executors its own routing table names are the executors a
 * deployment actually registers. That check lives here, on the profile side of
 * the one-way boundary, because it is a statement about this project's policy
 * rather than about the composition mechanism.
 */

import { describe, expect, it } from 'vitest'
import {
  BundleCompositionError,
  createHarnessRuntimeBundle,
  routedExecutors,
} from '@trick-harness/composition'
import { dispatchableRoute, type ReasoningEffort } from '@trick-harness/executor'
import type { OpencodeAdapter } from '@trick-harness/provider-opencode'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { pluroraProfile } from '../profile.ts'

/** Product entry points recorded so the test can prove none of them is reached. */
function productSeams() {
  // Plain counters rather than spies: the assertion is that a seam was never
  // reached, which reads the same either way.
  let spawns = 0
  let serverStarts = 0
  let connects = 0
  const spawn = (_spec: SubprocessSpawnSpec): SubprocessHandle => {
    spawns += 1
    throw new Error('loading the Plurora composition must not spawn a Codex process')
  }
  const adapter: OpencodeAdapter = {
    startServer: () => {
      serverStarts += 1
      throw new Error('loading the Plurora composition must not start an OpenCode server')
    },
    connect: () => {
      connects += 1
      throw new Error('loading the Plurora composition must not connect an OpenCode client')
    },
  }
  return { spawn, adapter, reached: (): number => spawns + serverStarts + connects }
}

describe('the Plurora deployment composition', () => {
  it('routes to exactly the two executors this fork ships', () => {
    expect([...routedExecutors(pluroraProfile)].sort()).toEqual(['codex', 'opencode'])
  })

  it('loads with every routed executor registered', () => {
    const seams = productSeams()
    const bundle = createHarnessRuntimeBundle({
      opencode: { adapter: seams.adapter },
      codex: { spawn: seams.spawn },
      profile: pluroraProfile,
    })
    expect(bundle.executors).toEqual(['opencode', 'codex'])
    bundle.dispose()
  })

  it('starts no product process at load', () => {
    const seams = productSeams()
    const bundle = createHarnessRuntimeBundle({
      opencode: { adapter: seams.adapter },
      codex: { spawn: seams.spawn },
      profile: pluroraProfile,
    })
    expect(seams.reached()).toBe(0)
    expect(bundle.runtime.activeRuns()).toBe(0)
    bundle.dispose()
  })

  it('refuses to load when an executor the policy routes to is left out', () => {
    const seams = productSeams()
    expect(() => createHarnessRuntimeBundle({
      codex: { spawn: seams.spawn },
      profile: pluroraProfile,
    })).toThrow(BundleCompositionError)
  })

  it('makes every routing row dispatchable on the executor it names', async () => {
    // Every row must be dispatchable on the executor it names, and the
    // narrowing step is what keeps it so: a stated reasoning effort is advisory,
    // and a product without the knob still serves the route. This is the test
    // that would fail if a resolver ever passed a `use` row to the runtime as
    // written.
    const seams = productSeams()
    const bundle = createHarnessRuntimeBundle({
      opencode: { adapter: seams.adapter },
      codex: { spawn: seams.spawn },
      profile: pluroraProfile,
    })
    const { rules, fallbackRules } = pluroraProfile.routingPolicy
    const dropped: string[] = []
    for (const rule of [...rules, ...fallbackRules]) {
      const executor = String(rule.use['executor'])
      const narrowed = dispatchableRoute(bundle.runtime.get(executor), {
        executor,
        permissionMode: 'workspace-write',
        reasoningEffort: rule.use['effort'] as ReasoningEffort,
      })
      // Dispatched for real. The seams throw, so the run fails — but it fails
      // as `provider-error`, which only happens once the route has already
      // cleared capability validation. An unnarrowed row would instead reject
      // with `ExecutorCapabilityError` before any provider was reached.
      await expect(bundle.runtime.start({
        cwd: '/workspace',
        task: 'do the task',
        route: narrowed.route,
        signal: new AbortController().signal,
      })).resolves.toMatchObject({ status: 'error', failure: { category: 'provider-error' } })
      if (narrowed.dropped.length > 0) dropped.push(rule.id)
    }
    // Nothing is dropped today, and the reason is stated rather than assumed:
    // no OpenCode row claims a reasoning effort, because writing a number down
    // for a knob the product does not have is a claim about a run nobody can
    // check. If a row ever states one, it lands here as a dropped id rather
    // than as a silently unhonoured intent.
    expect(dropped).toEqual([])
    for (const rule of [...rules, ...fallbackRules]) {
      if (rule.use['executor'] === 'opencode') expect(rule.use['effort'], rule.id).toBeUndefined()
    }
    bundle.dispose()
  })

  it('leaves no provider registered after disposal', () => {
    const seams = productSeams()
    const bundle = createHarnessRuntimeBundle({
      opencode: { adapter: seams.adapter },
      codex: { spawn: seams.spawn },
      profile: pluroraProfile,
    })
    bundle.dispose()
    expect(bundle.runtime.list()).toEqual([])
  })
})
