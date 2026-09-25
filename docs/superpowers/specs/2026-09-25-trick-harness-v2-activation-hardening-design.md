# Trick Harness V2 Activation Hardening — Design

- **Date:** 2026-09-25
- **Status:** Approved — owner approval confirmed 2026-09-25
- **Repository:** `adsonpatrick/trick-harness`
- **Project integration:** `adsonpatrick/neuro-via`
- **Base revision:** `9031aca5fd8a5576a3308011e5e46d37d3e6f8c5`
- **Scope:** runtime checkout hermeticity, stage semantics, repair authorization, executor/provider failure contracts, deterministic mutation enforcement, journaling, and final Plurora activation certification
- **Amends:** `2026-08-25-plurora-engineering-harness-v2-design.md`, `2026-08-28-harness-v2-change-impact-risk-policy-enforcement-amendment.md`, `2026-08-28-harness-v2-github-certification-gate-amendment.md`, and related V2 amendments where this document is more specific

## 1. Problem

The V2 activation canary exposed a failure chain that the current architecture permits even though each individual subsystem is fail-closed in isolation.

The canary implementation itself succeeded: the exact marker was created with no unrelated product changes. Verification then attempted an external `npm run harness:check` from a Codex sandbox. The runtime checkout was valid, but Git inherited a user-level `core.excludesFile` pointing to `C:\Users\adson\.config\git\ignore`, which the sandbox could not read. The verification stage therefore could not complete an environmental check.

That limitation was represented as a repairable tooling problem. The workflow opened an unnecessary repair cycle. OpenCode then aborted or produced an incomplete SDK response, which surfaced only as an opaque `TypeError`-derived provider error.

This exposed five architectural gaps:

1. runtime checkout validation is unnecessarily coupled to irrelevant user Git configuration;
2. environmental limitations and product findings share the same semantic channel;
3. a repairable finding can currently influence write authority beyond the approved objective;
4. provider-specific faults can escape the provider in categories the routing layer does not recognize;
5. technical test success alone is not sufficient evidence that the Plurora deployment is operationally activated.

The fix is not to make the Harness permissive. The fix is to make its epistemic states, authority boundaries, and deterministic evidence more precise.

## 2. Design Principle

The governing rule for this amendment is:

> **The Harness repairs only a demonstrated defect, inside a deterministically approved scope, and never attempts to repair the environment that is observing the code.**

Four separate concepts must remain separate:

```text
Stage result      what the stage concluded about its responsibility
Finding           what was demonstrated to be wrong in the artifact
StageConstraint   what prevented the stage from completing required evaluation
ExecutorFailure   what happened to the executor/provider itself
```

Authority is separate again:

```text
Evidence may justify repair intent.
Only deterministic Control Plane state grants repair authority.
```

## 3. Binding Decisions

### A. Hermetic runtime checkout validation

The NeuroVia integration's `scripts/harness/runtime-checkout.mjs` must be deterministic with respect to the pinned Trick Harness checkout, not unrelated personal Git ignore configuration.

Git commands used for runtime identity and cleanliness checks must neutralize `core.excludesFile` at command scope. The check must not disable all global/system Git configuration.

The following must continue to fail:

- wrong repository remote;
- wrong pinned revision;
- non-Git directory;
- dirty tracked files;
- untracked files;
- missing runtime path;
- relative runtime path.

The following must pass when the checkout is otherwise valid:

- inaccessible or invalid global `core.excludesFile`;
- platform-specific user ignore files that do not describe runtime identity.

The regression test must configure a deliberately unusable global `core.excludesFile` and prove `harness:check` still validates a correct pinned checkout.

### B. Findings and execution constraints are different contracts

`Finding` remains the vocabulary for defects, decisions, observations, and review outcomes about the artifact.

Environmental or execution limitations do not become a new `FindingClass`. They use a separate contract.

```ts
export const STAGE_CONSTRAINT_CLASSES = [
  'SANDBOX_LIMITATION',
  'MISSING_TOOL',
  'EXTERNAL_RUNTIME_UNREADABLE',
  'EXECUTOR_CAPABILITY_GAP',
  'EXTERNAL_SERVICE_UNAVAILABLE',
] as const

export type StageConstraintClass =
  typeof STAGE_CONSTRAINT_CLASSES[number]

export interface StageConstraint {
  readonly id: string
  readonly class: StageConstraintClass
  readonly raisedBy: Role
  readonly summary: string
  readonly evidence: readonly EvidenceRef[]
}
```

A constraint is only emitted for an observed limitation. There is no `confirmed` field, no severity, and no repairability field.

The boundary between `StageConstraint` and `ExecutorFailure` is where the failure becomes observable. If the executor successfully runs and the stage can return a valid contract saying a required operation was unavailable, the fact is a `StageConstraint`. If the provider/executor fails before a valid stage result exists, the fact is an `ExecutorFailure`. The Control Plane must never synthesize a constraint from provider prose or synthesize a provider failure from a stage constraint.

`StageResult` becomes:

```ts
export interface StageResult {
  readonly role: Role
  readonly executor: string
  readonly verdict: WorkflowVerdict
  readonly summary: string
  readonly findings: readonly Finding[]
  readonly constraints: readonly StageConstraint[]
  readonly evidence: readonly EvidenceRef[]
}
```

`constraints` is required and may be `[]`. Missing the field is an invalid result, not shorthand for no constraints.

`StageFacts` also carries the constraints so the distinction survives the stage boundary, durable journal, restart, and status reporting.

### C. Repair authorization is scoped authority, not finding interpretation

A finding may justify repair intent. It does not grant write authority.

A repair is permitted only when all of these are true:

1. the finding class is auto-repairable;
2. the finding is confirmed;
3. any required diagnosis is valid;
4. any security repair rule authorizes the affected boundary;
5. the defect is inside the approved logical objective boundary;
6. the proposed repair paths are a subset of the approved physical write-set;
7. the repair budget remains available.

The agent that raises a finding and the agent that performs the repair may never expand their own write authority.

The approved repair scope is derived by deterministic code from the approved Plan and change-impact policy. Physical scope is the exact normalized `plannedPaths()` set. Logical scope is derived by classifying those same paths through the profile's change-impact rules; model-authored prose such as `affectedBoundary`, `summary`, or `minimalRepairSurface` never defines logical authority.

For authorization, the Control Plane deterministically classifies the proposed repair paths and requires both:

```text
proposedRepairPaths ⊆ RepairScope.allowedPaths
classified(proposedRepairPaths).surfaces ⊆ RepairScope.allowedSurfaces
```

A legitimate repair that needs an additional test or source file not named by the approved Plan is intentionally blocked until scope is expanded by an external approved decision.

```ts
export interface RepairScope {
  readonly allowedPaths: readonly string[]
  readonly allowedSurfaces: readonly string[]
}

export interface RepairAuthorization {
  readonly findingId: string
  readonly reasonCodes: readonly string[]
  readonly scope: RepairScope
  readonly requiresRegressionTest: boolean
  readonly rootCause?: string
}
```

The authorizing gate runs before a repair executor receives `workspace-write`.

### D. Findings and diagnoses declare affected paths, but declarations do not grant authority

`Finding` gains an explicit path set:

```ts
export interface Finding {
  readonly id: string
  readonly class: FindingClass
  readonly raisedBy: Role
  readonly summary: string
  readonly confirmed: boolean
  readonly affectedPaths: readonly string[]
  readonly evidence: readonly EvidenceRef[]
}
```

`DiagnosisContract` gains:

```ts
readonly proposedRepairPaths: readonly string[]
```

For a diagnosed repair:

```text
Diagnosis.proposedRepairPaths ⊆ RepairScope.allowedPaths
```

For a mechanically obvious `TEST_DEFECT` or `TOOLING_DEFECT`:

```text
Finding.affectedPaths ⊆ RepairScope.allowedPaths
```

A mismatch is a deterministic `scope-unauthorized` repair refusal.

Text fields such as `affectedBoundary` and `minimalRepairSurface` remain useful explanatory facts but are not sufficient to authorize paths.

### E. Deterministic post-repair mutation enforcement

Pre-dispatch scope validation is necessary but not sufficient. A writable executor may still modify an unauthorized path accidentally or maliciously.

The Control Plane therefore requires a deterministic workspace state reader.

```ts
export interface WorkspaceSnapshot {
  readonly revision: string
  readonly entries: readonly WorkspacePathState[]
}

export interface WorkspacePathState {
  readonly path: string
  readonly fingerprint: string
}

export interface WorkspaceStateReader {
  snapshot(
    objective: WorkflowObjective,
    signal: AbortSignal,
  ): Promise<WorkspaceSnapshot>
}
```

A snapshot contains bounded path/fingerprint state, never file contents. Its fingerprint semantics must detect a path changing between the two snapshots even when the path was already dirty before repair. Creation, deletion, rename, staged changes, unstaged changes, and a second content mutation to an already-modified file must therefore remain distinguishable enough for `changedPathsBetween(before, after)` to identify the repair's mutation set.

The runtime captures a snapshot immediately before repair dispatch and another immediately after repair completion. Deterministic comparison produces the paths actually changed by that repair.

The repair is accepted only when:

```text
repairChangedPaths ⊆ RepairAuthorization.scope.allowedPaths
```

Any unauthorized path is a scope violation. The repair is rejected, no delivery occurs, and the workflow ends `BLOCKED`.

This check runs before `assessRepairCompletion()`.

### F. Planned, workspace, and published path readings remain distinct

Three deterministic readings answer three different questions:

```text
plannedPaths()
  What did the approved Plan authorize?

workspace snapshots
  What did this mutating stage actually change?

actualPaths()
  What did the published branch actually contain?
```

They must not be collapsed.

If the runtime cannot establish a deterministic `plannedPaths()` set, automatic repair is disabled for that run. Normal non-repair execution may continue according to the existing lifecycle, but the Harness must not grant repair `workspace-write` without a known physical boundary.

### G. Agent-reported diff evidence is not delivery authority

The Plurora host currently accumulates delivery paths from `EvidenceRef(kind="diff")` values emitted by stages.

Those references remain useful evidence, but they cease to be the authoritative list of paths allowed for delivery.

The delivery candidate set must come from deterministic repository/workspace state, then be checked by the Control Plane before being handed to the delivery capability.

A model cannot hide an unauthorized mutation by omitting its path from the result envelope.

### H. Executor failure categories use one canonical vocabulary

The executor contract must not permit categories the routing package cannot classify.

The canonical set is the union of the routing availability and quality vocabularies:

```ts
export const EXECUTOR_FAILURE_CATEGORIES = [
  'usage-limit-exceeded',
  'session-budget-exceeded',
  'server-overloaded',
  'internal-server-error',
  'transport-unavailable',
  'context-window-exceeded',
  'bad-request',
  'sandbox-denied',
  'cyber-policy-refusal',
  'unauthorized',
  'wrong-answer',
  'failed-verification',
  'other',
] as const
```

`ExecutorFailure.category` becomes that closed type.

`availability: boolean` is removed. Availability is derived exclusively from the canonical category by routing. This removes contradictory states such as `transport-unavailable + availability:false`.

Provider-specific detail uses a separate safe code:

```ts
export interface ExecutorFailure {
  readonly category: ExecutorFailureCategory
  readonly code: string
  readonly safeDiagnostic: string
  readonly httpStatus?: number
}
```

`category` controls Harness policy. `code` explains the provider-specific failure.

### I. OpenCode adapter/provider hardening

The OpenCode adapter must validate SDK response structure before dereferencing fields.

Provider-specific internal error types should cover at least:

- startup timeout;
- unsupported route/configuration;
- internally aborted OpenCode session;
- malformed/incomplete SDK response;
- transport/server fault.

Harness-requested cancellation remains:

```ts
{ status: 'aborted', output: '' }
```

An OpenCode-internal abort is not the same fact. It is an executor failure, normally:

```text
category = other
code = opencode.prompt.session-aborted
```

A missing/incomplete prompt response is normally:

```text
category = other
code = opencode.prompt.response-missing-data
```

Startup/transport unavailability maps to:

```text
category = transport-unavailable
```

No raw provider body, stack, token, environment value, or transcript may enter `safeDiagnostic`, the journal, PR comments, or certification status.

### J. Provider failure is not artifact failure

The current workflow converts `ExecutorResult.status === 'error'` into a stage `FAIL`. This amendment changes that rule.

`FAIL` means the stage established a defect in the artifact.

An executor/provider failure means the stage did not establish the required judgement.

After any allowed availability reroute is exhausted, an executor error yields an effective stage verdict of `INCONCLUSIVE`, not `FAIL`.

The workflow must never open an auto-repair cycle because a provider failed to answer.

## 4. Verdict Semantics

The five verdicts have these exact meanings.

### PASS

The stage completed its required evaluation and obtained sufficient assurance.

For a certifying stage, effective `PASS` requires:

- no material confirmed defect;
- no unresolved product/design decision;
- no `UNRESOLVED` uncertainty;
- no stage constraint that prevented a required evaluation;
- route assurance sufficient for the objective's risk and independence policy.

### FAIL

The stage demonstrated a real defect in the artifact.

Examples include a confirmed product bug, confirmed security bug, failing required behavior, or conformance obligation that is demonstrably missing/failed.

A provider error, sandbox denial, missing output marker, malformed envelope, or unavailable external runtime is not `FAIL`.

### INCONCLUSIVE

The stage could not establish sufficient judgement.

Examples include:

- stage constraint affecting a required evaluation;
- executor/provider failure with no valid fallback result;
- malformed or missing result contract;
- internal provider/session abort;
- `UNRESOLVED` finding;
- required conformance obligation that could not be evaluated.

`INCONCLUSIVE` never opens diagnosis or repair and never increments `repairCycles`.

### BLOCKED

The Harness knows why work cannot proceed, and continuation requires authority or a decision it does not possess.

Examples include:

- `PRODUCT_DECISION`;
- `DESIGN_DECISION`;
- repair path outside approved scope;
- unauthorized security repair;
- exhausted repair budget;
- required cross-executor independence unavailable;
- required deterministic capability absent;
- required scope expansion;
- enforcement configuration requiring human action.

### PARTIAL

The stage completed a valid evaluation, but the assurance is weaker than required for `PASS`.

Examples include:

- a valid reading obtained through a route that reduces allowed assurance;
- a confirmed repairable `TEST_DEFECT` or `TOOLING_DEFECT` without demonstrated product failure;
- an evaluated but unconfirmed concern that prevents full assurance.

`PARTIAL` only enters the repair path when a confirmed repairable finding also exists. A `PARTIAL` result without such a finding terminates as `PARTIAL`; it does not manufacture a repair target.

## 5. Finding Triage Changes

`BLOCKING_FINDINGS` becomes:

```ts
[
  'PRODUCT_DECISION',
  'DESIGN_DECISION',
]
```

`UNRESOLVED` is no longer blocking. It is uncertainty and therefore reconciles to `INCONCLUSIVE`.

The current auto-repairable classes remain:

```ts
[
  'BUG',
  'SECURITY_BUG',
  'TEST_DEFECT',
  'TOOLING_DEFECT',
]
```

Membership remains necessary but not sufficient. Scope authorization, diagnosis/security rules where applicable, and repair budget are still required.

## 6. Certifying-Stage Reconciliation Order

For certifying roles, the Control Plane computes effective verdicts from facts rather than using the model verdict as the primary source of policy.

The deterministic order is:

```text
1. validate StageResult contract
2. required StageConstraint present?      -> INCONCLUSIVE
3. PRODUCT/DESIGN decision present?       -> BLOCKED
4. UNRESOLVED present?                    -> INCONCLUSIVE
5. confirmed BUG/SECURITY_BUG present?    -> FAIL
6. confirmed TEST/TOOLING defect present? -> at most PARTIAL
7. unconfirmed repairable concern?        -> at most PARTIAL
8. otherwise accept the stage's valid claimed verdict
9. apply route-assurance cap
10. act on the effective verdict
```

A `PASS + StageConstraint` cannot survive as `PASS`.

A `PASS + confirmed material bug` becomes `FAIL`.

A `PASS + PRODUCT_DECISION` becomes `BLOCKED`.

## 7. Conformance Alignment

Conformance uses the same semantics as other certifying stages.

`ConformanceItemStatus` already supports:

```text
PASS
MISSING
PARTIAL
FAIL
BLOCKED
INCONCLUSIVE
```

The overall conformance reduction is deterministic:

```text
any BLOCKED        -> BLOCKED
else any FAIL      -> FAIL
else any MISSING   -> FAIL
else any INCONCLUSIVE -> INCONCLUSIVE
else any PARTIAL   -> PARTIAL
else               -> PASS
```

`MISSING` means the required implementation is demonstrably absent.

`INCONCLUSIVE` means the obligation could not be evaluated.

A stage constraint preventing evaluation of an obligation yields `INCONCLUSIVE`, not `MISSING`.

The conformance prompt and parser must accept the complete verdict vocabulary rather than restricting the nested result to `PASS | FAIL | BLOCKED`.

## 8. Journal and Replay

The durable journal gains explicit events instead of encoding new semantics in free-form summaries.

### Stage constraints

```ts
'harness/stage-constraint': {
  workflowId: string
  stageId: string
  constraint: StageConstraint
}
```

`WorkflowProjection` exposes the recorded constraints.

### Repair authorization

```ts
'harness/repair-authorization': {
  workflowId: string
  stageId: string
  findingId: string
  scopeSha256: string
  allowedPathCount: number
  allowedSurfaces: string[]
  reasonCodes: string[]
}
```

The journal need not duplicate every allowed path. The approved Spec/Plan hashes and deterministic scope derivation remain the canonical source; `scopeSha256` proves which resolved set granted authority.

### Executor diagnostics

`harness/executor-end` gains an optional:

```ts
failureCode?: string
```

For example:

```text
failureClass = other
failureCode  = opencode.prompt.session-aborted
```

Existing historical logs remain readable. Missing constraints, repair authorizations, or failure codes mean those facts were not recorded by the older schema. Replay must not invent them.

## 9. Repair Lifecycle

The repair lifecycle becomes:

```text
confirmed repairable finding
        ↓
deterministic planned scope exists?
        ↓
diagnosis required?
        ↓
repair paths declared
        ↓
declared paths inside logical + physical approved scope?
        ↓
security rule satisfied if applicable?
        ↓
budget available?
        ↓
record repair authorization
        ↓
capture pre-repair workspace snapshot
        ↓
dispatch repair with workspace-write
        ↓
capture post-repair workspace snapshot
        ↓
derive actual repair mutations
        ↓
actual paths inside authorization?
        ↓
assess repair evidence/completion
        ↓
fresh verification
        ↓
delivery/redelivery
        ↓
fresh actual impact + certification
```

A scope violation ends `BLOCKED` before delivery.

A repair executor/provider failure ends that repair stage `INCONCLUSIVE`; it does not rewrite the original defect into a different product failure.

## 10. Runtime Checkout Hardening in NeuroVia

The cross-repository integration change belongs in `adsonpatrick/neuro-via`.

`scripts/harness/runtime-checkout.mjs` must invoke Git for runtime validation with command-level neutralization of `core.excludesFile`.

This change must be narrow. It must not disable the user's entire global/system Git configuration and must not weaken:

- repository identity check;
- pinned SHA check;
- tracked dirty-file detection;
- untracked-file detection.

`runtime-checkout.test.mjs` must add a regression case with an inaccessible or nonexistent global excludes path.

## 11. Activation and Certification

Trick Harness V2 is not considered activated for Plurora solely because unit/integration tests pass.

Activation requires two gates.

### 11.1 Activation Gate

After all hardening changes land:

1. produce a new immutable Trick Harness commit SHA;
2. update NeuroVia `plurora-harness.json` to that SHA;
3. run Trick Harness focused/full verification required by the repository;
4. run NeuroVia harness tests, pin checks, runtime checkout checks, and Windows harness CI;
5. create a **fresh** activation canary from current NeuroVia `main`;
6. run the real OpenCode → Harness workflow;
7. reach `PR_READY`;
8. observe GitHub CI success;
9. observe `plurora/harness-certification = success` on the exact PR HEAD.

PR #200 is historical evidence of the previous failure mode and is not reused as final activation proof.

The activation canary must be intentionally simple and deterministic. It validates the Harness rather than the coding difficulty of the task.

For the activation canary, required success evidence is:

```text
exact intended change
unrelated changes = 0
repairCycles = 0
unexpected scope expansions = 0
required certifying stages = PASS
stage constraints = []
terminal readiness = PR_READY
PR created by bounded delivery capability
GitHub CI = success
plurora/harness-certification = success
secret leaks = 0
orphan processes = 0
transient runtime artifacts left behind = 0
```

`repairCycles = 0` is an activation-canary requirement, not a general workflow rule.

### 11.2 Enforcement Gate

Operational production protection requires `plurora/harness-certification` to be configured as a required check/status for the protected NeuroVia main branch.

The currently connected GitHub integration may not have permission to inspect or modify every branch-protection endpoint. Lack of connector visibility is not evidence that protection is configured.

If the repository hosting configuration cannot enforce the status, activation evidence must explicitly record that enforcement gap instead of claiming the merge gate is protected.

## 12. Defense in Depth

The five primary hardening areas intentionally overlap.

```text
A  hermetic runtime checkout
   prevents the known false environmental failure.

B  StageConstraint separation
   prevents future environment limits becoming findings.

C  deterministic repair scope
   prevents a misclassified finding from gaining write authority.

D  provider normalization
   prevents executor faults becoming opaque or unrouteable states.

E  fresh activation certification
   proves the integrated behavior rather than isolated components.
```

No one layer substitutes for another.

## 13. Security and Authority Invariants

The following are mandatory invariants:

1. read-only roles remain read-only;
2. a model cannot grant itself or another model additional write paths;
3. a finding cannot directly grant authority;
4. a diagnosis cannot directly grant authority;
5. agent-reported diff locators are evidence, not authoritative mutation state;
6. repair authority is granted before process spawn and checked again after process completion;
7. no repair is delivered after a scope violation;
8. no provider-specific raw body, stack, token, connection string, environment dump, or transcript enters durable state;
9. routing accepts only canonical failure categories;
10. executor/provider failures do not masquerade as artifact defects;
11. merge remains human-controlled;
12. certification is bound to the exact published PR HEAD;
13. absence of evidence never becomes `PASS`.

## 14. Compatibility

This amendment is designed to be additive where durability is concerned.

Existing journals remain readable without migration. Older events lack the newly introduced facts; projections represent them as absent/empty rather than fabricating history.

Public TypeScript contracts that change shape require corresponding parser, test fixture, snapshot, and consumer updates in the same implementation series.

Removing `ExecutorFailure.availability` is an intentional source-level breaking change inside the private monorepo. Routing becomes the sole owner of failure-nature classification.

The pinned OpenCode SDK remains `@opencode-ai/sdk@1.18.23` unless implementation evidence proves a version change is necessary. This design does not authorize an SDK upgrade merely to avoid handling a response shape correctly.

## 15. Non-Goals

This work does not:

- broaden automatic repair to subjective improvements or refactors;
- allow the Harness to modify its own control-plane code during an unrelated product objective;
- introduce generic self-healing of host/sandbox configuration;
- make all provider faults reroutable;
- retry quality failures on a second model and call that recovery;
- replace the existing change-impact policy;
- replace GitHub delivery/certification capabilities;
- automatically merge the activation canary;
- remove human approval from product/design decisions;
- treat branch protection as configured when it cannot be verified.

## 16. Required Verification Scenarios

The implementation must prove at least these scenarios.

### Runtime hermeticity

1. valid pinned checkout + invalid global `core.excludesFile` -> `harness:check` passes;
2. wrong remote -> fails;
3. wrong revision -> fails;
4. tracked dirty file -> fails;
5. untracked file -> fails.

### Stage semantics

6. required sandbox-limited check + no artifact defect -> `INCONCLUSIVE`, zero repair;
7. `PASS + StageConstraint` -> corrected to `INCONCLUSIVE`;
8. `PASS + confirmed BUG` -> corrected to `FAIL`;
9. `UNRESOLVED` -> `INCONCLUSIVE`;
10. `PARTIAL` without confirmed repairable finding -> no repair cycle.

### Repair authorization

11. repairable finding inside Plan + approved paths -> repair may start;
12. repairable finding outside Plan -> repair refused before writable dispatch;
13. mechanically obvious tooling defect outside approved paths -> repair refused;
14. repair changes an unauthorized extra path -> scope violation, no delivery;
15. real in-scope repair still completes diagnosis/evidence/reverification lifecycle.

### Provider normalization

16. Harness-requested cancellation -> `status: aborted`;
17. OpenCode internal session abort -> canonical `other` + stable safe code;
18. malformed SDK response -> canonical `other` + stable safe code, not incidental `TypeError`;
19. startup/transport failure -> `transport-unavailable`;
20. every emitted category is accepted by routing;
21. no raw provider payload/stack is persisted.

### Journal/replay

22. stage constraints survive journal projection;
23. repair authorization survives as bounded audit evidence;
24. executor failure code survives journal projection where recorded;
25. older journals without new events remain readable.

### Activation

26. Trick Harness verification suites pass;
27. NeuroVia harness/pin/runtime checks pass on supported platforms;
28. fresh canary changes exactly one approved artifact;
29. fresh canary completes with `repairCycles = 0`;
30. fresh canary reaches `PR_READY`;
31. GitHub CI succeeds;
32. `plurora/harness-certification` succeeds on exact canary PR HEAD;
33. no leaked process, secret, or transient runtime artifact remains;
34. required-status enforcement is verified or explicitly recorded as an external enforcement gap.

## 17. Completion Definition

This hardening effort is complete only when the integrated Plurora deployment demonstrates all of the following:

```text
environmental limitation ≠ defect
provider failure ≠ product failure
finding ≠ authority
self-reported diff ≠ mutation truth
repair intent ⊆ approved deterministic scope
actual repair mutation ⊆ granted scope
certification applies to exact published revision
fresh canary reaches PR_READY without repair
```

The final operational rule is:

> **The Harness may act automatically only on facts it can distinguish, authority it can prove, and state it can re-read deterministically.**
