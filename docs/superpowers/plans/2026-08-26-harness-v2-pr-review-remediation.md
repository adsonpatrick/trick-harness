# Harness V2 PR Review Remediation Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute one correction wave that closes all six PR #1 findings plus all twelve confirmed PR #2 findings before Plan C begins.

**Architecture:** The remediation is deliberately split into ten independently reviewable plans: six existing PR #1 correction plans and four PR #2 integration/runtime plans. They are executed on one implementation correction branch derived from the PR #2 head so the branch contains the complete stacked code being corrected. Every wave ends with fresh evidence; the final gate re-runs the entire acceptance matrix and real GitHub/Supabase canaries.

**Tech Stack:** TypeScript, Vitest, DSH/Cordis Session/subprocess, OpenCode SDK, Codex app-server, Git/gh, Supabase CLI/Postgres/pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-26-harness-v2-pr-review-remediation-design.md`

## Global Constraints

- Do not implement corrections separately on PR #1 and PR #2 branches; use one correction branch containing the full PR #2 stack.
- At execution time, create the correction branch from PR #2 head `b0d2f308f8849c6ffaff3bc6f713b1bb923c56b4` (or its reviewed successor if PR #2 advances before execution).
- Suggested branch name: `fix/harness-v2-pr-review-remediation`.
- The six PR #1 plans remain normative and must be executed even where PR #2 partially changed the same files.
- Heavy/high-volume implementation/repair/QA execution remains MiMo V2.5 unless an explicit human stage override authorizes another executor run.
- Merge/release/deploy are never automated.
- Supabase is cloud-only Preview Branch for database-changing validation; no Docker/local/shared-dev fallback.
- Each child plan uses TDD, focused verification, frequent commits, and a fresh reviewer gate.
- Plan C / NeuroVia integration remains blocked until the final program gate is PASS.

---

## Execution Graph

```text
                    PR #2 reviewed head
                           |
             one remediation implementation branch
                           |
        +------------------+------------------+
        |                                     |
  PR #1 foundation fixes                 PR #1 policy fixes
        |                                     |
        +------------------+------------------+
                           |
                  live routing runtime
                           |
                 journal/control safety
                           |
                 integration safety
                           |
               workflow authority/lifecycle
                           |
                full cross-package verification
                           |
               real GitHub + Supabase canaries
                           |
                       PR READY
```

---

### Task 1: Execute PR #1 Foundation Corrections

**Plans:**
- `docs/superpowers/plans/2026-08-26-fix-profile-flat-scalar-validation.md`
- `docs/superpowers/plans/2026-08-26-fix-boundary-import-analysis.md`
- `docs/superpowers/plans/2026-08-26-fix-executor-quiescent-disposal.md`
- `docs/superpowers/plans/2026-08-26-fix-teardown-failure-observability.md`

**Produces:** trusted profile parsing/boundary enforcement and a quiescent, observable executor lifecycle that later integration/workflow changes can rely on.

- [ ] Execute each child plan exactly with its RED/GREEN/commit gates.
- [ ] Re-run all four focused suites together after the fourth plan.
- [ ] Run typecheck/lint/build/constraints.
- [ ] Fresh reviewer verifies the four original findings are closed against the current correction branch, not against the historical PR #1 diff.

---

### Task 2: Execute PR #1 Routing and Supabase Policy Corrections

**Plans:**
- `docs/superpowers/plans/2026-08-26-fix-plurora-routing-policy.md`
- `docs/superpowers/plans/2026-08-26-fix-supabase-preview-branch-policy.md`

**Produces:** correct primary Plurora routing and a parent/preview-only Supabase policy with no shared-dev ambiguity.

- [ ] Execute both child plans with their own TDD gates.
- [ ] Re-run real `profiles/plurora` tests after both coexist.
- [ ] Confirm `neurovia-dev` is not an automatic execution fallback target.
- [ ] Fresh reviewer confirms the primary routing table and Supabase policy are now safe inputs to the PR #2 runtime fixes.

---

### Task 3: Execute Live Routing/Fallback/Override Remediation

**Plan:** `docs/superpowers/plans/2026-08-26-harness-v2-routing-runtime-remediation.md`

**Produces:** normalized failure taxonomy, hard heavy fallback invariant, live circuit/fallback behavior, and single-consumption human override.

- [ ] Complete all five tasks in the child plan.
- [ ] Prove `usageLimitExceeded` from Codex becomes an authorized live fallback when the stage permits it.
- [ ] Prove `bad-request`, context-window, sandbox/policy and quality failures never take availability fallback.
- [ ] Prove heavy OpenCode outage blocks rather than auto-routing to Codex without explicit override.
- [ ] Fresh reviewer signs off on routing invariants before workflow authority work proceeds.

---

### Task 4: Execute Journal/Control Identity and Durability Remediation

**Plan:** `docs/superpowers/plans/2026-08-26-harness-v2-journal-control-remediation.md`

**Produces:** unique execution ids, pre-mutation durability barrier, explicit capability lifecycle facts, and conservative restart projection.

- [ ] Complete all six tasks in the child plan.
- [ ] Prove repeated attempts of one objective produce independent durable projections.
- [ ] Prove flush failure prevents mutating provider/capability start.
- [ ] Prove an interrupted mutating capability forces `requiresWorldVerification=true` after replay.
- [ ] Fresh reviewer signs off on restart safety before deterministic capabilities are wired into workflow authority.

---

### Task 5: Execute Deterministic Integration Safety Remediation

**Plan:** `docs/superpowers/plans/2026-08-26-harness-v2-integration-safety-remediation.md`

**Produces:** canonical capability ids, whole-tree quiescence for GitHub/Supabase commands, mutation checkpoint observers, and Supabase fail-fast gates.

- [ ] Complete all seven tasks in the child plan.
- [ ] Prove GitHub observer failure after commit prevents push until the confirmed commit can be durably recorded.
- [ ] Prove Supabase migration failure skips migration-list/lint/project-tests/types and still cleans up.
- [ ] Prove Preview branch identity never equals the parent project ref.
- [ ] Fresh reviewer verifies no local/shared/protected-branch escape path.

---

### Task 6: Execute Workflow Authority and PR-Lifecycle Remediation

**Plan:** `docs/superpowers/plans/2026-08-26-harness-v2-workflow-authority-remediation.md`

**Produces:** profile binding, deterministic capability-backed delivery/database gates, security repair policy, and the approved post-PR certification lifecycle.

- [ ] Complete all six tasks in the child plan.
- [ ] Prove delivery never goes through `executors.start()`.
- [ ] Prove database-changing work cannot deliver when Supabase Preview is missing/failing.
- [ ] Prove SECURITY_BUG cannot auto-repair without deterministic policy authorization.
- [ ] Prove high-risk lifecycle ordering is `implement -> verify -> delivery -> review -> qa -> final verify` and critical adds security.
- [ ] Prove every repair cycle re-verifies, re-delivers and re-certifies before final verification.

---

### Task 7: Run the Consolidated PR #1 + PR #2 Acceptance Matrix

**Files:**
- Create during implementation: `docs/verification/2026-08-26-harness-v2-pr-review-remediation.md`
- Update relevant Agent Notes/READMEs required by changed packages.

**Produces:** one auditable evidence record mapping every reviewed bug to a fresh test/gate/real-world check.

- [ ] **Step 1: Record exact correction branch base/head**

Document:

```text
reviewed PR #2 base/head
correction branch base
correction branch head
all child-plan commit SHAs
```

- [ ] **Step 2: Run all directly affected package tests together**

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

Expected: PASS with zero retries hidden by the test command.

- [ ] **Step 3: Run full repository gates**

Run the exact current root scripts for:

```text
workspace constraints
typecheck
lint
build
full test suite
coverage gate where configured
doc sync
hygiene/invariant checks
real entry-path/keyless snapshots
```

If the upstream `packages/workflow` timeout still appears, reproduce it independently and record it as upstream/environmental only if a fresh isolated rerun proves no correction-branch regression. Do not waive a failing Harness-owned package.

- [ ] **Step 4: Build an 18-finding closure table**

Use this exact matrix:

| ID | Finding | Required evidence |
| --- | --- | --- |
| P1-01 | Plurora primary routing | profile route table tests + real profile composition |
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

Every row must cite a current test name and its PASS output/commit.

- [ ] **Step 5: Commit verification record**

```bash
git add docs/verification package-readme-or-agent-note-updates
git commit -m "docs: record harness v2 remediation evidence"
```

---

### Task 8: Run Real GitHub and Supabase Canaries

**Produces:** external-world evidence that deterministic capabilities behave as designed.

- [ ] **Step 1: GitHub canary on a disposable feature branch**

Use the Harness GitHubDelivery path to:

```text
stage a harmless fixture change
commit
normal push current feature branch
open PR
re-read commit/remote SHA/PR identity
```

Assert no protected branch push, force push or merge occurs. Close/delete the canary branch/PR after evidence capture; do not merge it.

- [ ] **Step 2: Supabase Preview canary**

For parent ref `uljaajwwnygopsyvwsre`:

```text
create ephemeral preview
capture preview project ref
assert preview ref != parent ref
wait healthy
apply a harmless canary migration in the disposable canary branch
verify migration history
run remote lint
run project pgTAP/RLS gate
cleanup preview
```

Capture parent migration history before/after and prove it is unchanged.

- [ ] **Step 3: Record safe evidence only**

Do not persist DB URLs, passwords, JWT secrets, access tokens or provider auth material.

- [ ] **Step 4: If either canary fails, mark program BLOCKED**

Do not substitute unit tests for the failed external proof.

---

### Task 9: Independent Final Review

**Produces:** a fresh verdict from a reviewer that did not implement the correction wave.

- [ ] Review exact correction branch diff against reviewed PR #2 head.
- [ ] Re-read the remediation Spec and all ten child plans.
- [ ] Verify the 18-finding closure matrix against code/tests rather than plan checkboxes.
- [ ] Review authority boundaries: model executor vs deterministic capability vs human-only merge/release/deploy.
- [ ] Review Supabase parent/Preview isolation and GitHub protected-branch constraints.
- [ ] Review journal payloads for secret/transcript leakage.
- [ ] Return `PASS | PARTIAL | FAIL | INCONCLUSIVE | BLOCKED` with evidence.

No merge-readiness claim is allowed unless this review is PASS and both real canaries are successful.

---

## Completion Contract

The program is complete only when:

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
