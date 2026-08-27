# Project profiles

A profile is one project's answers. The packages under `packages/core`, `packages/providers`, and `packages/integrations` implement how the harness works; a profile declares what this project has decided about routing, workflow bounds, review independence, QA evidence, security triggers, integrations, and trusted composition.

## The direction of the dependency

Profiles import the generic layers. The generic layers never import a profile, and never name a project-specific identifier. `scripts/check-trick-boundaries.ts` enforces both halves and runs as part of `pnpm run constraints`.

This is the whole reason the split exists. A core that reaches into a profile is a core with one customer, whatever the directory layout says.

## What lives here

- [plurora/](plurora/) — the first production profile.
- [fixtures/minimal/](fixtures/minimal/) — a second, deliberately minimal profile. It is test-only, and it exists so that reuse is something a test can fail on rather than something the layout merely suggests. See [tests/trick-harness/dual-profile.spec.ts](../tests/trick-harness/dual-profile.spec.ts).

## Adding a profile

Assemble a `HarnessProfile` from declarative policy modules and register it. All seven policy blocks must be present even when empty, and `independencePolicy` must match the contract's required values exactly — a profile can choose its models, its evidence, and its integrations, but it cannot lower the review floor for high-risk work.

Keep policy as data. A profile that ships a matcher function stops being reviewable as a diff, and puts model-authored code on the path that decides how model-authored code gets reviewed.
