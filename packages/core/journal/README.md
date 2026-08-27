# @trick-harness/journal

The durable workflow journal: the twelve `harness/*` session events a run writes, and the projection that rebuilds the run's state from them.

This is a fork-local package: private to `adsonpatrick/trick-harness`, never published, never carried upstream. See [docs/trick-harness/upstream.md](../../../docs/trick-harness/upstream.md) for the provenance record and divergence ledger.

## Why the log is the state

`projectWorkflow` reads `harness/*` events and nothing else. Nothing the projection cannot see is durable, which is the point: a workflow that resumed from live memory would resume one way after a restart and another way after a compaction, and neither would be reproducible from the record afterwards. Pruning tool results or compacting the conversation therefore cannot remove a finding, a diagnosis, or the evidence a verdict rests on — those live in their own events, not in the transcript that produced them.

## What a payload may hold

Observable facts and bounded evidence references. A model's reasoning is not a fact about the world and does not belong in a log that outlives the run, so `WorkflowJournal` rebuilds every payload field by field from what the event type declares. A caller that hands over a richer object — a stage result still carrying its transcript, a finding with the model's working attached — writes the declared fields and nothing else. Dropping at the boundary is the only place the drop can be guaranteed; a convention about what callers pass is not one.

## Flushing, and what it is for

Most appends ride the session's ordinary buffering. Six do not: a route fallback, a diagnosis, a verdict, a delivery mutation, a blocker, and the terminal state are awaited to durable storage as they happen. Each is a fact a restart would otherwise act against — a push that already happened read as a push about to happen, a lowered verdict with its explanation missing, a repair authorised by a root cause nobody can now read.

## Refusing a log it cannot read

`KNOWN_SESSION_EVENT_TYPES` is generated from every `SessionEventMap` merge in the build, and the persistence read path refuses a log containing a type outside it. A harness assembled without this package's declaration merge therefore fails to reconstruct a session that used one, rather than reading back a run with its findings quietly missing. `projectWorkflow` holds the same line for an unrecognised `harness/*` type, and the package invariant checks both sets agree at startup.

## Usage

```ts
import { WorkflowJournal, projectWorkflow } from '@trick-harness/journal'
import type { EvidenceRef, RouteDecision, WorkflowObjective } from '@trick-harness/contracts'

declare const session: import('@deepseek-ai/dsh-session').Session
declare const store: import('@deepseek-ai/dsh-session').SessionStore
declare const objective: WorkflowObjective
declare const decision: RouteDecision
declare const evidence: readonly EvidenceRef[]

const journal = new WorkflowJournal(session, 'wf-1', () => store.flush(session))
journal.start(objective)
journal.routeDecision({ stageId: 'implement-1', role: 'implement', decision })
await journal.verdict('verify-1', 'verify', 'PASS', 'focused suite green', evidence)

const state = projectWorkflow(session.events, 'wf-1')
```

## Invariant companion

`./invariant` pins the event vocabulary against an independently restated expectation and checks every type this journal writes is one the build's persistence read path knows.

## Known Limitations and Deferred Work

- **The journal enforces no ordering** — nothing here refuses a verdict before a route or a second start for one stage. Sequencing is the workflow runtime's to own; the projection reports open stages and lets the caller decide.
- **`openStages` pairs by stage id alone** — a stage id reused within one workflow pairs the wrong start with the wrong end. Ids are the caller's to keep unique.
- **No retention or size policy** — a long run's findings and evidence accumulate in the session log unbounded, and nothing here trims or summarises them.
