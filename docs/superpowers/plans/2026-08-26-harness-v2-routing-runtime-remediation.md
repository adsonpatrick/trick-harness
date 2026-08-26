# Harness V2 Routing Runtime Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Plurora routing invariants, availability fallback, circuit breaking, and one-run manual override true in the live WorkflowRunner rather than only in pure router tests.

**Architecture:** Providers normalize native execution failures into the Harness routing vocabulary at the provider boundary. The WorkflowRunner owns per-workflow degraded/circuit state and reroutes the same stage only for availability failures. Hard Plurora invariants are applied after fallback selection, and a human stage override is single-consumption, journaled, and never widens permission authority.

**Tech Stack:** TypeScript, Vitest, DSH Session journal, Trick Harness executor/providers/routing/workflow/control-server/composition.

**Spec:** `docs/superpowers/specs/2026-08-26-harness-v2-pr-review-remediation-design.md`

**Requires:** `docs/superpowers/plans/2026-08-26-fix-plurora-routing-policy.md` implemented first.

## Global Constraints

- Heavy/high-volume implementation, repair and QA execution use OpenCode + MiMo V2.5 unless a human explicitly overrides that executor run.
- OpenCode outage must not automatically send heavy work to Codex.
- Availability failure may reroute; quality/request/policy failure may not.
- Fallback attempts count against `maxExecutorStarts`.
- Manual override is single-consumption, stage-scoped, journaled, and cannot widen permission mode.
- No provider or workflow mutates global OpenCode/Codex configuration.
- All fallback/circuit decisions are observable durable facts.

---

### Task 1: Normalize Provider Failure Categories at the Provider Boundary

**Files:**
- Modify: `packages/providers/codex/src/config.ts`
- Modify: `packages/providers/codex/tests/config.spec.ts`
- Modify: `packages/core/routing/src/index.ts`
- Modify: `packages/core/routing/tests/availability.spec.ts`
- Modify: `packages/core/executor/src/types.ts` only if the normalized category type is owned there rather than as a string union in routing/contracts.

**Interfaces:**
- Consumes: current `ExecutorFailure { category, availability, safeDiagnostic, httpStatus? }`.
- Produces: one normalized category vocabulary matching `packages/core/routing` exactly.

Use these normalized values for Codex mappings:

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

Unknown native categories become `other`, `availability: false`; they are never guessed into availability.

- [ ] **Step 1: Write RED provider tests for the native-to-normalized mapping**

Add table-driven assertions in `packages/providers/codex/tests/config.spec.ts`:

```ts
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

Run:

```bash
pnpm vitest run packages/providers/codex/tests/config.spec.ts
```

Expected: at least the `usageLimitExceeded` assertion fails because the current result still exposes the native camelCase category.

- [ ] **Step 3: Implement the explicit mapping in `packages/providers/codex/src/config.ts`**

Do not infer by regex/case conversion. Use a closed mapping so protocol changes fail safely.

- [ ] **Step 4: Align `packages/core/routing` failure vocab/tests with the same normalized strings**

Delete duplicate aliases that let camelCase and kebab-case both pass. There must be one routing vocabulary.

- [ ] **Step 5: Run provider + routing tests GREEN**

```bash
pnpm vitest run packages/providers/codex/tests/config.spec.ts packages/core/routing/tests/availability.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/providers/codex packages/core/routing packages/core/executor/src/types.ts
git commit -m "fix(trick): normalize executor failure categories"
```

---

### Task 2: Enforce the Heavy-Work Invariant Across Fallback Selection

**Files:**
- Modify: `packages/core/routing/src/index.ts`
- Modify: `packages/core/routing/tests/availability.spec.ts`
- Modify: `profiles/plurora/routing-policy.ts`
- Modify: `profiles/plurora/tests/routing-policy.spec.ts`

**Interfaces:**
- Consumes: `RoutingContext`, `RoutingPolicy`, `RouteDecision`.
- Produces: fallback resolution that cannot return a route violating a hard workload invariant unless `userOverride` explicitly names the alternate route.

Define a deterministic helper in routing, for example:

```ts
export function isHeavyWrite(context: RoutingContext): boolean {
  return (
    (context.role === 'implement' || context.role === 'repair' || context.role === 'qa') &&
    (context.workload === 'heavy' || context.writeVolume === 'large')
  )
}
```

For Plurora, the profile/routing policy must reject automatic fallback from OpenCode for `isHeavyWrite(context) === true`.

- [ ] **Step 1: Add RED tests for OpenCode outage under heavy work**

In `profiles/plurora/tests/routing-policy.spec.ts`, cover all three relevant roles:

```ts
it.each(['implement', 'repair', 'qa'] as const)(
  'does not auto-fallback heavy %s work from OpenCode to Codex',
  (role) => {
    expect(() => route(pluroraContext({
      role,
      workload: 'heavy',
      writeVolume: role === 'qa' ? 'none' : 'large',
      degradedExecutors: ['opencode'],
    }), pluroraPolicy)).toThrow(expect.objectContaining({ code: 'no-fallback' }))
  },
)
```

- [ ] **Step 2: Add a RED explicit-override counterpart**

```ts
const decision = route(pluroraContext({
  role: 'implement',
  workload: 'heavy',
  writeVolume: 'large',
  degradedExecutors: ['opencode'],
  userOverride: { executor: 'codex', semanticModelTier: 'codex.balanced', reasoningEffort: 'high' },
}), pluroraPolicy)
expect(decision.executor).toBe('codex')
expect(decision.reasonCodes).toContain('override:human')
```

- [ ] **Step 3: Run RED**

```bash
pnpm vitest run profiles/plurora/tests/routing-policy.spec.ts packages/core/routing/tests/availability.spec.ts
```

Expected: automatic heavy fallback currently resolves to Codex or otherwise fails the new invariant assertion.

- [ ] **Step 4: Implement hard-invariant fallback validation**

Apply the invariant after identifying the primary route and before accepting a fallback decision. Do not encode model ids inside `WorkflowRunner`.

- [ ] **Step 5: Remove/guard the generic Plurora `opencode-unavailable` fallback for heavy writes**

Keep automatic fallback for light/medium cases that profile policy authorizes.

- [ ] **Step 6: Run GREEN and commit**

```bash
pnpm vitest run profiles/plurora/tests/routing-policy.spec.ts packages/core/routing/tests/availability.spec.ts
git add packages/core/routing profiles/plurora
git commit -m "fix(plurora): keep heavy fallback on workhorse invariant"
```

---

### Task 3: Wire Availability Failure and Circuit State Into `WorkflowRunner`

**Files:**
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/src/types.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Modify: `packages/core/routing/src/index.ts` if a small exported circuit helper is needed.
- Modify: `packages/core/journal/src/index.ts` only to call existing `circuitBreaker` / `routeFallback` helpers; journal event-shape changes belong to the journal plan.

**Interfaces:**
- Consumes: normalized `ExecutorFailure`, `openCircuit`, `recordFailure`, `recordSuccess`, `degradedExecutors`, `route`, `WorkflowJournal`.
- Produces: one per-workflow circuit map and rerouting loop for the same `StageSpec`.

The workflow-owned state should be equivalent to:

```ts
const circuits = new Map<string, ExecutorCircuit>()
```

The runner must derive `RoutingContext.degradedExecutors` from current circuit state plus any startup degraded list supplied by composition.

- [ ] **Step 1: Replace the current “availability error => FAIL” expectation with RED fallback tests**

In `workflow.spec.ts`, add a builder/reviewer fixture where Codex-equivalent provider fails once:

```ts
reviewer.start = vi.fn()
  .mockResolvedValueOnce({
    status: 'error',
    output: '',
    failure: {
      category: 'usage-limit-exceeded',
      availability: true,
      safeDiagnostic: 'codex quota unavailable',
    },
  })
  .mockResolvedValue({ status: 'completed', output: 'unused' })
```

Register the authorized fallback provider and assert:

```ts
expect(outcome.state).toBe('completed')
expect(outcome.executorStarts).toBeGreaterThan(3)
expect(projectWorkflow(session.events, 'wf-1').circuits.reviewer).toBe('DEGRADED')
expect(projectWorkflow(session.events, 'wf-1').routes.some(route => route.fallbackFrom === 'reviewer')).toBe(true)
```

Use policy fixture names consistently; do not hard-code Codex semantics into the generic workflow test.

- [ ] **Step 2: Add a RED test that quality failure does not fallback**

Return:

```ts
failure: {
  category: 'bad-request',
  availability: false,
  safeDiagnostic: 'request rejected',
}
```

Assert fallback provider is never called and the workflow terminates with failure/blocking evidence according to current error semantics.

- [ ] **Step 3: Add a RED test for the start budget**

Make primary and fallback availability-fail until the `maxExecutorStarts` ceiling; assert terminal `BLOCKED`/`FAIL` per workflow budget policy and no unbounded retry.

- [ ] **Step 4: Implement same-stage rerouting**

Inside dispatch/drive:

```text
start primary
 -> completed/aborted: existing path
 -> error + availability=false: existing failure path
 -> error + availability=true:
      recordFailure(circuit)
      journal circuit transition
      rebuild RoutingContext with degraded executor
      resolve fallback
      journal route fallback
      increment executorStarts
      dispatch fresh provider run
```

Do not reuse the failed provider session/run.

- [ ] **Step 5: Ensure successful bounded probe/manual refresh is the only way to return a degraded circuit to AVAILABLE**

Do not guess a reset time from provider text.

- [ ] **Step 6: Run focused workflow/routing tests GREEN**

```bash
pnpm vitest run packages/core/engineering-workflow/tests/workflow.spec.ts packages/core/routing/tests/availability.spec.ts
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
- Produces:

```ts
export interface StageRouteOverride {
  readonly role: Role
  readonly executor: string
  readonly semanticModelTier?: string
  readonly reasoningEffort?: string
}
```

`WorkflowRunRequest` gains:

```ts
readonly routeOverride?: StageRouteOverride
```

Control-server `POST /workflows` accepts an optional `routeOverride` sibling to `objective` after strict parsing.

- [ ] **Step 1: Add RED contract parser tests**

Reject blank executor, unknown role, array/object where strings are required, and extra fields if the project parser strips undeclared data by contract.

- [ ] **Step 2: Add RED WorkflowRunner single-consumption test**

Create a workflow with two stages sharing the same role through a custom plan. Assert the override changes only the first matching dispatch and the second returns to policy routing.

- [ ] **Step 3: Add RED permission-safety test**

Attempt to route `review` through an executor override while keeping role read-only. Assert the provider request still has `permissionMode: 'read-only'`.

- [ ] **Step 4: Add RED control-server request test**

POST a valid objective + override and assert the starter receives the parsed override; POST malformed override and expect 400 without starting a workflow.

- [ ] **Step 5: Implement parser and workflow plumbing**

The WorkflowRunner injects `userOverride` into exactly one matching `RoutingContext`, marks it consumed only after a route is successfully resolved, and records `override:human` in reason codes.

- [ ] **Step 6: Thread the override through `composeHarness()`**

Do not mutate profile routing tables or provider config objects.

- [ ] **Step 7: Run focused tests GREEN**

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
- Modify: `profiles/plurora/tests/routing-policy.spec.ts`
- Modify: `packages/composition/runtime/tests/harness.spec.ts`
- Modify: `packages/composition/runtime/README.md`
- Modify: `profiles/plurora/README.md` if it documents routing/fallback behavior.

**Interfaces:**
- Consumes: the real `pluroraProfile` and composed executor runtime.
- Produces: cross-package evidence that profile policy, live workflow fallback and override agree.

- [ ] **Step 1: Add a real-profile composition test for Codex availability fallback**

Use fake providers named `codex` and `opencode`, but use the actual Plurora profile/registry. Make Codex review fail with `usage-limit-exceeded`; assert fresh OpenCode reasoning fallback and explicit `fallbackFrom: 'codex'`.

- [ ] **Step 2: Add a real-profile heavy OpenCode outage test**

Make a heavy implementation objective with OpenCode unavailable. Assert the workflow blocks before starting Codex unless an explicit override is supplied.

- [ ] **Step 3: Add a real-profile override test**

Assert override is visible in durable route facts and does not persist to the next stage/workflow.

- [ ] **Step 4: Run all routing/runtime package tests and project gates**

```bash
pnpm vitest run packages/core/routing packages/core/engineering-workflow packages/providers/codex profiles/plurora packages/composition/runtime
pnpm typecheck
pnpm lint
pnpm build
```

Run the repository constraint/doc gates using the scripts documented in the root `package.json`/AGENTS.md.

- [ ] **Step 5: Independent review gate**

Fresh reviewer must verify specifically:

```text
heavy invariant
availability-vs-quality separation
bounded fallback
single-consumption override
permission preservation
durable fallback/circuit evidence
```

- [ ] **Step 6: Commit docs/test completion**

```bash
git add profiles/plurora packages/composition/runtime
git commit -m "test(trick): prove live Plurora routing remediation"
```
