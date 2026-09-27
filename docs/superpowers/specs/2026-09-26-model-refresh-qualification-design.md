# Trick Harness Model Refresh & Qualification Design

**Status:** APPROVED.  
**Date:** 2026-09-26  
**Implementation timing:** Deferred until the current Trick Harness activation/hardening work is complete and the runtime is demonstrably stable.

## 1. Purpose

Trick Harness already owns the mechanisms that decide which compute target may execute work, how results are verified, how evidence is collected, and how production policy is promoted, demoted, or rolled back.

This design does **not** redesign those mechanisms.

It defines a repeatable **Model Refresh & Qualification** process for introducing new model versions and model/harness combinations into the existing Trick Harness governance flow. The process exists because model capability, price, latency, provider behavior, and tool-use reliability change frequently enough that model refresh must become routine platform maintenance rather than a one-off architecture project.

The first qualification cohort is:

- GPT-6 Luna through Codex CLI;
- MiMo 2.6 Flash through OpenCode Go;
- DeepSeek 4.1 Flash through OpenCode Go.

These names identify the first refresh cohort only. They must not become hard-coded assumptions in routing logic.

## 2. Goal

After this work, a future model or model version can be introduced through the same bounded lifecycle:

```text
new model/version
    ↓
register compute target
    ↓
compatibility qualification
    ↓
existing BENCH/evaluation path
    ↓
existing isolated shadow/comparative evaluation path
    ↓
evidence-backed candidate policy
    ↓
manual promotion where justified
    ↓
normal monitoring / demotion / rollback
    ↓
eventual retirement of superseded target
```

The process must allow Trick Harness to answer:

- Is this exact model/harness/provider combination compatible with the runtime?
- For which existing workloads or stages is it qualified to compete?
- Does it improve quality, engineering cost, latency, or reliability without violating existing floors?
- Should any currently approved route change?
- Should an older target remain, be demoted, or be retired?

The answers come from Trick Harness evidence and policy mechanisms, not external benchmark reputation.

## 3. Non-goals

This refresh does not introduce or redesign:

- the routing architecture;
- workload or risk classification;
- ApprovedPolicy semantics;
- CandidatePolicy semantics;
- BENCH architecture;
- Decision Shadow or Execution Shadow architecture;
- deterministic verification;
- certification;
- repair orchestration;
- promotion, demotion, or rollback semantics;
- security or quality floors;
- a model marketplace;
- ML, Bayesian, bandit, or LLM-controlled routing;
- automatic production promotion;
- a new persistence subsystem;
- a new generic provider/plugin SDK.

If an existing mechanism is insufficient to qualify one of the targets, implementation may add the **smallest compatibility seam required**. Such work must preserve the current contracts and may not silently broaden this design into a routing or governance rewrite.

## 4. Preconditions

Implementation begins only after the current Trick Harness activation/hardening work is considered stable.

At minimum, the implementation branch must start from a baseline where:

- the canonical Trick Harness runtime is reproducible from its approved repository state;
- the current production/integration path has a fresh successful end-to-end canary;
- Codex integration used by the Harness is operational;
- OpenCode integration used by the Harness is operational;
- cancellation, timeout, malformed-result, and provider failure behavior is deterministic enough to distinguish target failure from Harness failure;
- verification and conformance contracts are stable;
- journal/evidence output required for comparison is stable;
- there is no unresolved P0 or P1 Harness defect that would materially contaminate model comparison;
- the current approved model/policy baseline is recorded before candidate evaluation begins.

Failure to satisfy the precondition blocks model refresh implementation. It must not be worked around by weakening qualification criteria.

## 5. Unit of qualification

A model name alone is not a qualification unit.

The unit is an exact **ComputeTarget identity**, conceptually:

```text
ComputeTarget =
  model/version
  + execution harness
  + provider/route
  + material model configuration
  + compatibility metadata
```

Examples for the first cohort:

```text
gpt-6-luna / codex-cli / configured OpenAI route
mimo-2.6-flash / opencode-go / configured Go route
deepseek-v4.1-flash / opencode-go / configured Go route
```

Two routes using the same underlying model but materially different harnesses or provider behavior are separate targets for evidence purposes.

Aliases that may silently change the served model are not sufficient provenance for a qualification result unless the resolved model/version is also recorded.

## 6. Existing architecture remains authoritative

Model Refresh & Qualification is an operational layer over existing Trick Harness capabilities.

The implementation must reuse existing equivalents of:

- ModelRegistry / target registry;
- workload and risk classification;
- BENCH or evaluation workloads;
- isolated comparative/shadow execution;
- deterministic verification;
- stage/result failure taxonomy;
- evidence and journal records;
- CandidatePolicy production;
- manual promotion;
- demotion and rollback;
- budgets and execution limits.

Where naming in the current code differs, the codebase contract wins. This specification names responsibilities, not a mandate to rename established types.

Production continues to execute only through the currently approved policy mechanism. Merely registering or benchmarking a target grants no production authority.

## 7. Refresh lifecycle

### 7.1 Discover

A model/version becomes a refresh candidate when there is a concrete reason to evaluate it, such as:

- a new model release;
- a meaningful version upgrade;
- a new provider route for an existing model;
- a material change to a harness integration;
- a material regression or deprecation in an approved target;
- a cost/performance change large enough to justify reevaluation.

Discovery may be manual. Automatic discovery is not required.

### 7.2 Register

Create or update the target entry with enough immutable or versioned metadata to identify what is being evaluated.

Registration means only that the target exists and may proceed to compatibility checks.

It does not mean:

- trusted;
- approved;
- production-ready;
- preferred;
- cheaper in practice;
- better for any workload.

### 7.3 Compatibility qualification

Before BENCH or shadow comparison, prove the target can participate in the Harness contract.

At minimum, validate the applicable integration behavior for:

- authentication/configuration resolution without leaking credentials;
- model selection;
- session/request startup;
- bounded completion;
- tool invocation required by the Harness path;
- structured stage/result handling;
- timeout handling;
- cancellation/abort handling;
- malformed response handling;
- provider/harness failure classification;
- process/session cleanup;
- usage metadata when the route exposes it.

Compatibility failures are recorded as target/integration evidence. They are not converted into apparent task-quality failures when the Harness can identify them separately.

A target that cannot satisfy the minimum execution contract does not proceed to production qualification.

### 7.4 BENCH / controlled evaluation

Run the candidate through the existing evaluation path against the current baseline and/or other eligible targets.

Use versioned workloads and identical or equivalently controlled initial conditions wherever the existing evaluation architecture supports them.

External benchmarks may inform why a model was selected for evaluation, but they do not satisfy this gate.

### 7.5 Isolated comparative or shadow evaluation

Where the existing Harness permits safe isolated execution, collect paired evidence using the same task, initial repository state, approved artifacts, and verification contract.

The candidate may not:

- mutate the production workspace;
- inherit production credentials merely because the baseline has them;
- publish or deliver side effects solely for evaluation;
- bypass the current shadow eligibility rules.

If safe comparative execution cannot be performed, record the limitation and use only the evaluation modes the existing architecture permits.

### 7.6 Qualification result

The refresh produces evidence about the exact ComputeTarget and the workloads/stages in which it was evaluated.

Qualification is scoped. A target may prove suitable for one workload and unsuitable or insufficiently evidenced for another.

The result must not collapse into a single global statement such as “model X is best.”

### 7.7 Candidate policy and promotion

Any route change continues through the existing CandidatePolicy/promotion process.

Promotion remains conservative and manual unless the already-approved Trick Harness architecture says otherwise at implementation time.

No refresh step may directly mutate production routing around the policy mechanism.

### 7.8 Monitor, demote, retire

After promotion, existing monitoring and rollback behavior remains authoritative.

A superseded target may be retained as fallback while evidence accumulates for the replacement. Retirement occurs only when removing it does not violate approved fallback, compatibility, or rollback requirements.

## 8. First-cohort use-case hypotheses

The first refresh should deliberately test plausible use cases, but these are **hypotheses**, not routing rules.

### GPT-6 Luna / Codex CLI

Candidate hypotheses:

- instruction-constrained implementation;
- multi-file refactor;
- review and conformance-oriented stages;
- high-risk work where the current policy already permits that target class;
- fallback/escalation work.

### DeepSeek 4.1 Flash / OpenCode Go

Candidate hypotheses:

- repository exploration;
- bug investigation;
- test-failure analysis;
- general implementation;
- repair loops;
- high-throughput engineering work.

### MiMo 2.6 Flash / OpenCode Go

Candidate hypotheses:

- small and medium implementation;
- bulk/mechanical edits;
- test generation;
- frontend or multimodal-adjacent tasks where the existing Harness can actually provide the required inputs;
- high-volume lower-cost work.

The evaluation corpus should include enough overlapping workloads that the Harness can compare targets rather than merely confirm preassigned roles.

No production policy may cite this section as evidence by itself.

## 9. Evidence required from a refresh

Use the existing evidence model wherever possible.

The refresh must preserve enough information to compare at least:

- terminal task/stage verdict;
- deterministic verification outcome;
- conformance/certification outcome where applicable;
- first-pass success versus repaired success;
- repair count;
- target/provider/tool failure category;
- stage constraints or capability gaps;
- timeout/cancellation incidence;
- scope or delivery-policy violation where already measured;
- latency/wall-clock information where available;
- model/provider usage information where available;
- attributable inference or engineering-cost information where available;
- exact target provenance;
- workload/evaluation provenance.

A recovered workflow must not erase an earlier target failure. For example, if target A fails and target B succeeds as fallback, the workflow may be successful while target A still records its failed attempt.

Learning/evaluation cost remains distinguishable from production engineering cost if the current Harness already makes that distinction.

## 10. Requalification triggers

A previously qualified target must be treated as requiring requalification when a material part of its identity changes.

Full or scoped requalification is required for changes such as:

- model major/minor version change when behavior may differ;
- provider silently or explicitly changing the resolved underlying model;
- material harness adapter behavior change;
- material tool-calling protocol change;
- material context/output or capability change that affects Harness contracts;
- a repeated production regression that calls previous evidence into question.

A pricing-only update does not require repeating quality evaluation if the executable target is otherwise unchanged. It may require refreshing cost metadata and reevaluating economics through the existing policy process.

## 11. Recurrence model

Model refresh is event-driven platform maintenance, not a one-time feature.

The reusable rule is:

```text
frequent discovery
+ cheap compatibility screening
+ evidence-driven evaluation
+ conservative production promotion
```

Future refreshes should normally require:

1. new/updated registry metadata;
2. a qualification run or plan naming the candidate;
3. evidence;
4. an existing candidate-policy/promotion decision.

They should **not** require a new architecture spec unless the new target introduces a capability that the existing Harness fundamentally cannot represent.

## 12. First refresh deliverable

The first implementation plan will qualify exactly these three targets:

1. GPT-6 Luna / Codex CLI;
2. MiMo 2.6 Flash / OpenCode Go;
3. DeepSeek 4.1 Flash / OpenCode Go.

It will:

- verify current adapter/config support;
- make only compatibility changes proven necessary;
- register the exact targets;
- run the existing qualification/evaluation mechanisms;
- exercise overlapping use-case hypotheses;
- capture reproducible evidence;
- produce candidate policy changes only where existing promotion criteria are satisfied;
- leave the current production policy unchanged until an explicit promotion action.

The plan must not assume all three candidates will qualify.

## 13. Acceptance criteria

This design is satisfied when:

1. The refresh implementation starts only after the stability precondition is met.
2. Each first-cohort target has exact recorded provenance sufficient to distinguish model, harness, and provider route.
3. Each target either passes the minimum compatibility contract or has a bounded, correctly classified incompatibility result.
4. Compatible targets can enter the existing BENCH/evaluation flow without bypassing existing governance.
5. Safe comparative/shadow evaluation uses the existing isolation rules.
6. The refresh records failures, repair cycles, constraints, and fallback recovery without crediting a failed target for another target's success.
7. No model becomes production-authoritative merely by registration, compatibility PASS, BENCH result, or shadow result.
8. Any production routing change is represented through the existing candidate-policy and manual promotion path.
9. The first refresh tests overlapping workloads instead of hard-coding permanent roles for Luna, MiMo, or DeepSeek.
10. The same process can qualify a future model/version without another architecture redesign.
11. A model/version can be demoted or retired using existing governance without deleting historical evidence.
12. Current security, verification, certification, scope, and delivery invariants remain unchanged.

## 14. Explicit implementation restraint

The implementation plan must begin by mapping this design onto the **current post-stabilization codebase**.

If the repository already provides a required capability, the plan must reuse it.

If a capability is missing, the plan may add the smallest focused seam necessary to complete qualification.

The following are specifically prohibited unless a separate approved design later requires them:

- replacing the current router;
- inventing a second policy authority;
- introducing a parallel evidence store;
- moving verification authority into an LLM;
- creating model-specific branching throughout core orchestration;
- hard-coding Luna, MiMo, or DeepSeek as permanent semantic roles;
- weakening a gate to make a candidate pass.

## 15. Future refresh template

After the first implementation proves the process, a future refresh should be expressible approximately as:

```text
Refresh ID: MODEL-REFRESH-NNN
Candidate: <model/version + harness + provider route>
Reason: <new release / regression / price-performance reevaluation / provider change>
Baseline targets: <current approved targets>
Qualification scope: <existing workloads/stages>
Compatibility result: <PASS / bounded failure>
Evaluation evidence: <existing evidence references>
Candidate policy impact: <none / proposed scoped route changes>
Decision: <reject / retain candidate / promote scoped route / retire predecessor>
```

This template is operational documentation, not a new source of runtime authority.
