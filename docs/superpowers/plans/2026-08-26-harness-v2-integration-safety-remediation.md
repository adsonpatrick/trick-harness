# Harness V2 Integration Safety Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GitHub delivery and Supabase Preview capabilities fail closed, wait for whole-process-tree quiescence, expose mutation checkpoints, and compose under one canonical Plurora capability policy.

**Architecture:** Integration packages remain deterministic capabilities. Their subprocess helpers use the DSH whole-tree lifecycle contract, not parent-process completion alone. GitHub delivery emits verified mutation records step-by-step. Supabase Preview becomes an explicit fail-fast state machine whose cleanup always runs independently. Plurora profile ids are normalized to the exact capability names composition consumes.

**Tech Stack:** TypeScript, Vitest, DSH subprocess, Git/gh, Supabase CLI, PostgreSQL/pgTAP, Trick Harness profile/composition.

**Spec:** `docs/superpowers/specs/2026-08-26-harness-v2-pr-review-remediation-design.md`

**Requires:**
- `docs/superpowers/plans/2026-08-26-fix-executor-quiescent-disposal.md`
- `docs/superpowers/plans/2026-08-26-fix-teardown-failure-observability.md`
- `docs/superpowers/plans/2026-08-26-fix-supabase-preview-branch-policy.md`

## Global Constraints

- Integration subprocess completion means the owned process tree is quiescent, not merely that the direct child settled.
- Teardown/quiescence failure is observable and cannot be reported as clean success.
- GitHub delivery may stage approved files, commit, normal-push the current feature branch, and open/update a PR only.
- Force push, history rewrite, protected/default branch push, merge, release and deployment remain denied.
- Supabase execution is cloud-only on an isolated Preview Branch.
- Supabase never falls back to parent/shared dev/local Docker.
- Supabase dependent gates stop after a failed prerequisite; cleanup still runs.
- Secrets/connection strings never enter durable journal records or exception prose.

---

### Task 1: Normalize Plurora Capability IDs and Supabase Parent Policy

**Files:**
- Modify: `profiles/plurora/integrations.ts`
- Modify: `profiles/plurora/tests/profile.spec.ts` or the existing profile integration test file under `profiles/plurora/tests/`.
- Modify: `packages/composition/runtime/src/harness.ts` only if exported constants need central reuse.
- Modify: `packages/composition/runtime/tests/harness.spec.ts`
- Modify: `profiles/plurora/README.md`

**Interfaces:**

Canonical enabled ids:

```ts
[
  'github-delivery',
  'supabase-preview',
  'control-server',
  'notion-knowledge',
  'linear-issues',
]
```

Supabase policy stores:

```ts
{
  parentProjectRef: 'uljaajwwnygopsyvwsre',
  execution: 'cloud-only',
  allowLocalFallback: false,
  allowSharedDevFallback: false,
}
```

Do not keep `branch: 'neurovia-dev'` as an execution target.

- [ ] **Step 1: Add RED real-profile composition tests**

In `packages/composition/runtime/tests/harness.spec.ts`, compose the real `pluroraProfile` with `integrations.supabase` and `control` options. Assert composition succeeds rather than throwing “does not enable supabase-preview/control-server”.

- [ ] **Step 2: Add RED profile-policy assertions**

Assert:

```ts
expect(pluroraProfile.integrationPolicy.enabled).toContain('supabase-preview')
expect(pluroraProfile.integrationPolicy.enabled).toContain('control-server')
expect(JSON.stringify(pluroraProfile.integrationPolicy)).not.toContain('supabase-preview-branches')
expect(JSON.stringify(pluroraProfile.integrationPolicy)).not.toContain('neurovia-dev')
```

The parent project ref is allowed because it is the non-secret branch-management parent.

- [ ] **Step 3: Run RED**

```bash
pnpm vitest run profiles/plurora packages/composition/runtime/tests/harness.spec.ts
```

- [ ] **Step 4: Normalize capability constants/policy**

Prefer importing/exporting one capability id constant where package layering permits it; otherwise pin exact string equality in tests.

- [ ] **Step 5: Run GREEN and commit**

```bash
pnpm vitest run profiles/plurora packages/composition/runtime/tests/harness.spec.ts
git add profiles/plurora packages/composition/runtime
git commit -m "fix(plurora): align integration capability policy"
```

---

### Task 2: Make GitHubDelivery Wait for Whole-Tree Quiescence

**Files:**
- Modify: `packages/integrations/github-delivery/src/index.ts`
- Modify: `packages/integrations/github-delivery/src/types.ts` if command outcome needs a quiescence/teardown failure shape.
- Modify: `packages/integrations/github-delivery/tests/delivery.spec.ts`
- Modify: `packages/integrations/github-delivery/README.md`

**Interfaces:**
- Consumes: DSH `SubprocessHandle.done` and `SubprocessHandle.waitForExit()`.
- Produces: command helper that returns only after both command settlement and owned-tree quiescence are established.

- [ ] **Step 1: Add RED fake-handle test proving `waitForExit()` is awaited**

Construct a fake handle where `done` resolves first and `waitForExit()` is held by a deferred promise. Start `delivery.inspect()` or a single command path and assert the capability promise remains pending until `waitForExit()` resolves.

- [ ] **Step 2: Add RED quiescence-failure test**

Make `waitForExit()` reject/return the failure form supported by the pinned DSH subprocess contract. Assert the delivery returns/throws a `DeliveryError` with a safe code such as `teardown-failed` and does not claim the command cleanly completed.

- [ ] **Step 3: Implement one internal command-settlement helper**

The helper sequence must be:

```text
spawn argv
 -> await handle.done
 -> await handle.waitForExit()
 -> read bounded stdout/stderr
 -> return CommandResult
```

If cancellation occurs, still await owned-tree quiescence before releasing the operation.

- [ ] **Step 4: Preserve secret-safe diagnostics**

Never include command stderr/stdout in durable error messages.

- [ ] **Step 5: Run GREEN and commit**

```bash
pnpm vitest run packages/integrations/github-delivery/tests/delivery.spec.ts packages/integrations/github-delivery/tests/commands.spec.ts
git add packages/integrations/github-delivery
git commit -m "fix(trick): await GitHub delivery process-tree quiescence"
```

---

### Task 3: Emit GitHub Mutation Records Immediately After World Re-read

**Files:**
- Modify: `packages/integrations/github-delivery/src/types.ts`
- Modify: `packages/integrations/github-delivery/src/index.ts`
- Modify: `packages/integrations/github-delivery/tests/delivery.spec.ts`

**Interfaces:**

Add an optional observer seam:

```ts
export type DeliveryRecordObserver = (record: DeliveryRecord) => Promise<void>

export interface GitHubDeliveryOptions {
  // existing fields
  readonly onRecord?: DeliveryRecordObserver
}
```

The observer runs only after the capability has re-read and confirmed the world state for that mutation.

- [ ] **Step 1: Add RED ordering test**

For commit/push/PR, record events into an array and assert order:

```text
commit confirmed -> onRecord(commit)
push remote SHA confirmed -> onRecord(push)
PR re-read -> onRecord(pr-open|pr-update)
```

- [ ] **Step 2: Add RED observer-failure test**

If `onRecord(commit)` rejects, assert the capability stops before push. This is the post-mutation durability barrier: do not perform the next mutation when the previous confirmed mutation could not be recorded durably by the caller.

- [ ] **Step 3: Implement awaited observer calls immediately after each `records.push` point**

Do not call the observer on intended-but-unverified mutations.

- [ ] **Step 4: Ensure returned `records` still match emitted records**

No duplicate or out-of-order records.

- [ ] **Step 5: Run GREEN and commit**

```bash
pnpm vitest run packages/integrations/github-delivery/tests/delivery.spec.ts
git add packages/integrations/github-delivery
git commit -m "feat(trick): checkpoint verified delivery mutations"
```

---

### Task 4: Make SupabasePreview Wait for Whole-Tree Quiescence

**Files:**
- Modify: `packages/integrations/supabase-preview/src/index.ts`
- Modify: `packages/integrations/supabase-preview/src/types.ts`
- Modify: `packages/integrations/supabase-preview/tests/preview.spec.ts`
- Modify: `packages/integrations/supabase-preview/README.md`

**Interfaces:**
- Same DSH whole-tree ownership invariant as GitHubDelivery.

- [ ] **Step 1: Add RED delayed-quiescence test**

Make a fake CLI process whose direct child settles while `waitForExit()` remains pending. Assert Preview flow does not start the next CLI command until the prior process tree is quiescent.

- [ ] **Step 2: Add RED teardown-failure test**

Assert a quiescence failure is reported separately and never converted to a passing gate result.

- [ ] **Step 3: Implement a single internal `runCli()` helper using `done + waitForExit()`**

Every Supabase/postgres test command must use it.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm vitest run packages/integrations/supabase-preview/tests/preview.spec.ts packages/integrations/supabase-preview/tests/commands.spec.ts
git add packages/integrations/supabase-preview
git commit -m "fix(trick): await Supabase preview process-tree quiescence"
```

---

### Task 5: Convert SupabasePreview to an Explicit Fail-Fast Gate State Machine

**Files:**
- Modify: `packages/integrations/supabase-preview/src/index.ts`
- Modify: `packages/integrations/supabase-preview/src/types.ts`
- Modify: `packages/integrations/supabase-preview/tests/preview.spec.ts`

**Interfaces:**

Represent executed gates explicitly, for example:

```ts
export type PreviewGate =
  | 'create'
  | 'identity'
  | 'health'
  | 'migration-push'
  | 'migration-list'
  | 'lint'
  | 'project-tests'
  | 'types'
  | 'cleanup'
```

Outcome should distinguish:

```ts
readonly completedGates: readonly PreviewGate[]
readonly skippedGates: readonly PreviewGate[]
readonly primaryFailure?: PreviewFailure
readonly cleanupFailure?: PreviewFailure
```

- [ ] **Step 1: Add RED migration-failure test**

Make create/identity/health succeed and migration push fail. Assert CLI spy never receives migration-list, lint, pgTAP/RLS or type-generation commands; cleanup still runs.

- [ ] **Step 2: Add RED identity-failure test**

Return a branch ref equal to the parent ref. Assert migration commands never start and cleanup behavior follows whether a branch resource was actually created.

- [ ] **Step 3: Add RED lint-failure test**

Assert project tests/types are skipped after lint failure while cleanup executes.

- [ ] **Step 4: Implement sequential gate execution with early return/throw into `finally` cleanup**

Do not run gates simply to collect more evidence after a prerequisite has failed.

- [ ] **Step 5: Keep cleanup orthogonal**

A cleanup failure does not erase `primaryFailure`; a successful cleanup does not turn a failed primary gate into PASS.

- [ ] **Step 6: Run GREEN and commit**

```bash
pnpm vitest run packages/integrations/supabase-preview/tests/preview.spec.ts
git add packages/integrations/supabase-preview
git commit -m "fix(trick): fail fast through Supabase preview gates"
```

---

### Task 6: Add Supabase Mutation Checkpoint Observer

**Files:**
- Modify: `packages/integrations/supabase-preview/src/types.ts`
- Modify: `packages/integrations/supabase-preview/src/index.ts`
- Modify: `packages/integrations/supabase-preview/tests/preview.spec.ts`

**Interfaces:**

Add a bounded observer:

```ts
export interface SupabaseMutationRecord {
  readonly action: 'preview-created' | 'migrations-applied' | 'preview-deleted'
  readonly previewProjectRef: string
  readonly branchName?: string
}

export type SupabaseMutationObserver = (record: SupabaseMutationRecord) => Promise<void>
```

Do not include DB passwords, JWT secrets or connection strings.

- [ ] **Step 1: Add RED observer order test**

Assert `preview-created` fires only after the structured create/identity result proves the child ref; `migrations-applied` fires only after migration success + migration-list verification; `preview-deleted` fires only after cleanup is confirmed.

- [ ] **Step 2: Add RED durability-observer failure test**

If `preview-created` observer rejects, assert migration push does not run. Cleanup may still delete the branch because it is compensating an already-observed mutation.

- [ ] **Step 3: Implement awaited observer calls**

Keep safe bounded records only.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm vitest run packages/integrations/supabase-preview/tests/preview.spec.ts
git add packages/integrations/supabase-preview
git commit -m "feat(trick): checkpoint Supabase preview mutations"
```

---

### Task 7: Verify Integration Safety as Real Composition

**Files:**
- Modify: `packages/composition/runtime/tests/harness.spec.ts`
- Modify: `packages/composition/runtime/README.md`
- Modify: `profiles/plurora/README.md`

- [ ] **Step 1: Compose real Plurora profile with both deterministic capabilities**

Use fakes for subprocess seams but real profile ids/options. Assert both integrations exist and control server is available.

- [ ] **Step 2: Prove no shared-dev/local fallback strings in runtime commands/policy**

Static assertions should reject:

```text
supabase start
supabase test db
--local
db reset
neurovia-dev as execution fallback
```

- [ ] **Step 3: Run integration/composition gates**

```bash
pnpm vitest run packages/integrations/github-delivery packages/integrations/supabase-preview profiles/plurora packages/composition/runtime
pnpm typecheck
pnpm lint
pnpm build
```

Run root constraint/doc-sync/hygiene gates documented in repository scripts.

- [ ] **Step 4: Independent review gate**

Reviewer must inspect:

```text
whole-tree quiescence
teardown failure visibility
post-mutation observer ordering
Supabase fail-fast dependency graph
cleanup independence
canonical capability ids
absence of parent/shared/local fallback
```

- [ ] **Step 5: Commit docs/test completion**

```bash
git add packages/composition/runtime profiles/plurora
git commit -m "test(trick): prove deterministic integration safety"
```
