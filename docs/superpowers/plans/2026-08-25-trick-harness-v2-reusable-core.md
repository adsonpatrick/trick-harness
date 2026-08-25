# Trick Harness V2 Reusable Core and Project Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Trick Harness as a reusable engineering runtime whose Core, providers, and integrations are project-agnostic while Plurora behavior is supplied by a first-class `plurora` profile.

**Architecture:** Preserve the DeepSeek Harness fork/core as upstream-friendly as possible. Reusable mechanism lives under `packages/core`, executor adapters under `packages/providers`, external capabilities under `packages/integrations`, and project policy under `profiles`. `neuro-via` consumes the same runtime by selecting `profile=plurora`; a minimal test-only profile proves reuse without building a second product.

**Tech Stack:** DeepSeek Harness/Cordis, TypeScript strict ESM, pnpm/Vitest, OpenCode server/SDK/ACP, Codex app-server/CLI, Claude Agent SDK/CLI, Git/GitHub, Supabase Branching/Postgres/pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-25-plurora-engineering-harness-v2-design.md` plus `docs/superpowers/specs/2026-08-25-plurora-engineering-harness-v2-reusable-core-amendment.md`

## Global Constraints

- Canonical runtime repository: `adsonpatrick/trick-harness`.
- Before runtime code, verify `trick-harness` is a real GitHub fork of `deepseek-ai/deepseek-harness` with upstream ancestry and MIT notice.
- Generic packages use `@trick-harness/*`, are `private: true`, and are never published under `@deepseek-ai`.
- `packages/core/**`, `packages/providers/**`, and `packages/integrations/**` must not import `profiles/plurora` or `neuro-via`.
- Core owns mechanism; profiles own project policy.
- Plurora routing/fallback/QA/security/delivery/DB behavior remains exactly as approved in the base Spec.
- Initial Plurora profile policy version is exactly `plurora-v2.0.0`.
- The same runtime build must load `plurora` and a minimal test-only profile without Core edits.
- Per-run model/effort selection must never rewrite user/global OpenCode or Codex configuration.
- Trusted profile composition excludes DSH self-modification/model-authored runtime plugins.
- This plan is normative wherever earlier A/B/C/D plans conflict on repository name, package path, package scope, runtime type naming, or ownership of policy.

---

## Task 1: Verify and Baseline the Canonical Real Fork

**Files (Trick Harness):**
- Preserve: `LICENSE`
- Create: `docs/trick-harness/upstream.md`
- Create: `.agents/notes/implemented/architecture/2026-08-25-trick-harness-fork-foundation.md`

**Produces:** a cloneable `adsonpatrick/trick-harness` repository with verified DeepSeek Harness fork ancestry, exact upstream baseline, provenance rules, and no Trick-specific behavioral change.

**Interfaces:**
- Produces `TRICK_HARNESS_BASE_SHA`: exact 40-hex fork SHA recorded after clone.
- Produces `DEEPSEEK_UPSTREAM_BASE_SHA`: exact 40-hex upstream SHA recorded after fetch.

- [ ] **Step 1: Verify repository identity before mutation**

```bash
gh repo view adsonpatrick/trick-harness --json nameWithOwner,isFork,parent,defaultBranchRef,url
gh repo view deepseek-ai/deepseek-harness --json nameWithOwner,defaultBranchRef,url
git --version
gh --version
```

Expected: `isFork=true` and `parent.nameWithOwner=deepseek-ai/deepseek-harness`. If false or parent is absent, return `PLAN_BLOCKED`; do not populate an empty independent repository and call it a fork.

- [ ] **Step 2: Clone and establish remotes**

```bash
gh repo clone adsonpatrick/trick-harness
cd trick-harness
git remote -v
```

Ensure `origin` points to `adsonpatrick/trick-harness` and `upstream` points to `https://github.com/deepseek-ai/deepseek-harness.git`. Add `upstream` if missing.

- [ ] **Step 3: Record exact baselines**

```bash
git rev-parse HEAD
git fetch upstream --tags
git rev-parse upstream/master
git merge-base HEAD upstream/master
```

Write the exact returned SHAs and current DSH version/release to `docs/trick-harness/upstream.md`. Do not substitute the older planning baseline if upstream moved.

- [ ] **Step 4: Prove clean upstream behavior**

```bash
corepack enable
pnpm install
pnpm run typecheck
pnpm run test
```

If baseline is red, capture the exact upstream failure and stop before Trick changes until it is classified.

- [ ] **Step 5: Document fork invariants**

`docs/trick-harness/upstream.md` records upstream repository, initial SHA, MIT preservation, `upstream` sync procedure, divergence-ledger rule, and the rule that edits to generic upstream packages require evidence no extension seam suffices.

- [ ] **Step 6: Commit provenance slice**

```bash
git add LICENSE docs/trick-harness .agents/notes
git diff --cached --check
git commit -m "docs(trick): record harness fork provenance"
```

---

## Task 2: Establish Reusable Workspace Namespaces and Boundary Enforcement

**Files (Trick Harness):**
- Modify: `scripts/check-workspace-constraints.ts`
- Modify: `scripts/check-workspace-constraints.spec.ts`
- Modify: `tsconfig.base.json`
- Create: `scripts/check-trick-boundaries.ts`
- Create: `scripts/check-trick-boundaries.spec.ts`
- Create: `packages/core/profile/package.json`
- Create: `packages/core/profile/tsconfig.json`
- Create: `packages/core/profile/src/index.ts`
- Create: `packages/core/profile/src/invariant.ts`
- Create: `packages/core/profile/README.md`

**Produces:** enforced package layout and dependency direction for Core/providers/integrations/profiles.

**Interfaces:**
- `@trick-harness/*` is the canonical fork-local import namespace.
- `check-trick-boundaries` becomes a required repository gate.

- [ ] **Step 1: Write RED workspace tests**

Add exact cases proving:

```text
packages/core/profile + @trick-harness/profile + private:true -> allowed
packages/providers/opencode + @trick-harness/provider-opencode + private:true -> allowed
packages/integrations/github-delivery + @trick-harness/integration-github-delivery + private:true -> allowed
@trick-harness/* with private:false -> rejected
@trick-harness/* outside approved fork-local paths -> rejected
fork-local package with publishConfig -> rejected
existing upstream release-package rules remain unchanged
```

- [ ] **Step 2: Run focused RED**

```bash
pnpm vitest run scripts/check-workspace-constraints.spec.ts
```

- [ ] **Step 3: Implement path-specific workspace rules**

Allow `@trick-harness/*` only under:

```text
packages/core/*
packages/providers/*
packages/integrations/*
```

Require `private: true` and absent `publishConfig`. Do not relax `@deepseek-ai/dsh-*` release rules.

- [ ] **Step 4: Add TypeScript source mappings**

Extend `tsconfig.base.json` with the narrowest mappings compatible with the actual workspace for `@trick-harness/*` packages, preserving all upstream mappings.

- [ ] **Step 5: Write RED architecture-boundary tests**

Create fixtures that intentionally import `profiles/plurora` from Core/provider/integration packages and assert rejection. Add strong-identifier cases for `adsonpatrick/neuro-via`, `neurovia-dev`, `uljaajwwnygopsyvwsre`, `Notion`, `Linear`, and `Plurora Design System` inside generic package source.

- [ ] **Step 6: Implement the boundary checker**

Scan source imports and selected strong identifiers under `packages/core`, `packages/providers`, and `packages/integrations`. Do not reject profile tests or repository-level provenance/docs that intentionally mention Plurora.

- [ ] **Step 7: Verify GREEN and wire the gate**

```bash
pnpm vitest run scripts/check-workspace-constraints.spec.ts scripts/check-trick-boundaries.spec.ts
pnpm run constraints
```

Add `check-trick-boundaries` to the normal constraints/hygiene path.

- [ ] **Step 8: Commit boundary slice**

```bash
git add scripts tsconfig.base.json packages/core/profile
git diff --cached --check
git commit -m "build(trick): enforce reusable harness boundaries"
```

---

## Task 3: Define and Validate the Generic Harness Profile Contract

**Files:**
- Create: `packages/core/profile/src/types.ts`
- Modify: `packages/core/profile/src/index.ts`
- Modify: `packages/core/profile/src/invariant.ts`
- Create: `packages/core/profile/tests/profile.spec.ts`
- Modify: `packages/core/profile/README.md`
- Modify: `tsconfig.host.json`

**Produces:** a typed project-policy seam consumed by Core without importing any concrete profile.

**Interfaces:**

```ts
export interface PolicyRuleDefinition {
  readonly id: string
  readonly when: Readonly<Record<string, string | number | boolean>>
  readonly use: Readonly<Record<string, string | number | boolean>>
}

export interface RoutingPolicyDefinition {
  readonly rules: readonly PolicyRuleDefinition[]
  readonly fallbackRules: readonly PolicyRuleDefinition[]
}

export interface WorkflowPolicyDefinition {
  readonly maxRepairCycles: number
  readonly maxExecutorStarts: number
}

export interface IndependencePolicyDefinition {
  readonly low: 'fresh-context'
  readonly medium: 'cross-executor-preferred'
  readonly high: 'cross-executor-required'
  readonly critical: 'cross-executor-required'
}

export interface QaPolicyDefinition {
  readonly rules: readonly PolicyRuleDefinition[]
}

export interface SecurityPolicyDefinition {
  readonly rules: readonly PolicyRuleDefinition[]
}

export interface IntegrationPolicyDefinition {
  readonly enabled: readonly string[]
  readonly rules: readonly PolicyRuleDefinition[]
}

export interface TrustedCompositionDefinition {
  readonly excludedPluginIds: readonly string[]
}

export interface HarnessProfile {
  readonly id: string
  readonly policyVersion: string
  readonly routingPolicy: RoutingPolicyDefinition
  readonly workflowPolicy: WorkflowPolicyDefinition
  readonly independencePolicy: IndependencePolicyDefinition
  readonly qaPolicy: QaPolicyDefinition
  readonly securityPolicy: SecurityPolicyDefinition
  readonly integrationPolicy: IntegrationPolicyDefinition
  readonly trustedComposition: TrustedCompositionDefinition
}

export interface HarnessProfileRegistry {
  register(profile: HarnessProfile): { dispose(): void }
  get(id: string): HarnessProfile
  list(): readonly HarnessProfile[]
}
```

Policy definitions are deterministic data. They do not accept model-authored runtime source code.

- [ ] **Step 1: Write RED contract tests** for blank ID, invalid policy version, duplicate profile ID, missing required policy block at parsed boundaries, negative/zero workflow budgets, absent exclusion list, unregister/disposal, and immutable lookup/list results.
- [ ] **Step 2: Run RED.**

```bash
pnpm vitest run packages/core/profile/tests/profile.spec.ts
```

- [ ] **Step 3: Implement minimal registry and validation.** Follow Cordis effect ownership if that is the repository convention at implementation time.
- [ ] **Step 4: Add runtime invariant** proving registry IDs and registrations agree with owned runtime state.
- [ ] **Step 5: Document dependency rule:** Core consumes `HarnessProfile`; Core never imports profile implementations.
- [ ] **Step 6: Verify.**

```bash
pnpm vitest run packages/core/profile/tests/profile.spec.ts
pnpm run typecheck
pnpm run constraints
```

- [ ] **Step 7: Commit.**

```bash
git add packages/core/profile tsconfig.host.json
git commit -m "feat(trick): add project profile contract"
```

---

## Task 4: Create the Plurora Profile as Policy, Not Runtime Mechanism

**Files:**
- Create: `profiles/plurora/profile.ts`
- Create: `profiles/plurora/routing-policy.ts`
- Create: `profiles/plurora/workflow-policy.ts`
- Create: `profiles/plurora/qa-policy.ts`
- Create: `profiles/plurora/security-policy.ts`
- Create: `profiles/plurora/integrations.ts`
- Create: `profiles/plurora/tests/profile.spec.ts`
- Create: `profiles/plurora/README.md`

**Produces:** `pluroraProfile: HarnessProfile` containing approved Plurora policy only.

**Interfaces:**

```ts
export const pluroraProfile: HarnessProfile = {
  id: 'plurora',
  policyVersion: 'plurora-v2.0.0',
  // policy blocks supplied by this directory
}
```

- [ ] **Step 1: Write RED routing-policy table tests** proving Plurora defaults:
  - refine/plan -> DeepSeek V4 Flash;
  - small/medium implementation -> MiMo V2.5;
  - heavy/high-volume implementation/refactor/test repair -> MiMo V2.5 hard invariant unless explicit user override;
  - routine review/difficult diagnosis/QA charter -> Codex balanced + `high` when available;
  - configured high-risk/security/Auth/RLS analysis -> Codex frontier + `xhigh`;
  - exceptional reasoning can escalate to `max` only after escalation criteria.
- [ ] **Step 2: Add RED fallback/independence tests** proving the approved Codex availability fallback and fresh/cross-executor policy.
- [ ] **Step 3: Add RED integration-policy tests** proving GitHub delivery is enabled with no merge authority and DB-changing work requires Supabase Preview Branch with no shared-dev/local fallback.
- [ ] **Step 4: Add RED workflow-budget tests** for `maxRepairCycles=3` and `maxExecutorStarts=24`.
- [ ] **Step 5: Add RED trusted-composition test** proving self-modification/model-authored runtime plugin IDs are excluded.
- [ ] **Step 6: Implement profile policy tables only.** Do not implement routing engine, fallback engine, GitHub delivery, Supabase lifecycle, QA engine, or workflow state machine here.
- [ ] **Step 7: Verify.**

```bash
pnpm vitest run profiles/plurora/tests/profile.spec.ts
pnpm run constraints
```

- [ ] **Step 8: Commit.**

```bash
git add profiles/plurora
git commit -m "feat(plurora): add Trick Harness project profile"
```

---

## Task 5: Add a Test-Only Minimal Profile and Dual-Profile Composition Proof

**Files:**
- Create: `profiles/fixtures/minimal/profile.ts`
- Create: `profiles/fixtures/minimal/tests/profile.spec.ts`
- Create: `tests/trick-harness/dual-profile.spec.ts`

**Produces:** direct evidence that Trick Harness Core is reusable without building another supported product.

**Interfaces:**

```ts
export const minimalFixtureProfile: HarnessProfile = {
  id: 'fixture-minimal',
  policyVersion: 'fixture-v1.0.0',
  // intentionally different deterministic policy from Plurora
}
```

The fixture disables optional integrations and uses a different deterministic routing table.

- [ ] **Step 1: Write RED boot test** composing Core + fixture profile while intentionally excluding `profiles/plurora` from loader input.
- [ ] **Step 2: Write RED dual-profile test** executing the same deterministic fake objective with `plurora` and `fixture-minimal`; assert different route decisions without Core source changes.
- [ ] **Step 3: Write RED import-isolation assertion** proving the fixture runtime module graph contains no `profiles/plurora` path.
- [ ] **Step 4: Implement only fixture policy/loader registration required by the tests.**
- [ ] **Step 5: Verify R1/R3/R4 evidence.**

```bash
pnpm vitest run profiles/fixtures/minimal/tests tests/trick-harness/dual-profile.spec.ts
pnpm run constraints
```

- [ ] **Step 6: Commit.**

```bash
git add profiles/fixtures tests/trick-harness
git commit -m "test(trick): prove reusable dual-profile runtime"
```

---

## Task 6: Apply the Normative Mapping to Plans A and B

**Files:**
- No production files solely for this task. This is an execution ruling applied to every A/B task brief before dispatch.

**Produces:** A/B implementation using reusable layout/names and profile-driven policy rather than historical `packages/plurora/*` assumptions.

**Normative mapping:**

```text
PluroraExecutorRuntime                -> HarnessExecutorRuntime
packages/plurora/executor             -> packages/core/executor
packages/plurora/contracts            -> packages/core/contracts
packages/plurora/routing              -> packages/core/routing
packages/plurora/journal              -> packages/core/journal
packages/plurora/workflow             -> packages/core/workflow
packages/plurora/control-server       -> packages/core/control-server
packages/plurora/bundle               -> packages/core/bundle
packages/plurora/executor-opencode    -> packages/providers/opencode
packages/plurora/executor-codex       -> packages/providers/codex
packages/plurora/executor-claude-code -> packages/providers/claude-code
packages/plurora/delivery-github      -> packages/integrations/github-delivery
packages/plurora/supabase-preview     -> packages/integrations/supabase-preview
@plurora/harness-*                    -> @trick-harness/*
adsonpatrick/plurora-harness          -> adsonpatrick/trick-harness
```

- [ ] **Step 1: Before each A/B task, generate its SDD task brief then apply this mapping** and record substitutions/rulings in that plan's ledger.
- [ ] **Step 2: Keep mechanism generic.** Router/fallback engines accept profile policy; QA/security/workflow engines consume policy contracts; GitHub/Supabase integrations expose capabilities without assuming Plurora requires them.
- [ ] **Step 3: Put Plurora expected-route tables in `profiles/plurora/tests`.** Generic package tests use fixture policy where a profile is required.
- [ ] **Step 4: After A/B completion run:**

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run constraints
pnpm run hygiene
pnpm run doc-sync
```

- [ ] **Step 5: Run an independent architecture review** focused on mechanism/policy separation, prohibited lower->profile dependencies, and upstream divergence.

---

## Task 7: Amend Plan C Consumption Contract

**Files (`neuro-via`, implemented under Plan C):**
- Create/modify: `plurora-harness.json`
- Modify: `scripts/harness/config.mjs`
- Modify: `scripts/harness/config.test.mjs`
- Modify bridge tests as required

**Produces:** `neuro-via` selects Trick Harness + Plurora profile without duplicating profile policy.

**Interfaces:**

`plurora-harness.json` contains only non-secret metadata. At implementation, `revision` is set to the exact 40-hex independently verified Trick Harness SHA produced by the completed Harness plans; it must never be a branch/tag. Other required values are fixed:

```json
{
  "repository": "adsonpatrick/trick-harness",
  "profile": "plurora",
  "controlServerUrl": "http://127.0.0.1:47831",
  "supabaseParentProjectRef": "uljaajwwnygopsyvwsre"
}
```

The actual committed object also includes `revision` with the captured exact SHA.

- [ ] **Step 1: Extend Plan C RED config tests** to require repository `adsonpatrick/trick-harness`, `profile='plurora'`, loopback URL `http://127.0.0.1:47831`, and an exact 40-hex revision.
- [ ] **Step 2: Reject unknown/missing profile before workflow start.**
- [ ] **Step 3: Prove the bridge forwards profile ID but contains no MiMo/Codex fallback/risk-policy tables.**
- [ ] **Step 4: Preserve Plan C safety requirements:** TUI `git push*` denied, no secret-bearing committed config, cloud-only DB scripts, explicit Spec/Plan approval gates.
- [ ] **Step 5: Add R5 to Plan C completion evidence.**

---

## Task 8: Amend Plan D Verification and Rollout Contract

**Files:**
- Modify/create at execution: `docs/agents/harness-v2-evidence.md`
- Add Trick Harness evidence through repository test/evidence conventions

**Produces:** final activation evidence for original V2 criteria plus reusable-core criteria.

- [ ] **Step 1: Extend the acceptance ledger from 30 rows to 35 rows**, preserving 1-30 and adding R1-R5.
- [ ] **Step 2: Add R1 evidence** from dependency/boundary tests and source graph inspection.
- [ ] **Step 3: Add R2 evidence** from `profiles/plurora` policy tests plus assembled real workflow evidence already required by criteria 10-27.
- [ ] **Step 4: Add R3/R4 evidence** from minimal fixture/dual-profile tests through the real Trick Harness composition path.
- [ ] **Step 5: Add R5 evidence** from committed `neuro-via` config plus bridge inspection proving profile policy is not duplicated in generic Core.
- [ ] **Step 6: Final PASS requires `30/30 + R1-R5 PASS`**, all real provider/GitHub/Supabase evidence required by Plan D, and no unresolved material finding.

---

## Task 9: Update Active Planning and Runtime Naming

**Files (`neuro-via`):**
- Modify: `docs/superpowers/plans/2026-08-25-plurora-engineering-harness-v2.md`
- Later runtime/operator docs use **Trick Harness** for generic runtime and **Plurora profile** for project policy.

- [ ] **Step 1: Replace canonical runtime repository in the active index** with `adsonpatrick/trick-harness`.
- [ ] **Step 2: Change execution order to `R -> A -> B -> C -> D`.**
- [ ] **Step 3: State precedence:** approved reusable-core amendment supersedes base Spec only for changed boundaries/naming; Plan R mapping is normative wherever historical A/B/C/D text conflicts.
- [ ] **Step 4: Preserve Plurora-specific names for project-local skills/config/docs where they actually describe Plurora behavior.**
- [ ] **Step 5: Scan active amendment/index/Plan R for stale canonical references:** `adsonpatrick/plurora-harness`, `packages/plurora/`, and `@plurora/harness-`. Historical A/B files may retain them only because this plan explicitly supersedes them.

## Plan R Completion Contract

Plan R is complete when the canonical runtime is a verified real fork at `adsonpatrick/trick-harness`, reusable namespace/boundary tests exist, `HarnessProfile` is a validated Core seam, Plurora policy lives in `profiles/plurora`, a minimal fixture profile proves Core reuse, A/B execution uses the normative reusable-path mapping, C selects `repository=adsonpatrick/trick-harness` + `profile=plurora`, and D certifies **30/30 + R1-R5 PASS**.