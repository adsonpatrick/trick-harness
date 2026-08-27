# Plurora Routing Policy Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Suggested issue title:** `[CRITICAL] Align Plurora routing policy with approved Harness v2 matrix`

**Goal:** Restore the approved deterministic Plurora executor/model/effort routing matrix before the routing engine consumes it.

**Architecture:** Keep routing mechanism outside the profile. `profiles/plurora/routing-policy.ts` contains only deterministic scalar policy facts; tests pin the normative matrix so later router work cannot silently drift it.

**Tech Stack:** TypeScript, Vitest, pnpm workspace.

**Spec:** Embedded below; normative source: `docs/superpowers/plans/2026-08-25-trick-harness-v2-reusable-core.md`, Task 4.

## Correction Spec

### Problem

PR #1 currently routes implementation to `codex.balanced/medium`, routine review to `opencode.reasoning-fast/medium`, high/critical review to `high`, and uses a generic Codex-unavailable fallback to `opencode.workhorse`. This conflicts with the approved Harness v2 policy.

### Required behavior

- refine/plan -> `opencode.reasoning-fast` (DeepSeek V4 Flash semantic tier).
- small/medium implementation -> `opencode.workhorse` (MiMo V2.5).
- heavy/high-volume implementation, broad refactor and heavy test/repair generation -> `opencode.workhorse`; heavy work is a hard invariant unless an explicit per-run user override exists at the router layer.
- routine review, difficult diagnosis and QA charter/risk analysis -> `codex.balanced` + `high` when available.
- high-risk architecture, security-sensitive review and Auth/RLS/tenant-isolation analysis -> `codex.frontier` + `xhigh`.
- exceptional unresolved reasoning -> `codex.frontier` + `max` only behind an explicit escalation fact.
- Codex availability fallback preserves task nature: reasoning/review/diagnosis -> `opencode.reasoning-fast`; implementation/repair/refactor/bulk tests -> `opencode.workhorse`.
- Policy remains declarative scalar data and contains semantic tiers, never literal model IDs.

### Non-goals

- No routing-engine implementation.
- No literal model resolution.
- No provider execution changes.

### Acceptance criteria

- Tests explicitly cover every approved primary and fallback route.
- Heavy implementation resolves to `opencode.workhorse`.
- High/security/Auth/RLS routes use `xhigh`.
- No generic Codex-unavailable row collapses reasoning and write-heavy tasks.
- No literal `MiMo`, `DeepSeek` or `GPT-*` model ID appears in the profile table.
- `pnpm vitest run profiles/plurora/tests/profile.spec.ts` passes.
- `pnpm run constraints` passes.

## Global Constraints

- Heavy/high-volume work -> MiMo semantic workhorse.
- Codex fallback preserves task nature.
- Profile policy is scalar declarative data only.
- Semantic tiers only.

---

### Task 1: Pin the approved matrix with RED tests

**Files:**
- Modify: `profiles/plurora/tests/profile.spec.ts`

**Produces:** executable contract tests for all approved primary/fallback routes.

- [ ] Add table-driven assertions for refine, plan, small/medium/heavy implementation, refactor, repair, routine review, diagnosis, QA analysis, high-risk architecture, security/Auth/RLS and exceptional escalation.
- [ ] Add fallback assertions splitting Codex-unavailable reasoning from write-heavy work.
- [ ] Assert high-assurance routes use `xhigh`.
- [ ] Assert heavy implementation uses `opencode.workhorse`.
- [ ] Run `pnpm vitest run profiles/plurora/tests/profile.spec.ts`; expected: FAIL against the current table.

### Task 2: Correct primary routing policy

**Files:**
- Modify: `profiles/plurora/routing-policy.ts`

- [ ] Add the scalar match facts required by the tests (`stage`, `taskClass`, `workload`, `risk`, `escalation` where needed).
- [ ] Route refine/plan to `opencode.reasoning-fast`.
- [ ] Route implementation/refactor/repair write-heavy classes to `opencode.workhorse`.
- [ ] Route routine review/diagnosis/QA to `codex.balanced` + `high`.
- [ ] Route high/security/Auth/RLS to `codex.frontier` + `xhigh`.
- [ ] Gate `max` behind explicit exceptional escalation.
- [ ] Keep catch-all last.

### Task 3: Correct availability fallback semantics

**Files:**
- Modify: `profiles/plurora/routing-policy.ts`
- Test: `profiles/plurora/tests/profile.spec.ts`

- [ ] Replace generic Codex-unavailable fallback with task-nature-specific rows.
- [ ] Reasoning fallback -> `opencode.reasoning-fast`.
- [ ] Write-heavy fallback -> `opencode.workhorse`.
- [ ] Preserve cross-executor independence.
- [ ] Run focused tests; expected: PASS.

### Task 4: Verify and commit

- [ ] Run `pnpm vitest run profiles/plurora/tests/profile.spec.ts`.
- [ ] Run `pnpm run constraints`.
- [ ] Run `pnpm run typecheck` if policy typings changed.
- [ ] Inspect diff for literal model IDs/runtime mechanism leakage.
- [ ] Commit: `fix(plurora): align harness routing policy`.

## Independent verification

A fresh reviewer must compare the resulting policy table to the approved matrix, explicitly checking the MiMo heavy-work invariant and Codex fallback split.