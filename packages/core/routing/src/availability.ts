/**
 * Availability classification and the executor circuit breaker.
 *
 * The distinction this module exists for: an executor that could not run is an
 * availability problem and may be routed around; an executor that ran and was
 * wrong is a quality problem and may not. Disguising the second as the first is
 * how a workflow silently converts a failed verification into a successful
 * fallback, so the two vocabularies are closed sets and anything outside them
 * is refused rather than guessed at.
 *
 * @module @trick-harness/routing
 */

import type { RouteDecision, RoutingContext, WorkflowVerdict } from '@trick-harness/contracts'
import { RoutingError } from './types.ts'

/**
 * Failures that mean the executor could not serve the run.
 *
 * A quota ceiling, a session budget, an overloaded or erroring server, and a
 * transport that never carried the request. Every one is a statement about the
 * product's ability to answer, not about the answer.
 *
 * The names are the ones providers normalize onto, and there is exactly one
 * name per concept. An earlier version of this set carried near-synonyms —
 * `rate-limit` beside `usage-limit-exceeded`, `transient-infra` beside the
 * transport faults — which let the same outage be reported under two spellings
 * depending on which provider saw it, and made the circuit-breaker history
 * unreadable across executors.
 */
export const AVAILABILITY_FAILURES = [
  'usage-limit-exceeded',
  'session-budget-exceeded',
  'server-overloaded',
  'internal-server-error',
  'transport-unavailable',
] as const

/**
 * Failures that mean the executor served the run and the result was unusable.
 *
 * A context window overrun, a malformed request, a sandbox denial, a refusal on
 * cyber policy, a wrong answer, and a failed verification are all outcomes of a
 * turn that happened. Routing around them would retry the same task on a second
 * product and call the second opinion a recovery.
 */
export const QUALITY_FAILURES = [
  'context-window-exceeded',
  'bad-request',
  'sandbox-denied',
  'cyber-policy-refusal',
  'unauthorized',
  'wrong-answer',
  'failed-verification',
  // `other` is what a provider emits when it recognised the failure as real but
  // not as anything in this vocabulary. It sits here rather than being left
  // unclassified because the two are different statements: the classifier
  // refuses to guess, while a provider saying `other` has already decided that
  // an unrecognised fault is not grounds to send the work somewhere else.
  'other',
] as const

/**
 * Failures that say the executor cannot serve *any* run until a human acts.
 *
 * These are not availability failures and must never reroute the attempt that
 * hit one — an `unauthorized` run stops, it does not get a second opinion from
 * another product. What they additionally mean is narrower and separate: this
 * executor has nothing to offer the rest of the workflow either, so leaving it
 * in the candidate pool would send the next stage into the same wall and report
 * the wall as a stage failure rather than as a missing credential.
 *
 * The list is deliberately not "everything that failed twice". An account that
 * is not authorised is a fact about the product's configuration, knowable from
 * one answer; a wrong answer is not.
 */
export const DISABLING_FAILURES = ['unauthorized'] as const

/**
 * Whether a failure removes its executor from further consideration.
 * @param failure - The category the executor runtime reported.
 * @returns True when no later stage should be routed to that executor.
 * @throws {RoutingError} when the category is outside both closed sets.
 */
export function disablesExecutor(failure: string): boolean {
  classifyFailure(failure)
  return (DISABLING_FAILURES as readonly string[]).includes(failure)
}

/** One recognised failure category. */
export type FailureClass = typeof AVAILABILITY_FAILURES[number] | typeof QUALITY_FAILURES[number]

/** Whether a failure is about the product's ability to answer, or the answer. */
export type FailureNature = 'availability' | 'quality'

/** The two circuit states an executor is ever in. */
export const CIRCUIT_STATES = ['AVAILABLE', 'DEGRADED'] as const

/** One circuit state. */
export type CircuitState = typeof CIRCUIT_STATES[number]

/** How long to wait before probing a degraded executor, and how often to try. */
export interface CircuitPolicy {
  /** Milliseconds after the last failure before an automatic probe is allowed. */
  readonly cooldownMs: number
  /** Automatic probes allowed per degradation before only a manual refresh recovers it. */
  readonly maxProbes: number
}

/** What the breaker knows about one executor. */
export interface ExecutorCircuit {
  readonly executor: string
  readonly state: CircuitState
  /** When the current state was entered, as epoch milliseconds. */
  readonly since: number
  /** The availability failure that degraded it, absent while available. */
  readonly failureClass?: FailureClass
  /** Automatic probes spent since degrading. */
  readonly probes: number
}

/** One observable state change, for the durable record. */
export interface CircuitTransition {
  readonly executor: string
  readonly from: CircuitState
  readonly to: CircuitState
  /** Machine-readable cause, e.g. `failure:usage-limit-exceeded` or `manual-refresh`. */
  readonly reason: string
  readonly at: number
}

/** A circuit after one observation, with whatever it changed. */
export interface CircuitOutcome {
  readonly circuit: ExecutorCircuit
  readonly transitions: readonly CircuitTransition[]
}

/** The default breaker policy: back off for a minute, probe twice, then ask a human. */
export const DEFAULT_CIRCUIT_POLICY: CircuitPolicy = Object.freeze({ cooldownMs: 60_000, maxProbes: 2 })

/**
 * Classify one failure category.
 * @param failure - The category the executor runtime reported.
 * @returns Whether it may be routed around.
 * @throws {RoutingError} when the category is outside both closed sets.
 */
export function classifyFailure(failure: string): FailureNature {
  if ((AVAILABILITY_FAILURES as readonly string[]).includes(failure)) return 'availability'
  if ((QUALITY_FAILURES as readonly string[]).includes(failure)) return 'quality'
  // Defaulting either way is worse than refusing: guessing "availability"
  // launders an unknown failure into a fallback, and guessing "quality" hides a
  // real outage behind an escalation.
  throw new RoutingError('unknown-failure', `failure category ${JSON.stringify(failure)} is not classified`)
}

/**
 * Whether a failure category may trigger a fallback route.
 * @param failure - The category the executor runtime reported.
 * @returns True when the executor could not serve the run.
 * @throws {RoutingError} when the category is outside both closed sets.
 */
export function isAvailabilityFailure(failure: string): boolean {
  return classifyFailure(failure) === 'availability'
}

/**
 * The circuit an executor starts in.
 * @param executor - The executor id.
 * @param now - Epoch milliseconds.
 * @returns An available circuit with no probes spent.
 */
export function openCircuit(executor: string, now: number): ExecutorCircuit {
  return Object.freeze({ executor, state: 'AVAILABLE' as const, since: now, probes: 0 })
}

/** Build one transition record. */
function transition(
  circuit: ExecutorCircuit,
  to: CircuitState,
  reason: string,
  at: number,
): CircuitTransition {
  return Object.freeze({ executor: circuit.executor, from: circuit.state, to, reason, at })
}

/**
 * Record a failure against an executor's circuit.
 *
 * A quality failure changes nothing here — it is the workflow's escalation to
 * handle, and degrading an executor for being wrong would route the next run to
 * a product that was never asked.
 * @param circuit - The circuit before the failure.
 * @param failure - The reported failure category.
 * @param now - Epoch milliseconds.
 * @returns The circuit afterwards and any transition it made.
 * @throws {RoutingError} when the category is unclassified.
 */
export function recordFailure(circuit: ExecutorCircuit, failure: string, now: number): CircuitOutcome {
  if (classifyFailure(failure) === 'quality') {
    return Object.freeze({ circuit, transitions: Object.freeze([]) })
  }
  const failureClass = failure as FailureClass
  const degraded: ExecutorCircuit = Object.freeze({
    executor: circuit.executor,
    state: 'DEGRADED' as const,
    since: now,
    failureClass,
    probes: circuit.probes,
  })
  if (circuit.state === 'DEGRADED') {
    return Object.freeze({ circuit: degraded, transitions: Object.freeze([]) })
  }
  return Object.freeze({
    circuit: degraded,
    transitions: Object.freeze([transition(circuit, 'DEGRADED', `failure:${failureClass}`, now)]),
  })
}

/**
 * Record that the executor served a run.
 * @param circuit - The circuit before the success.
 * @param now - Epoch milliseconds.
 * @returns The circuit afterwards and any transition it made.
 */
export function recordSuccess(circuit: ExecutorCircuit, now: number): CircuitOutcome {
  if (circuit.state === 'AVAILABLE') return Object.freeze({ circuit, transitions: Object.freeze([]) })
  return Object.freeze({
    circuit: openCircuit(circuit.executor, now),
    transitions: Object.freeze([transition(circuit, 'AVAILABLE', 'probe-succeeded', now)]),
  })
}

/**
 * Spend one bounded probe against a degraded executor.
 *
 * Recovery is never assumed from the clock alone: a cooldown makes a probe
 * permissible, and only a probe that actually succeeds clears the circuit. The
 * probe budget is what stops a long outage from becoming a retry loop against a
 * product that is already refusing.
 * @param circuit - The circuit to probe.
 * @param policy - Cooldown and probe budget.
 * @param now - Epoch milliseconds.
 * @returns Whether the run may proceed, and the circuit with the probe spent.
 */
export function tryProbe(
  circuit: ExecutorCircuit,
  policy: CircuitPolicy,
  now: number,
): { readonly allowed: boolean; readonly circuit: ExecutorCircuit } {
  if (circuit.state === 'AVAILABLE') return { allowed: true, circuit }
  if (now - circuit.since < policy.cooldownMs || circuit.probes >= policy.maxProbes) {
    return { allowed: false, circuit }
  }
  return {
    allowed: true,
    circuit: Object.freeze({ ...circuit, since: now, probes: circuit.probes + 1 }),
  }
}

/**
 * Clear a circuit because a human said so.
 *
 * The explicit path exists because the breaker does not know when a quota
 * window resets and must not pretend to. Guessing a reset time either wastes
 * the probe budget early or strands a recovered executor for the rest of a run.
 * @param circuit - The circuit to clear.
 * @param now - Epoch milliseconds.
 * @returns The cleared circuit and its transition.
 */
export function refreshCircuit(circuit: ExecutorCircuit, now: number): CircuitOutcome {
  if (circuit.state === 'AVAILABLE') return Object.freeze({ circuit, transitions: Object.freeze([]) })
  return Object.freeze({
    circuit: openCircuit(circuit.executor, now),
    transitions: Object.freeze([transition(circuit, 'AVAILABLE', 'manual-refresh', now)]),
  })
}

/**
 * The executors a routing context should be told are degraded.
 * @param circuits - Every circuit the run knows about.
 * @returns The degraded executor ids, in the order given.
 */
export function degradedExecutors(circuits: readonly ExecutorCircuit[]): readonly string[] {
  return circuits.filter(circuit => circuit.state === 'DEGRADED').map(circuit => circuit.executor)
}

/** Whether a decision was reached by routing around a degraded executor. */
function isFallback(decision: RouteDecision): boolean {
  return decision.fallbackFrom !== undefined
}

/**
 * Lower a certifying stage's verdict to the assurance its route can support.
 *
 * A fallback route is a weaker route: the reviewer the risk level called for
 * was not available, and at critical risk a security assurance that nobody
 * qualified gave is not an assurance at all. Only `PASS` is capped — a `FAIL`
 * reached on a fallback route is still a `FAIL`, and softening it would be the
 * same laundering in the other direction.
 * @param verdict - The verdict the stage reached.
 * @param context - The run that was routed.
 * @param decision - The route it actually ran on.
 * @returns The verdict the evidence supports.
 */
export function capVerdict(
  verdict: WorkflowVerdict,
  context: RoutingContext,
  decision: RouteDecision,
): WorkflowVerdict {
  if (verdict !== 'PASS') return verdict
  const weakened = isFallback(decision) || decision.reasonCodes.includes('independence:unsatisfied')
  if (!weakened) return verdict
  if (context.role === 'security' && context.risk === 'critical') return 'BLOCKED'
  if (context.risk === 'critical' || context.risk === 'high') return 'PARTIAL'
  return verdict
}
