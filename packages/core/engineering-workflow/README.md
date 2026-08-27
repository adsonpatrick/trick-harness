# @trick-harness/engineering-workflow

The deterministic engineering workflow runtime: the stage plan one objective becomes, the lifecycle that owns its live run, and the compact facts each stage hands to the next.

This is a fork-local package: private to `adsonpatrick/trick-harness`, never published, never carried upstream. See [docs/trick-harness/upstream.md](../../../docs/trick-harness/upstream.md) for the provenance record and divergence ledger.

## The plan is a function of the objective

`planStages` reads the objective's risk and nothing else, so the same objective plans the same way on every machine and in every replay. Risk adds certification rather than changing what implementation does — QA from medium, an independent code review at high, a security stage on top of both at critical — which keeps "what will this run do" answerable before anything is dispatched, from the objective alone. Below medium, QA is proportionate rather than absent: the work folds into verification instead of buying a separate stage for it.

## One owner, one signal

A `WorkflowRunner` owns at most one live run and the `AbortController` that ends it. A second concurrent run is refused rather than allowed to interleave two stage plans over the same working tree, and disposal terminates the run instead of detaching from it: a runner that let go of a live executor would leave a process nobody owns writing to the tree the next run is about to read.

## Read-only is a property of the role

`permissionModeFor` derives write authority from the role, never from the run, the policy row, or the profile. The router refuses a policy row that disagrees; this package states the same rule where it builds the provider request, and its invariant pins the mutating set to `implement`, `repair` and `delivery`. A reviewer that could edit would be reviewing its own work, and a debugger that could edit would have turned diagnosis into repair.

## Facts, not transcripts

A stage hands back `StageFacts`: its verdict, its summary, its findings and its evidence references. The executor's output does not travel — the caller's `StageInterpreter` reduces it at the boundary, and whatever it returns is all the run carries. That is what keeps one stage's context out of the next one's, which is the whole point of dispatching them separately.

## Triage decides, not the stage that found it

`triage` is a total function over `FindingClass`, and it runs on every stage's findings before the run acts on any of them. Confirmed `BUG`, `SECURITY_BUG`, `TEST_DEFECT` and `TOOLING_DEFECT` are repairable, worst first. `PRODUCT_DECISION`, `DESIGN_DECISION` and `UNRESOLVED` block, confirmed or not, because what is missing is a decision and no amount of evidence supplies one. Everything else — intentional behavior, improvements, refactor suggestions, style, false positives, and any defect nobody confirmed — is reported and left alone. A reviewer that could decide its own findings were actionable would be deciding scope, and scope is not a reviewer's to expand.

`reconcileVerdict` then holds the stage's verdict to those findings. The vocabulary is unchanged and nothing new is invented; two combinations are simply refused. A `PASS` over a confirmed material defect becomes `FAIL`, and any verdict becomes `BLOCKED` while a decision nobody made is outstanding. When triage disagrees, the correction is journalled as its own verdict, so the record shows both what the stage said and what the run acted on.

## Every certifying stage can open a repair cycle

`verify`, `review`, `qa` and `security` all certify somebody else's work, and a defect a review found is not a lesser defect than one verification found. Any of them may open a repair cycle against the worst finding it named, and the stage that found it is re-run afterwards under a fresh stage id of its own role — `qa-1` fails, `qa-2` re-reads the repaired tree. Nothing is certified on the strength of a pre-repair reading.

`QA_SEQUENCE`, `qaCharter`, `REVIEW_INPUTS` and `SECURITY_GROUNDING` hold what those stages are expected to cover as data rather than prose, so every profile composing a charter or a review prompt reads the same order the approved Spec fixed. `qaCharter` scales the sequence to the risk without reordering it: the visual, accessibility and exploratory passes are trimmed when a mistake is cheap, and everything that establishes what changed and what could break runs at every level.

## Independence the profile requires is enforced, not noted

Routing marks a certification it had to route back to the implementer with `independence:unsatisfied`. At `cross-executor-required` the runtime treats that as a refusal rather than a note: the stage is never started, and the run ends `BLOCKED`. Recording assurance the run did not actually obtain is worse than not obtaining it, because only the second is visible. At `cross-executor-preferred` the mark stands and the stage runs, which is what "preferred" means.

## Diagnosis comes before repair, and is a separate stage

A failed certification does not queue a repair. It queues a read-only `debug` stage first, and the repair that follows is authorized against what that stage established — a `DiagnosisContract` with a reproduction, ruled-out hypotheses, a root cause the debugger rates above low confidence, and a regression seam to attach a test to. `authorizeRepair` runs before dispatch, so a repair that may not start never gets a writable working tree in the first place. The one exception is a mechanically obvious scaffolding defect: a confirmed `TEST_DEFECT` or `TOOLING_DEFECT` that points at evidence has no behavior to reproduce, and skips diagnosis. A confirmed `BUG` or `SECURITY_BUG` never does.

A certifying stage that fails without naming a confirmed repairable finding is blocked rather than repaired. Reporting that something is wrong is not the same as saying what to fix, and guessing at the difference is how a repair invents work nobody asked for.

## A missing product decision stops the run

When the diagnosis names a `productDecisionDependency`, the gate returns a `product-decision` blocker and the run ends `BLOCKED` before anything is written. Inventing the behavior is the one failure a later review could not detect, because the code would be self-consistent and the reviewer has no more access to the unmade decision than the repairer did.

## A symptom that stopped appearing is not a repair

`assessRepairCompletion` judges a finished repair against what it was authorized to owe. A behavior fix owes a regression test that pins the defect and a change that addresses the diagnosed cause; every repair owes a focused run that shows the result green. Any gap makes the repair `INCONCLUSIVE` and ends the run there — the verifier that would have followed is not asked to bless work whose own author could not say what it fixed. The verifier that does follow a repair is routed with the repairing executor named as `implementationExecutor`, so independence policy can send the reading to someone other than the writer.

## Budgets end runs; they do not extend them

`maxExecutorStarts` and `maxRepairCycles` come from the profile, and reaching either produces a `budget-exhausted` blocker and a terminal `BLOCKED`. A verification that still fails after the last repair cycle is a thing a person has to look at, not a thing to try once more.

## A pull request is certified after it is published, not before

`planPullRequestStages` is the second plan this package ships, and the only thing it changes is where delivery sits: the branch is delivered as soon as implementation verifies, and every certifying stage after that reads the same published diff a person would. A review of an unpublished working tree reviews something nobody can comment on. Risk still decides how much certification is bought — QA above `low`, security at `critical` — and every plan ends on a fresh `verify-final`, so nothing is called ready on a reading taken before the last repair.

A repair inside that plan is followed by a fresh delivery of its own. The runtime re-queues `delivery-N` between the repair and the re-run of the stage that failed, so the next review reads the fix rather than the diff that provoked it.

`assessPullRequest` restates a finished run as `PR_READY`, `BLOCKED`, `FAIL`, `PARTIAL` or `INCONCLUSIVE`. It consults only the last stage of each role: a bug that `review-1` found and a repair fixed is absent from `review-2`, and it is the second reading that describes the branch as it now stands — the run believes the last reading, never the claim of the stage that edited it. An outstanding confirmed defect therefore cannot coexist with `PR_READY`, including when the run reached `maxRepairCycles` and stopped. Improvements are carried in `reportedFindings` and never implemented, because nobody asked for them.

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

`./invariant` pins workspace write authority to exactly the three mutating roles, checks that every declared read-only role would in fact be dispatched read-only, and pins the set of finding classes triage would repair to the four an automated repair may touch.

## Known Limitations and Deferred Work

- **One defect per cycle** — a stage that named several repairable defects gets the worst one repaired and re-runs; the rest are found again by the re-run rather than batched, and nothing closes the loop on a finding by id.
- **The regression test is claimed, not observed** — `RepairEvidence` is what the caller's reader says the repair produced. This package checks that the claim was made and pins what it must contain; confirming the named test really failed first is the verifier's job.
- **The breaker's state is not consulted** — `degradedExecutors` is a constructor option, so a circuit that opens mid-run does not affect the stages still to come.
- **`priorAttempts` counts repair cycles only** — a stage retried for any other reason presents the same routing facts it did the first time.
