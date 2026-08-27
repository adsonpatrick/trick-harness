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

## An objective is asked for; an execution is minted

`run` takes the objective a person asked for and mints its own id for this attempt at it. The two are not the same thing: an objective may be attempted again, and a second attempt sharing the first one's id would append its facts onto that history until no reader could say which run a verdict belonged to. `WorkflowOutcome` carries both, `restartOf` addresses the execution, and an id the Session already holds a run under is refused rather than merged. `workflowIdFactory` exists to make ids readable or ordered, never to reuse one.

## The whole Harness composes from one profile

`composeHarness` assembles the rest of it: routing policy, the durable journal, the workflow runner, the integrations and the loopback control server, from one `HarnessProfile` and the seams a deployment owns. The profile's routing table plus the deployment's model registry become the policy every route resolves against, so a semantic tier is answered in exactly one place.

`integrationPolicy.enabled` decides what exists. An integration configured but not enabled is refused rather than constructed and quietly never called, because a disagreement between two files is not something this package should resolve by guessing — and the shape of that guess going wrong is a project talking to a hosted database it believed it had turned off. The control server is enabled the same way, so a deployment that wants no HTTP surface gets no listener rather than a closed one.

What composition never supplies is a default for a seam a deployment owns: the session, the journal flush, the interpreter that reads a provider's output back into a verdict. There is no stand-in for any of them, because a stand-in would be this package guessing at a product's shape.

`dispose` unwinds in the order things were handed out, and it waits. The control server goes first, since it owns the runs it started and settles them before anything they are still writing to is taken away. Then the runs a caller started directly: each is canceled and awaited, because unregistering a provider under a run that is still dispatching would fail it with an unregistered-executor error rather than end it as canceled — a disposal that reported a crash instead of a cancellation would be lying about why the work stopped. Only then do the registrations and the runtime go.

## A run may be overridden once, and never the policy

`run(objective, signal, routeOverride)` takes one human routing choice: a role, an executor, a semantic tier, optionally a reasoning effort. It is spent on the first stage of that role and only once a route actually resolved with it, so an override the router refused changes nothing rather than being burnt on a stage nobody ran.

It is handed to the run and nowhere else. The profile's routing table is not edited, no provider is reconfigured, and nothing about it survives into the next run. An override that stayed in force would silently become policy for every later stage of that role — including repair cycles nobody asked about — which is how one person's situational call turns into a project's default. What the stage is allowed to do to the working tree is not part of it: permission mode follows the role, so no override buys a review a writable tree.

The control server accepts the same override on a start request and refuses a malformed one outright, before any workflow id exists. Falling back to the table there would leave a caller who asked for a specific executor with a status poll that never mentions their request was dropped.

## An outage reroutes; a wrong answer does not

A run keeps its own picture of its executors: a circuit per product, the set taken out of the pool entirely, and the starts rerouting has spent. A failure the provider categorised as availability moves the stage to another usable executor and records the move as a durable route fact carrying `fallbackFrom`. A quality failure does not move anywhere — asking a second product the same question and taking its answer would record a second opinion as a recovery.

Every reroute is a real start and is charged against the profile's start budget, so an outage cannot loop for free. Executors this runtime has no provider registered for are degraded from the start, for the same reason: a name with nothing behind it cannot serve a stage, and finding that out at dispatch turns a composition gap into a crash halfway through a run. When nothing usable is left the run blocks, and that block is the expected outcome of an outage with nowhere to go rather than a defect.

## Usage

```ts
import { composeHarness } from '@trick-harness/composition'
import { planPullRequestStages } from '@trick-harness/engineering-workflow'
import type { HarnessProfile } from '@trick-harness/profile'
import type { Session } from '@deepseek-ai/dsh-session'
import type { StageResult } from '@trick-harness/contracts'
import type { StageSpec } from '@trick-harness/engineering-workflow'
import type { ExecutorResult } from '@trick-harness/executor'

declare const profile: HarnessProfile
declare const session: Session
declare const interpret: (stage: StageSpec, executor: string, result: ExecutorResult) => StageResult

const harness = composeHarness({
  profile,
  registry: { implementation: 'mimo-v2.5', reasoning: 'deepseek-v4-flash' },
  session,
  flush: async () => true,
  workflow: {
    interpret,
    task: (stage, objective) => `${stage.role}: ${objective.requirement}`,
    plan: planPullRequestStages,
  },
})
// harness.server exists only if the profile enabled `control-server`.
await harness.dispose()
```

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
- **One session per composed Harness.** `composeHarness` journals every workflow into the session it was given, so `restartOf` reads whatever that session holds. Serving several unrelated projects means composing several Harnesses.
- **No Claude overlay ships here.** It composes through `extraProviders` like any other executor, and this fork registers none, so "optional" is the absence of a field rather than a flag that turns something off.

## The deterministic capabilities are composed, not wired to the journal yet

`composeHarness` builds the GitHub delivery and Supabase preview capabilities from the profile's own ids and options, and Plurora's composition test drives a real preview run through them to prove no local, linked or shared-database path is reachable from the composed object.

What it does not yet do is hand those capabilities the journal's checkpoint observers. `onRecord` and `onMutation` exist on both capabilities and are covered by their own tests; connecting them to the workflow journal so a confirmed mutation is durable before the next one is attempted belongs to the workflow-authority work, not here. Until then a composed run records its stages and its executors, and the hosted mutations inside a stage are recorded only in the capability's returned result.
