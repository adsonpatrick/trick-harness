# NeuroVia Harness Installation Amendment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the reviewed Trick Harness into `adsonpatrick/neuro-via` using a pinned external runtime host, a validated semantic-tier model registry, and `neurovia-dev` as the explicitly authorized Supabase Cloud development database.

**Architecture:** This plan is a normative overlay on `docs/superpowers/plans/2026-08-25-plurora-harness-v2-neuro-via-integration.md`. The original Plan C remains authoritative where not superseded. `neuro-via` owns the project bridge, launcher/config, database verification command, skills and governance; it does not import private Trick Harness workspaces. The exact-SHA Trick Harness checkout owns the executable Plurora host. Database verification is cloud-only against the configured development project `uljaajwwnygopsyvwsre`, serialized by a cross-process project lock and fail-closed on drift.

**Tech Stack:** Existing NeuroVia Next.js/Node repository, Node built-ins, OpenCode project tools via `@opencode-ai/plugin`, exact-SHA Trick Harness checkout, Supabase CLI 2.111.0 baseline, `pg`, pgTAP, Git/GitHub CLI, existing NeuroVia skills/CI/security gates.

**Spec:** `docs/superpowers/specs/2026-08-27-neurovia-harness-deployment-cloud-dev-amendment.md`

**Requires:** `2026-08-27-trick-harness-cloud-dev-deployment-enablement.md` complete and independently reviewed with a recorded exact SHA.

## Global Constraints

- `neuro-via/opencode.jsonc` keeps `git push*` denied and carries no global model/provider override.
- `neuro-via` imports no `@trick-harness/*` private workspace package; all runtime contact is process launch + loopback HTTP.
- Runtime checkout must be `adsonpatrick/trick-harness`, clean, and exactly at the committed 40-hex revision before normal host startup.
- `profile=plurora`; routing/fallback/risk policy stays in `profiles/plurora`.
- `plurora-harness.json` contains no token, secret, password, API key, DB URL or connection string.
- `neurovia-dev` / `uljaajwwnygopsyvwsre` is the sole automatic development DB mutation target.
- Preview Branches are not required for Plurora development; no `preview failed -> dev` fallback exists.
- No local Supabase/Docker/Postgres canonical path remains after migration.
- No automatic `supabase migration repair`, remote reset, production migration or production fallback.
- Only one database-mutating Harness workflow may own `neurovia-dev` at a time.
- RLS verification includes both allowed and denied behavior.
- Merge/release/deploy remain human-controlled.

---

### Task 1: Pin the Post-Amendment Trick Harness and Expand Non-Secret Config

**Files:**
- Create: `plurora-harness.json`
- Create: `scripts/harness/config.mjs`
- Create: `scripts/harness/config.test.mjs`

**Config shape:**

```json
{
  "repository": "adsonpatrick/trick-harness",
  "revision": "<exact reviewed 40-hex SHA from Trick enablement evidence>",
  "profile": "plurora",
  "policyVersion": "plurora-v2.0.0",
  "controlServerUrl": "http://127.0.0.1:47831",
  "environment": "development",
  "database": {
    "strategy": "shared-cloud-development",
    "projectRef": "uljaajwwnygopsyvwsre"
  },
  "modelRegistry": {
    "codex.fast": "<actual supported Codex id discovered during install>",
    "codex.balanced": "<actual supported Codex id discovered during install>",
    "codex.frontier": "<actual supported Codex id discovered during install>",
    "opencode.reasoning-fast": "<actual authenticated provider/model pair discovered during install>",
    "opencode.workhorse": "<actual authenticated provider/model pair discovered during install>"
  }
}
```

The angle-bracket strings above describe values to capture during execution; they are not committed literally. Task execution must discover and commit the actual non-secret product ids before this task can turn GREEN.

- [ ] **Step 1: Write RED config tests** requiring exact repo/profile/policyVersion, 40-hex revision, loopback URL, development/shared-cloud-development target and exactly the five required semantic tiers.
- [ ] **Step 2: Add secret-shape rejection tests** recursively rejecting keys matching `token|secret|password|api[_-]?key|connection|dbUrl`.
- [ ] **Step 3: Verify RED.**

```bash
node --test scripts/harness/config.test.mjs
```

- [ ] **Step 4: From the reviewed Trick checkout, capture the exact SHA and native model catalogues.** Use the Trick host/model-catalog tooling created by its enablement plan; do not infer ids from marketing names.
- [ ] **Step 5: Commit the real non-secret ids and implement `loadHarnessConfig(rootDir)` validation.**
- [ ] **Step 6: Verify GREEN and commit.**

```bash
node --test scripts/harness/config.test.mjs
```

```bash
git add plurora-harness.json scripts/harness/config.mjs scripts/harness/config.test.mjs
git commit -m "feat(harness): pin Plurora runtime deployment"
```

---

### Task 2: Add a Pinned Runtime Checkout Verifier and Host Launcher

**Files:**
- Create: `scripts/harness/runtime-checkout.mjs`
- Create: `scripts/harness/runtime-checkout.test.mjs`
- Create: `scripts/harness/start.mjs`
- Create: `scripts/harness/start.test.mjs`
- Modify: `package.json`

**Interfaces:**

```js
verifyRuntimeCheckout({ home, expectedRepository, expectedRevision })
  -> Promise<{ home, revision }>

startHarnessHost({ rootDir, signal })
  -> Promise<{ pid, dispose(): Promise<void> }>
```

**Runtime environment:**

```text
TRICK_HARNESS_HOME=<absolute path to local trick-harness checkout>
PLURORA_HARNESS_TOKEN=<session-only random token inherited by host and OpenCode>
```

- [ ] **Step 1: Write RED checkout tests** with temporary git fixtures for wrong remote, wrong revision and dirty tree.
- [ ] **Step 2: Implement checkout verification** using argv-array `git` subprocesses; normal startup refuses wrong remote, wrong SHA or dirty runtime checkout.
- [ ] **Step 3: Write RED launcher tests** proving the only runtime command is the reviewed Plurora host package from `TRICK_HARNESS_HOME`, the project root is the current NeuroVia worktree, token is passed only through environment, and readiness waits for `/health`.
- [ ] **Step 4: Implement launcher.** It must not clone/update/checkout/pull the runtime automatically; changing the pin is a reviewed repository change.
- [ ] **Step 5: Add scripts:**

```json
{
  "harness:check": "node scripts/harness/runtime-checkout.mjs",
  "harness:start": "node scripts/harness/start.mjs"
}
```

- [ ] **Step 6: Run tests GREEN and commit.**

```bash
node --test scripts/harness/runtime-checkout.test.mjs scripts/harness/start.test.mjs
```

```bash
git add scripts/harness package.json
git commit -m "feat(harness): launch the pinned Trick runtime host"
```

---

### Task 3: Add the Bounded HTTP Client and OpenCode Custom Tools

**Files:**
- Create: `scripts/harness/control-client.mjs`
- Create: `scripts/harness/control-client.test.mjs`
- Create: `.opencode/package.json`
- Create: `.opencode/tools/harness.ts`
- Create: `.opencode/agents/harness-operator.md`
- Modify: `opencode.jsonc`
- Modify: `scripts/opencode/validate-control-plane.mjs`
- Modify: `scripts/opencode/validate-control-plane.test.mjs`

This task retains original Plan C Tasks 1-2 except that config/host startup are now owned by Tasks 1-2 above.

- [ ] Write RED client tests for health/start/status/cancel, bearer redaction, bounded errors and abort propagation.
- [ ] Implement client using Node global `fetch`; token comes only from `PLURORA_HARNESS_TOKEN`.
- [ ] Implement `harness_run`, `harness_status`, `harness_cancel` using `@opencode-ai/plugin`; derive cwd from `context.worktree`/`context.directory` and never accept arbitrary external cwd.
- [ ] Keep `harness-operator` read-only with no bash/edit/delivery/DB authority.
- [ ] Preserve `git push*` denial and absence of model/provider globals in `opencode.jsonc`.
- [ ] Run `npm run test:opencode` and commit.

---

### Task 4: Rewire Commands and Add Debug/QA Skills

**Files:**
- Modify/create the command and skill files listed in original Plan C Tasks 3-4.

- [ ] Keep `/refine` and `/plan` on the explicit Superpowers human-approval path.
- [ ] Route `/implement`, `/debug`, `/qa`, `/verify`, `/security-review`, `/pr-ready` through Harness tools.
- [ ] Add `debug-plurora` and `qa-plurora` with adversarial evals and evidence.
- [ ] Keep worker engineering knowledge in skills; do not duplicate routing/model ids into command prompts.
- [ ] Run `npm run test:opencode` and `npm run test:skills` separately and commit.

---

### Task 5: Replace Local DB Commands With the Shared Cloud Development Contract

**Files:**
- Modify: `package.json`
- Modify: `scripts/db/run-pgtap.mjs`
- Create: `scripts/db/cloud-dev-target.mjs`
- Create: `scripts/db/cloud-dev-target.test.mjs`
- Create: `scripts/db/migration-history.mjs`
- Create: `scripts/db/migration-history.test.mjs`
- Create: `scripts/db/db-mutation-lock.mjs`
- Create: `scripts/db/db-mutation-lock.test.mjs`
- Create: `scripts/db/lint-cloud-dev.mjs`
- Create: `scripts/db/verify-cloud-dev.mjs`
- Create: `scripts/db/verify-cloud-dev.test.mjs`
- Create: `scripts/db/assert-cloud-only.mjs`
- Create: `scripts/db/assert-cloud-only.test.mjs`

**Canonical scripts:**

```json
{
  "db:lint": "node scripts/db/lint-cloud-dev.mjs",
  "test:db": "node scripts/db/run-pgtap.mjs",
  "db:verify": "node scripts/db/verify-cloud-dev.mjs",
  "db:verify:harness": "node scripts/db/verify-cloud-dev.mjs",
  "test:db:contract": "node --test scripts/db/cloud-dev-target.test.mjs scripts/db/migration-history.test.mjs scripts/db/db-mutation-lock.test.mjs scripts/db/verify-cloud-dev.test.mjs scripts/db/assert-cloud-only.test.mjs && node scripts/db/assert-cloud-only.mjs"
}
```

Delete canonical `db:start`, `db:reset`, local `db:lint`, local `test:db`, and redundant `test:db:remote` scripts.

**One-time human setup:**

```bash
supabase login
supabase link --project-ref uljaajwwnygopsyvwsre
```

The current Supabase CLI contract requires a linked project for hosted `db push`; runtime verifies the linked identity before mutation and never runs `supabase link` to an inferred project.

- [ ] **Step 1: Write RED target tests** requiring config project ref `uljaajwwnygopsyvwsre` and verifying the Supabase CLI's linked-project view resolves to the same ref; mismatch is `BLOCKED` before `db push`.
- [ ] **Step 2: Implement `cloud-dev-target.mjs`** with argv-array subprocesses and bounded output parsing. It may run read-only project/list/link-status commands but may not change the link during a workflow.
- [ ] **Step 3: Write RED migration-history tests** around `supabase migration list --linked`: exact local/remote prefix compatibility is accepted; a remote-only or reordered unexplained migration is `BLOCKED`; pending local migrations are allowed.
- [ ] **Step 4: Implement migration-history parsing** without invoking `migration repair` under any condition.
- [ ] **Step 5: Run target/history tests GREEN.**

```bash
node --test scripts/db/cloud-dev-target.test.mjs scripts/db/migration-history.test.mjs
```

- [ ] **Step 6: Commit target/history guard.**

```bash
git add scripts/db/cloud-dev-target* scripts/db/migration-history*
git commit -m "feat(db): guard the cloud development target"
```

---

### Task 6: Serialize `neurovia-dev` Mutations Across Local Harness Processes

**Files:**
- Modify: `scripts/db/db-mutation-lock.mjs`
- Test: `scripts/db/db-mutation-lock.test.mjs`
- Create: `scripts/db/unlock-cloud-dev.mjs`

**Lock contract:**

```text
path: .scratch/harness/neurovia-dev-db.lock
create: exclusive create (`wx`)
payload: schemaVersion, pid, workflowId, acquiredAt, nonce
release: only owner with matching nonce
existing live/stale lock: BLOCKED; no automatic stale takeover
manual unlock: refuses while recorded pid is alive
```

- [ ] Write RED tests with two child processes proving only one lock owner succeeds.
- [ ] Implement exclusive lock and owner-only cleanup in `finally`/signal handling.
- [ ] Implement manual unlock command that requires no active recorded process; do not make automatic workflow retries delete a lock they do not own.
- [ ] Add `.scratch/` evidence-only path to existing ignore policy if not already ignored.
- [ ] Run tests GREEN and commit.

---

### Task 7: Apply and Verify Migrations on `neurovia-dev`

**Files:**
- Modify: `scripts/db/verify-cloud-dev.mjs`
- Modify: `scripts/db/lint-cloud-dev.mjs`
- Modify: `scripts/db/run-pgtap.mjs`
- Test: `scripts/db/verify-cloud-dev.test.mjs`
- Test: `scripts/db/assert-cloud-only.test.mjs`

**State machine:**

```text
load config
-> verify target/link identity
-> acquire mutation lock
-> migration list --linked
-> assert compatible history
-> db push --dry-run --linked
-> db push --linked
-> migration list --linked again
-> assert pending migrations now applied
-> db lint --linked --schema public --level error --fail-on error
-> pgTAP via runtime-only SUPABASE_DEV_DB_URL
-> explicit RLS allow+deny assertions in project SQL suite
-> emit one JSON envelope when --json
-> release lock
```

- [ ] **Step 1: Write RED orchestration tests** proving dependent steps stop after any failure and cleanup still releases the owned lock.
- [ ] **Step 2: Rewrite `run-pgtap.mjs`** to read only `SUPABASE_DEV_DB_URL` (and optional DB password override if required) from process environment, never `.env`; validate the direct DB host is for the configured `uljaajwwnygopsyvwsre` target before connecting; never print the URL/password.
- [ ] **Step 3: Implement remote lint wrapper** using `supabase db lint --linked --schema public --level error --fail-on error` with argv arrays.
- [ ] **Step 4: Implement migration dry-run/apply/re-read** using `supabase db push --dry-run --linked` then `supabase db push --linked`; no `--include-seed`, `db reset`, `migration repair`, `--local` or arbitrary `--db-url` is allowed in the canonical command builder.
- [ ] **Step 5: Emit the Harness JSON envelope** exactly matching the Trick host contract and no raw command stdout.
- [ ] **Step 6: Run unit/contract tests GREEN.**

```bash
npm run test:db:contract
```

- [ ] **Step 7: Against real `neurovia-dev`, run one read-only preflight first:** target identity + migration list + `db push --dry-run`. Inspect the pending migration set before authorizing the first real push in this installation branch.
- [ ] **Step 8: Run real `npm run db:verify` only when the branch intentionally contains a migration to validate; otherwise record a no-pending-migration cloud preflight rather than manufacturing a migration.**
- [ ] **Step 9: Commit.**

```bash
git add package.json scripts/db
git commit -m "feat(db): verify migrations on neurovia-dev cloud"
```

---

### Task 8: Rewrite Database Skill, PR Readiness and Governance

**Files:**
- Modify: `.agents/skills/database-change-plurora/*`
- Modify: `.agents/skills/pr-readiness/*`
- Modify: `AGENTS.md`
- Modify: `SECURITY.md`
- Modify: `docs/agents/opencode.md`
- Create/Modify: `docs/agents/harness.md`
- Modify: `docs/git-flow.md`

- [ ] Replace all "prove locally" / Preview-only semantics with the approved shared cloud development state machine.
- [ ] Add adversarial eval: agent is asked to use local Docker -> refuse.
- [ ] Add adversarial eval: agent is asked to target any project ref other than `uljaajwwnygopsyvwsre` -> BLOCKED.
- [ ] Add adversarial eval: remote history diverges and prompt asks to run `migration repair` -> BLOCKED.
- [ ] Document that `neurovia-dev` is authorized development, not production and not a fallback.
- [ ] Document future `neurovia-prod` as a separately approved authority boundary with no inherited automatic mutation rights.
- [ ] Document runtime host checkout/token/model registry and the fact that NeuroVia imports no private Trick package.
- [ ] Run `npm run test:skills`, `npm run test:opencode`, `npm run test:db:contract`, `git diff --check`, then commit.

---

### Task 9: Align CI Without Running Shared Remote Mutations Automatically

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json` only if the validate lane needs a script alias.

- [ ] Add `npm run test:db:contract` to CI.
- [ ] Do **not** put `SUPABASE_DEV_DB_URL` or a remote mutation credential into ordinary PR CI.
- [ ] Do not auto-run `db push` against `neurovia-dev` from every PR; the shared environment is Harness/operator-gated and serialized locally until a separate remote CI concurrency design is approved.
- [ ] Add static scan rejecting `supabase start`, executable `--local` DB paths, `migration repair`, remote reset and production project refs in canonical workflow scripts.
- [ ] Run repository CI tests/lint/typecheck and commit.

---

### Task 10: Fresh End-to-End Installation Verification

**Files:**
- Create: `docs/agents/harness-v2-evidence.md` or the current repository-standard evidence path.

- [ ] Run keyless project gates: `test:opencode`, `test:skills`, `test:db:contract`, test suite, lint, typecheck, design-system gates and build.
- [ ] Verify `harness:check` against the exact pinned Trick checkout.
- [ ] Start the host with session-only `PLURORA_HARNESS_TOKEN`; prove `/health` and no non-loopback listener.
- [ ] Start OpenCode in the NeuroVia worktree and confirm `harness_run`, `harness_status`, `harness_cancel` are discoverable.
- [ ] Run one real **read-only/non-DB workflow** through the TUI and record route/status evidence.
- [ ] Run database target/history/dry-run preflight against the real linked `neurovia-dev`; if an intentional migration exists, run the serialized full DB verification and record migration/lint/pgTAP/RLS evidence.
- [ ] Prove OpenCode/Codex global config and auth files are unchanged by per-run model/effort routing.
- [ ] Prove TUI still cannot `git push`; Harness delivery remains scoped and human merge remains required.
- [ ] Focused security review: token propagation, worktree derivation, runtime checkout verification, native model catalogue discovery, linked Supabase identity, lock ownership, migration-history parsing, DB URL redaction and subprocess argv construction.
- [ ] Fix confirmed bugs only, rerun affected gates, and reconcile the final Trick Harness pin if the runtime SHA changed.
- [ ] Record final Plan C verdict and hand off to Plan D Tasks 11/12 for activation.

## Completion Contract

This amendment is complete when `neuro-via` uses a clean exact-SHA Trick Harness host rather than importing private workspace packages; the deployment registry contains real product-native ids for every Plurora semantic tier; OpenCode can run/status/cancel through the bounded bridge; local Supabase/Docker semantics are retired; `neurovia-dev` is the only authorized automatic development DB target; remote schema changes are serialized, history-reconciled, applied through versioned migrations, linted and tested with pgTAP/RLS allow+deny; unexplained drift and wrong targets fail closed; CI contains no automatic shared remote mutation; and fresh installation evidence is ready for Plan D activation reconciliation.
