# Plurora Engineering Harness V2 — Reusable Trick Harness Core Amendment

**Date:** 2026-08-25  
**Status:** Approved — owner approval confirmed 2026-08-25  
**Amends:** `2026-08-25-plurora-engineering-harness-v2-design.md`  
**Canonical runtime repository:** `adsonpatrick/trick-harness`  
**Scope:** Package boundaries, project profiles, dependency direction, naming, reuse guarantees, and acceptance evidence for the Harness runtime

## 1. Why this amendment exists

The approved V2 design correctly separates the Plurora product repository from the Harness runtime, but the first implementation plan placed most new runtime packages under `packages/plurora/*`. That shape would make Plurora-specific behavior easy to leak into executor, routing, workflow, journal, delivery, and control-server code.

The Harness must instead be reusable across future projects. Plurora remains its first consumer and first production profile, not the definition of the runtime itself. The reusable runtime is named **Trick Harness** and lives in `adsonpatrick/trick-harness`.

This amendment changes where project-specific policy lives, not the approved V2 lifecycle or Plurora behavior. Automatic routing, MiMo/Codex policy, quota fallback, first-class debugging, QA, scoped delivery, cloud-only Supabase verification, durable replay, and human merge authority remain unchanged for `profile=plurora`.

## 2. Fork/provenance requirement remains binding

`adsonpatrick/trick-harness` must be a real fork of `deepseek-ai/deepseek-harness`, preserving upstream ancestry and the MIT notice. An empty repository, history-less copy, archive upload, or mirror without the approved GitHub fork relationship does not satisfy this requirement.

The repository observed at amendment approval time existed but was empty. That condition has since been resolved: the canonical repository is now a real GitHub fork of `deepseek-ai/deepseek-harness`.

## 3. Binding architectural decision

The fork is organized into four conceptual layers:

```text
adsonpatrick/trick-harness
|
+-- packages/core/            reusable orchestration/runtime capabilities
+-- packages/providers/       reusable executor adapters
+-- packages/integrations/    reusable external-system capabilities
+-- profiles/                 project-specific composition and policy
    +-- plurora/              first production profile
```

Dependency direction is one-way:

```text
core
  ^
  |
providers / integrations
  ^
  |
profiles
  ^
  |
project bridge (for example neuro-via)
```

A lower layer must not import a higher layer.

In particular:

- `packages/core/**` MUST NOT import from `profiles/**`;
- providers MUST NOT contain Plurora routing/business policy;
- integrations MUST expose capabilities, not decide whether a project should use them;
- `profiles/plurora/**` may compose core/providers/integrations and define Plurora policy;
- `neuro-via` selects the `plurora` profile through bridge/configuration and remains owner of repository-local instructions/skills.

## 4. Normative repository layout

The following paths supersede `packages/plurora/*` in earlier plans:

```text
packages/
  core/
    executor/
    contracts/
    profile/
    routing/
    journal/
    workflow/
    control-server/
    bundle/

  providers/
    opencode/
    codex/
    claude-code/

  integrations/
    github-delivery/
    supabase-preview/

profiles/
  plurora/
    profile.ts
    routing-policy.ts
    workflow-policy.ts
    qa-policy.ts
    security-policy.ts
    integrations.ts
    tests/

  fixtures/
    minimal/
```

Exact file splitting may follow upstream DSH conventions, but these ownership boundaries are normative.

### 4.1 Old-plan path mapping

| Earlier planned path | Normative path |
| --- | --- |
| `packages/plurora/executor` | `packages/core/executor` |
| `packages/plurora/contracts` | `packages/core/contracts` |
| `packages/plurora/routing` | `packages/core/routing` |
| `packages/plurora/journal` | `packages/core/journal` |
| `packages/plurora/workflow` | `packages/core/workflow` |
| `packages/plurora/control-server` | `packages/core/control-server` |
| `packages/plurora/bundle` | `packages/core/bundle` |
| `packages/plurora/executor-opencode` | `packages/providers/opencode` |
| `packages/plurora/executor-codex` | `packages/providers/codex` |
| `packages/plurora/executor-claude-code` | `packages/providers/claude-code` |
| `packages/plurora/delivery-github` | `packages/integrations/github-delivery` |
| `packages/plurora/supabase-preview` | `packages/integrations/supabase-preview` |

`packages/core/profile` and `profiles/plurora` are required surfaces introduced by this amendment.

## 5. Fork-local package naming

Fork-local packages use a reusable private scope:

```text
@trick-harness/executor
@trick-harness/contracts
@trick-harness/profile
@trick-harness/routing
@trick-harness/journal
@trick-harness/workflow
@trick-harness/control-server
@trick-harness/provider-opencode
@trick-harness/provider-codex
@trick-harness/provider-claude-code
@trick-harness/integration-github-delivery
@trick-harness/integration-supabase-preview
```

These packages remain `private: true` unless a future approved design explicitly introduces publishing. Do not create fork-local packages under `@deepseek-ai`.

## 6. Core versus profile responsibility

### 6.1 Core owns mechanism

Reusable Core owns:

- executor registration/capability validation;
- deterministic routing engine;
- semantic model-registry mechanism;
- provider availability/failure classification contracts;
- fallback/circuit-breaker mechanism;
- durable workflow journal and replay;
- workflow/stage state machine;
- finding/diagnosis/verdict contracts;
- bounded handoffs;
- cancellation/teardown;
- control-server lifecycle;
- generic debugging/repair lifecycle;
- generic QA/review/security stage orchestration;
- generic policy interfaces.

Core MUST NOT know:

- `neuro-via` paths;
- Notion/Linear ownership rules;
- concrete Plurora model preferences;
- that Plurora uses Supabase or GitHub delivery;
- Plurora Design System rules;
- Plurora-specific QA evidence catalogs.

### 6.2 Providers own product adapters

Providers translate resolved executor requests into official product runtimes. They own OpenCode server/SDK/ACP invocation, Codex app-server/CLI/native account behavior, Claude Agent SDK/CLI invocation, per-run override support, safe availability classification, process ownership, cancellation and bounded structured results. Providers do not choose project routing policy.

### 6.3 Integrations own external capabilities

Reusable integrations expose bounded operations such as GitHub feature-branch delivery and Supabase Preview Branch provision/apply/verify/cleanup. They enforce safety invariants but do not decide whether a project requires them.

### 6.4 Project profiles own policy

`profiles/plurora` owns the approved Plurora choices:

- model aliases and concrete routing defaults;
- heavy/high-volume work -> MiMo V2.5 invariant;
- Codex premium reasoning/review/diagnosis usage;
- Codex availability fallback matrix;
- risk -> independence requirements;
- QA evidence/risk policy;
- security triggers/policy references;
- GitHub delivery enablement and branch policy;
- Supabase Preview Branch requirement for DB-changing work;
- repair/executor budgets when project-level values differ from Core defaults;
- trusted bundle composition, including exclusion of self-modification/model-authored runtime plugins.

A future project may create another profile without modifying Core packages.

## 7. Profile contract

Core exposes a typed profile seam. Exact TypeScript decomposition is implementation detail, but the logical contract includes at least:

```text
HarnessProfile
  id
  policyVersion
  routingPolicy
  workflowPolicy
  independencePolicy
  qaPolicy
  securityPolicy
  integrationPolicy
  trustedComposition
```

A profile is declarative/configurational. It may provide deterministic functions or tables, but it does not replace the trusted workflow state machine with model-authored code.

The runtime validates a profile before starting a workflow and records `profileId` + `policyVersion` in durable workflow-start/route facts.

## 8. Plurora remains the first production profile

For `profile=plurora`, the approved V2 behavior remains binding:

- routine refinement/planning -> DeepSeek V4 Flash;
- small/medium and heavy implementation -> MiMo V2.5, with heavy/high-volume MiMo V2.5 required unless explicit per-run user override;
- Codex balanced/high for routine independent review/difficult diagnosis where available;
- Codex frontier/xhigh for configured high-risk/security-sensitive reasoning;
- Codex availability fallback -> DeepSeek V4 Flash for reasoning/review/diagnosis and MiMo V2.5 for implementation/repair/heavy execution;
- fresh review and configured cross-executor independence;
- first-class debugging/repair and QA;
- scoped GitHub delivery without merge authority;
- Supabase Preview Branch cloud-only DB workflow;
- automatic repair only for confirmed eligible defect classes;
- no product/design guessing to obtain green status.

## 9. `neuro-via` integration impact

`plurora-harness.json` (name retained as project integration metadata unless implementation finds a clearer backward-compatible name) selects:

```text
repository: adsonpatrick/trick-harness
profile: plurora
```

The bridge sends objective/context to Trick Harness and does not reimplement profile policy.

Project-local skills such as `debug-plurora`, `qa-plurora`, database-change rules, Design System instructions, and operating-model documentation remain in `neuro-via` because they are repository context consumed by workers.

## 10. Proof of reuse without building a second product

V2 does not build a second production project merely to demonstrate abstraction. The Harness repository adds a minimal **test-only fixture profile** proving:

- Core boots without `profiles/plurora`;
- the same runtime can load two different profiles;
- profile-specific routing tables can differ without changing Core code;
- Core/provider/integration packages do not import Plurora profile modules;
- no `neuro-via`/Notion/Linear/Design-System assumption is required to run generic workflow fixtures.

The fixture is test evidence, not a supported end-user profile.

## 11. Dependency and boundary enforcement

Workspace/architecture tests enforce at minimum:

```text
packages/core/**          !-> profiles/**
packages/providers/**     !-> profiles/**
packages/integrations/**  !-> profiles/**
profiles/**               -> core/providers/integrations allowed
```

A static boundary test rejects strong project-specific identifiers inside generic packages, including:

```text
adsonpatrick/neuro-via
neurovia-dev
uljaajwwnygopsyvwsre
Notion
Linear
Plurora Design System
```

The word `plurora` may appear in provenance or tests that intentionally exercise the Plurora profile, but consuming-product policy identifiers stay in `profiles/plurora` or the consuming repository.

## 12. Upstream maintenance impact

- generic DSH core stays as close to upstream as possible;
- new reusable behavior lives in fork-local packages;
- project policy is isolated under `profiles/`;
- material changes to upstream packages such as Codex transport require divergence notes;
- upstream merges can update adapters/core without mixing Plurora policy into generic mechanisms.

## 13. Additional acceptance criteria

The original 30 V2 criteria remain unchanged. This amendment adds five structural criteria:

**R1.** Generic Core/provider/integration packages have no dependency on `profiles/plurora` or `neuro-via`.

**R2.** `profiles/plurora` reproduces all binding Plurora routing/fallback/QA/security/DB/delivery behavior from the approved base Spec.

**R3.** A test-only minimal fixture profile boots through the same runtime without loading Plurora policy.

**R4.** The same Trick Harness build executes deterministic fixture workflows under both the Plurora profile and minimal fixture profile without modifying Core code.

**R5.** `neuro-via` selects the Plurora profile through configuration/bridge metadata; project-specific rules are not duplicated into generic Trick Harness Core.

Completion under the amended design requires **30/30 base criteria + R1-R5 PASS**.

## 14. Explicitly unchanged decisions

This amendment does not change the real-fork requirement, OpenCode TUI cockpit, automatic routing, manual override, Plurora MiMo heavy-work rule, Codex fallback, native executor authentication, first-class debugging/QA, automatic PR/review/confirmed-bug repair, human merge authority, cloud-only Supabase Preview Branch rule, durable replay/world verification, Claude compatibility criterion, or exclusion of self-modification/model-authored runtime plugins from trusted Plurora composition.

## 15. Plan impact

Implementation planning must now:

1. establish reusable boundaries/profile seam before executor/workflow implementation;
2. replace old `packages/plurora/*` and `@plurora/harness-*` assumptions;
3. move routing/fallback/QA/security/integration policy tables into `profiles/plurora` while leaving mechanisms in Core;
4. make `neuro-via` select `repository=adsonpatrick/trick-harness` and `profile=plurora` without duplicating policy;
5. extend final evidence from 30/30 to 30/30 + R1-R5;
6. add static dependency-boundary and dual-profile fixture tests;
7. retain old plans only as historical planning inputs where superseded by the amended plan index.