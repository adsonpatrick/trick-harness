# NeuroVia GitHub Harness Certification Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the reviewed Plan H certification capability into NeuroVia and make `plurora/harness-certification` a real required `main`-branch status without weakening existing CI or human merge authority.

**Architecture:** NeuroVia adds its exact project-repository identity to non-secret Harness deployment config, exposes certification state through existing operator/readiness surfaces, and updates branch protection only after the installation PR has received a real Harness-produced status. The first protected fresh-SHA transition is then used as the end-to-end proof that an old certification cannot satisfy a new commit.

**Tech Stack:** NeuroVia Node/Next.js repository, existing `plurora-harness.json` and Harness launcher from Plan C*, native `gh`, GitHub Commit Status API, existing branch-protection script, Node test runner, existing OpenCode/skills/CI gates.

**Spec:** `docs/superpowers/specs/2026-08-28-harness-v2-github-certification-gate-amendment.md`

**Requires:** Harness-side Plan H complete, independently reviewed and carrying an exact reviewed Trick Harness SHA. Execute this overlay in the same NeuroVia integration branch as Plan C* + Conformance/Change-Impact wiring, before final Plan D activation.

## Global Constraints

- Project repository is exactly `adsonpatrick/neuro-via`.
- Required certification context is exactly `plurora/harness-certification` and is not configurable from `plurora-harness.json`.
- Existing required checks `validate`, `design-system`, `e2e`, `build` remain required.
- `strict=true`, `enforce_admins=true`, required PRs, conversation resolution, linear history, force-push denial and branch-deletion denial remain unchanged.
- Do not enable the new required context until a real Harness-produced status exists on the installation PR.
- A fresh push after activation must demonstrate old-SHA certification invalidation before final activation.
- Harness remains unable to merge/release/deploy.
- Native `gh` auth remains the only GitHub auth path; no committed token/secret.

---

### Task 1: Add Exact Project Repository Identity to Deployment Config

**Files:**
- Modify: `plurora-harness.json`
- Modify: `scripts/harness/config.mjs`
- Modify: `scripts/harness/config.test.mjs`

**Config addition:**

```json
{
  "projectRepository": "adsonpatrick/neuro-via"
}
```

The config must **not** contain `certificationContext`, `statusContext`, `githubToken` or equivalent fields.

- [ ] **Step 1: Write RED config tests** requiring exact `projectRepository` and rejecting any attempt to add certification-context or credential-shaped fields.
- [ ] **Step 2: Run RED.**

```bash
node --test scripts/harness/config.test.mjs
```

- [ ] **Step 3: Extend `loadHarnessConfig()`** to require `projectRepository === 'adsonpatrick/neuro-via'` while preserving all existing runtime/profile/model/DB constraints.
- [ ] **Step 4: Write the exact project repository into `plurora-harness.json` and keep the reviewed post-Plan-H Trick revision.**
- [ ] **Step 5: Run GREEN.**

```bash
node --test scripts/harness/config.test.mjs
```

- [ ] **Step 6: Commit.**

```bash
git add plurora-harness.json scripts/harness/config.mjs scripts/harness/config.test.mjs
git commit -m "feat(harness): bind certification to NeuroVia repository"
```

---

### Task 2: Surface Certification in Harness Operator and PR Readiness

**Files:**
- Modify: `scripts/harness/control-client.mjs`
- Modify: `scripts/harness/control-client.test.mjs`
- Modify: `.opencode/agents/harness-operator.md`
- Modify: `.opencode/commands/pr-ready.md`
- Modify: `.agents/skills/pr-readiness/SKILL.md`
- Modify: `.agents/skills/pr-readiness/evals/evals.json`
- Modify: `docs/agents/harness.md`

**Expected status projection:**

```ts
interface HarnessCertificationStatus {
  readonly state: 'pending' | 'success' | 'failure' | 'error'
  readonly revision: string
  readonly externalId: string
}
```

- [ ] **Step 1: Write RED client/skill evals** proving `/pr-ready` refuses READY when certification is absent, pending, failure, error or for a different revision.
- [ ] **Step 2: Add RED positive fixture** requiring `success` on the same 40-hex revision reported as the current PR head.
- [ ] **Step 3: Run RED.**

```bash
node --test scripts/harness/control-client.test.mjs
npm run test:skills
npm run test:opencode
```

- [ ] **Step 4: Update operator/readiness surfaces** so the human sees bounded certification state + revision, while detailed Spec/Plan/DoD verdicts remain sourced from Harness rather than duplicated in project prompts.
- [ ] **Step 5: Run GREEN.**

```bash
node --test scripts/harness/control-client.test.mjs
npm run test:skills
npm run test:opencode
```

- [ ] **Step 6: Commit.**

```bash
git add scripts/harness .opencode .agents/skills/pr-readiness docs/agents/harness.md
git commit -m "feat(harness): surface GitHub certification readiness"
```

---

### Task 3: Make Branch Protection Require Harness Certification

**Files:**
- Modify: `scripts/git/setup-branch-protection.sh`
- Create: `scripts/git/verify-branch-protection.mjs`
- Create: `scripts/git/verify-branch-protection.test.mjs`
- Modify: `docs/git-flow.md`
- Modify: `AGENTS.md`

**Required contexts after activation:**

```text
validate
design-system
e2e
build
plurora/harness-certification
```

The existing protection JSON keeps:

```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "validate",
      "design-system",
      "e2e",
      "build",
      "plurora/harness-certification"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": true,
    "require_last_push_approval": false
  },
  "required_conversation_resolution": true,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "restrictions": null
}
```

- [ ] **Step 1: Write RED parser tests** for `verify-branch-protection.mjs` using fixtures missing certification, missing an existing CI check, `strict=false`, `enforce_admins=false`, force-push enabled and deletion enabled.
- [ ] **Step 2: Run RED.**

```bash
node --test scripts/git/verify-branch-protection.test.mjs
```

- [ ] **Step 3: Implement the verifier** to accept JSON from `gh api repos/adsonpatrick/neuro-via/branches/main/protection` and fail unless every invariant above is present.
- [ ] **Step 4: Modify `setup-branch-protection.sh`** only to add the certification context and update its explanatory output/comments. Do not remove or rename existing contexts.
- [ ] **Step 5: Run static GREEN.**

```bash
node --test scripts/git/verify-branch-protection.test.mjs
bash -n scripts/git/setup-branch-protection.sh
```

- [ ] **Step 6: Document the bootstrap ordering**: real Harness status first, protection second; never run setup preemptively on a context that has not been proven.
- [ ] **Step 7: Commit without applying branch protection yet.**

```bash
git add scripts/git docs/git-flow.md AGENTS.md
git commit -m "feat(git): require Harness certification in branch protection"
```

---

### Task 4: Prove a Real Harness Status Before Enabling the Required Context

**Files:**
- Create: `docs/agents/harness-certification-evidence.md`

**Precondition:** Installation PR is open, current branch is delivered, all Plan C*/F/G/H applicable gates are capable of running, and `plurora-harness.json` pins the reviewed post-Plan-H Trick SHA.

- [ ] **Step 1: Record the exact installation PR head SHA.**

```bash
PR_NUMBER="$(gh pr view --json number -q .number)"
HEAD_SHA="$(gh pr view --json headRefOid -q .headRefOid)"
printf '%s\n' "$PR_NUMBER" "$HEAD_SHA"
```

- [ ] **Step 2: Run the real Harness certification workflow to terminal readiness** for that exact published state. Do not manually POST a success status.
- [ ] **Step 3: Read GitHub's latest certification status for the exact SHA.**

```bash
gh api "repos/adsonpatrick/neuro-via/commits/${HEAD_SHA}/statuses" \
  --jq '[.[] | select(.context == "plurora/harness-certification")][0] | {state,context,description,target_url}'
```

Expected:

```text
state=success
context=plurora/harness-certification
```

- [ ] **Step 4: Verify Harness status reports the same revision** and that Conformance + final verification evidence correspond to this SHA.
- [ ] **Step 5: Record only bounded evidence** in `docs/agents/harness-certification-evidence.md`: PR number, SHA, context, state, workflow id and gate verdict summary. No tokens/raw logs.
- [ ] **Step 6: Commit the evidence file only after capturing the successful pre-protection canary.** This commit intentionally creates a new PR head SHA that is **not** certified yet and will be used in Task 5.

```bash
git add docs/agents/harness-certification-evidence.md
git commit -m "docs(harness): record certification bootstrap evidence"
git push
```

---

### Task 5: Enable Protection and Prove Fresh-SHA Invalidation

**Files:**
- Modify: `docs/agents/harness-certification-evidence.md`

- [ ] **Step 1: Apply the reviewed branch-protection script now that a real certification context has existed.**

```bash
./scripts/git/setup-branch-protection.sh
```

- [ ] **Step 2: Re-read and verify the protection object.**

```bash
gh api repos/adsonpatrick/neuro-via/branches/main/protection \
  | node scripts/git/verify-branch-protection.mjs
```

Expected: exit 0 and confirmation of all five contexts plus existing protection invariants.

- [ ] **Step 3: Read the current PR head SHA after the Task 4 evidence commit.** It must differ from the previously certified SHA.

```bash
NEW_HEAD_SHA="$(gh pr view --json headRefOid -q .headRefOid)"
test "$NEW_HEAD_SHA" != "$HEAD_SHA"
```

- [ ] **Step 4: Prove the old success does not satisfy the new SHA.** Read statuses on `NEW_HEAD_SHA`; `plurora/harness-certification=success` must be absent before rerun.

```bash
gh api "repos/adsonpatrick/neuro-via/commits/${NEW_HEAD_SHA}/statuses" \
  --jq '[.[] | select(.context == "plurora/harness-certification")][0] // null'
```

Expected before rerun: `null` or non-success.

- [ ] **Step 5: Confirm GitHub does not consider the PR fully merge-ready while the required certification for the new SHA is absent/non-success.** Use:

```bash
gh pr view --json mergeStateStatus,statusCheckRollup
```

Record the bounded result.

- [ ] **Step 6: Re-run the real Harness workflow against `NEW_HEAD_SHA`.** Observe `pending` during the run, then `success` only after final certification.
- [ ] **Step 7: Re-read exact SHA status and PR check rollup.** Certification must now be success for `NEW_HEAD_SHA`; existing CI checks must independently remain required.
- [ ] **Step 8: Append the fresh-SHA invalidation/recertification evidence to the evidence doc and commit.** This final evidence commit creates another SHA, so immediately run certification one final time after pushing it; the final PR head must itself hold success before handoff.

```bash
git add docs/agents/harness-certification-evidence.md
git commit -m "docs(harness): prove required certification freshness"
git push
```

- [ ] **Step 9: Run one final Harness certification on the final evidence commit SHA and re-read GitHub status.** Do not merge.

---

### Task 6: Final Security/Authority Verification

**Files:**
- Modify: `docs/agents/harness-certification-evidence.md`
- Modify: `SECURITY.md`

- [ ] **Step 1: Verify native auth and no credential expansion.** Confirm no project file adds `GITHUB_TOKEN`, PAT, private key or certification credential.
- [ ] **Step 2: Verify authority separation.** Search project Harness tools/skills/config for merge/release/deploy authority and confirm certification introduced none.
- [ ] **Step 3: Document current status-source trust boundary in `SECURITY.md`:** repository writers can create commit statuses; current single-owner repository treats that owner as trusted, and adding an independent writer triggers migration to a dedicated GitHub App/source-bound required check.
- [ ] **Step 4: Run project gates.**

```bash
npm run test:opencode
npm run test:skills
npm run test:db:contract
npm test
npm run lint
npm run typecheck
npm run build
node --test scripts/git/verify-branch-protection.test.mjs
bash -n scripts/git/setup-branch-protection.sh
git diff --check
```

- [ ] **Step 5: Re-read current `main` branch protection and final PR head certification status.** Both must match the documented state.
- [ ] **Step 6: Perform independent review** of branch-protection mutation, exact-SHA binding, stale-SHA behavior, status-source threat model, secrets and human-only merge authority.
- [ ] **Step 7: Fix confirmed defects, rerun affected gates, update bounded evidence and perform one final certification if the head SHA changes.**
- [ ] **Step 8: Commit and hand off to Plan D Tasks 11/12; do not merge.**

## Completion Contract

This NeuroVia overlay is complete only when the project config binds the Harness to `adsonpatrick/neuro-via`, readiness surfaces require the latest certification revision, `main` protection requires `validate + design-system + e2e + build + plurora/harness-certification`, the required context was enabled only after a real Harness status existed, a fresh push proved an old SHA's success does not satisfy the new head, the final head was re-certified successfully, native `gh` auth remained unchanged, the source-authentication limitation is documented, and Harness still cannot merge/release/deploy.
