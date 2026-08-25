# @trick-harness/profile

The seam between reusable mechanism and project policy. Core packages own how the harness works; a `HarnessProfile` owns what one project has decided. This package defines that contract and the registry that refuses to hold an invalid profile.

This is a fork-local package: private to `adsonpatrick/trick-harness`, never published, never carried upstream. See [docs/trick-harness/upstream.md](../../../docs/trick-harness/upstream.md) for the provenance record and divergence ledger.

## Why a profile is data, not code

Every policy block is a flat, declarative table. A profile cannot ship a matcher function or a decision hook, because a reviewer must be able to read a policy diff and know exactly what changed without also reasoning about what the new code does at runtime. It is also what keeps the trusted workflow state machine out of a profile's reach: policy selects among behaviors core already implements, and cannot introduce a new one.

## What validation guarantees

`validateProfile` runs at registration rather than at lookup, so a malformed policy table fails where it was introduced instead of surfacing inside a routing decision. It enforces:

- `id` is lowercase kebab-case and `policyVersion` matches `<name>-v<major>.<minor>.<patch>`, because both are recorded in durable workflow facts and must stay machine-comparable.
- All seven policy blocks are present, even when empty. An absent block reads as "never considered"; an empty one reads as "considered, and the answer is none".
- `workflowPolicy` bounds are positive integers, so a repair loop terminates rather than running until quota is exhausted.
- `independencePolicy` matches the required review independence at each risk level exactly. A profile cannot downgrade high-risk work to same-executor review.
- Rule ids are unique within their list, so a route decision attributes to exactly one rule.

Registered profiles are deep-frozen copies, so a holder cannot edit live policy after the fact.

## Usage

```ts
import { createProfileRegistry } from '@trick-harness/profile'
import type { HarnessProfile } from '@trick-harness/profile'

declare const pluroraProfile: HarnessProfile

const registry = createProfileRegistry()
const registration = registry.register(pluroraProfile)
const profile = registry.get('plurora')
registration.dispose()
```

Inside a Cordis runtime the same registry is available as `ctx.profiles` via the `ProfileRegistry` service.

## Invariant companion

`./invariant` re-checks the profiles a runtime holds: it catches a profile mutated in place after registration, and two profiles that are individually valid while colliding on the policy version that route decisions are attributed to.

## Known Limitations and Deferred Work

- **Validation is structural, not semantic** — the registry proves a profile declares every required block and that its independence tiers match the contract. It cannot tell whether a routing rule names a tier some executor can actually serve; that mismatch surfaces at dispatch.
- **Rule evaluation lives with the consumer** — profiles carry flat `{id, when, use}` tables as declarative data. This package validates and stores them and deliberately does not interpret `when`, so precedence and matching semantics belong to whichever capability reads the table.
- **A registered profile is frozen, not versioned** — registration deep-clones and freezes the profile, so later edits to the source object are ignored rather than rejected. There is no migration path between `policyVersion` values.
- **One registry, no composition** — profiles cannot extend or override one another; a variant restates the blocks it needs.
