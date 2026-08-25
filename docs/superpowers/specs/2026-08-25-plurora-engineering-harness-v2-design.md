# Plurora Engineering Harness V2 — Design

**Date:** 2026-08-25  
**Status:** Approved — owner approval confirmed 2026-08-25  
**Supersedes:** `2026-08-23-plurora-opencode-engineering-os-design.md` where this document conflicts with V1  
**Scope:** Plurora engineering harness, executor orchestration, automatic routing, debugging, QA, cloud-only database delivery, automated PR review/remediation, and repository integration

> **Amended by:** `2026-08-25-plurora-engineering-harness-v2-reusable-core-amendment.md`. The amendment is normative for Trick Harness repository naming, reusable Core/providers/integrations boundaries, project profiles, dependency direction, package scope, and R1-R5 acceptance evidence.

## 1. Problem

The V1 OpenCode Engineering OS established a project-local control plane with phase agents, commands, permissions, Plurora skills, independent verification, security policy, and evidence gates. Its central assumptions were that OpenCode itself was the runtime and that model selection remained entirely manual.

V2 changes that boundary. Plurora needs a durable engineering harness that can orchestrate multiple coding executors, enforce lifecycle invariants outside model memory, route work according to cost/capability, recover from subscription quota exhaustion, diagnose and repair bugs systematically, perform independent QA, create pull requests automatically after completed implementation, and close confirmed bugs without repetitive human intervention.

The user still works primarily from the OpenCode TUI. OpenCode becomes the cockpit and one executor, not the orchestration runtime.

V2 adopts a real fork of `deepseek-ai/deepseek-harness` as the architectural/runtime foundation. Plurora does not call a hosted DeepSeek Harness API. The forked source runs under owner control and is extended primarily through profiles, bundles, plugins, capability seams, workflows, and executor providers.

## 2. Binding Decisions

1. **Fork DeepSeek Harness, do not merely imitate it.** Preserve upstream MIT notices and ancestry.
2. **No hosted DeepSeek Harness dependency.** The fork is the runtime.
3. **OpenCode TUI remains the default cockpit.**
4. **Harness is executor-agnostic.** OpenCode, Codex, and Claude Code are providers behind common capabilities.
5. **Strategic long-term executors are OpenCode Go and Codex.** Claude Code remains optional capacity; no core workflow depends on continued Claude subscription.
6. **Automatic routing is enabled by default.** Harness chooses executor/model tier/supported effort from versioned policy.
7. **Manual override always exists** for one run.
8. **Heavy/high-volume implementation routes to MiMo V2.5** for the Plurora profile.
9. **Codex is selective premium reasoning/review/diagnosis/security capacity.**
10. **Codex quota exhaustion is a normal operational state.** Reasoning/review/diagnosis fall back to DeepSeek V4 Flash; implementation/repair/heavy execution fall back to MiMo V2.5.
11. **Fallback is never silent.** Route, failure class, fallback, assurance impact, policy version are durable.
12. **Fresh-context review is mandatory.** Cross-executor review is preferred/required according to risk.
13. **Debugging & Bug Resolution is first-class.** Diagnosis is separate from repair.
14. **QA is first-class and independent.**
15. **Completed implementation proceeds automatically to delivery preparation:** commit/push current feature branch, open PR, run independent review and applicable QA/security.
16. **Confirmed bugs found during automated review are automatically repaired/re-reviewed.** Product/design decisions, intentional behavior, subjective improvements and optional refactors are not auto-fixed.
17. **Merge remains human-controlled.**
18. **Database migration execution/validation is cloud-only.** Docker/local Supabase is not the migration/test runtime.
19. **Each DB-changing PR uses isolated Supabase Preview Branch.** Shared `neurovia-dev` is not normal unmerged feature target.
20. **Migration files remain schema history.** Cloud-only does not authorize untracked hosted edits.
21. **Per-run model/effort routing must not rewrite user global OpenCode/Codex defaults.**

## 3. Goals and Non-Goals

### 3.1 Goals

V2 must:

- make long engineering workflows durable/reconstructable;
- centralize orchestration outside individual model contexts;
- let OpenCode TUI drive OpenCode, Codex, or Claude workers;
- preserve native authentication/personal configuration;
- route workload automatically while respecting subscription economics;
- degrade predictably when Codex capacity is unavailable;
- prevent implementation context from certifying itself;
- distinguish bugs from product decisions/improvements;
- automatically close confirmed bug loops;
- provide risk-based QA/security review;
- replace local Docker Supabase verification with isolated hosted Preview Branch verification;
- preserve Notion/Linear/GitHub ownership and avoid dual-state;
- remain updateable from DeepSeek Harness upstream without an unmergeable rewrite.

### 3.2 Non-goals

V2 does not:

- automatically merge PRs;
- invent product requirements to clear blockers;
- route every task to the most expensive model;
- require Claude Code for future operation;
- extract/reuse private subscription tokens outside official product flows;
- use ChatGPT/Claude chat UIs as automation protocols;
- use a hosted DeepSeek Harness API;
- expose private chain-of-thought as workflow state;
- make self-modifying/model-authored runtime plugins part of trusted control plane;
- replace Notion, Linear, GitHub Issues/PRs, or repository docs as canonical project state.

## 4. System Topology

```text
                           USER
                            |
                      OpenCode TUI
                            |
                   Plurora Harness Bridge
                            |
                            v
                 +------------------------+
                 |      TRICK HARNESS     |
                 |  fork of DeepSeek DSH  |
                 +-----------+------------+
                             |
            +----------------+----------------+
            |                |                |
            v                v                v
      OpenCode provider   Codex provider   Claude provider
            |                |                |
      OpenCode server/    Codex CLI /      Claude Agent SDK /
      SDK / ACP           app-server       Claude Code CLI
```

Harness owns workflow state, routing mechanism, roles, evidence, lifecycle, fallbacks and handoffs. Project profile owns project policy. Executors own native runtime/authentication.

Automation uses stable machine interfaces such as OpenCode server/SDK/ACP, Codex app-server/CLI protocol and Claude Agent SDK/CLI rather than screen-driving extension chats.

## 5. Fork Strategy

### 5.1 Dedicated fork

The Harness lives in `adsonpatrick/trick-harness`, a real fork of `deepseek-ai/deepseek-harness`. The Plurora application repo integrates through bridge/configuration rather than vendoring the whole Harness.

### 5.2 Prefer extension over core divergence

DeepSeek Harness already treats model adapters, tools, sessions, agent loop, subagents, workflow, goals, interaction, compaction, guards, hooks and related capabilities as composable/replaceable subsystems.

Prefer behavior through:

- Trick Harness reusable packages;
- project profiles;
- bundles/plugins;
- executor providers;
- capability policies;
- workflow definitions;
- repository bridge packages.

Changes to generic upstream core such as `agent-loop` require evidence no documented extension point can express the requirement.

### 5.3 Upstream sync

Keep reachable upstream relationship and versioned divergence ledger. Upstream breaking changes are accepted risk; divergence remains intentional/reviewable.

### 5.4 Adopted DeepSeek Harness principles

- plugin/profile/bundle composition;
- capability seams;
- durable session/event log;
- runtime/model-visible state reconstructability;
- scoped tool visibility/authority;
- fail-loud unsupported capabilities;
- fresh/continuable subagents;
- bounded workflow orchestration;
- goals where useful;
- compaction/bounded handoffs;
- loop guards/tool timeouts;
- explicit approval/interaction plane;
- session query/retrieval;
- background jobs;
- cancellation/quiescent teardown;
- real-entry-path/world-verification testing;
- defensive lifecycle patterns.

Self-modifying/model-authored runtime plugins are excluded from trusted V2 composition because they reduce determinism/reviewability.

## 6. Executor Provider Contract

Each executor provider implements a common logical contract. Exact upstream interfaces may evolve; behavior is defined by capabilities rather than product-specific internals.

A provider reports at least:

- availability;
- authentication readiness without exposing credentials;
- fresh-run/continuation support;
- repository/worktree access mode;
- read/write and command/background execution capability;
- cancellation/interrupt capability;
- structured-result capability where available;
- supported permission modes;
- per-run model/effort override support where applicable;
- native configuration behavior;
- failure classification suitable for routing/fallback.

Unsupported requested capabilities fail loudly. Harness never quietly substitutes provider unless policy authorizes fallback.

### 6.1 OpenCode provider

OpenCode is cockpit + executor. Provider uses supported programmatic surfaces, starts fresh worker in target repo/worktree, supplies role/task contract, applies permission envelope, returns structured handoff.

When router resolves OpenCode model (e.g. MiMo V2.5/DeepSeek V4 Flash), provider applies selection **only to spawned worker/session**. It must not rewrite global OpenCode provider/model configuration or cockpit preference.

### 6.2 Codex provider

V2 starts from DeepSeek Harness `subagent-codex` transport rather than rebuilding process/protocol management. Trick Harness extends it so a route-selected Codex model/reasoning effort may be passed as supported per-run/thread override while native account auth, project instructions, personal configuration and credential state remain authoritative outside that scoped override.

Provider must:

- use official Codex CLI/app-server transport;
- preserve ChatGPT-native account auth;
- support ChatGPT-plan Codex without requiring OpenAI API key;
- not inject API key merely because one exists elsewhere on host;
- apply only route-scoped model/effort override, never mutate global Codex defaults;
- use fresh context for independent review;
- return bounded result/evidence, not internal reasoning;
- classify quota/rate/availability distinctly from quality failures.

### 6.3 Claude Code provider

Use official Claude Agent SDK/Claude Code CLI and native account state. Never extract subscription OAuth credentials for direct third-party API use. Claude is optional capacity; disabling it does not change OpenCode/Codex core semantics.

## 7. Automatic Router

### 7.1 Principle

Router is deterministic policy, not free-form model choice. LLM may classify ambiguous task metadata, but classification is recorded and final route follows versioned policy.

### 7.2 Routing context

```text
RoutingContext
  role
  taskClass
  workload
  risk
  writeVolume
  expectedDurationClass
  independenceRequirement
  implementationExecutor
  priorAttempts
  priorRouteFailures
  quotaState
  requiredCapabilities
  userOverride
```

```text
role: refine | plan | implement | debug | repair | verify | review | security | qa | delivery
workload: light | medium | heavy
risk: low | medium | high | critical
writeVolume: none | small | medium | large
independenceRequirement: fresh-context | cross-executor-preferred | cross-executor-required
```

### 7.3 Route decision

```text
RouteDecision
  executor
  semanticModelTier
  resolvedModel
  reasoningEffort
  permissionMode
  fallbackPolicy
  reasonCodes[]
  policyVersion
```

### 7.4 Semantic model registry

Current Codex baseline as of 2026-08-25:

```text
codex.fast       -> GPT-5.6 Luna
codex.balanced   -> GPT-5.6 Terra
codex.frontier   -> GPT-5.6 Sol
```

GPT-5.6 effort: `none`, `low`, `medium`, `high`, `xhigh`, `max`.

Initial OpenCode-Go aliases:

```text
opencode.reasoning-fast -> DeepSeek V4 Flash
opencode.workhorse      -> MiMo V2.5
```

### 7.5 Binding workload policy

For `profile=plurora`, **heavy work routes to MiMo V2.5** unless explicitly overridden. Heavy includes broad implementation, large write surfaces, high-volume test generation/fixing, broad approved refactors, repetitive/mechanical work, many-file repair loops, long execution sequences.

### 7.6 Plurora default routing policy

| Work type | Primary route | Codex effort |
| --- | --- | --- |
| intake/classification | DeepSeek V4 Flash | — |
| routine refinement | DeepSeek V4 Flash | — |
| routine planning | DeepSeek V4 Flash | — |
| implementation small/medium | MiMo V2.5 | — |
| implementation heavy | **MiMo V2.5 required** | — |
| broad approved refactor | **MiMo V2.5 required** | — |
| test generation/repair heavy | **MiMo V2.5 required** | — |
| routine independent code review | Codex balanced | high |
| difficult bug diagnosis | Codex balanced | high |
| high-risk architecture review | Codex frontier | xhigh |
| security-sensitive review | Codex frontier | xhigh |
| critical Auth/RLS/tenant-isolation | Codex frontier | xhigh |
| exceptional unresolved reasoning | Codex frontier | max after escalation |
| QA risk/charter analysis | Codex balanced when available | high |
| QA execution/fix volume | MiMo V2.5 | — |

`max` is escalation, not routine default.

### 7.7 Independence policy

```text
low risk      -> fresh context
medium risk   -> fresh context; cross-executor preferred
high risk     -> fresh context; cross-executor required
critical risk -> fresh context; cross-executor required; security review when applicable
```

If MiMo implemented and Codex unavailable, DeepSeek V4 Flash is preferred for review fallback when that preserves independence.

## 8. Fallback, Quota State, and Circuit Breaking

### 8.1 Availability vs quality failure

Availability: quota exhausted, rate limit, executor unavailable, auth temporarily unavailable, supported transient infra failure. Quality: executor ran but produced inconclusive/wrong diagnosis, failed verification, couldn't solve task. Availability may fallback; quality follows escalation and is never disguised.

### 8.2 Codex fallback matrix for Plurora

| Original workload | Fallback |
| --- | --- |
| refinement/planning/architecture/code review/QA charter/bug diagnosis | DeepSeek V4 Flash |
| implementation/bug repair/refactor/large tests/automated finding repair | MiMo V2.5 |

Critical security fallback may lower assurance and therefore yield `PARTIAL`/`BLOCKED`, never false PASS.

### 8.3 Circuit breaker

```text
AVAILABLE -> quota/rate exhaustion -> DEGRADED
DEGRADED -> cooldown / explicit refresh / successful bounded probe -> AVAILABLE
```

While degraded, routing skips Codex and applies authorized fallback. Do not guess reset time.

### 8.4 No silent fallback

Record requested route, failure class, fallback route, reason, independence impact, assurance impact, policy version.

### 8.5 Manual override

User may request concrete executor/model/effort for one run. Validate capability/safety, log override, scope to that run.

## 9. Engineering Lifecycle V2

```text
/refine -> approved Spec
/plan -> approved Plan
/implement
 -> focused verification
 -> broader verification
 -> commit approved write set
 -> push current feature branch
 -> open PR automatically
 -> independent code review
 -> applicable QA
 -> applicable security review
 -> finding triage
      bug -> debug/repair/retest/re-review automatically
      product decision -> BLOCKED / owner decision
      improvement/refactor/style -> report only unless separately approved
 -> zero unresolved confirmed bugs
 -> final fresh verification
 -> PR READY
 -> human merge
```

Harness owns orchestration; executors own assigned stages only.

## 10. Debugging & Bug Resolution

Diagnosis and repair are separate:

```text
symptom/failing test/QA/review finding
 -> debugger (read-only)
 -> deterministic reproduction
 -> evidence
 -> affected boundary
 -> hypotheses
 -> root-cause diagnosis
 -> Diagnosis Contract
 -> repair worker
 -> regression RED
 -> minimal repair
 -> GREEN
 -> fresh verifier
 -> QA/reproduction retest when applicable
```

Diagnosis Contract:

```text
Symptom
Reproduction
Expected vs actual
Observed evidence
Affected boundary
Ruled-out hypotheses
Root-cause hypothesis
Confidence
Regression-test seam
Minimal repair surface
Unknowns
Security relevance
Product-decision dependency
```

Material product-decision dependency returns `BLOCKED` rather than inventing behavior.

Confirmed repair preserves/reruns reproduction, creates/identifies regression RED, applies smallest coherent root-cause fix, verifies focused GREEN, challenges patch where relevant, reruns affected gates, hands off to fresh independent review. Symptom disappearance without supported root cause is incomplete.

## 11. Automated Finding Triage and Remediation

Finding classes:

```text
BUG
SECURITY_BUG
TEST_DEFECT
TOOLING_DEFECT
PRODUCT_DECISION
DESIGN_DECISION
INTENTIONAL_BEHAVIOR
IMPROVEMENT
REFACTOR_SUGGESTION
STYLE_ONLY
FALSE_POSITIVE
UNRESOLVED
```

Auto-fix may repair confirmed product bugs, sufficiently specified security bugs, test defects, and in-scope tooling defects required for authorized workflow. Every automatic repair requires independent re-review.

Never auto-decide missing product/UX choices, scope expansion, subjective refactors/style, or enhancements not required by approved contract.

## 12. QA Workflow

Role separation:

- Code review: source/diff correctness and engineering quality.
- Verifier: requirements-to-evidence judgment.
- Security review: security invariants/reachability.
- QA: product behavior, journeys, negative paths, state transitions, integration risk, regressions.

QA sequence:

```text
changed surface -> impact analysis -> risk classification -> charter -> coverage inventory
 -> targeted checks -> negative/error paths -> boundary/state transitions
 -> applicable E2E -> visual/accessibility where applicable -> exploratory checks
 -> findings -> triage -> authorized bug repair loop -> retest -> QA verdict
```

Use existing Plurora Playwright smoke/full, production-path, visual snapshots, Design System, accessibility, DB and app tests as initial evidence catalog. High-risk may promote full E2E; low-risk remains proportionate.

QA verdict: `PASS | PARTIAL | FAIL | INCONCLUSIVE`. No PASS with unresolved confirmed material bug.

## 13. Delivery Automation and Pull Requests

Scoped delivery may:

- commit approved write set;
- push current non-protected feature branch;
- open/update its PR;
- update review/evidence metadata.

Denied by default:

- force push;
- destructive history rewrite;
- implementation-completion push to protected main/master;
- merge;
- release/deploy without separate authorization.

Automatic PR loop:

```text
PR opened/updated -> exact diff + requirement contract -> fresh review
 -> QA/security when required -> triage -> repair confirmed bugs
 -> push repair -> fresh CI/evidence -> fresh re-review
 -> repeat until no confirmed bugs / product decision block / assurance failure / bounded policy exhausted
```

## 14. Supabase Cloud-Only Database Workflow

No normal Plurora DB workflow may require local Docker Supabase or Docker-backed shadow DB.

Retire canonical use of:

- `supabase start`;
- `supabase db reset --local`;
- `supabase db lint --local`;
- `supabase test db --local`;
- local Docker schema/test gates;
- Docker-dependent `db pull`/`db diff` as normal migration authoring/verification.

Migration SQL remains under `supabase/migrations/`; canonical authoring is explicit reviewed migration SQL, not untracked hosted edits.

Any DB-changing PR gets isolated Preview Branch:

```text
Git feature branch/PR -> Supabase Preview Branch -> apply pending migrations
 -> verify migration history -> remote non-Docker lint -> remote pgTAP
 -> RLS allow + deny -> applicable integration/E2E -> generated types if applicable
```

Preview Branch creation unavailable => `BLOCKED`; never fall back to unmerged migration on shared `neurovia-dev`.

Migration safety: correct forward, explicit RLS decisions, allow+deny evidence, reconcile drift, no destructive remote reset in normal PR verification, production deployment separately authorized.

## 15. Security Workflow

Security review remains independent and grounded in `SECURITY.md`. Security-aware routing covers Auth/session, RLS/tenant isolation, privileged Supabase roles, secrets, external tools, Harness permissions/sandboxing, executor credential isolation, cross-worktree/process boundaries, PR delivery authority.

Security findings enter automatic repair only after validation and when safe behavior is specified. Provider subprocess environments must not leak unrelated credentials; subscription auth stays in official product configuration paths.

## 16. Durable State, Context, and Handoffs

Durable log records:

- workflow start/end and approved objective ref;
- route decisions/fallbacks;
- executor/provider identity;
- resolved model/tier and effort where observable;
- permission mode;
- job/tool lifecycle summaries;
- findings;
- Diagnosis Contracts;
- verifier/QA/security verdicts;
- PR identity/commit SHA;
- blocker state;
- quota circuit transitions.

Private chain-of-thought is not workflow state.

Fresh workers receive bounded self-contained handoff, not entire parent conversation. Repository/worktree + durable state are authoritative long-term memory. Compaction preserves durable facts/active contracts/evidence refs.

## 17. Permissions and Safety

Recommended roles:

- refiner — product/spec mutation only where operating model allows;
- planner — production edit denied;
- implementer — approved write surface;
- debugger — read-only;
- repairer — bounded diagnosed repair surface;
- verifier/reviewer/QA/security reviewer — read-only;
- delivery — scoped git/PR mutation only.

External Notion/Linear/GitHub/Supabase mutation remains bound to operating model; Harness is not a project tracker.

Secrets: `.env` secret reads denied to general agents; providers use native credential stores; subscription credentials never copied to prompts/logs; env overlays narrowly scoped; failures expose safe diagnostics, not raw dumps.

## 18. OpenCode Integration

Plurora repo gains thin bridge rather than reimplementing workflow in `.opencode/*.md`.

Possible operations:

```text
harness_run
harness_status
harness_cancel
harness_review
harness_debug
harness_qa
```

Existing V1 commands may remain as user-friendly entrypoints but route into Harness lifecycle where orchestration is required. TUI surfaces concise workflow progress/results without requiring Codex/Claude extension chats.

## 19. Testing the Harness Itself

Required classes:

- routing/fallback unit/table/invariant tests;
- executor-provider contracts;
- per-run model/effort global-config non-mutation;
- failure classification/quota/circuit breaker;
- permissions/cancellation/quiescent teardown;
- session replay/compaction;
- workflow state machine/bounded remediation;
- cloud DB orchestration against disposable Preview Branch where feasible;
- snapshot/real-entry behavior;
- OpenCode provider integration;
- Codex native supported integration;
- Claude compatibility while maintained;
- reusable-boundary/profile/dual-profile tests added by amendment.

Verify world, not worker claims: reread files/diffs, rerun reproduction/tests, query GitHub PR/commit/CI, query Supabase branch/migration state, inspect actual DB behavior.

Before changing route defaults, run representative Plurora evals. Heavy-work MiMo V2.5 invariant changes only through new owner-approved design decision.

## 20. V1 Migration Impact

- Model selection: V1 none; V2 automatic Harness per-worker routing + manual override.
- Runtime: V1 OpenCode runtime; V2 Trick Harness orchestration, OpenCode cockpit+executor.
- Delivery: V1 push denied; V2 scoped delivery can commit/push feature branch/open PR.
- Bugs: V1 debugging embedded; V2 dedicated diagnosis/repair and automated review bugs enter it.
- QA: V1 gates; V2 separate risk-based QA workflow.
- Database: V1 local Supabase/Docker primary; V2 cloud-only Preview Branch verification.

## 21. Acceptance Criteria

V2 is implemented only when all are demonstrably true.

1. A Plurora-owned DeepSeek Harness fork runs without hosted DSH service.
2. Upstream license/provenance preserved.
3. OpenCode TUI starts/observes Harness workflow through stable bridge.
4. OpenCode executes as worker without screen-driving TUI.
5. Router-selected OpenCode model applies only to spawned worker and does not mutate global/cockpit defaults.
6. Codex executes using native ChatGPT-plan auth without requiring OpenAI API key for that route.
7. Router-selected Codex model/effort applies per run/thread and does not mutate global defaults.
8. Claude Code executes as optional worker through official SDK/CLI/native path while maintained.
9. Disabling Claude does not break core OpenCode/Codex workflows.
10. Router uses versioned deterministic policy and logs every decision.
11. Heavy implementation routes to MiMo V2.5 unless explicit user override.
12. Codex selection uses semantic registry and intentional effort.
13. Codex quota exhaustion triggers approved DeepSeek/MiMo fallback without silent degradation.
14. Circuit breaker prevents repeated known-failing Codex quota attempts.
15. Fresh-context review enforced.
16. Cross-executor independence enforced for configured high/critical risks when acceptable route exists; otherwise assurance impact explicit.
17. Read-only diagnosis produces Diagnosis Contract before non-trivial repair.
18. Confirmed bugs from automated PR review are repaired, retested, independently re-reviewed automatically.
19. Product/design decisions never auto-fixed merely for green status.
20. QA runs independently and can fail PR readiness.
21. Successful implementation can automatically commit/push authorized feature branch and open/update PR without general force-push/merge authority.
22. Review/repair loops bounded and terminate with ready/PASS, BLOCKED, PARTIAL, FAIL, or INCONCLUSIVE.
23. DB-changing PRs obtain isolated Supabase Preview Branches.
24. Preview creation unavailable => workflow blocks instead of mutating shared dev fallback.
25. Migration/lint/pgTAP/RLS/integration checks do not require local Docker Supabase or Docker shadow DB.
26. Existing local-Docker DB gates retired/replaced so they cannot remain canonical accidentally.
27. RLS changes verify denial and allowed access.
28. Harness replay reconstructs route/fallback/finding/verdict/delivery facts without private model reasoning.
29. Provider processes cancel/dispose to quiescence without orphan workers.
30. Integration tests verify actual repo/GitHub/Supabase effects rather than worker text.

Additional R1-R5 reusable-core acceptance criteria are normative in the approved amendment.

## 22. Provenance and Design Inputs

Derived from implemented Plurora OpenCode Engineering OS V1; Plurora governance/design/security/git-flow/CI/DB evidence; `deepseek-ai/deepseek-harness` plugin/profile/bundle/session/tools/subagents/workflow/goals/compaction/guards/interaction/hooks/providers/testing/lifecycle patterns; Superpowers brainstorming/TDD/debugging/verification/planning; Codex Engineering Guardrails; Codex Security; current Supabase Branching; current OpenCode server/SDK/ACP/plugin surfaces; current Codex GPT-5.6 family/effort/ChatGPT-plan behavior as of 2026-08-25.

Upstream tools/model catalogs change. Semantic registries, capability interfaces, scoped overlays, provider adapters, profiles and evals isolate those changes from workflow semantics.