# Trick Harness

Trick Harness is a fork of [DeepSeek Harness](README.md) that adds an engineering harness on top of it: a policy-driven runtime that routes the stages of a software task to real coding products — OpenCode and Codex — journals what happened, and refuses to claim more than it observed.

This file covers the fork's own layer. Everything upstream still works as documented in [README.md](README.md); nothing here replaces it.

## What this is, and what it is not

It is a **library plus a loopback control server**. You compose a Harness in your own process, hand it a profile and a workflow, and either call `run()` directly or drive it over HTTP.

There is **no `trick` CLI**. A composition root is the entry point, because the pieces a deployment must supply — how to read a product's output back into a run, what a delivery should publish, which preview branch a schema change is verified on — have no safe defaults and are deliberately not guessed for you.

Two products are composed: **OpenCode** and **Codex**. Claude Code is not an executor of this harness and was removed from the set by owner decision on 2026-08-27; see [the scope amendment](docs/superpowers/specs/2026-08-27-harness-v2-scope-amendment.md).

## Layout

The fork's packages are `@trick-harness/*`, all `private: true`, and they sit in a one-way dependency chain that a gate enforces:

```plain text
packages/core/  <-  packages/providers/     <-  packages/composition/  <-  profiles/  <-  your project
                    packages/integrations/
```

| Path | What lives there |
| --- | --- |
| `packages/core/profile` | The profile shape and its validator |
| `packages/core/routing` | Which executor and model tier a stage gets, and what happens when one is unavailable |
| `packages/core/engineering-workflow` | The stage lifecycle, repair budget and verdicts |
| `packages/core/executor` | The dispatch runtime providers register into |
| `packages/core/journal` | Durable events, and the replay that reads them back |
| `packages/core/control-server` | The loopback HTTP surface |
| `packages/providers/opencode` | The OpenCode product seam |
| `packages/providers/codex` | The Codex product seam |
| `packages/integrations/github-delivery` | Commit, push and pull-request capability |
| `packages/integrations/supabase-preview` | Isolated preview-branch database validation |
| `packages/composition/runtime` | `composeHarness` — the only place configuration becomes a runtime |
| `profiles/plurora` | One project's policy: routing, workflow bounds, QA, security, integrations |
| `profiles/fixtures/minimal` | A profile with no project policy, used to prove the core carries none |

Generic packages must never depend on a project's policy. `pnpm run constraints` is what proves it, and it fails the build if you break it.

## Requirements

- **Node.js** `^22.19.0 || >=24.0.0`. Note that `22.17` is below the floor.
- **pnpm 11.7.0**, obtained through Corepack rather than installed globally.
- **git**, and **`gh`** if you enable GitHub delivery.
- **Supabase CLI**, only if you enable the preview-database integration.
- On **Windows**, enable long paths before cloning, or a few upstream test fixtures fail to check out: `git config --global core.longpaths true`.

## Install

```sh
git clone https://github.com/adsonpatrick/trick-harness.git
cd trick-harness
corepack enable
corepack pnpm install
```

Verify the checkout before configuring anything:

```sh
corepack pnpm run constraints    # layer boundaries hold
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run test:trick     # the fork's own scope: 85 files, 1951 tests
```

`test:trick` is the suite that covers this fork. `pnpm run test` runs the whole upstream monorepo and **does not pass** — see [Known limits](#known-limits).

## Configure

### 1. The profile

A profile is the only thing that decides what exists. Start from `profiles/plurora/profile.ts` and change the five policy files beside it:

| File | Owns |
| --- | --- |
| `routing-policy.ts` | Which executor and semantic model tier each stage and risk level gets, and where work goes when an executor is unavailable |
| `workflow-policy.ts` | Repair-cycle and executor-start bounds, and the review independence required per risk level |
| `qa-policy.ts` | What evidence a change of each shape must produce before it is eligible for human merge |
| `security-policy.ts` | Which changed surfaces select security review, and which plugins are excluded from trusted composition |
| `integrations.ts` | Which integrations are enabled, and the limits on each |

An integration a profile does not enable is not composed, not reachable, and not something a run can improvise its way into.

### 2. The model registry

The profile names *semantic tiers*; the registry maps a tier to the model id one deployment's products actually accept. `DEFAULT_MODEL_REGISTRY` in `packages/core/routing/src/index.ts` carries product-marketing names, not ids — do not pass it to a real provider.

**OpenCode requires a `provider/model` pair** and refuses a bare model name. Ask the running server which pairs your host is authenticated for rather than guessing: start the SDK server and read `GET ${server.url}/config/providers`, which lists the authenticated providers and their model ids, for example `opencode-go/mimo-v2.5`.

Codex takes its own model id directly, for example `gpt-5.6-sol`.

```ts
const registry = { implementation: 'opencode-go/mimo-v2.5', reasoning: 'gpt-5.6-sol' }
```

### 3. Product authentication

Both providers authenticate through the **products' own credential stores**, and neither reads a key out of your environment.

- **OpenCode** — log in with the OpenCode client as you normally would. The provider drives the official SDK; it runs no pty and drives no TUI screen.
- **Codex** — log in with the Codex client on your ChatGPT plan. `OPENAI_API_KEY` is **not** injected into the child and is not required for the plan route. If one happens to exist on your machine it is deliberately ignored, because injecting it would silently move a subscription run onto metered billing under a different identity.
- **GitHub delivery** — `gh auth login`. Pass no token through `env`; the capability lets `gh` authenticate from its own stored configuration.
- **Supabase preview** — `supabase login`. The integration takes a non-secret `projectRef` and never reads a connection string into a config, a log or a prompt.

Per-run model and effort overrides never rewrite your global OpenCode or Codex configuration files.

### 4. The control server

Enable `control-server` in the profile's integrations and the composition exposes one. It binds loopback, mints a **bearer token per process** that is never written to disk, and its only unauthenticated route is `/health`.

```ts
control: { host: '127.0.0.1', port: 47831 }
```

Port `0` picks a free one, which is what the tests use. A consumer such as `neuro-via` pins that URL as non-secret configuration alongside the repository, the profile name and an exact 40-hex revision.

## Run

### Composing in process

```ts
import { composeHarness } from '@trick-harness/composition'
import { createOpencodeProvider, createSdkAdapter } from '@trick-harness/provider-opencode'
import { createCodexProvider } from '@trick-harness/provider-codex'
import { spawnSubprocess } from '@deepseek-ai/dsh-subprocess-local'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { pluroraProfile } from './profiles/plurora/profile.js'

const harness = composeHarness({
  profile: pluroraProfile,
  registry: { implementation: 'opencode-go/mimo-v2.5', reasoning: 'gpt-5.6-sol' },
  session: Session.create(SessionId('my-run')),
  flush: () => Promise.resolve(true),
  workflow: {
    plan: () => [
      { stageId: 'implement-1', role: 'implement' },
      { stageId: 'verify-1', role: 'verify' },
    ],
    task: (stage, objective) => `${stage.role}: ${objective.requirement}`,
    interpret: (stage, executor, result) => ({
      role: stage.role,
      executor,
      verdict: result.status === 'completed' ? 'PASS' : 'FAIL',
      summary: `${stage.role} ran on ${executor}`,
      findings: [],
      evidence: [],
    }),
  },
  providers: {
    extraProviders: [
      createOpencodeProvider(createSdkAdapter()),
      createCodexProvider({ spawn: spawnSubprocess, env: {} }),
    ],
  },
  control: { host: '127.0.0.1', port: 47831 },
})

const controller = new AbortController()
const outcome = await harness.run({
  id: 'objective-1',
  cwd: process.cwd(),
  requirement: 'what you want done',
  risk: 'high',
  workload: 'heavy',
  profileId: pluroraProfile.id,
}, controller.signal)

await harness.dispose()
```

`interpret` and `task` have no defaults, on purpose: the runtime never parses a product's output, and a stand-in interpreter would be this package guessing at a product's shape on your behalf. `plan` is optional; `planPullRequestStages` from `@trick-harness/engineering-workflow` is the lifecycle that certifies a published branch.

At `risk: 'high'` the Plurora profile resolves independence to `cross-executor-required`, which is what puts implementation on one product and the independent verification on the other. When only one executor is usable the run records the reason code `independence:unsatisfied` rather than pretending the requirement was met.

`dispose()` terminates every process tree the composition owns and waits for quiescence.

### Driving it over HTTP

```sh
TOKEN=...            # harness.server.token, minted per process
BASE=http://127.0.0.1:47831

curl "$BASE/health"

curl -X POST "$BASE/workflows" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"id":"objective-1","cwd":"/abs/path","requirement":"...","risk":"high","workload":"heavy","profileId":"plurora"}'

curl "$BASE/workflows/<workflowId>" -H "authorization: Bearer $TOKEN"
curl -X POST "$BASE/workflows/<workflowId>/cancel" -H "authorization: Bearer $TOKEN"
```

`POST /workflows` answers `202` with the minted `workflowId`. An objective is something a person asks for and may ask for again; an execution is one attempt at it, and the two never share an id.

### Reading a run back after a restart

`harness.restartOf(workflowId)` reads the durable log alone. A run whose process died mid-stage reconstructs as `interrupted` / `INCONCLUSIVE` with the open stage named and a `requiresWorldVerification` flag — it tells you to re-read the world before retrying, and resumes nothing. A workflow nobody ran reconstructs as nothing, not as an empty success.

The journal holds observable facts only. There is no reasoning, thinking, transcript, output or prompt key in the durable payload.

## Running scripts directly

Repo TypeScript uses parameter properties, which the strip-only loader rejects. Use the transform loader:

```sh
node --experimental-transform-types your-script.ts
```

Module resolution is relative to the **script file's** directory, so an ad-hoc script importing workspace packages has to live inside a package that already resolves them, for example `packages/composition/runtime/`.

## Tests and gates

```sh
corepack pnpm run constraints        # layer boundaries
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run test:trick         # the fork's scope
corepack pnpm run test:snapshot      # snapshot suites
corepack pnpm run verify-md-wrap     # one physical line per markdown paragraph
```

`verify-md-wrap` is strict: a hard-wrapped prose paragraph fails the gate. Write each paragraph on one line.

## What automation may and may not do

These are contract, not convention, and the code enforces them:

- Delivery may commit, push the current feature branch, and open or update its pull request. It may **never** force-push, rewrite history, push to a protected branch, merge, release or deploy. **Merge stays human.**
- Database execution and validation are **cloud-only**, on isolated Supabase preview branches. There is no Docker, local or shared-dev fallback. If a preview cannot be created the workflow **blocks**; it does not fall back to another database, and the parent project is never an execution target.
- Deterministic mutation is a capability port, never a stage handed to an executor. A missing capability is `BLOCKED`, not improvised.
- Self-modifying and model-authored runtime plugins are refused at composition time, not merely listed. Declare what you mount in `pluginIds` so the profile's `trustedComposition.excludedPluginIds` has something to refuse.
- Failures expose structured diagnostics, never raw stderr, environment or credential dumps.

## Known limits

Stated because a harness that overclaims is worse than one that stops.

- `pnpm run test` — the **whole upstream monorepo** — fails, and the failing set is unstable. Six files fail in every run including one made against the upstream baseline `b150a551b8`, so those are inherited. Six more move between runs on both trees. The fork edited none of the twelve paths, but it did add three include patterns to `vitest.config.ts`, so it is not excluded as a contributor to the instability. The fork's own scope, `test:trick`, is green. The full comparison is in [the Plan D evidence ledger](docs/verification/2026-08-27-harness-v2-plan-d-evidence.md).
- No real Supabase preview branch has ever been provisioned by this harness. The positive path is **ready**, not **proven**; it requires the Pro plan, which the owner decided not to buy. The fail-closed half is proven: the real API answered `branches create` with HTTP 402 and the workflow blocked without mutating anything.
- Journal compaction and pruning have not been exercised against a log large enough to trigger them.
- The `neuro-via` bridge half — the OpenCode TUI starting and observing a workflow through the control server — is not in this repository and is not simulated here.
