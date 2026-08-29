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
import {
  ModelRegistryError,
  type ModelCatalogReader,
  assertModelsAvailable,
  buildModelRegistry,
  requestedEfforts,
  routedTiers,
} from '../src/model-registry.ts'

/** What a rejection said, read without assuming the thrown value was an Error. */
function reported(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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
    project: { protectedBranch: 'main' },
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

/** A catalogue reader answering with fixed ids, recording what was asked. */
function readerFor(
  opencode: readonly string[],
  codex: readonly string[],
  efforts: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'],
): { reader: ModelCatalogReader; asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    reader: {
      async opencodeModels() {
        asked.push('opencode')
        return opencode
      },
      async codexModels() {
        asked.push('codex')
        return codex.map(id => ({ id, reasoningEfforts: efforts }))
      },
    },
  }
}

/** Every model id the Plurora deployment below names, by native catalogue. */
const OPENCODE_IDS = PLURORA_SEMANTIC_TIERS
  .filter(tier => tier.startsWith('opencode.'))
  .map(tier => `model-for-${tier}`)
const CODEX_IDS = PLURORA_SEMANTIC_TIERS
  .filter(tier => tier.startsWith('codex.'))
  .map(tier => `model-for-${tier}`)

describe('assertModelsAvailable', () => {
  const registry = buildModelRegistry(deploymentFor(PLURORA_SEMANTIC_TIERS), pluroraProfile)

  it('passes when every routed tier resolves in its own native catalogue', async () => {
    const { reader } = readerFor(OPENCODE_IDS, CODEX_IDS)
    await expect(assertModelsAvailable(registry, pluroraProfile, reader)).resolves.toBeUndefined()
  })

  it('refuses a Codex id the authenticated model/list does not advertise', async () => {
    const { reader } = readerFor(OPENCODE_IDS, [])
    await expect(assertModelsAvailable(registry, pluroraProfile, reader))
      .rejects.toThrow(ModelRegistryError)
  })

  it('refuses an OpenCode pair absent from the authenticated catalogue', async () => {
    const { reader } = readerFor([], CODEX_IDS)
    await expect(assertModelsAvailable(registry, pluroraProfile, reader))
      .rejects.toThrow(/opencode\./)
  })

  it('refuses a blank model id rather than asking a catalogue for nothing', async () => {
    const blank = { ...registry, 'codex.frontier': '   ' }
    const { reader } = readerFor(OPENCODE_IDS, CODEX_IDS)
    await expect(assertModelsAvailable(blank, pluroraProfile, reader))
      .rejects.toThrow(/codex\.frontier/)
  })

  it('names every unavailable tier at once rather than one per boot attempt', async () => {
    const { reader } = readerFor([], [])
    const failure = await assertModelsAvailable(registry, pluroraProfile, reader).catch(reported)
    for (const tier of PLURORA_SEMANTIC_TIERS) expect(failure).toContain(tier)
  })

  it('reads each native catalogue once however many tiers route to it', async () => {
    const { reader, asked } = readerFor(OPENCODE_IDS, CODEX_IDS)
    await assertModelsAvailable(registry, pluroraProfile, reader)
    expect(asked.toSorted()).toEqual(['codex', 'opencode'])
  })

  it('does not reach for a catalogue no routed tier needs', async () => {
    const codexOnly = { 'codex.balanced': 'model-for-codex.balanced' }
    const profile = {
      ...pluroraProfile,
      routingPolicy: {
        rules: [{ id: 'only', when: {}, use: { executor: 'codex', tier: 'codex.balanced' } }],
        fallbackRules: [],
      },
    } as HarnessProfile
    const { reader, asked } = readerFor([], ['model-for-codex.balanced'])
    await assertModelsAvailable(codexOnly, profile, reader)
    expect(asked).toEqual(['codex'])
  })

  it('carries no credential out of a catalogue that could not be read', async () => {
    const secret = 'sk-live-hunter2'
    const reader: ModelCatalogReader = {
      async opencodeModels() { throw new Error(secret) },
      async codexModels() { throw new Error(secret) },
    }
    const raised = await assertModelsAvailable(registry, pluroraProfile, reader).catch((error: unknown) => error)
    expect(raised).toBeInstanceOf(ModelRegistryError)
    const failure = reported(raised)
    expect(failure).not.toContain('hunter2')
  })
})

describe('the reasoning effort a routed tier is asked for', () => {
  const registry = buildModelRegistry(deploymentFor(PLURORA_SEMANTIC_TIERS), pluroraProfile)

  it('reads what the routing table asks each Codex tier for', () => {
    // Off the profile's own table rather than off a list beside it, for the
    // same reason the tiers are: a rule added there is a boot failure here.
    expect(requestedEfforts(pluroraProfile).get('codex.balanced')).toContain('high')
    expect(requestedEfforts(pluroraProfile).get('codex.frontier')).toContain('xhigh')
  })

  it('asks nothing of a tier no rule states an effort for', () => {
    // OpenCode rules state no effort, and inventing one for them would refuse a
    // deployment over a demand this policy never made.
    expect(requestedEfforts(pluroraProfile).get('opencode.workhorse')).toBeUndefined()
  })

  it('passes when the catalogue advertises every effort the table asks for', async () => {
    const { reader } = readerFor(OPENCODE_IDS, CODEX_IDS)
    await expect(assertModelsAvailable(registry, pluroraProfile, reader)).resolves.toBeUndefined()
  })

  it('refuses to boot when a model does not advertise an effort the table asks it for', async () => {
    // Refused rather than quietly served at whatever the model does advertise:
    // a downgrade is this host deciding that a critical stage may reason less
    // than the approved policy says it must, and nothing in the run would say so.
    const { reader } = readerFor(OPENCODE_IDS, CODEX_IDS, ['low', 'medium'])
    const failure = await assertModelsAvailable(registry, pluroraProfile, reader).catch(reported)

    expect(failure).toContain('codex.frontier')
    expect(failure).toContain('codex.balanced')
    expect(failure).toMatch(/effort/)
  })

  it('names the effort that is missing, since that is the next move', async () => {
    const { reader } = readerFor(OPENCODE_IDS, CODEX_IDS, ['low', 'medium', 'high', 'max'])
    const failure = await assertModelsAvailable(registry, pluroraProfile, reader).catch(reported)

    expect(failure).toContain('xhigh')
    expect(failure).not.toContain('codex.balanced')
  })

  it('holds a model to what it advertises, not to what another model advertises', async () => {
    // One catalogue read serves every Codex tier, so an effort validated
    // against the union of the catalogue would pass a model that offers none
    // of it as long as some other model does.
    const reader: ModelCatalogReader = {
      async opencodeModels() { return OPENCODE_IDS },
      async codexModels() {
        return CODEX_IDS.map(id => ({
          id,
          reasoningEfforts: id.endsWith('frontier') ? ['xhigh', 'max'] : ['low'],
        }))
      },
    }
    const failure = await assertModelsAvailable(registry, pluroraProfile, reader).catch(reported)

    expect(failure).toContain('codex.balanced')
    expect(failure).not.toContain('codex.frontier')
  })
})
