# Plurora Harness V2 — Implementation Conformance & Definition of Done Amendment

- **Date:** 2026-08-28
- **Status:** APPROVED — owner decision 2026-08-28
- **Amends:** the Harness V2 base design, reusable-core amendment, 2026-08-27 scope/deployment amendments, Plan E, and Plan C* wherever PR readiness is defined
- **Scope:** approved-artifact traceability, implementation conformance, Definition of Done certification, routing and PR readiness

## 1. Decision

Plurora adds a first-class read-only workflow role named `conformance`. A pull request may not become `PR_READY` merely because implementation, tests, code review, QA and security are green. Before final verification, an independent conformance stage must prove that the published implementation satisfies the approved Spec, completed the approved Implementation Plan, and meets the applicable project Definition of Done.

The canonical PR lifecycle becomes:

```text
implement
-> verify
-> delivery
-> review
-> applicable QA
-> applicable security
-> conformance
-> verify-final
-> PR_READY
```

`conformance` answers a different question from the existing certifiers:

```text
review      => is the code/diff correct and maintainable?
qa          => does product behavior work across required journeys and negative paths?
security    => are security invariants preserved?
conformance => did we implement exactly the approved scope and produce evidence for every required obligation?
verify-final=> are final branch/world facts still valid after all repairs and certification?
```

## 2. Approved artifact identity

A conformance run must evaluate the same Spec and Plan that were approved for implementation. The workflow therefore carries immutable references, not only free-form requirement text.

```ts
export interface ApprovedArtifactRef {
  readonly path: string
  readonly sha256: string
}

export interface ApprovedArtifactSet {
  readonly spec: ApprovedArtifactRef
  readonly plan: ApprovedArtifactRef
}
```

`WorkflowObjective` gains:

```ts
readonly approvedArtifacts: ApprovedArtifactSet
```

Paths are repository-relative canonical paths resolved under `objective.cwd`. SHA-256 hashes are computed when the approved implementation run starts and recorded durably. Before implementation starts and again before conformance starts, the runtime re-reads both files and verifies the hashes. A changed or missing artifact is `BLOCKED`; the Harness never silently certifies a different Spec or Plan.

The journal records path + SHA-256 only. It does not persist whole documents, prompts, model transcripts, chain-of-thought or credentials.

## 3. Deterministic conformance manifest

The model is not trusted to decide which obligations exist. Before dispatching `conformance`, deterministic code builds a `ConformanceManifest` from the approved artifacts and project DoD policy.

```ts
export type ConformanceSource = 'spec' | 'plan' | 'dod'

export interface ConformanceObligation {
  readonly id: string
  readonly source: ConformanceSource
  readonly requirement: string
  readonly required: true
}

export interface ConformanceManifest {
  readonly specSha256: string
  readonly planSha256: string
  readonly obligations: readonly ConformanceObligation[]
}
```

### 3.1 Spec obligations

The deterministic parser reads explicit acceptance-criterion identifiers from the approved Spec. New and active Plurora Specs must expose stable IDs for every merge-blocking acceptance criterion. The parser does not ask a model to invent or omit the list.

Accepted normative rows use the repository convention:

```markdown
- **AC1:** ...
- **ND1:** ...
- **R1:** ...
```

A Spec used for a new implementation that contains no identifiable merge-blocking acceptance criteria is not certifiable and returns `BLOCKED` until the planning artifact is corrected.

### 3.2 Plan obligations

Every heading matching the approved Superpowers task form is a required plan obligation:

```markdown
### Task N: <name>
```

The obligation id is `PLAN-TASK-N`. A conformance result cannot omit a plan task because the expected task set is known before the model runs. Individual checkbox steps remain execution guidance and evidence seams; the merge-blocking completeness unit is the task.

### 3.3 DoD obligations

The Plurora profile/project deployment supplies a stable baseline DoD manifest. At minimum it includes:

- `DOD-APPROVED-ARTIFACTS` — approved Spec/Plan paths and hashes still match;
- `DOD-DIFF-COHERENCE` — final published diff contains no unrelated or stray readiness-affecting artifact;
- `DOD-FRESH-EVIDENCE` — applicable gates have fresh evidence for the final implementation state;
- `DOD-NO-MATERIAL-DEFECT` — no confirmed material defect remains open;
- `DOD-APPLICABLE-QA` — required QA evidence exists and passed, or QA is deterministically not required;
- `DOD-APPLICABLE-SECURITY` — required security evidence exists and passed, or security review is deterministically not required;
- `DOD-DELIVERY-WORLD` — reviewed branch/PR/commit corresponds to the state being certified;
- `DOD-FINAL-VERIFY-READY` — all prerequisites are satisfied for the following fresh final verification stage.

`DOD-FINAL-VERIFY-READY` does **not** claim `verify-final` has already run. Conformance certifies only that the branch is ready for that final verifier. Actual `PR_READY` still requires a subsequent `verify-final=PASS`.

Project-specific DoD criteria may extend this list, but may not remove the baseline rows.

## 4. Conformance result contract

The stage returns structured evidence rather than prose-only approval.

```ts
export const CONFORMANCE_ITEM_STATUSES = [
  'PASS',
  'MISSING',
  'PARTIAL',
  'FAIL',
  'BLOCKED',
  'INCONCLUSIVE',
] as const

export type ConformanceItemStatus = typeof CONFORMANCE_ITEM_STATUSES[number]

export interface ConformanceItem {
  readonly id: string
  readonly source: ConformanceSource
  readonly requirement: string
  readonly status: ConformanceItemStatus
  readonly implementationEvidence: readonly EvidenceRef[]
  readonly verificationEvidence: readonly EvidenceRef[]
  readonly summary: string
}

export interface ConformanceContract {
  readonly specSha256: string
  readonly planSha256: string
  readonly items: readonly ConformanceItem[]
  readonly verdict: WorkflowVerdict
  readonly summary: string
}
```

The parser rebuilds the contract from declared fields and drops or rejects undeclared data using the same bounded-contract discipline as existing diagnosis/stage parsers.

A deterministic coverage validator compares returned item IDs to the `ConformanceManifest`:

- every expected obligation appears exactly once;
- no expected obligation may be silently omitted;
- duplicate IDs are rejected;
- an unknown ID cannot substitute for an expected one;
- returned source and requirement must correspond to the manifest row;
- returned Spec/Plan hashes must match the objective and current files.

A model that produces an incomplete matrix therefore yields `INCONCLUSIVE`, never an optimistic PASS.

## 5. Verdict semantics

The conformance verdict is fail-closed:

```text
all required obligations PASS
=> conformance PASS

any required obligation MISSING or FAIL
=> conformance FAIL

any required obligation BLOCKED
=> conformance BLOCKED

any required obligation PARTIAL
=> conformance PARTIAL

coverage/result cannot be established
=> conformance INCONCLUSIVE
```

`PR_READY` requires conformance `PASS`. A green CI run, code review or QA result cannot override a missing Spec criterion or Plan task.

A `MISSING` Plan task or Spec requirement is a scope-completeness finding. It may enter the existing diagnosis/repair cycle only when the missing work is already unambiguously specified by the approved artifacts. If satisfying it would require a product/design decision, the workflow returns `BLOCKED`; the Harness may not invent scope to make the matrix green.

## 6. Role authority and independence

`conformance` is added to `ROLES` and `READ_ONLY_ROLES`. It receives no workspace mutation authority. Any fix follows the normal separate diagnose/repair path and is followed by fresh delivery, review, applicable QA/security and conformance before final verification.

The existing Plurora independence policy remains authoritative:

```text
low      => fresh-context
medium   => cross-executor-preferred
high     => cross-executor-required
critical => cross-executor-required
```

For high/critical work, inability to obtain the required independent executor prevents conformance certification and therefore prevents `PR_READY`. Medium may record degraded preferred independence according to existing policy; it must never misreport cross-executor evidence that did not occur.

## 7. Routing and model choice

Conformance is reasoning/judgement work, not implementation volume.

Primary Plurora routing is:

```text
role=conformance, risk=low|medium
=> executor=codex
=> tier=codex.balanced
=> effort=high

role=conformance, risk=high|critical
=> executor=codex
=> tier=codex.frontier
=> effort=xhigh
```

In the current deployment policy these tiers correspond conceptually to GPT-5.6 Terra (`codex.balanced`) and GPT-5.6 Sol (`codex.frontier`), but concrete product-native model ids remain deployment registry data and must be validated through authenticated Codex `model/list`.

Codex exposes model-specific supported reasoning efforts through `model/list`; the Plurora host must validate that the resolved model advertises the requested effort before declaring the route usable. If a configured model does not support the requested effort, startup or routing fails closed rather than silently weakening assurance.

Availability fallback is:

```text
Codex unavailable for conformance
=> executor=opencode
=> tier=opencode.reasoning-fast
```

Fallback evidence is labelled degraded. It may satisfy low/medium policy only to the extent allowed by the existing independence requirement. It cannot satisfy `cross-executor-required` when implementation was performed by OpenCode, so high/critical PR readiness remains blocked until an acceptable independent route exists or a human explicitly changes the run policy/override.

MiMo V2.5 / `opencode.workhorse` is not the primary conformance route because conformance is semantic comparison and omission detection rather than high-volume code production.

## 8. Workflow integration

`planPullRequestStages()` inserts `conformance-1` after applicable review/QA/security certification and before `verify-final`.

```text
implement-1
verify-1
delivery-1
review-1
qa-1              # when applicable
security-1        # when applicable
conformance-1
verify-final
```

If repair occurs after a conformance finding, the workflow must re-establish published-world evidence before recertification. No earlier conformance PASS survives a later mutation.

`assessPullRequest()` may return `PR_READY` only when the latest conformance stage is PASS, the final verifier is PASS, no material finding remains and all existing lifecycle rules are satisfied.

## 9. NeuroVia bridge responsibilities

The `neuro-via` implementation command remains human-gated. When `/implement` starts an approved Harness workflow it must supply repository-relative Spec/Plan paths. The project bridge computes SHA-256 hashes from those exact files and sends the approved artifact set in the start request.

The bridge must not allow the model to provide arbitrary external artifact paths. Paths must resolve under the current worktree. The control server validates the structured artifact set and the Plurora host re-validates files before run/conformance.

`pr-readiness` is updated to consume the Harness conformance projection rather than independently claiming Plan completeness. It still owns project evidence/gate selection and contributes project evidence mapped to the baseline/project-specific DoD rows consumed by conformance.

## 10. Evidence and status

Workflow status exposes bounded conformance facts:

- artifact paths and hashes;
- expected obligation counts by source;
- PASS/MISSING/PARTIAL/FAIL/BLOCKED/INCONCLUSIVE counts;
- overall conformance verdict;
- evidence references;
- independence/route facts.

It does not expose full model transcripts or private reasoning.

## 11. Acceptance criteria

- **CF1:** `conformance` is a first-class read-only role accepted by contracts, parsers, routing and lifecycle.
- **CF2:** every implementation workflow pins repository-relative approved Spec/Plan paths plus SHA-256 hashes and blocks if either artifact changes before certification.
- **CF3:** deterministic manifest extraction enumerates every explicit Spec acceptance criterion and every Superpowers `### Task N:` Plan task before model dispatch.
- **CF4:** eight baseline Plurora DoD obligations are injected independently of model output and cannot be removed by a project run.
- **CF5:** a conformance result omitting, duplicating or mismatching any expected obligation is not PASS.
- **CF6:** any required Spec/Plan/DoD item with MISSING/FAIL/PARTIAL/BLOCKED/INCONCLUSIVE prevents conformance PASS according to the verdict rules above.
- **CF7:** `PR_READY` requires latest conformance PASS plus final verification PASS and all pre-existing readiness invariants.
- **CF8:** low/medium conformance routes to `codex.balanced` with `high`; high/critical routes to `codex.frontier` with `xhigh`.
- **CF9:** Codex model/effort compatibility is verified through the authenticated native model catalogue; unsupported requested effort is not silently downgraded.
- **CF10:** Codex availability fallback routes conformance to `opencode.reasoning-fast` and records degraded assurance; it cannot satisfy high/critical cross-executor-required independence when implementation used OpenCode.
- **CF11:** conformance cannot mutate the workspace; fixes happen through existing diagnose/repair authority and invalidate prior conformance evidence.
- **CF12:** NeuroVia `/implement` supplies approved artifact paths from the current worktree, the bridge hashes them, and arbitrary external paths are rejected.
- **CF13:** NeuroVia PR readiness consumes Harness conformance and cannot declare Plan/DoD completeness from CI or worker self-report alone.
- **CF14:** durable/status data contains bounded matrix/evidence facts and approved artifact hashes, never whole Spec/Plan content, transcripts or private reasoning.

## 12. Plan precedence and rollout

This amendment introduces a Harness-side Plan F and a NeuroVia conformance wiring overlay. The active sequence becomes:

```text
Plan E  — cloud-dev / Plurora host enablement
-> Plan F — implementation conformance & DoD gate
-> Plan C* — NeuroVia installation + conformance wiring overlay
-> Plan D Tasks 11/12 — final pin reconciliation and activation
```

The known-good Trick Harness SHA pinned by NeuroVia must be recorded **after Plan F** is implemented and independently verified. Any Plan E text that calls an earlier intermediate SHA the final installation pin is superseded by this rule.
