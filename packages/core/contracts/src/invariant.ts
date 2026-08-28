/** Package-owned workflow-contract invariants. @module @trick-harness/contracts/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import {
  AUTO_REPAIRABLE_FINDINGS,
  FINDING_CLASSES,
  READ_ONLY_ROLES,
  ROLES,
  ROUTED_PERMISSION_MODES,
  WORKFLOW_VERDICTS,
} from './index.ts'

const PACKAGE_NAME = '@trick-harness/contracts'

/** Cordis companion plugin name. */
export const name = 'contracts-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * The vocabularies restated, not imported from the definition they check.
 *
 * An invariant that read its expectation from the value under test would agree
 * with any change, which is the one thing it must not do. These constants are a
 * second, independent statement of what the workflow's vocabulary is; when the
 * vocabulary genuinely changes, both views have to be edited on purpose, and
 * every consumer that switches on a value gets a deliberate moment to catch up.
 */
const EXPECTED_ROLES = [
  'refine',
  'plan',
  'implement',
  'debug',
  'repair',
  'verify',
  'review',
  'security',
  'qa',
  'conformance',
  'delivery',
]

/** Restated finding taxonomy; see {@link EXPECTED_ROLES}. */
const EXPECTED_FINDING_CLASSES = [
  'BUG',
  'SECURITY_BUG',
  'TEST_DEFECT',
  'TOOLING_DEFECT',
  'PRODUCT_DECISION',
  'DESIGN_DECISION',
  'INTENTIONAL_BEHAVIOR',
  'IMPROVEMENT',
  'REFACTOR_SUGGESTION',
  'STYLE_ONLY',
  'FALSE_POSITIVE',
  'UNRESOLVED',
]

/** Restated verdicts; see {@link EXPECTED_ROLES}. */
const EXPECTED_VERDICTS = ['PASS', 'PARTIAL', 'FAIL', 'INCONCLUSIVE', 'BLOCKED']

/** Restated auto-repairable classes; see {@link EXPECTED_ROLES}. */
const EXPECTED_AUTO_REPAIRABLE = ['BUG', 'SECURITY_BUG', 'TEST_DEFECT', 'TOOLING_DEFECT']

/** Restated routable permission modes; see {@link EXPECTED_ROLES}. */
const EXPECTED_PERMISSION_MODES = ['read-only', 'workspace-write']

/** Roles that may never hold write authority, restated; see {@link EXPECTED_ROLES}. */
const EXPECTED_WRITING_ROLES = ['implement', 'repair', 'delivery']

/** Compare one shipped vocabulary against its restated expectation, in order. */
function pin(fail: InvariantFailure, label: string, actual: readonly string[], expected: readonly string[]): void {
  if (actual.length === expected.length && actual.every((value, index) => value === expected[index])) return
  fail(`${label} no longer matches the vocabulary this invariant pins: got ${actual.join(', ')}`)
}

/**
 * Check the vocabulary the whole workflow switches on.
 *
 * These names are written into durable session events and read back by a later
 * process, so a silent addition or reordering is not a local change: it is a
 * change to data already on disk that no consumer was told about.
 */
const install: InvariantInstaller = (_ctx: Context, fail: InvariantFailure) => {
  pin(fail, 'ROLES', ROLES, EXPECTED_ROLES)
  pin(fail, 'FINDING_CLASSES', FINDING_CLASSES, EXPECTED_FINDING_CLASSES)
  pin(fail, 'WORKFLOW_VERDICTS', WORKFLOW_VERDICTS, EXPECTED_VERDICTS)
  pin(fail, 'AUTO_REPAIRABLE_FINDINGS', AUTO_REPAIRABLE_FINDINGS, EXPECTED_AUTO_REPAIRABLE)
  pin(fail, 'ROUTED_PERMISSION_MODES', ROUTED_PERMISSION_MODES, EXPECTED_PERMISSION_MODES)

  // The separation these two lists express is the reason the read-only set
  // exists at all: a stage that judges work must not be able to change it.
  for (const role of EXPECTED_WRITING_ROLES) {
    if ((READ_ONLY_ROLES as readonly string[]).includes(role)) {
      fail(`role ${JSON.stringify(role)} writes and must not be listed as read-only`)
    }
  }
  for (const role of READ_ONLY_ROLES) {
    if (!EXPECTED_ROLES.includes(role)) fail(`read-only role ${JSON.stringify(role)} is not a declared role`)
  }
}

/**
 * Register the contracts invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
