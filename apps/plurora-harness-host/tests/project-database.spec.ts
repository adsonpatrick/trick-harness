/**
 * The project's database capability runs one fixed command and reports what its
 * JSON envelope said. These tests pin the command, the envelope, the verdicts,
 * and what never leaves the child process.
 *
 * @module apps/plurora-harness-host/tests/project-database
 */

import type { WorkflowDatabaseVerificationInput } from '@trick-harness/engineering-workflow'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_ENVELOPE_BYTES,
  PROJECT_DATABASE_COMMAND,
  ProjectDatabaseEnvelopeError,
  createProjectDatabaseVerifier,
  parseVerificationEnvelope,
} from '../src/project-database.ts'

const PROJECT_ROOT = '/workspace/plurora'
const PROJECT_REF = 'uljaajwwnygopsyvwsre'

const INPUT: WorkflowDatabaseVerificationInput = {
  stageId: 'delivery',
  objective: {
    id: 'obj-1',
    cwd: PROJECT_ROOT,
    requirement: 'add a column',
    risk: 'medium',
    workload: 'light',
    profileId: 'plurora',
  },
}

/** A well-formed envelope, overridable field by field. */
function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    status: 'PASSED',
    targetProjectRef: PROJECT_REF,
    summary: 'schema matches the migrations in this checkout',
    evidence: [{ kind: 'gate', locator: 'db:verify:harness', summary: 'shared development database' }],
    ...overrides,
  })
}

interface FakeRun {
  readonly specs: SubprocessSpawnSpec[]
  readonly terminate: ReturnType<typeof vi.fn>
  readonly waitForExit: ReturnType<typeof vi.fn>
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
}

/** A child that emits `stdout` and exits with `exitCode`. */
function fakeRun(options: {
  stdout?: string
  exitCode?: number | null
  lossy?: boolean
  spawnError?: Error
  doneError?: Error
  quiescent?: boolean
} = {}): FakeRun {
  const specs: SubprocessSpawnSpec[] = []
  const terminate = vi.fn()
  const waitForExit = vi.fn(async () => options.quiescent !== false)
  const outcome: SubprocessOutcome = { exitCode: options.exitCode ?? 0, signal: null }
  const spawn = (spec: SubprocessSpawnSpec): SubprocessHandle => {
    specs.push(spec)
    if (options.spawnError !== undefined) throw options.spawnError
    return {
      pid: 4321,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        stdout: {
          readFrom: () => ({
            text: options.stdout ?? envelope(),
            nextOffset: 0,
            lossy: options.lossy ?? false,
          }),
        },
      },
      done: options.doneError === undefined
        ? Promise.resolve(outcome)
        : Promise.reject(options.doneError),
      terminate,
      waitForExit,
    }
  }
  return { specs, terminate, waitForExit, spawn }
}

/** Run the capability against `run` and hand back its result. */
async function verify(run: FakeRun, signal = AbortSignal.timeout(1_000)): ReturnType<
  ReturnType<typeof createProjectDatabaseVerifier>['verify']
> {
  const verifier = createProjectDatabaseVerifier({
    projectRoot: PROJECT_ROOT,
    projectRef: PROJECT_REF,
    disposeGraceMs: 5_000,
    spawn: run.spawn,
  })
  return await verifier.verify(INPUT, signal)
}

describe('PROJECT_DATABASE_COMMAND', () => {
  it('states the command as a vector nothing can extend', () => {
    expect(Object.isFrozen(PROJECT_DATABASE_COMMAND)).toBe(true)
    expect([...PROJECT_DATABASE_COMMAND]).toEqual(['npm', 'run', 'db:verify:harness', '--', '--json'])
  })
})

describe('parseVerificationEnvelope', () => {
  it('reads a well-formed envelope', () => {
    const parsed = parseVerificationEnvelope(envelope(), PROJECT_REF)
    expect(parsed.status).toBe('PASSED')
    expect(parsed.targetProjectRef).toBe(PROJECT_REF)
  })

  it('refuses a schema version this host was not written against', () => {
    expect(() => parseVerificationEnvelope(envelope({ schemaVersion: 2 }), PROJECT_REF))
      .toThrow(ProjectDatabaseEnvelopeError)
  })

  it('refuses an envelope that verified a different project than the one deployed', () => {
    expect(() => parseVerificationEnvelope(envelope({ targetProjectRef: 'someotherprojectref00' }), PROJECT_REF))
      .toThrow(/project/)
  })

  it('refuses a status outside the three this host understands', () => {
    expect(() => parseVerificationEnvelope(envelope({ status: 'OK' }), PROJECT_REF))
      .toThrow(ProjectDatabaseEnvelopeError)
  })

  it('refuses an evidence kind the journal does not accept', () => {
    const evidence = [{ kind: 'screenshot', locator: 'a', summary: 'b' }]
    expect(() => parseVerificationEnvelope(envelope({ evidence }), PROJECT_REF))
      .toThrow(ProjectDatabaseEnvelopeError)
  })

  it('keeps only the fields it validated, dropping anything else the child sent', () => {
    const parsed = parseVerificationEnvelope(
      envelope({ stdout: 'raw log', connectionString: 'postgresql://u:p@h/db' }),
      PROJECT_REF,
    )
    expect(Object.keys(parsed).toSorted())
      .toEqual(['evidence', 'schemaVersion', 'status', 'summary', 'targetProjectRef'])
  })

  it('refuses a credential the child put in a field this host would journal', () => {
    const secret = 'postgresql://user:hunter2@db.example.com:5432/plurora'
    expect(() => parseVerificationEnvelope(envelope({ summary: secret }), PROJECT_REF))
      .toThrow(ProjectDatabaseEnvelopeError)
    expect(() => parseVerificationEnvelope(
      envelope({ evidence: [{ kind: 'gate', locator: secret, summary: 'x' }] }),
      PROJECT_REF,
    )).toThrow(ProjectDatabaseEnvelopeError)
    expect(() => parseVerificationEnvelope(
      envelope({ evidence: [{ kind: 'gate', locator: 'x', summary: 'token sk-live-abc123def456ghi' }] }),
      PROJECT_REF,
    )).toThrow(ProjectDatabaseEnvelopeError)
  })

  it('refuses more than one JSON document rather than reading the first', () => {
    expect(() => parseVerificationEnvelope(`${envelope()}\n${envelope()}`, PROJECT_REF))
      .toThrow(ProjectDatabaseEnvelopeError)
  })

  it('refuses text that is not JSON at all without quoting it back', () => {
    const failure = (): unknown => parseVerificationEnvelope('npm ERR! ECONNREFUSED db.example.com', PROJECT_REF)
    expect(failure).toThrow(ProjectDatabaseEnvelopeError)
    try { failure() } catch (error: unknown) { expect(String(error)).not.toContain('db.example.com') }
  })
})

describe('createProjectDatabaseVerifier', () => {
  it('spawns the fixed vector in the project checkout, never through a shell', async () => {
    const run = fakeRun()
    await verify(run)
    expect(run.specs).toHaveLength(1)
    expect(run.specs[0]?.argv).toEqual([...PROJECT_DATABASE_COMMAND])
    expect(run.specs[0]?.cwd).toBe(PROJECT_ROOT)
  })

  it('gives the child no stdin and bounds what it can say back', async () => {
    const run = fakeRun()
    await verify(run)
    expect(run.specs[0]?.stdio.stdin).toBe('ignore')
    expect(run.specs[0]?.stdio.stdout).toEqual({ maxBytes: MAX_ENVELOPE_BYTES })
  })

  it('spills no output to disk, since a spill file is the leak the bound prevents', async () => {
    const run = fakeRun()
    await verify(run)
    const stdout = run.specs[0]?.stdio.stdout
    expect(typeof stdout === 'object' && 'spill' in stdout).toBe(false)
  })

  it('hands the cancellation signal to the process tree that has to react to it', async () => {
    const controller = new AbortController()
    const run = fakeRun()
    await verify(run, controller.signal)
    expect(run.specs[0]?.signal).toBe(controller.signal)
  })

  it('waits for the whole process tree before reporting', async () => {
    const run = fakeRun()
    await verify(run)
    expect(run.waitForExit).toHaveBeenCalled()
  })

  it('passes on the envelope the command produced', async () => {
    const result = await verify(fakeRun())
    expect(result.status).toBe('PASSED')
    expect(result.summary).toBe('schema matches the migrations in this checkout')
    expect(result.evidence).toEqual([
      { kind: 'gate', locator: 'db:verify:harness', summary: 'shared development database' },
    ])
  })

  it('fails — rather than blocks — when the command reports a failed verification', async () => {
    const result = await verify(fakeRun({ stdout: envelope({ status: 'FAILED' }), exitCode: 1 }))
    expect(result.status).toBe('FAILED')
  })

  it('blocks a passing envelope that contradicts a non-zero exit', async () => {
    const result = await verify(fakeRun({ exitCode: 1 }))
    expect(result.status).toBe('BLOCKED')
  })

  it('blocks when the command could not be spawned at all', async () => {
    const result = await verify(fakeRun({ spawnError: new Error('spawn ENOENT') }))
    expect(result.status).toBe('BLOCKED')
    expect(result.summary).toContain('nothing was verified')
  })

  it('blocks when the envelope slid out of the bounded window', async () => {
    const result = await verify(fakeRun({ lossy: true }))
    expect(result.status).toBe('BLOCKED')
  })

  it('blocks when the process tree did not go quiescent', async () => {
    const result = await verify(fakeRun({ quiescent: false }))
    expect(result.status).toBe('BLOCKED')
  })

  it('carries no raw output, cause or credential into what gets journalled', async () => {
    const secret = 'postgresql://user:hunter2@db.example.com:5432/plurora'
    const runs = [
      fakeRun({ stdout: secret, exitCode: 1 }),
      fakeRun({ stdout: envelope({ summary: secret }) }),
      fakeRun({ doneError: new Error(secret) }),
      fakeRun({ spawnError: new Error(secret) }),
    ]
    for (const run of runs) {
      const result = await verify(run)
      expect(JSON.stringify(result)).not.toContain('hunter2')
      expect(JSON.stringify(result)).not.toContain('db.example.com')
    }
  })

  it('points its evidence at the command a reader can rerun when nothing came back', async () => {
    const result = await verify(fakeRun({ spawnError: new Error('nope') }))
    expect(result.evidence[0]?.locator).toBe('npm run db:verify:harness -- --json')
    expect(result.evidence[0]?.summary).toContain('delivery')
  })
})
