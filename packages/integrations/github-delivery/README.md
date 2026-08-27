# @trick-harness/github-delivery

The narrow set of git and `gh` operations an automated run may perform on its own feature branch: stage an approved write set, commit it, push the branch it is already on, and open or update the pull request for it.

This is a fork-local package: private to `adsonpatrick/trick-harness`, never published, never carried upstream. See [docs/trick-harness/upstream.md](../../../docs/trick-harness/upstream.md) for the provenance record and divergence ledger.

## The denied operations are absent, not guarded

Force push, history rewriting, merging, releasing, deploying and writing a protected branch are not slow paths behind a flag here. There is no code that constructs them, `assertAllowed` refuses to return one if a later edit builds it anyway, and the invariant companion restates the denied set independently so widening it has to be done twice. Merge stays with a person, which is the point of delivering into a pull request rather than onto a branch.

## Commands are argv, so nothing a model wrote becomes syntax

Every command is an array handed to the DSH subprocess seam, which never shell-interprets it. A commit message containing `$(rm -rf /)` is a commit message. There is no quoting rule to get right, because there is no shell, and a path in the write set is separated from options by a bare `--` on top of that.

## The branch is read, never asserted

A delivery is told which branch it is delivering, and then checks. `validateBranch` reads what the workspace actually has checked out and refuses anything else — a foreign branch, a detached head, a protected name. A run whose working tree moved underneath it does not get to push work it never saw, and the push refspec names the branch that was validated rather than whatever `HEAD` now means.

## The staged set is the approved set, proven by reading the index back

`git add` succeeds whether or not it staged what the caller meant. So the index is read back and compared, path for path, with the approved write set. Anything else — a stray file someone staged, a pattern that matched more than intended — fails the delivery before a commit exists, because unrelated work carried into a reviewed PR is work nobody reviewed.

## Every reported fact was re-read from the world

The commit SHA is what `HEAD` resolves to afterwards, not what `git commit` printed. The push is confirmed by resolving `refs/remotes/origin/<branch>` and comparing. The pull request number and URL come from `gh pr view --json` after the create, not from the create's own output. This is what makes the durable delivery event usable on restart: it answers what the world holds, and an exit code does not.

## A second pull request is worse than an updated one

Delivery runs again after every repair cycle. A branch that already has a pull request gets that one updated; only a branch with none gets one opened. A run that opened a PR per cycle would bury the review it was asking for.

## Describing a delivery is not part of delivering it

Reading CI state can fail on its own — checks not scheduled yet, an API that is slow — and none of that unmakes a commit, a push or a pull request that already exist. Those failures land in `metadataFailures`, separate from `failure`. A run told its delivery failed would go and repair work that is already on the remote.

## A command is settled when its tree is gone

The direct child closing is not the end of a git command. Git starts helpers, and a delivery that read `done` and moved on would run its next command against an index another process still holds — which is not a rare race so much as the ordinary shape of one. Every command here waits for whole-tree quiescence before its result is returned.

A wait that ends any other way is a tree still standing. A rejection and the seam saying it stopped waiting both become a `teardown-failed` delivery error, and neither can be reported as a command that succeeded, whatever exit code the child gave. The run's cancellation signal is deliberately not passed to that wait: a cancelled delivery still owns what it started, and handing the workspace back while something is still writing to it is the failure cancellation was supposed to prevent.

## A confirmed mutation is written down before the next one

Each of the three mutations is re-read from the world before it is believed, and
`onRecord` is offered that re-read record before the next mutation starts. The
order matters more than it looks: a push whose commit was never recorded is, on
restart, indistinguishable from a commit that never happened, and a restart that
guesses wrong either repeats work that landed or abandons work that did not.

So an observer that rejects stops the delivery. The result is not an error in
place of a result — it is a `DeliveryOutcome` that reports what did land, with
`failure.code` of `uncheckpointed-mutation`. A delivery that did less than it was
asked and said so is a state a run can act on.

Operations that were attempted but not confirmed are never offered. The observer
sees mutations, not intentions.

## Credentials stay where they live

`gh` authenticates from its own stored configuration. This package never reads a token, never constructs an environment to carry one, and passes no `env` to the subprocess seam unless a caller explicitly supplies one — the seam already scrubs credential-shaped entries from the parent. Failure messages name the operation and the exit code and never the command's output, because `gh` writes authentication hints to stderr and those messages reach a durable event.

## Usage

```ts
import { GitHubDelivery } from '@trick-harness/github-delivery'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

declare const subprocess: SubprocessRuntime

const delivery = new GitHubDelivery({ cwd: '/repo', spawn: spec => subprocess.spawn(spec) })
const outcome = await delivery.deliver({
  branch: 'feat/harness-v2',
  files: ['packages/core/routing/src/index.ts'],
  message: 'feat(trick): add deterministic executor routing',
  pullRequest: { title: 'Deterministic routing', body: 'See the plan.', base: 'main' },
})

if (!outcome.delivered) throw new Error(outcome.summary)
console.log(outcome.commitSha, outcome.pullRequest?.number, outcome.metadataFailures)
```

## Invariant companion

`./invariant` restates the protected branches, the denied push arguments and the denied subcommands as independent constants and checks that the operation set has not been widened, and that the one command reaching the remote is still a single unforced refspec push to `origin`.

## Known Limitations and Deferred Work

- **The protected set is a name list** — a branch protected on GitHub but absent from `PROTECTED_BRANCHES` is refused by the remote rather than by this package. Reading the repository's real protection rules would need an API call this package deliberately does not make on the delivery path.
- **CI state is read, not waited for** — `gh pr checks` is called once and its result only describes the delivery. Nothing here polls until checks settle.
- **The pull request body is written whole** — an update replaces the body rather than appending to it, so a human edit to the description is overwritten by the next cycle.
- **No teardown to fail** — `metadataFailures` currently carries only the CI read. A capability that allocated resources would report their cleanup there too.
