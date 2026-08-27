# Agent Note: Harness composition root

Status: implemented

## Problem

Three fork-local pieces existed with nothing holding them together: an executor runtime that dispatches routes, two providers that each drive one product, and a profile that says which executor a route may name. Something had to construct the providers, register them, and be answerable for the combination — and it had to do so without starting a product process, because load happens at startup and a run costs plan quota.

Where that code lives is the whole question. The runtime cannot import providers: it is the generic mechanism they implement. A provider cannot import its siblings. A profile is declarative data by construction and executes nothing. So the composition root is a fourth thing, and the only real decision is which layer it belongs to.

## Decision

A new package group, `packages/composition/`, holding `@trick-harness/composition`. It sits above `providers` and below `profiles`, and `scripts/check-trick-boundaries.ts` now scans it alongside the other generic roots, so it may compose core and providers but may not reach project policy.

The plan named `packages/core/bundle`. That was wrong and was not followed: `core` importing `providers` inverts the documented one-way arrow, and the gate at the time would not have caught it, because it only forbade reaching into `profiles/`. That gap is now closed: `check-trick-boundaries.ts` also enforces the arrow *between* the generic groups, reading each fork-local package's group from its own `package.json` so the rule stays a statement about direction rather than an inventory that has to be edited for every new package. Placing a package in the right group was a judgement made once, at review time; the gate is what keeps it true afterwards. The upstream group `packages/bundle/` was also rejected — it already holds app bundles (`base`, `headless`, `web-app`), a different concept, and folding a Trick composition root into it would have put the fork's layering inside an upstream group.

The package exposes two entry points and one reader. `createHarnessRuntimeBundle(options)` creates a runtime and composes onto it; `composeHarnessRuntime(runtime, options)` composes onto a runtime someone else owns, which is how a live Cordis `ctx.executors` gets populated. `routedExecutors(profile)` reads the executor names a routing table can produce.

Every provider is an optional field, including all of them at once. An empty composition is valid, and `extraProviders` accepts anything satisfying the provider contract, so an executor this package has never heard of composes and dispatches on equal terms with the two named ones. That is what makes "which executors this deployment runs" a configuration choice instead of a code change — and it is the basis on which the Claude Code executor is left out of this fork entirely: nothing here names it, and adding it later is a provider package plus one field.

Given a profile, composition fails unless every executor its routing table names is registered — fallback rows included, because a fallback is dispatched exactly when something has already gone wrong, and that is the worst moment to discover its executor was never registered. Registration is all-or-nothing: any failure takes back every registration that call made, and a caller's pre-existing providers are untouched.

The invariant companion re-checks the same property against the live runtime rather than against the options a bundle was built from, since a profile registered later or a provider removed by a scope unload changes the answer with no call into this package.

## Alternatives considered

**Put it in `packages/core/bundle`, as the plan said.** Inverts the layer arrow for the sake of following a path written before the boundary rule was enforced. The plan's file list is indicative; the layering is a stated invariant.

**Reuse the upstream `packages/bundle/` group.** Same word, different concept, and it would have widened the boundary gate's scan over upstream packages that never asked for it.

**No package at all — let each deployment wire providers itself.** Every deployment then re-derives all-or-nothing registration and profile coverage, and gets them subtly differently. The composition rules are the part worth having exactly once.

**A Cordis plugin with a validated `Config`.** A provider needs a spawn seam and an SDK adapter. Neither survives a declarative config, and faking it would have meant the package reaching for globals to reconstruct what the caller already had.

**Check profile coverage lazily, at dispatch.** A missing executor is a deployment mistake. Finding it at the first route means finding it halfway through someone's work, in a run that has already cost quota.

**Ignore `fallbackRules` when computing coverage.** It would have let a composition load while being unable to serve its own outage path.

## Consequences

Twenty-one tests cover the package and five more cover the Plurora composition from the profile side, where a project-specific claim belongs. The load-time tests are the load-bearing ones: they hand the two real providers product seams that throw if called, then load the composition and assert nothing threw and no run is in flight. That is the only way "starts no product process" stays true as providers change.

Adding `packages/composition` to the boundary gate means this layer can never quietly acquire a project dependency, and the layer table means no generic package can acquire a dependency on a layer above it either — `core` importing `@trick-harness/composition` now fails the gate rather than passing review on attention alone. The reuse-evidence suite already fails on the first class of drift and now covers one more root.

Coverage is checked by name only. A profile row naming a registered executor passes even when it also states a model or effort that executor cannot honour — whether an advisory field is dropped or refused is the router's decision, and routing is not part of this plan.
