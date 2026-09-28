/**
 * A second, deliberately minimal project profile.
 *
 * Its only job is to be evidence: a core that can hold this profile alongside
 * Plurora is a core with no single-project assumption baked in. It is
 * test-only, it shares no module with Plurora, and it is intentionally boring —
 * a fixture that grew features would stop proving the thing it exists to prove.
 *
 * @module profiles/fixtures/minimal/profile
 */

import type { HarnessProfile } from '@trick-harness/profile'

/** The smallest profile the contract accepts. */
export const minimalProfile: HarnessProfile = {
  id: 'fixture-minimal',
  policyVersion: 'fixture-v1.0.0',
  routingPolicy: {
    rules: [{ id: 'default', when: {}, use: { executor: 'opencode', tier: 'opencode.workhorse' } }],
    fallbackRules: [],
  },
  workflowPolicy: { maxRepairCycles: 1, maxExecutorStarts: 4, recoveryPolicy: {
    version: 'minimal-fixture-recovery-v1',
    attemptDeadlineMsByRole: { refine: 1_000, plan: 1_000, implement: 1_000, debug: 1_000, repair: 1_000, verify: 1_000, review: 1_000, security: 1_000, qa: 1_000, conformance: 1_000, delivery: 1_000 },
    maxSameExecutorRetriesPerStage: 1, maxReroutesPerStage: 1, maxReprovisionsPerStage: 1,
    maxReconciliationsPerStage: 1, maxRecoveryTransitionsPerWorkflow: 3, recoveryDeadlineMs: 3_000,
    backoffInitialMs: 100, backoffMultiplier: 2, backoffMaxMs: 200, quiescenceDeadlineMs: 500,
  } },
  independencePolicy: {
    low: 'fresh-context',
    medium: 'cross-executor-preferred',
    high: 'cross-executor-required',
    critical: 'cross-executor-required',
  },
  qaPolicy: { rules: [{ id: 'default', when: {}, use: { evidence: 'unit-tests' } }] },
  securityPolicy: { rules: [] },
  integrationPolicy: { enabled: [], rules: [] },
  trustedComposition: { excludedPluginIds: [] },
  // Present and empty on purpose: the fixture classifies no path, which is
  // a decision a project may make, and is not the same as having no policy.
  changeImpactPolicy: { rules: [], writeVolume: { smallMaxFiles: 3, mediumMaxFiles: 12 } },
}
