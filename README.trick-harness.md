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
