# Harness V2 Workflow Authority Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the workflow use deterministic mutation capabilities, enforce profile identity and security-repair authority, and make the default lifecycle match the approved PR-centric certification loop.

**Architecture:** WorkflowRunner remains the lifecycle owner but no longer treats every stage as an LLM executor dispatch. `delivery` and required database validation are capability-backed through narrow ports supplied by composition. Profile identity is validated before journal start. Security repair has a deterministic policy gate. The default lifecycle publishes verified work before independent review/QA/security and repeats certification after every repair until final verification.

**Tech Stack:** TypeScript, Vitest, Trick Harness workflow/contracts/profile/composition, GitHubDelivery, SupabasePreview, DSH journal.

**Spec:** `docs/superpowers/specs/2026-08-26-harness-v2-pr-review-remediation-design.md`

**Requires:** routing runtime remediation, journal/control remediation and integration safety remediation completed first. Existing PR #1 profile validation/boundary corrections must also be green.

## Global Constraints

- `objective.profileId` must equal the composed profile id before any journal start, executor start or capability mutation.
- GitHub delivery is capability-backed; no model executor receives generic shell authority as a substitute for delivery.
- Database-changing workflows require Supabase Preview capability and block if it is unavailable.
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
- Modify: `packages/core/control-server/tests/server.spec.ts` if composition is exercised through HTTP fixtures.
- Modify: `packages/composition/runtime/README.md`

**Interfaces:**

Add a preflight assertion before `WorkflowJournal`/`WorkflowRunner` construction:

```ts
function assertObjectiveProfile(objective: WorkflowObjective, profile: HarnessProfile): void {
  if (objective.profileId !== profile.id) {
    throw new BundleCompositionError(
      `objective profile ${JSON.stringify(objective.profileId)} does not match composed profile ${JSON.stringify(profile.id)}`,
    )
  }
}
```

- [ ] **Step 1: Add RED mismatch test**

Compose Plurora profile, pass an objective with `profileId: 'other'`, and assert:

```ts
await expect(harness.run(objective)).rejects.toThrow(BundleCompositionError)
expect(providerStart).not.toHaveBeenCalled()
expect(session.events.some(event => event.type === 'harness/workflow-start')).toBe(false)
```

- [ ] **Step 2: Add matching-profile control test**

Same objective with `profileId: pluroraProfile.id` should proceed normally.

- [ ] **Step 3: Implement preflight validation before generating/recording mutation-capable run state**

No side effect or durable workflow start for an invalid objective/profile pair.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm vitest run packages/composition/runtime/tests/harness.spec.ts
git add packages/composition/runtime
git commit -m "fix(trick): bind workflow objective to composed profile"
```

---

### Task 2: Add Explicit Workflow Capability Ports

**Files:**
- Modify: `packages/core/engineering-workflow/src/types.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Modify: `packages/composition/runtime/src/harness.ts`
- Modify: `packages/composition/runtime/tests/harness.spec.ts`
- Modify: `packages/core/engineering-workflow/package.json` if type-only integration contracts are moved into a neutral contracts package rather than importing integration packages directly.

**Interfaces:**

Keep workflow core independent from concrete integration classes by defining narrow ports in workflow/core contracts:

```ts
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

The concrete composition adapts `GitHubDelivery`/`SupabasePreview` to these ports.

- [ ] **Step 1: Add RED test proving delivery does not call executor runtime**

In `workflow.spec.ts`, plan a delivery stage, register an executor provider whose `start` throws if called for role `delivery`, and supply a fake delivery capability. Assert:

```ts
expect(deliveryCapability.deliver).toHaveBeenCalledOnce()
expect(executorProvider.start).not.toHaveBeenCalledWith(expect.objectContaining({
  task: expect.stringContaining('delivery'),
}))
```

Use separate providers for earlier implement/verify stages as required by the fixture.

- [ ] **Step 2: Add RED missing-capability test**

Run a plan containing delivery with no `capabilities.delivery`; assert terminal `BLOCKED` before any git mutation substitute is attempted.

- [ ] **Step 3: Implement capability dispatch branch in WorkflowRunner**

The queue continues to use `StageSpec`, but `delivery` is handled by the capability port rather than `executors.start()`.

- [ ] **Step 4: Integrate journal capability start/end barrier**

Before `deliver()`, await `journal.beginCapability({ capability: 'github-delivery', ... })`; after completion/error, emit capability end. Concrete delivery mutation observer writes each verified `harness/delivery` record durably.

- [ ] **Step 5: Adapt concrete `GitHubDelivery` in composition**

Composition supplies the port and its `onRecord` observer so each confirmed commit/push/PR record is journaled before the next mutation.

- [ ] **Step 6: Run GREEN and commit**

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

Extend run request with deterministic database-change metadata:

```ts
export interface WorkflowDatabaseChange {
  readonly required: true
  readonly migrationPaths: readonly string[]
}

export interface WorkflowRunRequest {
  // existing fields
  readonly databaseChange?: WorkflowDatabaseChange
}
```

No credentials/connection strings are accepted here.

The database preview gate runs after implementation verification and before GitHub delivery so a migration failure cannot publish the branch as ready for review.

- [ ] **Step 1: Add RED missing-preview-capability test**

Provide `databaseChange.required === true` with no database capability. Assert workflow `BLOCKED`, no delivery capability call, and no fallback to an executor shell.

- [ ] **Step 2: Add RED Preview-failure test**

Fake Preview capability returns a failed migration/lint result. Assert delivery is never called and workflow terminal verdict is non-PASS.

- [ ] **Step 3: Add RED successful Preview ordering test**

Record stage/capability calls and assert:

```text
implement -> verify -> supabase-preview -> delivery
```

Then certification stages may follow delivery under the PR lifecycle.

- [ ] **Step 4: Adapt concrete `SupabasePreview` in composition**

Supply configured parent project ref from Plurora integration policy/options and wire its mutation observer to durable journal facts. Do not pass secrets through `WorkflowRunRequest`.

- [ ] **Step 5: Run GREEN and commit**

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
- Modify: `profiles/plurora/tests/profile.spec.ts` or existing security-policy test file.
- Modify: `packages/core/engineering-workflow/src/repair.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`

**Interfaces:**

Define deterministic authorization owned by policy, not by model output. A viable contract:

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

If current profile architecture prefers rule tables rather than executable hooks, keep it declarative and evaluate in workflow/profile mechanism.

Initial Plurora policy is fail-closed: no safe rule means no automatic security mutation.

- [ ] **Step 1: Add RED test: confirmed SECURITY_BUG + diagnosis still does not auto-repair without policy authorization**

Assert no repair provider starts and workflow blocks/reports for human action.

- [ ] **Step 2: Add RED deterministic allow-rule test**

Create a test profile with a narrow allowed boundary, e.g. `packages/fixture/security-safe/**`, and a matching diagnosis `minimalRepairSurface`. Assert repair can proceed only for the matching boundary.

- [ ] **Step 3: Add RED boundary mismatch test**

Same finding/diagnosis outside the allowlist must not start repair.

- [ ] **Step 4: Implement policy parsing/evaluation**

Do not trust `Finding.summary`, model prose or self-declared “safe” booleans as authorization.

- [ ] **Step 5: Keep regression/fresh-verification requirements unchanged**

Even an authorized security repair still requires diagnosis, RED/GREEN evidence and fresh independent certification.

- [ ] **Step 6: Run GREEN and commit**

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
- Modify: `packages/core/engineering-workflow/tests/lifecycle.spec.ts` if present; otherwise extend `packages/core/engineering-workflow/tests/workflow.spec.ts`.
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Modify: `packages/core/engineering-workflow/README.md`
- Modify: `profiles/plurora/workflow-policy.ts` only for risk thresholds already owned by profile.

**Interfaces:**

Default lifecycle ordering for ordinary code work:

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

Repair loop after a confirmed repairable finding:

```text
debug-N (unless mechanically obvious)
repair-N
verify-N
delivery-N
review-N
[qa-N]
[security-N]
final-verify-N
```

Every post-repair certifying stage is fresh and respects cross-executor independence policy.

- [ ] **Step 1: Add RED stage-order tests for low/medium/high/critical risk**

At minimum high/critical must demonstrate delivery precedes review and final verification follows post-PR certification.

- [ ] **Step 2: Add RED repair-cycle lifecycle test**

Inject one confirmed bug in review. Assert the order includes:

```text
delivery-1 -> review-1 -> debug-1 -> repair-1 -> verify-2 -> delivery-2 -> review-2 -> final-verify-1
```

Include QA/security where risk requires them.

- [ ] **Step 3: Add RED improvement-only test**

An `IMPROVEMENT` finding is reported, not repaired, and does not prevent final PASS unless another policy says it is blocking.

- [ ] **Step 4: Implement lifecycle queue transitions in `lifecycle.ts` rather than ad-hoc pushes spread through `index.ts`**

Keep the state machine deterministic. The model does not choose which stage comes next.

- [ ] **Step 5: Enforce final verification freshness**

Final verification gets a fresh executor run and, for high/critical risk, the profile's independence requirement from the last mutator.

- [ ] **Step 6: Run GREEN and commit**

```bash
pnpm vitest run packages/core/engineering-workflow/tests

git add packages/core/engineering-workflow profiles/plurora/workflow-policy.ts
git commit -m "fix(trick): make default lifecycle PR centric"
```

---

### Task 6: Prove the Workflow Cannot Bypass Deterministic Authorities

**Files:**
- Modify: `packages/composition/runtime/tests/harness.spec.ts`
- Modify: `packages/composition/runtime/tests/bundle.spec.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Modify: `packages/composition/runtime/README.md`

- [ ] **Step 1: Add a composed GitHub authority test**

Use real Plurora profile, fake executor runtime and fake GitHub port. Assert delivery is observed only through the capability and the OpenCode/Codex providers never receive a `delivery` stage task.

- [ ] **Step 2: Add a composed DB authority test**

Mark database change required. Assert Supabase Preview capability runs and generic executor never receives Supabase/git commands as task text.

- [ ] **Step 3: Add a composed SECURITY_BUG fail-closed test**

With Plurora initial policy and no safe rule, confirmed SECURITY_BUG never starts repair.

- [ ] **Step 4: Add a composed full lifecycle test**

For high-risk work, assert:

```text
implement -> verify -> delivery -> review -> qa -> final verify
```

For critical work include security. After an injected bug, assert bounded repair/re-delivery/re-review before final verification.

- [ ] **Step 5: Run package/repository gates**

```bash
pnpm vitest run packages/core/engineering-workflow packages/core/profile packages/composition/runtime profiles/plurora
pnpm typecheck
pnpm lint
pnpm build
```

Run root constraints/doc-sync/hygiene gates.

- [ ] **Step 6: Independent review gate**

Reviewer must prove:

```text
profile mismatch fails before side effects
delivery has no LLM bypass
DB Preview has no LLM/shared/local bypass
security repair is policy-authorized
post-PR certification order is deterministic
final verification is fresh
no material bug can coexist with PASS/PR READY
```

- [ ] **Step 7: Commit docs/test completion**

```bash
git add packages/core/engineering-workflow packages/core/profile packages/composition/runtime profiles/plurora
git commit -m "test(trick): prove workflow authority remediation"
```
