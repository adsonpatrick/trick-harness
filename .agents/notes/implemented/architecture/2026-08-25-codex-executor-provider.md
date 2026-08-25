# Agent Note: Codex executor provider

Status: implemented

## Problem

The executor runtime dispatches a resolved route — an executor name, an optional product-native model, an optional reasoning effort, and an explicit permission mode — and expects a bounded result with a safe structured failure. Codex had to become one of those executors without a second Codex client, without an injected API key, and without touching the user's own Codex configuration.

Two gaps stood between the route and the wire. The first was the entry point, closed by the scoped one-shot transport recorded in [2026-08-25-codex-scoped-one-shot-transport](2026-08-25-codex-scoped-one-shot-transport.md). The second was filesystem authority: the executor contract states that a permission mode is "always explicit, never defaulted", and none of the three deployment permission modes expressed an unattended run with an explicit sandbox. `never` sends `approvalPolicy: 'never'` and no sandbox at all, leaving the sandbox to the user's configuration; `approve-for-me` fixes `workspace-write` but with `on-request` approvals, which a routed worker has nobody to answer; `dangerously-bypass-approvals-and-sandbox` is full access.

## Decision

Extend the routing seam with a sandbox, then build the provider on it.

`ThreadStartParams.sandbox` is a `SandboxMode`, whose schema enum is exactly `read-only | workspace-write | danger-full-access` — the executor contract's two modes are the first two. `CodexRouting` therefore gained an optional `sandbox`, restricted by type to the two routable values. `danger-full-access` stays reachable only through the deployment-owned permission mode, so a per-run route can tighten filesystem authority and can never widen it. The routed sandbox is applied after the permission mode's own params because it is the more specific decision: the deployment says how a run is supervised, the route says what this one run may reach.

The provider then maps a route onto that seam. Permission mode becomes the sandbox, `route.model` becomes `TurnStartParams.model`, `route.reasoningEffort` becomes `TurnStartParams.effort`, and the approval policy stays `never`. Translation happens before the transport is called, so a route the provider cannot express costs no process.

Capabilities declare `modelOverride: true` and `reasoningEffort: true`, because the pinned schema has a field for each. The effort tier is passed to the product verbatim rather than through a translation table. `ReasoningEffort` is schema-typed as a non-empty string described as "a non-empty reasoning effort value advertised by the model", and the accepted set is read per model from `Model.supportedReasoningEfforts`; a fixed mapping would be an invention this repository cannot verify from the pinned artefact.

Failure classification answers exactly one question, because `ExecutorFailure.availability` drives fallback routing: does the executor's reachability explain this failure? Eight variants say yes — `usageLimitExceeded`, `sessionBudgetExceeded`, `serverOverloaded`, `internalServerError`, and the four transport variants `httpConnectionFailed`, `responseStreamConnectionFailed`, `responseStreamDisconnected`, `responseTooManyFailedAttempts`. Seven are listed explicitly as never-availability rather than left to the default, so the distinction is asserted by tests: `contextWindowExceeded` and `badRequest` describe the request, `sandboxError` and `activeTurnNotSteerable` describe the run's own state, `cyberPolicy` is a refusal, `unauthorized` needs a human to fix an account, and `threadRollbackFailed` is a product fault an identical retry reproduces. A completed run that did poor work is not a failure and never reaches the map.

Recovering the variant needed one more piece. `SubagentResult.diagnostic` is a string, so `parseCodexDiagnostic` was added beside `failureDiagnostic` in the producing package, giving the format exactly one owner and a round-trip test. Widening `SubagentResult` itself was rejected: it is a generic upstream contract shared by every subagent provider.

## Alternatives considered

**Inject `OPENAI_API_KEY` from the host when present.** It would make runs work on more machines and is exactly the prohibited behaviour: it silently moves a subscription run onto metered billing under a different identity. The child's environment is the deployment's explicit entries and nothing else, empty by default.

**Write a config file or set `CODEX_HOME` per run.** Shared state that reaches concurrent runs and outlives the one that set it. Every per-run selection travels on the wire instead.

**Parse the diagnostic string inside the provider.** Pattern-matching prose the provider does not own is how a taxonomy quietly collapses into generic text. The reader lives beside the writer.

**Treat every failure as an availability failure and let routing retry.** Retrying a context-window overflow or a rejected request wastes a second run and reports the wrong cause to whoever reads the route fact afterwards.

**Treat `unauthorized` as an availability failure.** The executor is reachable and refusing. A fallback route hides an account problem that needs a human.

**Map effort tiers through a translation table.** Rejected as guessing; see above.

**Route the sandbox on `turn/start` instead.** `TurnStartParams.sandboxPolicy` exists but is a structurally different `SandboxPolicy` union, and filesystem authority is a property of the whole run rather than of one turn within it.

## Consequences

Twenty-one tests cover the provider, and most of them drive the real transport against a fake subprocess speaking the real line-delimited JSON-RPC protocol — so the routed model, effort, and sandbox are asserted on actual emitted frames rather than against a mock of the transport. That tier also proves the launch uses the workspace's own pinned `@openai/codex` wrapper rather than a host `codex`, that the child's environment stays empty while a host `OPENAI_API_KEY` is set, and that nothing in the launch names a Codex home, profile, or config path.

The upstream package gained a sandbox field on its routing seam and a diagnostic reader; both are additive, and its seventy-one tests pass unchanged. Two of them pin the unrouted `thread/start` frame exactly, so a future change that started emitting a sandbox by default would fail rather than silently alter every existing consumer's run.

The credentialed path is not exercised in unit CI, because a real run consumes the user's plan quota. Effort is not validated against the selected model; that would need a `model/list` round trip on every dispatch, and today an unadvertised tier fails at turn time through the taxonomy above.
