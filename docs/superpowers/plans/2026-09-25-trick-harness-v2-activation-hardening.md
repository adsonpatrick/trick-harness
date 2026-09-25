# Trick Harness V2 Activation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Trick Harness V2 so Plurora distinguishes artifact defects from environmental/provider failures, constrains every automatic repair to deterministic approved scope, and proves the integrated system with a fresh zero-repair activation canary.

**Architecture:** Shared contracts define stage constraints and canonical executor failure classes; the engineering workflow derives effective verdicts and repair authority from deterministic facts rather than model prose. A project-supplied workspace reader fingerprints actual mutations before and after repair, while the Plurora host uses deterministic Git/workspace state for delivery and NeuroVia performs a narrow hermetic runtime checkout check before the final pinned canary.

**Tech Stack:** TypeScript 6, Node.js 22.19+/24+, pnpm 11.7.0, Vitest 4, `@opencode-ai/sdk@1.18.23`, Git, Node test runner in NeuroVia.

**Spec:** `docs/superpowers/specs/2026-09-25-trick-harness-v2-activation-hardening-design.md`

## Global Constraints

- Keep `@opencode-ai/sdk` pinned at exactly `1.18.23`; this plan does not authorize an SDK upgrade.
- Merge remains human-controlled. Agents may prepare commits/PRs and certification; they may not merge the activation PR.
- Never persist raw provider response bodies, stacks, environment dumps, credentials, connection strings, tokens, or child transcripts.
- `Finding`, `StageConstraint`, and `ExecutorFailure` remain separate concepts. No adapter or reconciler may translate one into another from prose.
- Only deterministic Control Plane state grants write authority. Finding/diagnosis text may describe proposed paths but cannot expand scope.
- Automatic repair requires deterministic `plannedPaths()`; absence of that reading is fail-closed for repair.
- Repair scope is checked both before writable dispatch and after the repair returns.
- Agent-reported `diff` evidence remains evidence only and must not define the delivery write-set.
- `FAIL` means an artifact defect was established. Provider failures, invalid envelopes, cancellations, and required checks blocked by environment resolve to `INCONCLUSIVE`.
- NeuroVia runtime hermeticity neutralizes only `core.excludesFile`; do not suppress all global/system Git configuration.
- Keep Trick Harness and NeuroVia implementation commits separate by repository and responsibility.
- Use isolated worktrees at execution time; do not implement directly on an unrelated dirty checkout.
- Before any cross-repository pin update, use an exact immutable 40-hex Trick Harness commit SHA.
- A cross-repository approved artifact is readable only through a deployment-registered local source; never accept operator-supplied URLs, branches, checkout paths, or network fetches.

## Review Focus

1. **Already-dirty file changed again by a repair:** the pre/post workspace fingerprints must still detect the second mutation; Task 7 adds this test.
2. **Rename/delete/untracked paths with unusual characters:** deterministic workspace/delivery readers must preserve both affected paths without shell parsing; Task 7 adds these cases.
3. **Older journals with none of the new event types:** replay must still reconstruct successfully with empty/absent new facts; Task 4 pins backward compatibility.
4. **Unexpected OpenCode errors that are neither a known abort nor startup failure:** they must normalize to canonical `other` with a fixed safe code and no leaked message; Task 8 covers this.
5. **Repairable finding when `plannedPaths()` is unavailable:** the run must refuse writable repair rather than infer scope; Task 6 covers this.

---

### Task 0: Resolve approved artifacts from a registered external repository

**Repository:** `adsonpatrick/trick-harness`

**Files:**
- Modify: `packages/core/contracts/src/types.ts`
- Modify: `packages/core/contracts/src/index.ts`
- Modify: `packages/core/contracts/tests/contracts.spec.ts`
- Modify: `apps/plurora-harness-host/src/workflow-handlers.ts`
- Modify: `apps/plurora-harness-host/src/main.ts`
- Modify: `apps/plurora-harness-host/tests/workflow-handlers.spec.ts`
- Modify: `apps/plurora-harness-host/tests/host.spec.ts`

**Interfaces:**
- Consumes: a deployment-owned registry whose source id maps to a canonical repository identity and absolute local checkout.
- Produces: an `ApprovedArtifactSet` that either reads both same-revision external artifacts after remote/revision/path/hash verification or refuses before any executor is started.

- [ ] **Step 1: Add failing contract and host tests**

Cover a local registered source that accepts a same-source exact revision and byte-hashed Spec/Plan. Add negative tests for an unknown source id, non-40-hex revision, remote mismatch, checked-out revision mismatch, path traversal, artifact hash mismatch, and attempting to mix local/external or two external sources. Assert that none starts an executor.

- [ ] **Step 2: Define a closed source reference contract**

Keep existing local artifacts compatible. Add an optional source reference containing only a configured source id and exact revision; reject URLs, branch names, and checkout paths at the control-plane parser. Require both artifacts to share the reference when either is external.

- [ ] **Step 3: Implement registered-source resolution**

At the host boundary, validate the registered checkout using command-scoped Git reads: canonical remote identity, exact detached or checked-out revision, contained artifact paths, and SHA-256 bytes. Do not fetch, clone, or write to the source checkout. Reuse the resolved bytes for task prompts, planned-path parsing, and conformance rather than rereading through the implementation checkout.

- [ ] **Step 4: Run focused RED/GREEN evidence and commit**

```bash
corepack pnpm exec vitest run packages/core/contracts apps/plurora-harness-host/tests/workflow-handlers.spec.ts apps/plurora-harness-host/tests/host.spec.ts
git add packages/core/contracts apps/plurora-harness-host
git commit -m "feat(harness): resolve registered cross-repo artifacts"
```

---

### Task 1: Make NeuroVia runtime checkout validation hermetic to global excludes

**Repository:** `adsonpatrick/neuro-via`

**Files:**
- Modify: `scripts/harness/runtime-checkout.mjs`
- Modify: `scripts/harness/runtime-checkout.test.mjs`

**Interfaces:**
- Consumes: existing `verifyRuntimeCheckout({ home, expectedRepository, expectedRevision })`.
- Produces: the same public function and CLI behavior, but every internal Git read uses command-scoped `core.excludesFile=`.

- [ ] **Step 1: Add the failing poisoned-global-config regression test**

Add a test that creates an isolated checkout and a temporary global Git config whose excludes file does not exist. Because `verifyRuntimeCheckout` executes Git in the current process environment, set `GIT_CONFIG_GLOBAL` only for the duration of the test and restore it in `finally`:

```js
it('ignores an inaccessible global core.excludesFile while validating the checkout', async () => {
  const isolated = await makeCheckout()
  const globalConfigDir = mkdtempSync(join(tmpdir(), 'trick-global-git-'))
  roots.push(globalConfigDir)

  const globalConfig = join(globalConfigDir, 'gitconfig')
  writeFileSync(globalConfig, `[core]\n\texcludesFile = ${join(globalConfigDir, 'missing-ignore')}\n`)

  const previous = process.env.GIT_CONFIG_GLOBAL
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  try {
    const result = await verifyRuntimeCheckout({
      home: isolated.home,
      expectedRepository: REPOSITORY,
      expectedRevision: isolated.revision,
    })
    assert.equal(result.revision, isolated.revision)
  } finally {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL
    else process.env.GIT_CONFIG_GLOBAL = previous
  }
})
```

This directly exercises the production `git()` helper under the poisoned global configuration and does not require a second project-config fixture.

- [ ] **Step 2: Run the focused NeuroVia test and verify it fails for the expected Git reason**

Run:

```bash
node --test scripts/harness/runtime-checkout.test.mjs
```

Expected before implementation: the poisoned global `core.excludesFile` causes the checkout read/status path to fail.

- [ ] **Step 3: Neutralize only `core.excludesFile` at command scope**

Change the Git helper to prepend the command-level override:

```js
async function git(home, args) {
  try {
    const { stdout } = await run(
      'git',
      ['-c', 'core.excludesFile=', '-C', home, ...args],
      { encoding: 'utf8' },
    )
    return stdout
  } catch {
    throw new RuntimeCheckoutError(
      `git ${args[0]} failed in the Trick Harness checkout at ${home}; `
        + 'it must be a readable git working tree',
    )
  }
}
```

Do not set `GIT_CONFIG_GLOBAL` or `GIT_CONFIG_SYSTEM` inside production code.

- [ ] **Step 4: Re-run the focused test and the full harness integration tests**

Run:

```bash
node --test scripts/harness/runtime-checkout.test.mjs
npm run test:harness
```

Expected: all existing wrong-remote, wrong-SHA, dirty, untracked, missing, non-Git, and relative-path cases remain green; the poisoned excludes case now passes.

- [ ] **Step 5: Commit the isolated NeuroVia fix**

```bash
git add scripts/harness/runtime-checkout.mjs scripts/harness/runtime-checkout.test.mjs
git commit -m "fix(harness): isolate runtime check from global excludes"
```

---

### Task 2: Extend stage contracts with constraints and explicit affected paths

**Repository:** `adsonpatrick/trick-harness`

**Files:**
- Modify: `packages/core/contracts/src/types.ts`
- Modify: `packages/core/contracts/src/index.ts`
- Modify: `packages/core/contracts/tests/contracts.spec.ts`
- Modify: `packages/core/contracts/README.md`

**Interfaces:**
- Consumes: existing `Role`, `EvidenceRef`, `Finding`, `DiagnosisContract`, `StageResult`.
- Produces: `STAGE_CONSTRAINT_CLASSES`, `StageConstraintClass`, `StageConstraint`, `Finding.affectedPaths`, `DiagnosisContract.proposedRepairPaths`, and required `StageResult.constraints`.

- [ ] **Step 1: Add failing parser tests for the new required fields**

Add focused cases to `contracts.spec.ts`:

```ts
it('parses stage constraints separately from findings', () => {
  expect(parseStageResult({
    role: 'verify',
    executor: 'codex',
    verdict: 'INCONCLUSIVE',
    summary: 'runtime check unavailable',
    findings: [],
    constraints: [{
      id: 'constraint-1',
      class: 'SANDBOX_LIMITATION',
      raisedBy: 'verify',
      summary: 'external runtime path is not readable in this sandbox',
      evidence: [{ kind: 'gate', locator: 'harness:check', summary: 'sandbox denied the check' }],
    }],
    evidence: [],
  }).constraints).toHaveLength(1)
})

it('requires the constraints array even when it is empty', () => {
  expect(() => parseStageResult({
    role: 'verify',
    executor: 'codex',
    verdict: 'PASS',
    summary: 'ok',
    findings: [],
    evidence: [],
  })).toThrowError(/constraints/)
})

it('requires affectedPaths on findings and proposedRepairPaths on diagnoses', () => {
  expect(() => parseFinding({
    id: 'f-1',
    class: 'BUG',
    raisedBy: 'verify',
    summary: 'broken',
    confirmed: true,
    evidence: [],
  })).toThrowError(/affectedPaths/)

  expect(() => parseDiagnosisContract({
    symptom: 'broken',
    reproduction: 'run test',
    expectedVsActual: 'pass vs fail',
    observedEvidence: [{ kind: 'test', locator: 'x', summary: 'fails' }],
    affectedBoundary: 'core/parser',
    ruledOutHypotheses: ['not configuration'],
    rootCauseHypothesis: 'parser defect',
    confidence: 'high',
    regressionTestSeam: 'parser.spec.ts',
    minimalRepairSurface: 'parser',
    unknowns: [],
    securityRelevance: 'none',
  })).toThrowError(/proposedRepairPaths/)
})
```

- [ ] **Step 2: Run the contracts tests and verify the new cases fail**

```bash
corepack pnpm exec vitest run packages/core/contracts/tests/contracts.spec.ts
```

Expected: failures show the old parsers do not require/parse the new fields.

- [ ] **Step 3: Add the new contract vocabulary**

In `types.ts`, add:

```ts
export const STAGE_CONSTRAINT_CLASSES = [
  'SANDBOX_LIMITATION',
  'MISSING_TOOL',
  'EXTERNAL_RUNTIME_UNREADABLE',
  'EXECUTOR_CAPABILITY_GAP',
  'EXTERNAL_SERVICE_UNAVAILABLE',
] as const

export type StageConstraintClass = typeof STAGE_CONSTRAINT_CLASSES[number]

export interface StageConstraint {
  readonly id: string
  readonly class: StageConstraintClass
  readonly raisedBy: Role
  readonly summary: string
  readonly evidence: readonly EvidenceRef[]
}
```

Extend the existing interfaces exactly as approved:

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

export interface DiagnosisContract {
  // existing fields...
  readonly proposedRepairPaths: readonly string[]
}

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

- [ ] **Step 4: Add strict parsers that drop undeclared data**

In `index.ts`, add `parseStageConstraint` and update the existing parsers:

```ts
export function parseStageConstraint(value: unknown, path = 'constraint'): StageConstraint {
  const source = asRecord(value, path)
  return Object.freeze({
    id: text(source, 'id', path),
    class: member(source, 'class', STAGE_CONSTRAINT_CLASSES, path),
    raisedBy: member(source, 'raisedBy', ROLES, path),
    summary: text(source, 'summary', path),
    evidence: list(source, 'evidence', path, parseEvidenceRef),
  })
}
```

Use required arrays for `affectedPaths`, `proposedRepairPaths`, and `constraints`; do not make them optional for compatibility because new stage output must state the absence explicitly.

- [ ] **Step 5: Update all contract fixtures in this package and re-run the tests**

```bash
corepack pnpm exec vitest run packages/core/contracts
```

Expected: PASS.

- [ ] **Step 6: Update the contracts README and commit**

Document the semantic distinction in one concise section: a finding is about the artifact; a constraint is about the stage's ability to judge it.

```bash
git add packages/core/contracts
git commit -m "feat(contracts): separate stage constraints from findings"
```

---

### Task 3: Canonicalize executor failure categories and remove duplicated availability state

**Repository:** `adsonpatrick/trick-harness`

**Files:**
- Modify: `packages/core/contracts/src/types.ts`
- Modify: `packages/core/contracts/tests/contracts.spec.ts`
- Modify: `packages/core/executor/src/types.ts`
- Modify: `packages/core/executor/package.json`
- Modify: `packages/core/executor/tests/executor.spec.ts`
- Modify: `packages/core/routing/src/availability.ts`
- Modify: `packages/core/routing/tests/availability.spec.ts`
- Modify: `packages/providers/codex/src/config.ts`
- Modify: `packages/providers/codex/src/index.ts`
- Modify: `packages/providers/codex/tests/codex.spec.ts`

**Interfaces:**
- Consumes: current routing availability/quality category names.
- Produces: shared `EXECUTOR_FAILURE_CATEGORIES` / `ExecutorFailureCategory`; `ExecutorFailure { category, code, safeDiagnostic, httpStatus? }`; routing remains the sole source of availability-vs-quality semantics.

- [ ] **Step 1: Add a failing vocabulary-equality test**

In routing tests, require the union of routing's two sets to equal the canonical contract set:

```ts
expect(new Set([...AVAILABILITY_FAILURES, ...QUALITY_FAILURES]))
  .toEqual(new Set(EXECUTOR_FAILURE_CATEGORIES))
```

In executor tests/type fixtures, construct an `ExecutorFailure` with `category: 'other'` and `code: 'fixture.other'`, and remove all assertions that expect `availability`.

Update Codex normalization tests at the same time: they must assert canonical `category` plus a stable provider code, not `availability`. For example, `usageLimitExceeded` becomes `{ category: 'usage-limit-exceeded', code: 'codex.usage-limit-exceeded' }`, and an unknown native variant becomes `{ category: 'other', code: 'codex.other' }`.

- [ ] **Step 2: Run focused routing/executor tests and confirm failure**

```bash
corepack pnpm exec vitest run   packages/core/executor/tests/executor.spec.ts   packages/core/routing/tests/availability.spec.ts
```

Expected: compile/test failures until the shared category contract and new failure shape exist.

- [ ] **Step 3: Move the canonical closed category union into contracts**

Add to `packages/core/contracts/src/types.ts`:

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

export type ExecutorFailureCategory = typeof EXECUTOR_FAILURE_CATEGORIES[number]
```

Do not add provider-specific names to this list.

- [ ] **Step 4: Narrow `ExecutorFailure` and remove `availability`**

Add `@trick-harness/contracts` as a workspace peer/dev dependency of `@trick-harness/executor`, import the category type, and use:

```ts
export interface ExecutorFailure {
  readonly category: ExecutorFailureCategory
  readonly code: string
  readonly safeDiagnostic: string
  readonly httpStatus?: number
}
```

- [ ] **Step 5: Update Codex to the new failure shape before touching OpenCode**

Change `executorFailure()` in `packages/providers/codex/src/config.ts` to return canonical category + provider-specific code + safe diagnostic:

```ts
export function executorFailure(category: string, httpStatus?: number): ExecutorFailure {
  const normalized = normalizeFailure(category)
  return {
    category: normalized,
    code: `codex.${normalized}`,
    safeDiagnostic: `codex run failed (${normalized})`,
    ...httpStatus === undefined ? {} : { httpStatus },
  }
}
```

Map `CodexRouteError` in `index.ts` to `bad-request` with `code: 'codex.route.unsupported'`; map an unexpected provider exception to `other` with `code: 'codex.run.failed'` and fixed secret-safe diagnostic text. Do not keep `provider-error` or `route-unsupported`.

- [ ] **Step 6: Keep routing's two policy sets but type them against the canonical union**

```ts
export const AVAILABILITY_FAILURES = [
  'usage-limit-exceeded',
  'session-budget-exceeded',
  'server-overloaded',
  'internal-server-error',
  'transport-unavailable',
] as const satisfies readonly ExecutorFailureCategory[]

export const QUALITY_FAILURES = [
  'context-window-exceeded',
  'bad-request',
  'sandbox-denied',
  'cyber-policy-refusal',
  'unauthorized',
  'wrong-answer',
  'failed-verification',
  'other',
] as const satisfies readonly ExecutorFailureCategory[]
```

Keep `classifyFailure()` fail-closed for arbitrary strings used at runtime.

- [ ] **Step 7: Re-run focused tests and typecheck the affected packages**

```bash
corepack pnpm exec vitest run   packages/core/contracts/tests/contracts.spec.ts   packages/core/executor/tests/executor.spec.ts   packages/core/routing/tests/availability.spec.ts   packages/providers/codex/tests/codex.spec.ts
corepack pnpm run typecheck
```

Expected: PASS after all current provider fixtures are updated to the new failure shape.

- [ ] **Step 8: Commit**

```bash
git add packages/core/contracts packages/core/executor packages/core/routing packages/providers/codex
git commit -m "refactor(executor): canonicalize failure taxonomy"
```

---

### Task 4: Persist constraints, repair authorization, and safe provider failure codes

**Repository:** `adsonpatrick/trick-harness`

**Files:**
- Modify: `packages/core/journal/src/types.ts`
- Modify: `packages/core/journal/src/index.ts`
- Modify: `packages/core/journal/tests/journal.spec.ts`
- Modify: `packages/core/journal/README.md`

**Interfaces:**
- Consumes: `StageConstraint`, `RepairAuthorization` data supplied by the workflow, and `ExecutorFailure.code`.
- Produces: `harness/stage-constraint`, `harness/repair-authorization`, optional `failureCode` on `harness/executor-end`, and projection fields for the new durable facts.

- [ ] **Step 1: Add failing journal round-trip tests**

Add tests that append/project a constraint and a repair authorization, and one backward-compatibility test with an event stream containing no new events:

```ts
expect(projectWorkflow(session.events, 'wf-1').constraints).toEqual([
  expect.objectContaining({ stageId: 'verify-1', constraint: expect.objectContaining({ class: 'SANDBOX_LIMITATION' }) }),
])

expect(projectWorkflow(session.events, 'wf-1').repairAuthorizations).toEqual([
  expect.objectContaining({ stageId: 'repair-1', findingId: 'f-1', allowedPathCount: 2 }),
])

expect(projectWorkflow(oldStyleEvents, 'wf-old').constraints).toEqual([])
expect(projectWorkflow(oldStyleEvents, 'wf-old').repairAuthorizations).toEqual([])
```

Also assert `executorEnd(..., failureClass, failureCode)` projects/retains only the safe code field, not a raw diagnostic.

- [ ] **Step 2: Run journal tests and confirm failure**

```bash
corepack pnpm exec vitest run packages/core/journal/tests/journal.spec.ts
```

- [ ] **Step 3: Extend the durable event vocabulary**

Add:

```ts
'harness/stage-constraint': {
  workflowId: string
  stageId: string
  constraint: StageConstraint
}

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

Extend `harness/executor-end` with `failureCode?: string`.

Add both event names to `HARNESS_EVENT_TYPES`.

- [ ] **Step 4: Add bounded record/projection types and writer methods**

Use field-by-field reconstruction; do not spread arbitrary stage/provider objects into session events.

The journal methods should have explicit signatures:

```ts
stageConstraint(stageId: string, constraint: StageConstraint): void

repairAuthorization(input: {
  stageId: string
  findingId: string
  scopeSha256: string
  allowedPathCount: number
  allowedSurfaces: readonly string[]
  reasonCodes: readonly string[]
}): Promise<void>

executorEnd(
  stageId: string,
  executor: string,
  outcome: ExecutorOutcome,
  durationMs: number,
  failureClass?: string,
  failureCode?: string,
): void
```

Checkpoint the repair authorization before writable dispatch.

- [ ] **Step 5: Re-run journal tests including the old-log scenario**

```bash
corepack pnpm exec vitest run packages/core/journal
```

Expected: new events project correctly; old logs remain readable and expose empty new collections.

- [ ] **Step 6: Update README and commit**

```bash
git add packages/core/journal
git commit -m "feat(journal): record constraints and repair authority"
```

---

### Task 5: Make verdict reconciliation fact-driven

**Repository:** `adsonpatrick/trick-harness`

**Files:**
- Modify: `packages/core/engineering-workflow/src/types.ts`
- Modify: `packages/core/engineering-workflow/src/triage.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/tests/triage.spec.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`

**Interfaces:**
- Consumes: `StageResult.constraints`, `Triage`, canonical provider failures.
- Produces: `StageFacts.constraints`; `UNRESOLVED -> INCONCLUSIVE`; constraint-driven `INCONCLUSIVE`; material defects drive `FAIL`; scaffolding defects cap `PASS` to `PARTIAL`; provider errors with no successful fallback end `INCONCLUSIVE`.

- [x] **Step 1: Add failing triage/reconciliation tests**

Pin the approved matrix:

```ts
expect(reconcileVerdict('PASS', triage([]), [sandboxConstraint], 'claimed pass').verdict)
  .toBe('INCONCLUSIVE')

expect(reconcileVerdict('PASS', triage([confirmedBug]), [], 'claimed pass').verdict)
  .toBe('FAIL')

expect(reconcileVerdict('PASS', triage([unresolved]), [], 'uncertain').verdict)
  .toBe('INCONCLUSIVE')

expect(reconcileVerdict('PASS', triage([confirmedToolingDefect]), [], 'claimed pass').verdict)
  .toBe('PARTIAL')
```

Also add a workflow case where a certifying stage returns `PARTIAL` without any confirmed repairable finding and assert `repairCycles === 0`.

- [x] **Step 2: Add a failing workflow test for provider error semantics**

Use a fake provider whose final non-reroutable result is:

```ts
{
  status: 'error',
  output: '',
  failure: {
    category: 'other',
    code: 'fixture.prompt.failed',
    safeDiagnostic: 'fixture executor failed safely',
  },
}
```

Assert the workflow ends with verdict `INCONCLUSIVE`, not `FAIL`, and opens no repair cycle.

- [x] **Step 3: Run focused workflow tests and verify failure**

```bash
corepack pnpm exec vitest run   packages/core/engineering-workflow/tests/triage.spec.ts   packages/core/engineering-workflow/tests/workflow.spec.ts
```

- [x] **Step 4: Separate blocking and uncertain findings**

Change triage dispositions so `PRODUCT_DECISION` and `DESIGN_DECISION` remain blocking, while `UNRESOLVED` becomes explicitly inconclusive:

```ts
export type TriageDisposition = 'repair' | 'block' | 'report' | 'inconclusive'

export const BLOCKING_FINDINGS: readonly FindingClass[] = [
  'PRODUCT_DECISION',
  'DESIGN_DECISION',
]

export const INCONCLUSIVE_FINDINGS: readonly FindingClass[] = ['UNRESOLVED']
```

Add `uncertain` to `Triage`.

- [x] **Step 5: Reconcile from facts in the approved order**

Change `reconcileVerdict` to accept constraints:

```ts
export function reconcileVerdict(
  claimed: WorkflowVerdict,
  result: Triage,
  constraints: readonly StageConstraint[],
  summary: string,
): ReconciledVerdict
```

Implement this precedence:

```text
required constraint -> INCONCLUSIVE
product/design decision -> BLOCKED
UNRESOLVED -> INCONCLUSIVE
confirmed BUG/SECURITY_BUG -> FAIL
confirmed TEST_DEFECT/TOOLING_DEFECT -> at most PARTIAL
unconfirmed auto-repairable concern -> at most PARTIAL
otherwise claimed verdict
```

- [x] **Step 6: Carry constraints through `StageFacts`, journal them, and make provider error inconclusive**

Add `constraints` to `StageFacts` and the internal `facts(...)` builder.

In `#reduce`:

```ts
if (result.status === 'error') {
  const failure = result.failure
  journal.executorEnd(
    stage.stageId,
    executor,
    'failed',
    durationMs,
    failure?.category,
    failure?.code,
  )
  const summary = failure?.safeDiagnostic ?? 'the executor failed without a diagnostic'
  await journal.verdict(stage.stageId, stage.role, 'INCONCLUSIVE', summary, [])
  return {
    facts: facts(stage, executor, permissionMode, 'INCONCLUSIVE', summary, [], [], [], durationMs),
    canceled: false,
    failed: true,
    result: undefined,
    refusal: undefined,
    routed,
  }
}
```

Update the outer `dispatched.failed` branch to terminate with workflow verdict `INCONCLUSIVE`, not `FAIL`.

For completed stages, call `journal.stageConstraint` for each parsed constraint before the verdict record.

- [x] **Step 7: Stop `PARTIAL` without a repair target without manufacturing a blocker**

Keep repair entry conditional on a confirmed repairable finding. If effective verdict is `PARTIAL` and `triaged.repairable[0]` is absent, end the workflow `PARTIAL` with zero new repair cycles instead of emitting “failed without naming a confirmed defect”.

- [x] **Step 8: Re-run focused tests and commit**

```bash
corepack pnpm exec vitest run packages/core/engineering-workflow/tests/triage.spec.ts packages/core/engineering-workflow/tests/workflow.spec.ts
git add packages/core/engineering-workflow
git commit -m "fix(workflow): reconcile verdicts from established facts"
```

---

### Task 6: Bind repair authorization to deterministic planned scope

**Repository:** `adsonpatrick/trick-harness`

**Files:**
- Modify: `packages/core/engineering-workflow/src/repair.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/tests/repair.spec.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`

**Interfaces:**
- Consumes: `plannedPaths`, profile `changeImpactPolicy`, `Finding.affectedPaths`, `DiagnosisContract.proposedRepairPaths`, security repair rules.
- Produces: `RepairScope`, scoped `RepairAuthorization`, `scope-unauthorized` refusal, and a deterministic repair-scope digest for journaling.

- [x] **Step 1: Add failing unit tests for in-scope and out-of-scope repair**

Add cases equivalent to:

```ts
const scope = buildRepairScope(
  ['src/foo.ts', 'tests/foo.spec.ts'],
  profile.changeImpactPolicy,
)

expect(authorizeRepair(confirmedBug, {
  diagnosis: diagnosed({ proposedRepairPaths: ['src/foo.ts'] }),
  scope,
  changeImpactPolicy: profile.changeImpactPolicy,
  securityRepairRules: [],
}).scope.allowedPaths).toEqual(['src/foo.ts', 'tests/foo.spec.ts'])

expect(() => authorizeRepair(confirmedToolingDefect({
  affectedPaths: ['scripts/harness/runtime-checkout.mjs'],
}), {
  scope,
  changeImpactPolicy: profile.changeImpactPolicy,
  securityRepairRules: [],
})).toThrowError(expect.objectContaining({ code: 'scope-unauthorized' }))
```

Add a non-empty proposed-path requirement: an auto-repairable finding that names no affected path must not receive write authority.

- [x] **Step 2: Add the Review Focus test: repair must fail closed without planned scope**

In `workflow.spec.ts`, construct a run that can reach a repairable finding but has no deterministic planned-path reader. Assert:

```ts
expect(outcome.verdict).toBe('BLOCKED')
expect(outcome.repairCycles).toBe(0)
expect(repairProviderStarts).toBe(0)
```

The repair cycle counter must not be incremented until authorization can actually be granted.

- [x] **Step 3: Run repair/workflow tests and confirm failure**

```bash
corepack pnpm exec vitest run   packages/core/engineering-workflow/tests/repair.spec.ts   packages/core/engineering-workflow/tests/workflow.spec.ts
```

- [x] **Step 4: Implement `RepairScope`, scope normalization, and digest**

Add:

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
  readonly rootCause: string | undefined
}
```

`buildRepairScope(plannedPaths, policy)` must normalize/deduplicate paths using the existing change-impact path rules and derive surfaces by classifying the same exact set.

`repairScopeDigest(scope)` must hash a canonical serialization: sorted paths, then sorted surfaces, with fixed separators. Do not hash model prose.

- [x] **Step 5: Change `authorizeRepair` to require a scope**

Use one options object to prevent positional drift:

```ts
export function authorizeRepair(
  finding: Finding,
  options: {
    readonly diagnosis?: unknown
    readonly scope: RepairScope
    readonly changeImpactPolicy: ChangeImpactPolicyDefinition
    readonly securityRepairRules?: readonly SecurityRepairRule[]
  },
): RepairAuthorization
```

Derive proposed paths from validated diagnosis when diagnosis exists; otherwise from `finding.affectedPaths`. Normalize them, require every path to be inside `scope.allowedPaths`, classify the proposed paths, and require their surfaces to be a subset of `scope.allowedSurfaces`.

- [x] **Step 6: Move repair-cycle accounting after successful authorization and journal authority before dispatch**

At the repair stage:

```ts
if (plannedPaths === undefined) {
  return await this.#blocked(
    objective,
    stages,
    repairCycles,
    executorStarts,
    'external',
    'automatic repair requires a deterministic approved write set, and this run has none',
  )
}

const scope = buildRepairScope(plannedPaths, profile.changeImpactPolicy)
authorization = authorizeRepair(defect, {
  diagnosis,
  scope,
  changeImpactPolicy: profile.changeImpactPolicy,
  securityRepairRules: profile.securityPolicy.repairRules,
})

await journal.repairAuthorization({
  stageId: stage.stageId,
  findingId: authorization.findingId,
  scopeSha256: repairScopeDigest(authorization.scope),
  allowedPathCount: authorization.scope.allowedPaths.length,
  allowedSurfaces: authorization.scope.allowedSurfaces,
  reasonCodes: authorization.reasonCodes,
})
```

Do not increment `repairCycles` when a certifier merely proposes a repair. Introduce a local `pendingRepairCycle` number: when a confirmed repairable finding is selected, set `pendingRepairCycle = repairCycles + 1` and use that number only to name the queued `debug-N` / `repair-N` stages. After scope authorization is recorded and the pre-repair snapshot succeeds, assign `repairCycles = pendingRepairCycle` immediately before writable repair dispatch and clear `pendingRepairCycle`. This preserves `repairCycles = 0` when authorization is refused before repair starts.

- [x] **Step 7: Re-run tests and commit**

```bash
corepack pnpm exec vitest run packages/core/engineering-workflow/tests/repair.spec.ts packages/core/engineering-workflow/tests/workflow.spec.ts
git add packages/core/engineering-workflow
git commit -m "feat(workflow): bind repairs to approved scope"
```

---

### Task 7: Add deterministic pre/post repair workspace snapshots

**Repository:** `adsonpatrick/trick-harness`

**Files:**
- Create: `packages/core/engineering-workflow/src/workspace-state.ts`
- Modify: `packages/core/engineering-workflow/src/types.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Create: `packages/core/engineering-workflow/tests/workspace-state.spec.ts`
- Create: `apps/plurora-harness-host/src/workspace-state.ts`
- Create: `apps/plurora-harness-host/tests/workspace-state.spec.ts`
- Modify: `apps/plurora-harness-host/src/main.ts`

**Interfaces:**
- Produces core types `WorkspaceSnapshot`, `WorkspacePathState`, `WorkspaceStateReader`, and `changedPathsBetween(before, after)`.
- Host implementation produces snapshots from the project checkout without writing to Git/index/worktree.
- Workflow consumes `WorkflowRunRequest.workspaceState` for both repair integrity and per-run delivery mutation accounting.
- `WorkflowDeliveryInput` gains optional `changedPaths?: readonly string[]`; the reusable core preserves deployments with no workspace reader, while the Plurora deployment requires this deterministic field before it will describe a delivery.

- [x] **Step 1: Write core comparison tests first**

Create cases for unchanged, added, removed, and changed fingerprints:

```ts
expect(changedPathsBetween(
  { revision: HEAD, entries: [{ path: 'src/x.ts', fingerprint: 'before' }] },
  { revision: HEAD, entries: [{ path: 'src/x.ts', fingerprint: 'after' }] },
)).toEqual(['src/x.ts'])
```

Also assert a revision change between snapshots is rejected; a repair may not silently move HEAD.

- [x] **Step 2: Define the core snapshot contracts and comparison helper**

Use the spec signatures exactly:

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
  snapshot(objective: WorkflowObjective, signal: AbortSignal): Promise<WorkspaceSnapshot>
}
```

`changedPathsBetween` compares the union of paths and flags a path whenever one side is absent or fingerprints differ.

- [x] **Step 3: Add host tests for deterministic candidate-path discovery**

The host reader must use only argv-based read operations. Test that it invokes:

```text
git -c core.excludesFile= rev-parse HEAD
git -c core.excludesFile= diff --name-only -z --no-renames HEAD
git -c core.excludesFile= ls-files --others --exclude-standard -z
```

Use the existing managed subprocess seam; never a shell string.

Add rename/delete/untracked fixtures. `--no-renames` intentionally turns a rename into old-path deletion plus new-path addition, so both authorities are visible.

- [x] **Step 4: Add the Review Focus case: a file already dirty before repair changes again**

The fake reader should produce the same path in both snapshots with different fingerprints:

```ts
const before = await reader.snapshot(objective, signal)
// mutate fixture bytes without making the path newly dirty
const after = await reader.snapshot(objective, signal)

expect(changedPathsBetween(before, after)).toContain('src/already-dirty.ts')
```

The test must fail if the implementation fingerprints only “path is dirty”.

- [x] **Step 5: Implement host fingerprints**

For every candidate path from tracked diff + untracked list, compute a fingerprint from:

```text
raw Git diff metadata for HEAD -- <path>
+
worktree object state
```

Use a stable SHA-256 over a fixed serialization. For worktree state:
- regular file: hash file bytes;
- symlink: hash the link target string with a `symlink:` prefix;
- missing path: use `deleted`;
- unsupported filesystem object: fail closed.

Never place file contents in the returned snapshot.

- [x] **Step 6: Wire the reader into the host and workflow request**

Expose one `workspaceState` reader from `startPluroraHost`, created from the same checkout/subprocess seam as `changeSet`.

Add optional `workspaceState?: WorkspaceStateReader` to `WorkflowRunRequest`. Extend `WorkflowDeliveryInput` with:

```ts
readonly changedPaths?: readonly string[]
```

Composition plumbing is completed in Task 10.

- [x] **Step 7: Capture a per-run delivery baseline before the first mutating executor**

In `WorkflowRunner.#drive`, keep:

```ts
let deliveryBaseline: WorkspaceSnapshot | undefined
```

Before the first executor stage whose `permissionModeFor(role)` is `workspace-write` (implementation or repair), if a workspace reader exists and `deliveryBaseline` is absent, capture it before `beginExecutor`/process spawn.

At each delivery:
1. capture the current snapshot before calling the delivery capability;
2. require its revision to equal the baseline revision;
3. derive `changedPathsBetween(deliveryBaseline, current)`;
4. pass those paths in `WorkflowDeliveryInput.changedPaths`;
5. after successful delivery, capture a fresh clean/post-commit snapshot and replace `deliveryBaseline` for any later repair/redelivery.

This prevents a pre-existing dirty file from being delivered merely because it was already present when the workflow began. Add a workflow test where `preexisting.txt` is dirty in both baseline/current with the same fingerprint while `feature.ts` changes; delivery must receive only `feature.ts`.

- [x] **Step 8: Enforce post-repair scope before repair completion**

Immediately before writable repair dispatch, capture `preRepairSnapshot`. Immediately after a non-canceled repair returns, capture `postRepairSnapshot`, derive `changedPathsBetween`, and require every path to be inside `authorization.scope.allowedPaths`.

On violation:
- write an external blocker with bounded evidence;
- clear open repair authority;
- do not call delivery;
- end `BLOCKED`.

On snapshot read failure after a writable repair, also end `BLOCKED`; the world may have changed and cannot be safely certified.

- [x] **Step 9: Run focused tests and commit**

```bash
corepack pnpm exec vitest run   packages/core/engineering-workflow/tests/workspace-state.spec.ts   packages/core/engineering-workflow/tests/workflow.spec.ts   apps/plurora-harness-host/tests/workspace-state.spec.ts
git add packages/core/engineering-workflow apps/plurora-harness-host
git commit -m "feat(workflow): verify repair mutations against scope"
```

---

### Task 8: Harden the OpenCode adapter and normalize provider failures

**Repository:** `adsonpatrick/trick-harness`

**Files:**
- Create: `packages/providers/opencode/src/runtime-errors.ts`
- Modify: `packages/providers/opencode/src/adapter.ts`
- Modify: `packages/providers/opencode/src/index.ts`
- Modify: `packages/providers/opencode/src/types.ts`
- Modify: `packages/providers/opencode/tests/adapter.spec.ts`
- Modify: `packages/providers/opencode/tests/opencode.spec.ts`
- Modify: `packages/providers/opencode/README.md`

**Interfaces:**
- Produces typed internal adapter errors and canonical external `ExecutorFailure` categories/codes.
- Harness-requested cancellation remains `status: 'aborted'`; an OpenCode-internal `MessageAbortedError` becomes `status: 'error'`, category `other`.

- [x] **Step 1: Add failing adapter tests for invalid SDK shapes**

Mock `session.create` and `session.prompt` responses to exercise:
- missing/blank session id;
- missing `answered.data`;
- non-array `answered.data.parts`.

Each must reject with `OpencodeMalformedResponseError`, not an incidental `TypeError`.

- [x] **Step 2: Add failing provider tests for the exact safe taxonomy**

Pin these outcomes:

```ts
expect(sessionAbort.failure).toMatchObject({
  category: 'other',
  code: 'opencode.prompt.session-aborted',
  safeDiagnostic: 'OpenCode aborted the active session before returning a valid result',
})

expect(malformed.failure).toMatchObject({
  category: 'other',
  code: 'opencode.prompt.response-missing-data',
})

expect(startupTimeout.failure).toMatchObject({
  category: 'transport-unavailable',
  code: 'opencode.server.startup-timeout',
})

expect(routeError.failure).toMatchObject({
  category: 'bad-request',
  code: 'opencode.route.unsupported',
})
```

Add the Review Focus case: an unknown prompt error with a secret-bearing message must become category `other`, code `opencode.prompt.failed`, and no byte of the original message/name if the name is unsafe.

- [x] **Step 3: Run OpenCode tests and verify they fail under the current provider**

```bash
corepack pnpm exec vitest run packages/providers/opencode
```

- [x] **Step 4: Add typed internal errors**

`runtime-errors.ts` should define fixed-message classes such as:

```ts
export class OpencodeSessionAbortedError extends Error {
  override readonly name = 'OpencodeSessionAbortedError'
  constructor() {
    super('OpenCode aborted the active session before returning a valid result')
  }
}

export class OpencodeMalformedResponseError extends Error {
  override readonly name = 'OpencodeMalformedResponseError'
  constructor(readonly code: 'session-id-missing' | 'prompt-response-missing-data') {
    super('OpenCode returned an incomplete SDK response')
  }
}

export class OpencodeServerStartError extends Error {
  override readonly name = 'OpencodeServerStartError'
}
```

Keep the existing `OpencodeStartupTimeoutError`.

- [x] **Step 5: Validate response structure before dereferencing**

In `adapter.ts`, explicitly validate `created.data.id` and `answered.data.parts`.

Catch a thrown error with exact `error.name === 'MessageAbortedError'` around the prompt call and translate it to `OpencodeSessionAbortedError`. Do not inspect or persist the raw message.

Unknown prompt failures rethrow to the provider classifier; unknown server-start failures become a typed server-start fault.

- [x] **Step 6: Normalize only to canonical categories**

Rewrite `classify(error)` so every return uses `ExecutorFailureCategory` and a stable code. Never emit `provider-error` or `route-unsupported`.

Representative mapping:

```ts
if (error instanceof OpencodeStartupTimeoutError) {
  return {
    category: 'transport-unavailable',
    code: 'opencode.server.startup-timeout',
    safeDiagnostic: 'OpenCode server did not become ready before the startup deadline',
  }
}

if (error instanceof OpencodeRouteError) {
  return {
    category: 'bad-request',
    code: 'opencode.route.unsupported',
    safeDiagnostic: 'OpenCode cannot express the routed request',
  }
}

if (error instanceof OpencodeSessionAbortedError) {
  return {
    category: 'other',
    code: 'opencode.prompt.session-aborted',
    safeDiagnostic: error.message,
  }
}
```

Use fixed safe text for generic errors; do not include raw `Error.name` unless it passes the existing bounded/safe-name rule.

- [x] **Step 7: Re-run provider + routing tests and commit**

```bash
corepack pnpm exec vitest run packages/providers/opencode packages/core/routing packages/core/executor
git add packages/providers/opencode
git commit -m "fix(opencode): classify aborts and malformed responses safely"
```

---

### Task 9: Update Plurora stage envelopes, conformance semantics, and deterministic delivery paths

**Repository:** `adsonpatrick/trick-harness`

**Files:**
- Modify: `apps/plurora-harness-host/src/workflow-handlers.ts`
- Modify: `apps/plurora-harness-host/tests/workflow-handlers.spec.ts`
- Modify: `apps/plurora-harness-host/tests/stage-result-prompt.snapshot.ts`
- Modify: `apps/plurora-harness-host/tests/conformance-end-to-end.spec.ts`
- Modify: `packages/core/engineering-workflow/src/conformance.ts`
- Modify: `packages/core/engineering-workflow/tests/conformance.spec.ts`

**Interfaces:**
- Consumes: new stage-result contracts and `WorkflowDeliveryInput.changedPaths` computed by the Control Plane.
- Produces: prompts that require `constraints` and path fields, unreadable output -> `INCONCLUSIVE`, aligned conformance verdict reduction, and delivery files sourced from the deterministic per-run mutation set instead of model diff evidence.

- [x] **Step 1: Update prompt snapshot expectations first**

The ordinary result example must include:

```json
{"verdict":"PASS","summary":"...","findings":[],"constraints":[],"evidence":[]}
```

The finding instructions must require `affectedPaths`.

The diagnosis instructions must require `proposedRepairPaths`.

For certifying stages, state explicitly:

```text
If a required check cannot run because of sandbox, missing tool, unreadable external runtime,
executor capability, or unavailable external service, report it in constraints and use INCONCLUSIVE.
Do not classify that condition as TOOLING_DEFECT unless the defect is in the repository artifact itself.
```

- [x] **Step 2: Change unreadable/invalid completed stage output to `INCONCLUSIVE`**

Replace the old `unreadable(...): BLOCKED` result with:

```ts
function unreadable(stage: StageSpec, executor: string, reason: string): StageResult {
  return {
    role: stage.role,
    executor,
    verdict: 'INCONCLUSIVE',
    summary: `${reason}, so this stage established nothing`,
    findings: [],
    constraints: [],
    evidence: [],
  }
}
```

Provider `status: error` remains handled by the core workflow before the interpreter; the host interpreter must not invent a `StageConstraint` from provider diagnostics.

- [x] **Step 3: Sanitize constraints and new path fields without silently granting authority**

For a valid parsed result:
- bound/filter constraint summaries/evidence with the same secret rules as findings;
- preserve `affectedPaths` / `proposedRepairPaths` as claims for the Control Plane to validate later;
- do not add those paths to any delivery write-set.

- [x] **Step 4: Align conformance overall verdict reduction**

In `conformance.ts`, reduce statuses in this exact precedence:

```text
BLOCKED
FAIL or MISSING
INCONCLUSIVE
PARTIAL
PASS
```

A required obligation blocked only by a stage constraint is `INCONCLUSIVE`, not `MISSING`.

Update the nested conformance prompt to allow the full workflow verdict vocabulary needed by the parser.

- [x] **Step 5: Replace model-reported delivery write-set accumulation**

Remove the `writeSet` that is populated from `EvidenceRef(kind='diff')`.

`describeDelivery` remains synchronous and consumes only the Control Plane's deterministic mutation set:

```ts
describeDelivery(input) {
  if (input.changedPaths === undefined) {
    throw new Error('Plurora delivery requires a deterministic workspace mutation set')
  }
  return {
    branch: options.branch,
    files: [...input.changedPaths].toSorted(),
    message: ...,
    pullRequest: ...,
  }
}
```

Use the host's bounded deployment error type rather than a raw generic error in the real implementation, and do not include path text in the refusal.

An empty deterministic change set must cause delivery to refuse through the existing delivery capability rather than invent a path from stage evidence.

- [x] **Step 6: Run host/conformance tests and refresh only the intended prompt snapshot**

Focused host/conformance tests and the targeted prompt snapshot pass. The full `test:snapshot` replay was attempted but is not green in this Windows environment: unrelated transcript/headless snapshots fail, and the delivery-branch snapshot requires the workspace-state composition wiring completed in Task 10; rerun it after that task.

```bash
corepack pnpm exec vitest run   apps/plurora-harness-host/tests/workflow-handlers.spec.ts   apps/plurora-harness-host/tests/conformance-end-to-end.spec.ts   packages/core/engineering-workflow/tests/conformance.spec.ts
corepack pnpm run test:snapshot
```

If the repository snapshot harness requires record mode for this exact prompt fixture, use its documented targeted refresh path and inspect the diff before committing.

- [x] **Step 7: Commit**

```bash
git add apps/plurora-harness-host packages/core/engineering-workflow
git commit -m "fix(plurora): make stage output and delivery deterministic"
```

---

### Task 10: Plumb workspace state through composition and prove the original failure chain cannot recur

**Repository:** `adsonpatrick/trick-harness`

**Files:**
- Modify: `packages/composition/runtime/src/harness.ts`
- Modify: `packages/composition/runtime/tests/harness.spec.ts`
- Modify: `apps/plurora-harness-host/src/main.ts`
- Modify: `apps/plurora-harness-host/tests/host.spec.ts`
- Create: `apps/plurora-harness-host/tests/activation-hardening-end-to-end.spec.ts`

**Interfaces:**
- `HarnessWorkflowHandlers` gains `workspaceState?: WorkflowRunRequest['workspaceState']`.
- The existing synchronous `describeDelivery(input)` interface remains; `input.changedPaths` is supplied by the workflow when a workspace reader exists.
- Composition passes the reader into every run; GitHub delivery receives only the paths the Control Plane placed on `WorkflowDeliveryInput`.

- [x] **Step 1: Add failing composition tests**

Assert the workflow handler's workspace reader reaches `WorkflowRunner.run`, and that a delivery input carrying `changedPaths: ['src/feature.ts']` reaches the project delivery descriptor unchanged.

The handler type gains only:

```ts
readonly workspaceState?: WorkflowRunRequest['workspaceState']
```

The existing `describeDelivery(input)` signature remains unchanged.

- [x] **Step 2: Wire the new interface**

In `begin()`, pass:

```ts
...workflow.workspaceState === undefined ? {} : { workspaceState: workflow.workspaceState },
```

Keep `deliveryFor` synchronous at the descriptor boundary:

```ts
deliver: async (input, signal) => {
  const outcome = await client.deliver({ ...describeDelivery(input), signal })
  // existing result reduction
}
```

- [x] **Step 3: Pass one workspace reader from `startPluroraHost` to composition**

Create the reader from the same `checkout` options as `changeSet`, expose it on `PluroraHost` for tests/diagnostics, and pass it alongside the workflow handlers:

```ts
workflow: {
  ...createPluroraWorkflowHandlers({ branch, baseBranch, changeSet }),
  workspaceState,
}
```

The workspace reader is not used by the Plurora result interpreter to decide delivery files.

- [x] **Step 4: Add an end-to-end regression for the original canary semantics**

Create an integrated fake-executor run where:
1. implement returns the exact canary diff and `PASS`;
2. verify returns a valid result with `findings: []`, one `SANDBOX_LIMITATION`, and claimed `PARTIAL` or `PASS`;
3. the workflow reconciles to `INCONCLUSIVE`;
4. `repairCycles === 0`;
5. no repair executor is started;
6. no delivery/certification success is published.

This test is the architectural regression for the September 2026 incident.

- [x] **Step 5: Add a paired positive repair E2E**

Prove the hardening did not disable legitimate repair:
1. verify returns a confirmed in-scope `BUG`;
2. diagnosis proposes only approved paths;
3. repair changes only those paths;
4. focused repair evidence is valid;
5. fresh verify passes;
6. delivery proceeds.

- [x] **Step 6: Run composition + host E2E tests and commit**

```bash
corepack pnpm exec vitest run   packages/composition/runtime/tests/harness.spec.ts   apps/plurora-harness-host/tests/host.spec.ts   apps/plurora-harness-host/tests/workspace-state.spec.ts   apps/plurora-harness-host/tests/activation-hardening-end-to-end.spec.ts
corepack pnpm exec vitest run --config vitest.snapshot.config.ts apps/plurora-harness-host/tests/delivery-branch.snapshot.ts
git add packages/composition/runtime apps/plurora-harness-host
git commit -m "test(harness): prove activation hardening end to end"
```

The composition, host, workspace-state and activation E2E regression pass (66 tests); the delivery-branch runnable snapshot also passes after excluding the host's append-only `.plurora-harness/sessions` operational files from measured workspace paths. TypeScript project build, Oxlint on touched TypeScript files and `git diff --check` pass. The delivery snapshot contract was updated for Task 9's required `constraints` field and the timeout's current `INCONCLUSIVE` classification.

---

### Task 11: Run the Trick Harness release-quality gates and open the implementation PR

**Repository:** `adsonpatrick/trick-harness`

**Files:**
- Modify as required by compiler/test fallout only in files already owned by Tasks 2–10.
- Update affected package READMEs if public interfaces changed and are not already documented.

**Interfaces:**
- Produces: one reviewable Trick Harness implementation branch with no unrelated changes and a commit SHA suitable for NeuroVia pinning after human merge.

- [ ] **Step 1: Run focused suites as one regression pass**

```bash
corepack pnpm exec vitest run   packages/core/contracts   packages/core/executor   packages/core/routing   packages/core/journal   packages/core/engineering-workflow   packages/providers/opencode   packages/composition/runtime   apps/plurora-harness-host
```

Expected: PASS.

- [ ] **Step 2: Run the repository Trick Harness gate**

```bash
corepack pnpm run test:trick
```

Expected: PASS.

- [ ] **Step 3: Run static gates**

```bash
corepack pnpm run typecheck
corepack pnpm run lint
```

Expected: PASS. If a global pre-existing repository gate outside the Trick scope fails, record the exact existing baseline separately; do not weaken these hardening tests to hide it.

- [ ] **Step 4: Run snapshots and boundary checks**

```bash
corepack pnpm run test:snapshot
corepack pnpm run constraints
```

Expected: no unintended snapshot or dependency-boundary drift.

- [ ] **Step 5: Inspect the final diff for forbidden regressions**

Explicitly verify:
- no `provider-error` or `route-unsupported` is emitted as an executor failure category;
- no `ExecutorFailure.availability` remains;
- no delivery write-set is sourced from model `diff` locators;
- every stage-result fixture includes `constraints`;
- every repair path goes through deterministic scope authorization.

Use repository search plus the final diff; do not rely only on tests.

- [ ] **Step 6: Push the implementation branch and open a PR**

PR description must reference the approved spec and summarize verification commands/results. Do not enable auto-merge.

- [ ] **Step 7: Human merge gate**

The owner reviews and merges the Trick Harness PR. After merge, obtain the immutable SHA with:

```bash
git -C "$TRICK_HARNESS_HOME" fetch origin
git -C "$TRICK_HARNESS_HOME" checkout master
git -C "$TRICK_HARNESS_HOME" pull --ff-only
git -C "$TRICK_HARNESS_HOME" rev-parse HEAD
```

The final command's exact 40-hex result is the only value permitted in NeuroVia's `plurora-harness.json`.

---

### Task 12: Pin NeuroVia to the hardened runtime and execute a fresh activation canary

**Repository:** `adsonpatrick/neuro-via`

**Files:**
- Modify: `plurora-harness.json`
- Modify: `scripts/harness/config.test.mjs` if its expected pin is literal
- Create on the fresh canary branch only: `docs/verification/canary/trick-harness-v2-activation.md`
- Reuse the already-approved activation canary Spec/Plan artifacts; do not reuse PR #200 as proof.

**Interfaces:**
- Consumes: exact Trick Harness merge SHA from Task 11 and the Task 1 runtime-checkout fix.
- Produces: a fresh PR whose exact head reaches `PR_READY`, normal CI success, and `plurora/harness-certification = success` with `repairCycles = 0`.

- [ ] **Step 1: Update the pinned runtime to the exact merged Trick Harness SHA**

Read the SHA directly from the checked-out hardened runtime:

```bash
TRICK_SHA="$(git -C "$TRICK_HARNESS_HOME" rev-parse HEAD)"
test "$(printf '%s' "$TRICK_SHA" | wc -c)" -eq 40
```

Write that exact value to `plurora-harness.json.revision`; do not use `master`, a tag, or a short SHA.

- [ ] **Step 2: Run NeuroVia's deterministic harness checks before the canary**

```bash
npm run test:harness
npm run harness:check
npm run harness:pin-check
```

Expected: PASS, including the poisoned-global-excludes regression from Task 1.

- [ ] **Step 3: Run the repository CI-equivalent checks that guard harness integration**

```bash
npm run lint
npm run typecheck
npm run test:skills
npm run test:opencode
npm run test:ci
npm run test:db:contract
npm run security:secrets
npm run build
```

Run the Windows harness job in GitHub CI after push; local non-Windows execution does not substitute for the repository's `harness-windows` workflow.

- [ ] **Step 4: Commit/push the pin change separately from the canary mutation**

```bash
git add plurora-harness.json scripts/harness/config.test.mjs
git commit -m "chore(harness): pin activation-hardened runtime"
```

If `config.test.mjs` requires no edit, do not touch it.

- [ ] **Step 5: Start a fresh canary branch from the then-current `main`**

Do not continue PR #200 and do not use its branch as the activation proof.

The objective must use the approved activation canary documents and authorize exactly:

```text
docs/verification/canary/trick-harness-v2-activation.md
```

The implementation must create only the approved one-line marker content specified by the existing canary design.

- [ ] **Step 6: Run the real OpenCode -> Trick Harness workflow**

Use the normal NeuroVia launcher/control path, not a fake or direct unit-test invocation.

Required workflow evidence:
- implementation exact;
- unrelated changes: zero;
- `repairCycles = 0`;
- unexpected scope expansion: zero;
- required certifying stages: `PASS`;
- stage constraints: empty;
- terminal readiness: `PR_READY`;
- bounded delivery capability creates the PR;
- no orphan process after shutdown;
- no transient ready/token/log artifact left behind.

If any stage reports an environmental constraint, the canary is not activation success even if the product file is correct.

- [ ] **Step 7: Verify GitHub evidence on the exact fresh PR head**

Confirm on the exact PR HEAD SHA:
- standard CI is green;
- Windows harness CI is green;
- `plurora/harness-certification` transitions from `pending` to `success`;
- certification SHA equals the current PR head SHA.

A success status on an older SHA does not count.

- [ ] **Step 8: Verify enforcement separately from activation**

Read branch/ruleset protection for NeuroVia `main` with an account/integration that has permission to inspect it.

Required operational state:

```text
plurora/harness-certification is a required status/check for main
```

If permissions prevent verification or repository configuration does not enforce it, record that as an explicit **external enforcement gap**. Do not claim production merge protection until this is verified/configured.

- [ ] **Step 9: Close historical canary evidence only after the fresh canary succeeds**

After the fresh activation PR demonstrates the new behavior, PR #200 and any earlier superseded activation canary PR may be closed as historical/superseded evidence. Do not treat them as the successful activation proof.

- [ ] **Step 10: Record the final activation facts**

The activation record must name:
- hardened Trick Harness SHA;
- NeuroVia pin commit;
- fresh canary PR number and exact head SHA;
- `repairCycles = 0`;
- CI conclusions;
- certification context/state;
- enforcement status or explicit enforcement gap.

Do not include credentials, raw executor transcripts, or provider payloads.

---

## Final Acceptance Matrix

Before declaring V2 activation complete, verify every row:

| Scenario | Required result |
| --- | --- |
| Invalid global `core.excludesFile` | `harness:check` PASS |
| Required verify check unavailable only because of sandbox | `INCONCLUSIVE`, zero repair |
| `PASS + StageConstraint` | reconciled to `INCONCLUSIVE` |
| Confirmed product bug | `FAIL`, repair only if authorized |
| `UNRESOLVED` | `INCONCLUSIVE` |
| `PARTIAL` without repairable finding | no repair |
| Repair finding outside approved Plan paths | refused before writable dispatch |
| Repair mutates extra unauthorized path | `BLOCKED`, no delivery |
| Legitimate in-scope repair | normal diagnosis/repair/reverify path succeeds |
| Harness-requested OpenCode cancellation | `status: aborted` |
| OpenCode internal `MessageAbortedError` | category `other`, safe stable code |
| Malformed OpenCode SDK response | category `other`, never incidental `TypeError` |
| Startup/transport failure | `transport-unavailable` |
| Old journal | readable with empty/absent new facts |
| Agent omits a changed path from diff evidence | deterministic delivery still sees the path |
| Fresh activation canary | one approved file, `repairCycles=0`, `PR_READY` |
| GitHub certification | `success` on exact current PR HEAD |
| Main enforcement | required certification verified, or explicit gap recorded |
