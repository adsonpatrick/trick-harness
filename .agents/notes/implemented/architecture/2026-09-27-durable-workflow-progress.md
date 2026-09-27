# Agent Note: Durable workflow progress from journal events

Status: implemented

English | [中文](2026-09-27-durable-workflow-progress.zh.md)

## Problem

The control server's live status began as a static `running` response with no stages, and restart status carried no stage details. Operators could not locate an active or interrupted workflow without reading private execution output.

## Decision

`WorkflowJournal` records the host session id with workflow admission. `projectWorkflow` derives the active stage, role, executor, attempt ordinal, executor-run id, last event time, failure code, and constraint class from durable events. The composition layer reprojects those events on every live poll and includes completed stage summaries in the bounded status. Restart assessments carry the same projection. The control server copies only declared status fields and drops arbitrary additions.

## Alternatives considered

**Mutable progress held by the live runner** would disappear at process replacement and could disagree with the durable event stream.

**Rendering provider transcripts or command output** would expose unbounded, potentially sensitive text and is unnecessary for locating workflow progress.

**Adding an orchestration framework** would replace the existing journal and workflow semantics instead of extending their durable projection.

## Consequences

- Live and restarted status use the same durable event facts.
- `executorRunId` combines the host session id with the session event sequence; `attemptId` combines workflow, stage, and that stage's ordinal.
- Older workflow-start events without `hostRunId` remain readable and use a bounded fallback only for derived executor-run ids.
- Status remains a bounded poll response; it does not expose transcripts, arbitrary event payloads, or evidence contents.

## Testing

Journal tests reconstruct progress from a copied event list and verify constraint-class visibility without provider text. Control-server tests verify live refresh, restart projection, and rejection of undeclared fields.
