/**
 * Plurora's risk-to-evidence rules for the independent QA stage.
 *
 * Each row states what evidence a change of that shape must produce before it
 * is eligible for human merge. The rows name evidence, not commands: which gate
 * produces which artifact is core's business, and a profile that named commands
 * would silently rot the first time a gate is renamed.
 *
 * @module profiles/plurora/qa-policy
 */

import type { QaPolicyDefinition } from '@trick-harness/profile'

/** Evidence Plurora requires per changed surface and risk level. */
export const qaPolicy: QaPolicyDefinition = {
  rules: [
    {
      id: 'database-migration',
      when: { surface: 'database' },
      use: { evidence: 'preview-branch-migration', independentReview: true, risk: 'critical' },
    },
    {
      id: 'auth-surface',
      when: { surface: 'auth' },
      use: { evidence: 'security-review', independentReview: true, risk: 'critical' },
    },
    {
      id: 'public-api',
      when: { surface: 'api' },
      use: { evidence: 'contract-tests', independentReview: true, risk: 'high' },
    },
    {
      id: 'design-system',
      when: { surface: 'ui' },
      use: { evidence: 'visual-regression', independentReview: true, risk: 'medium' },
    },
    {
      id: 'default',
      when: {},
      use: { evidence: 'unit-tests', independentReview: false, risk: 'low' },
    },
  ],
}
