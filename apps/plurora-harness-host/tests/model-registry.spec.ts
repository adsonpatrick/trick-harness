/**
 * The registry has to serve the profile's own routing table, not a list kept
 * beside it. These tests hold it to the table.
 *
 * @module apps/plurora-harness-host/tests/model-registry
 */

import type { HarnessProfile } from '@trick-harness/profile'
import { describe, expect, it } from 'vitest'
import { pluroraProfile } from '../../../profiles/plurora/profile.ts'
import { PLURORA_SEMANTIC_TIERS, type PluroraDeploymentConfig } from '../src/config.ts'
import { ModelRegistryError, buildModelRegistry, routedTiers } from '../src/model-registry.ts'

/** A deployment naming a model for every tier in `tiers`. */
function deploymentFor(tiers: readonly string[]): PluroraDeploymentConfig {
  return {
    repository: 'adsonpatrick/trick-harness',
    revision: 'a'.repeat(40),
    profile: 'plurora',
    policyVersion: pluroraProfile.policyVersion,
    controlServerUrl: 'http://127.0.0.1:4319',
    environment: 'development',
    database: { strategy: 'shared-cloud-development', projectRef: 'ref' },
    modelRegistry: Object.fromEntries(tiers.map(tier => [tier, `model-for-${tier}`])),
  }
}

describe('routedTiers', () => {
  it('reads the tiers out of the profile rather than out of a list beside it', () => {
    expect(routedTiers(pluroraProfile).toSorted()).toEqual([...PLURORA_SEMANTIC_TIERS].toSorted())
  })

  it('counts the fallback table too, since an outage is when a gap would bite', () => {
    const profile = {
      ...pluroraProfile,
      routingPolicy: {
        rules: [{ id: 'only', when: {}, use: { executor: 'codex', tier: 'codex.balanced' } }],
        fallbackRules: [{ id: 'out', when: { unavailable: 'codex' }, use: { executor: 'opencode', tier: 'opencode.workhorse' } }],
      },
    } as HarnessProfile

    expect(routedTiers(profile)).toEqual(['codex.balanced', 'opencode.workhorse'])
  })

  it('names each tier once however many rules route to it', () => {
    expect(new Set(routedTiers(pluroraProfile)).size).toBe(routedTiers(pluroraProfile).length)
  })
})

describe('buildModelRegistry', () => {
  it('resolves every tier the Plurora policy routes to', () => {
    const registry = buildModelRegistry(deploymentFor(PLURORA_SEMANTIC_TIERS), pluroraProfile)
    for (const tier of routedTiers(pluroraProfile)) {
      expect(registry[tier]).toBe(`model-for-${tier}`)
    }
  })

  it('refuses a deployment that leaves a routed tier undispatchable', () => {
    const short = deploymentFor(PLURORA_SEMANTIC_TIERS.slice(1))
    expect(() => buildModelRegistry(short, pluroraProfile)).toThrow(ModelRegistryError)
    expect(() => buildModelRegistry(short, pluroraProfile)).toThrow(PLURORA_SEMANTIC_TIERS[0])
  })

  it('names every missing tier at once rather than one per boot attempt', () => {
    const bare = deploymentFor([])
    for (const tier of PLURORA_SEMANTIC_TIERS) {
      expect(() => buildModelRegistry(bare, pluroraProfile)).toThrow(tier)
    }
  })

  it('hands back a registry the caller cannot mutate', () => {
    const registry = buildModelRegistry(deploymentFor(PLURORA_SEMANTIC_TIERS), pluroraProfile)
    expect(Object.isFrozen(registry)).toBe(true)
  })
})
