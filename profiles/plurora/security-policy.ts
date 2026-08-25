/**
 * Plurora's security triggers and trusted-composition exclusions.
 *
 * @module profiles/plurora/security-policy
 */

import type { SecurityPolicyDefinition, TrustedCompositionDefinition } from '@trick-harness/profile'

/**
 * Changed surfaces that select security-sensitive review.
 *
 * The triggers are surface-shaped rather than keyword-shaped: a rule that fired
 * on the word "password" would miss a credential path refactor and fire on a
 * docs typo fix, which trains reviewers to ignore it.
 */
export const securityPolicy: SecurityPolicyDefinition = {
  rules: [
    {
      id: 'credential-handling',
      when: { surface: 'credentials' },
      use: { review: 'security', independence: 'cross-executor-required', blocking: true },
    },
    {
      id: 'auth-flow',
      when: { surface: 'auth' },
      use: { review: 'security', independence: 'cross-executor-required', blocking: true },
    },
    {
      id: 'delivery-automation',
      when: { surface: 'delivery' },
      use: { review: 'security', independence: 'cross-executor-required', blocking: true },
    },
    {
      id: 'dependency-surface',
      when: { surface: 'dependencies' },
      use: { review: 'security', independence: 'cross-executor-preferred', blocking: true },
    },
  ],
}

/**
 * Plugins excluded from Plurora's trusted composition.
 *
 * Self-modifying and model-authored runtime plugins are excluded because the
 * trusted workflow state machine is the thing enforcing every other rule here;
 * a plugin that can rewrite it at runtime makes the whole policy set advisory.
 * The list is stated rather than left empty so the exclusion is a reviewable
 * decision instead of an omission.
 */
export const trustedComposition: TrustedCompositionDefinition = {
  excludedPluginIds: [
    'cordis-plugin-hmr',
    'model-authored-runtime-plugin',
    'self-modifying-workflow-plugin',
  ],
}
