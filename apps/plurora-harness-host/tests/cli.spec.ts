/**
 * The stable deployment CLI surface: `validate` and `serve` subcommands with an
 * absolute `--ready-file`, published atomically and only after the control
 * server is listening.
 *
 * The executable boundary lives in `bin.ts`/`entrypoint.ts`, so these specs
 * drive those modules through the same fake seams the executable specs use.
 *
 * @module apps/plurora-harness-host/tests/cli
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runProcess } from '../src/bin.ts'
import { createProductionRuntime, parsePluroraHostArgs, runPluroraHost, type PluroraHostRuntime } from '../src/entrypoint.ts'
import type { PluroraHost, PluroraHostOptions } from '../src/main.ts'
import type { ModelCatalogReader } from '../src/model-registry.ts'
import { PLURORA_SEMANTIC_TIERS } from '../src/config.ts'
import { pluroraProfile } from '../../../profiles/plurora/profile.ts'

/** A deployment document the host accepts, mirroring the host spec fixture. */
function deployment(): Record<string, unknown> {
  return {
    repository: 'adsonpatrick/trick-harness',
    revision: 'b'.repeat(40),
    profile: 'plurora',
    policyVersion: pluroraProfile.policyVersion,
    controlServerUrl: 'http://127.0.0.1:0',
    environment: 'development',
    database: { strategy: 'shared-cloud-development', projectRef: 'uljaajwwnygopsyvwsre' },
    project: { protectedBranch: 'main' },
    projectRepository: 'adsonpatrick/neuro-via',
    modelRegistry: Object.fromEntries(PLURORA_SEMANTIC_TIERS.map(tier => [tier, `model-for-${tier}`])),
  }
}

/** A catalogue advertising exactly the models `deployment()` names. */
function servingCatalogue(): ModelCatalogReader {
  const tiers = (prefix: string): string[] =>
    PLURORA_SEMANTIC_TIERS.filter(tier => tier.startsWith(prefix)).map(tier => `model-for-${tier}`)
  return {
    async opencodeModels() { return tiers('opencode.') },
    async codexModels() { return tiers('codex.').map(id => ({ id, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] })) },
  }
}

/** A catalogue that advertises nothing, standing in for an account without access. */
const EMPTY_CATALOGUE: ModelCatalogReader = {
  async opencodeModels() { return [] },
  async codexModels() { return [] },
}

/** A runtime fake that records construction, teardown, and safe output. */
function fakeRuntime(
  environment: Record<string, string | undefined> = { PLURORA_HARNESS_TOKEN: 'control-token' },
) {
  let terminate: (() => void) | undefined
  const disposal: string[] = []
  const lines: string[] = []
  const managedSpawn = vi.fn()
  const host: PluroraHost = {
    config: {} as PluroraHost['config'],
    registry: {},
    databaseVerification: {} as PluroraHost['databaseVerification'],
    changeSet: {} as PluroraHost['changeSet'],
    harness: {} as PluroraHost['harness'],
    control: { host: '127.0.0.1', port: 43123 },
    session: {} as PluroraHost['session'],
    flush: async () => true,
    dispose: vi.fn(async () => { disposal.push('host') }),
  }
  const createCatalogue = vi.fn<PluroraHostRuntime['createCatalogue']>(() => servingCatalogue())
  const createOpencode = vi.fn(() => ({
    startServer: async () => { throw new Error('not reached') },
    connect: () => { throw new Error('not reached') },
  }))
  const start = vi.fn(async () => host)
  const writeReadyFile = vi.fn(async (path: string, envelope: string) => {
    await writeFile(path, envelope, 'utf8')
  })
  const runtime: PluroraHostRuntime = {
    cwd: '/repo',
    env: environment,
    writeOut: (line) => { lines.push(`out:${line}`) },
    writeError: (line) => { lines.push(`error:${line}`) },
    subscribeTermination: (listener) => {
      terminate = listener
      return () => { terminate = undefined }
    },
    createSubprocess: vi.fn(async () => ({
      spawn: managedSpawn as PluroraHostOptions['spawn'],
      dispose: async () => { disposal.push('subprocess') },
    })),
    createCatalogue,
    createOpencode,
    start,
    writeReadyFile,
  }
  return {
    runtime,
    lines,
    disposal,
    managedSpawn,
    createCatalogue,
    createOpencode,
    start,
    writeReadyFile,
    stop() { terminate?.() },
  }
}

describe('parsePluroraHostArgs — stable deployment surface', () => {
  const projectRoot = join(tmpdir(), 'plurora-cli-root')
  const readyFile = join(tmpdir(), 'plurora-cli-ready.json')

  it('parses validate with an explicit project root', () => {
    expect(parsePluroraHostArgs(['validate', '--project-root', projectRoot], '/repo')).toStrictEqual({
      command: 'validate', help: false, projectRoot: resolve(projectRoot),
    })
  })

  it('parses serve with an absolute ready file and an optional session id', () => {
    expect(parsePluroraHostArgs(
      ['serve', '--project-root', projectRoot, '--ready-file', readyFile, '--session-id', 'replay-1'],
      '/repo',
    )).toStrictEqual({
      command: 'serve', help: false, projectRoot: resolve(projectRoot),
      readyFile: resolve(readyFile), sessionId: 'replay-1',
    })
  })

  it('refuses serve without an absolute ready file', () => {
    expect(() => parsePluroraHostArgs(['serve', '--project-root', projectRoot, '--ready-file', 'ready.json'], '/repo'))
      .toThrow(/ready-file.*absolute/i)
    expect(() => parsePluroraHostArgs(['serve', '--project-root', projectRoot], '/repo')).toThrow(/ready-file/i)
  })

  it('refuses validate options it does not take and unknown subcommands', () => {
    expect(() => parsePluroraHostArgs(['validate', '--ready-file', readyFile], '/repo')).toThrow(/plurora-host:/)
    expect(() => parsePluroraHostArgs(['validate', '--session-id', 'x'], '/repo')).toThrow(/plurora-host:/)
    expect(() => parsePluroraHostArgs(['deploy', '--project-root', projectRoot], '/repo')).toThrow(/unknown argument/)
  })
})

describe('runPluroraHost — validate', () => {
  let projectRoot: string
  beforeEach(async () => { projectRoot = await mkdtemp(join(tmpdir(), 'plurora-cli-root-')) })
  afterEach(async () => { await rm(projectRoot, { recursive: true, force: true }) })

  it('validates config and catalogues without opening a session, binding a port or requiring the control token', async () => {
    await writeFile(join(projectRoot, 'plurora-harness.json'), JSON.stringify(deployment()), 'utf8')
    const fake = fakeRuntime({})

    const result = await runPluroraHost(
      parsePluroraHostArgs(['validate', '--project-root', projectRoot], '/repo'),
      fake.runtime,
    )

    expect(result).toBe(0)
    expect(fake.start).not.toHaveBeenCalled()
    expect(fake.createOpencode).not.toHaveBeenCalled()
    expect(fake.createCatalogue).toHaveBeenCalledWith(expect.objectContaining({ projectRoot: resolve(projectRoot) }))
    expect(fake.disposal).toEqual(['subprocess'])
    expect(fake.lines).toEqual(['out:plurora-host: deployment is valid'])
  })

  it('reports a failed catalogue read without opening a session or binding a port', async () => {
    await writeFile(join(projectRoot, 'plurora-harness.json'), JSON.stringify(deployment()), 'utf8')
    const fake = fakeRuntime({})
    fake.createCatalogue.mockReturnValueOnce(EMPTY_CATALOGUE)

    const result = await runPluroraHost(
      parsePluroraHostArgs(['validate', '--project-root', projectRoot], '/repo'),
      fake.runtime,
    )

    expect(result).toBe(1)
    expect(fake.start).not.toHaveBeenCalled()
    expect(fake.disposal).toEqual(['subprocess'])
    expect(fake.lines.join('\n')).toMatch(/plurora-host:/)
  })
})

describe('runPluroraHost — serve', () => {
  let projectRoot: string
  let readyFile: string
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'plurora-cli-root-'))
    readyFile = join(projectRoot, 'ready.json')
  })
  afterEach(async () => { await rm(projectRoot, { recursive: true, force: true }) })

  it('writes the bounded envelope only after the control server is listening', async () => {
    const fake = fakeRuntime({ PLURORA_HARNESS_TOKEN: 'control-token' })
    const running = runPluroraHost(
      parsePluroraHostArgs(['serve', '--project-root', projectRoot, '--ready-file', readyFile], '/repo'),
      fake.runtime,
    )
    await vi.waitFor(() => { expect(fake.start).toHaveBeenCalledTimes(1) })
    fake.stop()

    await expect(running).resolves.toBe(0)
    expect(fake.writeReadyFile).toHaveBeenCalledWith(
      readyFile,
      '{"schemaVersion":1,"status":"READY","controlUrl":"http://127.0.0.1:43123"}\n',
    )
    expect(JSON.parse(await readFile(readyFile, 'utf8'))).toEqual({
      schemaVersion: 1,
      status: 'READY',
      controlUrl: 'http://127.0.0.1:43123',
    })
    expect(fake.disposal).toEqual(['host', 'subprocess'])
  })

  it('never publishes a ready envelope when the host fails to start', async () => {
    const fake = fakeRuntime({ PLURORA_HARNESS_TOKEN: 'control-token' })
    fake.start.mockRejectedValueOnce(new Error('catalogue unavailable'))

    const result = await runPluroraHost(
      parsePluroraHostArgs(['serve', '--project-root', projectRoot, '--ready-file', readyFile], '/repo'),
      fake.runtime,
    )

    expect(result).toBe(1)
    expect(fake.writeReadyFile).not.toHaveBeenCalled()
    await expect(readFile(readyFile, 'utf8')).rejects.toThrow()
    expect(fake.disposal).toEqual(['subprocess'])
  })

  it('refuses serve without the control token before starting or publishing anything', async () => {
    const fake = fakeRuntime({})

    const result = await runPluroraHost(
      parsePluroraHostArgs(['serve', '--project-root', projectRoot, '--ready-file', readyFile], '/repo'),
      fake.runtime,
    )

    expect(result).toBe(1)
    expect(fake.start).not.toHaveBeenCalled()
    expect(fake.writeReadyFile).not.toHaveBeenCalled()
    expect(fake.lines).toEqual(['error:plurora-host: PLURORA_HARNESS_TOKEN is required'])
  })
})

describe('production ready-file publish', () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'plurora-cli-ready-')) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('writes the envelope through a temporary sibling and leaves only the final file', async () => {
    const readyFile = join(root, 'ready.json')
    const envelope = '{"schemaVersion":1,"status":"READY","controlUrl":"http://127.0.0.1:43123"}\n'
    const runtime = createProductionRuntime({
      cwd: root,
      env: {},
      writeOut: () => {},
      writeError: () => {},
      subscribeTermination: () => () => {},
    })

    await runtime.writeReadyFile(readyFile, envelope)

    expect(await readFile(readyFile, 'utf8')).toBe(envelope)
    expect(await readdir(root)).toEqual(['ready.json'])
  })
})

describe('runProcess — serve subcommand wiring', () => {
  let projectRoot: string
  let readyFile: string
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'plurora-cli-root-'))
    readyFile = join(projectRoot, 'ready.json')
  })
  afterEach(async () => { await rm(projectRoot, { recursive: true, force: true }) })

  it('maps serve through the Node process adapter and publishes the envelope', async () => {
    const stdout: string[] = []
    const stderr: string[] = []
    const fake = fakeRuntime({ PLURORA_HARNESS_TOKEN: 'control-token' })
    const processLike = {
      argv: ['node', 'bin.ts', 'serve', '--project-root', projectRoot, '--ready-file', readyFile],
      cwd: () => '/repo',
      env: {},
      stdout: { write: (line: string) => { stdout.push(line) } },
      stderr: { write: (line: string) => { stderr.push(line) } },
      on: () => {},
      off: () => {},
      exitCode: undefined as number | undefined,
    }

    const running = runProcess(processLike, fake.runtime)
    await vi.waitFor(() => { expect(fake.start).toHaveBeenCalledTimes(1) })
    fake.stop()

    await expect(running).resolves.toBe(0)
    expect(processLike.exitCode).toBe(0)
    expect((JSON.parse(await readFile(readyFile, 'utf8')) as { status: string }).status).toBe('READY')
    expect(fake.lines.join('\n')).toContain('plurora-host: listening on http://127.0.0.1:43123')
    expect(stderr).toEqual([])
  })
})
