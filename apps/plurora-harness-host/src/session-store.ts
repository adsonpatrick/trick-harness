/**
 * The durable session the host journals workflow facts into.
 *
 * A harness whose journal lives in memory is a harness that answers "what did
 * this run already do to the world?" with nothing the moment the process ends —
 * and that question is the whole basis of a restart assessment. So the host
 * does not offer an in-memory mode: every deployment gets an append-only log on
 * disk, written by the fork's own session-persistence backend rather than by
 * anything written here.
 *
 * What this module owns is small on purpose: a plugin fiber holding the session
 * store and the JSONL backend together, the session those two produce, and the
 * checkpoint call the journal is handed. Everything about the log's format,
 * durability and recovery belongs to the backend.
 *
 * @module apps/plurora-harness-host/session-store
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { JournalFlush } from '@trick-harness/journal'

/**
 * Where session logs live, relative to the project root.
 *
 * Under the checkout rather than in a system-wide location: the log is about
 * this deployment's runs, and a host pointed at a second checkout must not
 * append its history onto the first one's.
 */
export const SESSION_DIRECTORY = join('.plurora-harness', 'sessions')

/** What the durable session needs from the deployment. */
export interface DurableSessionOptions {
  /** The checkout the log is kept under. */
  readonly projectRoot: string
  /** The session's id, which is also its directory in the log root. */
  readonly sessionId: string
}

/** An open durable session and the handle that closes it. */
export interface DurableSession {
  /** The session workflow events are journalled into. */
  readonly session: Session
  /**
   * Force a durable checkpoint.
   *
   * Resolves `false` when the backend refused, which the journal treats exactly
   * as it treats a rejection — a checkpoint that did not happen is the same
   * fact either way.
   */
  readonly flush: JournalFlush
  /** Close the log and wait for the backend to go quiet. */
  dispose(): Promise<void>
}

/**
 * Open the deployment's durable session.
 *
 * @param options - the checkout and the session id.
 * @returns the session, its checkpoint call, and its disposer.
 */
export async function openDurableSession(options: DurableSessionOptions): Promise<DurableSession> {
  const root = join(options.projectRoot, SESSION_DIRECTORY)
  // Created here rather than left to the first append: a host that reported
  // itself ready and then discovered at its first durable write that the log
  // root was unwritable would have accepted work it could not journal.
  await mkdir(root, { recursive: true })
  const ctx = new Context()
  // Ordered rather than concurrent: the backend declares `inject = ['sessions']`,
  // so the store has to be a service before the backend can attach its
  // write-path listeners to it.
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root })
  }
  catch (error: unknown) {
    // The fiber already holds whatever attached before the failure. Leaving it
    // stranded would keep a session store alive for the life of the process
    // with nobody holding a handle that could ever close it.
    await ctx.fiber.dispose()
    throw error
  }
  // `cwd` is the checkout because the backend groups logs by the directory a
  // session ran in; a session without one lands in a shared bucket.
  const session = ctx.sessions.create(SessionId(options.sessionId), { meta: { cwd: options.projectRoot } })

  let disposed = false
  return {
    session,
    flush: async () => await ctx.sessions.flush(session),
    async dispose() {
      if (disposed) return
      disposed = true
      // Disposing the fiber drains the backend before closing it, so this
      // resolving means the last append is on disk rather than in a queue.
      await ctx.fiber.dispose()
    },
  }
}
