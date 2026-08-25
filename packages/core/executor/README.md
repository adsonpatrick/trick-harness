# @trick-harness/executor

The executor capability: a named provider registry, capability-checked dispatch, and ownership of runs in flight. One resolved request goes in, one bounded result comes out.

This is a fork-local package: private to `adsonpatrick/trick-harness`, never published. See [docs/trick-harness/upstream.md](../../../docs/trick-harness/upstream.md).

## Why this sits beside `SubagentRuntime` rather than extending it

Routing needs per-run model and reasoning-effort selection. Pushing those fields into upstream's generic `SubagentStartRequest` would make every subagent consumer carry Trick Harness routing concerns, and would widen the upstream merge surface every release. A parallel capability keeps the fork's divergence inside files the fork owns.

## What the runtime owns, and what a provider does not

The runtime decides which provider a route selects, whether that provider can honour the route, and how long a run lives. A provider translates one already-validated request into one product runtime. It does not decide policy, and by the time a route reaches it the model has already been resolved from whatever semantic tier a profile named.

**Capabilities are declared, not discovered.** An unsupported route fails before a process is spawned. A provider that silently ignored an unsupported model override would produce a run attributed to a model that never ran it — the durable route fact would be a lie, which is worse than a refusal.

**The provider sees a chained signal, not the caller's.** The runtime must be able to end a run the caller has no reason to cancel — disposal, budget exhaustion — so it owns the signal that reaches the provider. Aborting must terminate the owned process tree to quiescence, not merely return.

**Failures are structured and safe.** `ExecutorFailure` carries a category, an availability flag that drives fallback routing, and a redacted diagnostic. Raw stderr, environment, and credentials are not part of the public result: providers talk to products the user is authenticated against, and anything that escapes here reaches durable event logs and PR comments.

**Results are bounded.** `output` is the final result, never the child transcript.

## Usage

```ts
import { createExecutorRuntime } from '@trick-harness/executor'

const runtime = createExecutorRuntime()
runtime.register(opencodeProvider)
const result = await runtime.start({
  cwd: '/work/repo',
  task: 'implement the parser',
  route: { executor: 'opencode', model: 'resolved-model-id', permissionMode: 'workspace-write' },
  signal: controller.signal,
})
```

Inside a Cordis runtime the same registry is available as `ctx.executors` via the `ExecutorRuntime` service.

## Invariant companion

`./invariant` re-checks what registration cannot see afterwards: a descriptor mutated in place, a provider no longer reachable under its own registered name, and unknown permission modes. Either drift would let a durable route fact name something other than what ran.
