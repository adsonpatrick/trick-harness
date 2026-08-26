# @trick-harness/engineering-workflow

The deterministic engineering workflow runtime: the stage plan one objective becomes, the lifecycle that owns its live run, and the compact facts each stage hands to the next.

This is a fork-local package: private to `adsonpatrick/trick-harness`, never published, never carried upstream. See [docs/trick-harness/upstream.md](../../../docs/trick-harness/upstream.md) for the provenance record and divergence ledger.

## The plan is a function of the objective

`planStages` reads the objective's risk and nothing else, so the same objective plans the same way on every machine and in every replay. Risk adds certification rather than changing what implementation does — a review at high, a security stage on top of it at critical — which keeps "what will this run do" answerable before anything is dispatched, from the objective alone.

## One owner, one signal

A `WorkflowRunner` owns at most one live run and the `AbortController` that ends it. A second concurrent run is refused rather than allowed to interleave two stage plans over the same working tree, and disposal terminates the run instead of detaching from it: a runner that let go of a live executor would leave a process nobody owns writing to the tree the next run is about to read.

## Read-only is a property of the role

`permissionModeFor` derives write authority from the role, never from the run, the policy row, or the profile. The router refuses a policy row that disagrees; this package states the same rule where it builds the provider request, and its invariant pins the mutating set to `implement`, `repair` and `delivery`. A reviewer that could edit would be reviewing its own work, and a debugger that could edit would have turned diagnosis into repair.

## Facts, not transcripts

A stage hands back `StageFacts`: its verdict, its summary, its findings and its evidence references. The executor's output does not travel — the caller's `StageInterpreter` reduces it at the boundary, and whatever it returns is all the run carries. That is what keeps one stage's context out of the next one's, which is the whole point of dispatching them separately.

## Budgets end runs; they do not extend them

`maxExecutorStarts` and `maxRepairCycles` come from the profile, and reaching either produces a `budget-exhausted` blocker and a terminal `BLOCKED`. A verification that still fails after the last repair cycle is a thing a person has to look at, not a thing to try once more.

## What a restart may conclude

`assessRestart` reads a workflow with no recorded end as `interrupted` and `INCONCLUSIVE` — not failed, because nobody observed it fail. When a stage was in flight or a delivery was recorded, it sets `requiresWorldVerification`, because the log cannot settle what the world now looks like. Re-reading the world is the caller's to do; concluding from the record alone is what this refuses.

## Usage

```ts
import { WorkflowRunner, assessRestart, planStages } from '@trick-harness/engineering-workflow'
import { projectWorkflow } from '@trick-harness/journal'
import type { WorkflowRuntimeOptions } from '@trick-harness/engineering-workflow'
import type { StageResult, WorkflowObjective } from '@trick-harness/contracts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

declare const options: WorkflowRuntimeOptions
declare const objective: WorkflowObjective
declare const events: readonly SessionEvent[]
declare const interpret: (stage: { role: StageResult['role'] }, executor: string) => StageResult

const before = assessRestart(projectWorkflow(events, 'wf-1'))
if (before.requiresWorldVerification) throw new Error(before.summary)

const runner = new WorkflowRunner('wf-1', options)
const outcome = await runner.run({
  objective,
  interpret: (stage, executor) => interpret(stage, executor),
  task: (stage) => `${stage.role}: ${objective.requirement}`,
})
console.log(planStages(objective).length, outcome.state, outcome.verdict)
runner.dispose()
```

## Invariant companion

`./invariant` pins workspace write authority to exactly the three mutating roles and checks that every declared read-only role would in fact be dispatched read-only.

## Known Limitations and Deferred Work

- **Diagnosis is not yet required before repair** — a repair stage is queued on a failed verification with no `DiagnosisContract` in between. That gate belongs to the debugging and repair work and is not in this package yet.
- **Findings are not triaged** — a `BLOCKED` verdict's blocker kind is read from its findings, but no stage decides which findings are eligible for repair at all.
- **The breaker's state is not consulted** — `degradedExecutors` is a constructor option, so a circuit that opens mid-run does not affect the stages still to come.
- **`priorAttempts` counts repair cycles only** — a stage retried for any other reason presents the same routing facts it did the first time.
