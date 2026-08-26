# Harness V2 Journal and Control Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workflow identity unique per execution and make durable journal state sufficient to stop unsafe replay around mutating executor/capability work.

**Architecture:** Separate logical objective identity from execution identity. Composition generates a unique `workflowId`, the journal keys every event by that id, and the control server exposes/statuses the generated id. Before any mutating stage/capability is dispatched, the journal flushes the durable start facts; capability mutations also expose explicit in-flight/post-mutation facts so restart projection can require world verification.

**Tech Stack:** TypeScript, Vitest, DSH Session events, Node `crypto.randomUUID`, Harness journal/control-server/workflow/composition.

**Spec:** `docs/superpowers/specs/2026-08-26-harness-v2-pr-review-remediation-design.md`

**Requires:** PR #1 executor quiescence and teardown observability plans implemented first; routing runtime remediation may be implemented before or in parallel except where workflow files conflict.

## Global Constraints

- `WorkflowObjective.id` is a logical objective id; `workflowId` identifies one execution attempt.
- Workflow ids are Harness-generated and never reused in one durable Session.
- Restart/status APIs address `workflowId`.
- Mutating work cannot begin unless its start/route facts have been durably flushed.
- Flush failure prevents mutation; it is not converted into a best-effort warning.
- Restart never blindly resumes work that may have mutated the world.
- Durable payloads remain bounded and contain no raw model transcript/private reasoning/secrets.

---

### Task 1: Separate Objective Identity From Workflow Execution Identity

**Files:**
- Modify: `packages/core/journal/src/types.ts`
- Modify: `packages/core/journal/src/index.ts`
- Modify: `packages/core/journal/tests/journal.spec.ts`
- Modify: `packages/core/engineering-workflow/src/types.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Modify: `packages/composition/runtime/src/harness.ts`
- Modify: `packages/composition/runtime/tests/harness.spec.ts`

**Interfaces:**
- `WorkflowOutcome.workflowId` remains the execution id.
- `WorkflowOutcome.objectiveId` remains the logical objective id.
- `HarnessCompositionOptions` gains:

```ts
readonly workflowIdFactory?: () => string
```

Default factory:

```ts
import { randomUUID } from 'node:crypto'
const workflowIdFactory = options.workflowIdFactory ?? randomUUID
```

- [ ] **Step 1: Add RED journal test proving two attempts of the same objective do not share projection**

In `journal.spec.ts` create two `WorkflowJournal` instances with workflow ids `wf-a` and `wf-b`, both with `objective.id === 'obj-1'`. Assert findings/end/routes from `wf-a` never appear in `projectWorkflow(..., 'wf-b')`.

- [ ] **Step 2: Add RED composition test for generated workflow ids**

Inject:

```ts
const ids = ['wf-101', 'wf-102']
workflowIdFactory: () => ids.shift()!
```

Run the same `WorkflowObjective` twice and assert:

```ts
expect(first.workflowId).toBe('wf-101')
expect(second.workflowId).toBe('wf-102')
expect(first.objectiveId).toBe(second.objectiveId)
```

- [ ] **Step 3: Run RED**

```bash
pnpm vitest run packages/core/journal/tests/journal.spec.ts packages/composition/runtime/tests/harness.spec.ts
```

Expected: current composition uses `objective.id` as workflow id, so the second assertion fails.

- [ ] **Step 4: Implement generated ids in `composeHarness.run()`**

Replace construction equivalent to:

```ts
new WorkflowJournal(session, objective.id, flush)
new WorkflowRunner(objective.id, ...)
```

with the generated execution id. Never mutate `objective.id`.

- [ ] **Step 5: Add a duplicate-id defense for injected factories**

Before starting a generated id, check both live run ownership and durable Session projection. If the id already has a recorded objective/start, reject the factory result rather than append a second history.

Use a stable error such as:

```ts
new BundleCompositionError(`workflow id ${JSON.stringify(workflowId)} already exists`)
```

- [ ] **Step 6: Run GREEN and commit**

```bash
pnpm vitest run packages/core/journal/tests/journal.spec.ts packages/core/engineering-workflow/tests/workflow.spec.ts packages/composition/runtime/tests/harness.spec.ts
git add packages/core/journal packages/core/engineering-workflow packages/composition/runtime
git commit -m "fix(trick): separate workflow run and objective identity"
```

---

### Task 2: Make the Control Server Return and Address Harness-Generated Workflow IDs

**Files:**
- Modify: `packages/core/control-server/src/types.ts`
- Modify: `packages/core/control-server/src/index.ts`
- Modify: `packages/core/control-server/tests/server.spec.ts`
- Modify: `packages/composition/runtime/src/harness.ts`
- Modify: `packages/composition/runtime/tests/harness.spec.ts`
- Modify: `packages/core/control-server/README.md`

**Interfaces:**

Replace starter semantics that derive identity from the objective with a returned run handle:

```ts
export interface ControlStartedWorkflow {
  readonly workflowId: string
  readonly outcome: Promise<WorkflowOutcome>
  readonly cancel: (reason: string) => void
}

export type ControlWorkflowStarter = (
  objective: WorkflowObjective,
  options: ControlWorkflowStartOptions,
) => ControlStartedWorkflow
```

If implementation chooses an equivalent narrower interface, it must still return the generated id synchronously before HTTP `POST /workflows` responds.

- [ ] **Step 1: Add RED HTTP test: repeated objective => distinct ids**

POST the same objective twice after the first run completes. Assert both responses are `202`/current success status and return distinct `workflowId` values.

- [ ] **Step 2: Add RED status isolation test**

GET both ids and assert each status contains only that run's stage count/verdict.

- [ ] **Step 3: Add RED cancel-by-generated-id test**

Start a long run, call `POST /workflows/<returned-id>/cancel`, and assert the correct owned runner aborts.

- [ ] **Step 4: Implement live map keyed by generated `workflowId`**

Do not accept caller-provided workflow ids in the public body. The caller supplies objective + bounded run options; the Harness supplies identity.

- [ ] **Step 5: Preserve restart semantics**

After process restart, `GET /workflows/:id` uses durable projection for that exact execution id. Completed ids remain queryable even though they are absent from the live map.

- [ ] **Step 6: Run GREEN and commit**

```bash
pnpm vitest run packages/core/control-server/tests/server.spec.ts packages/composition/runtime/tests/harness.spec.ts
git add packages/core/control-server packages/composition/runtime
git commit -m "fix(trick): key control workflows by generated run id"
```

---

### Task 3: Add a Durable Start Barrier Before Executor Mutation

**Files:**
- Modify: `packages/core/journal/src/index.ts`
- Modify: `packages/core/journal/src/types.ts` only if signatures need an explicit barrier result.
- Modify: `packages/core/journal/tests/journal.spec.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`

**Interfaces:**

Introduce one async journal API that appends route/start facts and guarantees they are flushed before return. Example contract:

```ts
async beginExecutor(input: {
  readonly stageId: string
  readonly role: Role
  readonly decision: RouteDecision
}): Promise<void>
```

`beginExecutor()` must:

```text
append route decision when required
append executor start
await flush(session)
throw JournalError if flush fails
```

Do not dispatch the provider until it resolves successfully.

- [ ] **Step 1: Add RED ordering test using a deferred flush**

In `workflow.spec.ts`, make `flush` return a Promise controlled by the test and provider `start` a spy.

```ts
const gate = deferred<boolean>()
flush.mockReturnValueOnce(gate.promise)
const running = runner.run(...)
await Promise.resolve()
expect(providerStart).not.toHaveBeenCalled()
gate.resolve(true)
await running
expect(providerStart).toHaveBeenCalled()
```

Use a mutating `implement` stage.

- [ ] **Step 2: Add RED flush-failure test**

Return `false` or reject according to the existing `JournalFlush` contract. Assert no provider starts and the workflow returns/throws a bounded terminal journal failure rather than mutating.

- [ ] **Step 3: Implement `beginExecutor()` and await it in dispatch**

The old sync sequence:

```ts
journal.routeDecision(...)
journal.executorStart(...)
await executors.start(...)
```

must no longer exist for a mutating stage.

- [ ] **Step 4: Decide one consistent policy for read-only stages**

Recommended: use the same durable barrier for all executor starts. It simplifies restart semantics and avoids a branch where role classification itself becomes a durability risk.

- [ ] **Step 5: Run GREEN and commit**

```bash
pnpm vitest run packages/core/journal/tests/journal.spec.ts packages/core/engineering-workflow/tests/workflow.spec.ts
git add packages/core/journal packages/core/engineering-workflow
git commit -m "fix(trick): persist stage start before executor dispatch"
```

---

### Task 4: Represent Capability Work Explicitly in the Durable Journal

**Files:**
- Modify: `packages/core/journal/src/types.ts`
- Modify: `packages/core/journal/src/index.ts`
- Modify: `packages/core/journal/src/invariant.ts`
- Modify: `packages/core/journal/tests/journal.spec.ts`
- Modify: `packages/core/journal/tests/invariant.spec.ts`
- Modify: DSH Session event declaration/augmentation file in this package if event types are declared inline in `index.ts`.

**Interfaces:**

Add explicit event types:

```text
harness/capability-start
harness/capability-end
```

Payloads:

```ts
interface CapabilityStartEvent {
  readonly workflowId: string
  readonly stageId: string
  readonly capability: 'github-delivery' | 'supabase-preview' | string
  readonly mutationPossible: boolean
}

interface CapabilityEndEvent {
  readonly workflowId: string
  readonly stageId: string
  readonly capability: string
  readonly status: 'completed' | 'aborted' | 'error'
  readonly durationMs: number
  readonly failureClass?: string
}
```

Journal API:

```ts
beginCapability(...): Promise<void> // append + durable flush
endCapability(...): Promise<void>
```

Projection gains:

```ts
readonly openCapabilities: readonly string[]
```

- [ ] **Step 1: Add RED event-vocabulary serialization/replay tests**

Assert both event types are in `KNOWN_SESSION_EVENT_TYPES` and survive prune/replay like existing Harness events.

- [ ] **Step 2: Add RED restart test**

Write `capability-start` with no end and assert:

```ts
expect(assessRestart(projectWorkflow(...)).requiresWorldVerification).toBe(true)
```

- [ ] **Step 3: Add RED unknown-event fail-closed test**

Preserve the invariant that an unrecognized `harness/*` event aborts reconstruction rather than silently dropping facts.

- [ ] **Step 4: Implement append/parsers/projector support**

Do not store command stdout, connection strings, tokens or model text.

- [ ] **Step 5: Run journal tests GREEN and commit**

```bash
pnpm vitest run packages/core/journal/tests/journal.spec.ts packages/core/journal/tests/invariant.spec.ts
git add packages/core/journal
git commit -m "feat(trick): journal deterministic capability lifecycle"
```

---

### Task 5: Make Restart Assessment Conservative Around Mutation Windows

**Files:**
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/src/types.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Modify: `packages/core/control-server/src/index.ts`
- Modify: `packages/core/control-server/tests/server.spec.ts`

**Interfaces:**
- Consumes: projection `openStages`, `openCapabilities`, delivery mutation records.
- Produces: `RestartAssessment.requiresWorldVerification === true` whenever mutation authority may have been granted without a fully confirmed terminal state.

- [ ] **Step 1: Add RED matrix for restart states**

Cover:

```text
completed read-only workflow -> false
open read-only executor -> true (conservative)
open mutating executor -> true
open GitHub capability -> true
open Supabase capability -> true
recorded commit/push/preview-branch mutation with no workflow end -> true
completed terminal workflow -> false
```

- [ ] **Step 2: Implement assessment using durable projection only**

Do not infer from in-memory runner state on restart.

- [ ] **Step 3: Ensure control status surfaces `requiresWorldVerification`**

Bounded status must not expose raw event payloads.

- [ ] **Step 4: Run focused tests GREEN**

```bash
pnpm vitest run packages/core/engineering-workflow/tests/workflow.spec.ts packages/core/control-server/tests/server.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/engineering-workflow packages/core/control-server
git commit -m "fix(trick): require world check after interrupted mutation"
```

---

### Task 6: Verify Identity and Durability Across Real Composition

**Files:**
- Modify: `packages/composition/runtime/tests/harness.spec.ts`
- Modify: `packages/composition/runtime/README.md`
- Modify: `packages/core/journal/README.md`
- Modify: `packages/core/control-server/README.md`

- [ ] **Step 1: Add composed restart test with two attempts of one objective**

Prove the Session contains two independent workflow projections.

- [ ] **Step 2: Add composed mutation-barrier failure test**

Inject a flush failure before an implementation stage and assert zero provider starts.

- [ ] **Step 3: Add composed interrupted-capability projection test**

Use a fake capability that begins then simulates process loss before end; reconstruct from Session and assert world verification is required.

- [ ] **Step 4: Run package and repository gates**

```bash
pnpm vitest run packages/core/journal packages/core/control-server packages/core/engineering-workflow packages/composition/runtime
pnpm typecheck
pnpm lint
pnpm build
```

Then run root constraint/doc-sync gates documented by the repository.

- [ ] **Step 5: Independent review gate**

Reviewer must prove from code/tests:

```text
objective id != execution id
run id cannot be reused
pre-mutation flush is awaited
flush failure prevents dispatch
open capability survives replay
restart requires world verification where mutation may have happened
```

- [ ] **Step 6: Commit docs/test completion**

```bash
git add packages/core/journal packages/core/control-server packages/composition/runtime
git commit -m "test(trick): prove durable run identity and restart safety"
```
