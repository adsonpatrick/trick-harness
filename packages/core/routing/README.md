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

- **Availability is not consulted yet** — `RoutingContext.degradedExecutors` and `priorRouteFailures` are carried and are not yet acted on. Fallback selection and the executor circuit breaker are the next task; today only an independence conflict reaches the fallback table.
- **A stated reasoning effort is not validated against the tier** — the router passes what policy states. Whether a model advertises that effort is discovered at turn time by the provider.
- **`requiredCapabilities` is unenforced** — the field is recorded but no rule matches on it, so a capability mismatch still surfaces at dispatch through the executor runtime.
