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
  workflowPolicy: { maxRepairCycles: 1, maxExecutorStarts: 4 },
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
}
