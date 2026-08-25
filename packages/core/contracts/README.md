# @trick-harness/contracts

The vocabulary the engineering workflow speaks, and the parsers that read it back across a durable boundary. Roles, risk and workload classes, verdicts, the finding taxonomy, the diagnosis contract, and the routing context and decision all live here so that routing, the workflow state machine, the journal, and every stage agree on the same words.

This is a fork-local package: private to `adsonpatrick/trick-harness`, never published, never carried upstream. See [docs/trick-harness/upstream.md](../../../docs/trick-harness/upstream.md) for the provenance record and divergence ledger.

## Why the vocabulary is a value before it is a type

Every enumeration is a frozen array first and a union type second. The array is what a parser validates against and what a test enumerates, so a value cannot be added to the type alone and quietly skip both. These names are written into durable session events and read back by a later process, which is also why they are strings a human can read in a log rather than numbers.

## What the parsers guarantee

A type is a compile-time claim, and every value here crosses a runtime boundary at least once — written to an event, read back after a restart, or produced by a model that was asked for a shape. `parseFinding`, `parseDiagnosisContract`, `parseRouteDecision`, `parseStageResult`, and `parseWorkflowObjective` are where that claim becomes true, and each enforces two properties beyond the obvious field checks:

- **Undeclared fields do not survive.** A parser rebuilds the value from the fields the contract declares, so a transcript, a reasoning dump, or whatever else a producer attached is dropped rather than persisted. Durable state holds observable facts, not a model's private chain of thought.
- **A rejection names the path, never the value.** `ContractError` carries `path` as data — `finding.evidence[1].kind` — and the message states what the field must be without quoting what it was. These errors are themselves logged, and a field that can hold anything can hold a secret.

Two field-level rules are worth naming because they look like strictness and are not. `DiagnosisContract.unknowns` is required even when empty, because an empty list is a debugger stating that nothing is left unexplained while an absent one is a debugger that never addressed the question. And `RouteDecision` requires both a non-empty `reasonCodes` and a `policyVersion`, because a route that cannot say why it was chosen or under which policy is unauditable the moment that policy changes — and routing policy changes far more often than routing mechanism.

## The separations the vocabulary encodes

`READ_ONLY_ROLES` lists every role that may never mutate a workspace. Read-only is a property of the role rather than of the run: a debugger that could edit would blur diagnosis into repair, and a reviewer that could edit would be reviewing its own work. Repair is a separate stage with its own run.

`AUTO_REPAIRABLE_FINDINGS` answers the one question the finding taxonomy exists for. Membership is necessary and not sufficient — a `BUG` still has to be confirmed and a `SECURITY_BUG` still has to be specified well enough to fix — but everything outside it is reported and left alone, because deciding a `PRODUCT_DECISION` would be inventing product behavior rather than fixing a defect.

`INCONCLUSIVE` and `BLOCKED` are distinct verdicts on purpose. Inconclusive means the work could not be judged; blocked means it was judged and cannot proceed without a decision only a person can make. Collapsing them would turn "nobody knows" into "somebody decided".

## Usage

```ts
import { parseRouteDecision, READ_ONLY_ROLES } from '@trick-harness/contracts'
import type { RouteDecision, Role } from '@trick-harness/contracts'

declare const stored: unknown
const decision: RouteDecision = parseRouteDecision(stored)

declare const role: Role
const mayWrite = !READ_ONLY_ROLES.includes(role)
```

## Invariant companion

`./invariant` pins each shipped vocabulary against an independently restated expectation, and checks that no writing role has been listed as read-only. An invariant that read its expectation from the value under test would agree with any change; restating means a genuine vocabulary change has to be made twice, on purpose, giving every consumer that switches on a value a deliberate moment to catch up.

## Known Limitations and Deferred Work

- **Validation is structural, not semantic** — a parser proves a diagnosis has a reproduction and a regression seam; it cannot tell whether the reproduction actually reproduces or the seam exists. Those are a reviewer's judgement.
- **No versioning or migration** — the parsers read the current shape. An event written under an earlier vocabulary is rejected rather than migrated, and there is no schema version on the wire yet.
- **Field paths assume a default root** — each parser takes an optional path prefix; a caller embedding a contract in a larger structure must pass one or the reported path will read as though the contract were the whole document.
