# Trick Harness V2 PR Review Remediation Design

**Status:** Approved remediation direction from the PR #2 review; implementation not yet started.

**Repository:** `adsonpatrick/trick-harness`

**Consolidation branch:** `docs/harness-v2-bootstrap`

**Audit basis:** PR #2 (`feat/harness-v2-routing-workflows`, head `b0d2f308f8849c6ffaff3bc6f713b1bb923c56b4`) stacked on PR #1 (`docs/harness-v2-bootstrap`).

**Related normative design:** `docs/superpowers/specs/2026-08-25-plurora-engineering-harness-v2-design.md`

**Existing PR #1 correction plans:**

- `docs/superpowers/plans/2026-08-26-fix-plurora-routing-policy.md`
- `docs/superpowers/plans/2026-08-26-fix-executor-quiescent-disposal.md`
- `docs/superpowers/plans/2026-08-26-fix-teardown-failure-observability.md`
- `docs/superpowers/plans/2026-08-26-fix-profile-flat-scalar-validation.md`
- `docs/superpowers/plans/2026-08-26-fix-supabase-preview-branch-policy.md`
- `docs/superpowers/plans/2026-08-26-fix-boundary-import-analysis.md`

---

## 1. Purpose

PR #2 adds the routing, workflow, journal, control-server, delivery and Supabase Preview machinery required by Harness V2, but the review found a recurring integration defect: several safe components exist in isolation while the composed runtime does not actually route authority through them.

This remediation closes every confirmed PR #2 bug while preserving the six PR #1 corrections as mandatory prerequisites. The result must be a single coherent Harness authority model rather than a collection of individually-correct packages.

The branch `docs/harness-v2-bootstrap` remains the consolidation branch for correction specs/plans. Implementation will later consolidate the fixes into one correction branch derived from the implementation stack; this design does not authorize implementation by itself.

---

## 2. Goals

1. Make routing, fallback and manual override behavior true in the live workflow, not only in pure router tests.
2. Preserve the binding Plurora invariant that heavy/high-volume implementation and repair use MiMo V2.5 unless a human explicitly overrides that specific executor run.
3. Make availability failure trigger bounded rerouting while quality failure never masquerades as availability.
4. Ensure deterministic mutation capabilities, not LLM shell authority, own GitHub delivery and Supabase Preview operations.
5. Make durable state sufficient to recover safely after crashes around mutating work.
6. Prevent durable workflow identity reuse and mixed histories.
7. Make security bug auto-repair an explicit deterministic authorization decision.
8. Make the default workflow lifecycle match the approved PR-centric lifecycle.
9. Wire per-run routing override through the control server, workflow and router without mutating global executor configuration.
10. Make GitHub/Supabase subprocess teardown wait for process-tree quiescence and report teardown failures.
11. Make Supabase Preview execution fail closed and stop dependent gates after a failed prerequisite.
12. Bind every workflow objective to the profile that actually executes it.
13. Preserve all six PR #1 corrections and verify them again after the PR #2 remediation is integrated.

---

## 3. Non-goals

- Do not implement Plan C / NeuroVia OpenCode bridge in this remediation.
- Do not merge PR #1 or PR #2 as part of this work.
- Do not add Claude Code as a required executor.
- Do not weaken the project rule that merge, release and deployment remain human-controlled.
- Do not add local Docker Supabase as a fallback.
- Do not infer database relevance from model prose. Database-changing workflows must be identified by deterministic request/project metadata.
- Do not persist raw model transcripts, private reasoning or provider credentials in the Harness journal.

---

## 4. Binding invariants

### 4.1 Heavy work

Without an explicit human override for the affected executor run:

```text
role = implement | repair
AND workload = heavy OR writeVolume = large
=> executor = opencode
=> semantic tier = opencode.workhorse
=> resolved model = MiMo V2.5
```

Heavy QA execution follows the same throughput rule.

**Amended 2026-08-26 by the project owner.** The rule was previously: if OpenCode is unavailable, the Harness must BLOCK rather than route heavy work to Codex. It now reads:

If OpenCode is unavailable, heavy work falls back to Codex **provided Codex is actually usable** — credentialed and not itself degraded. If Codex is not usable either, the Harness **BLOCKS**, and that is an expected outcome rather than a defect: with no executor available there is nothing to route to, and stopping is the correct answer.

What survives the amendment is the prohibition on doing this *silently*. A heavy stage that ran on Codex because OpenCode was down must carry that on the route fact — a `fallback:` reason code naming the executor it came from — so a later reader can tell a policy route from a degraded one. And the downstream consequence must not be hidden either: with OpenCode down, a stage that certifies Codex's own implementation has no independent executor left, and records `independence:unsatisfied` rather than presenting itself as an independent review.

A human may still explicitly override one run; the override must be journaled.

### 4.2 Availability is not quality

Availability failure may cause rerouting. Quality failure may not.

Examples of availability:

```text
usage-limit-exceeded
session-budget-exceeded
server-overloaded
internal-server-error
transport-unavailable
```

Examples of non-availability:

```text
context-window-exceeded
bad-request
sandbox-denied
cyber-policy-refusal
unauthorized
wrong-answer
failed-verification
```

Provider-native categories must be normalized at a single adapter boundary before the router/circuit breaker sees them.

### 4.3 Deterministic mutation authority

LLM executor permission is not the authority for repository delivery or hosted database mutation.

- Git commit/push/PR operations go through `GitHubDelivery`.
- Supabase Preview creation/migrations/gates/cleanup go through `SupabasePreview`.
- Workflow stages may request these capabilities but do not receive a generic shell as a substitute.
- `delivery` is capability-backed, not model-backed.
- Database Preview validation is capability-backed when the workflow request marks a database change.

### 4.4 Durable-before-mutate

No mutating executor or capability may begin until the journal state that identifies the run/stage and mutation risk has been durably flushed.

After each externally-observable mutation, the world must be re-read and a bounded durable fact flushed before the next mutation is allowed.

If the durable flush fails, the mutation does not start.

### 4.5 Workflow identity

`WorkflowObjective.id` identifies the logical objective. `workflowId` identifies one execution attempt.

A `workflowId` is generated by the Harness and is never reused inside the same durable Session. Restart/status APIs address `workflowId`, not `objective.id`.

### 4.6 Security auto-repair

A model finding `SECURITY_BUG` is not, by itself, authority to mutate.

A security repair requires all of:

1. confirmed `SECURITY_BUG`;
2. valid read-only Diagnosis Contract;
3. deterministic `SecurityRepairPolicy` authorization;
4. regression RED where the defect changes behavior;
5. focused GREEN;
6. fresh independent verification.

The initial Plurora policy is fail-closed: if no explicit safe-auto-repair rule matches, the workflow blocks/reports for human decision rather than auto-fixing.

---

## 5. Confirmed PR #2 bugs and required behavior

### R2-01 — Heavy fallback can violate MiMo invariant — CRITICAL

**Current defect:** `opencode-unavailable` fallback can route implementation/repair to Codex, including heavy work.

**Required correction:** fallback selection must apply hard invariants after primary-route failure. Heavy/high-volume implementation, repair and QA execution fall back cross-executor only to an executor that is usable — credentialed and not degraded — and the fallback is recorded as such on the route fact (see the amendment above). Where no usable executor remains, the run is BLOCKED rather than dispatched.

**Acceptance:** a table-driven test with `workload=heavy`, `role=implement|repair|qa`, `degradedExecutors=['opencode']` never returns Codex without override.

### R2-02 — Circuit breaker is not wired into live workflow — CRITICAL

**Current defect:** availability classification/circuit breaker exists as pure routing code, but `WorkflowRunner` ends on `ExecutorResult.status === 'error'` instead of marking the executor degraded and rerouting.

**Required correction:** the runtime owns per-workflow circuit state. On normalized availability failure:

```text
executor error
 -> normalize failure
 -> record breaker transition
 -> add executor to degraded set
 -> resolve authorized fallback for the same stage
 -> journal route-fallback
 -> dispatch fresh executor run
```

The retry counts against `maxExecutorStarts`. Repeated availability failure follows bounded circuit/probe policy. Quality failure does not enter this path.

### R2-03 — Mutation capabilities are constructed but bypassed — CRITICAL

**Current defect:** `composeHarness()` creates GitHub/Supabase integrations, but the workflow dispatches `delivery` to a model executor and does not make Supabase Preview part of the relevant lifecycle.

**Required correction:** add explicit workflow capability ports. Delivery uses `GitHubDeliveryPort`; database-changing workflow validation uses `SupabasePreviewPort`. If a required capability is not enabled/configured, the workflow is `BLOCKED` before mutation.

The model may prepare bounded inputs such as commit message/PR summary only through validated workflow data; it may not execute git/gh/supabase commands directly as the delivery/database authority.

### R2-04 — Plurora profile capability IDs do not match composition — HIGH

**Current defect:** composition checks `supabase-preview` and `control-server`, while `profiles/plurora/integrations.ts` enables `supabase-preview-branches` and omits `control-server`. It also carries stale shared-dev branch configuration.

**Required correction:** one canonical capability vocabulary. Plurora enables `github-delivery`, `supabase-preview`, and `control-server` where required. Supabase profile policy stores the parent project ref, never a shared-dev branch fallback target.

### R2-05 — Journal lacks a pre-mutation durability barrier — HIGH

**Current defect:** important start/route facts may be appended but not flushed before a mutating executor begins.

**Required correction:** introduce a durable stage/capability start barrier. The sequence is:

```text
append workflow/route/start facts
 -> flush succeeds
 -> dispatch mutating executor/capability
```

Read-only stages may use the same barrier for simplicity, but mutating stages cannot bypass it.

Externally-visible delivery/database mutations must also emit post-mutation durable facts before proceeding to the next mutation.

### R2-06 — Workflow IDs can be reused — HIGH

**Current defect:** a completed run can be removed from live memory and another run can reuse the same id, causing journal projections to combine two histories.

**Required correction:** generated `workflowId` per execution attempt, separate from `objective.id`. Control server does not accept arbitrary reuse. Direct composition uses an injectable `workflowIdFactory` for deterministic tests and `crypto.randomUUID()` by default.

### R2-07 — SECURITY_BUG auto-repair has no deterministic safety gate — HIGH

**Current defect:** confirmed `SECURITY_BUG` is included in the generic auto-repairable class list.

**Required correction:** generic triage may identify it as a repair candidate, but repair authorization must consult `SecurityRepairPolicy`. No matching rule means no automatic mutation.

### R2-08 — Default workflow lifecycle differs from approved PR lifecycle — HIGH

**Current defect:** default plan performs review/QA/security before delivery and can end without the approved post-PR independent certification loop.

**Required correction:** default lifecycle becomes:

```text
implement
 -> verify
 -> delivery/open-or-update PR
 -> fresh review
 -> QA where applicable
 -> security where applicable
 -> triage
 -> repair if authorized
 -> verify repaired work
 -> delivery/update PR
 -> repeat fresh certification
 -> final fresh verification
 -> PR READY / terminal non-pass verdict
```

Low-risk work may scale QA/security according to profile policy, but the ordering and fresh certification semantics are fixed.

### R2-09 — Manual override is not plumbed through live APIs — HIGH

**Current defect:** pure `RoutingContext.userOverride` exists, but `WorkflowRunRequest` and the control server do not expose a bounded one-run override.

**Required correction:** add a single-consumption stage override contract:

```text
interface StageRouteOverride {
  readonly role: Role
  readonly executor: string
  readonly semanticModelTier?: string
  readonly reasoningEffort?: string
}
```

The override applies to one matching stage dispatch, is recorded in the route decision reason codes, cannot widen permission mode, cannot enable merge/release/deploy, and cannot mutate global OpenCode/Codex config.

### R2-10 — Integration subprocesses do not prove process-tree quiescence — IMPORTANT

**Current defect:** GitHub/Supabase command helpers can treat the parent process settling as sufficient even when DSH exposes a whole-tree quiescence primitive.

**Required correction:** every owned subprocess command follows the upstream whole-tree contract. Cancellation/teardown waits for quiescence; timeout/escalation failure is observable and cannot be reported as a clean success.

### R2-11 — Supabase Preview runs dependent gates after prerequisite failure — IMPORTANT

**Current defect:** later evidence commands can run after a migration step fails.

**Required correction:** explicit fail-closed state machine:

```text
create
 -> verify isolated preview identity
 -> wait healthy
 -> push migrations
 -> verify migration history
 -> lint
 -> project pgTAP/RLS command
 -> optional type generation
 -> cleanup
```

Failure at one node skips dependent nodes; cleanup still runs in `finally`. No local/shared-dev fallback exists.

### R2-12 — Objective profile identity is not bound to the executing profile — IMPORTANT

**Current defect:** caller-supplied `objective.profileId` can disagree with `HarnessCompositionOptions.profile.id`.

**Required correction:** composition validates equality before journal start or side effects. Mismatch is an input refusal/BLOCKED result with no executor or capability start.

---

## 6. Relationship to PR #1 corrections

The six PR #1 plans remain required and are not superseded. The new remediation depends on them as follows:

| Existing correction | Relationship to PR #2 remediation |
| --- | --- |
| Plurora routing policy | Establishes correct primary routing; R2-01/R2-02/R2-09 complete live fallback/override semantics. |
| Executor quiescent disposal | Establishes runtime quiescence; R2-10 extends the same invariant to integration subprocesses. |
| Teardown failure observability | Establishes provider cleanup evidence; R2-10 requires the same observability across deterministic capabilities. |
| Profile flat-scalar validation | Must remain green after capability/profile schema changes in R2-04/R2-07. |
| Supabase Preview branch policy | Removes shared-dev policy ambiguity; R2-04/R2-11 finish live capability composition/execution. |
| Boundary import analysis | Must remain green after adding new workflow/capability ports and adapters. |

A fix is not considered closed merely because its original unit test passes. The final correction wave must re-run the full cross-package acceptance suite after all PR #1 and PR #2 changes coexist.

---

## 7. Runtime architecture after remediation

```text
                         OpenCode / caller
                               |
                       Loopback Control Server
                               |
                         Workflow Request
                               |
                     +---------+---------+
                     |                   |
               Routeable stages    Capability stages
                     |                   |
          Deterministic Router       GitHubDelivery
                     |               SupabasePreview
              Executor Runtime            |
          OpenCode / Codex provider       |
                     |                   |
                 bounded result      mutation records
                     +---------+---------+
                               |
                         Durable Journal
                               |
                       Workflow Projection
```

The workflow owns orchestration. Router owns executor/model selection. Providers own product-native execution. Capabilities own deterministic external mutation. Journal owns durable facts. No layer substitutes for another.

---

## 8. Required interface changes

### 8.1 Normalized executor failure

Introduce one routing-facing normalization boundary, for example:

```ts
export type RoutingFailureCategory =
  | 'usage-limit-exceeded'
  | 'session-budget-exceeded'
  | 'server-overloaded'
  | 'internal-server-error'
  | 'transport-unavailable'
  | 'context-window-exceeded'
  | 'bad-request'
  | 'sandbox-denied'
  | 'cyber-policy-refusal'
  | 'unauthorized'
  | 'quality-failure'
  | 'other'

export interface NormalizedExecutorFailure {
  readonly category: RoutingFailureCategory
  readonly availability: boolean
  readonly safeDiagnostic: string
}
```

Provider packages retain native taxonomy internally; one adapter maps native categories to this vocabulary.

### 8.2 Workflow capabilities

```text
export interface GitHubDeliveryPort {
  deliver(request: DeliveryRequest): Promise<DeliveryOutcome>
}

export interface SupabasePreviewPort {
  verify(request: SupabasePreviewRequest): Promise<SupabasePreviewOutcome>
}

export interface WorkflowCapabilities {
  readonly delivery?: GitHubDeliveryPort
  readonly supabasePreview?: SupabasePreviewPort
}
```

The runner receives these ports from composition. Tests use fakes with the same contracts.

### 8.3 Workflow request

Extend the request with bounded runtime decisions:

```text
export interface WorkflowRunRequest {
  readonly objective: WorkflowObjective
  readonly routeOverride?: StageRouteOverride
  readonly databaseChange?: {
    readonly required: true
    readonly migrationPaths: readonly string[]
  }
  // existing interpreter/task/diagnose/repair evidence fields remain
}
```

No database credentials or provider secrets are part of the request.

### 8.4 Workflow ID generation

Composition owns:

```text
readonly workflowIdFactory?: () => string
```

Default: `crypto.randomUUID()`.

### 8.5 Security repair policy

```text
export interface SecurityRepairPolicy {
  authorize(input: {
    readonly finding: Finding
    readonly diagnosis: DiagnosisContract
    readonly objective: WorkflowObjective
  }): { readonly allowed: boolean; readonly reasonCode: string }
}
```

No implementation may delegate this authorization decision to model prose.

---

## 9. Journal and restart semantics

The event vocabulary may be extended with capability-specific start/end facts when that produces clearer durable semantics than overloading executor events. If added, the events must be declared in DSH Session event types and reconstruction must fail closed when the build cannot interpret them.

At minimum the projection must distinguish:

- workflow started/ended;
- route chosen and fallback reason;
- executor stage in flight;
- deterministic capability in flight;
- confirmed external mutation already observed;
- circuit state;
- findings/diagnosis/verdict;
- blocker;
- PR/delivery identity.

`requiresWorldVerification` is true whenever a crash could have happened after mutation authority was granted and before the final world state was durably confirmed.

A restart never blindly resumes a partially observed mutating stage.

---

## 10. Supabase cloud-only semantics

Plurora policy uses parent project ref `uljaajwwnygopsyvwsre` as the branch-management parent. It does not name `neurovia-dev` as a fallback execution database.

For a database-changing workflow:

1. create a Preview Branch from the parent project;
2. obtain the created branch project ref from structured CLI output;
3. assert `previewProjectRef !== parentProjectRef`;
4. wait for healthy branch state;
5. obtain branch-specific connection inputs through supported CLI output;
6. execute migrations/gates against that Preview Branch only;
7. stop dependent checks immediately on failure;
8. clean up the Preview Branch;
9. report cleanup independently from primary gate result;
10. never fall back to parent/shared dev/local Docker.

The implementation must validate current installed Supabase CLI flags before relying on them, consistent with the existing Plan B design.

---

## 11. Testing strategy

### 11.1 Deterministic unit tests

Required new tests include:

- heavy OpenCode outage blocks instead of routing to Codex;
- explicit override can authorize a one-run heavy alternate route and is logged;
- Codex `usageLimitExceeded` normalizes to availability and reroutes live workflow;
- bad request/context window/wrong answer never trigger availability fallback;
- circuit transition survives replay;
- duplicate/reused workflow IDs cannot mix histories;
- profile mismatch starts no executor/capability;
- security bug without deterministic authorization never starts repair;
- delivery stage never calls executor runtime;
- DB-changing workflow never skips required Supabase Preview capability;
- migration failure skips lint/tests but cleanup still runs;
- integration cancellation waits for process-tree quiescence;
- durable flush failure prevents mutating dispatch.

### 11.2 Cross-package composition tests

Use the real `pluroraProfile`, not synthetic profiles, to prove:

- canonical capability ids compose;
- control server is available when enabled;
- Supabase/GitHub capabilities are the paths used by their stages;
- primary/fallback route behavior matches profile policy;
- default lifecycle reaches post-PR review/QA/security/final verification ordering.

### 11.3 Real-product smoke tests

Before PR READY:

- OpenCode Go: scoped model selection and no global config mutation;
- Codex native ChatGPT auth: per-run model/effort, no API-key injection;
- GitHub: disposable feature branch/PR, no merge;
- Supabase: real ephemeral Preview Branch, migration/gates/cleanup, parent project unchanged.

These smoke tests supplement deterministic suites; they do not replace them.

---

## 12. Acceptance criteria

The remediation is complete only when all of the following are true:

1. All six PR #1 correction plans are implemented and independently verified.
2. Heavy/high-volume implementation, repair and QA execution never auto-fallback to Codex.
3. Explicit human override can alter one executor run without widening permissions or mutating global config.
4. Live workflow availability failure triggers circuit transition and authorized reroute.
5. Quality failure never triggers availability fallback.
6. Provider-native failure categories are normalized once and tested exhaustively.
7. Delivery is executed only through `GitHubDelivery` capability.
8. Required database validation is executed only through `SupabasePreview` capability.
9. Real `pluroraProfile` composes `github-delivery`, `supabase-preview`, and `control-server` consistently.
10. `neurovia-dev` is not an automatic database fallback target.
11. Mutating work cannot start before a successful durable journal barrier.
12. Externally-observed mutations are durably recorded before the next mutation.
13. Workflow run IDs are unique execution IDs and cannot merge histories.
14. SECURITY_BUG auto-repair requires deterministic policy authorization.
15. Default lifecycle is PR-centric and performs fresh post-PR certification.
16. GitHub/Supabase subprocesses wait for whole-tree quiescence.
17. Supabase dependent gates stop after prerequisite failure while cleanup still executes.
18. `objective.profileId` must equal the composed profile id before any side effect.
19. No confirmed material bug remains when workflow claims PASS/PR READY.
20. Full package tests, constraints, typecheck, lint, build, doc-sync and correction acceptance matrix are green with fresh evidence.
21. Real Supabase Preview canary proves isolated branch creation and cleanup without parent mutation.
22. Real GitHub canary proves commit/push/PR without merge or protected-branch mutation.

---

## 13. Rollout order

The correction wave is dependency-ordered:

```text
PR #1 foundation corrections
  -> PR #1 routing/Supabase policy corrections
  -> live routing/fallback/override remediation
  -> journal/control identity + durability remediation
  -> deterministic integration safety remediation
  -> workflow authority/lifecycle composition remediation
  -> full independent verification and real canaries
```

Plan C remains blocked until this remediation reaches fresh PASS evidence.

---

## 14. Design self-review

- No TODO/TBD placeholders remain.
- Every confirmed PR #2 finding maps to an explicit required behavior and acceptance criterion.
- The design does not duplicate the six PR #1 correction plans; it treats them as prerequisites and defines the additional integration semantics they did not cover.
- Heavy work, security repair, database isolation and merge authority all fail closed.
- Workflow identity and durable state are separated explicitly.
- The implementation scope is large enough to require multiple implementation plans rather than one monolithic task list.
