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
    // Who writes code comes first, ahead of every judgement row, and that
    // ordering is itself the invariant. A task class says what the change is
    // about — authentication, row-level security — and a row keyed on one of
    // those sitting above these would quietly send an *implementation* of an
    // auth change to the reviewing executor, which is the one thing this table
    // exists to prevent. What a stage is for outranks what it is about.
    //
    // The first four rows are redundant against `implementation` and `repair`,
    // and are written out anyway: the heavy-work rule is the single most
    // expensive thing this table could get wrong, so it is stated where a diff
    // that removes it is visible, rather than left implied by a broader row.
    {
      id: 'heavy-implementation',
      when: { role: 'implement', workload: 'heavy' },
      use: { executor: 'opencode', tier: 'opencode.workhorse' },
    },
    {
      id: 'large-write-implementation',
      when: { role: 'implement', writeVolume: 'large' },
      use: { executor: 'opencode', tier: 'opencode.workhorse' },
    },
    {
      id: 'heavy-repair',
      when: { role: 'repair', workload: 'heavy' },
      use: { executor: 'opencode', tier: 'opencode.workhorse' },
    },
    {
      id: 'large-write-repair',
      when: { role: 'repair', writeVolume: 'large' },
      use: { executor: 'opencode', tier: 'opencode.workhorse' },
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
    // The one route that spends the most expensive budget this project has, so
    // it is gated on a fact nobody can assert casually: the diagnosis has
    // already failed twice, and `maxRepairCycles` is three, so this is the last
    // attempt before the run is handed back to a human. A row that fired on the
    // first attempt would make `max` the ordinary price of a hard bug.
    {
      id: 'exceptional-escalation',
      when: { role: 'debug', priorAttempts: 2 },
      use: { executor: 'codex', tier: 'codex.frontier', effort: 'max' },
    },
    // Authentication, row-level security and tenant isolation are read at the
    // top tier whatever role asks: these are the three places in this product
    // where a plausible-looking wrong answer is a breach rather than a bug.
    {
      id: 'auth-analysis',
      when: { taskClass: 'auth' },
      use: { executor: 'codex', tier: 'codex.frontier', effort: 'xhigh' },
    },
    {
      id: 'rls-analysis',
      when: { taskClass: 'rls' },
      use: { executor: 'codex', tier: 'codex.frontier', effort: 'xhigh' },
    },
    {
      id: 'tenant-isolation-analysis',
      when: { taskClass: 'tenant-isolation' },
      use: { executor: 'codex', tier: 'codex.frontier', effort: 'xhigh' },
    },
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
    // Broad mechanical change is volume work whichever role asks for it: a
    // refactor across many files and a large batch of generated tests are the
    // same shape of job as an implementation, and are priced the same way.
    {
      id: 'broad-refactor',
      when: { taskClass: 'refactor' },
      use: { executor: 'opencode', tier: 'opencode.workhorse' },
    },
    {
      id: 'test-generation',
      when: { taskClass: 'test-generation' },
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
      id: 'codex-unavailable-qa-execution',
      when: { unavailable: 'codex', role: 'qa', workload: 'heavy' },
      use: { executor: 'opencode', tier: 'opencode.workhorse' },
    },
    {
      id: 'codex-unavailable-qa',
      when: { unavailable: 'codex', role: 'qa' },
      use: { executor: 'opencode', tier: 'opencode.reasoning-fast' },
    },
    {
      id: 'codex-unavailable-implement',
      when: { unavailable: 'codex', role: 'implement' },
      use: { executor: 'opencode', tier: 'opencode.workhorse' },
    },
    {
      id: 'codex-unavailable-repair',
      when: { unavailable: 'codex', role: 'repair' },
      use: { executor: 'opencode', tier: 'opencode.workhorse' },
    },
    {
      id: 'codex-unavailable-refactor',
      when: { unavailable: 'codex', taskClass: 'refactor' },
      use: { executor: 'opencode', tier: 'opencode.workhorse' },
    },
    {
      id: 'codex-unavailable-test-generation',
      when: { unavailable: 'codex', taskClass: 'test-generation' },
      use: { executor: 'opencode', tier: 'opencode.workhorse' },
    },
    // The residual row, and reasoning-fast rather than the workhorse on purpose.
    // Whatever reached here was routed to Codex by the primary table, and the
    // primary table sends Codex judgement work; a residual that answered with
    // the workhorse would quietly turn every unclassified judgement stage into
    // volume work at the moment Codex went down — which is the moment nobody is
    // reading the route facts closely.
    {
      id: 'codex-unavailable',
      when: { unavailable: 'codex' },
      use: { executor: 'opencode', tier: 'opencode.reasoning-fast' },
    },
    {
      id: 'opencode-unavailable',
      when: { unavailable: 'opencode' },
      use: { executor: 'codex', tier: 'codex.balanced', effort: 'medium' },
    },
  ],
}
