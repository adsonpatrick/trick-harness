# THV2-READINESS-002 — Durable, Observable & Recoverable Harness Runtime

> **Migration snapshot — pending human merge approval.**
> Source: https://app.notion.com/p/3e8bc1cab1438187ab86e171ea6779ae?pvs=204
> Exported from the approved Notion artifact on 2026-09-27.
> Until this PR is merged, the referenced Notion page remains the authoritative approved snapshot.
> Merging this file establishes the GitHub version as the technical documentation source of truth; it does not authorize implementation beyond the approved Plan.

**Status:** Approved v0.2 — owner-approved on 2026-09-27. This approval covers the architecture/readiness Spec only; implementation, PR mutation, canary, merge, release, and deploy remain unauthorized until the implementation Plan is separately approved.
**Derived from:** [https://app.notion.com/p/3e7bc1cab14381fe91f2c060d74430c8](https://app.notion.com/p/3e7bc1cab14381fe91f2c060d74430c8)
## Purpose
Turn the findings from THV2-INVESTIGATION-001 into a production-grade runtime contract for Trick Harness that is durable, observable, recoverable, provider-agnostic, and safe to reuse across Plurora and future projects.
This Spec does **not** declare Trick Harness production-ready. It defines the architecture and evidence required before that claim is allowed.
## Why this is a separate Spec
The investigation and the hardening are different authority boundaries:
- THV2-INVESTIGATION-001 remains the forensic ledger: reproduce incidents, establish causes, and mark unknowns.
- THV2-READINESS-002 defines the runtime architecture that must hold across future failures, not only the incidents already observed.
- A finding in the investigation may justify a task here, but no implementation is authorized merely because a failure was observed.
This split prevents the current pattern of `failure → patch → new canary → next failure` from becoming the delivery strategy.
## External reference baseline
The design was recalibrated against current public documentation and production patterns:
- [Anthropic — Scaling Managed Agents: Decoupling the brain from the hands](https://www.anthropic.com/engineering/managed-agents): durable session log outside the harness, stateless/restartable harness instances, disposable execution environments, and credentials outside the sandbox.
- [Temporal — Durable AI](https://docs.temporal.io/ai): crash-resistant workflow execution, retries at external-activity boundaries, durable history, and resumption after process/network failure.
- [Temporal — Workflow determinism](https://docs.temporal.io/workflow-definition): deterministic workflow logic with non-deterministic external actions isolated behind replay-safe activity boundaries.
- [LangGraph — Thinking in LangGraph](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph): discrete checkpoint boundaries, explicit transient/LLM-recoverable/human/unexpected failure handling, durable interrupts, and streaming progress.
- [OpenHands V1 — Design Principles](https://github.com/OpenHands/docs/blob/main/sdk/arch/design.mdx): one source of truth for mutable state, stateless/composable components, and strict separation between SDK/core, tools/workspace, server, and applications.
- [OpenHands — Runtime Architecture](https://github.com/OpenHands/docs/blob/main/openhands/usage/architecture/runtime.mdx): isolated execution environment and stable action/observation boundary.
- [OpenAI Agents SDK — Tracing](https://openai.github.io/openai-agents-js/guides/tracing/): trace/span hierarchy across run, turns, tool calls, guardrails, and custom events.
- [OpenAI Agents SDK — Streaming](https://openai.github.io/openai-agents-js/guides/streaming/): progressive run events instead of terminal-only visibility.
- [SWE-agent — Architecture](https://swe-agent.com/latest/background/architecture/): explicit environment/deployment boundary and agent-computer interface.
- [SWE-agent — Inspecting trajectories](https://github.com/SWE-agent/SWE-agent/blob/main/docs/usage/inspector.md): durable run trajectories as a debugging/evaluation artifact.
These are **reference patterns, not dependency decisions**.
## Architecture decision
### Selected approach — evolve Trick Harness in place
Retain the current TypeScript core, contracts, journal, routing, conformance, repair and provider seams. Import the proven runtime invariants above into the existing architecture.
**Reason:** the current core already has a substantial deterministic contract and regression surface. Replacing it now would discard validated behavior and introduce a second migration problem before the current runtime is understood.
### Deferred alternative — Temporal-backed orchestration
Temporal is a valid future backend if Trick Harness needs distributed workers, multi-day durable workflows, horizontal scaling, or strong server-side replay across machines.
It is **not** introduced by this Spec. The architecture must instead expose a future orchestration port so a Temporal adapter can be added without rewriting stage semantics.
### Rejected for this phase — rewrite on LangGraph/Deep Agents
LangGraph/Deep Agents provide useful durability and agent-loop patterns, but replacing the Harness core would couple our execution policy to another agent framework and duplicate contracts we already own. Their patterns are adopted; their runtime is not.
## Core invariants
### R1 — Durable state is outside the live runner
The durable journal/session state is the canonical source of workflow truth. A live runner is a replaceable process.
A runner crash must not erase:
- objective and approved-artifact identity;
- stage/attempt lifecycle;
- route decision and executor identity;
- constraints/findings/verdicts;
- workspace/checkpoint identity;
- recovery decisions;
- external side-effect intent and confirmation;
- terminal certification state.
### R2 — Runner state is reconstructible
A new runner must be able to assess a recorded workflow without relying on in-memory objects from the previous process.
The restart result must be one of:
- **RESUMABLE** — safe to continue from a durable boundary;
- **WORLD_VERIFICATION_REQUIRED** — an external side effect may have happened and must be re-read before continuing;
- **HUMAN_ACTION_REQUIRED** — continuation requires a decision or environment repair;
- **TERMINAL** — the recorded workflow is complete and must not restart.
No restart may guess that an uncertain side effect did or did not happen.
### R3 — Progress is projected from durable events
`harness_status` must not remain a static `running / stages=[]` snapshot while work is executing.
The bounded status projection must expose, while the workflow is live:
- current stage and attempt;
- completed stages;
- executor and route;
- stage start/last-event timestamps;
- safe failure code or constraint class;
- recovery disposition and next action;
- repair cycle;
- delivery/certification state;
- correlation IDs (`workflowId`, `hostRunId`, workspace/session ID where safe).
The projection must never include raw model output, command output, credentials, arbitrary stderr, or repository content.
### R4 — Failure classification and recovery are separate
A provider/stage reports a bounded **failure fact**. The control plane deterministically derives a **recovery disposition**.
Minimum recovery dispositions:
- `RETRY_SAME_EXECUTOR`
- `REROUTE_EXECUTOR`
- `REPROVISION_WORKSPACE`
- `PAUSE_FOR_HUMAN`
- `RECONCILE_WORLD_STATE`
- `RECONCILE_WORKSPACE`
- `VERIFY_RECOVERED_MUTATION`
- `TERMINAL_BLOCKED`
- `TERMINAL_INCONCLUSIVE`
- `TERMINAL_FAIL`
The model may report evidence, findings, and constraints. It may **not** select the recovery disposition.
### R5 — StageConstraint is not synonymous with terminal failure
A constraint still prevents a stage from claiming PASS. That fail-closed invariant remains.
However, `constraints.length > 0` must not by itself decide that the entire workflow terminates.
The policy must distinguish at least:
- transient external-service unavailability;
- sandbox/runtime limitation;
- missing tool;
- executor capability gap;
- environment/configuration problem;
- human-only decision;
- genuinely non-recoverable inability to establish the required evidence.
If recovery succeeds, the certifying stage must run again and establish a fresh result. No constraint is converted into PASS.
### R6 — Unknown errors do not become retryable by optimism
Generic executor failures remain non-retryable until classified by deterministic evidence.
OpenCode and future provider adapters must preserve bounded failure codes that distinguish, when knowable:
- startup/transport timeout;
- connection/transport unavailable;
- provider/server overload;
- usage/quota/session budget;
- authentication/authorization/configuration;
- capability mismatch;
- session aborted;
- malformed provider response;
- prompt/model-call failure with known transient cause;
- sandbox denial;
- unknown/unclassified failure.
Only failure classes explicitly designated as availability/recoverable may trigger automatic retry/reroute.
### R7 — Mutation retries require workspace reconciliation
A failed or malformed **read-only** stage may be safely retried according to policy.
A failed `implement` or `repair` attempt may have changed the workspace before reporting failure. It must never be blindly re-run. Before conclusive reconciliation, fresh certification or a replacement writer, the trusted host must prove that all previous writers have terminated or lost enforceable write authority. Cancellation requests, timeout and host-lock release alone are insufficient. An unproven orphan writer leaves the physical workspace quarantined across restart/project namespaces.
Before any mutation-capable retry, the control plane must:
1. compare the workspace with the pre-attempt snapshot/checkpoint;
2. record the deterministic changed-path set;
3. decide whether to continue from those mutations, revert only Harness-owned disposable state, or require human/world verification;
4. preserve user-owned changes.
An invalid result envelope is never sufficient reason to repeat mutation.
### R8 — External side effects are idempotent and journaled
Delivery, certification, issue/PR creation, and future external mutations must use stable logical operation identities derived from workflow/stage/capability/action/target plus a durable logical-operation ordinal. Stage/transport attempt identities are correlated separately; retries and resume preserve the original operation identity.
For each external side effect the durable record must distinguish:
- intent recorded;
- request attempted;
- externally confirmed;
- confirmation unknown.
After crash/restart, the Harness re-reads the external system before repeating an uncertain operation. Absence at one read does not prove an earlier request cannot apply later. Negative reconciliation requires authoritative non-application evidence and terminality of prior requests, or a verified provider deduplication contract before repeating. Otherwise remain PENDING_OR_UNKNOWN and eventually pause under the frozen budget. Matching another actor's certification is not proof of this operation. Read-before-write must not be represented as atomic compare-and-set unless the integration actually enforces that precondition.
### R9 — Harness, session and execution environment are separable
Adopt the stable interface pattern demonstrated by Managed Agents and OpenHands:
- **Session/journal:** durable state and event history.
- **Harness/control plane:** stage semantics, routing, policy, recovery, conformance.
- **Workspace/sandbox:** disposable execution environment and project checkout.
- **Executor/provider:** LLM/agent invocation boundary.
- **Capabilities/integrations:** GitHub, DB verification, future deployment or external tools.
A failure or replacement in one layer must not require the other layers to share its process lifetime.
### R10 — Credentials stay outside untrusted execution
The sandbox/workspace and model-generated code must not receive broad reusable credentials merely because the Harness can perform a privileged capability.
Credential-bearing integrations should execute through capability/proxy boundaries with least privilege. Existing no-automerge/no-deploy/human authority boundaries remain binding.
**Model/provider binding addendum — owner-authorized on 2026-09-27:** Related qualification record: [https://app.notion.com/p/3e8bc1cab14381e0ae9fecd0a0d7cf76](https://app.notion.com/p/3e8bc1cab14381e0ae9fecd0a0d7cf76)
Freeze a bounded binding for each stage and permitted route in the immutable execution-plan record: executor adapter/version, provider, configured model selector, resolved identity/snapshot when exposed, identity assurance (IMMUTABLE_SNAPSHOT / PROVIDER_REPORTED / ALIAS_ONLY), resolution timestamp, effective nonsecret generation settings, profile/routing-policy version, permitted fallback routes with conditions/budgets, and binding hash. Never claim that an alias freezes model weights; report the provider's actual identity guarantee.
Resume reads this binding rather than current global defaults. An unavailable binding pauses unless a predeclared, qualified fallback satisfies recovery, capability and independence policy. Journal any eligible route change before dispatch. Unresolved writer/workspace/world state always takes precedence. Unexpected identity drift blocks silent continuation; missing immutable identity blocks any profile requiring it.
This shared contract adds no candidate activation or SDK upgrade. Reuse existing ComputeTarget/model-registry contracts for identity and preserve the existing reference configuration. The owner supplied the canonical [approved Model Refresh Spec](https://github.com/adsonpatrick/trick-harness/blob/docs/model-refresh-qualification/docs/superpowers/specs/2026-09-26-model-refresh-qualification-design.md) and [MODEL-REFRESH-001](https://github.com/adsonpatrick/trick-harness/blob/docs/model-refresh-qualification/docs/superpowers/plans/2026-09-26-model-refresh-001.md), whose status is DEFERRED until its stability gate passes. The linked Notion record is a dependency addendum only. Before stability, preparation is documentary only; candidate configuration/implementation/evaluation remains deferred. Model promotion follows existing CandidatePolicy and explicit human approval; routing-policy.ts stays read-only and [codex.frontier](http://codex.frontier) stays gpt-5.6-sol. Missing existing evaluation/governance machinery blocks the refresh rather than expanding READINESS. Alias-only identity may be inspected but cannot satisfy the refresh's trustworthy resolved-model provenance requirement.
### R11 — Conformance remains strict
Keep:
- approved Spec/Plan byte identity;
- deterministic obligation extraction;
- strict StageResult/Conformance parsing;
- conformance preflight before first delivery;
- final conformance against the published branch;
- final verification;
- human-owned merge/release/deploy.
Robustness must come from recovery and observability, **not** by accepting malformed output or weakening evidence requirements.
### R12 — Concurrency is workspace-scoped
One writable workspace may have at most one mutation-capable workflow lease at a time. Exclusivity and writer quarantine are keyed by host-wide canonical physical workspace identity, independent of project/deployment namespace or configured state root. Namespaces separate records, not locks for the same worktree. Admission without a shared exclusion authority is unsupported.
Multiple workflows may execute concurrently only when they have isolated workspaces and independently correlated journals/sessions.
A process-level “one live run” restriction is insufficient as the long-term concurrency model; the authority boundary is the workspace/target, not the Node.js process.
### R13 — Journal compatibility is explicit
Durable state that survives runtime upgrades needs an explicit schema/version contract.
A newer runtime must either:
- read the supported previous journal format deterministically; or
- refuse with a bounded `upgrade-required / incompatible-journal` state.
It must never silently reinterpret unknown events.
## Recovery decision matrix
<table>
<tr>
<td>Observed condition</td>
<td>Default control-plane disposition</td>
<td>Required precondition</td>
</tr>
<tr>
<td>Transient provider/transport unavailability</td>
<td>Bounded retry, then reroute if policy permits</td>
<td>No unresolved mutation/world state</td>
</tr>
<tr>
<td>Capability gap</td>
<td>Reroute to compatible executor; otherwise human/terminal</td>
<td>Compatible route satisfies independence/evidence policy</td>
</tr>
<tr>
<td>Sandbox/runtime unavailable</td>
<td>Reprovision or reroute environment</td>
<td>Workspace state reconstructible</td>
</tr>
<tr>
<td>Missing tool</td>
<td>Environment repair/reprovision or human action</td>
<td>Tool is required by approved evidence contract</td>
</tr>
<tr>
<td>Malformed result from read-only stage</td>
<td>Bounded protocol retry or non-mutating result-recovery turn</td>
<td>No side effect occurred</td>
</tr>
<tr>
<td>Malformed/failed mutation stage</td>
<td>Reconcile workspace before any retry</td>
<td>Pre-attempt snapshot exists</td>
</tr>
<tr>
<td>Unknown external side-effect outcome</td>
<td>World verification</td>
<td>Re-read target by idempotency identity</td>
</tr>
<tr>
<td>Product/design decision missing</td>
<td>Pause/block for human</td>
<td>No model-authored requirement substitution</td>
</tr>
<tr>
<td>Confirmed artifact defect</td>
<td>Existing diagnose/repair flow</td>
<td>Repair scope is deterministically authorized</td>
</tr>
</table>
## Observability contract
Every workflow must support an evidence chain:
`workflow → stage → attempt → route → executor/provider operation → workspace checkpoint → capability side effect → verdict/certification`.
The operator surface must answer, without raw logs:
1. What is running now?
2. What completed?
3. Where did it stop?
4. What deterministic code/classification says why?
5. Is recovery automatic, waiting, or impossible?
6. What will the Harness do next?
7. What external/world state must be verified?
8. Which exact runtime/project revisions produced the result?
Trace/span export may be pluggable. The durable journal remains the source of truth.
## Failure-injection readiness suite
Production readiness requires deterministic tests that inject failure at every material boundary:
- host startup before ready;
- runner crash between stage events;
- executor startup timeout;
- prompt transport/provider failure;
- malformed provider response;
- malformed StageResult;
- StageConstraint for every class;
- mutation-stage failure after partial workspace change;
- missing/unreadable approved artifact;
- workspace snapshot/read failure;
- delivery before request, during request, and after remote success before local confirmation;
- commit/push/PR lookup failure;
- certification write/readback failure;
- repair diagnosis/authorization/completion failure;
- host abnormal shutdown;
- restart with previous journal version;
- two workflows targeting the same workspace;
- concurrent workflows on isolated workspaces.
Each test must assert:
- exact durable event sequence;
- side effects performed or not performed;
- recovery disposition;
- retry/reroute count;
- terminal state;
- bounded operator status;
- no secret/raw model output leakage.
## Golden-path certification
A marker-file canary is insufficient as the final readiness gate.
The final controlled validation must use a disposable branch and a small but real engineering change that requires:
`implement → verify → conformance-preflight → delivery → review/QA as policy requires → final conformance → final verification → PR_READY`.
The change must include at least one source edit and one meaningful regression test. It must not auto-merge or deploy.
A second validation must kill/restart the host at a predetermined safe checkpoint and prove deterministic recovery without duplicate delivery.
## Readiness evidence matrix
Codex Engineering Guardrails semantics apply:
`requirement/risk → observable behavior → strongest evidence → PASS / FAIL / PARTIAL / INCONCLUSIVE`.
A green aggregate test command is not sufficient if a material failure mode is not exercised.
Minimum readiness dimensions:
- deterministic lifecycle correctness;
- durable recovery/restart;
- live observability;
- provider failure classification;
- StageConstraint recovery;
- mutation reconciliation;
- external side-effect idempotency;
- security/credential isolation;
- runtime pin reproducibility;
- journal compatibility;
- Windows host lifecycle;
- concurrency/workspace leasing;
- conformance integrity;
- real golden-path workflow.
## Acceptance criteria
- **ACC-R1:** Live status shows current stage/attempt and safe cause/recovery metadata before terminal completion.
- **ACC-R2:** A crash after any durable checkpoint can be reconstructed without in-memory runner state.
- **ACC-R3:** Unknown external side effects are re-read before repetition.
- **ACC-R4:** Every automatic retry/reroute is justified by a typed deterministic recovery policy.
- **ACC-R5:** Mutation-capable attempts are never blindly retried after ambiguous failure.
- **ACC-R6:** All five StageConstraint classes have explicit recovery semantics and deterministic tests.
- **ACC-R7:** OpenCode prompt failures no longer collapse all non-abort exceptions into one operationally useless category when a safe distinction is available.
- **ACC-R8:** Operator status never needs raw stdout/stderr/model output to identify the failing boundary.
- **ACC-R9:** Sandbox/workspace failure does not destroy workflow/session state.
- **ACC-R10:** Journal schema compatibility across the supported upgrade window is tested.
- **ACC-R11:** Same-workspace concurrent mutation is refused; isolated-workspace concurrency is supported/tested.
- **ACC-R12:** Failure-injection matrix passes at the exact candidate runtime revision.
- **ACC-R13:** One real engineering golden path reaches `PR_READY` with all stage evidence.
- **ACC-R14:** One controlled crash/restart golden path resumes without duplicate external mutation.
- **ACC-R15:** Strict conformance, least privilege, and human merge/release/deploy authority remain unchanged.
## Non-goals
- No automatic merge, release, deploy, billing, or database mutation.
- No general certification of every future provider or deployment.
- No mandatory Temporal/LangGraph/OpenHands dependency.
- No distributed multi-tenant scheduler in this phase.
- No weakening of strict result contracts.
- No persistence of raw model transcripts or unrestricted command logs in operator status.
- No speculative fixes before THV2-INVESTIGATION-001 establishes the relevant incident class.
## Delivery slices
1. **THV2-OBSERVABILITY-002** — durable progressive status and correlation.
2. **THV2-RECOVERY-002** — deterministic failure/constraint recovery policy.
3. **THV2-RESUME-002** — checkpoint/restart semantics and journal compatibility.
4. **THV2-SIDE-EFFECTS-002** — idempotent delivery/certification world reconciliation.
5. **THV2-WORKSPACE-002** — workspace leasing, disposable execution and mutation reconciliation.
6. **THV2-PROVIDER-002** — provider-neutral failure taxonomy, OpenCode first.
7. **THV2-CHAOS-002** — deterministic failure-injection matrix.
8. **THV2-GOLDEN-002** — real-workflow and crash/restart certification.
These slices are architectural decomposition, not implementation authorization.
<page url="https://app.notion.com/p/3e8bc1cab14381e39c28e7b8f97aef0f">PLAN-THV2-READINESS-002 — Durable, Observable & Recoverable Harness</page>
## Review alignment — 2026-09-27
Spec v0.2 clarification addendum, applied together with Plan v1.1 at the owner's request. Preserve the existing architectural scope and historical approval. The Plan defines the recovered-mutation union payload, writer-quiescence barrier, stable logical-operation identities, late-effect reconciliation, cross-project lease authority, frozen finite recovery budgets and split Task 7A/7B sequencing.
Every new execution package must freeze new Spec/Plan snapshots and hashes; older workflows retain their original approved artifact identities. Recovery counters/deadlines must survive resume. Required pre-live criteria must all be PASS; PARTIAL and NOT_ASSESSED block just as FAIL and INCONCLUSIVE do. ACC-R13/ACC-R14 live outcomes remain pending until their Goldens and are not circular pre-live requirements.
Acceptance evidence additionally includes orphan/late writers, late remote apply, operation identity across retries, cross-project same-workspace exclusion, persisted budgets after restart and non-PASS gate refusal. No runtime or SDK behavior was validated by this document revision.
## Implementation plan
<mention-page url="https://app.notion.com/p/3e8bc1cab14381e39c28e7b8f97aef0f">PLAN-THV2-READINESS-002 — Durable, Observable & Recoverable Harness</mention-page>
The Spec v0.2 and Plan v1.0 were owner-approved on 2026-09-27. The owner subsequently requested applying the documented review corrections; Plan v1.1 records them. Existing implementation gates remain binding and Golden A/B still require the explicit Task 9 live-certification approval. These document changes do not constitute implementation evidence.
