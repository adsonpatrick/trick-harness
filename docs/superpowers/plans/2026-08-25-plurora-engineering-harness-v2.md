# Plurora Engineering Harness V2 — Implementation Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement these plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Plurora Engineering Harness V2 on top of a reusable **Trick Harness** runtime without mixing generic runtime mechanism, Plurora policy, product-repository integration, and rollout verification into one unreviewable change.

**Architecture:** `adsonpatrick/trick-harness` is the canonical runtime repository and must remain a real fork of `deepseek-ai/deepseek-harness`. Plan R establishes reusable Core/providers/integrations plus the project-profile seam; A and B implement the executor/runtime and engineering workflows using those boundaries; C integrates `neuro-via` by selecting `profile=plurora`; D proves the assembled system with direct deterministic and real-product evidence.

**Tech Stack:** TypeScript/Node.js, pnpm workspaces, Cordis/DeepSeek Harness, OpenCode server/SDK/ACP, Codex CLI/app-server, Claude Agent SDK/Claude Code CLI, Git/GitHub CLI, Supabase CLI/Branching/Postgres/pgTAP, existing Plurora Node/Playwright/CI gates.

**Base Spec:** `docs/superpowers/specs/2026-08-25-plurora-engineering-harness-v2-design.md`  
**Approved Amendment:** `docs/superpowers/specs/2026-08-25-plurora-engineering-harness-v2-reusable-core-amendment.md`

## Planning Status — Approved for Execution

The reusable-core amendment and amended plan set R→A→B→C→D are approved by the owner on 2026-08-25. A/B/C/D remain detailed implementation inputs, but stale repository names, `packages/plurora/*` paths, `@plurora/harness-*` package names, and Plurora-policy ownership are superseded by the approved amendment + Plan R.

The amended self-review establishes:

- canonical runtime repository: `adsonpatrick/trick-harness`;
- runtime is a real GitHub fork of `deepseek-ai/deepseek-harness`;
- generic mechanism lives under `packages/core`, `packages/providers`, and `packages/integrations`;
- project policy lives under `profiles/`, with `profiles/plurora` as the first production profile;
- fork-local private packages use `@trick-harness/*`;
- Core/provider/integration packages may not depend on `profiles/plurora` or `neuro-via`;
- the same runtime must boot a minimal fixture profile and the Plurora profile without Core modification;
- OpenCode TUI retains `git push*` denial; scoped commit/push/PR authority belongs only to Harness delivery capability;
- DB execution/verification remains cloud-only on isolated Supabase Preview Branches with no Docker/local/shared-dev fallback;
- model/effort routing remains per-worker and never mutates global OpenCode/Codex defaults;
- confirmed bugs may auto-repair; product/design decisions and non-bug improvements may not be auto-fixed to obtain green status;
- merge/release/deploy remain human/out-of-scope authority;
- final activation requires **30/30 original acceptance criteria + R1-R5 PASS**.

## Precedence

Where documents conflict:

1. Explicit owner decisions remain authoritative.
2. The approved reusable-core amendment supersedes the base Spec only for repository naming, package boundaries, dependency direction, reusable/profile ownership, and R1-R5 evidence.
3. Plan R is normative wherever historical A/B/C/D text conflicts with that amendment.
4. A/B/C/D remain authoritative for their detailed implementation requirements when not superseded by Plan R.

## Plan Graph

```text
R. Reusable Trick Core + project profiles
              |
              v
A. Runtime foundation + executor providers
              |
              v
B. Routing + durable engineering workflows
              |
              v
C. neuro-via bridge + policy/DB migration
              |
              v
D. Verification + rollout
```

### Plan R — Reusable Trick Core + Profiles

`2026-08-25-trick-harness-v2-reusable-core.md`

Establishes the real `adsonpatrick/trick-harness` fork gate, `@trick-harness/*` namespace, dependency-boundary enforcement, generic `HarnessProfile` seam, `profiles/plurora`, test-only minimal profile, A/B path/type mapping, C consumption contract, and D evidence extension.

### Plan A — Runtime Foundation

`2026-08-25-plurora-harness-v2-runtime-foundation.md`

Detailed executor/provider work remains applicable, with Plan R substitutions:

```text
adsonpatrick/plurora-harness -> adsonpatrick/trick-harness
PluroraExecutorRuntime -> HarnessExecutorRuntime
packages/plurora/executor -> packages/core/executor
packages/plurora/executor-opencode -> packages/providers/opencode
packages/plurora/executor-codex -> packages/providers/codex
packages/plurora/executor-claude-code -> packages/providers/claude-code
@plurora/harness-* -> @trick-harness/*
```

OpenCode/Codex are required providers; Claude remains optional to core topology but still has a current base acceptance criterion while maintained.

### Plan B — Routing and Engineering Workflows

`2026-08-25-plurora-harness-v2-routing-workflows.md`

Mechanisms remain generic; concrete Plurora policy moves to `profiles/plurora`. Apply Plan R mappings for contracts, routing, journal, workflow, control server, GitHub delivery and Supabase Preview integration. The router consumes profile policy rather than embedding Plurora model tables in Core.

### Plan C — `neuro-via` Integration

`2026-08-25-plurora-harness-v2-neuro-via-integration.md`

The bridge remains thin and must commit non-secret metadata selecting:

```text
repository = adsonpatrick/trick-harness
profile = plurora
controlServerUrl = http://127.0.0.1:47831
revision = exact independently verified 40-hex Trick Harness SHA
```

No MiMo/Codex fallback/risk-policy tables are duplicated in `neuro-via`. Existing Plan C rules remain: planning approval gates, TUI push denial, cloud-only DB scripts, Preview Branch isolation, project-local worker skills and governance.

### Plan D — Verification and Rollout

`2026-08-25-plurora-harness-v2-verification-rollout.md`

The original 30 acceptance rows remain mandatory. Extend the evidence ledger with:

- **R1:** generic packages have no dependency on `profiles/plurora`/`neuro-via`;
- **R2:** Plurora profile reproduces all approved Plurora policy;
- **R3:** minimal fixture profile boots without Plurora policy;
- **R4:** one Trick Harness build executes deterministic workflows under both profiles without Core edits;
- **R5:** `neuro-via` selects `profile=plurora` through config/bridge and does not duplicate profile policy in generic Core.

Final activation requires **35/35 PASS**, no unresolved material finding, final `neuro-via` pin matching the independently verified Trick Harness SHA, and trusted composition excluding self-modification/model-authored runtime plugins.

## Cross-Plan Global Constraints

- Implement from the approved base Spec + approved reusable-core amendment; do not resolve missing product decisions in code.
- Use isolated worktrees/branches for independently mergeable changes.
- Preserve DeepSeek Harness MIT license/provenance and a reachable upstream remote.
- Generic DSH core changes require evidence no documented extension point can express the requirement.
- Keep Plurora policy in `profiles/plurora`; do not leak it into Core/providers/integrations.
- Heavy/high-volume Plurora execution routes to MiMo V2.5 unless explicitly overridden for that run.
- Codex remains premium reasoning/review/diagnosis capacity; Codex availability fallback remains DeepSeek V4 Flash for reasoning/review/diagnosis and MiMo V2.5 for implementation/repair/heavy work.
- Availability fallback is explicit/durable; quality failure is not disguised as quota failure.
- Fresh-context certification is mandatory; high/critical risk requires configured independence.
- Per-run model/effort overrides may not mutate global OpenCode/Codex settings.
- Automatic repair applies only to confirmed eligible defect classes. Product/design ambiguity blocks instead of being invented away.
- Automated delivery may commit/push the current feature branch and open/update its PR; no force push/main implementation push/merge/release/deploy.
- Keep `git push*` denied in `neuro-via/opencode.jsonc`; scoped delivery belongs to Trick Harness, not general TUI agents.
- Database execution/validation is cloud-only on isolated Supabase Preview Branches; no local Docker/shadow DB/shared-dev fallback for unmerged DB changes.
- Migration files remain schema history; no ad-hoc hosted edits replace migrations.
- Durable runtime/model-visible state must be reconstructable without private chain-of-thought.
- Trusted Plurora composition excludes self-modification/model-authored runtime plugins.
- Verification checks authoritative world state, not worker completion claims.

## Merge/Execution Order

1. Verify/recreate `adsonpatrick/trick-harness` as the required real fork.
2. Execute and independently review Plan R Tasks 1-5 to establish reusable boundaries/profile seams.
3. Execute A with Plan R naming/path/type substitutions.
4. Execute B with profile-driven policy separation.
5. Complete the remaining Plan R cross-plan integration checks and independently review the assembled Trick Harness boundary.
6. Execute C against the exact known-good Trick Harness revision and `profile=plurora`.
7. Execute D and collect 35-row direct evidence.
8. Human remains merge authority for all PRs.

## Completion Contract

V2 is complete only when **all 30 base acceptance criteria plus R1-R5** have fresh direct PASS evidence, the final `neuro-via` integration pin references the independently verified `adsonpatrick/trick-harness` revision, the same Trick Harness build demonstrably supports both Plurora and minimal fixture profiles without Core changes, no material finding remains unresolved, and trusted runtime composition satisfies the Spec/amendment non-goals. A green package/provider/workflow or partial integration is not sufficient.