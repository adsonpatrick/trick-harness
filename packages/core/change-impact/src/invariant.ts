/** Package-owned change-impact invariants. @module @trick-harness/change-impact/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { RISKS, WRITE_VOLUMES } from '@trick-harness/contracts'

const PACKAGE_NAME = '@trick-harness/change-impact'

/** Cordis companion plugin name. */
export const name = 'change-impact-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * The two ladders this package takes a maximum over, restated.
 *
 * Restated rather than imported from the value under test, for the same reason
 * the contracts invariant restates its vocabularies: an expectation read from
 * what it checks agrees with every change. What makes these two different from
 * an ordinary closed set is that their *order* is load-bearing here — merging
 * two readings is a maximum over the index, so a value inserted in the middle
 * would silently reorder every comparison, and a run that should have resolved
 * to critical would resolve to something below it without anything failing.
 */
const EXPECTED_RISKS = ['low', 'medium', 'high', 'critical']

/** Restated write-volume ladder; see {@link EXPECTED_RISKS}. */
const EXPECTED_WRITE_VOLUMES = ['none', 'small', 'medium', 'large']

/** Compare one ladder against its restated expectation, in order. */
function pin(fail: InvariantFailure, label: string, actual: readonly string[], expected: readonly string[]): void {
  if (actual.length === expected.length && actual.every((value, index) => value === expected[index])) return
  fail(`${label} is no longer the ordered ladder change impact resolves over: got ${actual.join(', ')}`)
}

/** Check the ladders monotonic resolution depends on. */
const install: InvariantInstaller = (_ctx: Context, fail: InvariantFailure) => {
  pin(fail, 'RISKS', RISKS, EXPECTED_RISKS)
  pin(fail, 'WRITE_VOLUMES', WRITE_VOLUMES, EXPECTED_WRITE_VOLUMES)
}

/**
 * Register the change-impact invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
