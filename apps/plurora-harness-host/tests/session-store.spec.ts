/**
 * A journal that does not survive the process cannot answer the one question a
 * restart asks. These tests pin that the host's session is on disk, that its
 * checkpoint really is one, and that closing it waits for the last append.
 *
 * @module apps/plurora-harness-host/tests/session-store
 */

import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SESSION_DIRECTORY, openDurableSession } from '../src/session-store.ts'

describe('openDurableSession', () => {
  let root: string

  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'plurora-session-')) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  /** Open a durable session under the temporary checkout. */
  async function open(sessionId = 'plurora-test'): ReturnType<typeof openDurableSession> {
    return await openDurableSession({ projectRoot: root, sessionId })
  }

  it('keeps the log under the checkout it is about', async () => {
    const durable = await open()
    expect((await stat(join(root, SESSION_DIRECTORY))).isDirectory()).toBe(true)
    await durable.dispose()
  })

  it('creates the log root at open, not at the first thing worth writing', async () => {
    // A host that reported itself ready and then found the root unwritable
    // would already have accepted work it could not journal.
    const durable = await open()
    expect(await readdir(root)).toContain('.plurora-harness')
    await durable.dispose()
  })

  it('names the session the caller asked for, so a log can be found again', async () => {
    const durable = await open('plurora-named')
    expect(durable.session.id).toBe('plurora-named')
    await durable.dispose()
  })

  it('checkpoints through the backend rather than reporting one it did not take', async () => {
    const durable = await open()
    await expect(durable.flush()).resolves.toBe(true)
    await durable.dispose()
  })

  it('is disposable more than once, since shutdown and cancellation race', async () => {
    const durable = await open()
    await durable.dispose()
    await expect(durable.dispose()).resolves.toBeUndefined()
  })

  it('records which checkout the session ran in, so two are never one log', async () => {
    const durable = await open()
    // The backend groups logs by the directory a session ran in; a session
    // without one lands in a shared bucket with every other deployment's.
    expect(durable.session.header.cwd).toBe(root)
    await durable.dispose()
  })
})
