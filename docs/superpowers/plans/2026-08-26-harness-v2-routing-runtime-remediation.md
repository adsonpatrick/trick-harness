# Harness V2 Routing Runtime Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Plurora routing invariants, availability fallback, circuit breaking, and one-run manual override true in the live WorkflowRunner rather than only in pure router tests.

**Architecture:** Providers normalize native execution failures into the Harness routing vocabulary at the provider boundary. `WorkflowRunner` owns per-workflow degraded/circuit state and reroutes the same stage only for availability failures. Hard Plurora invariants are applied after fallback selection, and a human stage override is single-consumption, journaled, and never widens permission authority.

**Tech Stack:** TypeScript, Vitest, DSH Session journal, Trick Harness executor/providers/routing/workflow/control-server/composition.

**Spec:** `docs/superpowers/specs/2026-08-26-harness-v2-pr-review-remediation-design.md`

**Requires:** `docs/superpowers/plans/2026-08-26-fix-plurora-routing-policy.md` implemented first.

## Global Constraints

- Heavy/high-volume implementation, repair and QA execution use OpenCode + MiMo V2.5 unless a human explicitly overrides that executor run.
- OpenCode outage may send heavy work to Codex only while Codex is usable; with no usable executor the run BLOCKS, and that block is the expected outcome rather than a defect (amended 2026-08-26 by the project owner).
- An executor with no usable credential is degraded, so the block above happens for the stated reason and not at dispatch time.
- Availability failure may reroute; quality/request/policy failure may not.
- Fallback attempts count against `maxExecutorStarts`.
- Manual override is single-consumption, stage-scoped, journaled, and cannot widen permission mode.
- No provider or workflow mutates global OpenCode/Codex configuration.
- All fallback/circuit decisions are observable durable facts.

---

### Task 1: Normalize Provider Failure Categories at the Provider Boundary

**Files:**
- Modify: `packages/providers/codex/src/config.ts`
- Modify: `packages/providers/codex/tests/codex.spec.ts`
- Modify: `packages/core/routing/src/index.ts`
- Modify: `packages/core/routing/tests/availability.spec.ts`

**Interfaces:**
- Consumes: current `ExecutorFailure { category, availability, safeDiagnostic, httpStatus? }`.
- Produces: one normalized category vocabulary matching `packages/core/routing` exactly.

Use this explicit mapping in `packages/providers/codex/src/config.ts`:

```ts
const CODEX_FAILURE_MAP = {
  usageLimitExceeded: 'usage-limit-exceeded',
  sessionBudgetExceeded: 'session-budget-exceeded',
  serverOverloaded: 'server-overloaded',
  internalServerError: 'internal-server-error',
  httpConnectionFailed: 'transport-unavailable',
  responseStreamConnectionFailed: 'transport-unavailable',
  responseStreamDisconnected: 'transport-unavailable',
  responseTooManyFailedAttempts: 'transport-unavailable',
  contextWindowExceeded: 'context-window-exceeded',
  badRequest: 'bad-request',
  sandboxError: 'sandbox-denied',
  cyberPolicy: 'cyber-policy-refusal',
  unauthorized: 'unauthorized',
} as const
```

Unknown native categories become `other`, `availability: false`.

- [ ] **Step 1: Write RED provider tests in `packages/providers/codex/tests/codex.spec.ts`**

```text
it.each([
  ['usageLimitExceeded', 'usage-limit-exceeded', true],
  ['sessionBudgetExceeded', 'session-budget-exceeded', true],
  ['serverOverloaded', 'server-overloaded', true],
  ['httpConnectionFailed', 'transport-unavailable', true],
  ['contextWindowExceeded', 'context-window-exceeded', false],
  ['badRequest', 'bad-request', false],
  ['sandboxError', 'sandbox-denied', false],
  ['cyberPolicy', 'cyber-policy-refusal', false],
  ['unauthorized', 'unauthorized', false],
])('normalizes %s to %s', (native, normalized, availability) => {
  expect(executorFailure(native)).toMatchObject({ category: normalized, availability })
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
pnpm vitest run packages/providers/codex/tests/codex.spec.ts
```

Expected: at least `usageLimitExceeded` fails because the current result still exposes the provider-native category.

- [ ] **Step 3: Implement the closed mapping**

Do not infer categories by case conversion. `executorFailure()` must emit only routing-normalized values.

- [ ] **Step 4: Align routing failure vocab/tests**

Remove duplicate aliases that allow provider-native camelCase and normalized kebab-case to coexist at the routing boundary.

- [ ] **Step 5: Run GREEN**

```bash
pnpm vitest run packages/providers/codex/tests/codex.spec.ts packages/core/routing/tests/availability.spec.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/providers/codex packages/core/routing
git commit -m "fix(trick): normalize executor failure categories"
```

---

### Task 2: Restrict Fallback Selection to Usable Executors

**Files:**
- Modify: `packages/core/routing/src/index.ts`
- Modify: `packages/core/routing/tests/availability.spec.ts`
- Modify: `profiles/plurora/routing-policy.ts`
- Modify: `profiles/plurora/tests/routing.spec.ts`

**Interfaces:**
- Consumes: `RoutingContext`, `RoutingPolicy`, `RouteDecision`.
- Produces: fallback resolution that only ever returns a usable executor, blocks when none is usable, and never resolves silently.

Add a deterministic helper equivalent to:

```text
export function isHeavyWrite(context: RoutingContext): boolean {
  return (
    (context.role === 'implement' || context.role === 'repair' || context.role === 'qa') &&
    (context.workload === 'heavy' || context.writeVolume === 'large')
  )
}
```

The invariant this task enforces is about the *tier*, not about staying on one product. Heavy work must never be answered by a cheap reasoning tier just because the workhorse went away; it may be answered by Codex when Codex can actually take the work, and it must block when nothing can.

- [ ] **Step 1: Add RED heavy-outage tests in `profiles/plurora/tests/routing.spec.ts`**

```text
it.each(['implement', 'repair', 'qa'] as const)(
  'moves heavy %s work to Codex when only OpenCode is degraded',
  (role) => {
    const decision = route(pluroraContext({
      role,
      workload: 'heavy',
      writeVolume: role === 'qa' ? 'none' : 'large',
      degradedExecutors: ['opencode'],
    }), pluroraPolicy)
    expect(decision.executor).toBe('codex')
    expect(decision.reasonCodes).toContain('fallback:opencode')
  },
)

it('blocks heavy work when no executor is usable', () => {
  expect(() => route(pluroraContext({
    role: 'implement',
    workload: 'heavy',
    writeVolume: 'large',
    degradedExecutors: ['opencode', 'codex'],
  }), pluroraPolicy)).toThrow(expect.objectContaining({ code: 'no-fallback' }))
})
```

- [ ] **Step 2: Add RED credential-degradation test**

An executor without a usable credential must reach `route` already in `degradedExecutors`, so the outcome is a stated block rather than a failed dispatch:

```text
expect(degradedFor({ codexCredential: 'missing' })).toContain('codex')
```

- [ ] **Step 3: Run RED**

```bash
pnpm vitest run profiles/plurora/tests/routing.spec.ts packages/core/routing/tests/availability.spec.ts
```

- [ ] **Step 4: Implement usable-executor fallback validation**

Apply the check after identifying the primary route and before accepting any automatic fallback decision: a fallback candidate is eligible only when it is neither degraded nor uncredentialed. Keep concrete model ids out of `WorkflowRunner`.

- [ ] **Step 5: Keep the Plurora `opencode-unavailable` fallback observable**

The row stands. What this step adds is that it can never fire silently: the decision carries `fallback:opencode`, and `independence:unsatisfied` is recorded when the fallback leaves no independent executor.

- [ ] **Step 6: Run GREEN and commit**

```bash
pnpm vitest run profiles/plurora/tests/routing.spec.ts packages/core/routing/tests/availability.spec.ts
git add packages/core/routing profiles/plurora
git commit -m "fix(plurora): fall back only to a usable executor"
```

---

### Task 3: Wire Availability Failure and Circuit State Into `WorkflowRunner`

**Files:**
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/src/types.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Modify: `packages/core/routing/src/index.ts`
- Modify: `packages/core/journal/src/index.ts`

**Interfaces:**
- Consumes: normalized `ExecutorFailure`, `openCircuit`, `recordFailure`, `recordSuccess`, `degradedExecutors`, `route`, `WorkflowJournal`.
- Produces: one per-workflow circuit map and a bounded rerouting loop for the same `StageSpec`.

```text
const circuits = new Map<string, ExecutorCircuit>()
```

- [ ] **Step 1: Add RED live availability fallback test**

In `packages/core/engineering-workflow/tests/workflow.spec.ts`, make the primary judging provider fail once:

```text
reviewer.start = vi.fn().mockResolvedValueOnce({
  status: 'error',
  output: '',
  failure: {
    category: 'usage-limit-exceeded',
    availability: true,
    safeDiagnostic: 'provider quota unavailable',
  },
})
```

Register the policy-authorized fallback provider and assert completed workflow, increased executor-start count, degraded circuit projection, and a route with `fallbackFrom`.

- [ ] **Step 2: Add RED quality-failure non-fallback test**

Return:

```text
failure: {
  category: 'bad-request',
  availability: false,
  safeDiagnostic: 'request rejected',
}
```

Assert the fallback provider is never called.

- [ ] **Step 3: Add RED bounded-start test**

Make primary and fallback availability-fail until `maxExecutorStarts`; assert terminal non-PASS and no unbounded retry.

- [ ] **Step 4: Implement same-stage rerouting**

```text
start primary
 -> completed/aborted: existing path
 -> error + availability=false: terminal failure path
 -> error + availability=true:
      recordFailure(circuit)
      journal circuit transition
      rebuild RoutingContext with degraded executor
      resolve fallback
      journal route fallback
      count the next executor start
      dispatch a fresh provider run
```

Do not reuse the failed provider run.

- [ ] **Step 5: Keep circuit recovery bounded**

Only an actual successful probe or explicit manual refresh can return a degraded circuit to AVAILABLE. Do not infer reset time from provider prose.

- [ ] **Step 6: Run GREEN**

```bash
pnpm vitest run packages/core/engineering-workflow/tests/workflow.spec.ts packages/core/routing/tests/availability.spec.ts packages/core/journal/tests/journal.spec.ts
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/engineering-workflow packages/core/routing packages/core/journal
git commit -m "fix(trick): route live availability failures through fallback"
```

---

### Task 4: Plumb a Single-Consumption Human Route Override Through Live APIs

**Files:**
- Modify: `packages/core/contracts/src/types.ts`
- Modify: `packages/core/contracts/src/index.ts`
- Modify: `packages/core/contracts/tests/contracts.spec.ts`
- Modify: `packages/core/engineering-workflow/src/types.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Modify: `packages/core/control-server/src/types.ts`
- Modify: `packages/core/control-server/src/index.ts`
- Modify: `packages/core/control-server/tests/server.spec.ts`
- Modify: `packages/composition/runtime/src/harness.ts`
- Modify: `packages/composition/runtime/tests/harness.spec.ts`

**Interfaces:**

```text
export interface StageRouteOverride {
  readonly role: Role
  readonly executor: string
  readonly semanticModelTier?: string
  readonly reasoningEffort?: string
}
```

`WorkflowRunRequest` gains:

```text
readonly routeOverride?: StageRouteOverride
```

- [ ] **Step 1: Add RED parser tests**

Reject blank executor, unknown role, arrays/objects where scalar strings are required, and undeclared fields according to the existing contracts parser policy.

- [ ] **Step 2: Add RED single-consumption test**

Use a custom plan with two stages of the same role. Assert only the first matching dispatch consumes the override; the second uses normal policy routing.

- [ ] **Step 3: Add RED permission-safety test**

Override executor/model for `review`; assert the provider request remains `permissionMode: 'read-only'`.

- [ ] **Step 4: Add RED control-server request test**

POST a valid objective + override and assert the starter receives it. POST malformed override and expect 400 with zero workflow starts.

- [ ] **Step 5: Implement workflow plumbing**

Inject `userOverride` into exactly one matching `RoutingContext`; mark it consumed only after route resolution succeeds; record `override:human` in reason codes.

- [ ] **Step 6: Thread the override through `composeHarness()`**

Do not mutate profile routing tables or provider config.

- [ ] **Step 7: Run GREEN**

```bash
pnpm vitest run \
  packages/core/contracts/tests/contracts.spec.ts \
  packages/core/engineering-workflow/tests/workflow.spec.ts \
  packages/core/control-server/tests/server.spec.ts \
  packages/composition/runtime/tests/harness.spec.ts
```

- [ ] **Step 8: Commit**

```bash
git add packages/core/contracts packages/core/engineering-workflow packages/core/control-server packages/composition/runtime
git commit -m "feat(trick): plumb single-run routing override"
```

---

### Task 5: Verify Routing Runtime as a Real Plurora Composition

**Files:**
- Modify: `profiles/plurora/tests/routing.spec.ts`
- Modify: `profiles/plurora/tests/composition.spec.ts`
- Modify: `packages/composition/runtime/tests/harness.spec.ts`
- Modify: `packages/composition/runtime/README.md`
- Modify: `profiles/plurora/README.md`

**Interfaces:**
- Consumes: real `pluroraProfile` and composed executor runtime.
- Produces: cross-package evidence that profile policy, live workflow fallback and override agree.

- [ ] **Step 1: Add real-profile Codex availability fallback test**

Use fake providers named `codex` and `opencode` with the actual Plurora profile/registry. Make Codex review fail with `usage-limit-exceeded`; assert fresh OpenCode reasoning fallback and `fallbackFrom: 'codex'`.

- [ ] **Step 2: Add real-profile heavy OpenCode outage test**

Heavy implementation with OpenCode unavailable routes to Codex and says so in the durable route fact. With Codex also unusable the workflow blocks before any dispatch, and the block is recorded as the outcome.

- [ ] **Step 3: Add real-profile override isolation test**

Assert override is visible in durable route facts and does not persist to the next stage or workflow.

- [ ] **Step 4: Run routing/runtime package tests and gates**

```bash
pnpm vitest run packages/core/routing packages/core/engineering-workflow packages/providers/codex profiles/plurora packages/composition/runtime
pnpm typecheck
pnpm lint
pnpm build
```

Then run the repository constraint/doc gates defined in the root `package.json` and `AGENTS.md`.

- [ ] **Step 5: Independent review gate**

Fresh reviewer verifies: heavy invariant, availability-vs-quality separation, bounded fallback, single-consumption override, permission preservation, durable fallback/circuit evidence.

- [ ] **Step 6: Commit docs/test completion**

```bash
git add profiles/plurora packages/composition/runtime
git commit -m "test(trick): prove live Plurora routing remediation"
```
