/**
 * The Plurora project profile: the first production consumer of the reusable
 * Trick Harness core.
 *
 * Everything project-specific about how the harness behaves for Plurora is
 * assembled here from the policy modules beside it. Nothing in `packages/`
 * imports this file — the dependency runs one way, and the boundary gate keeps
 * it that way.
 *
 * @module profiles/plurora/profile
 */

import type { HarnessProfile } from '@trick-harness/profile'
import { integrationPolicy } from './integrations.ts'
import { qaPolicy } from './qa-policy.ts'
import { routingPolicy } from './routing-policy.ts'
import { securityPolicy, trustedComposition } from './security-policy.ts'
import { independencePolicy, workflowPolicy } from './workflow-policy.ts'

/** Plurora's complete policy set. */
export const pluroraProfile: HarnessProfile = {
  id: 'plurora',
  policyVersion: 'plurora-v2.0.0',
  routingPolicy,
  workflowPolicy,
  independencePolicy,
  qaPolicy,
  securityPolicy,
  integrationPolicy,
  trustedComposition,
}
