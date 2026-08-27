# @trick-harness/composition

The composition root. It turns configuration into a populated executor runtime, and does nothing else: the runtime owns dispatch, each provider owns one product, and a profile owns which executor a route may name.

This is a fork-local package: private to `adsonpatrick/trick-harness`, never published. See [docs/trick-harness/upstream.md](../../../docs/trick-harness/upstream.md).

## Loading starts no product process

A provider is a description of how to start a product, not a started product. Composition constructs providers and registers them; the first process appears on the first dispatch. The tests prove this the only way worth proving it — by handing the real providers product seams that throw if they are ever called, and then loading the composition.

That is what makes load cheap enough to happen at startup, and it is what keeps a misconfigured deployment from burning a run to discover it.

## Every executor is optional

Each provider is one optional field. Configuring none is a valid composition: a runtime with nothing registered. Configuring an executor this package has never heard of is also valid, through `extraProviders` — anything satisfying the provider contract composes on equal terms with the two named ones and dispatches identically.

So which executors a deployment runs is a configuration choice, not a code change. The Claude Code executor is left out of this fork on exactly that basis: nothing here names it, and adding it later is a provider package plus one field, not an edit to this one.

## It refuses a composition that cannot serve its policy

Given a profile, every executor its routing table names — fallback rows included — must be registered, or composition throws. A fallback route is dispatched precisely when something has already gone wrong, which is the worst moment to discover its executor was never registered.

The check reads the profile as data. No project policy lives here; the boundary gate enforces that.

## Failure leaves nothing behind

Registration is all-or-nothing. A provider the runtime rejects, or a profile the composition cannot serve, takes every registration that call made back out, and a runtime the caller already owned is left exactly as it was. A half-composed runtime that dispatches some routes and fails others is a worse outcome than not loading.

Disposal is symmetric: a composition removes exactly what it registered, and a bundle that owns its runtime also ends the runs in flight.

## Usage

```ts
import { createHarnessRuntimeBundle } from '@trick-harness/composition'
import { createSdkAdapter } from '@trick-harness/provider-opencode'
import type { SubprocessSpawnSpec, SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { HarnessProfile } from '@trick-harness/profile'

declare const spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
declare const profile: HarnessProfile

const bundle = createHarnessRuntimeBundle({
  opencode: { adapter: createSdkAdapter() },
  codex: { spawn },
  profile,
})
// bundle.executors -> ['opencode', 'codex']; no product process has started.
```

Use `composeHarnessRuntime(runtime, options)` instead to add providers to a runtime someone else owns, such as the `ctx.executors` service on a live context.

## Invariant companion

`./invariant` re-checks composition against the live runtime rather than against the options a bundle was built from: a profile registered later, or a provider removed by a scope unload, changes the answer without any call into this package. It reports any registered profile whose routing rule names an executor that is not registered.

## Known Limitations and Deferred Work

- **Coverage is checked by name only.** A profile row naming a registered executor passes even when it also states a model or effort that executor cannot honour. Whether an advisory field is dropped or refused is the router's decision, and routing is not part of this plan.
- **No Cordis plugin form.** Composition is a plain function because a provider needs a spawn seam and an SDK adapter, neither of which a validated declarative config can carry. A deployment wires it from its own startup path.
- **Ordering is fixed.** OpenCode, then Codex, then the extras as given. Registration order is the order `list()` reports; nothing routes by it today.
- **No live smoke.** Loading is proven not to start a process; that a real product then starts correctly is each provider package's own concern.
