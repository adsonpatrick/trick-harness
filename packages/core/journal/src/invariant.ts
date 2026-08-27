/** Package-owned journal invariants. @module @trick-harness/journal/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { HARNESS_EVENT_TYPES } from './index.ts'

const PACKAGE_NAME = '@trick-harness/journal'

/** Cordis companion plugin name. */
export const name = 'journal-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * The durable vocabulary, restated rather than imported.
 *
 * A workflow's memory is exactly this list. An event type dropped from it stops
 * being written and starts being unreadable, and the run that loses it still
 * finishes — reporting a workflow with no findings rather than a workflow whose
 * findings were lost. Stating the set here turns that into a startup failure.
 */
const EXPECTED_EVENTS = [
  'harness/workflow-start',
  'harness/route-decision',
  'harness/route-fallback',
  'harness/executor-start',
  'harness/executor-end',
  'harness/finding',
  'harness/diagnosis',
  'harness/verdict',
  'harness/delivery',
  'harness/blocker',
  'harness/circuit-breaker',
  'harness/workflow-end',
]

/** Check the journal's vocabulary against the build's persistence read path. */
const install: InvariantInstaller = (_ctx: Context, fail: InvariantFailure) => {
  if (
    HARNESS_EVENT_TYPES.length !== EXPECTED_EVENTS.length
    || !HARNESS_EVENT_TYPES.every((type, index) => type === EXPECTED_EVENTS[index])
  ) {
    fail(`the harness event vocabulary no longer matches the set pinned here: got ${HARNESS_EVENT_TYPES.join(', ')}`)
  }
  for (const type of HARNESS_EVENT_TYPES) {
    if (!KNOWN_SESSION_EVENT_TYPES.has(type)) {
      // The read path refuses a log holding a type it does not know, so this
      // would surface as a session that will not reconstruct — at whichever
      // restart happened to need it, rather than here.
      fail(`event type ${JSON.stringify(type)} is written by this journal but unknown to the persistence read path`)
    }
  }
}

/**
 * Register the journal invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
