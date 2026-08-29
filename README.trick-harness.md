# Trick Harness

Trick Harness is a fork of [DeepSeek Harness](README.md) that adds a policy-driven engineering runtime for routing software-engineering stages to real coding products, journalling observable evidence and keeping deterministic mutation authority outside model executors.

This document covers the fork-specific layer. Upstream behavior remains documented in [README.md](README.md).

## Runtime shape

The current Harness is a **library plus a loopback control server**. A deployment composes a profile, product-native model registry, durable session, workflow handlers, providers and integrations, then calls `run()` directly or drives the runtime over HTTP.

There is no generic `trick` CLI on the current reviewed runtime. The active executor set is OpenCode + Codex; Claude Code is outside the Harness executor scope by the approved 2026-08-27 scope amendment.

```text
packages/core/  <-  packages/providers/     <-  packages/composition/  <-  profiles/
                    packages/integrations/
```

Generic packages may not depend on `profiles/plurora` or `neuro-via`; `corepack pnpm run constraints` enforces that boundary.

## Requirements and checkout

- Node.js `^22.19.0 || >=24.0.0`.
- pnpm `11.7.0` through Corepack.
- git; `gh` when GitHub delivery is enabled.
- native OpenCode/Codex product authentication for real runs.
- Supabase CLI only when the selected deployment database strategy requires it.

```sh
git clone https://github.com/adsonpatrick/trick-harness.git
cd trick-harness
corepack enable
corepack pnpm install
corepack pnpm run constraints
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run test:trick
```

## Model registry — semantic-tier keys are mandatory

`profiles/plurora` owns routing policy and selects semantic tiers. A real deployment maps those tiers to provider-native model ids accepted by its authenticated products.

`DEFAULT_MODEL_REGISTRY` contains human/product names useful for deterministic tests and documentation. **It is not a real deployment registry.**

The Plurora deployment requires these keys:

```ts
const registry = {
  'codex.fast': '<supported Codex model id>',
  'codex.balanced': '<supported Codex model id>',
  'codex.frontier': '<supported Codex model id>',
  'opencode.reasoning-fast': '<authenticated-provider>/<supported-model-id>',
  'opencode.workhorse': '<authenticated-provider>/<supported-model-id>',
}
```

The angle-bracket values describe the schema only. Installation must discover and validate real non-secret ids before committing deployment configuration. OpenCode ids must be advertised `provider/model` pairs from the authenticated provider catalogue. Codex ids must be validated through the pinned app-server model catalogue (`model/list`). Missing/unsupported tiers block host readiness instead of falling back to `DEFAULT_MODEL_REGISTRY`.

Per-run overrides continue to reference semantic tiers and never rewrite product-global configuration.

## Authentication

- OpenCode authenticates through the OpenCode product; the Harness uses the official server/SDK path.
- Codex authenticates through native Codex/ChatGPT-plan credentials; the Harness does not inject `OPENAI_API_KEY` into subscription runs.
- GitHub delivery uses the native `gh` credential store.
- Supabase uses the CLI's native login/linked-project state for the explicitly configured deployment target.

Provider credentials, control tokens, DB URLs/passwords and raw provider output do not belong in committed config, prompts, status output or durable journal events.

## Control server

When enabled by the profile, the control surface binds loopback, typically:

```ts
control: { host: '127.0.0.1', port: 47831 }
```

Only `/health` is unauthenticated; workflow start/status/cancel require the process token. Objective ids and execution `workflowId`s are distinct.

## Conformance and the Definition of Done

Before a pull request may reach a human, one read-only `conformance` stage judges the branch
against the documents a human approved. What it is judged against is decided by deterministic
code, never by the model being judged: the runtime reads the approved Spec and Plan back from
the checkout, enumerates every acceptance criterion the Spec declares and every task the Plan
declares, and adds the eight Definition of Done obligations the profile carries. A reading
that leaves an obligation unanswered, answers one twice, invents one, restates one, or was
produced against different documents is refused and establishes nothing.

- Approved artifact identity is repository-relative path plus SHA-256. The hash is computed
  over what was actually read, and the documents are re-read before anything that writes and
  again before conformance, so a Plan edited mid-run blocks the run rather than redefining it.
- `conformance` runs `read-only` and can never receive workspace-write authority.
- Routine conformance routes to `codex.balanced` at `high`; high and critical risk route to
  `codex.frontier` at `xhigh`.
- With Codex unavailable the reading falls back to `opencode.reasoning-fast` with degraded
  assurance, and it cannot satisfy the cross-executor independence that high and critical work
  requires when it collapses onto the executor that wrote the implementation.
- `PR_READY` requires the latest conformance at `PASS` plus a fresh final verification that
  passed after it.
- What survives into status and replay is paths, hashes, counts and a verdict. Approved
  documents, transcripts and private model reasoning are never journal payloads.

## Change impact decides the bar

A pull-request run is planned in two halves, and what the second half must buy is decided from the change's own repository paths rather than from the risk whoever opened the objective typed.

- The **planned** reading is parsed out of the approved Plan's `**Files:**` rows before the first mutation-capable dispatch, against the Plan's verified SHA-256. The **actual** reading is read from the published branch with `git merge-base` plus `git diff --name-status -z`, after delivery and again after every repair and redelivery. No stage is ever asked what it touched.
- Resolution is monotonic. `effectiveRisk` is the maximum of the objective's risk, the planned floor, the actual floor and any matched QA row; surfaces, task classes, capabilities and evidence profiles are unioned. A repair that shrinks the diff cannot hand back what the earlier reading bought.
- Path rules accumulate rather than winning outright, so a signup form under `src/features/auth/` is an auth surface and a UI surface at once. Routing itself stays first-match-wins.
- A migration in the delivered diff is a database change whether or not the caller declared one, and a run that changes a database with no composed verification capability is `BLOCKED` before the branch is published. There is no caller field that turns the detection off.
- Read-only roles always route with `writeVolume: 'none'`, whatever the change turned out to be.
- Paths delivered outside the approved Plan's write set are carried as bounded `unplannedPaths`, with the count taken before the cap.
- What reaches the journal and status is counts, risks, surfaces, capability names, evidence-profile names, matched rule ids and those bounded paths. File contents, raw diffs, secrets, transcripts and private model reasoning have no field to travel in.

Plurora's path rules, risk floors and evidence profiles live in `profiles/plurora`; the Git reading lives in `apps/plurora-harness-host`. Nothing under `packages/` names a NeuroVia path or a Supabase project ref.

## Automation authority

- GitHub delivery may commit, push the current feature branch and open/update its PR; it may not force-push, rewrite history, merge, release or deploy.
- Deterministic external mutation is a capability, never generic model shell authority.
- Read-only review/debug/security stages do not gain write permission through routing.
- Self-modifying/model-authored runtime plugins excluded by the profile are refused at composition time.
- `dispose()` waits for owned process-tree quiescence.

## NeuroVia / Plurora deployment amendment

On 2026-08-27 the owner approved `neurovia-dev` (`uljaajwwnygopsyvwsre`) as the canonical Supabase Cloud **development** database. A future production project will be a separate authority boundary. Preview Branches remain an optional future isolation strategy rather than a development prerequisite.

The normative amendment and implementation plans are:

- `docs/superpowers/specs/2026-08-27-neurovia-harness-deployment-cloud-dev-amendment.md`;
- `docs/superpowers/plans/2026-08-27-trick-harness-cloud-dev-deployment-enablement.md`;
- `docs/superpowers/plans/2026-08-27-neurovia-harness-installation-amendment.md`.

The installation topology deliberately avoids importing private `@trick-harness/*` workspaces into `neuro-via`. The enablement plan adds a runnable Plurora host inside the exact-SHA Trick Harness checkout; NeuroVia verifies/starts that checkout and remains a bounded loopback HTTP client.

The enablement plan is implemented. `apps/plurora-harness-host` is a runnable Plurora host: it reads `plurora-harness.json`, refuses a policy-version mismatch, resolves every Plurora semantic tier against the native OpenCode and Codex catalogues, opens a durable JSONL session under `.plurora-harness/sessions`, composes the Plurora profile and binds the control server to the configured loopback address with the caller-supplied token. Nothing is ready before every one of those questions has been answered, and `dispose()` unwinds what was opened in reverse.

Database verification is a capability the deployment supplies rather than a strategy the runtime knows: this host executes one fixed project command and no other, and it configures no Supabase integration, because the composition refuses two owners of one database.

**What is still unproven:** the NeuroVia end-to-end database canary, which waits on the project's own verification command (Plan C), and the Supabase Preview Branch path, which waits on an entitlement the organization does not have.

Once implemented, a DB-changing Plurora development workflow will be cloud-only and serialized:

```text
verify target/link identity
-> acquire cross-process DB mutation lock
-> reconcile migration history
-> refuse unexplained drift
-> db push dry-run
-> db push
-> re-read migration history
-> remote lint
-> pgTAP
-> RLS allow + deny
-> applicable integration/security checks
-> durable evidence
-> release lock
```

No canonical path may use local Docker/Supabase/Postgres, arbitrary remote project selection, production fallback, remote reset or automatic `migration repair`.

## Current verification status

Harness-specific deterministic gates passed in the recorded Plan D evidence, and real OpenCode, Codex, GitHub delivery, replay/quiescence and Supabase fail-closed paths were exercised. The built-in positive Supabase Preview path remains unproven because the organization does not currently have Preview Branch entitlement.

The host and shared-development enablement produced its own fresh evidence: deterministic gates, a real authenticated catalogue read against throwaway copies of the credential directories proven byte-identical afterwards, and a host HTTP smoke (health, unauthenticated refusal, start, status, cancel, dispose) ending with no port open and no spawned process alive. The NeuroVia database canary is recorded as pending Plan C rather than simulated. See `docs/verification/2026-08-27-neurovia-deployment-enablement-evidence.md` and `docs/verification/2026-08-27-harness-v2-plan-d-evidence.md`.

Change-impact enforcement produced fresh evidence of its own: deterministic gates, five adversarial measured lifecycles through the real runner, real profile and real host handlers, and a real-product smoke in which the Git change-set reader was driven through the real subprocess service against a disposable Git fixture — never NeuroVia and never a live database — alongside a read-only read of both authenticated model catalogues. That review found and fixed two policy-enforcement gaps: a QA row whose raised risk selected stages but did not reach routing, and two sensitive surfaces (`credentials`, `api`) that the QA and Security tables declared while no path rule could produce them. See `docs/verification/2026-08-28-change-impact-risk-enforcement-evidence.md`, which records the credential and API path families as an assumption open to correction, and states what a host boot and an independently-authored review would still add.

Implementation conformance produced fresh evidence of its own: deterministic gates, a fixture pull-request lifecycle proving a twelve-obligation manifest of two Spec criteria, two Plan tasks and eight Definition of Done rows with `PR_READY` reached only after conformance and a later final verification both passed, seven adversarial fixtures none of which reaches `PR_READY`, and a real authenticated Codex `model/list` read confirming that the models serving `codex.balanced` and `codex.frontier` advertise `high` and `xhigh`. See `docs/verification/2026-08-28-implementation-conformance-dod-evidence.md`, which supersedes the Plan E evidence as the installation authority; the SHA recorded there is the only initial runtime revision a deployment may pin.
