# Plurora Engineering Harness V2 — Implementation Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement these plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operate Plurora through the reusable Trick Harness runtime while preserving explicit project policy, deterministic mutation authority, native OpenCode/Codex authentication, approved-artifact traceability, Definition of Done certification, and evidence-first activation.

## Current Status — Runtime Built, Deployment/Conformance Enablement Pending

Plans R, A, B and the Harness-side Plan D verification/remediation work have been implemented and merged in `adsonpatrick/trick-harness`. Remaining work is: cloud-development/host enablement, the newly approved Implementation Conformance & DoD gate, the NeuroVia installation/wiring, then final Plan D reconciliation and activation.

The active database decision remains: `neurovia-dev` (`uljaajwwnygopsyvwsre`) is the explicitly authorized Supabase Cloud **development** database. Preview Branches remain an optional future isolation strategy, not a prerequisite or fallback.

The active PR-readiness decision added on 2026-08-28 is: a PR cannot become `PR_READY` unless a first-class read-only `conformance` stage proves the final published implementation satisfies the approved Spec, approved Superpowers Plan and applicable Plurora DoD, followed by fresh final verification.

## Normative Documents — Precedence

Apply these in order:

1. explicit owner decisions;
2. `docs/superpowers/specs/2026-08-28-harness-v2-implementation-conformance-dod-amendment.md` for approved-artifact traceability, conformance/DoD certification, routing and `PR_READY`;
3. `docs/superpowers/specs/2026-08-27-neurovia-harness-deployment-cloud-dev-amendment.md` for NeuroVia deployment, model registry and cloud-development DB authority;
4. `docs/superpowers/specs/2026-08-27-harness-v2-scope-amendment.md` for Claude removal and historical Preview-entitlement scope where not superseded;
5. `docs/superpowers/specs/2026-08-25-plurora-engineering-harness-v2-reusable-core-amendment.md` for reusable-core/profile boundaries;
6. `docs/superpowers/specs/2026-08-25-plurora-engineering-harness-v2-design.md` for the base V2 architecture;
7. the active plan overlays below before historical Plans C/D where they conflict.

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
PR-review remediation + Harness-side Plan D evidence

PENDING
E. Trick cloud-dev / Plurora host enablement
              |
              v
F. Implementation Conformance & DoD gate
              |
              v
C*. NeuroVia installation
    + Conformance/DoD wiring overlay
              |
              v
D11/D12. Final pin reconciliation + V2 activation
```

## Completed Runtime Plans

### Plan R — Reusable Trick Core + Profiles

`2026-08-25-trick-harness-v2-reusable-core.md`

Established the real fork, private `@trick-harness/*` workspaces, generic Core/providers/integrations, `HarnessProfile`, `profiles/plurora`, fixture-profile reuse evidence and project-policy boundaries.

### Plan A — Runtime Foundation

`2026-08-25-plurora-harness-v2-runtime-foundation.md`

Implemented executor runtime and OpenCode/Codex product adapters using native product paths.

### Plan B — Routing and Engineering Workflows

`2026-08-25-plurora-harness-v2-routing-workflows.md`

Implemented deterministic routing/fallback, durable journal/replay, PR lifecycle, debugging/repair, QA/security, bounded GitHub delivery, Supabase Preview capability and loopback control server. Concrete Plurora policy remains in `profiles/plurora`.

### PR Review Remediation

`2026-08-26-harness-v2-pr-review-remediation.md` plus its technical subplans.

Closed the PR #1/#2 review findings around routing, quiescence, capability authority, durable-before-mutate, workflow identity, security repair gating and lifecycle composition.

### Harness-side Plan D Evidence

`2026-08-25-plurora-harness-v2-verification-rollout.md`

`docs/verification/2026-08-27-harness-v2-plan-d-evidence.md`

Real OpenCode, Codex, GitHub delivery, replay/quiescence and Supabase fail-closed evidence were collected. Plan D Tasks 11/12 remain dependent on final NeuroVia installation.

## Pending Plan E — Trick Cloud-Dev & Plurora Host Enablement

`2026-08-27-trick-harness-cloud-dev-deployment-enablement.md`

Adds the generic database-verification seam, keeps Preview as an optional strategy, creates the private runnable Plurora host inside the Trick checkout, validates native product model ids and adapts the fixed NeuroVia cloud DB verifier.

Any SHA recorded at the end of Plan E is **intermediate** after the 2026-08-28 conformance decision. NeuroVia may pin only the final independently reviewed post-Plan-F SHA.

## Pending Plan F — Implementation Conformance & Definition of Done

`2026-08-28-trick-harness-implementation-conformance-dod.md`

Plan F adds:

- first-class read-only role `conformance`;
- repository-local approved Spec/Plan path + SHA-256 identity on every implementation objective;
- deterministic manifest extraction of explicit Spec acceptance criteria, every Superpowers `### Task N:` Plan task, and baseline Plurora DoD obligations before model dispatch;
- structured `ConformanceContract` with full expected-ID coverage validation;
- lifecycle order `... review -> QA/security as applicable -> conformance -> verify-final`;
- `PR_READY` gate requiring conformance PASS plus final verification PASS;
- routing: low/medium `codex.balanced/high`, high/critical `codex.frontier/xhigh`;
- Codex-unavailable fallback to `opencode.reasoning-fast` with explicit degraded assurance and no high/critical cross-executor certification when implementation used OpenCode;
- bounded journal/control status containing hashes/counts/verdict/evidence, never documents/transcripts/reasoning.

The current deployment intent maps `codex.balanced` to the Terra class and `codex.frontier` to the Sol class, while actual product-native ids and supported efforts are discovered/validated from the authenticated Codex `model/list` catalogue.

## Pending Plan C* — NeuroVia Installation

Primary installation overlay:

`2026-08-27-neurovia-harness-installation-amendment.md`

Additional mandatory conformance wiring overlay:

`2026-08-28-neurovia-conformance-dod-wiring.md`

Execute both in the same NeuroVia integration branch. The conformance overlay requires `/implement` to identify the exact approved Spec and Plan, computes SHA-256 deterministically under the active worktree, sends those references through the bounded bridge, rejects path/symlink escape, updates `pr-readiness` to consume Harness conformance, and proves with a real fixture that an intentionally missing planned task prevents `PR_READY`.

The installed topology remains:

```text
OpenCode TUI in neuro-via
        |
        | bounded tools + approved Spec/Plan paths
        v
NeuroVia client/launcher
        |
        | loopback HTTP
        v
exact post-Plan-F Trick Harness checkout
        |
        +-- Plurora host
        |    +-- profile=plurora
        |    +-- deployment ModelRegistry
        |    +-- OpenCode + Codex
        |    +-- GitHubDelivery
        |    +-- project DB verification
        |    +-- conformance / DoD certification
        |
        v
neurovia-dev (development only)
```

## Database Development Authority

```text
environment=development
configured DB strategy=shared-cloud-development
configured project ref=uljaajwwnygopsyvwsre
=> neurovia-dev is the only automatic development DB mutation target
```

A DB-changing workflow must verify target identity, serialize mutation, reconcile migration history, refuse unexplained drift, dry-run/apply/re-read migrations, run remote lint, pgTAP, RLS allow+deny, applicable integration/security checks and durable evidence. No canonical local Docker/Supabase/Postgres, arbitrary remote target, production fallback, automatic migration repair, remote reset or Dashboard-only schema authority is permitted.

Future `neurovia-prod` remains a separate authority boundary requiring a separately approved production design.

## Model Registry & Conformance Routing Rule

`profiles/plurora` owns semantic-tier selection. Deployment owns product-native ids for:

```text
codex.fast
codex.balanced
codex.frontier
opencode.reasoning-fast
opencode.workhorse
```

Conformance routing is normative:

```text
low / medium  -> codex.balanced, effort=high
high/critical -> codex.frontier, effort=xhigh
Codex unavailable -> opencode.reasoning-fast, degraded assurance
```

The host validates that the resolved Codex models actually advertise the requested efforts through native `model/list`; it does not silently downgrade effort. High/critical cannot reach `PR_READY` when fallback collapses conformance onto the OpenCode implementation executor and therefore fails `cross-executor-required` independence.

## Final PR Readiness Meaning

After Plan F, `PR_READY` means all of the following are true for the same final published branch state:

```text
implementation completed
AND required verification passed
AND code review passed
AND applicable QA passed
AND applicable security passed
AND approved Spec identity matches
AND approved Plan identity matches
AND every Spec acceptance criterion is accounted for
AND every planned Task is accounted for
AND every baseline/project DoD obligation is accounted for
AND conformance verdict = PASS
AND verify-final verdict = PASS
AND no confirmed material finding remains
```

A green CI run or worker completion claim cannot compensate for `MISSING`, `PARTIAL`, `FAIL`, `BLOCKED` or `INCONCLUSIVE` mandatory conformance evidence.

## Final Activation

After Plan E, Plan F and both Plan C* overlays are complete:

1. reconcile `neuro-via/plurora-harness.json` to the final independently reviewed **post-Plan-F** Trick Harness SHA;
2. run bridge health and a real OpenCode workflow with approved Spec/Plan artifact hashes;
3. prove an intentionally missing fixture Plan task prevents `PR_READY`, then prove repaired/re-certified fixture reaches readiness only after conformance + final verification;
4. collect cloud-development DB evidence when a real migration is present, otherwise record target/history/dry-run evidence without manufacturing a migration;
5. verify no TUI push authority, no global model-config mutation, no local DB canonical path and no committed secrets;
6. complete Plan D Tasks 11/12 and human-controlled merge/activation.

## Completion Contract

Harness V2 is activated for Plurora only when the final NeuroVia pin references the independently reviewed post-Plan-F Trick Harness SHA; the runnable host starts from that exact clean checkout; native model/effort mappings validate; OpenCode can run/status/cancel through the bounded bridge; `neurovia-dev` is the sole serialized drift-safe cloud development DB target; production remains outside automatic authority; approved Spec/Plan identities are pinned per implementation run; deterministic conformance accounts for every required Spec criterion, Plan task and DoD row; `PR_READY` requires conformance PASS plus final verification PASS; all retained acceptance criteria, reusable-core criteria, ND1-ND12 and CF1-CF14 have direct evidence; and no confirmed material finding remains unresolved.
