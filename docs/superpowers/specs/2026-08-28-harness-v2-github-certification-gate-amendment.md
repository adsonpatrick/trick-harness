# Harness V2 GitHub Certification Gate Amendment

**Status:** Approved design direction from the 2026-08-28 end-to-end SDLC audit; this amendment is the normative source for Plan H.

## Problem

Harness V2 can determine that a published implementation is `PR_READY`, and Plan F/Plan G strengthen what that statement means, but GitHub branch protection does not currently require that fact. `neuro-via/scripts/git/setup-branch-protection.sh` requires `validate`, `design-system`, `e2e` and `build`; a human with merge authority could therefore merge a CI-green PR even when Harness Review, applicable QA/Security, Conformance or final verification did not certify the current PR head.

A certification that is not attached to the exact GitHub commit being merged is advisory. Plan H turns the Harness result into a deterministic external merge gate while preserving the existing authority boundary: Harness may certify a commit, but it may not merge, release or deploy it.

## Binding decisions

### 1. Fixed status context

The Plurora GitHub certification context is exactly:

```text
plurora/harness-certification
```

The NeuroVia deployment does not accept this value from a model, workflow request, repository document or per-run override. The runnable Plurora host owns the constant.

### 2. Use GitHub Commit Status for V2 activation

The first production-capable implementation uses the GitHub Commit Status API, not a new GitHub Checks application.

Current GitHub behavior supports `pending`, `success`, `failure` and `error` commit statuses, and protected branches may require commit statuses before merge. Required statuses apply to the latest commit SHA; a status on an older SHA does not satisfy the new head.

This choice preserves native `gh` authentication and avoids introducing a new GitHub App/private-key lifecycle during initial Plurora activation.

A later GitHub App migration is an allowed hardening path, not part of Plan H.

### 3. Separate certification authority from delivery authority

Create a separate integration package:

```text
@trick-harness/github-certification
```

It may only:

```text
read current git branch/HEAD
read configured GitHub repository identity
read the current branch PR identity/state/head/base
POST a commit status for the exact verified PR head SHA
read that SHA's commit statuses to verify publication
```

It may not:

```text
stage files
commit
push
force push
edit PR title/body
open/close/merge PRs
create releases
modify branches or branch protection
deploy
choose an arbitrary status context in the Plurora host
```

`github-delivery` remains the only automated feature-branch delivery authority.

### 4. Certification target is the exact published PR HEAD

Before every status mutation, the integration re-reads all of:

```text
configured repository
current local branch
current local HEAD
current branch PR
PR state
PR base branch
PR head branch
PR head SHA
```

A status may be published only when:

```text
repository == configured project repository
PR.state == OPEN
PR.base == main
PR.head.branch == local branch
PR.head.sha == local HEAD
expectedRevision is absent or expectedRevision == PR.head.sha
```

Any mismatch is fail-closed. No status is posted to a guessed or stale SHA.

### 5. Pending is published after every delivery/redelivery

Immediately after a successful delivery creates or updates the PR, before any certifying stage is allowed to establish readiness, Harness publishes:

```text
state = pending
context = plurora/harness-certification
sha = current PR head SHA
```

Every repair that changes the published branch must redeliver and publish a new `pending` status for the new SHA before Review/QA/Security/Conformance resumes.

A rerun against the same SHA also publishes `pending`, replacing a previous success as the latest status for that context while the new certification run is active.

### 6. Success is equivalent to PR_READY for that SHA

`success` may be published only when the same workflow run has established all mandatory facts for the same published revision:

```text
required implementation verification passed
code review passed
applicable QA passed
applicable Security passed
approved Spec identity still matches
approved Plan identity still matches
Conformance verdict = PASS
verify-final verdict = PASS
no confirmed material finding remains
latest actual Change Impact has been reconciled
latest certified revision == current PR head SHA
```

The status publisher does not decide these facts. It receives a deterministic certification decision from the workflow runtime.

A model output can never directly request `success`.

### 7. Terminal state mapping is fail-closed

Use the following external state mapping:

```text
certification running                         -> pending
PR_READY                                      -> success
terminal product/policy non-readiness         -> failure
canceled/interrupted/runtime/integration error -> error
```

`FAIL`, `PARTIAL`, `BLOCKED` and terminal `INCONCLUSIVE` cannot map to success.

If certification publication itself is unavailable, the workflow cannot become `PR_READY` for Plurora. The GitHub status remains absent/pending/error and branch protection continues blocking merge.

### 8. Status content is fixed and bounded

Status publication contains only:

```text
state
fixed context
fixed description selected from state
target_url = verified PR URL
```

Descriptions are exactly:

```text
pending -> Harness engineering certification in progress
success -> Harness engineering certification passed
failure -> Harness engineering certification did not pass
error   -> Harness engineering certification could not complete
```

No token, prompt, transcript, model/workflow summary, raw command output, model reasoning, DB URL, local filesystem path or secret is copied into GitHub status fields.

### 9. Native gh authentication only

The integration executes fixed argv-array `git`/`gh` commands through the managed subprocess seam.

It does not read, copy or inject GitHub tokens. Authentication remains the existing native `gh auth` state.

### 10. Durable-before-external-mutation remains binding

Before POSTing a commit status, the workflow records and flushes the capability-start/intention necessary for restart reconciliation.

After GitHub confirms publication, Harness records a bounded certification fact containing:

```text
revision
external PR id
state
context
deterministic summary/evidence locator
```

If a process dies after the POST but before the post-publication record is durable, restart sees an open capability and must re-read GitHub before retrying. It must not blindly publish a contradictory status from stale local state.

### 11. Required branch protection is activated only after a real status exists

Do not add `plurora/harness-certification` to branch protection before the installation PR has received a real Harness-produced status.

Activation order:

```text
install/wire Harness on NeuroVia feature PR
-> certify exact installation PR head
-> verify GitHub reports plurora/harness-certification=success on that SHA
-> add context to main branch protection
-> re-read protection and verify strict=true + all required contexts
-> push a planned evidence/docs commit (new SHA)
-> observe certification absent/pending for new SHA and merge blocked
-> commit every remaining project change
-> run final certification on final immutable head
-> verify success on that exact SHA
```

This avoids permanently blocking the repository with a required context that has never been produced and avoids an infinite certify/commit/evidence loop.

### 12. Existing CI checks remain required

The protected `main` branch keeps all existing required checks:

```text
validate
design-system
e2e
build
```

and adds:

```text
plurora/harness-certification
```

`strict=true`, `enforce_admins=true`, required PR flow, conversation resolution, linear history, force-push denial and deletion denial remain unchanged.

Plan H does not replace CI with Harness certification; they are independent gates.

### 13. Latest-SHA semantics are part of the safety model

A new push creates a new PR head SHA. A successful certification on SHA A must never satisfy SHA B.

The integration also carries its own `expectedRevision` guard so a force/mutation/race detected between pending and terminal publication cannot post success to a different revision.

### 14. Current source-authentication threat model

GitHub commit statuses can be created by repository actors/integrations with sufficient write/status permission. In the current single-owner NeuroVia repository, that actor is inside the same trusted human authority boundary that can already change branch protection.

If the repository gains another independent writer whose credentials must not be able to impersonate Harness certification, migrate the publisher to a dedicated GitHub App and bind the required check to that App (`checks`/`app_id`) before relying on multi-writer source attribution.

This limitation must be documented; it is not silently represented as cryptographic attestation.

### 15. Human merge remains mandatory

Harness may publish certification status. It still has no merge/release/deploy authority.

A `success` status means only:

> this exact published revision satisfied the Plurora engineering certification contract.

A human remains responsible for merge, and later Release Readiness/production workflows remain separate work.

## Target architecture

```text
Trick Harness workflow
      |
      | after delivery/redelivery
      v
CertificationCapabilityPort
      |
      v
@trick-harness/github-certification
      |
      | native gh auth
      | GET PR/head
      | POST status to exact SHA
      v
GitHub PR HEAD
      |
      +-- validate
      +-- design-system
      +-- e2e
      +-- build
      +-- plurora/harness-certification
      |
      v
branch protection
      |
      v
human merge only
```

## Acceptance criteria

**HC1.** Plurora uses exactly `plurora/harness-certification`; no per-run/model/config override can change the context.

**HC2.** Certification is a separate deterministic capability/integration and has no commit/push/PR-edit/merge/release/deploy methods.

**HC3.** Before every status POST, repository, branch, local HEAD, PR state/base/head and PR head SHA are re-read and validated.

**HC4.** A successful delivery/redelivery publishes `pending` for the exact current PR head before certification continues.

**HC5.** `success` is reachable only from the deterministic post-Plan-F/G `PR_READY` decision for the same revision.

**HC6.** `FAIL`, `PARTIAL`, `BLOCKED`, terminal `INCONCLUSIVE`, cancellation and runtime/integration failures never publish success.

**HC7.** A changed PR head invalidates prior success both through GitHub latest-SHA semantics and the capability's `expectedRevision` guard.

**HC8.** Missing/unavailable certification capability prevents Plurora from becoming `PR_READY`.

**HC9.** Certification status mutation follows durable-before-mutate/restart reconciliation and records bounded external evidence.

**HC10.** GitHub authentication remains native to `gh`; no token is read/injected/journalled by Harness.

**HC11.** NeuroVia branch protection requires the four existing CI contexts plus `plurora/harness-certification`, with all existing protection invariants preserved.

**HC12.** Branch-protection activation happens only after a real status exists and includes a fresh-SHA invalidation/final-recertification proof.

**HC13.** GitHub status description is fixed by state and cannot contain prompts, summaries, reasoning, raw stderr/stdout, filesystem paths, DB URLs or credentials.

**HC14.** The current single-writer status-source limitation and future GitHub-App hardening trigger are documented.

**HC15.** Independent verification proves pending, success, failure/error, stale-SHA refusal, missing-capability fail-closed, new-push invalidation and unchanged human-only merge authority.

## Non-goals

Plan H does not:

- create a GitHub App;
- give Harness merge/release/deploy authority;
- move normal repository CI into Trick Harness;
- implement Release Readiness or production deployment;
- replace Plan F Conformance or Plan G Change Impact;
- change the existing GitHubDelivery write boundary;
- claim cryptographic/source-attested certification in the current native-user-status deployment.
