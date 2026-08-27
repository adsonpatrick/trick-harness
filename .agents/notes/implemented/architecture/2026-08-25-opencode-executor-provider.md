# Agent Note: OpenCode executor provider

Status: implemented

## Problem

Trick Harness routes a run to a named product, and OpenCode is the first of those products. Three requirements collide with how a coding agent is normally driven. Per-run routing must select a model without rewriting the user's global OpenCode defaults, because a harness that mutates the developer's own tool configuration is a harness nobody can safely leave running. Permission modes must map onto something the product actually enforces, or fail loudly, because a `read-only` route that silently permits edits is worse than one that refuses to start. And a declared capability the provider cannot honour produces a durable route fact naming a model or an effort that never applied — a lie in the record, which is the failure the executor contract exists to prevent.

Answering any of that by guessing at the SDK's shape would have been the wrong kind of confidence, so the contract was read before the provider was written.

## Decision

The provider depends on `@opencode-ai/sdk@1.18.23`, pinned exactly, following the `@openai/codex` precedent in `subagent-codex`. What the SDK supports was established by inspecting the installed package's generated types rather than its prose documentation, and the observed contract is recorded below.

**Scoping is per server instance, through memory.** `createOpencodeServer({ config })` takes an in-memory `Config` that applies to that instance alone. The permission block travels that way. No user or global config path is read or written on any code path in this package.

**The model travels on the prompt, not the server.** `SessionPromptData.body.model` is `{ providerID, modelID }`, which is the only place OpenCode accepts a model. A route's model must therefore already be a `provider/model` pair; a bare id is rejected rather than resolved against whichever provider happens to be configured, because guessing would run the task somewhere other than where the route says it ran.

**Reasoning effort is declared unsupported, because it is.** There is no reasoning-effort field anywhere in the SDK's generated contract. `capabilities.reasoningEffort` is therefore `false`, and the executor runtime refuses such a route before a process is spawned. Routing policy may still state an effort; it is advisory metadata recorded with the route, never forwarded to this provider.

**Every permission field is stated, including the denied ones.** OpenCode treats an absent permission as its own default, so an omitted field would silently widen what a `read-only` run may do. `doom_loop` is denied in both modes because `ask` would stall a run with no interactive operator to answer it.

**The SDK is behind an adapter seam.** `OpencodeAdapter` is the narrow surface the provider consumes: start a server, connect, create a session, prompt, abort. `createSdkAdapter()` binds it to the product; tests supply a fake. Translation and lifecycle behaviour is therefore tested against real provider code rather than against a mock of the provider, and an SDK change lands in one module.

**Every SDK call uses `throwOnError: true`.** The generated hey-api client otherwise returns a result tuple whose `error` is an easily ignored field, and an ignored transport error would surface as a successful run with empty output.

**Teardown is owned and unconditional.** A run that did not finish on its own has its session aborted; the server closes on every path, success, failure, and cancellation alike.

## Alternatives considered

**Write a config file for each run.** Rejected: it makes per-run routing a filesystem mutation racing every other run and the user's own editor, and it violates the constraint that per-run routing never rewrites global defaults.

**Set the model on the server rather than the prompt.** Not available — the SDK exposes no such field — and it would also mean one server per model, multiplying process cost for no gain.

**Accept a reasoning effort and drop it.** Rejected outright. This is precisely the case the capability contract was written for: the route fact would claim an effort the run never applied.

**Resolve a bare model id against the first configured provider.** Rejected for the same reason: the recorded route would name something other than what ran.

**Import the SDK directly and test with a live server.** Rejected for unit CI: it consumes the user's OpenCode quota on every run and makes cancellation tests dependent on real network timing. The cost is that `src/adapter.ts` is the one module unit tests do not cover, which a deferred keyless smoke is meant to close.

**Reuse `createOpencode()` rather than server-then-client.** Rejected: it bundles server startup and client construction, leaving no seam at which a test can substitute either half.

## Consequences

The provider is honest about a capability it lacks, which means Plurora's routing policy cannot demand reasoning effort from OpenCode and must treat `effort` as advisory. That change was made deliberately in `PolicyRuleDefinition.use` and in the Plurora routing policy header rather than by weakening the capability check.

The adapter seam is verified; the SDK binding behind it is not. Tests prove the provider aborts the session and closes the server on every path, but proving the OS process tree reaches quiescence needs a live smoke that does not yet exist. Until it does, the strongest claim this package supports is that the provider issues the right calls in the right order, not that the product obeyed them.

Pinning the SDK exactly means an OpenCode release does not silently change what a run does — and equally that adopting one is a deliberate edit here, with the recorded contract above as the thing to re-verify.
