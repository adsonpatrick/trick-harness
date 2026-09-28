/**
 * Durable host state must survive independently of the executor checkout.
 *
 * @module apps/plurora-harness-host/tests/session-store
 */

import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SESSION_DIRECTORY,
  defaultHarnessStateRoot,
  openDurableSession,
} from '../src/session-store.ts'

describe('openDurableSession', () => {
  let projectRoot: string
  let stateRoot: string

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'plurora-project-'))
    stateRoot = await mkdtemp(join(tmpdir(), 'plurora-state-'))
  })
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true })
    await rm(stateRoot, { recursive: true, force: true })
  })

  async function open(sessionId = 'plurora-test'): ReturnType<typeof openDurableSession> {
    return await openDurableSession({ projectRoot, stateRoot, sessionId })
  }

  it('keeps durable state outside the executor checkout', async () => {
    const durable = await open()
    expect((await stat(join(stateRoot, SESSION_DIRECTORY))).isDirectory()).toBe(true)
    expect(await readdir(projectRoot)).not.toContain('.plurora-harness')
    expect(durable.stateRoot).toBe(stateRoot)
    await durable.dispose()
  })

  it('creates the durable root at open, before work is accepted', async () => {
    const durable = await open()
    expect(await readdir(stateRoot)).toContain(SESSION_DIRECTORY)
    await durable.dispose()
  })

  it('refuses a state root inside the project checkout', async () => {
    await expect(openDurableSession({
      projectRoot,
      stateRoot: join(projectRoot, '.state'),
      sessionId: 'unsafe',
    })).rejects.toThrow('outside the project checkout')
  })

  it('derives a stable default outside the checkout', () => {
    const one = defaultHarnessStateRoot(projectRoot)
    const two = defaultHarnessStateRoot(projectRoot)
    expect(one).toBe(two)
    expect(one.startsWith(projectRoot)).toBe(false)
  })

  it('names the session the caller asked for', async () => {
    const durable = await open('plurora-named')
    expect(durable.session.id).toBe('plurora-named')
    await durable.dispose()
  })

  it('checkpoints through the backend', async () => {
    const durable = await open()
    await expect(durable.flush()).resolves.toBe(true)
    await durable.dispose()
  })

  it('is disposable more than once', async () => {
    const durable = await open()
    await durable.dispose()
    await expect(durable.dispose()).resolves.toBeUndefined()
  })

  it('keeps the checkout only as session metadata', async () => {
    const durable = await open()
    expect(durable.session.header.cwd).toBe(projectRoot)
    await durable.dispose()
  })
})
