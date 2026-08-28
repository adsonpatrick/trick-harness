/**
 * The project's database capability runs one fixed command and reports what it
 * said. These tests pin the command, the verdicts, and what never leaks.
 *
 * @module apps/plurora-harness-host/tests/project-database
 */

import type { WorkflowDatabaseVerificationInput } from '@trick-harness/engineering-workflow'
import { describe, expect, it } from 'vitest'
import {
  PROJECT_DATABASE_COMMAND,
  type ProjectDatabaseRunner,
  createProjectDatabaseVerifier,
} from '../src/project-database.ts'

const INPUT: WorkflowDatabaseVerificationInput = {
  stageId: 'delivery',
  objective: {
    id: 'obj-1',
    cwd: '/workspace/plurora',
    requirement: 'add a column',
    risk: 'medium',
    workload: 'light',
    profileId: 'plurora',
  },
}

/** A runner that records what it was asked for and answers with `run`. */
function runnerFor(run: () => Promise<{ exitCode: number; stdout: string }>): {
  runner: ProjectDatabaseRunner
  asked: string[][]
} {
  const asked: string[][] = []
  return {
    asked,
    runner: {
      async run(command) {
        asked.push([...command])
        return await run()
      },
    },
  }
}

describe('createProjectDatabaseVerifier', () => {
  it('runs exactly the fixed project command', async () => {
    const { runner, asked } = runnerFor(async () => ({ exitCode: 0, stdout: '{}' }))
    await createProjectDatabaseVerifier(runner).verify(INPUT, AbortSignal.timeout(1_000))
    expect(asked).toEqual([['npm', 'run', 'db:verify:harness', '--', '--json']])
  })

  it('states the command as a vector nothing can extend', () => {
    expect(Object.isFrozen(PROJECT_DATABASE_COMMAND)).toBe(true)
  })

  it('passes when the command exits zero', async () => {
    const { runner } = runnerFor(async () => ({ exitCode: 0, stdout: '{}' }))
    const result = await createProjectDatabaseVerifier(runner).verify(INPUT, AbortSignal.timeout(1_000))
    expect(result.status).toBe('PASSED')
    expect(result.findings).toEqual([])
  })

  it('fails — rather than blocks — when the command exits non-zero', async () => {
    const { runner } = runnerFor(async () => ({ exitCode: 3, stdout: '' }))
    const result = await createProjectDatabaseVerifier(runner).verify(INPUT, AbortSignal.timeout(1_000))
    expect(result.status).toBe('FAILED')
    expect(result.summary).toContain('3')
  })

  it('blocks when the command could not be run at all', async () => {
    const { runner } = runnerFor(async () => { throw new Error('spawn ENOENT') })
    const result = await createProjectDatabaseVerifier(runner).verify(INPUT, AbortSignal.timeout(1_000))
    expect(result.status).toBe('BLOCKED')
    expect(result.summary).toContain('nothing was verified')
  })

  it('carries no output, cause or credential into what gets journalled', async () => {
    const secret = 'postgresql://user:hunter2@db.example.com:5432/plurora'
    const cases = [
      async (): Promise<{ exitCode: number; stdout: string }> => ({ exitCode: 1, stdout: secret }),
      async (): Promise<{ exitCode: number; stdout: string }> => { throw new Error(secret) },
    ]
    for (const run of cases) {
      const { runner } = runnerFor(run)
      const result = await createProjectDatabaseVerifier(runner).verify(INPUT, AbortSignal.timeout(1_000))
      expect(JSON.stringify(result)).not.toContain('hunter2')
      expect(JSON.stringify(result)).not.toContain('db.example.com')
    }
  })

  it('points its evidence at the command a reader can rerun', async () => {
    const { runner } = runnerFor(async () => ({ exitCode: 0, stdout: '' }))
    const result = await createProjectDatabaseVerifier(runner).verify(INPUT, AbortSignal.timeout(1_000))
    expect(result.evidence).toHaveLength(1)
    expect(result.evidence[0]?.locator).toBe('npm run db:verify:harness -- --json')
    expect(result.evidence[0]?.summary).toContain('delivery')
  })

  it('hands the cancellation signal down to the command', async () => {
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    const runner: ProjectDatabaseRunner = {
      async run(_command, signal) {
        seen = signal
        return { exitCode: 0, stdout: '' }
      },
    }
    await createProjectDatabaseVerifier(runner).verify(INPUT, controller.signal)
    expect(seen).toBe(controller.signal)
  })
})
