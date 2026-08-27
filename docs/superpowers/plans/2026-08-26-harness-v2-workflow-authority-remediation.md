# Harness V2 Workflow Authority Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the workflow use deterministic mutation capabilities, enforce profile identity and security-repair authority, and make the default lifecycle match the approved PR-centric certification loop.

**Architecture:** `WorkflowRunner` remains lifecycle owner but no longer treats every stage as an LLM executor dispatch. `delivery` and required database validation are capability-backed through narrow ports supplied by composition. Profile identity is validated before journal start. Security repair has a deterministic policy gate. The default lifecycle publishes verified work before independent review/QA/security and repeats certification after every repair until final verification.

**Tech Stack:** TypeScript, Vitest, Trick Harness workflow/contracts/profile/composition, GitHubDelivery, SupabasePreview, DSH journal.

**Spec:** `docs/superpowers/specs/2026-08-26-harness-v2-pr-review-remediation-design.md`

**Requires:** routing runtime remediation, journal/control remediation, integration safety remediation, PR #1 profile validation, and PR #1 boundary-analysis corrections completed first.

## Global Constraints

- `objective.profileId` must equal the composed profile id before journal start, executor start, or capability mutation.
- GitHub delivery is capability-backed; no model executor receives generic shell authority as a substitute.
- Database-changing workflows require Supabase Preview and block if it is unavailable.
- SECURITY_BUG auto-repair requires deterministic policy authorization in addition to diagnosis/evidence.
- Product/design decisions remain BLOCKED and are never auto-fixed.
- Default lifecycle is PR-centric: verify -> deliver -> fresh certification -> bounded repair/re-delivery -> final fresh verification.
- Merge/release/deploy remain outside automatic authority.
- No PASS/PR READY with a confirmed material bug or unmet required capability.

---

### Task 1: Bind Workflow Objective to the Composed Profile

**Files:**
- Modify: `packages/composition/runtime/src/harness.ts`
- Modify: `packages/composition/runtime/tests/harness.spec.ts`
- Modify: `packages/core/control-server/tests/server.spec.ts`
- Modify: `packages/composition/runtime/README.md`

**Interfaces:**

Add a preflight assertion before `WorkflowJournal`/`WorkflowRunner` construction:

```text
function assertObjectiveProfile(objective: WorkflowObjective, profile: HarnessProfile): void {
  if (objective.profileId !== profile.id) {
    throw new BundleCompositionError(
      `objective profile ${JSON.stringify(objective.profileId)} does not match composed profile ${JSON.stringify(profile.id)}`,
    )
  }
}
```

- [x] **Step 1: Add RED mismatch test**

Compose Plurora profile and pass `profileId: 'other'`:

```text
await expect(harness.run(objective)).rejects.toThrow(BundleCompositionError)
expect(providerStart).not.toHaveBeenCalled()
expect(session.events.some(event => event.type === 'harness/workflow-start')).toBe(false)
```

- [x] **Step 2: Add matching-profile control test**

The same objective with `profileId: pluroraProfile.id` proceeds normally.

- [x] **Step 3: Implement preflight validation before run-id generation/journal mutation**

Invalid profile identity starts zero external or durable work.

- [x] **Step 4: Run GREEN and commit**

```bash
pnpm vitest run packages/composition/runtime/tests/harness.spec.ts packages/core/control-server/tests/server.spec.ts
git add packages/composition/runtime packages/core/control-server/tests/server.spec.ts
git commit -m "fix(trick): bind workflow objective to composed profile"
```

---

### Task 2: Add Explicit Workflow Capability Ports and Move Delivery Off Executors

**Files:**
- Modify: `packages/core/engineering-workflow/src/types.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Modify: `packages/composition/runtime/src/harness.ts`
- Modify: `packages/composition/runtime/tests/harness.spec.ts`
- Modify: `packages/core/engineering-workflow/README.md`

**Interfaces:**

Define narrow core-owned ports:

```text
export interface DeliveryCapabilityPort {
  deliver(input: WorkflowDeliveryInput, signal: AbortSignal): Promise<WorkflowDeliveryResult>
}

export interface DatabasePreviewCapabilityPort {
  verify(input: WorkflowDatabasePreviewInput, signal: AbortSignal): Promise<WorkflowDatabasePreviewResult>
}

export interface WorkflowCapabilities {
  readonly delivery?: DeliveryCapabilityPort
  readonly databasePreview?: DatabasePreviewCapabilityPort
}
```

Concrete integration classes are adapted by composition; workflow core does not import their implementation classes.

- [x] **Step 1: Add RED delivery-authority test**

Supply a fake delivery capability and executor providers for implementation/verification. Assert:

```text
expect(deliveryCapability.deliver).toHaveBeenCalledOnce()
expect(executorStart).not.toHaveBeenCalledWith(expect.objectContaining({
  task: expect.stringContaining('delivery'),
}))
```

- [x] **Step 2: Add RED missing-delivery-capability test**

A lifecycle that requires delivery with no `capabilities.delivery` returns BLOCKED before any shell/git substitute is attempted.

- [x] **Step 3: Implement capability-backed delivery dispatch**

`delivery` remains a deterministic lifecycle stage but is not sent to `executors.start()`.

- [x] **Step 4: Integrate journal capability barriers**

Before delivery, await `journal.beginCapability(...)`; after completion/error emit capability end. Wire the concrete GitHub mutation observer to durable `harness/delivery` records.

- [x] **Step 5: Adapt `GitHubDelivery` inside composition**

The adapter converts workflow delivery input to `DeliveryRequest`, passes cancellation, and maps bounded `DeliveryOutcome` back to workflow result.

- [x] **Step 6: Run GREEN and commit**

```bash
pnpm vitest run packages/core/engineering-workflow/tests/workflow.spec.ts packages/composition/runtime/tests/harness.spec.ts
git add packages/core/engineering-workflow packages/composition/runtime
git commit -m "fix(trick): route delivery through deterministic capability"
```

---

### Task 3: Require Supabase Preview for Database-Changing Workflows

**Files:**
- Modify: `packages/core/engineering-workflow/src/types.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Modify: `packages/composition/runtime/src/harness.ts`
- Modify: `packages/composition/runtime/tests/harness.spec.ts`

**Interfaces:**

```ts
export interface WorkflowDatabaseChange {
  readonly required: true
  readonly migrationPaths: readonly string[]
}
```

`WorkflowRunRequest` gains:

```text
readonly databaseChange?: WorkflowDatabaseChange
```

No credentials or connection strings are accepted in this request.

- [x] **Step 1: Add RED missing-preview-capability test**

Set `databaseChange.required === true` with no database capability. Assert BLOCKED, zero delivery calls, and zero executor-based Supabase substitute.

- [x] **Step 2: Add RED preview-failure test**

Fake Preview returns migration/lint failure. Assert delivery never runs and terminal verdict is non-PASS.

- [x] **Step 3: Add RED successful ordering test**

Record calls and assert:

```text
implement -> verify -> supabase-preview -> delivery
```

Independent certification follows delivery in Task 5.

- [x] **Step 4: Implement capability invocation after implementation verification and before delivery**

Use journal capability start/end and mutation observer facts from the journal/integration plans.

- [x] **Step 5: Adapt concrete `SupabasePreview` in composition**

Supply only parent/project-safe configuration; credentials remain native CLI/environment inputs and never enter `WorkflowRunRequest`.

- [x] **Step 6: Run GREEN and commit**

```bash
pnpm vitest run packages/core/engineering-workflow/tests/workflow.spec.ts packages/composition/runtime/tests/harness.spec.ts
git add packages/core/engineering-workflow packages/composition/runtime
git commit -m "fix(trick): gate database work on Supabase preview"
```

---

### Task 4: Add Deterministic Security Repair Authorization

**Files:**
- Modify: `packages/core/profile/src/types.ts`
- Modify: `packages/core/profile/src/index.ts`
- Modify: `packages/core/profile/tests/profile.spec.ts`
- Modify: `profiles/plurora/security-policy.ts`
- Modify: `profiles/plurora/profile.ts`
- Modify: `profiles/plurora/tests/profile.spec.ts`
- Modify: `packages/core/engineering-workflow/src/repair.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/tests/repair.spec.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`

**Interfaces:**

Use declarative deterministic policy, for example:

```ts
export interface SecurityRepairRule {
  readonly id: string
  readonly findingClass: 'SECURITY_BUG'
  readonly allowedBoundaries: readonly string[]
}

export interface SecurityRepairDecision {
  readonly allowed: boolean
  readonly reasonCode: string
}
```

Initial Plurora policy is fail-closed: no matching safe rule means no automatic security mutation.

- [x] **Step 1: Add RED deny-by-default test**

Confirmed SECURITY_BUG + valid diagnosis without a matching security-repair policy must not start a repair provider.

- [x] **Step 2: Add RED narrow allow-rule test**

Use a test policy permitting only `packages/fixture/security-safe/**`. A matching diagnosis may proceed to repair.

- [x] **Step 3: Add RED boundary-mismatch test**

The same finding outside the configured allowlist must not start repair.

- [x] **Step 4: Implement parser/evaluator**

Authorization cannot depend on finding summary, model prose, or a self-declared “safe” boolean.

- [x] **Step 5: Preserve diagnosis/RED/GREEN/fresh-verification obligations**

Authorization adds a gate; it does not weaken existing repair evidence requirements.

- [x] **Step 6: Run GREEN and commit**

```bash
pnpm vitest run packages/core/profile packages/core/engineering-workflow profiles/plurora
git add packages/core/profile packages/core/engineering-workflow profiles/plurora
git commit -m "fix(trick): require policy authorization for security repair"
```

---

### Task 5: Replace the Default Stage Plan With the Approved PR-Centric Lifecycle

**Files:**
- Modify: `packages/core/engineering-workflow/src/lifecycle.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/tests/lifecycle.spec.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Modify: `packages/core/engineering-workflow/README.md`
- Modify: `profiles/plurora/workflow-policy.ts`

**Interfaces:**

Default code lifecycle:

```text
implement-1
verify-1
[database-preview-1 when required]
delivery-1
review-1
[qa-1 according to profile/risk]
[security-1 according to profile/risk]
final-verify-1
```

Repair cycle:

```text
debug-N when diagnosis is required
repair-N
verify-N
delivery-N
review-N
[qa-N]
[security-N]
final-verify-N
```

- [x] **Step 1: Add RED low/medium/high/critical order tests in `lifecycle.spec.ts`**

High/critical must demonstrate `delivery` before review and a final verification after post-PR certification.

- [x] **Step 2: Add RED repair-cycle lifecycle test**

Inject a confirmed review bug and assert an order containing:

```text
delivery-1 -> review-1 -> debug-1 -> repair-1 -> verify-2 -> delivery-2 -> review-2 -> final-verify-1
```

Add QA/security where profile risk requires them.

- [x] **Step 3: Add RED improvement-only test**

`IMPROVEMENT` is reported, not repaired, and does not by itself prevent final PASS.

- [x] **Step 4: Implement deterministic transitions in `lifecycle.ts`**

Do not scatter ad-hoc stage-queue mutations through `index.ts`; the model never chooses the next lifecycle stage.

- [x] **Step 5: Enforce final-verifier freshness/independence**

Final verification is a fresh executor run and respects the profile independence requirement from the last mutator.

- [x] **Step 6: Run GREEN and commit**

```bash
pnpm vitest run packages/core/engineering-workflow/tests/lifecycle.spec.ts packages/core/engineering-workflow/tests/workflow.spec.ts
git add packages/core/engineering-workflow profiles/plurora/workflow-policy.ts
git commit -m "fix(trick): make default lifecycle PR centric"
```

---

### Task 6: Prove Workflow Authority Cannot Be Bypassed

**Files:**
- Modify: `profiles/plurora/tests/composition.spec.ts`
- Modify: `packages/composition/runtime/tests/harness.spec.ts`
- Modify: `packages/composition/runtime/tests/bundle.spec.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Modify: `packages/composition/runtime/README.md`

- [x] **Step 1: Add composed GitHub authority test**

Using the real Plurora profile, assert delivery is observed only through the capability and OpenCode/Codex providers never receive a delivery task.

- [x] **Step 2: Add composed database authority test**

Mark database change required. Assert Supabase Preview runs and generic executor task text never contains Supabase/git delivery commands as an authority path.

- [x] **Step 3: Add composed SECURITY_BUG fail-closed test**

With Plurora's initial deny-by-default policy, a confirmed SECURITY_BUG never starts repair unless a deterministic safe rule was explicitly configured.

- [x] **Step 4: Add composed full-lifecycle tests**

High risk:

```text
implement -> verify -> delivery -> review -> qa -> final verify
```

Critical adds security. After an injected bug, prove bounded repair/re-delivery/re-review before final verification.

- [x] **Step 5: Run package/repository gates**

```bash
pnpm vitest run packages/core/engineering-workflow packages/core/profile packages/composition/runtime profiles/plurora
pnpm typecheck
pnpm lint
pnpm build
```

Then run root constraints/doc-sync/hygiene gates.

- [x] **Step 6: Independent review gate**

Fresh reviewer verifies: profile mismatch fails before side effects, delivery has no LLM bypass, DB Preview has no LLM/shared/local bypass, security repair is policy-authorized, post-PR certification is deterministic, final verification is fresh, and material bugs cannot coexist with PASS/PR READY.

- [x] **Step 7: Commit docs/test completion**

```bash
git add packages/core/engineering-workflow packages/core/profile packages/composition/runtime profiles/plurora
git commit -m "test(trick): prove workflow authority remediation"
```
