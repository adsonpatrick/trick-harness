# Plan G — Change Impact / Risk Planning Self-Review

**Date:** 2026-08-28

**Scope:** planning-only review of:

- `docs/superpowers/specs/2026-08-28-harness-v2-change-impact-risk-policy-enforcement-amendment.md`
- `docs/superpowers/plans/2026-08-28-trick-harness-change-impact-risk-policy-enforcement.md`

No runtime implementation or test completion is claimed by this document.

## Methods used

- Superpowers `writing-plans`: task decomposition, exact paths, TDD sequencing, explicit completion contract.
- Codex Engineering Guardrails `code-work`: repository-aware contract mapping, risky-boundary analysis, incremental verification requirements.
- Context7 Picomatch documentation: confirmed matcher-function API, globstar support, `dot` behavior and Windows separator options. Plan G normalizes paths to POSIX form itself and uses `{ dot: true, windows: false }`.
- Current npm metadata was checked only to avoid selecting a just-published matcher version. Plan pins `picomatch@4.0.5` and `@types/picomatch@4.0.3`.
- Current `trick-harness` and `neuro-via` trees were inspected for real paths and current workflow/profile contracts.

## Source-grounding findings that Plan G addresses

1. `WorkflowObjective.risk` currently enters the runtime as an already-resolved input.
2. `planPullRequestStages()` currently uses risk to select QA/Security.
3. `profiles/plurora/qa-policy.ts` and `security-policy.ts` declare surface rules, but those rules are not yet the authority that selects lifecycle stages.
4. `RoutingContext` supports `taskClass`, `writeVolume` and `requiredCapabilities`, while the current runner leaves `requiredCapabilities` empty, does not hydrate `taskClass` from change evidence, and derives mutating write volume mainly from role.
5. DB verification currently has an explicit caller declaration seam; Plan G makes trusted classified database mutation an additional non-disableable requirement.
6. NeuroVia contains concrete classifier anchors used by the initial Plurora policy, including `supabase/migrations/**`, `supabase/tests/**`, `scripts/db/**`, `src/lib/auth/**`, `src/features/auth/**`, `src/features/admin-auth/**`, `src/proxy.ts`, `.github/**`, dependency manifests and broad UI surfaces.

## Spec coverage matrix

| Criterion | Plan owner |
| --- | --- |
| CI1 planned impact before mutation | Tasks 4, 6, 11 |
| CI2 actual published impact after delivery/repair | Tasks 5, 6, 9, 11 |
| CI3 monotonic effective risk | Tasks 2, 6, 9 |
| CI4 cumulative normalized Picomatch classification | Tasks 1–3 |
| CI5 sensitive surface cannot bypass QA/Security | Tasks 3, 6, 11 |
| CI6 policy rows drive stage planning | Task 6 |
| CI7 routing facts hydrated from impact | Task 7 |
| CI8 MiMo hard invariant preserved | Tasks 7, 11 |
| CI9 classified DB mutation forces verifier | Tasks 3, 8, 11 |
| CI10 evidence-profile IDs reach certification | Tasks 3, 8, 10 |
| CI11 unplanned paths remain evidence | Tasks 2, 9, 10, 11 |
| CI12 repair/redelivery recomputes impact | Tasks 6, 9, 11 |
| CI13 bounded durable impact evidence | Task 10 |
| CI14 generic packages stay NeuroVia-free | Tasks 2, 3, 5, 11 |
| CI15 adversarial coverage | Tasks 2, 3, 5–11 |

No acceptance criterion is ownerless.

## Boundary decisions checked

- **Core vs profile:** generic classifier mechanics live in `packages/core/change-impact`; path/risk/evidence rules live in `profiles/plurora`.
- **Core vs deployment:** actual Git reading lives in `apps/plurora-harness-host`, not generic Core.
- **Plan vs model:** planned paths come from the exact approved Plan bytes; models do not author the obligation/write-set list at runtime.
- **Risk:** classifier output can raise but never lower objective/planned/previous actual risk.
- **Policy accumulation:** change-impact, QA and Security matching accumulate across all relevant surfaces; routing remains first-match-wins.
- **Repair:** redelivery invalidates the previous actual-impact reading and forces recomputation before certification.
- **Database:** classifier-detected mutation can require verification even when caller metadata omitted it; no classifier path can turn a required DB check off.
- **Conformance:** Plan G exposes scope drift and evidence requirements but leaves Plan/implementation completeness verdicts to Plan F.

## Path/type consistency review

Confirmed current paths used by the plan include:

- `packages/core/profile/tests/profile.spec.ts`
- `packages/core/engineering-workflow/src/{index,lifecycle,repair,types}.ts`
- `packages/core/engineering-workflow/tests/{workflow,lifecycle,repair}.spec.ts`
- `packages/core/journal/`
- `packages/core/control-server/tests/server.spec.ts`
- `packages/composition/runtime/src/harness.ts`
- `profiles/plurora/{profile,qa-policy,security-policy,routing-policy}.ts`

Plan-F/Plan-E paths (`conformance.ts`, `apps/plurora-harness-host/...`) are intentionally future dependencies and the Plan G header explicitly requires E/F completion before execution.

## Placeholder scan

Scanned the Plan G document for:

```text
TODO
TBD
if needed
```

No matches remained.

## Residual planning risks

1. Exact implementation details of Plan F may rename a conformance seam before Plan G starts. Execution must begin by reconciling the reviewed post-Plan-F tree; path/signature drift is a Plan update, not an excuse to guess.
2. The initial Plurora UI classifier is intentionally broad (`src/features/**`, `src/app/**`, `src/shell/**`) and may over-classify some nonvisual feature code as UI/medium. This is safe-side classification; later policy tuning must be evidence-driven and may not weaken a sensitive overlapping surface.
3. Path classification intentionally does not attempt semantic SQL/source analysis. `rls`/tenant-isolation intent may additionally come from approved objective/task metadata, while DB migrations already receive the critical DB floor.
4. Plan H remains a separate required control to make the resulting Harness certification a real GitHub merge check.

## Planning verdict

**READY FOR IMPLEMENTATION AFTER PLAN E + PLAN F.**

The plan is dependency-ordered, maps CI1–CI15, preserves reusable-core boundaries, closes the identified policy-declared-but-not-enforced gaps, and carries explicit adversarial tests for under-classification, DB bypass, repair escalation, scope drift and large-write routing.
