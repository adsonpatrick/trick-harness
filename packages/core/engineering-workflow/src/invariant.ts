/** Package-owned workflow invariants. @module @trick-harness/engineering-workflow/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { FINDING_CLASSES, READ_ONLY_ROLES, ROLES } from '@trick-harness/contracts'
import { permissionModeFor } from './index.ts'
import { triageFinding } from './triage.ts'

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

/**
 * The finding classes an automated repair may act on, restated rather than derived.
 *
 * Triage reads `AUTO_REPAIRABLE_FINDINGS`, so checking triage against that list
 * would only prove triage can read. The four are named here instead: a class
 * added to the repairable set upstream, or a rule in triage that quietly widened
 * what counts, is a startup failure rather than a run that repairs something
 * nobody authorised it to touch.
 */
const EXPECTED_REPAIRABLE_CLASSES = ['BUG', 'SECURITY_BUG', 'TEST_DEFECT', 'TOOLING_DEFECT']

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

  const repairable = FINDING_CLASSES.filter(findingClass => triageFinding({
    id: 'invariant',
    class: findingClass,
    raisedBy: 'review',
    summary: 'invariant probe',
    confirmed: true,
    evidence: [{ kind: 'file', locator: 'invariant', summary: 'probe' }],
  }).disposition === 'repair')
  const widened = repairable.filter(findingClass => !EXPECTED_REPAIRABLE_CLASSES.includes(findingClass))
  if (widened.length > 0) {
    fail(`triage would repair ${widened.join(', ')}, which is outside what an automated repair may touch`)
  }
  const narrowed = EXPECTED_REPAIRABLE_CLASSES.filter(findingClass => !repairable.includes(findingClass as never))
  if (narrowed.length > 0) {
    fail(`triage no longer repairs ${narrowed.join(', ')}, so the authorised repair set has silently shrunk`)
  }
}

/**
 * Register the workflow invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
