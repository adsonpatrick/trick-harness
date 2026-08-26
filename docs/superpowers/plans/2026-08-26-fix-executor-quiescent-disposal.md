# Executor Quiescent Disposal Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Suggested issue title:** `[HIGH] Make executor runtime disposal quiescent and await in-flight teardown`

**Goal:** Make runtime disposal prove that all in-flight provider work has settled and owned process trees have completed teardown before the runtime reports quiescence.

**Architecture:** The executor runtime owns run accounting and cancellation, therefore it must track run promises in addition to abort controllers. Disposal becomes asynchronous, aborts every owned run, awaits settlement, and only then clears run state. Cordis/service and composition disposal surfaces must preserve that asynchronous contract.

**Tech Stack:** TypeScript, Vitest, Cordis lifecycle, DeepSeek Harness subprocess semantics.

**Spec:** Embedded below.

## Correction Spec

### Problem

`createExecutorRuntime().dispose()` currently aborts controllers, clears `inFlight` immediately and returns `void`. `activeRuns()` can therefore report `0` while provider cleanup is still running. `ExecutorRuntime.stop()` and bundle disposal are also synchronous. This violates the Harness v2 requirement that cancellation/disposal reaches quiescence rather than merely requesting it.

### Required behavior

- `dispose()` must be awaitable and idempotent.
- On disposal, no new run may start.
- Every active run is aborted exactly once through the runtime-owned signal.
- Runtime-owned active run accounting remains non-zero until each provider `start()` promise settles after its own teardown.
- Disposal resolves only when all runs that were active at disposal time are settled.
- `activeRuns()` returns `0` only after those run promises have settled.
- Cordis `stop()`/service disposal and composed-bundle disposal must await the runtime disposal promise.
- A provider that ignores abort cannot make disposal silently claim success; the runtime must wait for that provider settlement according to the owned lifecycle contract. Any timeout policy belongs in a separate explicit lifecycle layer, not as an implicit early return here.

### Non-goals

- Do not redesign provider-specific teardown ladders.
- Do not add arbitrary global timeouts.
- Do not weaken subprocess `waitForExit()` semantics.

### Acceptance criteria

- A RED test proves `activeRuns() === 1` after `dispose()` is initiated but before a slow provider settles.
- A RED test proves the disposal promise remains pending until provider settlement.
- After settlement, disposal resolves and `activeRuns() === 0`.
- Double disposal is safe and returns the same terminal lifecycle outcome.
- Starts after disposal are refused.
- Composition and Cordis lifecycle tests await quiescence.
- Focused executor/composition tests, typecheck and constraints pass.

## Global Constraints

- Quiescence means provider settlement after teardown, not signal delivery.
- No synchronous false-zero run accounting.
- No fire-and-forget lifecycle cleanup.

---

### Task 1: Add failing quiescence tests

**Files:**
- Modify: `packages/core/executor/tests/executor.spec.ts`
- Modify: `packages/composition/runtime/tests/bundle.spec.ts`

- [ ] Create a slow provider whose `start()` observes abort but does not resolve until the test releases it.
- [ ] Assert `runtime.dispose()` returns/behaves as an awaitable promise.
- [ ] Initiate disposal and assert `activeRuns()` remains `1` until the provider resolves.
- [ ] Assert disposal remains pending before release and resolves after release.
- [ ] Add bundle-level equivalent proving `bundle.dispose()` awaits the same settlement.
- [ ] Run focused tests; expected: FAIL against synchronous disposal.

### Task 2: Track active run promises in the core runtime

**Files:**
- Modify: `packages/core/executor/src/types.ts`
- Modify: `packages/core/executor/src/index.ts`

**Interfaces:**
- Change `HarnessExecutorRuntime.dispose(): void` to `dispose(): Promise<void>`.

- [ ] Track each active run as an owned record containing its abort controller and settlement promise.
- [ ] Keep the record in the active set until provider `start()` exits its `finally` path.
- [ ] Make `dispose()` set the disposed state first, abort all owned controllers, snapshot their settlement promises and await them.
- [ ] Clear registrations at disposal start, but do not falsify run accounting.
- [ ] Make repeated disposal idempotent by retaining the in-progress/terminal disposal promise.
- [ ] Run executor tests; expected: PASS.

### Task 3: Propagate async disposal through composition and Cordis

**Files:**
- Modify: `packages/composition/runtime/src/index.ts`
- Modify: `packages/core/executor/src/index.ts`
- Test: `packages/composition/runtime/tests/bundle.spec.ts`

- [ ] Change `HarnessRuntimeBundle.dispose()` to `Promise<void>`.
- [ ] Unregister composition registrations, then await runtime disposal for owned bundles.
- [ ] Make `ExecutorRuntime.stop()` return/await the runtime disposal promise in the lifecycle form Cordis accepts.
- [ ] Preserve `composeHarnessRuntime(...).dispose()` as registration-only disposal when it does not own the runtime.
- [ ] Update tests to await async owners explicitly.

### Task 4: Verify lifecycle invariants

- [ ] Run `pnpm vitest run packages/core/executor/tests/executor.spec.ts packages/composition/runtime/tests/bundle.spec.ts`.
- [ ] Run relevant provider lifecycle suites.
- [ ] Run `pnpm run typecheck`.
- [ ] Run `pnpm run constraints`.
- [ ] Commit: `fix(executor): await quiescent runtime disposal`.

## Independent verification

Use a fresh-context verifier with a deliberately slow fake provider. Evidence must demonstrate real pending disposal before release and terminal zero active runs only after release.