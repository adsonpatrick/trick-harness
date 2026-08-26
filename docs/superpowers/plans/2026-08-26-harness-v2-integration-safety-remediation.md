# Harness V2 Integration Safety Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GitHub delivery and Supabase Preview capabilities fail closed, wait for whole-process-tree quiescence, expose mutation checkpoints, and compose under one canonical Plurora capability policy.

**Architecture:** Integration packages remain deterministic capabilities. Their subprocess helpers use the DSH whole-tree lifecycle contract, not parent-process completion alone. GitHub delivery emits verified mutation records step-by-step. Supabase Preview is an explicit fail-fast state machine whose cleanup always runs independently. Plurora profile ids exactly match the capabilities composition consumes.

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
- Dependent Supabase gates stop after a failed prerequisite; cleanup still runs.
- Secrets/connection strings never enter durable journal records or exception prose.

---

### Task 1: Normalize Plurora Capability IDs and Supabase Parent Policy

**Files:**
- Modify: `profiles/plurora/integrations.ts`
- Modify: `profiles/plurora/tests/profile.spec.ts`
- Modify: `profiles/plurora/tests/composition.spec.ts`
- Modify: `packages/composition/runtime/src/harness.ts`
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

Supabase profile policy stores the parent ref only:

```text
{
  parentProjectRef: 'uljaajwwnygopsyvwsre',
  execution: 'cloud-only',
  allowLocalFallback: false,
  allowSharedDevFallback: false,
}
```

- [ ] **Step 1: Add RED real-profile composition tests**

Compose the real `pluroraProfile` with Supabase integration options and control-server options. Assert composition succeeds instead of rejecting `supabase-preview`/`control-server` as disabled.

- [ ] **Step 2: Add RED profile assertions**

```text
expect(pluroraProfile.integrationPolicy.enabled).toContain('supabase-preview')
expect(pluroraProfile.integrationPolicy.enabled).toContain('control-server')
expect(JSON.stringify(pluroraProfile.integrationPolicy)).not.toContain('supabase-preview-branches')
expect(JSON.stringify(pluroraProfile.integrationPolicy)).not.toContain('neurovia-dev')
```

- [ ] **Step 3: Run RED**

```bash
pnpm vitest run profiles/plurora/tests/profile.spec.ts profiles/plurora/tests/composition.spec.ts packages/composition/runtime/tests/harness.spec.ts
```

- [ ] **Step 4: Normalize capability constants and profile policy**

Use one exact capability vocabulary. Preserve `uljaajwwnygopsyvwsre` only as non-secret parent branch-management configuration.

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
- Modify: `packages/integrations/github-delivery/src/types.ts`
- Modify: `packages/integrations/github-delivery/tests/delivery.spec.ts`
- Modify: `packages/integrations/github-delivery/README.md`

**Interfaces:**
- Consumes: DSH `SubprocessHandle.done` and `SubprocessHandle.waitForExit()`.
- Produces: a command helper that returns only after direct settlement and owned-tree quiescence.

- [ ] **Step 1: Add RED delayed-quiescence test**

Create a fake handle where `done` resolves first and `waitForExit()` is held by a deferred promise. Start `GitHubDelivery.inspect()` and assert the returned promise remains pending until `waitForExit()` resolves.

- [ ] **Step 2: Add RED quiescence-failure test**

Make `waitForExit()` fail according to the pinned DSH subprocess contract. Assert delivery reports a safe teardown/quiescence failure and never claims clean command success.

- [ ] **Step 3: Implement one internal settlement helper**

```text
spawn argv
 -> await handle.done
 -> await handle.waitForExit()
 -> read bounded stdout/stderr
 -> return CommandResult
```

Cancellation still waits for tree quiescence before the operation is released.

- [ ] **Step 4: Preserve secret-safe diagnostics**

Never forward raw command stdout/stderr into durable error messages.

- [ ] **Step 5: Run GREEN and commit**

```bash
pnpm vitest run packages/integrations/github-delivery/tests/delivery.spec.ts packages/integrations/github-delivery/tests/commands.spec.ts
git add packages/integrations/github-delivery
git commit -m "fix(trick): await GitHub delivery process-tree quiescence"
```

---

### Task 3: Checkpoint GitHub Mutations Immediately After World Re-read

**Files:**
- Modify: `packages/integrations/github-delivery/src/types.ts`
- Modify: `packages/integrations/github-delivery/src/index.ts`
- Modify: `packages/integrations/github-delivery/tests/delivery.spec.ts`

**Interfaces:**

```text
export type DeliveryRecordObserver = (record: DeliveryRecord) => Promise<void>
```

`GitHubDeliveryOptions` gains:

```text
readonly onRecord?: DeliveryRecordObserver
```

- [ ] **Step 1: Add RED observer-order test**

Assert:

```text
commit confirmed by HEAD re-read -> onRecord(commit)
push confirmed by remote SHA re-read -> onRecord(push)
PR confirmed by gh re-read -> onRecord(pr-open|pr-update)
```

- [ ] **Step 2: Add RED observer-failure test**

If `onRecord(commit)` rejects, assert push does not start. A confirmed mutation must be durably checkpointed before the next mutation.

- [ ] **Step 3: Implement awaited observer calls after each verified mutation**

Do not invoke the observer for intended-but-unverified operations.

- [ ] **Step 4: Prove returned records equal emitted records**

No duplicate or reordered records.

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

- [ ] **Step 1: Add RED delayed-quiescence test**

Fake a CLI process whose direct child settles while `waitForExit()` remains pending. Assert the Preview flow does not start the next command until the prior process tree is quiescent.

- [ ] **Step 2: Add RED teardown-failure test**

Assert quiescence failure is independently observable and never converted into a passing gate.

- [ ] **Step 3: Implement one `runCli()` helper using `done + waitForExit()`**

Every Supabase and PostgreSQL test subprocess in this capability must use it.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm vitest run packages/integrations/supabase-preview/tests/preview.spec.ts packages/integrations/supabase-preview/tests/commands.spec.ts
git add packages/integrations/supabase-preview
git commit -m "fix(trick): await Supabase preview process-tree quiescence"
```

---

### Task 5: Convert SupabasePreview to a Fail-Fast Gate State Machine

**Files:**
- Modify: `packages/integrations/supabase-preview/src/index.ts`
- Modify: `packages/integrations/supabase-preview/src/types.ts`
- Modify: `packages/integrations/supabase-preview/tests/preview.spec.ts`

**Interfaces:**

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

Outcome records `completedGates`, `skippedGates`, `primaryFailure`, and `cleanupFailure`.

- [ ] **Step 1: Add RED migration-failure test**

Create/identity/health succeed; migration push fails. Assert migration-list, lint, project tests and type generation never run; cleanup still runs.

- [ ] **Step 2: Add RED identity-failure test**

Return `previewProjectRef === parentProjectRef`; assert no migration command starts.

- [ ] **Step 3: Add RED lint-failure test**

Assert project tests/types are skipped while cleanup still executes.

- [ ] **Step 4: Implement sequential fail-fast execution with cleanup in `finally`**

Do not continue dependent gates merely to collect more evidence after a prerequisite failed.

- [ ] **Step 5: Keep cleanup orthogonal**

Cleanup failure never erases the primary failure, and cleanup success never converts a failed primary gate into PASS.

- [ ] **Step 6: Run GREEN and commit**

```bash
pnpm vitest run packages/integrations/supabase-preview/tests/preview.spec.ts
git add packages/integrations/supabase-preview
git commit -m "fix(trick): fail fast through Supabase preview gates"
```

---

### Task 6: Checkpoint Supabase Mutations

**Files:**
- Modify: `packages/integrations/supabase-preview/src/types.ts`
- Modify: `packages/integrations/supabase-preview/src/index.ts`
- Modify: `packages/integrations/supabase-preview/tests/preview.spec.ts`

**Interfaces:**

```ts
export interface SupabaseMutationRecord {
  readonly action: 'preview-created' | 'migrations-applied' | 'preview-deleted'
  readonly previewProjectRef: string
  readonly branchName?: string
}

export type SupabaseMutationObserver = (record: SupabaseMutationRecord) => Promise<void>
```

- [ ] **Step 1: Add RED observer-order test**

`preview-created` fires only after structured identity proves the child ref; `migrations-applied` only after migration success + migration-list verification; `preview-deleted` only after cleanup confirmation.

- [ ] **Step 2: Add RED observer-failure test**

If `preview-created` observer rejects, assert migration push does not run. Cleanup may still delete the already-created branch as compensation.

- [ ] **Step 3: Implement awaited bounded observer calls**

Never include DB passwords, JWT secrets, access tokens or connection strings.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm vitest run packages/integrations/supabase-preview/tests/preview.spec.ts
git add packages/integrations/supabase-preview
git commit -m "feat(trick): checkpoint Supabase preview mutations"
```

---

### Task 7: Verify Integration Safety With the Real Plurora Profile

**Files:**
- Modify: `profiles/plurora/tests/composition.spec.ts`
- Modify: `profiles/plurora/tests/profile.spec.ts`
- Modify: `packages/composition/runtime/tests/harness.spec.ts`
- Modify: `packages/composition/runtime/README.md`
- Modify: `profiles/plurora/README.md`

- [ ] **Step 1: Compose real Plurora profile with both deterministic capabilities**

Use fake subprocess seams but real profile ids/options. Assert GitHub, Supabase Preview, and control server compose successfully.

- [ ] **Step 2: Prove forbidden fallback strings are absent**

Static assertions reject `supabase start`, `supabase test db`, `--local`, `db reset`, and `neurovia-dev` as an execution fallback.

- [ ] **Step 3: Run integration/composition gates**

```bash
pnpm vitest run packages/integrations/github-delivery packages/integrations/supabase-preview profiles/plurora packages/composition/runtime
pnpm typecheck
pnpm lint
pnpm build
```

Then run root constraint/doc-sync/hygiene gates defined by the repository.

- [ ] **Step 4: Independent review gate**

Fresh reviewer verifies whole-tree quiescence, teardown visibility, mutation checkpoint ordering, Supabase fail-fast dependency graph, cleanup independence, canonical ids, and absence of parent/shared/local fallback.

- [ ] **Step 5: Commit docs/test completion**

```bash
git add packages/composition/runtime profiles/plurora
git commit -m "test(trick): prove deterministic integration safety"
```
