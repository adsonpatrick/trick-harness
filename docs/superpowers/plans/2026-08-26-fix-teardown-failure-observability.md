# Teardown Failure Observability Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Suggested issue title:** `[HIGH] Surface OpenCode/Codex teardown failures instead of swallowing them`

**Goal:** Ensure every provider teardown failure becomes a safe structured observable fact without masking the primary run result.

**Architecture:** Providers continue to own product-specific teardown. The executor contract gains a bounded cleanup diagnostic channel so cleanup faults can be recorded separately from the primary task outcome. Raw stderr, environment and credential-bearing product text remain prohibited.

**Tech Stack:** TypeScript, Vitest, OpenCode SDK adapter, Codex subagent runtime.

**Spec:** Embedded below.

## Correction Spec

### Problem

Both provider implementations currently catch and discard teardown failures. OpenCode `closeQuietly()` swallows `server.close()` errors while comments claim they reach a diagnostics path that does not exist. Codex similarly catches `run.dispose()` failures and discards them. A task can therefore appear fully clean even when owned product cleanup failed.

### Required behavior

- A cleanup failure must never disappear silently.
- Cleanup failure reporting must be safe for durable logs: no raw stderr, response body, environment, stack, credentials or arbitrary provider prose.
- Primary task outcome and cleanup outcome remain distinct. A completed task may remain `completed`, but must carry an explicit cleanup fault fact that prevents false quiescence/assurance claims.
- OpenCode server-close failures produce a stable machine-readable cleanup category.
- Codex run-disposal failures produce a stable machine-readable cleanup category.
- Aborted/error task results can also carry cleanup facts.
- Teardown observation must integrate with the runtime lifecycle so final verification can determine whether cleanup was proven.

### Non-goals

- Do not expose raw product exceptions.
- Do not turn every cleanup fault into a retry/fallback routing event.
- Do not collapse cleanup failure into model-quality failure.

### Acceptance criteria

- Tests force OpenCode `server.close()` to reject and observe a structured cleanup fault.
- Tests force Codex `run.dispose()`/teardown to reject and observe a structured cleanup fault.
- No provider test expects silent swallow.
- Diagnostics contain fixed/redacted categories only.
- Cleanup faults are distinguishable from executor availability failures.
- Focused provider/runtime suites, typecheck and constraints pass.

## Global Constraints

- Never leak raw teardown exceptions to durable facts.
- Cleanup outcome is separate from primary task outcome.
- Availability fallback is not triggered solely by cleanup failure.

---

### Task 1: Define cleanup outcome contract with RED tests

**Files:**
- Modify: `packages/core/executor/src/types.ts`
- Modify: `packages/core/executor/tests/executor.spec.ts`

- [ ] Add a bounded type such as `ExecutorCleanupFailure { category: string; safeDiagnostic: string }` and an optional cleanup field on the executor result or an equivalent explicit lifecycle result owned by the runtime.
- [ ] Add tests proving cleanup facts can accompany completed, aborted and error primary outcomes without changing their classification.
- [ ] Assert raw error messages are not accepted as the durable contract.
- [ ] Run focused tests; expected: FAIL before implementation.

### Task 2: Make OpenCode cleanup observable

**Files:**
- Modify: `packages/providers/opencode/src/index.ts`
- Test: `packages/providers/opencode/tests/opencode.spec.ts`

- [ ] Replace `closeQuietly()` with a function that returns a safe cleanup fact on failure.
- [ ] Force `server.close()` rejection in a RED test.
- [ ] Preserve normal completed output while attaching `opencode-server-close` or equivalent fixed cleanup category.
- [ ] Verify no raw exception text reaches the result.

### Task 3: Make Codex cleanup observable

**Files:**
- Modify: `packages/providers/codex/src/index.ts`
- Test: `packages/providers/codex/tests/codex.spec.ts`

- [ ] Force `run.dispose()`/teardown rejection in a RED test.
- [ ] Translate the teardown fault to a fixed safe category such as `codex-run-dispose`.
- [ ] Preserve the primary result classification separately.
- [ ] Ensure cleanup failure does not set `availability: true` and therefore cannot silently activate model fallback.

### Task 4: Integrate cleanup evidence with quiescent disposal

**Files:**
- Modify as needed: `packages/core/executor/src/index.ts`
- Test: `packages/core/executor/tests/executor.spec.ts`

- [ ] Ensure runtime disposal waits for the provider's terminal cleanup path.
- [ ] Preserve cleanup failure evidence after run settlement for the caller/verifier.
- [ ] Do not report quiescent-clean success when a cleanup failure is present.

### Task 5: Verify and commit

- [ ] Run provider-focused Vitest suites.
- [ ] Run executor lifecycle suite.
- [ ] Run `pnpm run typecheck`.
- [ ] Run `pnpm run constraints`.
- [ ] Commit: `fix(providers): surface teardown failures safely`.

## Independent verification

Fresh-context review must inject failing teardown implementations and verify two properties simultaneously: the primary result remains correctly classified and the cleanup failure is independently visible without secret-bearing text.