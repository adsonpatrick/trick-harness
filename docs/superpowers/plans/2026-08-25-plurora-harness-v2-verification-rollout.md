# Plurora Harness V2 Verification and Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the assembled Trick Harness + Plurora profile against all approved V2 acceptance criteria using deterministic tests plus real OpenCode, Codex, Claude Code, GitHub, and Supabase effects, then activate V2 as the default Plurora engineering path without granting automatic merge authority.

**Architecture:** Verification is evidence-first and independent from implementation claims. Plans R/A/B provide the reusable runtime and Plurora profile; Plan C provides the `neuro-via` bridge. Plan D first exhausts keyless deterministic evidence, then runs controlled real-product/infrastructure smokes in disposable branches/Preview Branches, verifies replay and teardown, performs independent engineering/security review, remediates confirmed bugs through the approved loop, and only then reconciles the pinned Trick Harness revision and activates V2.

**Tech Stack:** `adsonpatrick/trick-harness`, `adsonpatrick/neuro-via`, Cordis/DSH tests and snapshots, OpenCode TUI/server/SDK, OpenCode Go models, Codex CLI/app-server with ChatGPT-plan auth, Git/GitHub CLI/API, Supabase Branching/CLI/Postgres/pgTAP, Node/Playwright/CI, Codex Engineering Guardrails, Codex Security.

**Spec:** `docs/superpowers/specs/2026-08-25-plurora-engineering-harness-v2-design.md` + approved reusable-core amendment + the executor and database scope amendment `docs/superpowers/specs/2026-08-27-harness-v2-scope-amendment.md`.

> **Normative override, 2026-08-27.** The scope amendment withdraws criterion 8, retains and strengthens criterion 9, keeps criteria 24, 25 and 26 required, and reclassifies criteria 23, 27 and the Supabase half of criterion 30 as PRO-OPTIONAL. Claude Code is not an executor of this harness. Where this plan still reads as though a maintained Claude runtime or a paid Supabase entitlement were required, the amendment governs.

**Requires:** Plans R, A, B, and C complete on reviewable branches with no unresolved confirmed material bug.

## Global Constraints

- Verification is read-only by default. Confirmed bugs are repaired in separate implementation contexts and independently re-verified.
- Missing real environment evidence is `PARTIAL`/`INCONCLUSIVE`, never PASS.
- Completion requires **30/30 base criteria + R1-R5 PASS**.
- Do not expose subscription credentials, API keys, control tokens, Supabase DB URLs/passwords, or private model reasoning in evidence artifacts.
- Real-provider smokes use native product authentication. Codex smoke must not require/inject `OPENAI_API_KEY` for ChatGPT-plan route.
- User/global OpenCode and Codex config files are never rewritten. Before/after evidence may record hashes/metadata, never secret contents.
- Real GitHub tests use disposable non-protected branches/PRs and are closed/deleted after evidence capture. Harness never merges them.
- Real Supabase tests use isolated Preview Branches; parent `neurovia-dev`/production schema must remain unchanged.
- Cleanup outcomes are evidence and do not erase primary results.
- Criterion 30 requires authoritative world-state reads from Git/GitHub/Supabase/process state, not executor prose.
- Trusted Plurora composition must exclude DSH self-modification/model-authored runtime plugins.
- If Plan D fixes change Trick Harness revision after Plan C pinned it, update `plurora-harness.json` to the final verified SHA and rerun bridge smoke.

---

## Acceptance-Criterion Traceability

Base criteria 1-30 are exactly those in the approved Spec, as amended on 2026-08-27: criterion 8 is WITHDRAWN, and criteria 23, 27 and the Supabase half of 30 are PRO-OPTIONAL. Additional reusable-core criteria are:

- **R1:** generic Core/provider/integration packages have no dependency on `profiles/plurora` or `neuro-via`.
- **R2:** `profiles/plurora` reproduces all binding Plurora routing/fallback/QA/security/DB/delivery behavior.
- **R3:** minimal fixture profile boots through the same runtime without loading Plurora policy.
- **R4:** same Trick Harness build executes deterministic fixture workflows under both profiles without Core modification.
- **R5:** `neuro-via` selects `profile=plurora` via config/bridge; project rules are not duplicated into generic Core.

Primary evidence owners:

| Criteria | Evidence task |
| --- | --- |
| 1-2, R1 | Tasks 1-2, 10 |
| 3-5, 11 | Task 3 |
| 6-7, 12-14 | Task 4 |
| 9 (8 withdrawn) | Task 5 |
| 10, 15-20, 22, R2-R4 | Tasks 2, 7, 10 |
| 21, 30 | Task 6 |
| 24-26 required; 23, 27 pro-optional; 30 split | Task 8 |
| 28-29 | Task 9 |
| R5 | Tasks 3, 10-11 |

---

## Task 1: Freeze Verification Targets and Establish the Evidence Ledger

**Files:**
- Create at end: `docs/agents/harness-v2-evidence.md`
- Temporary only: `.scratch/harness-v2-verification/*`

- [ ] Record exact Trick Harness and `neuro-via` SHAs/status before verification.
- [ ] Verify GitHub fork parent is `deepseek-ai/deepseek-harness`, `LICENSE` retains MIT notice, upstream relationship is documented/reachable, and current Trick branch descends from recorded baseline.
- [ ] Create 35-row execution ledger with criterion, observable, best evidence, command/environment, verdict, artifact/ref.
- [ ] Run secret/security hygiene checks in both repos before real smokes.
- [ ] Stop/classify baseline contamination instead of retrying until green.

---

## Task 2: Execute the Deterministic Harness Verification Matrix

- [ ] Run focused suites for profile contract, executor runtime/providers, routing, journal, workflow, delivery, Supabase preview and control server.
- [ ] Run boundary tests proving R1 and dual-profile tests proving R3/R4.
- [ ] Run Plurora profile table tests proving R2, MiMo heavy invariant, semantic Codex tiers/effort and independence policy.
- [ ] Run fallback tests distinguishing Codex availability from quality failure; prove logged fallback and circuit breaker behavior.
- [ ] Run workflow tests proving fresh verifier, read-only debugger, valid `DiagnosisContract`, product/design blocker, independent QA/security, confirmed-bug repair loop, non-bug non-repair, `maxRepairCycles=3`, `maxExecutorStarts=24`, and terminal verdict vocabulary.
- [ ] Run durable replay/compaction tests for route/fallback/finding/diagnosis/verdict/delivery/circuit facts without private reasoning.
- [ ] Run provider abort/dispose tests proving process-tree quiescence.
- [ ] Run real-composition/snapshot tests through control-server entry path.
- [ ] Inspect Plurora trusted composition and assert self-modification/model-authored plugins are not mounted.
- [ ] Run Harness gates:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run test:snapshot
pnpm run build
pnpm run constraints
pnpm run hygiene
pnpm run doc-sync
```

- [ ] Run `neuro-via` keyless gates:

```bash
npm run test:opencode
npm run test:skills
npm run test:db:contract
npm test
npm run lint
npm run typecheck
npm run test:design-system
npm run build
```

Record only what these checks actually prove.

---

## Task 3: Prove OpenCode Cockpit → Trick Harness → OpenCode Worker

- [ ] Snapshot non-secret hashes/mtime of user OpenCode config and current cockpit selection.
- [ ] Start exact pinned Trick Harness control server; verify `/health` through project client.
- [ ] Start OpenCode in `neuro-via`; verify `harness_run`, `harness_status`, `harness_cancel` discoverable.
- [ ] From TUI run safe read-only/light workflow selecting DeepSeek V4 Flash and observe durable workflow ID/status.
- [ ] Run disposable medium implementation smoke selecting MiMo V2.5 with delivery disabled; verify programmatic OpenCode server/SDK/ACP path, never screen-driving.
- [ ] Read durable route/executor facts to confirm model, not worker prose.
- [ ] Re-hash global OpenCode config; expected unchanged.
- [ ] Exercise one valid per-run manual override and prove it is scoped/logged.
- [ ] Inspect bridge config/code and prove `repository=adsonpatrick/trick-harness`, `profile=plurora`, and no duplicated profile routing tables (R5).

---

## Task 4: Prove Native Codex Subscription, Per-Run Effort, and Fallback Facts

- [ ] Snapshot Codex config identity/native login readiness without secret contents.
- [ ] Launch real Harness/Codex smoke with `OPENAI_API_KEY` absent from spawned environment; native ChatGPT-plan auth must work.
- [ ] Run read-only routine review routed to `codex.balanced` + `high`; verify structured app-server/provider telemetry shows scoped model/effort.
- [ ] Re-hash global Codex config; expected unchanged.
- [ ] Verify fresh Codex review context is distinct from implementation worker and consumes bounded handoff/repo state.
- [ ] Exercise quota fallback via deterministic classified `usageLimitExceeded` fixture at provider boundary without intentionally exhausting paid quota; observe fallback + circuit transition.
- [ ] Real successful native run is mandatory for criteria 6-7; fixtures alone cannot PASS them.

---

## Task 5: Prove Core Independence Without a Third Executor

**Amended 2026-08-27.** Claude Code is out of scope, so this task no longer runs a Claude smoke and no longer gates activation on a maintained Claude runtime. Criterion 8 is withdrawn; criterion 9 is retained as a standing property rather than a toggle test.

- [ ] Run the core deterministic suite and confirm the OpenCode/Codex paths are green with no Claude executor composed at all.
- [ ] Confirm no profile, composition root or provider registry names a Claude executor, so criterion 9 holds by construction and not by configuration.
- [ ] Run a representative OpenCode→Codex workflow and record that its semantics do not depend on a third executor being present.
- [ ] Record `independence:unsatisfied` behaviour when only one of the two remaining executors is usable, and confirm it is never silently satisfied.
- [ ] Criterion 9 must PASS. Criterion 8 is reported WITHDRAWN, citing the scope amendment.

---

## Task 6: Disposable Real Implementation → Commit → Push → PR Happy Path

- [ ] Create isolated test worktree from current protected base branch using unique `test/` branch.
- [ ] Start bounded approved fixture implementation through `/implement` bridge.
- [ ] Let Harness execute implementation → focused verification → commit → normal push → PR creation → review → applicable QA → readiness.
- [ ] Verify local/remote Git SHA match through `git status`, `git log`, `git ls-remote`.
- [ ] Verify GitHub PR state independently with `gh pr view --json number,url,headRefName,baseRefName,headRefOid,state,mergeStateStatus,statusCheckRollup`.
- [ ] Confirm no force push, protected-base implementation commit, merge, release or deployment occurred.
- [ ] Confirm fresh review/QA identities and terminal verdict from durable state versus actual PR/CI state.
- [ ] Capture evidence then manually close/delete disposable PR/branch/worktree outside Harness authority.

---

## Task 7: Real PR Review → Bug Repair Loop + Non-Bug Blocker + Bounded Termination

### Scenario A — confirmed bug
- [ ] Create disposable branch with small unambiguous defect + failing regression test.
- [ ] Open test PR; bug exists before automated review.
- [ ] Start Harness review; review/QA observes actual diff/test, classifies `BUG`, debugger produces valid `DiagnosisContract`, separate repair worker runs.
- [ ] Verify regression RED before fix, minimal patch, GREEN, fresh independent re-review/QA and normal push to same PR.
- [ ] Verify actual GitHub head SHA/diff/test state changed.

### Scenario B — product/design decision
- [ ] Produce validated `PRODUCT_DECISION` against genuinely unspecified target; workflow stops `BLOCKED` before mutation.
- [ ] Verify no repair commit/push after blocker.

### Scenario C — bounded termination
- [ ] Keep confirmed bug open through configured three repair cycles via deterministic fixtures; fourth repair does not start, executor-start budget remains bounded, terminal state is `BLOCKED`/`FAIL`, never infinite retry/false PASS.

- [ ] Clean up disposable PRs/branches and record criteria 15-20,22 plus R2 evidence.

---

## Task 8: Real Supabase Preview Branch Migration/RLS Scenario

**Target parent:** `uljaajwwnygopsyvwsre`.

**Amended 2026-08-27.** Preview branching is a Pro entitlement the organisation does not hold. The steps below are split: the entitlement-free steps stay required and must run, and the preview-dependent steps are PRO-OPTIONAL and are reported `NOT_APPLICABLE — entitlement absent` rather than skipped silently. No step may be satisfied by a seam test, a scripted double or an MCP call. If the entitlement is ever acquired, every PRO-OPTIONAL step below becomes required again with no other change.

- [ ] Prove temporary acceptance object absent on parent and record parent migration head.
- [ ] Create disposable DB-changing Git branch with one forward migration, RLS enabled, minimal allowed policy and explicit denied case, plus pgTAP allow/deny tests.
- [ ] PRO-OPTIONAL. Start Harness DB-changing workflow; it must provision isolated hosted Preview Branch. Provision failure => `BLOCKED`, no parent/local fallback.
- [ ] PRO-OPTIONAL. Verify preview ref differs from parent via authoritative Supabase state.
- [ ] PRO-OPTIONAL. Verify migration exists/applied only in preview.
- [ ] Run remote gates with explicit preview environment:

```bash
npm run db:lint
npm run test:db
npm run db:verify
```

- [ ] PRO-OPTIONAL. Verify allow and deny RLS assertions separately.
- [ ] Re-read parent migration/object state; expected unchanged.
- [ ] PRO-OPTIONAL. Verify preview cleanup; cleanup failure is separate operational defect.
- [ ] REQUIRED. Run unavailable-branch fixture and prove BLOCKED instead of shared/local fallback. Already demonstrated against the real API on 2026-08-27, which answered HTTP 402; re-run and record it here.
- [ ] Clean disposable Git branch/PR. Record criteria 24, 25, 26 and the GitHub half of 30 as required results, and criteria 23, 27 and the Supabase half of 30 as PRO-OPTIONAL with their entitlement status.

---

## Task 9: Prove Restart/Replay/Compaction and Process Quiescence

- [ ] Start controllable workflow reaching durable nonterminal stage.
- [ ] Capture workflow ID/event log then terminate control server to simulate restart while preserving session state.
- [ ] Verify child processes terminated and no owned worker remains using DSH handles + OS process inspection.
- [ ] Restart Harness and query same workflow; durable facts reconstruct, unproven in-flight side effects become interrupted/`INCONCLUSIVE`, never silently resume.
- [ ] Exercise compaction/pruning; evidence refs/verdict/delivery facts remain reconstructable.
- [ ] Run explicit OpenCode `harness_cancel`; verify terminal state and process-tree quiescence.
- [ ] Inspect durable payloads and prove private chain-of-thought is neither required nor persisted.

---

## Task 10: Independent Engineering and Security Verification

- [ ] Build verification matrix across exact Trick Harness + `neuro-via` SHAs, keeping specification and engineering-quality axes separate.
- [ ] Inspect tests for mock-only certification, tautological route assertions, missing negative paths, fake delivery/DB evidence, or implementation-mirroring enums.
- [ ] Independently review fork divergences: reusable boundaries/profile seam, executor/Codex/OpenCode adapters, routing/circuit breaker, journal, workflow, GitHub delivery, Supabase preview, control server.
- [ ] Verify R1 through dependency graph/static boundary test and R2-R4 through profile/dual-profile evidence.
- [ ] Independently inspect trusted Plurora composition; self-modification/model-authored plugins not mounted.
- [ ] Independently review `neuro-via` bridge/config for R5, permission floor, DB scripts, skills, CI, Security/Git-flow docs.
- [ ] Run standard Codex Security audit scoped to security-sensitive Harness + bridge/DB/delivery surfaces.
- [ ] Triage findings through V2 taxonomy. Only confirmed eligible defects get separate repair; product/design decisions block/report; improvements/style are reported only; unresolved prevents PASS.
- [ ] For security fixes, independently verify original attack path closed and legitimate behavior preserved.
- [ ] Rerun affected checks + final integrated gates after fixes.

---

## Task 11: Reconcile Final Revisions and Produce 35-Criterion Evidence Artifact

**Files:**
- Modify if required: `neuro-via/plurora-harness.json`
- Create: `neuro-via/docs/agents/harness-v2-evidence.md`
- Modify operator docs only for observed final facts.

- [ ] Resolve final Trick Harness SHA after repairs; if pin changed, update exact SHA in `neuro-via` and run config/control-plane tests.
- [ ] Re-run bridge health + one read-only workflow against final pinned SHA.
- [ ] Re-run final integrated keyless gates in both repos.
- [ ] Create evidence doc from observed evidence only, with 35 rows: verdict, exact commit/PR/workflow/Preview ref, commands/checks, residual limitation.
- [ ] Include operational summary: final Trick Harness SHA, final `neuro-via` SHA, profile policy version, Claude status, Preview evidence date, repair/executor budgets, Codex degraded/fallback observations.
- [ ] Scan evidence doc for predictions/placeholders/unexecuted claims.
- [ ] Commit evidence/pin reconciliation.

---

## Task 12: Activate V2 as Default Engineering Path Without Auto-Merge

**Activation gate (amended 2026-08-27):** all **retained criteria PASS**, every PRO-OPTIONAL criterion explicitly reported with its entitlement status rather than assumed, criterion 8 recorded as WITHDRAWN, no unresolved material engineering/security finding, trusted Plurora profile excludes self-modification/model-authored runtime plugins, and final `neuro-via` pin matches independently verified Trick Harness SHA.

- [ ] Record in the activation artefact which criteria were PRO-OPTIONAL and unmet, so activation states what it did not prove.
- [ ] Change operator docs from candidate/rollout wording to default V2 path.
- [ ] Mark Spec `Approved / Implemented` only after evidence gate; approval exists now, implementation status is earned here.
- [ ] Mark V1 docs historical/superseded where V2 conflicts, preserving record.
- [ ] Verify human merge authority remains explicit and automation cannot merge/release/deploy.
- [ ] Run final docs/control-plane gates.
- [ ] Open/update implementation PR(s) for human review; do not auto-merge.
- [ ] Synchronize delivery status to Notion/Linear/GitHub according to operating model only after repository evidence exists; Harness does not become duplicate backlog.

## Plan D Completion Contract

Plan D is complete only when all **retained base acceptance criteria + R1-R5** have fresh direct PASS evidence and every PRO-OPTIONAL criterion carries an explicit entitlement status, final `neuro-via` pin references independently verified Trick Harness SHA, real OpenCode and Codex native paths ran successfully, real GitHub delivery/repair effects were independently observed, replay/quiescence were proven, reusable boundaries and dual-profile behavior were proven, confirmed bugs were closed/re-reviewed, product/design decisions remained un-invented, and V2 was activated without automatic merge authority.