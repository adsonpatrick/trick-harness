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
| 2026-08-25 | `scripts/trick-fork.ts` (new), `scripts/release/families.ts`, `scripts/publish-npm-baseline.ts`, `scripts/check-workspace-constraints.ts` | Skip fork-local packages in the release-family and publication scanners, from one shared definition. | Both scanners glob `packages/*/*` and then require every manifest to name an `@deepseek-ai` package; fork-local packages share that hierarchy and belong to no release family. Putting the rule in a new fork-owned module keeps the edit to one guard per scanner instead of restating the namespace in each. |
| 2026-08-25 | `scripts/verify-package-paths.ts` | Exclude `docs/superpowers/` from the broken-reference scan. | The gate documents its own intent as catching drift in a moved real package, explicitly not "not-yet-existing packages named in a proposal". Specs and plans name packages a later task creates, and the gate has no exclusion seam. |
| 2026-08-25 | `scripts/gen-cordis-catalog.ts` | Add `executors`/`profiles` to `SERVICE_PAGE` and the six fork-local service types to `TYPE_LINK_EXEMPTIONS`. | The catalog is fail-closed both ways: a discovered service absent from the partition is a hard error, so a new service cannot be added without an entry. Both seams are the gate's documented extension points. |
| 2026-08-25 | `scripts/gen-doc-graphs.ts` | Add `executors`/`profiles` to `SERVICE_ROLES`. | Same fail-closed design: `assertServiceRolesComplete` rejects any discovered service without a role classification. |
| 2026-08-25 | `scripts/verify-package-readme-model-experience.ts` | Record both fork-local packages in `NO_MODEL_EXPERIENCE_SECTION`. | Neither package has a model-facing surface, and the gate's documented way to say so is this audit map rather than an omitted section. |
| 2026-08-25 | `scripts/translation-pairing.manifest.json` | Extend the same exclusion to `packages/core/executor/README.md` and the executor capability Agent Note. | Same seam, same reason: the executor capability is a private fork-local package, and its Agent Note records fork-only architecture that upstream never publishes bilingually. |
| 2026-08-25 | `scripts/verify-package-readme-model-experience.ts` | Record `packages/providers/opencode` in `NO_MODEL_EXPERIENCE_SECTION`. | The provider hands one task string to a product that owns every model-facing surface; the gate's documented way to state that is this audit map. |
| 2026-08-25 | `scripts/translation-pairing.manifest.json` | Extend the same exclusion to `packages/providers/opencode/README.md` and the OpenCode provider Agent Note. | Same seam, same reason: a private fork-local package whose Agent Note records fork-only architecture that upstream never publishes bilingually. |
| 2026-08-25 | `scripts/gen-third-party-notices.ts` | Add an `OVERRIDES` entry for `@opencode-ai/sdk`. | The published manifest declares MIT but no repository field, which is exactly the case the override map exists for; the npm page is the verifiable origin. |
| 2026-08-25 | `scripts/verify-package-paths.ts` | Add a lookbehind to `PKG_REF` so a `packages/...` token preceded by a path character is not probed. | Bug fix, not a fork exemption. The regex matched inside external GitHub URLs; adding a fork-local package named `opencode` made an existing upstream Agent Note's link to `github.com/anomalyco/opencode/blob/.../packages/opencode/...` read as local drift. Another repository's layout cannot be drift in this one. |
| 2026-08-25 | `tsconfig.base.json`, `tsconfig.host.json` | Register `@trick-harness/provider-opencode` paths and the project reference. | Both files are the whole-repository project graph; a fork-local package is invisible to `tsc -b` without an entry, and there is no per-package seam to use instead. |
| 2026-08-25 | `package.json` | Run `scripts/check-trick-boundaries.ts` as part of the `constraints` script. | The boundary rule is fork-local and has no upstream counterpart; chaining it onto the existing gate name puts it in every path (`hygiene`, CI) that already runs `constraints`, rather than adding a gate upstream does not know about. |
| 2026-08-25 | `vitest.config.ts` | Add `profiles/*/tests/`, `profiles/fixtures/*/tests/`, and `tests/trick-harness/` to the test include globs. | The include list is whole-repository configuration; the fork adds two test tiers (project profiles, cross-profile reuse evidence) that live outside the `packages/*/*` shape upstream assumes. |
| 2026-08-25 | `packages/subagent/subagent-codex` | Split `startCodexRun` into a plain `startCodexTask` transport that accepts optional schema-verified `model`/`effort` on `turn/start`, keeping `startCodexRun` as a routing-free adapter. | The package's only entry point takes a `SubagentStartRequest`, which a routed worker has no delegating parent Session to construct, and `CodexRunSpec` cannot express a per-run model or effort because the shared subagent capability surface carries none. Widening `SubagentStartRequest` would change a generic contract shared by every provider; rebuilding the client fork-locally would duplicate the sixteen-variant error taxonomy, the permission diagnostics, and the process-tree disposal guarantees. The change is additive and behaviour-preserving — see the Agent Note. |
| 2026-08-25 | `scripts/translation-pairing.manifest.json` | Exclude the Codex scoped-transport Agent Note. | Same seam, same reason: a fork-local Agent Note recording fork-only architecture that upstream never publishes bilingually. |
| 2026-08-25 | `packages/subagent/subagent-codex` | Add an optional `sandbox` to the routing seam, emitted on `thread/start`, restricted by type to `read-only` and `workspace-write`. | None of the three deployment permission modes expresses an unattended run with an explicit sandbox: `never` sends no sandbox at all, `approve-for-me` needs a human to answer approvals, and the bypass mode is full access. `ThreadStartParams.sandbox` is a `SandboxMode` whose enum matches the executor contract's two modes exactly. `danger-full-access` stays unroutable — enforced at runtime against `CODEX_ROUTED_SANDBOXES`, not by the type alone, because the exported transport is a boundary a JavaScript caller or a parsed configuration value can cross. Against the `never` permission mode, which emits no sandbox and defers to the user's own Codex configuration, a routed `workspace-write` grants authority rather than narrowing it; that is the intended contract and is written down at the emission site. |
| 2026-08-25 | `packages/subagent/subagent-codex` | Add `parseCodexDiagnostic` beside the existing `failureDiagnostic` writer, and widen the package's `index` re-exports to carry the scoped transport surface. | `SubagentResult.diagnostic` is a string, so a consumer would otherwise pattern-match prose it does not own to tell quota exhaustion from a rejected request. Widening the generic `SubagentResult` contract shared by every subagent provider was the alternative. Placing the reader beside the writer gives the format one owner and a round-trip test; the re-export widening is required because the build emits only the `index` and `invariant` entries, so no subpath is available. |
| 2026-08-25 | `scripts/translation-pairing.manifest.json` | Exclude `packages/providers/codex/README.md` and the Codex executor Agent Note. | Same seam, same reason: fork-local documents that upstream never publishes bilingually. |
| 2026-08-25 | `scripts/verify-package-readme-model-experience.ts` | Record `packages/providers/codex` in `NO_MODEL_EXPERIENCE_SECTION`. | The provider hands one task string to a product that owns every model-facing surface; the gate's documented way to state that is this audit map. |
| 2026-08-25 | `tsconfig.base.json`, `tsconfig.host.json` | Register `@trick-harness/provider-codex` paths and the project reference. | Both files are the whole-repository project graph; a fork-local package is invisible to `tsc -b` without an entry, and there is no per-package seam to use instead. |
| 2026-08-25 | `scripts/check-trick-boundaries.ts` | Scan `packages/composition` alongside the other generic package roots. | The fork adds a composition layer above `providers`; without an entry it would be the one generic layer free to import project policy, which is exactly the drift the gate exists to catch. |
| 2026-08-25 | `scripts/translation-pairing.manifest.json` | Exclude `packages/composition/runtime/README.md` and the composition-root Agent Note. | Same seam, same reason: fork-local documents that upstream never publishes bilingually. |
| 2026-08-25 | `scripts/verify-package-readme-model-experience.ts` | Record `packages/composition/runtime` in `NO_MODEL_EXPERIENCE_SECTION`. | The package registers providers and starts nothing; every model-facing surface belongs to a product reached only through a later dispatch. |
| 2026-08-25 | `tsconfig.base.json`, `tsconfig.host.json` | Register `@trick-harness/composition` paths and the project reference. | Both files are the whole-repository project graph; a fork-local package is invisible to `tsc -b` without an entry, and there is no per-package seam to use instead. |
| 2026-08-25 | `docs/superpowers/*.md` | Reformat the three specification and plan header metadata blocks from trailing-two-space hard breaks to list items. | Formatting only, no content change. The `verify-md-wrap` gate reads a run of hard-broken lines as a wrapped prose paragraph and has no exclusion seam; a list expresses the same block without tripping it. |

## Fork-local layout

Generic mechanism, executor adapters, and external-system capabilities are fork-local packages; project policy is data under `profiles/`:

```text
packages/core/*            reusable orchestration/runtime capabilities
packages/providers/*       reusable executor adapters
packages/integrations/*    reusable external-system capabilities
packages/composition/*     reusable composition roots that register providers
profiles/<project>/        project-specific composition and policy
```

Dependency direction is one-way — `core` <- `providers`/`integrations` <- `composition` <- `profiles` <- project bridge — and is enforced mechanically by `scripts/check-trick-boundaries.ts`.
