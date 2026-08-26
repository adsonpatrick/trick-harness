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
 * making the route undispatchable. The OpenCode rows below simply state none —
 * its SDK carries no reasoning-effort field, and a number written down for a
 * knob that does not exist is a claim about a run nobody can check.
 *
 * @module profiles/plurora/routing-policy
 */

import type { RoutingPolicyDefinition } from '@trick-harness/profile'

/**
 * Primary routes plus the routes taken when a primary executor is unavailable.
 *
 * The shape of this table is one decision repeated. Work whose value is
 * judgement — review, diagnosis, verification, security — goes to Codex at the
 * tier the risk deserves. Work whose value is volume — implementation, repair,
 * heavy QA execution — goes to MiMo V2.5, and that is binding rather than a
 * default: broad implementation, large write surfaces, many-file repair loops,
 * and high-volume test work all route there unless a human overrides the run
 * explicitly. Sending heavy mechanical work to a frontier reasoning model buys
 * nothing and spends the budget that the hard reviews need.
 *
 * The fallback rows deliberately cross executors rather than retrying the same
 * one at a lower tier: an executor outage is the common cause, and a same-
 * executor retry would burn the start budget without changing the outcome.
 */
export const routingPolicy: RoutingPolicyDefinition = {
  rules: [
    {
      id: 'security-review',
      when: { role: 'security' },
      use: { executor: 'codex', tier: 'codex.frontier', effort: 'xhigh' },
    },
    {
      id: 'critical-risk-review',
      when: { role: 'review', risk: 'critical' },
      use: { executor: 'codex', tier: 'codex.frontier', effort: 'xhigh' },
    },
    {
      id: 'high-risk-review',
      when: { role: 'review', risk: 'high' },
      use: { executor: 'codex', tier: 'codex.frontier', effort: 'xhigh' },
    },
    {
      id: 'routine-review',
      when: { role: 'review' },
      use: { executor: 'codex', tier: 'codex.balanced', effort: 'high' },
    },
    {
      id: 'diagnosis',
      when: { role: 'debug' },
      use: { executor: 'codex', tier: 'codex.balanced', effort: 'high' },
    },
    {
      id: 'verification',
      when: { role: 'verify' },
      use: { executor: 'codex', tier: 'codex.balanced', effort: 'high' },
    },
    // Heavy QA is execution volume — running charters, fixing what they turn
    // up — and is routed by volume even though the QA role is otherwise a
    // judgement stage.
    {
      id: 'qa-execution',
      when: { role: 'qa', workload: 'heavy' },
      use: { executor: 'opencode', tier: 'opencode.workhorse' },
    },
    {
      id: 'qa-analysis',
      when: { role: 'qa' },
      use: { executor: 'codex', tier: 'codex.balanced', effort: 'high' },
    },
    {
      id: 'implementation',
      when: { role: 'implement' },
      use: { executor: 'opencode', tier: 'opencode.workhorse' },
    },
    {
      id: 'repair',
      when: { role: 'repair' },
      use: { executor: 'opencode', tier: 'opencode.workhorse' },
    },
    {
      id: 'refinement',
      when: { role: 'refine' },
      use: { executor: 'opencode', tier: 'opencode.reasoning-fast' },
    },
    {
      id: 'planning',
      when: { role: 'plan' },
      use: { executor: 'opencode', tier: 'opencode.reasoning-fast' },
    },
    {
      id: 'delivery',
      when: { role: 'delivery' },
      use: { executor: 'opencode', tier: 'opencode.reasoning-fast' },
    },
    {
      id: 'default',
      when: {},
      use: { executor: 'codex', tier: 'codex.balanced', effort: 'medium' },
    },
  ],
  fallbackRules: [
    // Losing Codex costs assurance, not throughput, so the substitute is chosen
    // by what the stage was for: judgement work moves to the reasoning tier,
    // and volume work moves to the workhorse.
    {
      id: 'codex-unavailable-review',
      when: { unavailable: 'codex', role: 'review' },
      use: { executor: 'opencode', tier: 'opencode.reasoning-fast' },
    },
    {
      id: 'codex-unavailable-security',
      when: { unavailable: 'codex', role: 'security' },
      use: { executor: 'opencode', tier: 'opencode.reasoning-fast' },
    },
    {
      id: 'codex-unavailable-debug',
      when: { unavailable: 'codex', role: 'debug' },
      use: { executor: 'opencode', tier: 'opencode.reasoning-fast' },
    },
    {
      id: 'codex-unavailable-verify',
      when: { unavailable: 'codex', role: 'verify' },
      use: { executor: 'opencode', tier: 'opencode.reasoning-fast' },
    },
    {
      id: 'codex-unavailable',
      when: { unavailable: 'codex' },
      use: { executor: 'opencode', tier: 'opencode.workhorse' },
    },
    {
      id: 'opencode-unavailable',
      when: { unavailable: 'opencode' },
      use: { executor: 'codex', tier: 'codex.balanced', effort: 'medium' },
    },
  ],
}
