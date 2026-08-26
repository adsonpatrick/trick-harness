# Supabase Preview Branch Policy Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Suggested issue title:** `[HIGH] Remove shared-dev branch target from Supabase preview policy`

**Goal:** Make the Plurora integration policy unambiguously require an isolated Supabase Preview Branch per DB-changing PR and prevent `neurovia-dev` from becoming an executable migration target.

**Architecture:** The project profile expresses safety invariants, not a concrete ephemeral branch name. It keeps the stable Supabase project identity but models preview-branch selection as a workflow-derived requirement. The future Supabase integration resolves the actual preview branch from PR/workflow context and blocks when none exists.

**Tech Stack:** TypeScript, Vitest, Plurora profile policy.

**Spec:** Embedded below; normative Harness v2 rule: DB-changing PRs use an isolated Supabase Preview Branch, no Docker/local fallback, and no automatic fallback to shared `neurovia-dev`.

## Correction Spec

### Problem

`profiles/plurora/integrations.ts` currently declares `branch: 'neurovia-dev'` inside the `supabase-preview` rule while simultaneously setting `allowSharedDevFallback: false`. The future integration could reasonably interpret `branch` as the execution target, violating the cloud-only isolated-preview requirement.

### Required behavior

- Preserve the stable Supabase project reference as project identity.
- Remove any fixed shared development branch from the executable target policy.
- Express that a DB-changing workflow requires a preview branch associated with the current PR/workflow.
- Preview branch identity is resolved at runtime from trusted workflow context; it is not hard-coded in the profile.
- If the preview branch cannot be created/resolved, the workflow becomes `BLOCKED`.
- No local Docker/shadow DB fallback.
- No shared-dev fallback.
- No direct migration execution against `neurovia-dev` through this policy.

### Proposed policy shape

Use scalar declarative fields such as:

```text
use: {
  projectRef: 'uljaajwwnygopsyvwsre',
  execution: 'cloud-only',
  previewBranchRequired: true,
  previewBranchIdentity: 'pull-request',
  onPreviewUnavailable: 'blocked',
  allowLocalFallback: false,
  allowSharedDevFallback: false,
}
```

The exact key names may follow established project naming, but the semantics above are mandatory and must remain scalar policy data.

### Non-goals

- Do not implement Supabase branch creation/API calls in this issue.
- Do not execute migrations.
- Do not modify `neurovia-dev`.

### Acceptance criteria

- No Supabase execution rule contains `branch: 'neurovia-dev'` or another fixed shared branch target.
- Tests require `previewBranchRequired: true` and `onPreviewUnavailable: 'blocked'` (or equivalent explicit semantics).
- Tests require both local and shared-dev fallback to be false.
- Policy remains flat scalar data.
- `pnpm vitest run profiles/plurora/tests/profile.spec.ts` passes.
- `pnpm run constraints` passes.

## Global Constraints

- DB-changing work executes only against isolated cloud Preview Branches.
- Preview-branch unavailability blocks; it never falls back.
- No Docker/local/shadow DB path.
- No shared `neurovia-dev` execution target.

---

### Task 1: Pin the safe DB policy with RED tests

**Files:**
- Modify: `profiles/plurora/tests/profile.spec.ts`

- [ ] Replace/extend the current Supabase assertion to require explicit preview-branch-per-PR semantics.
- [ ] Assert `allowLocalFallback === false`.
- [ ] Assert `allowSharedDevFallback === false`.
- [ ] Assert unavailable preview handling is `blocked`.
- [ ] Add a negative assertion that the rule does not expose `branch: 'neurovia-dev'` as execution target.
- [ ] Run focused tests; expected: FAIL against the current policy.

### Task 2: Correct the integration policy

**Files:**
- Modify: `profiles/plurora/integrations.ts`

- [ ] Remove the fixed `branch: 'neurovia-dev'` field.
- [ ] Add scalar fields expressing required per-PR preview identity and blocked behavior when unavailable.
- [ ] Preserve `projectRef`, `execution: 'cloud-only'`, `allowLocalFallback: false`, and `allowSharedDevFallback: false`.
- [ ] Keep runtime branch resolution out of the profile.
- [ ] Run profile tests; expected: PASS.

### Task 3: Synchronize profile documentation

**Files:**
- Modify: `profiles/plurora/README.md`

- [ ] State explicitly that no concrete preview branch name is stored in policy.
- [ ] State that the future integration resolves the branch from current PR/workflow context.
- [ ] State that resolution/creation failure is `BLOCKED`, never shared-dev fallback.

### Task 4: Verify and commit

- [ ] Run `pnpm vitest run profiles/plurora/tests/profile.spec.ts`.
- [ ] Run `pnpm run constraints`.
- [ ] Run `pnpm run typecheck` if profile shape changed in a typed way.
- [ ] Search `profiles/plurora` for `branch: 'neurovia-dev'`; expected: no executable-policy occurrence.
- [ ] Commit: `fix(plurora): require per-pr supabase preview branch`.

## Independent verification

Fresh review must prove from the policy alone that a future integration cannot legitimately interpret shared `neurovia-dev` as the migration target or fallback.