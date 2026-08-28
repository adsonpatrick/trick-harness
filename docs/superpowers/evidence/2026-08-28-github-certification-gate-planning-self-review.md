# Plan H — GitHub Harness Certification Gate Planning Self-Review

**Date:** 2026-08-28

**Scope:** planning-only review of:

- `docs/superpowers/specs/2026-08-28-harness-v2-github-certification-gate-amendment.md`
- `docs/superpowers/plans/2026-08-28-trick-harness-github-certification-gate.md`
- `docs/superpowers/plans/2026-08-28-neurovia-github-certification-wiring.md`

No runtime implementation, live status mutation or branch-protection change is claimed by this document.

## Methods used

- Superpowers `writing-plans`: dependency-ordered TDD tasks, explicit file surfaces, completion contracts and self-review.
- Codex Engineering Guardrails `code-work`: authority-boundary analysis, side-effect/restart safety, fresh-world verification and narrow integration design.
- Current Trick Harness source: workflow, GitHubDelivery, journal, composition/profile boundaries.
- Current NeuroVia source: `scripts/git/setup-branch-protection.sh` and existing required contexts.
- Current GitHub documentation (2026-08): commit-status states/API, protected-branch required status behavior, latest-head requirement, and source-binding options.

## GitHub API decisions verified

Current GitHub documentation confirms:

1. commit statuses support exactly `error`, `failure`, `pending`, `success`;
2. statuses may include context, description and target URL;
3. users/integrations with sufficient repository status/write authority can create commit statuses;
4. protected branches can require commit statuses or checks;
5. required status must pass on the latest commit SHA; prior-SHA success does not satisfy a new head;
6. source-specific required-check binding is available when using a GitHub App/app id, which is intentionally deferred for the current single-owner repository.

Plan H therefore selects Commit Status for initial V2 activation and documents the future GitHub-App trigger instead of introducing a new credential/app lifecycle prematurely.

## Source-grounding findings Plan H closes

1. NeuroVia branch protection currently requires only `validate`, `design-system`, `e2e`, `build`.
2. Plan F/G can make `PR_READY` materially stronger, but without a required GitHub status that verdict remains advisory to merge.
3. `github-delivery` already demonstrates the correct narrow-authority pattern: native `gh` auth, argv arrays, bounded output, whole-process-tree quiescence and no merge authority.
4. Certification has a different authority from delivery and therefore receives a separate package/port rather than adding status mutation to the delivery class.
5. External status is itself a side effect, so durable-before-mutate/restart reconciliation remains required.

## Acceptance-criteria coverage

| Criterion | Plan owner |
| --- | --- |
| HC1 fixed context | Harness Task 6; NeuroVia Tasks 1–3 |
| HC2 separate narrow capability | Harness Tasks 1–2, 6 |
| HC3 re-read repository/PR/head before POST | Harness Task 2 |
| HC4 pending after delivery/redelivery | Harness Task 3 |
| HC5 success only from PR_READY same revision | Harness Task 4 |
| HC6 all non-ready/error states never success | Harness Tasks 4, 7 |
| HC7 stale/new SHA invalidates | Harness Tasks 2, 4, 7; NeuroVia Task 5 |
| HC8 missing capability fail-closed | Harness Tasks 3, 6, 7 |
| HC9 durable/restart-safe certification | Harness Task 5 |
| HC10 native gh auth/no token | Harness Tasks 2, 8; NeuroVia Task 6 |
| HC11 branch protection adds fifth context | NeuroVia Task 3 |
| HC12 bootstrap only after real status + fresh-SHA proof | NeuroVia Tasks 4–5 |
| HC13 bounded status content | Harness Tasks 2, 5, 7 |
| HC14 source-auth limitation documented | Spec + NeuroVia Task 6 |
| HC15 independent adversarial/E2E verification | Harness Tasks 7–8; NeuroVia Tasks 5–6 |

No HC criterion is ownerless.

## Authority review

### Harness core

Core owns only generic certification state/port and deterministic readiness-to-external-state sequencing. It contains no repository name, branch-protection mutation or GitHub endpoint.

### GitHub certification integration

`@trick-harness/github-certification` may read repository/branch/PR/head facts and POST/read a status for the verified SHA. Its public API contains no commit, push, PR edit, merge, release or deploy operation.

### Plurora host

The host binds:

```text
projectRepository = adsonpatrick/neuro-via
baseBranch = main
context = plurora/harness-certification
```

Only project repository is non-secret deployment metadata; context/base branch are trusted Plurora composition constants rather than per-run/model config.

### NeuroVia

NeuroVia alone owns its branch-protection script. Harness does not mutate protection rules. The human/operator applies reviewed protection only after a real certification status exists.

## Bootstrap-loop review

A naive evidence workflow can create an infinite freshness loop:

```text
certify SHA A
-> commit evidence -> SHA B
-> certify B
-> commit evidence -> SHA C
...
```

The wiring plan explicitly avoids this:

1. a pre-protection status proves the context exists;
2. a committed evidence update intentionally creates a fresh uncertified SHA used to prove blocking;
3. security/docs/fixes are all committed and pushed before final certification;
4. final certification occurs on the final immutable head;
5. no repository commit is made after that certification unless a defect forces a new fix-and-recertify cycle;
6. Plan D receives the final status as live GitHub evidence rather than attempting to commit a self-invalidating final-status snapshot.

## State-mapping review

External GitHub state is deliberately separate from internal workflow verdict:

```text
running -> pending
PR_READY -> success
terminal non-ready -> failure
canceled/interrupted/operational failure -> error
```

The integration does not infer `PR_READY`; the post-Plan-F/G deterministic workflow predicate does. A model cannot directly request success.

## Path/type consistency

Current paths verified or intentionally future-dependent:

- `packages/core/engineering-workflow/src/{index,types,lifecycle}.ts`
- `packages/core/engineering-workflow/tests/{workflow,lifecycle,repair,restart}.spec.ts`
- `packages/core/journal/src/{index,types,invariant}.ts`
- `packages/core/journal/tests/journal.spec.ts`
- `packages/core/control-server/tests/server.spec.ts`
- `packages/composition/runtime/src/harness.ts`
- `profiles/plurora/integrations.ts`
- `packages/integrations/github-delivery/src/index.ts` as the subprocess/authority pattern
- post-Plan-E `apps/plurora-harness-host/...`
- NeuroVia `scripts/git/setup-branch-protection.sh`

Plan H's post-E/F/G dependencies are explicit in the header; execution starts by reconciling the actual reviewed post-Plan-G tree.

## Placeholder scan

Both executable plans were scanned for:

```text
TODO
TBD
if needed
```

No matches remained.

## Residual risks

1. **Status-source attribution:** native-user Commit Status is not a dedicated-app attestation. This is acceptable only under the current trusted single-owner repository model. Adding an independent writer triggers GitHub-App/source-bound migration.
2. **External availability:** GitHub/`gh` outage can leave the status pending/absent/error. That is intentionally fail-closed and may delay merge.
3. **Status limit:** GitHub limits statuses per SHA/context; normal Harness workflow volume is far below that boundary. A runaway retry bug must still be caught by workflow/executor budgets and tests.
4. **Post-Plan-G signature drift:** if Plan F/G refactors final readiness names, Plan H must be reconciled to that reviewed tree rather than implementing a duplicate readiness predicate.
5. **Release lifecycle remains separate:** a successful status certifies engineering readiness for human merge only; Release Readiness, deployment and post-deploy verification remain future SDLC work.

## Planning verdict

**READY FOR IMPLEMENTATION AFTER PLANS E + F + G.**

Plan H closes the identified GitHub merge-boundary gap without broadening delivery authority, preserves latest-SHA freshness, provides fail-closed external state, and includes a bootstrap sequence that proves the required check before final V2 activation.
