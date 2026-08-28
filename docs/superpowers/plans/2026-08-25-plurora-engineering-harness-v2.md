# Plurora Engineering Harness V2 — Implementation Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement these plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operate Plurora through the reusable Trick Harness runtime while preserving explicit project policy, deterministic mutation authority, native OpenCode/Codex authentication, and evidence-first activation.

## Current Status — Runtime Built, NeuroVia Installation Pending

Plans R, A, B and the Harness-side Plan D verification/remediation work have been implemented and merged in `adsonpatrick/trick-harness`. The remaining work is the deployment enablement introduced by the 2026-08-27 NeuroVia amendment, followed by the actual `adsonpatrick/neuro-via` installation and final activation reconciliation.

The active database decision changed on 2026-08-27: `neurovia-dev` (`uljaajwwnygopsyvwsre`) is now the explicitly authorized Supabase Cloud **development** database. Supabase Preview Branches remain an optional future isolation strategy, not a development prerequisite. This is a deliberate owner decision, not a fallback after Preview failure.

## Normative Documents

Apply these in precedence order:

1. explicit owner decisions;
2. `docs/superpowers/specs/2026-08-27-neurovia-harness-deployment-cloud-dev-amendment.md` for NeuroVia deployment, model registry and DB development authority;
3. `docs/superpowers/specs/2026-08-27-harness-v2-scope-amendment.md` for Claude removal and the historical Preview-entitlement scope decision where not superseded by item 2;
4. `docs/superpowers/specs/2026-08-25-plurora-engineering-harness-v2-reusable-core-amendment.md` for reusable-core/profile boundaries;
5. `docs/superpowers/specs/2026-08-25-plurora-engineering-harness-v2-design.md` for the base V2 architecture;
6. the plan overlays below before historical Plans C/D where they conflict.

The 2026-08-27 NeuroVia amendment specifically supersedes older statements that require Preview Branches for every DB-changing development workflow, prohibit `neurovia-dev` as an authorized development target, or imply that the NeuroVia bridge needs no runnable `composeHarness()` host.

## Active Plan Graph

```text
COMPLETED
R. Reusable Trick Core + profiles
              |
              v
A. Runtime foundation + OpenCode/Codex providers
              |
              v
B. Routing + durable engineering workflows
              |
              v
Remediation + Harness-side Plan D evidence

PENDING
E. Trick cloud-dev / Plurora host enablement
              |
              v
C*. NeuroVia installation amendment
              |
              v
D11/D12. Final pin reconciliation + V2 activation
```

## Completed Runtime Plans

### Plan R — Reusable Trick Core + Profiles

`2026-08-25-trick-harness-v2-reusable-core.md`

Established the real `adsonpatrick/trick-harness` fork, private `@trick-harness/*` workspaces, generic Core/providers/integrations, `HarnessProfile`, `profiles/plurora`, fixture-profile reuse evidence and project-policy boundaries.

### Plan A — Runtime Foundation

`2026-08-25-plurora-harness-v2-runtime-foundation.md`

Implemented the executor runtime and OpenCode/Codex product adapters using native product paths and without making Claude Code part of the active executor set.

### Plan B — Routing and Engineering Workflows

`2026-08-25-plurora-harness-v2-routing-workflows.md`

Implemented deterministic routing, fallback/circuit state, durable journal/replay, PR lifecycle, debugging/repair, QA/security stages, bounded GitHub delivery, Supabase Preview capability and loopback control server. Concrete Plurora policy remains in `profiles/plurora`.

### PR Review Remediation

`2026-08-26-harness-v2-pr-review-remediation.md` plus its four technical subplans.

Closed the six PR #1 findings and twelve PR #2 findings, including routing, quiescence, capability authority, durable-before-mutate, workflow identity, security repair gating and lifecycle composition.

### Harness-side Plan D Evidence

`2026-08-25-plurora-harness-v2-verification-rollout.md`

`docs/verification/2026-08-27-harness-v2-plan-d-evidence.md`

Real OpenCode, Codex, GitHub delivery, replay/quiescence and Supabase fail-closed evidence were collected. Plan D Tasks 11/12 remain intentionally dependent on the NeuroVia installation.

## Pending Plan E — Trick Cloud-Dev & Plurora Host Enablement

`2026-08-27-trick-harness-cloud-dev-deployment-enablement.md`

This plan is required **before** installing NeuroVia because two facts are now binding:

1. the workflow needs a generic deterministic database-verification seam so the Plurora deployment can use its reviewed `neuro-via` cloud-development verifier rather than requiring the built-in Preview strategy;
2. `@trick-harness/*` packages are private workspaces, so the runnable Plurora host must execute inside the exact-SHA Trick Harness checkout rather than being imported into `neuro-via` with fragile `file:../...` dependencies.

Plan E adds the generic database-verification capability, preserves the optional built-in Preview integration, creates the private Plurora runtime host, validates the deployment `ModelRegistry` against native OpenCode/Codex catalogues, and records a new known-good exact SHA for Plan C*.

## Pending Plan C* — NeuroVia Installation Amendment

`2026-08-27-neurovia-harness-installation-amendment.md`

This is the normative overlay on historical Plan C (`2026-08-25-plurora-harness-v2-neuro-via-integration.md`). Historical Plan C remains useful for command/skill/governance details where this overlay does not change them.

The installed topology is:

```text
OpenCode TUI in neuro-via
        |
        | bounded custom tools
        v
neuro-via control client / launcher
        |
        | loopback HTTP
        v
exact-SHA Trick Harness checkout
        |
        +-- Plurora host
        |    +-- profile=plurora
        |    +-- deployment ModelRegistry
        |    +-- OpenCode + Codex
        |    +-- GitHubDelivery
        |    +-- project DB verification capability
        |
        v
neurovia-dev (development only)
```

`neuro-via/plurora-harness.json` owns only non-secret deployment metadata: runtime repository/revision, profile/policy version, loopback URL, environment, authorized development DB ref and semantic-tier -> product-native model ids. It does not duplicate routing rules.

## Database Development Authority

Current Plurora development policy is:

```text
environment=development
configured DB strategy=shared-cloud-development
configured project ref=uljaajwwnygopsyvwsre
=> neurovia-dev is the only automatic development DB mutation target
```

A DB-changing workflow must:

```text
verify target/link identity
-> acquire cross-process mutation lock
-> reconcile migration history
-> refuse unexplained drift
-> db push dry-run
-> db push
-> re-read migration history
-> remote lint
-> pgTAP
-> RLS allow + deny
-> applicable integration/security checks
-> durable evidence
-> release lock
```

No canonical path may use local Docker/Supabase/Postgres, arbitrary remote project selection, production fallback, `migration repair`, remote reset or Dashboard-only schema authority.

When a future `neurovia-prod` project is created, it is a separate authority boundary. Existing Harness development permission does not transfer to production; production rollout requires a separate approved design.

## Model Registry Rule

`profiles/plurora` owns semantic-tier selection. Deployment owns only the native id resolution for these tiers:

```text
codex.fast
codex.balanced
codex.frontier
opencode.reasoning-fast
opencode.workhorse
```

OpenCode ids must be authenticated `provider/model` pairs advertised by the running product. Codex ids must appear in the pinned app-server `model/list` catalogue. Missing or unsupported mappings block host readiness. `DEFAULT_MODEL_REGISTRY` is never a production deployment fallback because it contains human/product names, not guaranteed provider-native ids.

## Final Activation

After Plan E and Plan C* are complete, execute the remaining Plan D NeuroVia tasks:

1. reconcile `neuro-via/plurora-harness.json` to the final independently reviewed Trick Harness SHA;
2. run the bridge health check and one real read-only workflow from the OpenCode TUI;
3. collect cloud-development DB evidence when a real migration is present, otherwise record target/history/dry-run evidence without inventing a migration;
4. verify no TUI push authority, no global model-config mutation, no local DB canonical path and no committed secrets;
5. update operator documentation and activation evidence;
6. keep merge/release/deploy human-controlled.

## Completion Contract

Harness V2 is activated for Plurora only when the final NeuroVia pin references the post-amendment reviewed Trick Harness SHA; the runnable host starts from that exact clean checkout; the complete deployment ModelRegistry is accepted by the native products; OpenCode can run/status/cancel through the bounded bridge; `neurovia-dev` is the sole authorized development DB mutation target with serialized, drift-safe, cloud-only migration verification; production remains unreachable by automatic development authority; all required retained acceptance criteria plus reusable-core and ND1-ND12 amendment criteria have direct evidence; and no confirmed material finding remains unresolved.
