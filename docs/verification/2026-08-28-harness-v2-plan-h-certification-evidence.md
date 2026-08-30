# Plan H evidence — GitHub certification gate for pull-request readiness

Recorded 2026-08-30 for the Trick Harness working tree at
`353697dca90ffa0802be8858da317a2395e29470`, branch
`feat/harness-v2-plan-h-github-certification`.

This file supersedes `docs/verification/2026-08-28-change-impact-risk-enforcement-evidence.md`
as the installation authority. The SHA in section 6 is the only initial runtime
revision a deployment may pin.

## 1. Deterministic gates

All run fresh on the recorded source. Every one exited 0.

| Gate | Result |
| --- | --- |
| `corepack pnpm run constraints` | pass — workspace constraints and `check-trick-boundaries` |
| `corepack pnpm run typecheck` | pass |
| `corepack pnpm run lint` | pass |
| `corepack pnpm run build` | pass |
| `corepack pnpm run test:trick` | pass — 102 files, 2494 tests |
| `corepack pnpm --filter @trick-harness/plurora-host test` | pass — 10 files, 186 tests |

## 2. Real authenticated certification canary

The endpoint, the identity re-reads and the read-back were exercised against
the real GitHub API using native `gh` authentication (account `adsonpatrick`,
token scopes `gist`, `read:org`, `repo`, `workflow`). No token was read,
constructed, injected or journalled by the harness at any point.

The canary ran against the Plan H implementation pull request,
<https://github.com/adsonpatrick/trick-harness/pull/10> (base `master`, head
`feat/harness-v2-plan-h-github-certification`), in the dedicated context
`trick-harness/plan-h-canary`, which no branch-protection rule requires, and in
the non-success state `error`.

That choice is deliberate and is the limit of what this section claims. It
proves the real endpoint, the real identity binding and the real read-back. It
does **not** claim this pull request passed Plurora's production certification
contract: the production context `plurora/harness-certification` was never
published to, and a `success` state was never published at all.

What `GitHubCertification.publish` returned:

```json
{
  "revision": "953e286ed495bf913c1c7025aec441953e82f292",
  "externalId": "53173557957",
  "context": "trick-harness/plan-h-canary",
  "url": "https://github.com/adsonpatrick/trick-harness/pull/10",
  "evidence": [
    { "kind": "gate", "locator": "trick-harness/plan-h-canary@953e286...", "summary": "certification published as error" },
    { "kind": "pr", "locator": "adsonpatrick/trick-harness#10", "summary": "pull request into master at the certified head" }
  ]
}
```

The canary script lived outside the repository and was removed after the run.
It is not a build artefact and nothing in the shipped source depends on it.

## 3. Independent re-read through GitHub

Read back separately from the capability, through
`gh api repos/adsonpatrick/trick-harness/commits/953e286ed495bf913c1c7025aec441953e82f292/statuses`:

```json
{
  "context": "trick-harness/plan-h-canary",
  "created_at": "2026-08-30T11:41:33Z",
  "description": "Harness engineering certification could not complete",
  "id": 53173557957,
  "state": "error",
  "target_url": "https://github.com/adsonpatrick/trick-harness/pull/10"
}
```

The SHA, the context, the state and the external id all match what the
capability reported. The description is the fixed string
`STATUS_DESCRIPTIONS.error` and nothing else. The combined status for the
commit read `{"state":"failure","total":2}`; the remaining entries belong to
CodeRabbit and are not this capability's.

## 4. Code and security review

Reviewed against the seven properties Plan H names. Findings below are the
review's conclusions, not restatements of intent.

**Endpoint construction.** `createStatusArgv`
(`packages/integrations/github-certification/src/commands.ts`) builds a fixed
argv array — `gh api --method POST -H "Accept: application/vnd.github+json"
repos/<owner>/statuses/<sha> -f state=… -f context=… -f description=… -f
target_url=…`. It is handed to the subprocess seam as an array and is never
shell-interpreted. Each field is validated before it is placed: the repository
and revision against their own assertions, the state against the closed
vocabulary, the context against `1..CERTIFICATION_CONTEXT_MAX` (100), the
description by strict equality with `STATUS_DESCRIPTIONS[state]` and against
`CERTIFICATION_DESCRIPTION_MAX` (120), and the target URL against a
pull-request URL of the repository being posted to (see the defect below).
There is no code path that composes a status field
from a prompt, a model summary, command output, a filesystem path or a
connection string.

**Repository and head binding.** `#target` re-reads five things before every
publication and caches none of them: the repository the checkout reports, the
branch it has out, the commit that branch is on, and the pull request's own
state, base ref, head ref and head SHA — the last read through the API by
repository and number rather than through the branch-relative view. It refuses
a foreign repository, a detached head, the base branch itself, a foreign base,
a missing or closed pull request, a head-branch mismatch, a head-SHA mismatch,
and a head that moved since the run established what it was certifying. Every
one of those refusals happens before the POST is constructed, so a refusal
issues zero mutations; the integration suite asserts exactly that.

**Status-state mapping.** `externalCertificationState` maps `canceled ||
operationalFailure` to `error`, `ready` to `success`, and everything else to
`failure`. `ready` is `certificationDecision(candidate).ready` — the existing
`PR_READY` predicate's answer about this run's own outcome, not a second
judgement assembled at publication time. No branch reaches `success` from a
`BLOCKED`, `INCONCLUSIVE` or canceled run, and the runner spec covers the
blocked case directly.

**Fixed safe descriptions.** The description is selected from the state alone
and cannot be supplied by a caller: `publish` passes
`STATUS_DESCRIPTIONS[state]`, and `createStatusArgv` refuses anything that is
not strictly equal to it. A run whose objective text contains a token, a `.env`
path or the checkout path publishes the same four fixed strings; that is
asserted, not assumed.

**Subprocess lifecycle.** `#run` awaits `handle.done` and then `#quiescent`,
which requires the owned process tree to be observed exited before the reading
is used — `gh` and `git` both start helpers, and a reading taken while one is
live is a reading of a workspace something else is still touching. The
cancellation signal is deliberately not passed to the teardown wait. No
environment is constructed for the child, so there is nothing for this package
to place a credential in. Failure messages name the operation and the exit code
and never the collected streams, because `gh` stderr can carry an
authentication URL and those messages reach a durable event.

**Durability ordering.** `#certify` writes `beginCapability` before the
capability may post, records `journal.certification` inside the still-open
window, and only then writes `endCapability`. A process that dies between the
POST and its own bookkeeping leaves an open window a restart can see. A journal
record the journal refuses is treated as a certification the run cannot account
for, and the run is lowered accordingly. `#answerPending` publishes the
terminal state on a fresh signal rather than the run's own, so a canceled run
still replaces the `pending` it left standing, and it clears its pending marker
first so exactly one terminal answer is published per run. Every publication
failure is fail-closed: a run that could not publish, or published against a
head it never read, ends `failed` / `INCONCLUSIVE` and never reports the branch
ready.

**Absence of merge authority.** `GitHubCertification` exposes `publish` and the
read-only `scope`. There is no commit, push, pull-request-edit, merge, release
or deploy method — absent, not disabled. The capability is composed separately
from `GitHubDelivery`, and the composition refuses in both directions: a
certifier a profile does not enable, and a profile requiring certification with
nothing composed to certify through. Merge, release and deploy remain
human-controlled.

**One confirmed defect, fixed.** The pull-request URL published as the status
target is read from `gh pr view`, which resolves whichever pull request the
current branch belongs to — and in a fork that is one in the *parent*
repository. It was validated for shape only: any well-formed
`https://github.com/<owner>/<repo>/pull/<n>` passed, including one naming a
repository this capability is not bound to. Every other reading could still
agree, so a status correctly posted to the bound repository's head could carry
a link sending a reviewer to a foreign pull request, under this deployment's
own context. Fixed in `fix(trick): bind the certified pull-request URL to its
repository`: `assertPullRequestUrl` compares the URL against the repository and
the number read beside it, and `createStatusArgv` independently requires the
URL to name a pull request of the repository the status is being posted to.
Three tests cover it — one at the argv seam and two at the capability's.

One residual is recorded rather than changed: when
the capability throws something that is not a `CertificationError` — a seam
failure, say — `#certify` returns `error.message` as the run's end summary. The
journalled certification summary is always the fixed `CERTIFICATION_SUMMARIES`
string, so no status field and no certification record is affected, and the
same pattern already governs delivery and was reviewed under Plan F. It is
noted here as an assumption open to correction, not as a Plan H regression.

## 5. Fixes

One: the target-URL repository binding described in section 4. Written
test-first — three failing tests, then the fix — and every deterministic gate
in section 1 was rerun on the result, all exiting 0, with `test:trick` moving
from 2491 to 2494 tests. Nothing else was changed.

The two test failures encountered while building the Task 7 matrix were
incorrect assertions in the new tests, corrected there; neither was a product
defect.

## 6. Head SHA

```text
353697dca90ffa0802be8858da317a2395e29470
```

Its parent is `f05546eee7` (`docs(trick): record Plan H certification
evidence`), and the source it fixes is `953e286ed4`, the revision sections 2
and 3 certified against real GitHub. Every gate in section 1 was rerun on the
source this commit records; the canary and the re-read were performed on its
grandparent, before the fix, and the fix narrows what may be published without
changing the path they exercised. The only thing added after the last of
them is documentation — this file, the README paragraph and the plan's
checkboxes — so no runtime, profile or test file differs between what was
gated and what is recorded here.

This SHA supersedes the post-Plan-G revision `195cbbcf080a3037340c885b6824852a3cff781a`
for initial NeuroVia installation.

## 7. What this evidence does not establish

- The production context `plurora/harness-certification` has never been
  published to from this harness against a real repository. The canary proves
  the path, not that context.
- No `success` state has been published against real GitHub by any run. The
  success path is proven only through the Plurora profile suite over a scripted
  subprocess seam.
- No branch-protection rule has been configured to require the production
  context. Until one is, a certification is a status a reviewer can read, not a
  gate that blocks a merge button.
- The Supabase preview path remains unproven for the reason recorded in the
  Plan D evidence.
