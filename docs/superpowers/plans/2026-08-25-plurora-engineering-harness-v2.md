# Plurora Engineering Harness V2 — Implementation Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement these plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operate Plurora through the reusable Trick Harness runtime while preserving explicit project policy, deterministic mutation authority, native OpenCode/Codex authentication, approved-artifact traceability, Definition of Done certification, deterministic change-impact/risk enforcement, GitHub merge-gate certification and evidence-first activation.

## Current Status — Runtime Built, Deployment/Conformance/Impact/Certification Enablement Pending

Plans R, A, B and the Harness-side Plan D verification/remediation work have been implemented and merged in `adsonpatrick/trick-harness`. Remaining work is: cloud-development/host enablement, Implementation Conformance & DoD, deterministic Change Impact/Risk enforcement, GitHub certification, NeuroVia installation/wiring, then final Plan D reconciliation and activation.

The active database decision remains: `neurovia-dev` (`uljaajwwnygopsyvwsre`) is the explicitly authorized Supabase Cloud **development** database. Preview Branches remain an optional future isolation strategy, not a prerequisite or fallback.

The active PR-readiness decision added on 2026-08-28 is: a PR cannot become `PR_READY` unless a first-class read-only `conformance` stage proves the final published implementation satisfies the approved Spec, approved Superpowers Plan and applicable Plurora DoD, followed by fresh final verification.

The active change-impact decision added on 2026-08-28 is: planned and actual repository change sets deterministically drive effective risk, QA/Security requirements, database verification, routing facts and evidence profiles. Classification may preserve or raise risk; it may never lower an approved or previously observed risk floor.

The active GitHub-certification decision added on 2026-08-28 is: `PR_READY` must be published as the required commit-status context `plurora/harness-certification` on the exact current PR head SHA. Every delivery/redelivery becomes `pending`; only the same-revision deterministic readiness decision can become `success`. Harness still cannot merge/release/deploy.

## Normative Documents — Precedence

Apply these in order:

1. explicit owner decisions;
2. `docs/superpowers/specs/2026-08-28-harness-v2-github-certification-gate-amendment.md` for external certification state, exact-SHA binding and GitHub merge-gate semantics;
3. `docs/superpowers/specs/2026-08-28-harness-v2-change-impact-risk-policy-enforcement-amendment.md` for planned/actual impact, monotonic risk, executable QA/Security policy, routing facts and DB/evidence-profile enforcement;
4. `docs/superpowers/specs/2026-08-28-harness-v2-implementation-conformance-dod-amendment.md` for approved-artifact traceability, conformance/DoD certification, routing and internal `PR_READY`;
5. `docs/superpowers/specs/2026-08-27-neurovia-harness-deployment-cloud-dev-amendment.md` for NeuroVia deployment, model registry and cloud-development DB authority;
6. `docs/superpowers/specs/2026-08-27-harness-v2-scope-amendment.md` for Claude removal and historical Preview-entitlement scope where not superseded;
7. `docs/superpowers/specs/2026-08-25-plurora-engineering-harness-v2-reusable-core-amendment.md` for reusable-core/profile boundaries;
8. `docs/superpowers/specs/2026-08-25-plurora-engineering-harness-v2-design.md` for the base V2 architecture;
9. the active plan overlays below before historical Plans C/D where they conflict.

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
G. Change Impact / Risk / Policy Enforcement
              |
              v
H. GitHub Harness Certification Gate
              |
              v
C*. NeuroVia installation
    + Conformance/DoD wiring
    + Change-Impact project facts
    + GitHub certification wiring / branch protection
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

Any SHA recorded at the end of Plan E is intermediate. NeuroVia may pin only the final independently reviewed SHA after Plans F/G/H.

## Pending Plan F — Implementation Conformance & Definition of Done

`2026-08-28-trick-harness-implementation-conformance-dod.md`

Plan F adds:

- first-class read-only role `conformance`;
- repository-local approved Spec/Plan path + SHA-256 identity on every implementation objective;
- deterministic manifest extraction of explicit Spec acceptance criteria, every Superpowers `### Task N:` Plan task, and baseline Plurora DoD obligations before model dispatch;
- structured `ConformanceContract` with full expected-ID coverage validation;
- lifecycle order `... review -> QA/security as applicable -> conformance -> verify-final`;
- internal `PR_READY` requiring conformance PASS plus final verification PASS;
- routing: low/medium `codex.balanced/high`, high/critical `codex.frontier/xhigh`;
- Codex-unavailable fallback to `opencode.reasoning-fast` with explicit degraded assurance and no high/critical cross-executor certification when implementation used OpenCode;
- bounded journal/control status containing hashes/counts/verdict/evidence, never documents/transcripts/reasoning.

The current deployment intent maps `codex.balanced` to the Terra class and `codex.frontier` to the Sol class, while actual product-native ids and supported efforts are discovered/validated from the authenticated Codex `model/list` catalogue.

## Pending Plan G — Change Impact, Risk & Policy Enforcement

`2026-08-28-trick-harness-change-impact-risk-policy-enforcement.md`

Plan G adds:

- reusable deterministic `@trick-harness/change-impact` mechanism using profile-owned Picomatch path rules;
- planned impact from the exact approved Superpowers Plan write set before mutation;
- actual impact from the published Git branch diff before certification and after every repair/redelivery;
- monotonic effective risk `max(objective, planned, actual)`;
- accumulated surfaces, task classes, required capabilities and evidence-profile IDs;
- factual write volume from the change set while preserving read-only `none`;
- executable QA/Security policy resolution so matching profile rows actually add/strengthen certifying stages;
- database-mutation detection that cannot be disabled by omitted caller metadata;
- repair/redelivery recertification that may preserve or strengthen but never weaken requirements;
- bounded `unplannedPaths` evidence for Review/Conformance;
- journal/control visibility for impact facts without raw diffs, file contents or reasoning.

Plan G requires Plans E/F complete and independently reviewed.

## Pending Plan H — GitHub Harness Certification Gate

Harness-side plan:

`2026-08-28-trick-harness-github-certification-gate.md`

Companion NeuroVia wiring overlay:

`2026-08-28-neurovia-github-certification-wiring.md`

Plan H adds:

- generic deterministic `CertificationCapabilityPort`;
- separate narrow `@trick-harness/github-certification` integration;
- native `gh` auth with no injected token;
- exact repository/local HEAD/open PR/base/head SHA verification before every status mutation;
- fixed Plurora context `plurora/harness-certification`;
- `pending` after every delivery/redelivery and on recertification of the same published SHA;
- `success` only from the exact post-F/G readiness decision and same pending revision;
- `failure` for terminal non-readiness and `error` for canceled/interrupted/operational failure;
- durable certification facts and restart/world-reconciliation semantics;
- Plurora composition that cannot become ready without its certification capability;
- NeuroVia branch protection requiring certification in addition to existing CI;
- bootstrap proof that a new SHA invalidates an older SHA's success before final activation;
- explicit current single-owner status-source trust boundary and future GitHub-App hardening trigger.

Plan H requires Plans E/F/G complete and independently reviewed. The Harness-side implementation records the final reviewed Trick SHA; the NeuroVia companion overlay activates the required status only after a real status has been produced.

## Pending Plan C* — NeuroVia Installation

Primary installation overlay:

`2026-08-27-neurovia-harness-installation-amendment.md`

Mandatory Conformance wiring overlay:

`2026-08-28-neurovia-conformance-dod-wiring.md`

Mandatory GitHub certification wiring overlay:

`2026-08-28-neurovia-github-certification-wiring.md`

Execute the installation and overlays in the same NeuroVia integration branch only after the final reviewed post-Plan-H Trick Harness SHA is available.

The installation must:

- identify the exact approved Spec/Plan and compute their SHA-256 under the worktree;
- supply project facts Plan G consumes: approved Plan, protected branch identity, actual Git context and evidence-profile mappings without duplicating profile policy;
- bind the project repository exactly to `adsonpatrick/neuro-via`;
- surface Harness certification state/revision through readiness tools;
- add `plurora/harness-certification` to protected-`main` required contexts only after a real Harness status exists;
- prove fresh-SHA invalidation and final-head recertification;
- preserve human-only merge authority.

The installed topology becomes:

```text
OpenCode TUI in neuro-via
        |
        | bounded tools + approved Spec/Plan paths
        v
NeuroVia client/launcher
        |
        | loopback HTTP
        v
exact post-Plan-H Trick Harness checkout
        |
        +-- Plurora host
        |    +-- profile=plurora
        |    +-- deployment ModelRegistry
        |    +-- OpenCode + Codex
        |    +-- GitHubDelivery
        |    +-- GitHubCertification
        |    +-- project DB verification
        |    +-- planned/actual change-impact resolver
        |    +-- policy-driven QA/Security selection
        |    +-- conformance / DoD certification
        |
        +---- status: plurora/harness-certification
        |
        v
GitHub protected PR HEAD

neurovia-dev remains development DB authority
```

## Database Development Authority

```text
environment=development
configured DB strategy=shared-cloud-development
configured project ref=uljaajwwnygopsyvwsre
=> neurovia-dev is the only automatic development DB mutation target
```

A DB-changing workflow must verify target identity, serialize mutation, reconcile migration history, refuse unexplained drift, dry-run/apply/re-read migrations, run remote lint, pgTAP, RLS allow+deny, applicable integration/security checks and durable evidence. After Plan G, trusted planned/actual change impact may require this DB gate even when caller metadata omitted an explicit DB-change declaration. No canonical local Docker/Supabase/Postgres, arbitrary remote target, production fallback, automatic migration repair, remote reset or Dashboard-only schema authority is permitted.

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

After Plan G, the `risk` fed to this routing is the effective monotonic risk from approved objective + planned impact + actual published impact, not caller risk in isolation. The host validates that resolved Codex models advertise requested efforts through native `model/list`; it never silently downgrades effort. High/critical cannot reach `PR_READY` when fallback collapses conformance onto the OpenCode implementation executor and fails `cross-executor-required` independence.

## Final PR Readiness and GitHub Certification Meaning

After Plans F/G/H, internal `PR_READY` means all of the following are true for the same final published branch state:

```text
implementation completed
AND required verification passed
AND code review passed
AND applicable QA selected from effective change impact passed
AND applicable security selected from effective change impact passed
AND approved Spec identity matches
AND approved Plan identity matches
AND planned/actual impact facts are current for the published branch
AND every Spec acceptance criterion is accounted for
AND every planned Task is accounted for
AND every baseline/project DoD obligation is accounted for
AND conformance verdict = PASS
AND verify-final verdict = PASS
AND no confirmed material finding remains
```

For NeuroVia merge eligibility, one more external fact is mandatory:

```text
GitHub current PR HEAD SHA
AND latest plurora/harness-certification on that exact SHA = success
```

Every new delivery/push creates or reuses a revision that must be marked `pending` and recertified. An old SHA's success cannot satisfy a new SHA. A green CI run, low caller-provided risk or worker completion claim cannot compensate for stronger classified surfaces or missing certification.

Required `main` contexts after Plan H activation:

```text
validate
design-system
e2e
build
plurora/harness-certification
```

Harness still cannot merge, release or deploy.

## Final Activation

After Plans E/F/G/H and all Plan C* overlays are complete:

1. reconcile `neuro-via/plurora-harness.json` to the final independently reviewed **post-Plan-H** Trick Harness SHA;
2. run bridge health and a real OpenCode workflow with approved Spec/Plan artifact hashes;
3. prove planned and actual change impact are recorded, and an intentionally under-classified auth/database fixture is escalated to the correct gates;
4. prove an intentionally missing fixture Plan task prevents internal `PR_READY`;
5. prove a real Harness status exists, enable `plurora/harness-certification` as required, then push a fresh evidence SHA and prove the older certification no longer satisfies merge protection;
6. commit every remaining NeuroVia change, run one final certification on the final immutable PR head and verify all five required contexts;
7. collect cloud-development DB evidence when a real migration is present, otherwise record target/history/dry-run evidence without manufacturing a migration;
8. verify no TUI push authority, no Harness merge/release/deploy authority, no global model-config mutation, no local DB canonical path and no committed secrets;
9. complete Plan D Tasks 11/12 and hand off to human-controlled merge/activation.
