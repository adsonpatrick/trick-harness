# NeuroVia Harness Installation Amendment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the reviewed Trick Harness into `adsonpatrick/neuro-via` through a pinned external runtime host, a validated semantic-tier model registry, and `neurovia-dev` as the explicitly authorized Supabase Cloud development database.

**Architecture:** This is the normative overlay on historical Plan C. `neuro-via` owns non-secret deployment config, checkout verification/launcher, OpenCode bridge, the deterministic cloud-development DB command, skills and governance. It imports no private Trick Harness workspace. The exact-SHA Trick checkout owns the runnable Plurora host. DB changes are serialized across local Harness processes and fail closed on wrong target or migration drift.

**Tech Stack:** NeuroVia Node/Next.js repository, Node built-ins, `@opencode-ai/plugin`, exact-SHA Trick Harness checkout, Supabase CLI `2.111.0` baseline, `pg`, pgTAP, Git/GitHub CLI, existing NeuroVia skills/CI/security gates.

**Spec:** `docs/superpowers/specs/2026-08-27-neurovia-harness-deployment-cloud-dev-amendment.md`

**Requires:** `2026-08-27-trick-harness-cloud-dev-deployment-enablement.md` complete, independently reviewed, and carrying a recorded exact SHA plus native product model catalogues.

## Global Constraints

- `opencode.jsonc` keeps `git push*` denied and no project/global model/provider override.
- NeuroVia imports no `@trick-harness/*` private workspace package.
- Runtime checkout remote must be `adsonpatrick/trick-harness`, clean, and exactly at the committed 40-hex revision.
- `profile=plurora`; routing/fallback/risk policy remains in `profiles/plurora`.
- `plurora-harness.json` is non-secret and recursively rejects credential-shaped keys.
- `neurovia-dev` / `uljaajwwnygopsyvwsre` is the sole automatic development DB mutation target.
- Preview Branches are not required and are never attempted as a hidden precursor/fallback in this deployment.
- No local Supabase/Docker/Postgres canonical path remains.
- No automatic `supabase migration repair`, remote reset, production migration or production fallback.
- One DB-mutating Harness workflow at a time may own `neurovia-dev`.
- RLS verification includes allowed and denied behavior.
- Merge/release/deploy remain human-controlled.

---

### Task 1: Pin Runtime and Commit Real Non-Secret Deployment Metadata

**Files:**
- Create: `plurora-harness.json`
- Create: `scripts/harness/config.mjs`
- Create: `scripts/harness/config.test.mjs`

**Committed config contract:**

```ts
interface PluroraHarnessConfig {
  repository: 'adsonpatrick/trick-harness'
  revision: string // exact 40-hex SHA recorded by Trick enablement evidence
  profile: 'plurora'
  policyVersion: 'plurora-v2.0.0'
  controlServerUrl: 'http://127.0.0.1:47831'
  environment: 'development'
  database: {
    strategy: 'shared-cloud-development'
    projectRef: 'uljaajwwnygopsyvwsre'
  }
  modelRegistry: {
    'codex.fast': string
    'codex.balanced': string
    'codex.frontier': string
    'opencode.reasoning-fast': string
    'opencode.workhorse': string
  }
}
```

- [ ] Write RED tests for exact repo/profile/policy, exact 40-hex revision, loopback URL, development/shared-cloud target and exactly the five model-registry keys.
- [ ] Add recursive key rejection for `token|secret|password|api[_-]?key|connection|dbUrl`.
- [ ] Run RED:

```bash
node --test scripts/harness/config.test.mjs
```

- [ ] Read the reviewed Trick enablement evidence and copy its exact final SHA.
- [ ] Run the reviewed Trick host catalogue command and capture the exact OpenCode `provider/model` ids and Codex ids for all five semantic tiers. The values are non-secret product identifiers; commit the ids actually returned, not marketing-name guesses.
- [ ] Implement `loadHarnessConfig(rootDir)` and write the config with those exact captured values.
- [ ] Run GREEN and commit:

```bash
node --test scripts/harness/config.test.mjs
git add plurora-harness.json scripts/harness/config.mjs scripts/harness/config.test.mjs
git commit -m "feat(harness): pin Plurora runtime deployment"
```

---

### Task 2: Verify and Launch the Exact Trick Checkout

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

**Environment:**

```text
TRICK_HARNESS_HOME=<absolute checkout path>
PLURORA_HARNESS_TOKEN=<session-only random token shared by launcher and OpenCode process>
```

- [ ] Write RED git-fixture tests for wrong remote, wrong revision and dirty runtime checkout.
- [ ] Implement checkout verification with argv-array git subprocesses. No automatic clone/pull/fetch/checkout occurs in normal startup.
- [ ] Write RED launcher tests proving it invokes only `@trick-harness/plurora-host` from `TRICK_HARNESS_HOME`, passes NeuroVia's current worktree root, forwards token only through environment, and waits for `/health`.
- [ ] Implement launcher and add:

```json
{
  "harness:check": "node scripts/harness/runtime-checkout.mjs",
  "harness:start": "node scripts/harness/start.mjs"
}
```

- [ ] Run GREEN and commit:

```bash
node --test scripts/harness/runtime-checkout.test.mjs scripts/harness/start.test.mjs
git add scripts/harness package.json
git commit -m "feat(harness): launch the pinned Trick runtime host"
```

---

### Task 3: Add the Bounded Control Client and OpenCode Tools

**Files:**
- Create: `scripts/harness/control-client.mjs`
- Create: `scripts/harness/control-client.test.mjs`
- Create: `.opencode/package.json`
- Create: `.opencode/tools/harness.ts`
- Create: `.opencode/agents/harness-operator.md`
- Modify: `opencode.jsonc`
- Modify: `scripts/opencode/validate-control-plane.mjs`
- Modify: `scripts/opencode/validate-control-plane.test.mjs`

- [ ] Write RED HTTP tests for health/start/status/cancel, bearer redaction, bounded errors and abort propagation.
- [ ] Implement the client with global `fetch`; token comes only from `PLURORA_HARNESS_TOKEN`.
- [ ] Implement `harness_run`, `harness_status`, `harness_cancel` using `@opencode-ai/plugin`; derive cwd from `context.worktree`/`context.directory` and accept no arbitrary external cwd.
- [ ] Add read-only `harness-operator`; no bash/edit/delivery/DB tool authority.
- [ ] Preserve `git push*` denial and absence of global model/provider config.
- [ ] Run `npm run test:opencode` and commit.

---

### Task 4: Rewire Commands and Add Debug/QA Skills

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
- Create: `.agents/skills/debug-plurora/SKILL.md`
- Create: `.agents/skills/debug-plurora/references/provenance.md`
- Create: `.agents/skills/debug-plurora/evals/evals.json`
- Create: `.agents/skills/debug-plurora/evals/evidence.md`
- Create equivalent four files under `.agents/skills/qa-plurora/`

- [ ] Keep `/refine` and `/plan` on explicit Superpowers human approval.
- [ ] Route implement/debug/qa/verify/security-review/pr-ready through Harness tools.
- [ ] Add debugging evals for patch-before-reproduce and product-decision blocking.
- [ ] Add QA evals for happy-only coverage, negative regression and UI visual/accessibility checks.
- [ ] Keep model ids/routing rules out of commands and skills.
- [ ] Run `npm run test:opencode` and `npm run test:skills`; commit.

---

### Task 5: Establish the Explicit Shared Cloud Target and Migration-History Guard

**Files:**
- Modify: `package.json`
- Create: `scripts/db/cloud-dev-target.mjs`
- Create: `scripts/db/cloud-dev-target.test.mjs`
- Create: `scripts/db/migration-history.mjs`
- Create: `scripts/db/migration-history.test.mjs`
- Create: `scripts/db/assert-cloud-only.mjs`
- Create: `scripts/db/assert-cloud-only.test.mjs`

**One-time human setup:**

```bash
supabase login
supabase link --project-ref uljaajwwnygopsyvwsre
```

Current Supabase CLI documentation states hosted `db push` requires a linked project; runtime verifies that link before mutation and never changes it to an inferred target.

- [ ] Write RED target tests requiring committed ref `uljaajwwnygopsyvwsre` and parsing `supabase projects list` to prove the linked project is that ref. Mismatch => `BLOCKED` before any mutating command.
- [ ] Implement target verification with argv arrays and bounded parsing.
- [ ] Write RED `supabase migration list --linked` tests. Compatibility algorithm is exact:
  - every remote migration version must exist in the repository migration set;
  - remote order must equal the corresponding prefix of repository order;
  - repository-only suffix entries are pending and allowed;
  - any remote-only/reordered/gapped history is unexplained drift => `BLOCKED`.
- [ ] Implement migration-history parsing; never call `migration repair`.
- [ ] Write static contract tests rejecting executable `supabase start`, `--local`, `db reset --linked`, `migration repair`, production refs and arbitrary `--db-url` migration application.
- [ ] Run GREEN and commit:

```bash
node --test scripts/db/cloud-dev-target.test.mjs scripts/db/migration-history.test.mjs scripts/db/assert-cloud-only.test.mjs
git add scripts/db package.json
git commit -m "feat(db): guard the cloud development target"
```

---

### Task 6: Serialize `neurovia-dev` Mutations Across Processes

**Files:**
- Create: `scripts/db/db-mutation-lock.mjs`
- Create: `scripts/db/db-mutation-lock.test.mjs`
- Create: `scripts/db/unlock-cloud-dev.mjs`

**Lock contract:**

```text
path: .scratch/harness/neurovia-dev-db.lock
create: exclusive `wx`
payload: schemaVersion=1, pid, workflowId, acquiredAt, nonce
release: only matching owner nonce
existing lock: BLOCKED; never auto-take over
manual unlock: refuses while recorded pid is alive
```

- [ ] Write RED tests with two real child processes; exactly one acquires.
- [ ] Implement exclusive create and owner-only cleanup in `finally`/signal handlers.
- [ ] Implement manual unlock that checks recorded pid is not alive before deleting stale lock.
- [ ] Assert `.scratch/` remains ignored and never committed.
- [ ] Run tests GREEN and commit.

---

### Task 7: Apply and Verify Versioned Migrations on `neurovia-dev`

**Files:**
- Modify: `scripts/db/run-pgtap.mjs`
- Create: `scripts/db/lint-cloud-dev.mjs`
- Create: `scripts/db/verify-cloud-dev.mjs`
- Create: `scripts/db/verify-cloud-dev.test.mjs`
- Modify: `scripts/db/assert-cloud-only.test.mjs`
- Modify: `package.json`

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

Delete `db:start`, `db:reset`, local `db:lint`, local `test:db`, and redundant `test:db:remote`.

**State machine:**

```text
load config
-> verify linked target
-> acquire lock
-> migration list --linked
-> assert compatible history
-> db push --dry-run --linked
-> db push --linked
-> migration list --linked
-> assert pending suffix applied
-> db lint --linked --schema public --level error --fail-on error
-> pgTAP + explicit RLS allow/deny suite through SUPABASE_DEV_DB_URL
-> emit bounded JSON envelope when --json
-> release lock
```

- [ ] Write RED orchestration tests proving dependent steps stop after any failure and lock cleanup still occurs.
- [ ] Rewrite `run-pgtap.mjs` to read only runtime `SUPABASE_DEV_DB_URL`; never `.env`. Require a **direct** Supabase database host whose hostname contains configured ref `uljaajwwnygopsyvwsre`; reject pooler/unknown hosts for this canonical test path. Never print URL/password.
- [ ] Implement remote lint with exact argv above.
- [ ] Implement migration dry-run/apply/re-read with `--linked`; never `--include-seed`, reset, repair, local or migration `--db-url`.
- [ ] Emit exactly one Harness envelope:

```ts
interface ProjectDatabaseVerificationEnvelope {
  schemaVersion: 1
  status: 'PASSED' | 'FAILED' | 'BLOCKED'
  targetProjectRef: 'uljaajwwnygopsyvwsre'
  summary: string
  evidence: { kind: 'gate' | 'test'; locator: string; summary: string }[]
}
```

- [ ] Run `npm run test:db:contract` GREEN.
- [ ] Run real target identity + migration list + `db push --dry-run` against `neurovia-dev` before the first real migration application from this installation branch.
- [ ] If the installation branch contains an intentional pending migration, run full `npm run db:verify`; if it contains none, record the real no-pending preflight and do not manufacture a migration.
- [ ] Commit.

---

### Task 8: Rewrite DB Skill, PR Readiness and Governance

**Files:**
- Modify: `.agents/skills/database-change-plurora/*`
- Modify: `.agents/skills/pr-readiness/*`
- Modify: `AGENTS.md`
- Modify: `SECURITY.md`
- Modify: `docs/agents/opencode.md`
- Create: `docs/agents/harness.md`
- Modify: `docs/git-flow.md`

- [ ] Replace local/Preview-only language with the approved shared-cloud-development state machine.
- [ ] Add evals refusing local Docker, any DB ref except `uljaajwwnygopsyvwsre`, and automatic `migration repair` on drift.
- [ ] Document `neurovia-dev` as development authority, never production/fallback.
- [ ] Document future `neurovia-prod` as a separately approved authority boundary.
- [ ] Document runtime host checkout/token/model registry and no private Trick dependency import.
- [ ] Run `npm run test:skills`, `npm run test:opencode`, `npm run test:db:contract`, `git diff --check`; commit.

---

### Task 9: Align CI Without Shared Remote Mutation

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

- [ ] Add `npm run test:db:contract` to the cheap validate lane.
- [ ] Do not put `SUPABASE_DEV_DB_URL` or remote mutation credentials in ordinary PR CI.
- [ ] Do not run `db push` against shared `neurovia-dev` from every PR. Remote shared mutation stays Harness/operator-gated and serialized until a separately approved remote-CI concurrency design exists.
- [ ] Static CI rejects local DB paths, migration repair/reset and production target strings in canonical scripts.
- [ ] Run test/lint/typecheck and commit.

---

### Task 10: Fresh End-to-End Installation Verification

**Files:**
- Create: `docs/agents/harness-v2-evidence.md`

- [ ] Run `test:opencode`, `test:skills`, `test:db:contract`, repository tests, lint, typecheck, design-system gates and build.
- [ ] Run `harness:check` against the exact pinned Trick checkout.
- [ ] Start host with session-only `PLURORA_HARNESS_TOKEN`; prove only loopback listener and healthy control server.
- [ ] Start OpenCode in the NeuroVia worktree and prove `harness_run`, `harness_status`, `harness_cancel` are discoverable.
- [ ] Execute one real read-only/non-DB workflow through the TUI and record route/status evidence.
- [ ] Execute real `neurovia-dev` target/history/dry-run preflight; run full DB verification only when a real pending migration exists.
- [ ] Prove OpenCode/Codex global config/auth files unchanged by routing/model validation.
- [ ] Prove TUI cannot push while Harness delivery remains scoped; human merge remains required.
- [ ] Focused security review: token propagation, worktree derivation, checkout pin, model catalogue discovery, Supabase linked identity, DB lock, migration parser, DB URL redaction, subprocess argv.
- [ ] Fix confirmed bugs and rerun affected gates.
- [ ] Reconcile final Trick SHA if runtime changed during fixes and write terminal Plan C verdict.
- [ ] Hand off to Plan D Tasks 11/12.

## Completion Contract

Complete when NeuroVia uses a clean exact-SHA Trick host, commits real native model ids for every Plurora semantic tier, exposes only bounded OpenCode bridge tools, retires local Supabase/Docker semantics, uses `neurovia-dev` as the sole serialized cloud development DB target, blocks wrong target/drift without repair, applies only versioned migrations, proves remote history/lint/pgTAP/RLS allow+deny, keeps shared remote mutation out of ordinary CI, and produces fresh evidence for final Plan D activation.
