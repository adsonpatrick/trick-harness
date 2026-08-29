/**
 * What Plurora's repository paths mean for risk, stages and evidence.
 *
 * Deterministic policy a person wrote and a reviewer can read: the run's risk,
 * the stages it must pass and the evidence it must produce are decided from
 * these rules and the paths a change touches, never from a stage's own account
 * of what it did.
 *
 * Rules accumulate rather than winning outright. A file under
 * `src/features/auth/` is an auth surface and a UI surface at once, and a
 * policy that had to pick one would drop the half that decides the bar.
 *
 * @module profiles/plurora/change-impact-policy
 */

import type { ChangeImpactPolicyDefinition } from '@trick-harness/profile'

/** Plurora's path rules and write-volume bands. */
export const changeImpactPolicy: ChangeImpactPolicyDefinition = {
  writeVolume: { smallMaxFiles: 3, mediumMaxFiles: 12 },
  rules: [],
}
