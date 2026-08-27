# Harness V2 PR-review remediation — verification evidence

Recorded 2026-08-27 against the correction branch below. This file states what was run, what it produced, and which finding each result closes. It records no secrets, connection strings, database URLs, JWT secrets or provider auth material, and none of the runs below reached a real credentialed service.

## Execution provenance

| Item | Value |
| --- | --- |
| Correction branch | `fix/harness-v2-pr-review-remediation` |
| Branch base | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (merge-base with `master`) |
| Branch head | `49368eb5072758096d05a6ac531fea1588928d2b` |
| Reviewed PR #2 base/head | `docs/harness-v2-bootstrap` / `feat/harness-v2-routing-workflows` at `b0d2f308f8849c6ffaff3bc6f713b1bb923c56b4` |
| Supabase parent project ref used for canary | `uljaajwwnygopsyvwsre` — reached, and refused branching by entitlement; see [Canaries](#canaries) |
| GitHub canary branch/PR identity | `canary/github-delivery-20260827`, pull request #3, closed unmerged and deleted — see [Canaries](#canaries) |

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
| Fork test target | `pnpm run test:trick` | PASS — 85 files, 1951 tests |
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

## Independent final review — Task 9, 2026-08-27

The review read the branch as a whole rather than the checkboxes: `b0d2f308f8849c6ffaff3bc6f713b1bb923c56b4`, the head of the reviewed pull request, is an ancestor of this branch's head, and the diff between them is 56 commits over 85 files, +9970/-655. Every claim below was checked against code or an executed test, never against a plan entry that said it was done.

The certification chain was rerun end to end on the reviewed tree — constraints, typecheck, lint, build, `test:trick` — and exited 0 with 85 test files and 1951 tests passing.

What the review confirmed, each against the named source:

- Profile identity binds before anything observable happens: `packages/composition/runtime/src/harness.ts:410` calls `assertObjectiveProfile` before the workflow id is minted (411), before the journal is constructed (412), and before delivery is bound (413).
- No profile grants a model executor a generic shell or exec capability; deterministic mutation reaches the world only through `GitHubDelivery` and `SupabasePreview`.
- `gh pr merge`, `gh release` and `gh workflow` are refused, and `git -c key=value` cannot be used to step over the subcommand check in `assertAllowed`.
- The Supabase guard refuses `--local` and `--linked` as boolean flags with no value form to slip through, and `#must` never carries command output into an error message, so no connection string can reach an exception.
- Repair is bounded at three cycles and twenty-four executor starts in `profiles/plurora/workflow-policy.ts:20-21`.
- The journal carries no transcript and no chain of thought: the record types hold `reasoningEffort` and observable results, nothing else.
- A claimed PASS over a confirmed material defect is refused at `packages/core/engineering-workflow/src/triage.ts:156`, and `stateOf` in `lifecycle.ts:119-120` downgrades a PASS with open defects to PARTIAL before it can ever read as PR READY.
- The 85 changed TypeScript files contain no test escape hatches — no skipped, focused or conditionally disabled specs.

One defect was found, and it was real. `DENIED_PUSH_ARGS` was compared against the whole argument, so the guard stopped `--force-with-lease` and allowed `--force-with-lease=refs/heads/master`, `--force-if-includes=x` and `--force=x`, which are the forms anyone would actually write; and `git push origin :refs/heads/master`, a refspec that deletes a remote branch while carrying no flag at all, passed as well. All four were confirmed as allowed against `assertAllowed` before the fix rather than reasoned about. The comparison now takes the flag name before `=`, a refspec with an empty source half is refused on its own terms, three regression tests cover the value forms, the deleting refspec and the push the capability really constructs, and the package suite passes at 48 tests.

| ID | Finding | Evidence | Result | SHA |
| --- | --- | --- | --- | --- |
| T9-01 | Force-push guard matched whole arguments, allowing the value forms and a deleting refspec | `packages/integrations/github-delivery/tests/commands.spec.ts` — *refuses the value forms of the force flags, which are the ones anyone would actually write*, *refuses a refspec that deletes the remote branch without saying delete*, *still allows the push this capability actually constructs* | CLOSED | `518b921622` |

**Verdict: PARTIAL.** Every finding in the closure table above holds against code and executed tests, the whole certification chain passes on this tree, and the one defect this review found is closed with regression cover. It is not a PASS because the master plan's exit condition requires the Supabase Preview positive canary against the real remote, and that canary is deliberately deferred for want of the Pro entitlement, as the section above records. The verdict is PARTIAL for exactly that reason and for no other: nothing material is open in the code.

## Canaries

Task 8 of the master plan requires a real `GitHubDelivery` canary against a disposable branch and a real Supabase Preview canary against a parent project. The GitHub canary ran and passed. The Supabase canary has not run.

### GitHub delivery canary — PASS

Run on 2026-08-27 against `github.com/adsonpatrick/trick-harness` through the real `GitHubDelivery` class, with a subprocess seam over `node:child_process` and no scripted answers: every `git` and `gh` command below was really executed against the real remote. A disposable branch `canary/github-delivery-20260827` was cut from the correction branch and carried a single harmless fixture file.

| Step | Command the capability constructed | Result |
| --- | --- | --- |
| Branch validation | `git rev-parse --abbrev-ref HEAD` | on the disposable branch, not protected |
| Stage | `git add -- <one fixture path>`, `git -c core.quotePath=false diff --cached --name-only` | exactly the requested path staged |
| Commit | `git commit -m <message>`, then `git rev-parse --verify HEAD` | `c48b1c433ef5cd4f8a150d96d447da015fe006f9` |
| Push | `git push -u origin refs/heads/canary/github-delivery-20260827:refs/heads/canary/github-delivery-20260827` | no force flag, own branch only |
| Push confirmation | `git rev-parse --verify refs/remotes/origin/canary/github-delivery-20260827` | equal to the commit, so the push is confirmed rather than assumed |
| Open pull request | `gh pr create --head … --base fix/harness-v2-pr-review-remediation …`, then `gh pr view … --json number,url,state,headRefName` | pull request #3, `created: true` |
| Re-delivery | second `deliver()` on the same branch | `gh pr edit 3 …`, `created: false`, action `pr-update` — one pull request, not a second |

The identities were then re-read independently of the capability, through the REST API rather than through the local repository: `repos/adsonpatrick/trick-harness/git/ref/heads/canary/github-delivery-20260827` returned the same object SHA as local `HEAD`, and `pulls/3` returned `head` `canary/github-delivery-20260827`, `base` `fix/harness-v2-pr-review-remediation`, `merged: false`.

No merge, no release, no deploy and no force-push occurred, and no command targeted a protected branch. Cleanup: pull request #3 was closed unmerged and its branch deleted on both sides; `git ls-remote --heads origin` returns no `canary` ref, and the fixture file exists nowhere on the correction branch.

One earlier attempt failed and is recorded because it is a real property of the capability: with `base` set to a branch that had never been pushed, `gh pr create` exited non-zero and `deliver()` returned `delivered: false` with the `commit` and `push` records already checkpointed and no `pr-open` record. It did not report success for a delivery that had not completed, and it did not unmake the commit and push that had.

### Supabase preview canary — BLOCKED, and blocked correctly

Run on 2026-08-27 against parent project `uljaajwwnygopsyvwsre` (`neurovia-dev`) through the real `SupabasePreview` class over a real subprocess seam. The positive path could not be exercised, and the reason is an entitlement rather than a defect: the owning organisation is on the free plan, and Supabase answers `supabase branches create` with HTTP 402, `entitlement_required`, `Branching is supported only on the Pro plan or above`. No preview branch was ever provisioned, so no migration, lint or test gate could run.

What the run does prove is the fail-closed behaviour the Global Constraints require, observed against the real API rather than a script:

| Property required | Observed |
| --- | --- |
| A database-changing run blocks when no preview is available | `status: "BLOCKED"` — not `FAILED`, which would have described the repository's migrations, and not `PASSED` |
| Dependent gates stop after the failed prerequisite | `completedGates: []`, `skippedGates: ["identity","health","migration-push","migration-list","lint"]` |
| No fallback to a shared or local database | the only command issued was `supabase branches create <name> --project-ref <parent> --experimental`; no `db push`, no `--db-url`, no local stack, no `neurovia-dev` connection |
| Nothing is checkpointed for a mutation that did not happen | `mutations: []` |
| Failures expose safe diagnostics, not raw environment | `primaryFailure.message` is `creating the preview branch failed with exit code 1`; it carries no connection string, token, account identity or upgrade URL |
| The parent is untouched | migration history re-read before and after: 82 migrations, byte-identical lists |

One environment artefact is recorded so it is not mistaken for the result. A first attempt reported exit code 127 because the Windows `supabase` npm shim is a shell script that `CreateProcess` cannot execute; the seam was pointed at the real executable and the run then reported the CLI's true exit code of 1. Only the seam's resolution of `argv[0]` changed — the argv the capability constructs was not touched.

One side effect on the parent is recorded because it is real. Before the run the project had no branches at all. The `branches create` attempt initialised branching on the project, which left a default branch named `main` whose `project_ref` equals the parent's own ref and whose `is_default` is true. It is not a preview, it provisions no second database, and it applied nothing; but the project's state did change from "branching uninitialised" to "branching initialised", and this file says so rather than reporting the parent as wholly unchanged.

The positive canary — preview created, `preview ref != parent ref`, healthy, harmless migration applied, migration history verified, remote lint, project gate, cleanup — remains unrun. It needs the organisation on the Pro plan. Substituting MCP calls or unit tests for it is refused under Task 8 Step 4.

#### The project owner's decision, 2026-08-27

The owner decided not to buy the Pro plan for this canary, and to keep the capability ready for the day the plan changes. The decision is recorded here so a later reader finds a choice rather than an omission.

What "ready" is worth, stated precisely, so the readiness is not read as more than it is:

- The positive path is covered end to end against scripted seams — *creates a branch, waits for it, applies migrations, reads them back, lints and cleans up* — along with the project suite reading its connection from the environment rather than from an argv.
- The refusals that keep the parent safe are covered: no `--local`, no `--linked`, no command that starts a local stack, no migration of a branch reporting the parent's own ref, no connection string in any evidence or record.
- The fail-closed path is now confirmed against the real Supabase API rather than a script, as the table above records.
- What is not proven is the real remote's behaviour on the positive path: that a real preview provisions, reports a ref that is not the parent's, becomes healthy inside the timeout, and accepts a migration. Only a Pro-plan run proves that, and nothing in this file claims it.

When the organisation moves to Pro, the canary is one command: the run needs no code change, only the entitlement.

Until the Supabase canary runs and passes on its positive path, the master plan's exit condition is unmet, and Plan C / NeuroVia stays blocked.
