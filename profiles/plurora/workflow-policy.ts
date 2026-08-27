/**
 * Plurora's workflow bounds and review-independence requirements.
 *
 * @module profiles/plurora/workflow-policy
 */

import type { IndependencePolicyDefinition, WorkflowPolicyDefinition } from '@trick-harness/profile'

/**
 * Bounds that make a remediation loop terminate.
 *
 * Three repair cycles is the point past which repeated failures have, in
 * practice, meant the diagnosis is wrong rather than the fix incomplete —
 * continuing spends budget on the same misunderstanding. Twenty-four executor
 * starts bounds a whole workflow, including review and QA fan-out, so a stuck
 * run surfaces as a bounded failure a human can read rather than as exhausted
 * quota.
 */
export const workflowPolicy: WorkflowPolicyDefinition = {
  maxRepairCycles: 3,
  maxExecutorStarts: 24,
}

/**
 * Review independence required at each risk level.
 *
 * Plurora takes the contract's required values unchanged. Stating them here
 * rather than importing a default keeps the profile diff honest: weakening
 * review would have to appear as an edit to this file.
 */
export const independencePolicy: IndependencePolicyDefinition = {
  low: 'fresh-context',
  medium: 'cross-executor-preferred',
  high: 'cross-executor-required',
  critical: 'cross-executor-required',
}
