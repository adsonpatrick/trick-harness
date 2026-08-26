/** Package-owned workflow invariants. @module @trick-harness/engineering-workflow/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { READ_ONLY_ROLES, ROLES } from '@trick-harness/contracts'
import { permissionModeFor } from './index.ts'

const PACKAGE_NAME = '@trick-harness/engineering-workflow'

/** Cordis companion plugin name. */
export const name = 'workflow-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * The roles that may write, restated rather than derived.
 *
 * Everything else certifies somebody else's work, and a certifier that could
 * edit is not a certifier. Deriving this set from `READ_ONLY_ROLES` would make
 * the check agree with whatever that list happened to say, including after a
 * role was quietly moved out of it — so the mutating three are named here, and
 * a fourth appearing anywhere is a startup failure rather than a run that
 * silently hands write authority to a reviewer.
 */
const EXPECTED_MUTATING_ROLES = ['implement', 'repair', 'delivery']

/** Check that write authority still belongs to exactly the mutating roles. */
const install: InvariantInstaller = (_ctx: Context, fail: InvariantFailure) => {
  const mutating = ROLES.filter(role => permissionModeFor(role) === 'workspace-write')
  if (
    mutating.length !== EXPECTED_MUTATING_ROLES.length
    || !mutating.every((role, index) => role === EXPECTED_MUTATING_ROLES[index])
  ) {
    fail(`workspace write authority no longer belongs to exactly ${EXPECTED_MUTATING_ROLES.join(', ')}: got ${mutating.join(', ')}`)
  }
  for (const role of READ_ONLY_ROLES) {
    if (permissionModeFor(role) !== 'read-only') {
      fail(`role ${JSON.stringify(role)} is declared read-only but would be dispatched with write authority`)
    }
  }
}

/**
 * Register the workflow invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
