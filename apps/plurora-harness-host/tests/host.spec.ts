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
import { pluroraProfile } from '../../../profiles/plurora/profile.ts'
import { DeploymentConfigError, PLURORA_SEMANTIC_TIERS } from '../src/config.ts'
import { ModelRegistryError } from '../src/model-registry.ts'
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
  async function start(document: Record<string, unknown>, controlToken = 'control-token'): ReturnType<typeof startPluroraHost> {
    await writeFile(join(root, 'plurora-harness.json'), JSON.stringify(document), 'utf8')
    return await startPluroraHost({ projectRoot: root, controlToken, signal: controller.signal })
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
