/**
 * Plurora's executor and model routing table.
 *
 * Rows are ordered most-specific first; the router applies the first match.
 * Every semantic tier name is resolved by the core model registry, never by a
 * literal model id here, so a model generation change is a core registry edit
 * rather than a policy rewrite across every project profile.
 *
 * `effort` states the reasoning effort this project wants for a run. It is
 * advisory: a product with no way to express reasoning effort still serves the
 * route, and the stated effort survives in the durable route fact rather than
 * making the route undispatchable. OpenCode is exactly that case today — its
 * SDK carries no reasoning-effort field at all — so these rows say what Plurora
 * wants without asserting that every executor can deliver it.
 *
 * @module profiles/plurora/routing-policy
 */

import type { RoutingPolicyDefinition } from '@trick-harness/profile'

/**
 * Primary routes plus the routes taken when a primary executor is unavailable.
 *
 * The fallback rows deliberately cross executors rather than retrying the same
 * one at a lower tier: an executor outage is the common cause, and a same-
 * executor retry would burn the start budget without changing the outcome.
 */
export const routingPolicy: RoutingPolicyDefinition = {
  rules: [
    {
      id: 'security-review',
      when: { stage: 'review', risk: 'critical' },
      use: { executor: 'codex', tier: 'codex.frontier', effort: 'high' },
    },
    {
      id: 'high-risk-review',
      when: { stage: 'review', risk: 'high' },
      use: { executor: 'codex', tier: 'codex.frontier', effort: 'high' },
    },
    {
      id: 'routine-review',
      when: { stage: 'review' },
      use: { executor: 'opencode', tier: 'opencode.reasoning-fast', effort: 'medium' },
    },
    {
      id: 'architecture',
      when: { stage: 'design' },
      use: { executor: 'codex', tier: 'codex.frontier', effort: 'high' },
    },
    {
      id: 'implementation',
      when: { stage: 'implement' },
      use: { executor: 'codex', tier: 'codex.balanced', effort: 'medium' },
    },
    {
      id: 'repair',
      when: { stage: 'repair' },
      use: { executor: 'opencode', tier: 'opencode.workhorse', effort: 'medium' },
    },
    {
      id: 'triage',
      when: { stage: 'triage' },
      use: { executor: 'codex', tier: 'codex.fast', effort: 'low' },
    },
    {
      id: 'default',
      when: {},
      use: { executor: 'codex', tier: 'codex.balanced', effort: 'medium' },
    },
  ],
  fallbackRules: [
    {
      id: 'codex-unavailable-critical',
      when: { unavailable: 'codex', risk: 'critical' },
      use: { executor: 'opencode', tier: 'opencode.reasoning-fast', effort: 'high' },
    },
    {
      id: 'codex-unavailable',
      when: { unavailable: 'codex' },
      use: { executor: 'opencode', tier: 'opencode.workhorse', effort: 'medium' },
    },
    {
      id: 'opencode-unavailable',
      when: { unavailable: 'opencode' },
      use: { executor: 'codex', tier: 'codex.balanced', effort: 'medium' },
    },
  ],
}
