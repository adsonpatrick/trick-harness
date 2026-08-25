# Plurora Harness V2 `neuro-via` Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `adsonpatrick/neuro-via` operate the approved Plurora Harness V2 from the OpenCode TUI, retire V1-only orchestration assumptions, and make database verification cloud-only without weakening the existing project safety floor.

**Architecture:** `neuro-via` remains the product repository and versioned project-policy owner. A project-local OpenCode bridge exposes only `run`, `status`, and `cancel` against the Plan B loopback control server; it does not route models itself. Existing V1 agents/skills remain worker policy where useful, but command entrypoints default to Harness orchestration. Supabase migration files stay in `neuro-via`, while migration execution/lint/pgTAP/RLS evidence runs only against isolated hosted Preview Branches.

**Tech Stack:** Existing Next.js/Node 22 repository, OpenCode project config/agents/commands/custom tools, `@opencode-ai/plugin`, Node `fetch`, Plan B Harness control server, Supabase CLI 2.x, PostgreSQL/pgTAP, GitHub Actions, existing Plurora skills/validators/security/git-flow docs.

**Spec:** `docs/superpowers/specs/2026-08-25-plurora-engineering-harness-v2-design.md`

**Requires:** Plans R, A and B completed and independently reviewed. Record the exact known-good `adsonpatrick/trick-harness` commit before changing `neuro-via`.

> **Normative override:** Apply Plan R Task 7. `neuro-via` must select `repository=adsonpatrick/trick-harness`, `profile=plurora`, and an exact 40-hex revision; routing/fallback policy remains in `profiles/plurora`, not in the bridge.

## Global Constraints

- OpenCode TUI remains the cockpit; long implementation/debug/review/QA/delivery orchestration is Harness-owned.
- `opencode.jsonc` MUST continue to omit project/global model/provider overrides. Automatic routing exists only behind the Harness bridge.
- `git push*` remains denied in `opencode.jsonc`; general TUI agents never gain delivery authority.
- Harness delivery authority is not reproduced in a custom OpenCode bash wrapper. The bridge can request a Harness workflow, inspect it, or cancel it only.
- The bridge binds only to the local Plan B control-server API: `GET /health`, `POST /workflows`, `GET /workflows/:id`, `POST /workflows/:id/cancel`.
- Never place the Harness control token, OpenCode credentials, Codex credentials, Supabase access tokens, preview DB passwords, or GitHub tokens in repository files, model prompts, command bodies, status output, test snapshots, or durable Harness events.
- `refine`/`plan` keep explicit human approval gates. Rewiring implementation to the Harness must not turn Spec/Plan approval into an automatic transition.
- Existing worker skills remain useful inside spawned workers; do not duplicate their engineering rules in bridge code.
- Database execution/verification is cloud-only. `supabase start`, `supabase db reset --local`, `supabase test db --local`, local Docker/shadow-DB verification, and shared `neurovia-dev` fallback are not canonical paths after this plan.
- Repository migration files remain schema history. Never replace them with hosted Dashboard/SQL-editor-only changes.
- A DB-changing workflow that cannot obtain an isolated Preview Branch returns `BLOCKED`; it never mutates the parent project as fallback.
- RLS verification must cover both denied and allowed access.
- CI does not pretend to have remote DB evidence when credentials/Preview Branch capability are absent; it runs static cloud-contract guards and relies on Harness/Plan D for real hosted evidence.
- Notion/Linear/GitHub ownership remains as defined by `docs/agents/operating-model.md`; Harness status is execution evidence, not a new product backlog.

---

## File Map

### Harness integration

- Create `plurora-harness.json` — non-secret project integration metadata: Trick Harness repo, pinned revision, `profile=plurora`, local control-server URL, parent Supabase project ref, and policy schema version.
- Create `scripts/harness/config.mjs` — parse/validate `plurora-harness.json` and require an exact 40-hex pinned revision.
- Create `scripts/harness/control-client.mjs` — Node client for health/run/status/cancel; obtains optional bearer from process environment only.
- Create `scripts/harness/control-client.test.mjs` — real local HTTP fixture tests for request/response behavior and secret redaction.
- Create `.opencode/package.json` — exact dependency on `@opencode-ai/plugin` selected from installed/current OpenCode generation.
- Create `.opencode/tools/harness.ts` — `harness_run`, `harness_status`, `harness_cancel` custom tools.
- Create `.opencode/agents/harness-operator.md` — read-only cockpit coordinator with only Harness tool authority.

### OpenCode migration

- Modify `scripts/opencode/validate-control-plane.mjs` and tests.
- Modify `.opencode/commands/implement.md`, `verify.md`, `security-review.md`, `pr-ready.md`, `handoff.md`.
- Create `.opencode/commands/debug.md`, `qa.md`, `harness-status.md`, `harness-cancel.md`.
- Keep `.opencode/commands/refine.md` and `plan.md` on the human-gated planning path.
- Keep worker agents available to spawned worker contexts; they are no longer default long-workflow command owners.

### Skills

- Create `.agents/skills/debug-plurora/` and `.agents/skills/qa-plurora/` with existing project skill/eval structure.
- Modify `.agents/skills/database-change-plurora/` from local-first to cloud Preview Branch semantics.
- Modify `.agents/skills/pr-readiness/` to require Harness/PR/CI/world evidence rather than worker self-report.
- Modify provenance/evals/evidence for every materially changed skill.

### Database cloud-only migration

- Modify `package.json`.
- Modify `scripts/db/run-pgtap.mjs`.
- Create `scripts/db/lint-preview.mjs`.
- Create `scripts/db/assert-cloud-only.mjs` and `.test.mjs`.
- Create `scripts/db/verify-preview.mjs`.
- Modify database-related docs/security/CI references.

### Governance/docs

- Modify `AGENTS.md`.
- Modify `SECURITY.md`.
- Modify `docs/agents/opencode.md`.
- Create `docs/agents/harness.md`.
- Modify `docs/git-flow.md`.
- Modify `.github/workflows/ci.yml` only for keyless/static Harness/DB contract gates; do not add a fake local Supabase runtime.

---

## Task 1: Pin the Known-Good Harness Revision and Add the Control Client

**Files:**
- Create: `plurora-harness.json`
- Create: `scripts/harness/config.mjs`
- Create: `scripts/harness/config.test.mjs`
- Create: `scripts/harness/control-client.mjs`
- Create: `scripts/harness/control-client.test.mjs`

**Interfaces:**

```js
loadHarnessConfig(rootDir) -> {
  repository: string,
  revision: string,
  controlServerUrl: string,
  profile: string,
  policyVersion: string,
  supabaseParentProjectRef: string
}

health(options) -> Promise<object>
startWorkflow(input, options) -> Promise<{ workflowId: string }>
getWorkflow(workflowId, options) -> Promise<object>
cancelWorkflow(workflowId, reason, options) -> Promise<object>
```

`options` accepts `baseUrl`, `token`, and `signal`; token defaults from `PLURORA_HARNESS_TOKEN` and is never returned or logged.

- [ ] **Step 1: Capture the Plan B revision before writing config**

```bash
git -C ../trick-harness status --short
git -C ../trick-harness rev-parse HEAD
git -C ../trick-harness remote -v
```

Expected: clean tree, `origin` is `adsonpatrick/trick-harness`, upstream ancestry remains reachable. Copy the exact returned 40-character SHA into `plurora-harness.json`; do not use `master`, a tag range, or a floating branch.

- [ ] **Step 2: Write RED config tests**

Require repository `adsonpatrick/trick-harness`, `profile='plurora'`, exact revision, loopback URL, and reject keys matching `token|secret|password|apiKey`.

- [ ] **Step 3: Verify RED**

```bash
node --test scripts/harness/config.test.mjs
```

- [ ] **Step 4: Implement config parsing and committed config**

Use:

```json
{
  "repository": "adsonpatrick/trick-harness",
  "revision": "<exact-40-hex-sha>",
  "profile": "plurora",
  "controlServerUrl": "http://127.0.0.1:47831",
  "supabaseParentProjectRef": "uljaajwwnygopsyvwsre"
}
```

- [ ] **Step 5: Write RED control-client tests with a real loopback fixture server** covering health, workflow POST, status/cancel encoding, bounded safe errors, bearer redaction, and abort propagation.
- [ ] **Step 6: Implement the minimal client** with Node built-ins/global `fetch`.
- [ ] **Step 7: Verify GREEN and commit.**

---

## Task 2: Add OpenCode Harness Tools Without Giving the TUI Delivery Authority

**Files:**
- Create: `.opencode/package.json`
- Create: `.opencode/tools/harness.ts`
- Create: `.opencode/agents/harness-operator.md`
- Modify: `opencode.jsonc`
- Modify: `scripts/opencode/validate-control-plane.mjs`
- Modify: `scripts/opencode/validate-control-plane.test.mjs`

**OpenCode tool surface:**

```text
harness_run
  objective: string
  entryRole: refine | plan | implement | debug | verify | review | security | qa
  specPath?: string
  planPath?: string
  risk?: low | medium | high | critical

harness_status
  workflowId: string

harness_cancel
  workflowId: string
  reason: string
```

Every tool derives `cwd` from `context.worktree`/`context.directory`; the model cannot submit an arbitrary external directory.

- [ ] Verify installed OpenCode generation/plugin helper and pin exact compatible `@opencode-ai/plugin`.
- [ ] Write RED validator tests requiring read-only operator, exactly the Harness tools, no model/default_model/provider catalog, `git push*` denial, and no custom git/push/merge/release/deploy tool.
- [ ] Implement `.opencode/tools/harness.ts` returning only bounded Harness responses.
- [ ] Add read-only `harness-operator` with edits/bash denied.
- [ ] Preserve existing env/destructive/bash rules while adding custom-tool permissions.
- [ ] Run `npm run test:opencode` and commit.

---

## Task 3: Rewire Commands to the Harness and Add Debug/QA Entry Points

**Files:**
- Modify: `.opencode/commands/implement.md`
- Modify: `.opencode/commands/verify.md`
- Modify: `.opencode/commands/security-review.md`
- Modify: `.opencode/commands/pr-ready.md`
- Modify: `.opencode/commands/handoff.md`
- Create: `.opencode/commands/debug.md`
- Create: `.opencode/commands/qa.md`
- Create: `.opencode/commands/harness-status.md`
- Create: `.opencode/commands/harness-cancel.md`
- Modify validator + tests

**Command contract:** `/refine` and `/plan` remain explicit human-gated Superpowers authoring paths; `/implement`, `/debug`, `/qa`, `/verify`, `/security-review`, `/pr-ready` go through Harness; `/handoff` syncs project state after terminal evidence and cannot merge/deploy.

- [ ] Update table-driven validator RED tests for new binding matrix.
- [ ] Rewrite command bodies to instruct `harness-operator` to call exactly one named Harness tool with `$ARGUMENTS`; forbid direct implementation in command body.
- [ ] Preserve explicit approved Spec/Plan gate before `/implement`.
- [ ] Run `npm run test:opencode` and commit.

---

## Task 4: Add First-Class Debugging and QA Worker Skills

**Files:**
- Create: `.agents/skills/debug-plurora/SKILL.md`
- Create: `.agents/skills/debug-plurora/references/provenance.md`
- Create: `.agents/skills/debug-plurora/evals/evals.json`
- Create: `.agents/skills/debug-plurora/evals/evidence.md`
- Create analogous files for `.agents/skills/qa-plurora/`
- Modify validator only if discovery is not generic.

**`debug-plurora` contract:** read-only diagnosis; reproduce; evidence; ruled-out hypotheses; root-cause hypothesis/confidence; regression seam; minimal repair surface; unknowns; security relevance; product-decision dependency; return `DiagnosisContract` or `BLOCKED`.

**`qa-plurora` contract:** independent impact/risk analysis; charter; existing coverage; targeted positive/negative/boundary/state checks; applicable E2E/visual/accessibility; findings classified into V2 taxonomy; QA may fail PR readiness.

- [ ] Follow existing skill authoring/eval discipline: pressure baseline → minimal skill → green behavior → adversarial eval → refactor.
- [ ] Add debug adversarial patch-before-reproduce case.
- [ ] Add product-decision blocker case.
- [ ] Add QA happy-only, negative-regression and UI visual/accessibility cases.
- [ ] Run `npm run test:skills` and commit.

---

## Task 5: Replace Local Supabase Scripts With Explicit Preview-Database Gates

**Files:**
- Modify: `package.json`
- Modify: `scripts/db/run-pgtap.mjs`
- Create: `scripts/db/lint-preview.mjs`
- Create: `scripts/db/verify-preview.mjs`
- Create: `scripts/db/assert-cloud-only.mjs`
- Create: `scripts/db/assert-cloud-only.test.mjs`

**Canonical scripts after migration:**

```json
{
  "db:lint": "node scripts/db/lint-preview.mjs",
  "test:db": "node scripts/db/run-pgtap.mjs",
  "db:verify": "node scripts/db/verify-preview.mjs",
  "test:db:contract": "node --test scripts/db/assert-cloud-only.test.mjs && node scripts/db/assert-cloud-only.mjs"
}
```

Delete canonical `db:start`, `db:reset`, local `db:lint`, local `test:db`, and redundant `test:db:remote` entries.

**Required runtime environment:**

```text
SUPABASE_PREVIEW_DB_URL
SUPABASE_PREVIEW_PROJECT_REF
SUPABASE_PARENT_PROJECT_REF=uljaajwwnygopsyvwsre
```

- [ ] Write RED static contract tests that reject executable local Supabase/Docker forms.
- [ ] Rewrite `run-pgtap.mjs` to require preview URL/ref and fail when preview==parent; never print connection string.
- [ ] Add remote lint wrapper using argument arrays; verify actual CLI supports selected remote flags.
- [ ] Add `verify-preview.mjs` to validate identity then run lint+pgTAP sequentially.
- [ ] Update package scripts and run `npm run test:db:contract`.
- [ ] Commit.

---

## Task 6: Rewrite the Database Skill Around Preview Branch Evidence

**Files:** `.agents/skills/database-change-plurora/*`

**Required states:** migration authored → Preview Branch provisioned → migration applied → remote lint → pgTAP/RLS allow+deny → applicable integration checks → cleanup → parent unchanged.

- [ ] Add eval pressure asking to use local Docker when preview creation fails; GREEN must `BLOCKED`.
- [ ] Add eval asking to apply to shared `neurovia-dev`; GREEN refuses for unmerged feature change.
- [ ] Rewrite skill so migration authorship stays in repo and execution authority belongs to Harness Preview Branch workflow.
- [ ] Require RLS denial and allowed assertions.
- [ ] Run `npm run test:skills` and `npm run test:db:contract` separately and commit.

---

## Task 7: Update PR Readiness and Worker Contracts for Harness Evidence

**Files:** `pr-readiness` plus worker skills only where V2 semantics changed.

**PR readiness consumes:** current branch/diff, Harness terminal projection, route/fallback/assurance facts, independent verifier, QA/security verdicts, confirmed findings, GitHub PR/CI state, Preview Branch evidence when applicable.

- [ ] Add eval where worker says done but Harness verdict is missing/inconclusive; no PASS.
- [ ] Add eval with confirmed bug plus green CI; readiness fails/blocks.
- [ ] Add eval with non-bug improvement only; readiness may pass while reporting suggestion.
- [ ] Do not duplicate router/fallback rules into every worker skill.
- [ ] Run `npm run test:skills` and commit.

---

## Task 8: Align CI With Harness/Cloud-DB Contract Without Fake Remote Gate

**Files:** `.github/workflows/ci.yml`, optional `e2e-full.yml`, `package.json`.

- [ ] Add `npm run test:db:contract` to cheap validate lane.
- [ ] Do not add local Supabase, Docker service containers, or local Postgres.
- [ ] Keep smoke/full E2E split; Harness QA may request full suite based on risk.
- [ ] Add assertion committed workflows contain no local Supabase execution commands.
- [ ] Run `npm run test:db:contract`, `npm test`, `npm run lint`, `npm run typecheck` and commit.

---

## Task 9: Update Security, Git Flow, OpenCode, and Agent Governance

**Files:** `SECURITY.md`, `docs/git-flow.md`, `docs/agents/opencode.md`, `docs/agents/harness.md`, `AGENTS.md`.

- [ ] Document TUI push denial and Harness-scoped normal feature-branch push/PR authority; no force/main/merge/release/deploy.
- [ ] Document loopback/token boundary, runtime-only Preview DB credentials, cloud-only DB verification, read-only security reviewer and separate repair worker.
- [ ] Update Git Flow: Harness may create PR automatically; human merges; no `SKIP_HOOKS=1` bypass.
- [ ] Rewrite OpenCode docs: routing is external in Trick Harness, not project config; document tools/commands and global-config non-mutation.
- [ ] Create Harness operator docs: exact pinned revision, `/health`, lifecycle, `BLOCKED`, Codex degraded, Preview requirements; never secrets.
- [ ] Update AGENTS routing.
- [ ] Run `npm run test:opencode`, `npm run test:skills`, `npm run test:db:contract`, `git diff --check` and commit.

---

## Task 10: Verify the Assembled `neuro-via` Integration Boundary

- [ ] Run keyless gates: `test:opencode`, `test:skills`, `test:db:contract`, tests, lint, typecheck, design-system tests, build.
- [ ] Prove `npm run db:verify` fails closed without preview context and starts no Docker/local stack.
- [ ] Start verified Trick Harness revision and run bridge health/status fixture.
- [ ] Start OpenCode in worktree, confirm custom tools and unchanged global model/provider configuration.
- [ ] Independently verify no TUI push authority, no model config mutation, no local DB canonical path, planning approval gates preserved, no committed secrets, and `profile=plurora` is forwarded without policy duplication.
- [ ] Focused security review of HTTP client/tool, token handling, worktree derivation, loopback validation, preview DB env handling, subprocess construction and docs claims.
- [ ] Fix confirmed bugs only and rerun affected gates.

## Plan C Completion Evidence

Plan C is complete when `neuro-via` pins an exact Trick Harness revision and selects `profile=plurora`, OpenCode addresses the Harness through bounded project-local tools, implementation/debug/QA/review commands default to Harness orchestration, TUI `git push` remains denied, V1 local-Docker Supabase semantics are retired, cloud Preview DB scripts fail closed without isolated context, governance/docs are consistent, R5 is proven, and keyless repository gates pass. Real provider, PR, Supabase Preview, replay/quiescence and final acceptance evidence remain Plan D.