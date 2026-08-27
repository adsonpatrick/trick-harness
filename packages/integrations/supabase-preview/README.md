# @trick-harness/supabase-preview

Cloud-only database validation for Trick Harness. One run provisions its own hosted Supabase preview branch, applies the repository's migration history to it, runs the remote gates against it, and then deletes it.

## There is no local path, so there is no local fallback

`supabase start`, `supabase test db`, `db reset`, `db pull`, `db diff` and every `--local` variant need Docker and a local database. This package has neither, and rather than guarding against them it never builds them. `assertAllowed` is a second reading that refuses one if a later edit constructs it anyway, and the startup invariant restates the denied set as independent constants so widening it has to be done twice.

## The shared parent is not a slower path, it is a denied one

`--linked` means the parent project. A run that fell back to it would be validating a migration by applying it to the database everyone else is using, which is not validation. Every database command therefore names its target explicitly with `--db-url`, using a connection string read back from the branch this run created. If the branch reports a connection that carries the parent ref, the run stops as `shared-parent` before that connection reaches a single command — including a read.

## A blocked run and a failed run are different answers

`BLOCKED` means no safe preview database could be used, so nothing was learned about the repository. `FAILED` means a gate really did fail against a branch that really was provisioned. `PASSED` means every gate passed. Collapsing the first two would send a repair cycle to fix a migration that was never actually run.

## The connection is a credential

It is read from the branch, held for the length of the run, passed to database commands as an argv value and to the project's own suite through one named environment variable, and redacted out of every string this package reports. Failure messages name the operation and the exit code, never the output. Supabase authentication stays native to the CLI: this package reads no `.env` file, reads no token and constructs no environment beyond that one variable.

## The project's own suite stays the project's

pgTAP and RLS tests belong to the repository, not here, so the suite is configuration: an argv the project supplies. It is still read for the same denied flags, because a project test command carrying `--local` or `--linked` would quietly move the gate off the branch the run provisioned.

## A command is settled when its tree is gone

The Supabase CLI starts helpers, and a closed direct child says nothing about
them. Every command here waits for its whole owned process tree before the next
one runs: otherwise a migration would be applied while the previous command
still holds a connection to the branch, and the branch would be deleted out from
under something still writing to it.

A tree that cannot be observed to have exited blocks the run with
`teardown-failed`. It is never reported as a command that succeeded, whatever
exit code the child gave, and the underlying cause is dropped rather than
wrapped — a Supabase failure echoes the connection string it was handed.

The cancellation signal is not passed to that wait. A cancelled run still owns
what it started.

## The gates are a sequence, not a checklist

A run stops at the first gate it cannot get past. Lint read off a branch whose
migrations did not apply describes a schema that does not exist, and a project
suite run against it fails for a reason that has nothing to do with the code, so
collecting that evidence would not add information — it would add a second
failure for a run to try to repair.

The outcome says which gates were passed (`completedGates`), which one stopped
the run (`primaryFailure`), and which ones were therefore never asked
(`skippedGates`). A gate that was never configured — the project suite, when
there is no test command — is not reported as skipped, because it was never
planned.

## Cleanup is a separate report

The branch is deleted whatever happened to the run, including cancellation, and the delete is deliberately not given the run's abort signal — a cancelled run is exactly the case where a hosted branch would otherwise be left behind. Whether the delete worked is reported in `cleanup`, apart from the run's own result, because a leaked branch costs money and needs a person while a failed migration needs a repair cycle. Cleanup runs in a `finally`, and it is orthogonal in both directions: a branch that would not go away never turns a passing run into a failure, and a branch that went away cleanly never redeems a gate that failed.

## Usage

```ts
import { SupabasePreview } from '@trick-harness/supabase-preview'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

declare const subprocess: SubprocessRuntime
declare const parentRef: string

const preview = new SupabasePreview({
  cwd: '/repo',
  spawn: spec => subprocess.spawn(spec),
  projectRef: parentRef,
  testCommand: ['pnpm', 'run', 'db:pgtap'],
})

const outcome = await preview.run({ branchName: 'harness-run-1', gitBranch: 'feat/harness-v2' })

if (outcome.status !== 'PASSED') throw new Error(outcome.summary)
if (!outcome.cleanup.succeeded) console.warn(outcome.cleanup.message)
```

The parent project ref is non-secret project configuration: it names a project, it does not authenticate to one.

## Invariant companion

`@trick-harness/supabase-preview/invariant` registers a startup check that every canonical command still targets an explicit database and still carries none of the denied flags or local-stack words.

## Known Limitations and Deferred Work

- Branch health is read by polling `branches get`; the CLI offers a notify URL this package does not use, so a very slow branch is bounded by a timeout rather than by an event.
- The healthy and terminal status word lists track the statuses the API reports today, and will need revisiting if it adds more.
- Generated types are not produced here: `gen types` is a build concern, not a gate.
- The remote lint covers the whole branch schema unless the project pins schemas, so a repository with a noisy vendor schema should configure `schema`.
