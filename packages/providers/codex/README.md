# @trick-harness/provider-codex

The Codex executor provider. One run means one `codex app-server --stdio` child from the workspace's own pinned official payload, one ephemeral thread rooted in the requested working directory, one turn, and disposal to process-tree quiescence.

This is a fork-local package: private to `adsonpatrick/trick-harness`, never published. See [docs/trick-harness/upstream.md](../../../docs/trick-harness/upstream.md).

## It reuses the product transport rather than reimplementing it

Everything hard about driving Codex — resolving the package-local wrapper, the app-server handshake, the ephemeral thread, the sixteen-variant error taxonomy, the permission diagnostics, and disposal to quiescence — already belongs to [@deepseek-ai/dsh-subagent-codex](../../subagent/subagent-codex/README.md). This package adds a route translation and a result translation on top of `startCodexTask`, and nothing else. A second Codex client would have duplicated the taxonomy and drifted from it on the first upstream fix.

## Native authentication, untouched configuration

Authentication and account state come from the user's own Codex installation. This package never reads an environment API key and never injects one: putting `OPENAI_API_KEY` on a child merely because the host has one would silently move a subscription run onto metered billing under a different identity. The child's environment is exactly the deployment's explicit entries, layered over the subprocess seam's credential-scrubbed parent environment — empty by default.

No `CODEX_HOME`, Codex profile, or config file is read, written, or synthesised on any code path. Per-run selection travels on the wire instead: the model and effort on `turn/start`, the sandbox on `thread/start`.

## Both per-run overrides are honoured

`modelOverride` and `reasoningEffort` are both true, because the pinned app-server schema has a field for each. A reasoning effort is passed to the product as the tier name the route carries. The schema types `ReasoningEffort` as a non-empty string rather than a closed enum — the accepted set is advertised per model through `Model.supportedReasoningEfforts` — so a tier the selected model does not advertise is rejected by the app-server and surfaces through the ordinary error taxonomy.

The route's permission mode fixes the sandbox: `read-only` and `workspace-write` map onto the `SandboxMode` values of the same names. The approval policy stays `never`, because a routed worker has no human to answer an approval request.

## Availability is distinguished from quality

`ExecutorFailure.availability` drives fallback routing, so it answers one question only: does the executor's reachability explain this failure? Quota exhaustion, session budget, server overload, internal server errors, and the four transport variants are availability failures — they change on their own or on a different executor. A context-window overflow, a bad request, a sandbox error, a non-steerable turn, a cyber-policy refusal, an unauthorized account, and a failed thread rollback are not: they are properties of the request, the workspace, or the account, and a fallback route would fail the same way. A completed run that did poor work is not a failure at all and never reaches this map.

Diagnostics are composed from parsed facts, never forwarded from the child, so no product prose, stderr, path, or protocol payload can reach a durable event log through this value.

## Usage

```ts
import { createExecutorRuntime } from '@trick-harness/executor'
import { createCodexProvider } from '@trick-harness/provider-codex'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

declare const spawn: (spec: SubprocessSpawnSpec) => import('@deepseek-ai/dsh-subprocess').SubprocessHandle
declare const controller: AbortController

const runtime = createExecutorRuntime()
runtime.register(createCodexProvider({ spawn }))
const result = await runtime.start({
  cwd: '/work/repo',
  task: 'implement the parser',
  route: {
    executor: 'codex',
    model: 'gpt-5.1-codex',
    reasoningEffort: 'high',
    permissionMode: 'workspace-write',
  },
  signal: controller.signal,
})
```

## Invariant companion

`./invariant` re-checks the declaration the executor runtime takes on trust: that this provider still claims both per-run overrides it emits on every routed turn, and that it declares no permission mode it cannot map to a `SandboxMode`. A mode it cannot map would be dispatched and then fail only after a process had already started.

## Known Limitations and Deferred Work

- **Effort is not validated against the selected model.** Rejecting a tier the model does not advertise before the run would need a `model/list` round trip on every dispatch. Today an unadvertised value fails at turn time through the existing taxonomy.
- **Termination is verified against a fake subprocess, not a real process tree.** The tests drive the real transport and prove the child is terminated on every path; proving OS-level quiescence belongs to the upstream package's own real-product tier.
- **No live smoke runs in unit CI.** Exercising a real Codex account consumes the user's plan quota, so the credentialed path is not covered here.
- **The task is a single text block.** File and subtask inputs the protocol accepts are not exposed, because the executor contract carries one task string.
- **Streaming is not surfaced.** The result is the final assistant message's text; intermediate items are not forwarded, which is what "bounded result, not the child transcript" requires.
- **`danger-full-access` is not routable.** It remains reachable only through the deployment-owned permission mode, so a route can tighten filesystem authority but never widen it.
