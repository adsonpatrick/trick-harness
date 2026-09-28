/**
 * Durable host-owned session state.
 *
 * The project checkout is an executor workspace and may be replaced, deleted or
 * written by a mutation-capable stage. A journal used for restart decisions
 * therefore cannot live under that checkout. This module owns the external
 * state root and keeps the session's project cwd only as metadata.
 *
 * @module apps/plurora-harness-host/session-store
 */

import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { JournalFlush } from '@trick-harness/journal'

/** Session directories below the host-owned durable state root. */
export const SESSION_DIRECTORY = 'sessions'

/**
 * Historical checkout-local path used before THV2-READINESS-002 Task 5.
 *
 * Workspace observation still ignores it so an old checkout can be upgraded
 * without legacy operational files becoming product mutations.
 */
export const LEGACY_SESSION_REPOSITORY_PATH = '.plurora-harness/sessions'

/** What the durable session needs from the deployment. */
export interface DurableSessionOptions {
  /** The checkout whose workflow the log describes. */
  readonly projectRoot: string
  /** Host-owned durable root. Must be outside the project checkout. */
  readonly stateRoot: string
  /** The session's id, which is also its directory in the log root. */
  readonly sessionId: string
}

/** An open durable session and the handle that closes it. */
export interface DurableSession {
  /** The session workflow events are journalled into. */
  readonly session: Session
  /** The validated host-owned root backing this session. */
  readonly stateRoot: string
  /** Force a durable checkpoint. */
  readonly flush: JournalFlush
  /** Close the log and wait for the backend to go quiet. */
  dispose(): Promise<void>
}

/**
 * Stable default root for one checkout.
 *
 * The hash separates multiple checkouts without storing the checkout path in a
 * directory name. The root lives under the host user's home rather than below
 * the executor workspace, so deleting the checkout does not delete its journal.
 */
export function defaultHarnessStateRoot(projectRoot: string): string {
  const canonical = resolve(projectRoot)
  const identity = createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 24)
  return join(homedir(), '.trick-harness', 'plurora', identity)
}

/** Refuse a state root the executor workspace can contain or overwrite. */
function externalStateRoot(projectRoot: string, stateRoot: string): string {
  if (!isAbsolute(projectRoot) || !isAbsolute(stateRoot)) {
    throw new Error('projectRoot and stateRoot must both be absolute paths')
  }
  const project = resolve(projectRoot)
  const state = resolve(stateRoot)
  const fromProject = relative(project, state)
  const nested = fromProject === ''
    || (fromProject !== '..' && !fromProject.startsWith(`..${sep}`) && !isAbsolute(fromProject))
  if (nested) {
    throw new Error('the Harness state root must live outside the project checkout')
  }
  return state
}

/** Open the deployment's durable session. */
export async function openDurableSession(options: DurableSessionOptions): Promise<DurableSession> {
  const stateRoot = externalStateRoot(options.projectRoot, options.stateRoot)
  const root = join(stateRoot, SESSION_DIRECTORY)
  // Created before the host reports ready: accepting work without a writable
  // journal would make every later restart assessment untrustworthy.
  await mkdir(root, { recursive: true })

  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root })
  }
  catch (error: unknown) {
    await ctx.fiber.dispose()
    throw error
  }

  // cwd remains project metadata. It does not decide where persistence lives.
  const session = ctx.sessions.create(SessionId(options.sessionId), { meta: { cwd: options.projectRoot } })

  let disposed = false
  return {
    session,
    stateRoot,
    flush: async () => await ctx.sessions.flush(session),
    async dispose() {
      if (disposed) return
      disposed = true
      await ctx.fiber.dispose()
    },
  }
}
