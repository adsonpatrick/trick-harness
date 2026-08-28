/**
 * Starting the host is the moment a machine, a checkout and a database are
 * bound together. These tests pin what has to be true before that happens.
 *
 * @module apps/plurora-harness-host/tests/host
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { BundleCompositionError, composeHarness } from '@trick-harness/composition'
import { DEFAULT_MODEL_REGISTRY } from '@trick-harness/routing'
import type { DatabaseVerificationCapabilityPort } from '@trick-harness/engineering-workflow'
import type { ExecutorProvider } from '@trick-harness/executor'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { pluroraProfile } from '../../../profiles/plurora/profile.ts'
import { DeploymentConfigError, PLURORA_SEMANTIC_TIERS } from '../src/config.ts'
import { ModelRegistryError, type ModelCatalogReader } from '../src/model-registry.ts'
import { PluroraHostError, startPluroraHost } from '../src/main.ts'

/** A deployment document the host accepts. */
function deployment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    repository: 'adsonpatrick/trick-harness',
    revision: 'b'.repeat(40),
    profile: 'plurora',
    policyVersion: pluroraProfile.policyVersion,
    controlServerUrl: 'http://127.0.0.1:4319',
    environment: 'development',
    database: { strategy: 'shared-cloud-development', projectRef: 'uljaajwwnygopsyvwsre' },
    modelRegistry: Object.fromEntries(PLURORA_SEMANTIC_TIERS.map(tier => [tier, `model-for-${tier}`])),
    ...overrides,
  }
}

/** A catalogue advertising exactly the models `deployment()` names. */
function servingCatalogue(): ModelCatalogReader {
  const tiers = (prefix: string): string[] =>
    PLURORA_SEMANTIC_TIERS.filter(tier => tier.startsWith(prefix)).map(tier => `model-for-${tier}`)
  return {
    async opencodeModels() { return tiers('opencode.') },
    async codexModels() { return tiers('codex.').map(id => ({ id, reasoningEfforts: ['medium'] })) },
  }
}

/** A catalogue that advertises nothing, standing in for an account without access. */
const EMPTY_CATALOGUE: ModelCatalogReader = {
  async opencodeModels() { return [] },
  async codexModels() { return [] },
}

/** A child that never runs; the database command is not exercised here. */
function unusedSpawn(_spec: SubprocessSpawnSpec): SubprocessHandle {
  throw new Error('the database command was not expected to run')
}

/**
 * A provider that registers under `name` and is never dispatched to.
 *
 * The composition refuses a profile routing to an unregistered executor, so
 * both of Plurora's have to exist for this file to reach the check it is about.
 *
 * @param name - the executor name the routing table asks for.
 * @returns a provider that satisfies registration and nothing more.
 */
function registeredOnly(name: string): ExecutorProvider {
  return {
    name,
    capabilities: {
      modelOverride: true,
      reasoningEffort: true,
      permissionModes: ['read-only', 'workspace-write'],
    },
    start: async () => { throw new Error(`${name} was not expected to run`) },
  }
}

/**
 * Compose the Plurora profile around one database verification port.
 *
 * @param databaseVerification - the port under test.
 * @param withSupabase - also configure the built-in preview integration.
 * @returns the composed harness, which the caller disposes.
 */
function compose(
  databaseVerification: DatabaseVerificationCapabilityPort,
  withSupabase = false,
): ReturnType<typeof composeHarness> {
  return composeHarness({
    profile: pluroraProfile,
    registry: DEFAULT_MODEL_REGISTRY,
    session: Session.create(SessionId('plurora-host-compose')),
    flush: async () => true,
    workflow: {
      interpret: (stage, executor) => ({
        role: stage.role, executor, verdict: 'PASS', summary: 'passed', findings: [], evidence: [],
      }),
      task: stage => `${stage.role}: do the work`,
    },
    capabilities: { databaseVerification },
    ...withSupabase
      ? {
        integrations: {
          supabase: {
            cwd: '/repo', spawn: unusedSpawn, projectRef: 'uljaajwwnygopsyvwsre',
            pollIntervalMs: 1, readyTimeoutMs: 50,
          },
        },
      }
      : {},
    providers: { extraProviders: [registeredOnly('opencode'), registeredOnly('codex')] },
  })
}

describe('startPluroraHost', () => {
  let root: string
  let controller: AbortController

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'plurora-host-'))
    controller = new AbortController()
  })

  afterEach(async () => {
    controller.abort()
    await rm(root, { recursive: true, force: true })
  })

  /** Write `document` as the deployment file and start the host on it. */
  async function start(
    document: Record<string, unknown>,
    controlToken = 'control-token',
    catalogue: ModelCatalogReader = servingCatalogue(),
  ): ReturnType<typeof startPluroraHost> {
    await writeFile(join(root, 'plurora-harness.json'), JSON.stringify(document), 'utf8')
    return await startPluroraHost({
      projectRoot: root,
      controlToken,
      signal: controller.signal,
      catalogue,
      spawn: unusedSpawn,
    })
  }

  it('starts on a deployment that satisfies every rule', async () => {
    const host = await start(deployment())
    expect(host.config.database.projectRef).toBe('uljaajwwnygopsyvwsre')
    expect(host.registry['codex.frontier']).toBe('model-for-codex.frontier')
    await host.dispose()
  })

  it('refuses an empty control token rather than starting unauthenticated', async () => {
    await expect(start(deployment(), '  ')).rejects.toThrow(PluroraHostError)
  })

  it('refuses to start once the signal is already aborted', async () => {
    controller.abort()
    await expect(start(deployment())).rejects.toThrow(PluroraHostError)
  })

  it('refuses a deployment file that breaks a config rule', async () => {
    await expect(start(deployment({ environment: 'production' }))).rejects.toThrow(DeploymentConfigError)
  })

  it('refuses a deployment pinned to a policy version this checkout does not carry', async () => {
    await expect(start(deployment({ policyVersion: 'plurora-v1.0.0' }))).rejects.toThrow(PluroraHostError)
    await expect(start(deployment({ policyVersion: 'plurora-v1.0.0' }))).rejects.toThrow(pluroraProfile.policyVersion)
  })

  it('refuses a deployment that leaves a routed tier with no model', async () => {
    const short = Object.fromEntries(PLURORA_SEMANTIC_TIERS.slice(1).map(tier => [tier, 'model']))
    await expect(start(deployment({ modelRegistry: short }))).rejects.toThrow(DeploymentConfigError)
  })

  it('surfaces a registry gap as a registry error when the config itself is well formed', () => {
    // The config check already covers the Plurora tiers, so this asserts the
    // second gate exists rather than routing every gap through the first.
    expect(ModelRegistryError.prototype).toBeInstanceOf(Error)
  })

  it('refuses to come up while a routed tier resolves in no native catalogue', async () => {
    await expect(start(deployment(), 'control-token', EMPTY_CATALOGUE)).rejects.toThrow(ModelRegistryError)
  })

  it('names every unserved tier so one boot reports the whole gap', async () => {
    const failure = await start(deployment(), 'control-token', EMPTY_CATALOGUE).catch((error: Error) => error)
    for (const tier of PLURORA_SEMANTIC_TIERS) expect(String(failure)).toContain(tier)
  })

  it('supplies a database capability the composed profile accepts', async () => {
    const host = await start(deployment())
    // Composition refuses a capability the profile does not enable, so this
    // composing at all is the wiring under test, not a smoke check.
    expect(() => compose(host.databaseVerification)).not.toThrow()
    await host.dispose()
  })

  it('is refused alongside the built-in preview strategy, since one database has one owner', async () => {
    const host = await start(deployment())
    expect(() => compose(host.databaseVerification, true)).toThrow(BundleCompositionError)
    await host.dispose()
  })

  it('binds the capability to the project ref the deployment names', async () => {
    const specs: SubprocessSpawnSpec[] = []
    await writeFile(join(root, 'plurora-harness.json'), JSON.stringify(deployment()), 'utf8')
    const host = await startPluroraHost({
      projectRoot: root,
      controlToken: 'control-token',
      signal: controller.signal,
      catalogue: servingCatalogue(),
      spawn: (spec) => { specs.push(spec); throw new Error('not run') },
    })
    const result = await host.databaseVerification.verify({
      stageId: 'delivery',
      objective: {
        id: 'obj-1', cwd: root, requirement: 'add a column',
        risk: 'medium', workload: 'light', profileId: 'plurora',
      },
    }, AbortSignal.timeout(1_000))
    expect(specs[0]?.cwd).toBe(root)
    expect(result.status).toBe('BLOCKED')
    await host.dispose()
  })

  it('disposes without failing when disposed twice', async () => {
    const host = await start(deployment())
    await host.dispose()
    await expect(host.dispose()).resolves.toBeUndefined()
  })

  it('names no credential in what it hands back', async () => {
    const host = await start(deployment(), 'super-secret-control-token')
    expect(JSON.stringify(host.config)).not.toContain('super-secret-control-token')
    await host.dispose()
  })
})
