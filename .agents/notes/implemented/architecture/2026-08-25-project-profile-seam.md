# Agent Note: Project profile seam

Status: implemented

## Problem

The Trick Harness runtime has to serve Plurora today and a second project later, but almost every interesting decision the harness makes is a project decision: which executor and model tier a stage gets, how many repair cycles are worth attempting, what evidence a database change must produce, which integrations are enabled and against which repository and Supabase project. Written the obvious way, those decisions end up inside the packages that implement the mechanism, and the runtime silently acquires exactly one customer. The failure mode is not that reuse becomes hard — it is that reuse looks fine right up until the second project arrives and every constant turns out to be a Plurora constant.

The layout alone does not solve this. A `packages/core` directory next to a `profiles` directory is a suggestion; nothing in it stops a core module from importing a profile, and nothing makes the coupling visible in review once it exists.

## Decision

Policy is declarative data owned by a profile; mechanism is code owned by the generic packages; and the dependency between them is enforced, not merely documented.

`@trick-harness/profile` defines `HarnessProfile` — seven policy blocks, all mandatory even when empty — plus a registry that validates on registration and stores deep-frozen copies. Every policy block is a flat table of `{ id, when, use }` rows. A profile cannot ship a matcher function or a decision hook.

`scripts/check-trick-boundaries.ts` scans `packages/core`, `packages/providers`, and `packages/integrations` for two things: any import that resolves into `profiles/`, and any occurrence of six strong project identifiers (`adsonpatrick/neuro-via`, `neurovia-dev`, `uljaajwwnygopsyvwsre`, `Notion`, `Linear`, `Plurora Design System`). It is deliberately one-directional — profiles compose the generic layers freely. It runs as part of `pnpm run constraints`, so it is already in `hygiene` and in CI.

`profiles/fixtures/minimal` is a second, deliberately boring profile that exists only so a test can fail when the core stops being generic. `tests/trick-harness/dual-profile.spec.ts` holds both profiles in one registry, asserts they disagree on every policy block the contract permits, asserts they agree on `independencePolicy`, and runs the boundary scan across the whole repository.

Three sub-decisions are worth stating because they are the ones that would otherwise be quietly reversed:

Validation runs at registration, not at lookup, so a malformed policy table fails where it was introduced rather than surfacing inside a routing decision a reviewer would have to reconstruct backwards.

`independencePolicy` is pinned to exact required values at both the type level and the runtime level. A profile chooses its models, its evidence, and its integrations; it cannot lower the review floor for high-risk work. Otherwise "configurable" would come to include "configurably unreviewed".

The bare product name `Plurora` is not in the forbidden-identifier list. Provenance comments and tests legitimately mention it, and a rule that fired on them would be turned off within a week. The six listed identifiers only ever appear when policy has actually leaked downward; all six were verified absent from every existing package before the rule was enabled repo-wide.

## Alternatives considered

**Configuration file loaded at runtime instead of a typed contract.** A YAML or JSON profile would avoid the package entirely. Rejected: the contract's value is that a policy mistake fails at a boundary with a field-attributed error, and that the required review-independence values are unforgeable. A config file pushes both to runtime, where the failure surfaces as a wrong routing decision rather than a rejected profile.

**Profiles as plugins with executable hooks.** Far more expressive, and it would let a project express policy the flat tables cannot. Rejected because it inverts the thing the harness exists to do. The trusted workflow state machine is what enforces review; a profile that can supply code runs model-authored code on the path that decides how model-authored code gets reviewed. Expressiveness is a poor trade for that.

**Documented convention with no gate.** Cheapest option, and it is what the directory layout already implies. Rejected: an unenforced direction is one deadline away from being violated, and the violation is invisible in a diff that looks like a reasonable import.

**A single production profile, deferring the fixture until a real second project exists.** Rejected. The fixture is the only thing that makes R1 falsifiable today; deferring it means discovering the coupling at the moment it is most expensive to remove. Its tests assert it stays minimal precisely because a fixture that grows to resemble Plurora stops being evidence.

**Type-level enforcement of the boundary via project references alone.** TypeScript could forbid the import if the generic packages simply never referenced the profiles project. Rejected as insufficient rather than wrong: it catches the import but says nothing about a hard-coded project identifier, and a `tsconfig` reference added in passing silently removes the protection. The two rules belong in one gate that states what it is protecting.

## Consequences

Adding a project means writing a profile and registering it — no core edits. That is the property being bought, and `dual-profile.spec.ts` is what keeps it true.

Policy expressiveness is bounded by what the flat tables can say. When a project needs a decision the tables cannot express, the answer is to extend core's mechanism and add a policy field for it, not to let the profile supply code. That will feel like friction, and the friction is the design working.

Adding a genuinely reusable capability that happens to be named after a vendor — a real Notion or Linear integration package — will trip the identifier scan. That is intended: such a package belongs under `packages/integrations` named for the capability, with the account, workspace, and repository details living in the profile. If a future case makes the rule genuinely wrong rather than merely inconvenient, change the rule in the open and record why.

Five whole-repository files diverge from upstream to support this (`tsconfig.base.json`, `tsconfig.host.json`, `vitest.config.ts`, `package.json`, `scripts/translation-pairing.manifest.json`). Each is recorded in the divergence ledger in `docs/trick-harness/upstream.md`, and each is a merge-conflict surface on the next upstream sync.
