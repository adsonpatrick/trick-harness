/**
 * Startup invariant for the loopback control surface.
 *
 * The expectations are restated here as independent constants rather than
 * imported from the module they check. A later edit that widens the set of
 * addresses the server will bind widens it in one place, and this file still
 * holds the set the design was reviewed against.
 * @module @trick-harness/control-server/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { HarnessControlServer } from './index.ts'

const PACKAGE_NAME = '@trick-harness/control-server'

/** Cordis service name for this invariant. */
export const name = 'control-server-invariant'

/** Services this invariant needs at startup. */
export const inject = ['invariants']

/** Addresses the server may bind, restated independently. */
const EXPECTED_LOOPBACK = ['127.0.0.1', '::1', 'localhost']

/** Addresses no configuration may talk the server into binding. */
const EXPECTED_REFUSED = ['0.0.0.0', '::', '192.168.1.10']

/** A start function the invariant never actually calls. */
const NEVER_STARTED = (): Promise<never> =>
  Promise.reject(new Error('the invariant never starts a workflow'))

/**
 * Check that the server binds loopback and refuses everything else.
 * @param fail - Reporter for a violated expectation.
 */
function validateBinding(fail: InvariantFailure): void {
  for (const host of EXPECTED_LOOPBACK) {
    try {
      void new HarnessControlServer({ start: NEVER_STARTED, host })
    } catch {
      fail(`the control server refuses the loopback address ${host}`)
    }
  }
  for (const host of EXPECTED_REFUSED) {
    let refused = false
    try {
      void new HarnessControlServer({ start: NEVER_STARTED, host })
    } catch {
      refused = true
    }
    if (!refused) fail('the control server accepts an address that is not loopback')
  }
}

/**
 * Check that a token exists without anyone configuring one, and that two
 * servers do not share it.
 * @param fail - Reporter for a violated expectation.
 */
function validateToken(fail: InvariantFailure): void {
  const first = new HarnessControlServer({ start: NEVER_STARTED })
  const second = new HarnessControlServer({ start: NEVER_STARTED })
  if (first.token.length < 16) fail('the control server mints a token too short to be a secret')
  if (first.token === second.token) fail('two control servers in one process share a token')
}

const install: InvariantInstaller = (_ctx: Context, fail: InvariantFailure) => {
  validateBinding(fail)
  validateToken(fail)
}

/**
 * Register the invariant with the runtime.
 * @param ctx - Cordis context carrying the invariants service.
 * @returns Disposer for the registration.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
