# NeuroVia Implementation Conformance & DoD Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the post-Plan-F Trick Harness conformance gate into `adsonpatrick/neuro-via` so every approved implementation run supplies the exact Spec/Plan artifacts, PR readiness consumes the resulting conformance matrix, and no worker/CI self-report can substitute for Plan/DoD completeness.

**Architecture:** This is a normative overlay on `2026-08-27-neurovia-harness-installation-amendment.md`; execute it in the same NeuroVia integration branch. The project bridge owns repository-relative approved-artifact selection and SHA-256 computation, while the pinned Trick host owns deterministic manifest creation and certification. Existing human approval gates remain: `/implement` may start only after the user has approved the Spec and Plan. `pr-readiness` supplies project evidence/DoD context and consumes Harness conformance, but it does not independently invent a PASS for plan completeness.

**Tech Stack:** NeuroVia Node/Next.js repository, Node built-ins (`crypto`, `fs`, `path`), OpenCode custom tools via `@opencode-ai/plugin`, post-Plan-F Trick Harness control server, existing Plurora Superpowers specs/plans and skill validator.

**Spec:** `docs/superpowers/specs/2026-08-28-harness-v2-implementation-conformance-dod-amendment.md`

**Requires:** Plan E and Plan F complete and independently reviewed. `plurora-harness.json.revision` must pin the final post-Plan-F reviewed SHA, not the intermediate Plan E SHA.

## Global Constraints

- `/refine` and `/plan` remain human-gated; no workflow infers approval from file existence.
- `/implement` requires one repository-local approved Spec path and one repository-local approved Plan path.
- The model cannot supply absolute/external artifact paths; containment under the active `context.worktree`/project root is checked deterministically.
- Artifact hashes are SHA-256 over exact file bytes at run start and are sent as bounded objective metadata.
- Whole Spec/Plan content, prompts, transcripts and reasoning are not persisted by the project bridge.
- `pr-readiness` cannot claim Plan/DoD completeness unless Harness conformance is PASS for the same artifact hashes and final published branch state.
- `opencode.jsonc` retains `git push*` denial and no global model/provider override.

---

### Task 1: Add Approved Artifact Resolution and Hashing

**Files:**
- Create: `scripts/harness/approved-artifacts.mjs`
- Create: `scripts/harness/approved-artifacts.test.mjs`
- Modify after Plan C* Task 1: `scripts/harness/config.mjs` only if shared path helpers belong there

**Interfaces:**

```js
resolveApprovedArtifacts({ rootDir, specPath, planPath })
  -> Promise<{
    spec: { path: string, sha256: string },
    plan: { path: string, sha256: string },
  }>
```

- [ ] **Step 1: Write RED tests** for valid repository-relative files, absolute path rejection, `..` traversal rejection, symlink escape rejection, missing file, directory instead of file and stable lowercase SHA-256 of exact bytes.
- [ ] **Step 2: Run RED.**

```bash
node --test scripts/harness/approved-artifacts.test.mjs
```

- [ ] **Step 3: Implement containment with real paths.** Resolve `rootDir` and candidate files through `fs.realpath`; both final real paths must equal or be descendants of the project root real path. Return normalized forward-slash repository-relative paths and SHA-256 only.
- [ ] **Step 4: Run GREEN.**

```bash
node --test scripts/harness/approved-artifacts.test.mjs
```

- [ ] **Step 5: Commit.**

```bash
git add scripts/harness/approved-artifacts.mjs scripts/harness/approved-artifacts.test.mjs
git commit -m "feat(harness): resolve approved implementation artifacts"
```

---

### Task 2: Extend the Control Client and OpenCode `harness_run` Tool

**Files:**
- Modify after Plan C* creates them: `scripts/harness/control-client.mjs`
- Modify: `scripts/harness/control-client.test.mjs`
- Modify: `.opencode/tools/harness.ts`
- Modify: `scripts/opencode/validate-control-plane.mjs`
- Modify: `scripts/opencode/validate-control-plane.test.mjs`

**OpenCode tool input:**

```ts
harness_run {
  objective: string
  entryRole: 'implement' | 'debug' | 'verify' | 'review' | 'security' | 'qa'
  specPath?: string
  planPath?: string
  risk?: 'low' | 'medium' | 'high' | 'critical'
}
```

For `entryRole='implement'`, `specPath` and `planPath` are required. Other entry roles may address an already-running workflow by its bounded operation contract rather than minting a new implementation objective without artifacts.

- [ ] **Step 1: Write RED HTTP/client tests** proving the outgoing workflow objective contains `approvedArtifacts.spec.path/sha256` and `approvedArtifacts.plan.path/sha256` and contains no document content.
- [ ] **Step 2: Write RED OpenCode tests** proving implement without either path is rejected before HTTP, external path cannot escape the worktree, and cwd remains derived from `context.worktree`/`context.directory`.
- [ ] **Step 3: Implement tool-side call to `resolveApprovedArtifacts`** before `startWorkflow`; do not let the LLM provide hashes.
- [ ] **Step 4: Keep bounded error output.** A hash/path failure may name the repository-relative requested path but must not dump file content or arbitrary filesystem data.
- [ ] **Step 5: Run GREEN.**

```bash
node --test scripts/harness/control-client.test.mjs scripts/harness/approved-artifacts.test.mjs
npm run test:opencode
```

- [ ] **Step 6: Commit.**

```bash
git add scripts/harness .opencode/tools/harness.ts scripts/opencode
git commit -m "feat(harness): send approved artifacts to conformance workflow"
```

---

### Task 3: Make `/implement` Explicitly Carry the Approved Spec and Plan

**Files:**
- Modify after Plan C* rewires it: `.opencode/commands/implement.md`
- Modify: `scripts/opencode/validate-control-plane.mjs`
- Modify: `scripts/opencode/validate-control-plane.test.mjs`
- Modify: `docs/agents/harness.md`

**Command contract:**

```text
/implement <spec-path> <plan-path> <objective text>
```

The command is used only after explicit human approval of those artifacts. The operator calls `harness_run(entryRole='implement', specPath=..., planPath=..., objective=...)`; it does not inspect a directory and guess the newest Spec/Plan.

- [ ] **Step 1: Write RED validator tests** proving the implement command names both approved artifact inputs, delegates only through `harness_run`, and contains no instruction to auto-select/auto-approve a plan.
- [ ] **Step 2: Rewrite the command and operator docs** with examples using repository-relative `docs/superpowers/specs/...` and `docs/superpowers/plans/...` paths.
- [ ] **Step 3: Document artifact freeze semantics:** editing either approved file after the run starts blocks certification; scope changes require a newly approved Spec/Plan/run rather than hash replacement behind the workflow.
- [ ] **Step 4: Run `npm run test:opencode` GREEN and commit.**

```bash
git add .opencode/commands/implement.md scripts/opencode docs/agents/harness.md
git commit -m "docs(harness): require approved Spec and Plan for implementation"
```

---

### Task 4: Upgrade `pr-readiness` to Consume Conformance Instead of Self-Certifying Plan Completion

**Files:**
- Modify: `.agents/skills/pr-readiness/SKILL.md`
- Modify: `.agents/skills/pr-readiness/references/provenance.md`
- Modify: `.agents/skills/pr-readiness/evals/evals.json`
- Modify: `.agents/skills/pr-readiness/evals/evidence.md`

**Required readiness sequence:**

```text
read final branch/diff
-> classify changed surfaces
-> run/verify applicable project gates
-> read Harness terminal projection
-> verify approved artifact hashes match the workflow
-> require latest conformance PASS
-> require final verification PASS
-> require no material open defect
-> report READY / NOT READY with evidence
```

- [ ] **Step 1: Add RED/baseline eval** where CI/tests/review are green but `PLAN-TASK-4=MISSING`; expected readiness is NOT READY.
- [ ] **Step 2: Add eval** where a worker says all tasks are done but Harness conformance is absent/INCONCLUSIVE; expected NOT READY.
- [ ] **Step 3: Add eval** where Spec/Plan paths match but hashes changed after approval; expected BLOCKED/NOT READY.
- [ ] **Step 4: Add positive eval** with conformance PASS, final verification PASS, applicable surface gates PASS and no material finding; readiness may return READY.
- [ ] **Step 5: Rewrite the skill** so project evidence selection remains its responsibility, while Spec/Plan completeness is read from Harness conformance rather than re-derived from worker claims.
- [ ] **Step 6: Run `npm run test:skills` GREEN and commit.**

```bash
git add .agents/skills/pr-readiness
git commit -m "feat(skills): require Harness conformance for PR readiness"
```

---

### Task 5: Add Project DoD Evidence Mapping Without Duplicating Harness Policy

**Files:**
- Modify: `docs/agents/harness.md`
- Modify: `AGENTS.md`
- Modify: `SECURITY.md`
- Modify: `docs/git-flow.md`
- Modify only if the Plan C* profile/deployment config schema supports project DoD labels: `plurora-harness.json`
- Modify: `scripts/harness/config.test.mjs` when config changes

**Boundary:** baseline DoD obligation IDs live in `profiles/plurora/conformance-policy.ts` after Plan F. NeuroVia documentation maps which project evidence satisfies them; it does not copy the model routing table or redefine the obligation IDs differently.

**Project evidence mapping:**

```text
DOD-APPROVED-ARTIFACTS  => objective artifact paths+hashes + host revalidation
DOD-DIFF-COHERENCE      => final branch/diff/readiness inspection
DOD-FRESH-EVIDENCE      => final applicable gate run references
DOD-NO-MATERIAL-DEFECT  => latest Harness finding projection
DOD-APPLICABLE-QA       => latest QA verdict/evidence when required
DOD-APPLICABLE-SECURITY => latest security verdict/evidence when required
DOD-DELIVERY-WORLD      => PR/commit/branch evidence from GitHub delivery/world read
DOD-FINAL-VERIFICATION  => prerequisite-ready at conformance; satisfied only by following verify-final stage
```

- [ ] **Step 1: Document this mapping** and the distinction between conformance and final verification.
- [ ] **Step 2: Add governance rule** that new project-specific DoD rows must get stable IDs and a Spec/Plan amendment before being merge-blocking; ad-hoc model-generated rows are findings, not hidden gates.
- [ ] **Step 3: Ensure security docs say conformance is read-only** and cannot repair findings directly.
- [ ] **Step 4: Run `npm run test:skills`, `npm run test:opencode`, `git diff --check`; commit.**

```bash
git add docs/agents/harness.md AGENTS.md SECURITY.md docs/git-flow.md plurora-harness.json scripts/harness/config.test.mjs
git commit -m "docs(harness): map NeuroVia DoD evidence to conformance"
```

If `plurora-harness.json` does not need a DoD-specific field because the host reads the Plurora baseline policy directly, do not add one; in that implementation the `git add` command omits that file and its config test. This is not an implementation choice left to the model: the determining condition is whether Plan F's host interface already obtains all baseline DoD rows from `profiles/plurora` without project config.

---

### Task 6: Verify the Real NeuroVia Conformance Path

**Files:**
- Create: `docs/verification/<current-date>-neurovia-conformance-evidence.md`
- Modify: `docs/agents/harness.md` only for behavior actually proven

- [ ] **Step 1: Run keyless project gates.**

```bash
npm run test:opencode
npm run test:skills
npm run test:db:contract
npm run lint
npm run typecheck
npm test
npm run security:secrets
npm run build
```

- [ ] **Step 2: Start the exact post-Plan-F Trick host** pinned by `plurora-harness.json` and prove `/health` plus native model/effort readiness.
- [ ] **Step 3: From OpenCode, start a harmless implementation fixture with an approved fixture Spec containing two explicit acceptance IDs and an approved fixture Plan containing two `### Task N:` headings.** The fixture may change only a disposable test file; it must not be a production feature.
- [ ] **Step 4: Prove status records the exact artifact hashes and the expected Spec/Plan/DoD obligation counts without document content.**
- [ ] **Step 5: Run an adversarial fixture with one planned task intentionally unimplemented.** Conformance must report `MISSING` and the workflow must not reach `PR_READY` despite otherwise green tests.
- [ ] **Step 6: Restore/execute the missing fixture task, rerun through delivery/certification, and prove latest conformance PASS precedes verify-final PASS and `PR_READY`.
- [ ] **Step 7: Verify high-risk fallback behavior deterministically:** with Codex marked unavailable and implementation executor OpenCode, high-risk conformance cannot satisfy cross-executor-required independence and cannot reach `PR_READY`.
- [ ] **Step 8: Record evidence and perform an independent read-only review** of path containment, hash integrity, command approval semantics, readiness consumption and secret handling. Fix confirmed defects and rerun affected gates.
- [ ] **Step 9: Commit only the evidence/docs belonging to the integration branch.**

## Completion Contract

This NeuroVia overlay is complete only when `/implement` requires explicit repository-local approved Spec/Plan paths, deterministic code computes and sends their SHA-256 identities, external/symlink-escape artifacts are rejected, the post-Plan-F host revalidates the same artifacts, `pr-readiness` requires matching conformance PASS plus verify-final PASS and cannot use worker/CI self-report as a Plan completeness substitute, project DoD evidence is mapped without duplicating routing policy, and a real OpenCode fixture proves an intentionally missing Plan task prevents `PR_READY` until implemented and recertified.
