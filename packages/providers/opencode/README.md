# @trick-harness/provider-opencode

The OpenCode executor provider. One run means one scoped server on loopback, one session rooted in the requested working directory, one prompt, and owned teardown.

This is a fork-local package: private to `adsonpatrick/trick-harness`, never published. See [docs/trick-harness/upstream.md](../../../docs/trick-harness/upstream.md).

## Nothing here touches the user's OpenCode configuration

Per-run routing must never rewrite global product defaults. `@opencode-ai/sdk` makes that achievable without a config file: `createOpencodeServer` accepts an in-memory `Config`, which applies to that server instance alone. The permission block travels that way, and the model travels on the prompt body — the only place OpenCode accepts one. No user or global config path is read or written on any code path in this package.

Authentication is left entirely to OpenCode's own credential store. This package never reads an API key from the environment and never injects one, so a run is authorised exactly as the user's own `opencode` invocations are.

## Reasoning effort is not supported, and says so

`@opencode-ai/sdk@1.18.23` has no reasoning-effort field anywhere in its generated contract. The provider therefore declares `reasoningEffort: false`, and the executor runtime refuses any route that demands one before a process is spawned. Silently accepting and dropping the field would leave a durable route fact claiming an effort the run never applied.

Routing policy may still *state* an effort. It is advisory metadata recorded with the route, not a request the executor receives — see `PolicyRuleDefinition.use` in [@trick-harness/profile](../../core/profile/README.md).

## The adapter seam

`OpencodeAdapter` is the narrow OpenCode surface the provider depends on: start a server, connect a client, create a session, prompt, abort. `createSdkAdapter({ startupTimeoutMs, spawn, cwd })` binds it to the real product; tests supply a fake. Production composition supplies managed subprocess ownership so teardown can join the full server process tree.

Every SDK call uses `throwOnError: true`. The generated client otherwise returns a result tuple whose `error` is an easily ignored field, and an ignored transport error would surface as a successful run with empty output.

## Server readiness deadline

The adapter requires an explicit `startupTimeoutMs`: positive integer milliseconds, no greater than `2147483647`. Each executor request also carries an absolute Harness-owned `deadlineAtMs` from the role recovery policy. The provider combines the request cancellation signal with that deadline and passes it to every SDK request, including `session.prompt()`. A timed-out prompt returns a transport failure only after the owned server has been closed; absent process-tree exit proof, workspace reconciliation remains inconclusive.

## Safe failure taxonomy

Provider failures use canonical executor categories, stable `opencode.*` codes and a bounded `failurePhase` (`STARTUP`, `SESSION_CREATE`, `PROMPT`, `SESSION_ABORT` or `CLEANUP`). The adapter classifies allowlisted HTTP status and Node transport codes without persisting response bodies or arbitrary error fields. Unknown errors remain `other`, which routing does not automatically retry or reroute. The pinned SDK compatibility tests assert one HTTP request per prompt, signal propagation, status capture and malformed-response behavior.

## Usage

```ts
import { createExecutorRuntime } from '@trick-harness/executor'
import { createOpencodeProvider, createSdkAdapter } from '@trick-harness/provider-opencode'

declare const controller: AbortController

const runtime = createExecutorRuntime()
runtime.register(createOpencodeProvider(createSdkAdapter({ startupTimeoutMs: 60000 })))
const result = await runtime.start({
  cwd: '/work/repo',
  task: 'implement the parser',
  route: { executor: 'opencode', model: 'anthropic/claude-opus-5', permissionMode: 'workspace-write' },
  signal: controller.signal,
  deadlineAtMs: Date.now() + 60_000,
})
```

## Invariant companion

`./invariant` re-checks the declaration the executor runtime takes on trust: that this provider has not come to claim reasoning-effort support its SDK cannot carry, that it still claims the model override it exercises on every prompt, and that it declares no permission mode it cannot map.

## Known Limitations and Deferred Work

- **Process-tree joining is tested through the managed subprocess contract, not a live OpenCode process.** A keyless smoke that starts and terminates the installed OpenCode server remains separate from unit CI.
- **No live model smoke runs in unit CI.** SDK startup deadline tests simulate the external server; a local server-start smoke needs OpenCode installed but makes no model request. Real prompt execution still requires the user's OpenCode authentication and quota.
- **A model name must already be a `provider/model` pair.** Resolving a semantic tier to that pair belongs to the profile above this seam; this package rejects a bare id rather than guessing which configured provider was meant.
- **The prompt is a single text part.** File and subtask parts that the SDK accepts are not exposed, because the executor contract carries one task string.
- **Streaming is not surfaced.** The result is the final assistant message's text; intermediate events are not forwarded, which is what "bounded result, not the child transcript" requires.
