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
