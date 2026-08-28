# Cloud-Dev & Plurora Host Enablement — verification evidence

Evidence for `docs/superpowers/plans/2026-08-27-trick-harness-cloud-dev-deployment-enablement.md`
(Plan E), recorded on 2026-08-28 on branch `feat/harness-v2-plan-e-cloud-dev-enablement`.

Everything below was run on this machine, against the real products where the plan says
"real". Where something was not proven, it says so; nothing here is inferred from a gate
that was not run.

## 1. Deterministic gates

| Gate | Result |
| --- | --- |
| `corepack pnpm run constraints` | pass — workspace constraints and `check-trick-boundaries` |
| `corepack pnpm run typecheck` | pass |
| `corepack pnpm run lint` | pass |
| `corepack pnpm run build` | pass (see note) |
| `corepack pnpm run test:trick` | pass — 92 files, 2068 tests |
| `corepack pnpm --filter @trick-harness/plurora-host test` | pass — 7 files, 108 tests |

Note on `build`: the fork's `build:web` script shells out to a bare `pnpm`, so on a machine
that runs pnpm only through corepack the gate fails on `'pnpm' is not recognized` before it
reaches any of this plan's code. It was run with a `pnpm` shim on `PATH` that forwards to
`corepack pnpm`, and then passes. This is an environment property of the upstream script,
not a defect introduced here, and it was left unchanged rather than edited under this plan.

Lint fixes made while running these gates, all in code this plan introduced or renamed:
the composition's `describeDatabasePreview` now names `WorkflowDatabaseVerificationInput`
rather than the deprecated alias kept for one cycle; the OpenCode catalogue read no longer
awaits a synchronous `close()`; and three host specs read a rejection through a helper that
does not assume the thrown value was an `Error`.

## 2. Real authenticated catalogue startup, against credential copies

Both native catalogues were read once with the real credential directories copied into a
throwaway staging directory and the process pointed at the copies — `CODEX_HOME`,
`XDG_CONFIG_HOME` and `XDG_DATA_HOME`. The real `~/.codex`, `~/.config/opencode` and
`~/.local/share/opencode` were never on a path the run could write to, which is the
property this gate exists to establish.

- OpenCode answered **133** `provider/model` ids, including `opencode-go/qwen3.8-max`
  and `opencode-go/glm-5.3-flash`.
- Codex answered **6** models: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`,
  `gpt-5.4`, `gpt-5.4-mini`, each with its reasoning efforts.
- SHA-256 of the copied `codex/config.toml`, `codex/auth.json`,
  `opencode/opencode.jsonc` and `opencode/auth.json` were **identical before and after**
  the run: `credentialsUnchanged: true`, `changed: []`.

Content equality is the assertion; mtime is not, because `auth_mode: chatgpt` rewrites
`auth.json` on every token refresh and an mtime assertion would fail for a reason that has
nothing to do with this harness.

Corroborating detail: cleaning up the staging directory raced Codex's own
`goals_1.sqlite` **inside the copy**. Codex wrote its state into the temporary home, which
is direct evidence that `CODEX_HOME` was honoured and the real home was off the write path.

Neither read started a model turn, rewrote Codex config or auth, or injected
`OPENAI_API_KEY`; the environment is passed through exactly as given.

## 3. Host HTTP smoke and process-tree quiescence

The host was started against a throwaway checkout — a temporary directory holding only a
`plurora-harness.json` — so that nothing a stage did could reach this repository. The
deployment named real models for all four Plurora semantic tiers (`codex.frontier` →
`gpt-5.6-sol`, `codex.balanced` → `gpt-5.5`, `opencode.workhorse` →
`opencode-go/qwen3.8-max`, `opencode.reasoning-fast` → `opencode-go/glm-5.3-flash`) and
the host resolved all four against the native catalogues before it listened.

| Step | Result |
| --- | --- |
| bind | `http://127.0.0.1:63923` — loopback, ephemeral port |
| `GET /health` (no token) | `200 {"status":"ok","workflows":0}` |
| `POST /workflows` (no token) | `401 unauthorized`, quoting no token |
| `POST /workflows` (token) | `202`, `state: running` |
| `GET /workflows/{id}` | `200` |
| `POST /workflows/{id}/cancel` | `200`, `state: canceled`, one `implement-1` stage on `opencode` |
| after `dispose()` | the port refuses connections |
| after `dispose()` | every pid the host spawned had exited — `pidsStillAlive: []` |

Quiescence is a claim about the process tree here, not about the host object: every spawn
went through one recorded seam, and each pid was probed with `process.kill(pid, 0)` after
disposal.

## 4. NeuroVia DB canary

**PENDING PLAN C.** The project's fixed verification command does not exist in `neuro-via`
yet, and this host can execute only that one fixed command. Nothing was simulated in its
place: the capability is proven by its own unit tests (argv shape, refusal of any other
command, redaction of its output), and the end-to-end canary belongs to the installation
plan.

Supabase Preview Branches remain unproven and deferred — the organization is on the free
plan and branching is a paid entitlement. This deployment therefore supplies the project
database verifier and configures no Supabase integration at all; the composition refuses
both together, since two verifiers is two answers about one database with nothing in the
run saying which one it was held to.

## 5. Independent review

| Axis | Finding |
| --- | --- |
| Authority | The control server may start, inspect and cancel a workflow; it exposes no merge, release or deploy path. GitHub delivery may commit, push a `harness/` branch and open a PR, and the PR body states that merging stays a human decision. The workflow handlers describe a delivery and never perform one. |
| Secret handling | The control token reaches only the control server's constructor and appears in no config, journal or status body — confirmed by search and by the 401 body carrying no token. The deployment file refuses credential-shaped values outright. One redaction rule, in `redaction.ts`, is shared by the database boundary and the provider-output boundary, so the two cannot drift. Stage summaries, evidence and findings are dropped when credential-shaped, and the database command's output is bounded and redacted. |
| Host dependency direction | Nothing under `packages/` or `profiles/` names the app; `check-trick-boundaries` passes. The app imports `@opencode-ai/sdk` directly in `catalogue.ts` — reviewed and kept, because the app is the composition root and the catalogue read is a deployment concern, not a runtime capability. |
| Model validation | The host cannot report ready before both native catalogues have answered; an unserved tier raises before any durable log, provider, database binding or listener exists, and the error names every unserved tier at once rather than one per boot attempt. |
| Subprocess lifecycle | One spawn seam for the Codex app-server, the delivery commands and the database command, so none can be exempted from what the shared seam enforces. Disposal unwinds latest-first, collects every failure and raises an `AggregateError` rather than reporting a clean shutdown it did not have. Proven empty in section 3. |

Accepted without change: the control token is compared with `!==` rather than a
constant-time comparison. The server binds loopback only and the token is supplied per
process, so the exposure this would address is not one this deployment has; the comparison
lives in upstream `packages/core/control-server` and changing it is not this plan's scope.

No confirmed bug was found that required a fix beyond the lint corrections in section 1,
and the affected gates were rerun after those.

## 6. Known-good SHA

Recorded in the commit that follows this file, which adds nothing but that line.
