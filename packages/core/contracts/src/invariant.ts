/** Package-owned workflow-contract invariants. @module @trick-harness/contracts/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import {
  AUTO_REPAIRABLE_FINDINGS,
  CHANGE_IMPACT_SOURCES,
  CONFORMANCE_ITEM_STATUSES,
  CONFORMANCE_SOURCES,
  CONFIDENCE_LEVELS,
  EVIDENCE_KINDS,
  FINDING_CLASSES,
  INDEPENDENCE_REQUIREMENTS,
  READ_ONLY_ROLES,
  RISKS,
  SECURITY_RELEVANCES,
  ROLES,
  ROUTED_PERMISSION_MODES,
  WORKFLOW_VERDICTS,
  WORKLOADS,
  WRITE_VOLUMES,
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

/** Restated obligation sources; see {@link EXPECTED_ROLES}. */
const EXPECTED_CONFORMANCE_SOURCES = ['spec', 'plan', 'dod']

/** Restated conformance item statuses; see {@link EXPECTED_ROLES}. */
const EXPECTED_CONFORMANCE_STATUSES = ['PASS', 'MISSING', 'PARTIAL', 'FAIL', 'BLOCKED', 'INCONCLUSIVE']

/** Restated impact readings; see {@link EXPECTED_ROLES}. */
const EXPECTED_CHANGE_IMPACT_SOURCES = ['planned', 'actual']

/** Restated risk ladder; see {@link EXPECTED_ROLES}. */
const EXPECTED_RISKS = ['low', 'medium', 'high', 'critical']

/** Restated write-volume ladder; see {@link EXPECTED_ROLES}. */
const EXPECTED_WRITE_VOLUMES = ['none', 'small', 'medium', 'large']

/** Restated workloads; see {@link EXPECTED_ROLES}. */
const EXPECTED_WORKLOADS = ['light', 'medium', 'heavy']

/** Restated independence requirements; see {@link EXPECTED_ROLES}. */
const EXPECTED_INDEPENDENCE = ['fresh-context', 'cross-executor-preferred', 'cross-executor-required']

/** Restated evidence kinds; see {@link EXPECTED_ROLES}. */
const EXPECTED_EVIDENCE_KINDS = ['test', 'diff', 'log', 'file', 'pr', 'commit', 'gate']

/** Restated confidence levels; see {@link EXPECTED_ROLES}. */
const EXPECTED_CONFIDENCE_LEVELS = ['low', 'medium', 'high']

/** Restated security relevances; see {@link EXPECTED_ROLES}. */
const EXPECTED_SECURITY_RELEVANCES = ['none', 'possible', 'confirmed']

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
  pin(fail, 'CONFORMANCE_SOURCES', CONFORMANCE_SOURCES, EXPECTED_CONFORMANCE_SOURCES)
  pin(fail, 'CONFORMANCE_ITEM_STATUSES', CONFORMANCE_ITEM_STATUSES, EXPECTED_CONFORMANCE_STATUSES)
  // Risk and write volume are ordered ladders, and both change impact and
  // routing take a maximum over them. A value inserted in the middle silently
  // reorders every comparison already recorded against the old ladder.
  pin(fail, 'RISKS', RISKS, EXPECTED_RISKS)
  pin(fail, 'WRITE_VOLUMES', WRITE_VOLUMES, EXPECTED_WRITE_VOLUMES)
  pin(fail, 'CHANGE_IMPACT_SOURCES', CHANGE_IMPACT_SOURCES, EXPECTED_CHANGE_IMPACT_SOURCES)
  pin(fail, 'WORKLOADS', WORKLOADS, EXPECTED_WORKLOADS)
  pin(fail, 'INDEPENDENCE_REQUIREMENTS', INDEPENDENCE_REQUIREMENTS, EXPECTED_INDEPENDENCE)
  pin(fail, 'EVIDENCE_KINDS', EVIDENCE_KINDS, EXPECTED_EVIDENCE_KINDS)
  pin(fail, 'CONFIDENCE_LEVELS', CONFIDENCE_LEVELS, EXPECTED_CONFIDENCE_LEVELS)
  pin(fail, 'SECURITY_RELEVANCES', SECURITY_RELEVANCES, EXPECTED_SECURITY_RELEVANCES)

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
