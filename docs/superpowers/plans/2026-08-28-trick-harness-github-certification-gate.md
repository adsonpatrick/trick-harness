# Trick Harness GitHub Certification Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Plurora `PR_READY` publish a fail-closed GitHub commit status bound to the exact PR head SHA, so branch protection can require Harness engineering certification without granting Harness merge authority.

**Architecture:** Add a generic workflow certification port and a narrowly scoped `@trick-harness/github-certification` integration. The workflow publishes `pending` after every delivery/redelivery and only publishes `success` from the deterministic post-Plan-F/G readiness decision; the integration independently re-reads repository/branch/PR/head identity before each status mutation. Plurora host composition requires this capability, while NeuroVia branch-protection activation is handled by the companion wiring overlay after a real status has been produced.

**Tech Stack:** TypeScript, Node.js `^22.19.0 || >=24.0.0`, pnpm `11.7.0`, existing DSH managed subprocess seam, native `git` + `gh`, GitHub Commit Status REST API, existing contracts/journal/engineering-workflow/composition/profile packages, post-Plan-E/F/G `apps/plurora-harness-host`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-harness-v2-github-certification-gate-amendment.md`

**Requires:** Plans E, F and G complete and independently reviewed. Execute Plan H against the final reviewed post-Plan-G head. If Plan F/G renamed a readiness/conformance/change-impact seam, reconcile the plan to that reviewed tree before implementation; do not guess around signature drift.

## Global Constraints

- Plurora certification context is exactly `plurora/harness-certification`.
- A model, task, objective, project config or route override cannot choose certification context/state/SHA.
- Certification is a deterministic capability; no executor receives GitHub status mutation authority.
- `github-certification` is separate from `github-delivery` and has no commit/push/PR-edit/merge/release/deploy methods.
- Before every POST, repository identity, local branch, local HEAD, PR state/base/head branch and PR head SHA are re-read.
- `success` is possible only for the exact revision already established as `PR_READY` by Plan F/G lifecycle logic.
- Every delivery/redelivery publishes `pending` before certifying stages continue.
- A certification capability/auth/network failure is fail-closed and cannot produce `PR_READY`.
- Native `gh` authentication remains the only GitHub credential path; no token is read/injected/journalled.
- Status description is a fixed trusted string selected only from certification state, at most 120 characters; target URL is the verified PR URL.
- No prompt, model summary, raw output, reasoning, filesystem path, DB URL or secret may be copied into GitHub status fields.
- Status mutation follows durable-before-mutate capability semantics.
- Existing GitHubDelivery authority and MiMo/routing invariants remain unchanged.
- Merge/release/deploy remain human-controlled.

---

### Task 1: Add Generic Workflow Certification Contracts

**Files:**
- Modify: `packages/core/engineering-workflow/src/types.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Test: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Test: `packages/core/engineering-workflow/tests/lifecycle.spec.ts`

**Interfaces:**

```ts
export const EXTERNAL_CERTIFICATION_STATES = [
  'pending',
  'success',
  'failure',
  'error',
] as const

export type ExternalCertificationState =
  typeof EXTERNAL_CERTIFICATION_STATES[number]

export interface WorkflowCertificationInput {
  readonly objective: WorkflowObjective
  readonly state: ExternalCertificationState
  readonly expectedRevision?: string
}

export interface WorkflowCertificationResult {
  readonly revision: string
  readonly externalId: string
  readonly url?: string
  readonly evidence: readonly EvidenceRef[]
}

export interface CertificationCapabilityPort {
  publish(
    input: WorkflowCertificationInput,
    signal: AbortSignal,
  ): Promise<WorkflowCertificationResult>
}

export interface WorkflowCapabilities {
  readonly delivery?: DeliveryCapabilityPort
  readonly databaseVerification?: DatabaseVerificationCapabilityPort
  readonly certification?: CertificationCapabilityPort
}
```

Add a deterministic internal readiness projection used only by the workflow owner:

```ts
export interface WorkflowCertificationDecision {
  readonly ready: boolean
  readonly verdict: WorkflowVerdict
  readonly summary: string
}
```

The decision's `ready=true` branch must call the exact same post-Plan-F/G readiness predicate that permits `PR_READY`; it may not duplicate a weaker checklist. `summary` remains internal/journal-facing and is never sent to GitHub status fields.

- [x] **Step 1: Write RED contract/runtime tests** proving the new states are bounded and `WorkflowCapabilities.certification` is callable only through the workflow runtime.

Representative assertion:

```ts
expect(EXTERNAL_CERTIFICATION_STATES).toEqual([
  'pending', 'success', 'failure', 'error',
])
```

- [x] **Step 2: Write RED lifecycle tests** proving `ready=true` cannot be constructed before `conformance=PASS` and `verify-final=PASS` under the post-Plan-F lifecycle fixture.
- [x] **Step 3: Run RED.**

```bash
corepack pnpm vitest run \
  packages/core/engineering-workflow/tests/workflow.spec.ts \
  packages/core/engineering-workflow/tests/lifecycle.spec.ts
```

- [x] **Step 4: Implement the contracts and a single readiness-to-certification decision helper** beside the existing final readiness reconciliation. Do not add GitHub vocabulary to Core.
- [x] **Step 5: Run GREEN + typecheck.**

```bash
corepack pnpm vitest run \
  packages/core/engineering-workflow/tests/workflow.spec.ts \
  packages/core/engineering-workflow/tests/lifecycle.spec.ts
corepack pnpm run typecheck
```

- [x] **Step 6: Commit.**

```bash
git add packages/core/engineering-workflow
git commit -m "feat(trick): add external certification capability contract"
```

---

### Task 2: Build the Narrow GitHub Certification Integration

**Files:**
- Create: `packages/integrations/github-certification/package.json`
- Create: `packages/integrations/github-certification/tsconfig.json`
- Create: `packages/integrations/github-certification/src/commands.ts`
- Create: `packages/integrations/github-certification/src/types.ts`
- Create: `packages/integrations/github-certification/src/index.ts`
- Create: `packages/integrations/github-certification/tests/commands.spec.ts`
- Create: `packages/integrations/github-certification/tests/certification.spec.ts`

**Package boundary:**

```ts
export interface GitHubCertificationOptions {
  readonly cwd: string
  readonly repository: string
  readonly baseBranch: string
  readonly context: string
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  readonly graceMs?: number
}

export class GitHubCertification {
  constructor(options: GitHubCertificationOptions)
  publish(
    input: WorkflowCertificationInput,
    signal?: AbortSignal,
  ): Promise<WorkflowCertificationResult>
}
```

`GitHubCertification` exposes no delivery/merge/release API and accepts no environment/token option.

**Fixed description mapping:**

```ts
const STATUS_DESCRIPTIONS: Record<ExternalCertificationState, string> = {
  pending: 'Harness engineering certification in progress',
  success: 'Harness engineering certification passed',
  failure: 'Harness engineering certification did not pass',
  error: 'Harness engineering certification could not complete',
}
```

**Fixed command vocabulary:**

```ts
currentBranchArgv()
// ['git', 'branch', '--show-current']

localHeadArgv()
// ['git', 'rev-parse', 'HEAD']

repositoryIdentityArgv()
// ['gh', 'repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']

currentPrIdentityArgv()
// ['gh', 'pr', 'view', '--json', 'number,url']

pullRequestStateArgv(repository, number)
// ['gh', 'api', `repos/${repository}/pulls/${number}`]

createStatusArgv(repository, sha, body)
// gh api --method POST repos/<repo>/statuses/<sha>
// fixed state/context/description/target_url fields

readStatusesArgv(repository, sha)
// ['gh', 'api', `repos/${repository}/commits/${sha}/statuses`]
```

All commands are argv arrays and use managed subprocess ownership + `waitForExit()` exactly as `github-delivery` does.

**Validated PR projection:**

```ts
interface GitHubCertificationTarget {
  readonly repository: string
  readonly pullRequestNumber: number
  readonly pullRequestUrl: string
  readonly branch: string
  readonly revision: string
  readonly baseBranch: string
}
```

- [ ] **Step 1: Write RED command tests** proving every endpoint/argv is fixed and that repository, PR number and SHA are validated before interpolation. Reject repository strings outside `owner/repo`, non-positive PR numbers and non-40-hex SHAs.
- [ ] **Step 2: Write RED identity tests** for wrong repository, detached/empty branch, closed PR, wrong base branch, PR head branch mismatch, local HEAD vs PR head mismatch and `expectedRevision` mismatch. Every case must perform zero POST-status calls.
- [ ] **Step 3: Write RED status tests** proving only `pending|success|failure|error` are accepted, context is the constructor's trusted value, descriptions come only from `STATUS_DESCRIPTIONS`, target URL comes from the verified PR, and raw subprocess/model output is absent from errors/evidence/status fields.
- [ ] **Step 4: Write RED publication verification tests** proving POST is followed by a bounded GET of statuses and the latest matching context must report the requested state; mismatch produces a certification error.
- [ ] **Step 5: Write RED subprocess lifecycle tests** proving cancellation still waits for whole-process-tree quiescence and no token/environment credential is constructed/injected by this integration.
- [ ] **Step 6: Run RED.**

```bash
corepack pnpm vitest run \
  packages/integrations/github-certification/tests/commands.spec.ts \
  packages/integrations/github-certification/tests/certification.spec.ts
```

- [ ] **Step 7: Implement the package** by following the bounded-output, argv-array and `waitForExit()` pattern already proven in `packages/integrations/github-delivery` rather than importing delivery mutation helpers.
- [ ] **Step 8: Run GREEN + constraints/typecheck.**

```bash
corepack pnpm vitest run \
  packages/integrations/github-certification/tests/commands.spec.ts \
  packages/integrations/github-certification/tests/certification.spec.ts
corepack pnpm run constraints
corepack pnpm run typecheck
```

- [ ] **Step 9: Commit.**

```bash
git add packages/integrations/github-certification
git commit -m "feat(trick): add scoped GitHub certification integration"
```

---

### Task 3: Publish Pending After Every Delivery and Redelivery

**Files:**
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/src/types.ts`
- Test: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Test: `packages/core/engineering-workflow/tests/lifecycle.spec.ts`
- Test: `packages/core/engineering-workflow/tests/repair.spec.ts`

**State owned by one run:**

```ts
let certifiedRevision: string | undefined
let certificationStarted = false
```

**Required ordering after a successful delivery:**

```text
delivery confirmed
-> durable capability-start for certification
-> certification.publish(state='pending')
-> bounded certification result recorded/flushed
-> certifiedRevision = result.revision
-> certifying stages may continue
```

For redelivery after repair, repeat the sequence and replace `certifiedRevision` with the new published revision.

- [ ] **Step 1: Write RED test** proving normal delivery calls certification exactly once with `pending` before Review is dispatched.
- [ ] **Step 2: Write RED repair test** where a review finding triggers repair/redelivery; assert call order:

```text
pending(sha1)
review
repair
redelivery
pending(sha2)
re-review
...
```

and assert `sha2` becomes the only revision eligible for terminal success.
- [ ] **Step 3: Write RED missing-capability test** for Plurora composition semantics: a workflow that requires certification and has no certification port ends fail-closed before a certifying stage can claim readiness.
- [ ] **Step 4: Write RED same-SHA rerun test** proving a second certification run publishes `pending` again if it reaches the published certification boundary, even if the previous latest status for that SHA was success.
- [ ] **Step 5: Run RED.**

```bash
corepack pnpm vitest run \
  packages/core/engineering-workflow/tests/workflow.spec.ts \
  packages/core/engineering-workflow/tests/lifecycle.spec.ts \
  packages/core/engineering-workflow/tests/repair.spec.ts
```

- [ ] **Step 6: Implement pending publication in the workflow owner**, not in a model stage/interpreter. Treat publish failure as external certification failure and do not continue to an eventual `PR_READY` path.
- [ ] **Step 7: Run GREEN.**

```bash
corepack pnpm vitest run \
  packages/core/engineering-workflow/tests/workflow.spec.ts \
  packages/core/engineering-workflow/tests/lifecycle.spec.ts \
  packages/core/engineering-workflow/tests/repair.spec.ts
```

- [ ] **Step 8: Commit.**

```bash
git add packages/core/engineering-workflow
git commit -m "feat(trick): mark delivered revisions certification pending"
```

---

### Task 4: Publish Terminal Certification from One Centralized Finish Path

**Files:**
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/src/lifecycle.ts`
- Test: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Test: `packages/core/engineering-workflow/tests/lifecycle.spec.ts`
- Test: `packages/core/engineering-workflow/tests/repair.spec.ts`

**External mapping:**

```ts
function externalCertificationState(input: {
  ready: boolean
  verdict: WorkflowVerdict
  operationalFailure: boolean
  canceled: boolean
}): ExternalCertificationState {
  if (input.canceled || input.operationalFailure) return 'error'
  if (input.ready) return 'success'
  return 'failure'
}
```

`ready=true` is valid only after the existing post-Plan-F/G final readiness predicate passes.

**Centralized termination invariant:**

Every terminal path that occurs after a `pending` status was published must pass through one helper that attempts terminal certification before the workflow writes its final terminal outcome. No early return may bypass it.

- [ ] **Step 1: Write RED success test** proving call order ends:

```text
conformance PASS
verify-final PASS
readiness predicate true
certification.publish(success, expectedRevision=latestPendingRevision)
workflow terminal PR_READY
```

- [ ] **Step 2: Write RED non-ready matrix test** covering `FAIL`, `PARTIAL`, `BLOCKED` and terminal `INCONCLUSIVE`; each publishes `failure`, never success.
- [ ] **Step 3: Write RED cancel/runtime-error tests** proving they publish `error` when a pending certification exists.
- [ ] **Step 4: Write RED stale-revision test** where the capability reports the PR head moved between pending and terminal; workflow must end `INCONCLUSIVE`/not-ready and never emit `PR_READY`.
- [ ] **Step 5: Write RED publisher-failure test** proving inability to publish terminal success cannot be converted to `PR_READY`; the repository remains blocked by pending/absent/error status.
- [ ] **Step 6: Run RED.**

```bash
corepack pnpm vitest run \
  packages/core/engineering-workflow/tests/workflow.spec.ts \
  packages/core/engineering-workflow/tests/lifecycle.spec.ts \
  packages/core/engineering-workflow/tests/repair.spec.ts
```

- [ ] **Step 7: Refactor terminal outcome construction through one internal finish helper** and implement the mapping above. Preserve user-facing `WorkflowVerdict`; external GitHub state is a separate projection.
- [ ] **Step 8: Run GREEN + typecheck.**

```bash
corepack pnpm vitest run \
  packages/core/engineering-workflow/tests/workflow.spec.ts \
  packages/core/engineering-workflow/tests/lifecycle.spec.ts \
  packages/core/engineering-workflow/tests/repair.spec.ts
corepack pnpm run typecheck
```

- [ ] **Step 9: Commit.**

```bash
git add packages/core/engineering-workflow
git commit -m "feat(trick): publish terminal PR certification status"
```

---

### Task 5: Persist Bounded Certification Evidence and Restart Semantics

**Files:**
- Modify: `packages/core/journal/src/types.ts`
- Modify: `packages/core/journal/src/index.ts`
- Modify: `packages/core/journal/src/invariant.ts`
- Modify: `packages/core/journal/tests/journal.spec.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/tests/restart.spec.ts`
- Modify: `packages/core/control-server/src/index.ts`
- Modify: `packages/core/control-server/tests/server.spec.ts`

**Durable record:**

```ts
export interface CertificationRecord {
  readonly revision: string
  readonly externalId: string
  readonly state: ExternalCertificationState
  readonly context: string
  readonly summary: string
  readonly evidence: readonly EvidenceRef[]
}
```

Projection exposes ordered records and `latestCertification` only. It does not persist PR HTML, command output, tokens or model content beyond bounded evidence locators. `summary` is generated deterministically from state, not copied from model output.

- [ ] **Step 1: Write RED journal tests** proving certification records round-trip, revision is 40-hex, state is bounded, context/summary are length-bounded and raw credential-shaped fields are rejected by parser/invariant checks.
- [ ] **Step 2: Write RED durability test** proving capability-start is flushed before the POST seam is invoked and the confirmed certification record is flushed after publication.
- [ ] **Step 3: Write RED crash-window restart test**: journal has an open certification capability but no terminal certification record; `assessRestart` requires world verification and retry may not blindly publish success.
- [ ] **Step 4: Write RED control-server test** proving status returns only bounded certification state/revision/external id plus existing workflow fields.
- [ ] **Step 5: Run RED.**

```bash
corepack pnpm vitest run \
  packages/core/journal/tests/journal.spec.ts \
  packages/core/engineering-workflow/tests/restart.spec.ts \
  packages/core/control-server/tests/server.spec.ts
```

- [ ] **Step 6: Implement journal/projection/control status support** using the current capability durability mechanism; do not invent a second persistence backend.
- [ ] **Step 7: Run GREEN + typecheck.**

```bash
corepack pnpm vitest run \
  packages/core/journal/tests/journal.spec.ts \
  packages/core/engineering-workflow/tests/restart.spec.ts \
  packages/core/control-server/tests/server.spec.ts
corepack pnpm run typecheck
```

- [ ] **Step 8: Commit.**

```bash
git add packages/core/journal packages/core/engineering-workflow packages/core/control-server
git commit -m "feat(trick): persist GitHub certification evidence"
```

---

### Task 6: Compose Certification as a Required Plurora Capability

**Files:**
- Modify: `packages/composition/runtime/src/harness.ts`
- Modify: `packages/composition/runtime/tests/harness.spec.ts`
- Modify: `profiles/plurora/integrations.ts`
- Modify: `profiles/plurora/tests/profile.spec.ts`
- Modify: `profiles/plurora/tests/composition.spec.ts`
- Modify: `apps/plurora-harness-host/src/config.ts`
- Modify: `apps/plurora-harness-host/src/main.ts`
- Modify: `apps/plurora-harness-host/tests/config.spec.ts`
- Modify: `apps/plurora-harness-host/tests/host.spec.ts`

**Post-Plan-E host config addition:**

```ts
interface PluroraDeploymentConfig {
  // existing fields
  readonly projectRepository: 'adsonpatrick/neuro-via'
}
```

The certification context is **not** a project-config field. The Plurora host owns:

```ts
const PLURORA_CERTIFICATION_CONTEXT = 'plurora/harness-certification'
```

Composition binds:

```ts
new GitHubCertification({
  cwd: projectRoot,
  repository: config.projectRepository,
  baseBranch: 'main',
  context: PLURORA_CERTIFICATION_CONTEXT,
  spawn: ctx.subprocess.spawn,
})
```

- [ ] **Step 1: Write RED profile tests** requiring `github-certification` in Plurora's enabled integration/capability set.
- [ ] **Step 2: Write RED composition tests** proving Plurora runnable composition refuses to become ready without certification while the minimal fixture profile can still run without a GitHub certification capability.
- [ ] **Step 3: Write RED config tests** requiring exact `projectRepository`, refusing credential-shaped repository config, and proving `plurora-harness.json` cannot override status context or base branch.
- [ ] **Step 4: Write RED host test** proving the bound certification integration uses project cwd + configured project repository + fixed Plurora context, and uses the same managed subprocess seam as delivery.
- [ ] **Step 5: Run RED.**

```bash
corepack pnpm vitest run \
  packages/composition/runtime/tests/harness.spec.ts \
  profiles/plurora/tests/profile.spec.ts \
  profiles/plurora/tests/composition.spec.ts \
  apps/plurora-harness-host/tests/config.spec.ts \
  apps/plurora-harness-host/tests/host.spec.ts
```

- [ ] **Step 6: Implement composition/profile/host wiring** without moving project repository identity into generic packages.
- [ ] **Step 7: Run GREEN + constraints/typecheck.**

```bash
corepack pnpm vitest run \
  packages/composition/runtime/tests/harness.spec.ts \
  profiles/plurora/tests/profile.spec.ts \
  profiles/plurora/tests/composition.spec.ts \
  apps/plurora-harness-host/tests/config.spec.ts \
  apps/plurora-harness-host/tests/host.spec.ts
corepack pnpm run constraints
corepack pnpm run typecheck
```

- [ ] **Step 8: Commit.**

```bash
git add packages/composition/runtime profiles/plurora apps/plurora-harness-host
git commit -m "feat(trick): require Plurora GitHub certification capability"
```

---

### Task 7: Add Adversarial Certification Tests

**Files:**
- Create: `profiles/plurora/tests/certification.spec.ts`
- Modify: `profiles/plurora/tests/composition.spec.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Modify: `packages/integrations/github-certification/tests/certification.spec.ts`

**Mandatory adversarial matrix:**

```text
CI green but conformance missing                    -> never success
conformance PASS but verify-final missing           -> never success
security required by Plan G but skipped/failed      -> never success
old success on same SHA + new run                   -> latest state becomes pending
pending SHA A + external PR head moves to SHA B     -> stale-ref refusal, never success
repair redelivery SHA A -> SHA B                    -> pending B required; success A irrelevant
wrong repository                                   -> zero POST
wrong base branch                                  -> zero POST
closed PR                                          -> zero POST
missing certification capability                   -> Plurora not PR_READY
publisher auth/network failure                     -> fail closed
terminal BLOCKED                                   -> failure, not success
cancellation after pending                         -> error, not success
model/raw output contains secret/path material      -> status description remains fixed safe text
```

- [ ] **Step 1: Implement the adversarial tests using fakes at the subprocess/capability seam**, not by mocking the readiness predicate itself.
- [ ] **Step 2: Run the focused matrix.**

```bash
corepack pnpm vitest run \
  profiles/plurora/tests/certification.spec.ts \
  profiles/plurora/tests/composition.spec.ts \
  packages/core/engineering-workflow/tests/workflow.spec.ts \
  packages/integrations/github-certification/tests/certification.spec.ts
```

- [ ] **Step 3: Fix only confirmed Plan H defects and rerun the affected tests.**
- [ ] **Step 4: Commit.**

```bash
git add profiles/plurora/tests packages/core/engineering-workflow/tests packages/integrations/github-certification/tests
git commit -m "test(trick): harden PR certification invariants"
```

---

### Task 8: Fresh Harness-Side Verification and Handoff to NeuroVia Wiring

**Files:**
- Create: `docs/verification/2026-08-28-harness-v2-plan-h-certification-evidence.md`
- Modify: `README.trick-harness.md`

**Deterministic gates:**

```bash
corepack pnpm run constraints
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run build
corepack pnpm run test:trick
corepack pnpm --filter @trick-harness/plurora-host test
```

- [ ] **Step 1: Run all deterministic gates fresh** and record command, exit status and material result.
- [ ] **Step 2: Run a real authenticated read-only GitHub certification canary on the Plan H implementation PR** using native `gh` auth and a dedicated non-required canary context, ending in a non-success state. This proves the real endpoint/identity/read-back path without falsely claiming the Trick PR itself passed Plurora's production certification contract.
- [ ] **Step 3: Re-read the canary commit statuses** and verify exact SHA/context/latest state through GitHub.
- [ ] **Step 4: Perform independent code/security review** of endpoint construction, repository/head binding, status-state mapping, fixed safe descriptions, subprocess lifecycle, durability ordering and absence of merge authority.
- [ ] **Step 5: Fix confirmed defects and rerun all affected gates.**
- [ ] **Step 6: Record the final reviewed exact Trick Harness SHA.** This SHA supersedes the post-Plan-G intermediate SHA for initial NeuroVia installation.
- [ ] **Step 7: Update README only with implemented/proven behavior and commit.**

```bash
git add README.trick-harness.md docs/verification/2026-08-28-harness-v2-plan-h-certification-evidence.md
git commit -m "docs(trick): record Plan H certification evidence"
```

## Completion Contract

Plan H Harness-side work is complete only when the runtime owns certification state, every successful delivery/redelivery is marked `pending`, terminal `success` is reachable only from the exact post-Plan-F/G `PR_READY` decision for the same re-read PR head SHA, all non-ready/error states fail closed, GitHub status descriptions are fixed trusted strings rather than model/workflow text, certification evidence is durable/bounded/restart-safe, Plurora composition requires the capability, native `gh` auth remains unchanged, no merge/release/deploy authority was introduced, adversarial tests pass and a reviewed exact SHA is recorded for the companion NeuroVia certification wiring overlay.
