# Harness V2 PR Review Remediation Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute one correction wave that closes all six PR #1 findings plus all twelve confirmed PR #2 findings before Plan C begins.

**Architecture:** The remediation is split into ten independently reviewable child plans: six existing PR #1 correction plans and four PR #2 remediation plans. Implementation happens on one correction branch derived from the complete PR #2 stack. Each wave has TDD/focused gates and a fresh review; the final gate re-runs an 18-finding acceptance matrix plus real GitHub and Supabase canaries.

**Tech Stack:** TypeScript, Vitest, DSH/Cordis Session/subprocess, OpenCode SDK, Codex app-server, Git/gh, Supabase CLI/Postgres/pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-26-harness-v2-pr-review-remediation-design.md`

## Global Constraints

- Do not implement PR #1 and PR #2 fixes on separate correction branches.
- At execution start, create `fix/harness-v2-pr-review-remediation` from PR #2 reviewed head `b0d2f308f8849c6ffaff3bc6f713b1bb923c56b4`, unless PR #2 advances; if it advances, first re-review the new head and record that SHA as the correction base.
- The six PR #1 plans remain normative even where PR #2 changed the same files.
- Heavy/high-volume implementation/repair/QA execution remains MiMo V2.5 unless an explicit human stage override authorizes another executor run.
- Merge/release/deploy remain human-only.
- Supabase is cloud-only Preview Branch for database-changing validation; no Docker/local/shared-dev fallback.
- Each child plan uses RED -> GREEN -> focused gates -> commit -> fresh review.
- Plan C / NeuroVia integration remains blocked until this program reaches final PASS.

---

## Child Plan Set

### Existing PR #1 correction plans

1. `docs/superpowers/plans/2026-08-26-fix-profile-flat-scalar-validation.md`
2. `docs/superpowers/plans/2026-08-26-fix-boundary-import-analysis.md`
3. `docs/superpowers/plans/2026-08-26-fix-executor-quiescent-disposal.md`
4. `docs/superpowers/plans/2026-08-26-fix-teardown-failure-observability.md`
5. `docs/superpowers/plans/2026-08-26-fix-plurora-routing-policy.md`
6. `docs/superpowers/plans/2026-08-26-fix-supabase-preview-branch-policy.md`

### PR #2 remediation plans

7. `docs/superpowers/plans/2026-08-26-harness-v2-routing-runtime-remediation.md`
8. `docs/superpowers/plans/2026-08-26-harness-v2-journal-control-remediation.md`
9. `docs/superpowers/plans/2026-08-26-harness-v2-integration-safety-remediation.md`
10. `docs/superpowers/plans/2026-08-26-harness-v2-workflow-authority-remediation.md`

---

## Execution Graph

```text
PR #2 reviewed head
       |
fix/harness-v2-pr-review-remediation
       |
PR #1 foundation corrections
       |
PR #1 routing + Supabase policy corrections
       |
live routing / fallback / override
       |
journal + run identity + durability
       |
integration process/mutation safety
       |
workflow authority + PR lifecycle
       |
18-finding acceptance matrix
       |
GitHub canary + Supabase Preview canary
       |
fresh independent final review
       |
PR READY
```

---

### Task 1: Execute PR #1 Foundation Corrections

**Plans:** child plans 1-4 above.

- [ ] Execute flat-scalar profile validation plan.
- [ ] Execute boundary import analysis plan.
- [ ] Execute executor quiescent disposal plan.
- [ ] Execute teardown failure observability plan.
- [ ] Re-run all four affected package suites together.
- [ ] Run typecheck, lint, build, workspace constraints, and package invariant gates.
- [ ] Fresh reviewer confirms all four original findings are closed against the current correction branch.

---

### Task 2: Execute PR #1 Routing and Supabase Policy Corrections

**Plans:** child plans 5-6 above.

- [ ] Execute Plurora routing policy plan.
- [ ] Execute Supabase Preview branch policy plan.
- [ ] Re-run `profiles/plurora` tests with both fixes present.
- [ ] Confirm `neurovia-dev` is not an automatic execution fallback target.
- [ ] Fresh reviewer confirms primary routing and Preview-only DB policy are safe inputs to PR #2 runtime remediation.

---

### Task 3: Execute Live Routing/Fallback/Override Remediation

**Plan:** `docs/superpowers/plans/2026-08-26-harness-v2-routing-runtime-remediation.md`

- [ ] Normalize Codex/provider failures into one routing vocabulary.
- [ ] Enforce heavy-work fallback invariant.
- [ ] Wire availability failure/circuit/fallback into live WorkflowRunner.
- [ ] Wire single-consumption human override through control server -> workflow -> router.
- [ ] Verify with real `pluroraProfile` composition.
- [ ] Fresh reviewer signs off before authority/lifecycle work proceeds.

---

### Task 4: Execute Journal/Control Identity and Durability Remediation

**Plan:** `docs/superpowers/plans/2026-08-26-harness-v2-journal-control-remediation.md`

- [ ] Separate logical objective id from generated workflow execution id.
- [ ] Key control-server live/status/cancel operations by generated workflow id.
- [ ] Add durable executor-start barrier before dispatch.
- [ ] Add durable capability start/end facts.
- [ ] Make restart assessment conservative around interrupted mutation windows.
- [ ] Verify composed replay/status behavior.
- [ ] Fresh reviewer signs off on restart safety.

---

### Task 5: Execute Deterministic Integration Safety Remediation

**Plan:** `docs/superpowers/plans/2026-08-26-harness-v2-integration-safety-remediation.md`

- [ ] Normalize Plurora capability ids and Supabase parent policy.
- [ ] Make GitHubDelivery await whole-tree quiescence.
- [ ] Checkpoint verified GitHub mutations before the next mutation.
- [ ] Make SupabasePreview await whole-tree quiescence.
- [ ] Convert Supabase Preview gates to fail-fast dependency order.
- [ ] Checkpoint Preview/migration/cleanup mutations safely.
- [ ] Verify real-profile integration composition.
- [ ] Fresh reviewer confirms no local/shared/protected-branch escape path.

---

### Task 6: Execute Workflow Authority and PR-Lifecycle Remediation

**Plan:** `docs/superpowers/plans/2026-08-26-harness-v2-workflow-authority-remediation.md`

- [ ] Bind `objective.profileId` to the composed profile before any side effect.
- [ ] Route delivery through deterministic GitHub capability, not executors.
- [ ] Require Supabase Preview capability for database-changing workflows.
- [ ] Add deterministic deny-by-default security repair authorization.
- [ ] Replace default lifecycle with post-PR fresh certification flow.
- [ ] Prove capability authority cannot be bypassed by LLM executors.
- [ ] Fresh reviewer verifies final workflow authority model.

---

### Task 7: Run the Consolidated 18-Finding Acceptance Matrix

**File:**
- Create: `docs/verification/2026-08-26-harness-v2-pr-review-remediation.md`

- [x] **Step 1: Record exact execution provenance**

The verification file must record:

```text
reviewed PR #2 base/head
correction branch base/head
all child-plan commit SHAs
Supabase parent project ref used for canary
GitHub canary branch/PR identity
```

Do not record secrets or connection strings.

- [x] **Step 2: Run affected package suites together**

```bash
pnpm vitest run \
  packages/core/profile \
  packages/core/executor \
  packages/core/routing \
  packages/core/journal \
  packages/core/control-server \
  packages/core/engineering-workflow \
  packages/providers/opencode \
  packages/providers/codex \
  packages/integrations/github-delivery \
  packages/integrations/supabase-preview \
  packages/composition/runtime \
  profiles/plurora
```

- [x] **Step 3: Run full repository gates**

Run the exact current root scripts for workspace constraints, typecheck, lint, build, full tests, coverage where configured, doc-sync, hygiene/invariants, and real entry-path/keyless snapshots.

A Harness-owned failing package blocks completion. An upstream/environmental timeout may be classified as external only after a fresh isolated rerun proves it is not caused by the correction branch.

- [x] **Step 4: Complete this exact closure table in the verification file**

| ID | Finding | Required evidence |
| --- | --- | --- |
| P1-01 | Plurora primary routing | profile route tests + real profile composition |
| P1-02 | Executor quiescent disposal | abort/dispose process-tree tests |
| P1-03 | Teardown failure observability | provider teardown failure tests |
| P1-04 | Flat-scalar profile validation | parser RED/GREEN matrix |
| P1-05 | Supabase Preview policy | profile + no-shared-fallback tests |
| P1-06 | Boundary import analysis | boundary checker adversarial fixtures |
| R2-01 | Heavy fallback invariant | heavy outage block + explicit override test |
| R2-02 | Live circuit/fallback | availability reroute + quality non-reroute tests |
| R2-03 | Capability authority wiring | no executor delivery/DB bypass composition tests |
| R2-04 | Capability id mismatch | real Plurora profile composition |
| R2-05 | Pre-mutation durability | deferred/failed flush tests |
| R2-06 | Workflow id reuse | two-attempt isolated projection test |
| R2-07 | Security repair gate | deny-by-default + narrow deterministic allow test |
| R2-08 | Default PR lifecycle | stage-order + repair-cycle tests |
| R2-09 | Manual override plumbing | control -> workflow -> router single-consumption test |
| R2-10 | Integration quiescence | GitHub/Supabase `waitForExit` tests |
| R2-11 | Supabase fail-fast gates | migration/lint failure skip matrix |
| R2-12 | Profile identity binding | mismatch starts zero work |

Each row must cite a current test name, result, and commit SHA.

- [x] **Step 5: Commit verification evidence**

```bash
git add docs/verification/2026-08-26-harness-v2-pr-review-remediation.md
git commit -m "docs: record harness v2 remediation evidence"
```

---

### Task 8: Run Real GitHub and Supabase Canaries

- [ ] **Step 1: GitHubDelivery canary**

On a disposable feature branch, use the Harness delivery capability to stage a harmless fixture change, commit, normal-push, open a PR, and re-read commit/remote SHA/PR identity. Do not force-push or merge. Close/delete the canary PR/branch after evidence is captured.

- [ ] **Step 2: Supabase Preview canary**

For parent ref `uljaajwwnygopsyvwsre`:

```text
capture parent migration state
create ephemeral preview
capture preview project ref
assert preview ref != parent ref
wait healthy
apply harmless canary migration
verify migration history
run remote lint
run project pgTAP/RLS gate
cleanup preview
re-read parent migration state
assert parent unchanged
```

- [ ] **Step 3: Record bounded non-secret evidence in the verification file**

Do not persist DB URLs, passwords, JWT secrets, access tokens, or provider auth material.

- [ ] **Step 4: Canary failure blocks completion**

Do not substitute unit tests for failed external proof.

---

### Task 9: Independent Final Review

- [ ] Review the exact correction branch diff against the reviewed PR #2 head.
- [ ] Re-read the remediation Spec and all ten child plans.
- [ ] Verify the 18-finding closure matrix against code/tests, not checkboxes.
- [ ] Review model-executor vs deterministic-capability vs human-only authority boundaries.
- [ ] Review Supabase parent/Preview isolation and GitHub protected-branch constraints.
- [ ] Review journal payloads for secret/transcript leakage.
- [ ] Return `PASS | PARTIAL | FAIL | INCONCLUSIVE | BLOCKED` with evidence.

No PR-ready claim is allowed unless this review is PASS and both real canaries are PASS.

---

## Completion Contract

```text
6/6 PR #1 findings closed
12/12 PR #2 findings closed
all focused + full-repo gates green
GitHub canary PASS
Supabase Preview canary PASS
fresh independent review PASS
zero confirmed material bugs
merge/release/deploy still human-only
```

Only then may Plan C / NeuroVia integration resume.
