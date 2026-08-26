# @trick-harness/routing

Deterministic executor routing. `route(context, policy)` turns one `RoutingContext` into one `RouteDecision`: which executor runs the stage, which semantic tier it runs at, which model that tier resolves to, and what filesystem authority the run gets.

This is a fork-local package: private to `adsonpatrick/trick-harness`, never published, never carried upstream. See [docs/trick-harness/upstream.md](../../../docs/trick-harness/upstream.md) for the provenance record and divergence ledger.

## Why routing is a pure function

`route` starts no process, contacts no product, and records nothing. A model may classify an ambiguous task and its classification may reach the context, but the route itself is a versioned policy decision — reproducible from the same inputs and explainable afterwards from `reasonCodes` and `policyVersion` alone. A router that consulted a product would make the same run route differently on a bad afternoon, and a durable route fact that cannot be re-derived is not evidence of anything.

## Semantic tiers, and the one place model ids live

A policy table names `codex.frontier`, never a model id. `ModelRegistry` resolves the tier, and `DEFAULT_MODEL_REGISTRY` ships the aliases this repository knows as of 2026-08-25. Which model serves `frontier` is a fact about the product rather than a choice one project makes, so a model generation change is one edit here instead of a rewrite across every project's policy — and a deployment that disagrees passes its own registry without touching a workflow.

## What the router decides and what it refuses

- **First match wins, in table order.** Specificity is the profile author's ordering decision, visible in the diff. Scoring specificity here would route runs by a ranking rule nobody can see.
- **A `when` key outside the closed fact set is rejected.** A rule matching on a fact nobody supplies would never fire, and a rule that never fires is indistinguishable from one that always agrees — the policy would look like it covered a case it silently did not.
- **Permission mode is derived from the role, never granted by policy.** Read-only is a property of the role: a reviewer that could edit would be reviewing its own work, and a debugger that could edit would have turned diagnosis into repair. A row asking for write authority on such a role is refused rather than quietly honoured or quietly downgraded.
- **An override wins for exactly one run.** It still resolves through the registry, so it cannot attribute a run to a model the deployment does not serve, and it still cannot raise a read-only role's authority.
- **Missing independence is recorded, not fatal.** When a certifying stage would land on the executor that did the work, the router looks for an alternative in the same table and then in the fallback table. If none exists it records `independence:unsatisfied` and returns the route anyway — refusing would turn a missing second opinion into an outage, and hiding it would turn one into a false PASS. The workflow decides which it is.

## Availability is not quality

An executor that could not run is an availability problem and may be routed around. An executor that ran and was wrong is a quality problem and may not: routing around a failed verification would retry the same task on a second product and then report the second opinion as a recovery. `classifyFailure` therefore works from two closed sets — `AVAILABILITY_FAILURES` and `QUALITY_FAILURES` — and refuses a category outside both rather than defaulting either way, because guessing "availability" launders an unknown failure into a fallback and guessing "quality" hides a real outage behind an escalation.

The circuit breaker is `AVAILABLE -> DEGRADED -> AVAILABLE` and nothing else. An availability failure degrades an executor once; further failures while degraded add no second transition, so the durable record does not read as repeated outages. Recovery is never inferred from the clock: a cooldown only makes a bounded probe permissible, and only a probe that actually succeeded — or an explicit human refresh — clears the circuit. When the probe budget is spent the breaker stops and waits for a person, because it does not know when a quota window resets and must not pretend to.

Falling back is recorded, not hidden. The decision carries `fallbackFrom` and a `fallback:<executor>` reason code, and `capVerdict` lowers a `PASS` that a weakened route cannot support: a critical security stage reached over a fallback returns `BLOCKED`, a high or critical stage returns `PARTIAL`. Only `PASS` is capped — a `FAIL` on a fallback route is still a `FAIL`.

## Usage

```ts
import { DEFAULT_MODEL_REGISTRY, route } from '@trick-harness/routing'
import type { RoutingContext } from '@trick-harness/contracts'
import type { HarnessProfile } from '@trick-harness/profile'

declare const profile: HarnessProfile
declare const context: RoutingContext

const decision = route(context, {
  policyVersion: profile.policyVersion,
  rules: profile.routingPolicy.rules,
  fallbackRules: profile.routingPolicy.fallbackRules,
  registry: DEFAULT_MODEL_REGISTRY,
})
```

## Invariant companion

`./invariant` pins the shipped tier registry and the matchable-fact set against independently restated expectations, so a tier dropped from the registry fails at startup rather than at whichever dispatch happened to ask for it.

## Known Limitations and Deferred Work

- **`priorRouteFailures` is carried and not acted on** — degradation is expressed through `degradedExecutors`, which the caller derives from the circuits it holds. A per-attempt failure history does not yet influence rule selection.
- **The breaker holds no state of its own** — every function here is pure, so the circuits live with whoever calls them. Until the workflow journal exists, a restarted process starts every executor `AVAILABLE` again and rediscovers an outage by hitting it.
- **The probe/cooldown policy is a parameter, not a profile field** — `CircuitPolicy` is supplied per call and `DEFAULT_CIRCUIT_POLICY` is what this repository ships. `HarnessProfile` does not yet carry one, so a project cannot state its own backoff declaratively.
- **A stated reasoning effort is not validated against the tier** — the router passes what policy states. Whether a model advertises that effort is discovered at turn time by the provider.
- **`requiredCapabilities` is unenforced** — the field is recorded but no rule matches on it, so a capability mismatch still surfaces at dispatch through the executor runtime.
