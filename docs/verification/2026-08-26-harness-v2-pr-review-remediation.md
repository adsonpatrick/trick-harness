# Harness V2 PR-review remediation — verification evidence

Recorded 2026-08-27 against the correction branch below. This file states what was run, what it produced, and which finding each result closes. It records no secrets, connection strings, database URLs, JWT secrets or provider auth material, and none of the runs below reached a real credentialed service.

## Execution provenance

| Item | Value |
| --- | --- |
| Correction branch | `fix/harness-v2-pr-review-remediation` |
| Branch base | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (merge-base with `master`) |
| Branch head | `49368eb5072758096d05a6ac531fea1588928d2b` |
| Reviewed PR #2 base/head | not retrievable: pull requests are disabled on this fork's remote, so `gh pr view 2` returns `Pull requests are disabled for this repository`. The reviewed state is the branch base above. |
| Supabase parent project ref used for canary | none — see [Canaries not run](#canaries-not-run) |
| GitHub canary branch/PR identity | none — see [Canaries not run](#canaries-not-run) |

### Child-plan commits on the correction branch

| SHA | Subject |
| --- | --- |
| `f8bcc82ac4` | fix(profile): enforce scalar policy boundaries |
| `76fde854fc` | fix(boundaries): parse imports with typescript ast |
| `7f5b22b588` | fix(executor): await quiescent runtime disposal |
| `b028cc2016` | fix(providers): surface teardown failures safely |
| `afd4881a58` | fix(plurora): require per-pr supabase preview branch |
| `da1eb62bed` | fix(plurora): align harness routing policy |
| `ed0bf5f212` | fix(trick): normalize executor failure categories |
| `8908a66445` | fix(trick): fall back only to a usable executor |
| `36a7d17d36` | fix(trick): route live availability failures through fallback |
| `f413fd9fa0` | feat(trick): plumb single-run routing override |
| `2f71c7534c` | test(trick): prove live Plurora routing remediation |
| `ea0489e2f8` | fix(trick): separate workflow run and objective identity |
| `718be4de98` | fix(trick): key control workflows by generated run id |
| `e573d098a0` | fix(trick): persist stage start before executor dispatch |
| `06ec7e2241` | feat(trick): journal deterministic capability lifecycle |
| `729f73d4a6` | fix(trick): require world check after interrupted mutation |
| `75b852d114` | test(trick): prove durable run identity and restart safety |
| `5de9c17e42` | fix(plurora): align integration capability policy |
| `2551c9e864` | fix(trick): await GitHub delivery process-tree quiescence |
| `3ce4b5a68a` | feat(trick): checkpoint verified delivery mutations |
| `6b8cbcb418` | fix(trick): await Supabase preview process-tree quiescence |
| `977e438129` | fix(trick): fail fast through Supabase preview gates |
| `907b463e92` | feat(trick): checkpoint Supabase preview mutations |
| `efbf0c44c5` | test(trick): prove deterministic integration safety |
| `d25549689d` | fix(trick): bind workflow objective to composed profile |
| `1040aad4cf` | fix(trick): route delivery through deterministic capability |
| `408d949b7a` | fix(trick): gate database work on Supabase preview |
| `3894ac804f` | fix(trick): require policy authorization for security repair |
| `a2c2f5b55d` | fix(trick): make default lifecycle PR centric |
| `49368eb507` | test(trick): prove workflow authority remediation |

## Affected package suites

```text
pnpm vitest run packages/core/profile packages/core/executor packages/core/routing \
  packages/core/journal packages/core/control-server packages/core/engineering-workflow \
  packages/providers/opencode packages/providers/codex \
  packages/integrations/github-delivery packages/integrations/supabase-preview \
  packages/composition/runtime profiles/plurora
```

Result: **24 test files passed, 682 tests passed, 0 failed.**

## Repository gates

| Gate | Command | Result |
| --- | --- | --- |
| Workspace constraints and fork boundaries | `pnpm run constraints` | PASS |
| Typecheck | `pnpm run typecheck` | PASS |
| Lint | `pnpm run lint` | PASS |
| Build | `pnpm run build` | PASS |
| Fork test target | `pnpm run test:trick` | PASS — 85 files, 1948 tests |
| Package invariants | `pnpm run verify-package-invariants` | PASS — 239 companions conform |
| Documentation gates | `pnpm run doc-sync` | PASS — 28 gates, 0 failed |
| Markdown wrapping | `pnpm run verify-md-wrap` | PASS — 2033 files |
| Persistence catalog | `pnpm run verify-persistence-catalog` | PASS — catalog and generated event types up to date |
| Translation pairing | `pnpm run verify-translation-pairing` | PASS — 1003 pairs consistent |

No Harness-owned package failed, and no gate was classified as external: every gate above completed on this branch without a rerun.

## Closure table

| ID | Finding | Evidence | Result | SHA |
| --- | --- | --- | --- | --- |
| P1-01 | Plurora primary routing | `profiles/plurora/tests/routing.spec.ts` — *the binding heavy-work invariant* (broad implementation, large write surface, approved refactor, high-volume test repair, long repair sequence, QA execution volume, human override); `profiles/plurora/tests/composition.spec.ts` — *routes to exactly the two executors this fork ships* | PASS | `da1eb62bed`, `2f71c7534c` |
| P1-02 | Executor quiescent disposal | `packages/core/executor/tests/executor.spec.ts` — *aborts in-flight runs on disposal*, *keeps a run counted until the provider settles after its own teardown*, *waits for a provider that ignores the abort entirely*, *still reaches quiescence when the provider settles by throwing* | PASS | `7f5b22b588` |
| P1-03 | Teardown failure observability | `packages/core/executor/tests/executor.spec.ts` — *refuses to call a settled disposal clean when teardown failed*, *builds a durable fact from the error class name and nothing else* | PASS | `b028cc2016` |
| P1-04 | Flat-scalar profile validation | `packages/core/profile/tests/profile.spec.ts` — *policy is flat scalar data and nothing else* (object, array, null, undefined, NaN, positive and negative Infinity, function, bigint, symbol, in both `when` and `use`, plus *names the exact entry path of the offending when value*) | PASS | `f8bcc82ac4` |
| P1-05 | Supabase Preview policy | `profiles/plurora/tests/profile.spec.ts` — *supabase preview policy names no standing execution target*, *requires a preview branch whose identity is the pull request in flight* | PASS | `afd4881a58` |
| P1-06 | Boundary import analysis | `scripts/check-trick-boundaries.spec.ts` (TypeScript AST parsing of imports, adversarial fixtures); gate `pnpm run constraints` | PASS | `76fde854fc` |
| R2-01 | Heavy fallback invariant | `profiles/plurora/tests/profile.spec.ts` — *moves heavy implementation onto Codex when OpenCode is the degraded one*, *stops rather than inventing a route when neither executor is usable*; `profiles/plurora/tests/composition.spec.ts` — *sends heavy work to Codex when OpenCode is out, and says so durably*, *blocks heavy work rather than inventing a route when neither product is usable* | PASS | `8908a66445`, `2f71c7534c` |
| R2-02 | Live circuit/fallback | `packages/core/routing/tests/availability.spec.ts` — *treats quota, rate, capacity and transient infra as availability*; `packages/core/engineering-workflow/tests/workflow.spec.ts` — *does not ask a second product the same question after a wrong answer*; `profiles/plurora/tests/composition.spec.ts` — *moves a Codex judgement stage to OpenCode reasoning when Codex runs out of quota* | PASS | `ed0bf5f212`, `36a7d17d36` |
| R2-03 | Capability authority wiring | `profiles/plurora/tests/composition.spec.ts` — *publishes only through the capability, and asks no model to do it*, *verifies a schema change on an isolated preview, and asks no model to reach a database*; `packages/composition/runtime/tests/harness.spec.ts` — *publishing from a composed deployment*, *a composed run that changes a database* | PASS | `1040aad4cf`, `408d949b7a`, `49368eb507` |
| R2-04 | Capability id mismatch | `profiles/plurora/tests/composition.spec.ts` — *composes both deterministic capabilities and the control server from the real profile* | PASS | `5de9c17e42` |
| R2-05 | Pre-mutation durability | `packages/core/journal/tests/journal.spec.ts` — *what the journal refuses to lose*; the stage-start-before-dispatch tests in `packages/core/engineering-workflow`; `packages/integrations/supabase-preview/tests/preview.spec.ts` — *records each hosted change only once the world has confirmed it*, *does not record migrations the branch was never read back as holding* | PASS | `e573d098a0`, `06ec7e2241`, `907b463e92` |
| R2-06 | Workflow id reuse | `packages/core/journal/tests/journal.spec.ts` — *two attempts at one objective > keeps each attempt to its own projection*; `profiles/plurora/tests/composition.spec.ts` — *spends a human override on one stage and carries none into the next run*, which asserts a distinct workflow id for the same objective id | PASS | `ea0489e2f8`, `718be4de98` |
| R2-07 | Security repair gate | `packages/core/engineering-workflow/tests/repair.spec.ts` — *who is allowed to repair a security defect* (no rule written, no diagnosis, narrow allow on `packages/fixture/security-safe/**`, one directory outside it, decides on the boundary alone); `packages/core/engineering-workflow/tests/workflow.spec.ts` — *stops rather than repairing a security defect outside the boundaries the policy names*; `profiles/plurora/tests/composition.spec.ts` — *starts no repair for a security defect, because this profile authorizes none*; `packages/core/profile/tests/profile.spec.ts` — the malformed-rule matrix | PASS | `3894ac804f` |
| R2-08 | Default PR lifecycle | `packages/core/engineering-workflow/tests/lifecycle.spec.ts` — *publishes before it certifies at low/medium/high/critical risk*, *buys QA from medium upwards and security only at critical*, *re-delivers the branch after each repair, so the next review reads the fix*, *verifies once more after the last repair, with a fresh run of its own*, *reaches PR READY with an improvement outstanding and never repairs it*; `profiles/plurora/tests/composition.spec.ts` — *repairs an ordinary defect, republishes it, and reads it again before it closes*, *adds a security reading at critical risk and still closes on a fresh verification* | PASS | `a2c2f5b55d`, `49368eb507` |
| R2-09 | Manual override plumbing | `packages/core/control-server/tests/server.spec.ts` — *hands the override to the starter alongside the objective*, *starts nothing at all when the override is malformed*, *runs on the profile table when no override is sent*; `profiles/plurora/tests/composition.spec.ts` — *spends a human override on one stage and carries none into the next run* | PASS | `f413fd9fa0` |
| R2-10 | Integration quiescence | the process-tree quiescence tests in `packages/integrations/github-delivery`; `packages/integrations/supabase-preview/tests/preview.spec.ts` — *keeps a failed teardown out of the run result*, *keeps a branch that would not go away apart from the gates*, *does not let a clean teardown redeem a failed gate* | PASS | `2551c9e864`, `6b8cbcb418`, `efbf0c44c5` |
| R2-11 | Supabase fail-fast gates | `packages/integrations/supabase-preview/tests/preview.spec.ts` — *creates a branch, waits for it, applies migrations, reads them back, lints and cleans up*, *asks nothing of a branch whose migrations did not apply*, *never migrates a branch that reports the parent as its own ref*, *does not run the project suite against a branch that failed lint*, *plans no gate it was never going to run* | PASS | `977e438129` |
| R2-12 | Profile identity binding | `packages/composition/runtime/tests/harness.spec.ts` — the objective/profile mismatch preflight: no run id minted, no journal write, no executor start | PASS | `d25549689d` |

## Canaries not run

Task 8 of the master plan requires a real `GitHubDelivery` canary against a disposable branch and a real Supabase Preview canary against a parent project. Neither was run: this environment holds no credentials for either service, and the security constraints governing this program forbid extracting or reusing subscription credentials to obtain them.

Both capabilities are exercised end to end against scripted subprocess seams — every command the real path constructs is issued and answered, and the argv is asserted (*refuses to push main even when the workspace really is on main*, *constructs a push that names its own branch and carries no force flag*, *refuses a push that anyone widened with a force flag*). That proves the command construction and the control flow. It does not prove the remote's behaviour, and this file does not claim it does.

Until both canaries run and pass with real credentials, the master plan's exit condition is unmet, and Plan C / NeuroVia stays blocked.
