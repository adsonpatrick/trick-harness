/**
 * The executable boundary must reject unsafe invocation input before it opens a
 * durable session, a provider transport, or a managed process tree.
 *
 * @module apps/plurora-harness-host/tests/entrypoint
 */

import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import type { PluroraHost, PluroraHostOptions } from '../src/main.ts'
import { runProcess } from '../src/bin.ts'
import { parsePluroraHostArgs, runPluroraHost, type PluroraHostRuntime } from '../src/entrypoint.ts'

/** A valid default invocation for a fake NeuroVia checkout. */
function invocation() {
  return parsePluroraHostArgs([], '/repo')
}

/** A runtime fake that records construction, teardown, and safe output. */
function fakeRuntime(environment: Record<string, string | undefined> = { PLURORA_HARNESS_TOKEN: 'control-token' }) {
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
    control: { host: '127.0.0.1', port: 47831 },
    session: {} as PluroraHost['session'],
    flush: async () => true,
    dispose: vi.fn(async () => { disposal.push('host') }),
  }
  const createCatalogue = vi.fn(() => ({
    opencodeModels: async () => [],
    codexModels: async () => [],
  }))
  const start = vi.fn(async () => host)
  const runtime: PluroraHostRuntime = {
    cwd: '/repo',
    env: environment,
    writeOut: (line) => { lines.push(`out:${line}`) },
    writeError: (line) => { lines.push(`error:${line}`) },
    subscribeTermination: (listener) => {
      terminate = listener
      return () => { terminate = undefined }
    },
    createSubprocess: async () => ({
      spawn: managedSpawn as PluroraHostOptions['spawn'],
      dispose: async () => { disposal.push('subprocess') },
    }),
    createCatalogue,
    createOpencode: vi.fn(() => ({
      startServer: async () => { throw new Error('not reached') },
      connect: () => { throw new Error('not reached') },
    })),
    start,
    writeReadyFile: vi.fn(async () => {}),
  }
  return {
    runtime,
    environment,
    lines,
    disposal,
    managedSpawn,
    createCatalogue,
    start,
    stop() { terminate?.() },
  }
}

describe('parsePluroraHostArgs', () => {
  it('uses cwd and accepts an explicit session id', () => {
    expect(parsePluroraHostArgs(['--session-id', 'replay-1'], '/repo')).toStrictEqual({
      help: false, projectRoot: resolve('/repo'), sessionId: 'replay-1',
    })
  })

  it('accepts an absolute project root', () => {
    expect(parsePluroraHostArgs(['--project-root', '/other/repo'], '/repo')).toStrictEqual({
      help: false, projectRoot: resolve('/other/repo'),
    })
  })

  it('accepts pnpm’s leading argument separator', () => {
    expect(parsePluroraHostArgs(['--', '--help'], '/repo')).toStrictEqual({
      help: true, projectRoot: resolve('/repo'),
    })
  })

  it.each([
    [['--project-root', 'relative']],
    [['--project-root']],
    [['--session-id', '']],
    [['--session-id', 'one', '--session-id', 'two']],
    [['--token', 'secret']],
    [['--help', '--session-id', 'replay-1']],
  ])('refuses malformed operator input: %j', (argv) => {
    expect(() => parsePluroraHostArgs(argv, '/repo')).toThrow(/plurora-host:/)
  })
})

describe('runPluroraHost', () => {
  it('prints help without reading a token or constructing a runtime', async () => {
    const fake = fakeRuntime({})
    const result = await runPluroraHost(parsePluroraHostArgs(['--help'], '/repo'), fake.runtime)

    expect(result).toBe(0)
    expect(fake.start).not.toHaveBeenCalled()
    expect(fake.lines).toEqual([
      'out:Usage: plurora-host <validate|serve> --project-root <absolute-path> [--ready-file <absolute-path>]'
      + '\n       plurora-host [--project-root <absolute-path>] [--session-id <id>]',
    ])
  })

  it('does not construct a runtime when the inherited token is blank', async () => {
    const fake = fakeRuntime({ PLURORA_HARNESS_TOKEN: '  ' })

    await expect(runPluroraHost(invocation(), fake.runtime)).resolves.toBe(1)
    expect(fake.start).not.toHaveBeenCalled()
    expect(fake.createCatalogue).not.toHaveBeenCalled()
    expect(fake.lines).toEqual(['error:plurora-host: PLURORA_HARNESS_TOKEN is required'])
  })

  it('passes the unmodified environment and managed spawn to the host', async () => {
    const fake = fakeRuntime({ PLURORA_HARNESS_TOKEN: 'redacted', PATH: '/native/path' })
    const running = runPluroraHost(invocation(), fake.runtime)
    await vi.waitFor(() => { expect(fake.start).toHaveBeenCalledTimes(1) })
    fake.stop()

    await expect(running).resolves.toBe(0)
    expect(fake.start).toHaveBeenCalledWith(expect.objectContaining({
      projectRoot: resolve('/repo'), controlToken: 'redacted', spawn: fake.managedSpawn,
    }))
    expect(fake.createCatalogue).toHaveBeenCalledWith(expect.objectContaining({ env: fake.environment }))
    expect(fake.lines.join('\n')).not.toContain('redacted')
    expect(fake.disposal).toEqual(['host', 'subprocess'])
  })

  it('disposes acquired resources and emits only a safe failure when startup fails', async () => {
    const fake = fakeRuntime({ PLURORA_HARNESS_TOKEN: 'redacted' })
    fake.start.mockRejectedValueOnce(new Error('catalogue unavailable'))

    await expect(runPluroraHost(invocation(), fake.runtime)).resolves.toBe(1)
    expect(fake.disposal).toEqual(['subprocess'])
    expect(fake.lines).toEqual(['error:plurora-host: Error: catalogue unavailable'])
    expect(fake.lines.join('\n')).not.toContain('redacted')
  })
})

describe('runProcess', () => {
  it('maps Node process input without force-exiting during teardown', async () => {
    const stdout: string[] = []
    const stderr: string[] = []
    const listeners = new Map<string, () => void>()
    const processLike = {
      argv: ['node', 'bin.ts', '--help'],
      cwd: () => '/repo',
      env: {},
      stdout: { write: (line: string) => { stdout.push(line) } },
      stderr: { write: (line: string) => { stderr.push(line) } },
      on: (event: string, listener: () => void) => { listeners.set(event, listener) },
      off: (event: string, listener: () => void) => {
        if (listeners.get(event) === listener) listeners.delete(event)
      },
      exitCode: undefined as number | undefined,
    }

    await expect(runProcess(processLike)).resolves.toBe(0)
    expect(processLike.exitCode).toBe(0)
    expect(stdout.join('')).toContain('Usage: plurora-host')
    expect(stderr).toEqual([])
    expect(listeners).toEqual(new Map())
  })
})
