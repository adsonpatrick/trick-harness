# Trick Harness Upstream Provenance

Trick Harness is a real GitHub fork of [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness), not a re-implementation or a history-less copy. This file is the fork's provenance record and divergence ledger: it fixes the exact baseline the fork started from, states how the fork stays reachable from upstream, and states which kinds of change are allowed where.

## Repository identity

| Fact | Value |
| --- | --- |
| Fork | `adsonpatrick/trick-harness` |
| Upstream parent | `deepseek-ai/deepseek-harness` |
| Fork relationship | verified via `gh repo view --json isFork,parent` (`isFork=true`) |
| `origin` remote | `https://github.com/adsonpatrick/trick-harness` |
| `upstream` remote | `https://github.com/deepseek-ai/deepseek-harness.git` |
| Default branch | `master` |
| License | MIT, inherited unchanged from upstream |

## Recorded baseline

Captured 2026-08-25 after `git fetch upstream --tags`:

| Baseline | SHA |
| --- | --- |
| `TRICK_HARNESS_BASE_SHA` (`origin/master`) | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` |
| `DEEPSEEK_UPSTREAM_BASE_SHA` (`upstream/master`) | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` |
| `git merge-base HEAD upstream/master` | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` |

At the baseline the fork's `master` is byte-identical to `upstream/master`: the merge-base equals both tips, so the fork carries zero behavioral divergence at its starting point. Upstream release state at that SHA is DeepSeek Harness `0.1.1-rc.2` (tag `dsh-v0.1.1-rc.2`).

Record the SHAs that `git rev-parse` actually returns. Never substitute an older planning baseline when upstream has moved.

## License and attribution

The upstream MIT `LICENSE` and `THIRD_PARTY_NOTICES.md` are preserved verbatim. Fork-local packages are added under a distinct private scope and are never published, so no fork-local code is redistributed under upstream's release identity.

## Upstream sync procedure

```bash
git fetch upstream --tags
git rev-parse upstream/master
git merge-base HEAD upstream/master
git merge upstream/master        # or rebase fork-local commits, per the change
```

Upstream breaking changes are accepted risk. The fork must always keep a reachable `upstream` remote so ancestry stays verifiable and merges stay possible.

## Divergence ledger rule

Every change that touches a generic upstream package or upstream gate is recorded here with the reason and the extension seam that was considered and rejected. Prefer extension over core divergence: behavior belongs in fork-local packages, project profiles, bundles/plugins, executor providers, capability policies, and workflow definitions.

An edit to generic upstream core such as `packages/core/agent-loop` requires evidence that no documented extension point can express the requirement. "It was easier here" is not that evidence.

### Recorded divergences

| Date | Surface | Change | Why no seam sufficed |
| --- | --- | --- | --- |
| 2026-08-25 | `scripts/check-workspace-constraints.ts` | Accept fork-local `@trick-harness/*` packages as private, unpublished workspace members. | The gate hard-codes a closed release-member policy keyed on directory shape; there is no configuration seam, and every fork-local package would otherwise be rejected as a non-publishable release member. |
| 2026-08-25 | `tsconfig.base.json`, `tsconfig.host.json` | Register `@trick-harness/*` path mappings and host project references. | TypeScript path resolution and the host aggregate are whole-repository configuration with no per-package extension point. |
| 2026-08-25 | `scripts/translation-pairing.manifest.json` | Exclude fork-local `docs/trick-harness/`, `docs/superpowers/`, and fork-local Agent Notes from the bilingual pairing gate. | The gate's only documented seam is the exclusion manifest. Fork-local governance documents are not part of upstream's published bilingual corpus. |
| 2026-08-25 | `scripts/translation-pairing.manifest.json` | Extend the same exclusion to `packages/core/profile/README.md` and `profiles/`. | Same seam, same reason: these document private fork-local packages and project policy that are never published under the upstream scope. |
| 2026-08-25 | `package.json` | Run `scripts/check-trick-boundaries.ts` as part of the `constraints` script. | The boundary rule is fork-local and has no upstream counterpart; chaining it onto the existing gate name puts it in every path (`hygiene`, CI) that already runs `constraints`, rather than adding a gate upstream does not know about. |
| 2026-08-25 | `vitest.config.ts` | Add `profiles/*/tests/`, `profiles/fixtures/*/tests/`, and `tests/trick-harness/` to the test include globs. | The include list is whole-repository configuration; the fork adds two test tiers (project profiles, cross-profile reuse evidence) that live outside the `packages/*/*` shape upstream assumes. |
| 2026-08-25 | `docs/superpowers/*.md` | Reformat the three specification and plan header metadata blocks from trailing-two-space hard breaks to list items. | Formatting only, no content change. The `verify-md-wrap` gate reads a run of hard-broken lines as a wrapped prose paragraph and has no exclusion seam; a list expresses the same block without tripping it. |

## Fork-local layout

Generic mechanism, executor adapters, and external-system capabilities are fork-local packages; project policy is data under `profiles/`:

```text
packages/core/*            reusable orchestration/runtime capabilities
packages/providers/*       reusable executor adapters
packages/integrations/*    reusable external-system capabilities
profiles/<project>/        project-specific composition and policy
```

Dependency direction is one-way — `core` <- `providers`/`integrations` <- `profiles` <- project bridge — and is enforced mechanically by `scripts/check-trick-boundaries.ts`.
