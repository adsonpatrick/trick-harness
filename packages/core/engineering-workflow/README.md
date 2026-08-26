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

## Diagnosis comes before repair, and is a separate stage

A failed verification does not queue a repair. It queues a read-only `debug` stage first, and the repair that follows is authorized against what that stage established — a `DiagnosisContract` with a reproduction, ruled-out hypotheses, a root cause the debugger rates above low confidence, and a regression seam to attach a test to. `authorizeRepair` runs before dispatch, so a repair that may not start never gets a writable working tree in the first place. The one exception is a mechanically obvious scaffolding defect: a confirmed `TEST_DEFECT` or `TOOLING_DEFECT` that points at evidence has no behavior to reproduce, and skips diagnosis. A confirmed `BUG` or `SECURITY_BUG` never does.

A verification that fails without naming a confirmed repairable finding is blocked rather than repaired. Reporting that something is wrong is not the same as saying what to fix, and guessing at the difference is how a repair invents work nobody asked for.

## A missing product decision stops the run

When the diagnosis names a `productDecisionDependency`, the gate returns a `product-decision` blocker and the run ends `BLOCKED` before anything is written. Inventing the behavior is the one failure a later review could not detect, because the code would be self-consistent and the reviewer has no more access to the unmade decision than the repairer did.

## A symptom that stopped appearing is not a repair

`assessRepairCompletion` judges a finished repair against what it was authorized to owe. A behavior fix owes a regression test that pins the defect and a change that addresses the diagnosed cause; every repair owes a focused run that shows the result green. Any gap makes the repair `INCONCLUSIVE` and ends the run there — the verifier that would have followed is not asked to bless work whose own author could not say what it fixed. The verifier that does follow a repair is routed with the repairing executor named as `implementationExecutor`, so independence policy can send the reading to someone other than the writer.

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
  // Read the debugger's own output back; returning undefined blocks the repair.
  diagnose: () => undefined,
  // Read the repair's claims back; silence is judged as no evidence at all.
  repairEvidence: () => ({ rootCauseAddressed: false }),
  task: (stage) => `${stage.role}: ${objective.requirement}`,
})
console.log(planStages(objective).length, outcome.state, outcome.verdict)
runner.dispose()
```

## Invariant companion

`./invariant` pins workspace write authority to exactly the three mutating roles and checks that every declared read-only role would in fact be dispatched read-only.

## Known Limitations and Deferred Work

- **Findings are not triaged** — the repair gate picks the first confirmed repairable finding a failed verification named, and nothing decides between several or closes the loop on the ones it did not act on.
- **The regression test is claimed, not observed** — `RepairEvidence` is what the caller's reader says the repair produced. This package checks that the claim was made and pins what it must contain; confirming the named test really failed first is the verifier's job.
- **The breaker's state is not consulted** — `degradedExecutors` is a constructor option, so a circuit that opens mid-run does not affect the stages still to come.
- **`priorAttempts` counts repair cycles only** — a stage retried for any other reason presents the same routing facts it did the first time.
