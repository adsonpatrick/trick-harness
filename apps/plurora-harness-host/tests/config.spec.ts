/**
 * The deployment config is the only thing standing between a hand-edited JSON
 * file and a harness that talks to a real cloud database with real product
 * credentials. These tests hold it to that job.
 *
 * @module apps/plurora-harness-host/tests/config
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DeploymentConfigError,
  PLURORA_SEMANTIC_TIERS,
  loadDeploymentConfig,
  parseDeploymentConfig,
} from '../src/config.ts'

/** A config that passes every rule, so each test can break exactly one thing. */
function validConfig(): Record<string, unknown> {
  return {
    repository: 'adsonpatrick/trick-harness',
    revision: 'a'.repeat(40),
    profile: 'plurora',
    policyVersion: 'plurora-v2.0.0',
    controlServerUrl: 'http://127.0.0.1:4319',
    environment: 'development',
    database: { strategy: 'shared-cloud-development', projectRef: 'uljaajwwnygopsyvwsre' },
    modelRegistry: Object.fromEntries(PLURORA_SEMANTIC_TIERS.map(tier => [tier, `model-for-${tier}`])),
  }
}

/** Assert that parsing `raw` fails, and that the message names `expected`. */
function refuses(raw: unknown, expected: string): void {
  expect(() => parseDeploymentConfig(raw)).toThrow(DeploymentConfigError)
  expect(() => parseDeploymentConfig(raw)).toThrow(expected)
}

describe('parseDeploymentConfig', () => {
  it('accepts a config that satisfies every rule', () => {
    const config = parseDeploymentConfig(validConfig())
    expect(config.repository).toBe('adsonpatrick/trick-harness')
    expect(config.profile).toBe('plurora')
    expect(config.environment).toBe('development')
    expect(config.database.strategy).toBe('shared-cloud-development')
    expect(config.database.projectRef).toBe('uljaajwwnygopsyvwsre')
    expect(Object.keys(config.modelRegistry).toSorted()).toEqual([...PLURORA_SEMANTIC_TIERS].toSorted())
  })

  it('refuses a document that is not an object', () => {
    refuses('plurora', 'a JSON object')
    refuses(null, 'a JSON object')
    refuses([], 'a JSON object')
  })

  it('refuses another repository', () => {
    refuses({ ...validConfig(), repository: 'someone-else/trick-harness' }, 'repository')
  })

  it('refuses another profile', () => {
    refuses({ ...validConfig(), profile: 'neurovia' }, 'profile')
  })

  it('refuses a revision that is not an exact 40-hex commit', () => {
    for (const revision of ['main', 'A'.repeat(40), 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40)]) {
      refuses({ ...validConfig(), revision }, 'revision')
    }
  })

  it('refuses a control server URL that is not loopback', () => {
    refuses({ ...validConfig(), controlServerUrl: 'http://10.0.0.4:4319' }, 'loopback')
    refuses({ ...validConfig(), controlServerUrl: 'https://control.plurora.dev' }, 'loopback')
    refuses({ ...validConfig(), controlServerUrl: 'not a url' }, 'controlServerUrl')
  })

  it('accepts every spelling of loopback', () => {
    for (const url of ['http://127.0.0.1:4319', 'http://localhost:4319', 'http://[::1]:4319']) {
      expect(parseDeploymentConfig({ ...validConfig(), controlServerUrl: url }).controlServerUrl).toBe(url)
    }
  })

  it('refuses an environment other than development', () => {
    refuses({ ...validConfig(), environment: 'production' }, 'environment')
    refuses({ ...validConfig(), environment: 'staging' }, 'environment')
  })

  it('refuses a database strategy other than shared cloud development', () => {
    refuses({ ...validConfig(), database: { strategy: 'preview-branch', projectRef: 'x' } }, 'strategy')
  })

  it('refuses an empty project ref', () => {
    refuses({ ...validConfig(), database: { strategy: 'shared-cloud-development', projectRef: '' } }, 'projectRef')
    refuses({ ...validConfig(), database: { strategy: 'shared-cloud-development', projectRef: '   ' } }, 'projectRef')
  })

  it('refuses a model registry that does not cover exactly the tiers the profile routes to', () => {
    const short = Object.fromEntries(PLURORA_SEMANTIC_TIERS.slice(1).map(tier => [tier, 'model']))
    refuses({ ...validConfig(), modelRegistry: short }, PLURORA_SEMANTIC_TIERS[0])

    const extra = { ...validConfig().modelRegistry as object, 'codex.experimental': 'model' }
    refuses({ ...validConfig(), modelRegistry: extra }, 'codex.experimental')
  })

  it('refuses a model registry entry with no model behind it', () => {
    const blank = Object.fromEntries(PLURORA_SEMANTIC_TIERS.map(tier => [tier, '']))
    refuses({ ...validConfig(), modelRegistry: blank }, 'modelRegistry')
  })

  it('refuses routing rules, permission modes and any other key it does not know', () => {
    refuses({ ...validConfig(), routingPolicy: { rules: [] } }, 'routingPolicy')
    refuses({ ...validConfig(), permissionMode: 'bypass' }, 'permissionMode')
    refuses({ ...validConfig(), providers: {} }, 'providers')
  })

  it('refuses a credential-shaped key at any depth', () => {
    const keys = [
      'token',
      'controlToken',
      'secret',
      'clientSecret',
      'password',
      'apiKey',
      'api_key',
      'api-key',
      'connectionString',
      'dbUrl',
    ]
    for (const key of keys) {
      refuses({ ...validConfig(), [key]: 'x' }, key)
      refuses(
        { ...validConfig(), database: { strategy: 'shared-cloud-development', projectRef: 'r', [key]: 'x' } },
        key,
      )
      refuses(
        {
          ...validConfig(),
          database: { strategy: 'shared-cloud-development', projectRef: 'r', nested: { deeper: [{ [key]: 'x' }] } },
        },
        key,
      )
    }
  })

  it('names the credential rule rather than the schema when both would fire', () => {
    expect(() => parseDeploymentConfig({ token: 'x' })).toThrow(/credential/i)
  })
})

describe('loadDeploymentConfig', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'plurora-host-config-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads plurora-harness.json from the project root', async () => {
    await writeFile(join(root, 'plurora-harness.json'), JSON.stringify(validConfig()), 'utf8')
    const config = await loadDeploymentConfig(root)
    expect(config.policyVersion).toBe('plurora-v2.0.0')
  })

  it('says which file is missing rather than failing as a bare ENOENT', async () => {
    await expect(loadDeploymentConfig(root)).rejects.toThrow(/plurora-harness\.json/)
  })

  it('says the file is not JSON rather than surfacing a parser message alone', async () => {
    await writeFile(join(root, 'plurora-harness.json'), '{ not json', 'utf8')
    await expect(loadDeploymentConfig(root)).rejects.toThrow(/plurora-harness\.json/)
  })

  it('applies every parse rule to the file it read', async () => {
    const raw = JSON.stringify({ ...validConfig(), environment: 'production' })
    await writeFile(join(root, 'plurora-harness.json'), raw, 'utf8')
    await expect(loadDeploymentConfig(root)).rejects.toThrow(DeploymentConfigError)
  })
})
