# Plurora Harness V2 Routing and Engineering Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the executor foundation into a deterministic, durable engineering runtime that routes work, handles quota fallback, diagnoses/repairs bugs, runs independent review/QA/security, performs scoped GitHub delivery, orchestrates Supabase Preview Branches, and terminates with evidence-backed workflow verdicts.

**Architecture:** Build reusable mechanism under `packages/core`, external capabilities under `packages/integrations`, and consume concrete Plurora policy from `profiles/plurora`. Routing is deterministic policy over semantic model tiers; DSH Session is the durable fact log; workflow code owns state transitions rather than model-written workflow scripts. Executors perform stages but never own certification. A loopback control server exposes run/status/cancel to the product bridge in Plan C.

**Tech Stack:** Plan A executor runtime/providers, DeepSeek Harness Session/events/subprocess/jobs/loader, Cordis, TypeScript/Vitest, Git + `gh`, Supabase CLI, PostgreSQL/pgTAP, HTTP loopback control server.

**Spec:** `docs/superpowers/specs/2026-08-25-plurora-engineering-harness-v2-design.md`

**Requires:** Plan R Tasks 1-5 and Plan A completed and independently reviewed.

> **Normative override:** Plan R controls repository paths, package scope, generic-vs-profile ownership, and runtime naming.

## Global Constraints

- Routing decisions are deterministic and versioned. Model classification may provide task metadata, but may not bypass routing policy.
- Workflows use semantic tiers; concrete model IDs live in one registry/profile policy.
- Binding Plurora invariant: heavy/high-volume implementation/repair work → MiMo V2.5 unless explicitly overridden for that run.
- Codex availability fallback for Plurora: reasoning/review/diagnosis → DeepSeek V4 Flash; implementation/repair/heavy execution → MiMo V2.5.
- Quality failure is not availability failure and must not trigger quota fallback semantics.
- Fallback is explicit in durable events and user-visible status.
- Fresh context is mandatory for certification. High/critical risk requires cross-executor review where an acceptable independent route exists.
- Debugger/reviewer/QA/security-reviewer stages are read-only. Any repair happens in a separate repair stage/provider run.
- Product/design ambiguity is `BLOCKED`, not auto-fixed.
- Automated repair is bounded. Initial Plurora policy: `maxRepairCycles = 3` and `maxExecutorStarts = 24`.
- Automatic delivery may normal-push the current feature branch/open/update PR; force push, main push, merge, release and deployment remain outside authority.
- Database Preview Branch failure never falls back to shared dev or Docker/local Supabase.
- Durable state contains observable facts/results, not private chain-of-thought.
- On process/control-server restart, do not blindly resume side-effectful in-flight work. Reconstruct durable state and verify world state before retrying.

---

## Task 1: Add Shared Engineering Contracts

**Files (fork):**
- Create: `packages/core/contracts/package.json`
- Create: `packages/core/contracts/tsconfig.json`
- Create: `packages/core/contracts/src/types.ts`
- Create: `packages/core/contracts/src/index.ts`
- Create: `packages/core/contracts/src/invariant.ts`
- Create: `packages/core/contracts/tests/contracts.spec.ts`
- Create: `packages/core/contracts/README.md`
- Modify: `tsconfig.host.json`

**Produces:** stable types/enums used by routing, journal, workflows, control server, and product bridge.

Core contracts include:

```text
Role = refine | plan | implement | debug | repair | verify | review | security | qa | delivery
Workload = light | medium | heavy
Risk = low | medium | high | critical
WriteVolume = none | small | medium | large
IndependenceRequirement = fresh-context | cross-executor-preferred | cross-executor-required
WorkflowVerdict = PASS | PARTIAL | FAIL | INCONCLUSIVE | BLOCKED
FindingClass = BUG | SECURITY_BUG | TEST_DEFECT | TOOLING_DEFECT |
               PRODUCT_DECISION | DESIGN_DECISION | INTENTIONAL_BEHAVIOR |
               IMPROVEMENT | REFACTOR_SUGGESTION | STYLE_ONLY |
               FALSE_POSITIVE | UNRESOLVED
```

Also define `DiagnosisContract`, `RoutingContext`, `RouteDecision`, `Finding`, `EvidenceRef`, `WorkflowObjective`, and bounded structured stage result types.

- [x] Write parser/boundary RED tests for invalid serialized contracts.
- [x] Implement only parser/config/durable-boundary validation needed by consumers.
- [x] Add invariant/README/JSDoc and Host reference.
- [x] Run focused tests/typecheck/constraints and commit: `feat(trick): add engineering workflow contracts`.

---

## Task 2: Implement Semantic Model Registry and Deterministic Router

**Files:**
- Create: `packages/core/routing/*`
- Plurora policy expectations live under `profiles/plurora/tests`.

**Plurora semantic registry:**

```text
opencode.reasoning-fast -> DeepSeek V4 Flash
opencode.workhorse      -> MiMo V2.5
codex.fast              -> GPT-5.6 Luna
codex.balanced          -> GPT-5.6 Terra
codex.frontier          -> GPT-5.6 Sol
```

- [x] Write table-driven RED routing tests covering approved Plurora defaults through `profiles/plurora`.
- [x] Add manual override tests proving valid override wins for one run and invalid capability is rejected.
- [x] Add independence tests using `implementationExecutor` + risk.
- [x] Implement pure `route(context, policy): RouteDecision`; no product/process side effect.
- [x] Record `policyVersion` and machine-readable `reasonCodes[]` in every decision.
- [x] Add tests proving model registry update changes resolved model without changing workflow mechanism.
- [x] Commit: `feat(trick): add deterministic executor routing`.

---

## Task 3: Add Availability Classification, Fallback and Codex Circuit Breaker

**Files:**
- Extend: `packages/core/routing/*`

**State:**

```text
AVAILABLE -> DEGRADED -> AVAILABLE
```

- [x] Write RED tests for `usageLimitExceeded` and verified Codex rate/server capacity categories producing fallback.
- [x] Write RED tests proving context-window/bad-request/sandbox/cyber-policy/wrong-answer/failed-verification are not quota fallback.
- [x] Implement generic fallback/circuit-breaker mechanism consuming profile policy.
- [x] Implement circuit breaker with explicit transition events, configurable bounded probe/cooldown policy, and explicit/manual refresh path.
- [x] Prove review fallback prefers an executor different from the implementer when possible.
- [x] For critical security assurance, test that fallback may lower assurance and therefore return `PARTIAL/BLOCKED` rather than PASS.
- [x] Commit: `feat(trick): add routing fallback and quota circuit breaker`.

---

## Task 4: Add Durable Workflow Journal on DSH Session

**Files:**
- Create: `packages/core/journal/*`

**Event vocabulary:**

```text
harness/workflow-start
harness/route-decision
harness/route-fallback
harness/executor-start
harness/executor-end
harness/finding
harness/diagnosis
harness/verdict
harness/delivery
harness/blocker
harness/circuit-breaker
harness/workflow-end
```

- [x] Write RED event serialization/replay tests.
- [x] Declare `SessionEventMap` extensions with exact payloads/JSDoc.
- [x] Implement journal append helpers using `session.append(...)`; flush at route fallback, diagnosis, verdict, delivery mutation, blocker, and terminal state.
- [x] Project route history, findings, diagnoses, PR/delivery state, verdicts and circuit state solely from session events.
- [x] Test compaction/context pruning cannot erase durable evidence references.
- [x] Test missing required Harness journal plugin fails reconstruction rather than silently ignoring facts.
- [x] No raw model reasoning/tool transcripts in event payloads; store bounded results/evidence refs only.
- [x] Add real-loader composition test and commit: `feat(trick): add durable workflow journal`.

---

## Task 5: Add Deterministic Workflow Runtime and Stage Dispatch

**Files:**
- Create: `packages/core/workflow/*`

**Produces:** lifecycle controller/state machine consuming an approved objective, profile, route, provider and validated stage results.

- [x] Write RED state-machine tests for normal implement→verify→delivery/review flow, cancellation, executor error, BLOCKED product decision, and restart projection.
- [x] Implement one operation lifecycle owner with explicit AbortController/run registry and teardown.
- [x] Enforce workflow budgets from `HarnessProfile.workflowPolicy`.
- [x] On restart after a prior nonterminal durable workflow exists but no owned live run exists, project it as interrupted/inconclusive and verify world state before retry.
- [x] Add role-specific permission/route request construction; read-only roles request read-only provider mode.
- [x] Return compact stage facts, not child transcript.
- [ ] Commit: `feat(trick): add deterministic engineering workflow runtime`.

---

## Task 6: Implement First-Class Debugging and Repair

**Files:**
- Extend `packages/core/workflow/*`

**Flow:**

```text
finding/symptom
 -> read-only debugger
 -> reproduction/evidence/hypotheses
 -> DiagnosisContract
 -> repair worker
 -> regression RED
 -> minimal fix
 -> GREEN
 -> fresh verifier
 -> optional QA retest
```

- [x] Write RED tests proving repair cannot start for non-trivial bug without valid `DiagnosisContract` except mechanically obvious test/tooling defects with explicit evidence.
- [x] Enforce debugger read-only capability and fresh repair session.
- [x] Require diagnosis fields from the approved Spec.
- [x] If product-decision dependency is material, emit blocker and stop before mutation.
- [x] Repair stage requires regression RED for behavior defects, focused GREEN and fresh verifier.
- [x] Symptom disappearance without supported root cause is incomplete.
- [x] Commit: `feat(trick): add diagnosis and repair workflow`.

---

## Task 7: Implement Finding Triage, Code Review, QA and Security Stages

**Files:**
- Extend workflow package or split single-purpose private plugins only if lifecycle ownership is clearer.

- [x] Write RED triage tests for every `FindingClass`.
- [x] Auto-repair only confirmed eligible `BUG`, safe `SECURITY_BUG`, `TEST_DEFECT`, and required in-scope `TOOLING_DEFECT`.
- [x] No auto-fix for product/design decisions, intentional behavior, improvements, refactors or style.
- [x] Code review consumes exact requirement + diff + fresh repository evidence and remains read-only.
- [x] QA sequence follows approved impact/risk/charter/negative/boundary/E2E/visual/accessibility flow.
- [x] Security stage is risk-triggered and consumes repository `SECURITY.md`; reviewer remains read-only.
- [x] Verdict vocabulary remains `PASS|PARTIAL|FAIL|INCONCLUSIVE|BLOCKED`; no PASS with confirmed material bug.
- [x] Test fresh-context/cross-executor enforcement according to profile policy.
- [x] Commit: `feat(trick): add independent review and QA orchestration`.

---

## Task 8: Add Scoped GitHub Delivery Capability

**Files:**
- Create: `packages/integrations/github-delivery/*`

**Allowed operation set:**

```text
git status/diff/add approved write set
git commit
git push -u origin HEAD (normal feature branch only)
gh pr view/create/update
read CI/PR/commit state
```

**Denied:** force push, protected/main implementation push, merge, release/deploy, unrelated branch mutation.

- [x] Write RED tests with a temporary Git repo/fake remote for branch validation, exact staged file set, main denial, force denial, normal push construction, and duplicate PR behavior.
- [x] Implement command construction through DSH subprocess service; never shell-concatenate untrusted values.
- [x] Validate branch belongs to requested workspace and is non-protected before mutation.
- [x] After commit/push/PR, re-read actual git/GitHub state and emit durable delivery event with commit SHA/PR identity.
- [x] Keep GitHub auth native to `gh`; never read/token-log credentials.
- [x] Cleanup/error reporting separates primary delivery result from teardown/metadata failure.
- [x] Commit: `feat(trick): add scoped GitHub delivery`.

---

## Task 9: Add Supabase Preview Branch Capability

**Files:**
- Create: `packages/integrations/supabase-preview/*`

**Capability:** provision isolated hosted branch, apply migration history, run remote gates, expose explicit safe connection inputs to approved subprocess tests, then clean up.

- [x] **Step 1: Verify installed CLI contract before coding commands**

```bash
supabase --version
supabase branches create --help
supabase branches get --help
supabase branches delete --help
supabase db push --help
supabase migration list --help
supabase db lint --help
supabase db query --help
supabase gen types --help
```

Use only flags supported by actual CLI. Do not use Docker-required `db pull`, `db diff`, `test db`, `start`, or local reset paths.

- [x] Write RED subprocess-command tests proving no canonical command contains `--local`, `supabase start`, `supabase test db`, `db reset`, Docker or shared-dev fallback.
- [x] Implement create → wait/inspect healthy → identify preview project → apply pending migrations → migration-list evidence → remote lint → project-provided pgTAP/RLS test command → cleanup.
- [x] Accept parent project ref as non-secret project config; auth remains native Supabase CLI/environment.
- [x] Never read `.env` inside this package.
- [x] If a safe preview DB connection cannot be obtained, emit `BLOCKED` and clean up; never mutate shared parent as fallback.
- [x] Cleanup failure is reported independently from primary result.
- [x] Add tests for create failure, gate failure, cancellation, cleanup, and shared-parent non-mutation.
- [x] Commit: `feat(trick): add Supabase preview branch runtime`.

---

## Task 10: Compose the PR Review/Repair Lifecycle

**Files:**
- Extend `packages/core/workflow/*`

**Lifecycle:**

```text
implementation verified
 -> GitHub delivery/open PR
 -> code review
 -> applicable QA
 -> applicable security review
 -> triage
 -> confirmed bug? diagnosis/repair/retest/re-review
 -> repeat up to profile maxRepairCycles
 -> final fresh verification
 -> PR READY | BLOCKED | FAIL | PARTIAL | INCONCLUSIVE
```

- [ ] Write RED scenario with two injected confirmed bugs and one improvement suggestion; assert both bugs auto-close while improvement is reported and not implemented.
- [ ] Write scenario where finding is a product decision; assert no repair starts.
- [ ] Use profile `maxRepairCycles`; each repair push triggers fresh diff/evidence and fresh review.
- [ ] If bugs remain after ceiling, terminal state cannot be PR READY.
- [ ] Ensure repair executor routing honors Plurora heavy-MiMo invariant and Codex fallback through profile policy.
- [ ] Commit: `feat(trick): add bounded PR remediation lifecycle`.

---

## Task 11: Add Loopback Harness Control Server

**Files:**
- Create: `packages/core/control-server/*`

**Initial API:**

```text
GET  /health
POST /workflows
GET  /workflows/:id
POST /workflows/:id/cancel
```

- [ ] Write RED HTTP lifecycle tests including invalid objective, run/status/cancel, unavailable workflow, restart projection, and concurrent workflow IDs.
- [ ] Bind loopback only (`127.0.0.1`/local equivalent). Add ephemeral process-owned bearer if needed; never persist it.
- [ ] `POST /workflows` starts a Harness-owned workflow and returns durable workflow ID.
- [ ] Status combines durable journal projection with live-run state.
- [ ] Server disposal cancels/settles owned runs and waits for quiescence.
- [ ] Restart surfaces interrupted/inconclusive state instead of silently resuming side effects.
- [ ] Add bounded user-visible status schema suitable for OpenCode bridge.
- [ ] Commit: `feat(trick): add local harness control server`.

---

## Task 12: Integrate Packages into the Trick Harness Bundle and Verify Plan Boundary

**Files:**
- Modify: `packages/core/bundle/*`
- Add real composition/profile fixtures and snapshots
- Update package docs/catalog/Agent Notes

- [ ] Compose contracts, executor runtime/providers, routing, journal, workflow, integrations and control server through `HarnessProfile`.
- [ ] Keep Claude overlay optional/disableable.
- [ ] Add real Loader/profile composition test with fake external services only at true network/product boundaries.
- [ ] Add keyless snapshot for user-visible workflow status/finding/fallback transcript through real control-server entry path.
- [ ] Run focused tests first, then:

```bash
pnpm run constraints
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run test:coverage
pnpm run test:snapshot
pnpm run build
pnpm run hygiene
pnpm run doc-sync
```

- [ ] Run independent code verification against Plan B requirements.
- [ ] Run focused security review of control server, subprocess command construction, credential scrubbing, delivery authority and Supabase isolation.
- [ ] Fix confirmed bugs only; report non-bug improvements separately.

## Plan B Completion Evidence

Plan B is complete when deterministic tests prove generic mechanism plus Plurora profile policy for routing, MiMo heavy invariant, Codex fallback/circuit breaking, journal replay, fresh/cross-executor review, diagnosis→repair separation, QA/security triage, scoped GitHub delivery, cloud-only Preview Branch behavior, bounded PR remediation and control-server cancellation/restart semantics. Product `neuro-via` is not migrated until Plan C.