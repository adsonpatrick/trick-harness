# Profile Flat-Scalar Validation Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Suggested issue title:** `[HIGH] Enforce flat scalar profile policy at runtime boundaries`

**Goal:** Make `HarnessProfile` validation enforce the actual deterministic scalar-data contract and prevent unvalidated profiles from entering composition.

**Architecture:** Runtime validation remains centralized in `@trick-harness/profile`. `validateRules()` validates every key/value pair of `when` and `use`, not merely the container shape. Composition must validate or require a validated profile before reading routing policy.

**Tech Stack:** TypeScript, Vitest, structuredClone/deepFreeze, composition runtime.

**Spec:** Embedded below; normative contract is the `PolicyRuleDefinition` shape in `docs/superpowers/plans/2026-08-25-trick-harness-v2-reusable-core.md`.

## Correction Spec

### Problem

The type contract says `when` and `use` are `Record<string, string | number | boolean>`, but `validateRules()` currently only checks that each side is a non-null, non-array object. Nested objects, arrays and `null` values can pass a parsed/runtime boundary. `composeHarnessRuntime()` also consumes a `HarnessProfile` without calling `validateProfile()`, so JavaScript/deserialized callers can bypass the registry validator.

### Required behavior

- Every `when`/`use` value must be exactly `string`, finite `number`, or `boolean`.
- Nested objects, arrays, `null`, functions, symbols, bigint, `NaN` and infinities are rejected.
- Keys must be ordinary own enumerable string keys; inherited policy fields must not satisfy the contract.
- Profile registration continues to clone and deep-freeze accepted policy.
- Composition validates the supplied profile before reading `routingPolicy`, or accepts only a branded/validated profile produced by the registry. Prefer the smallest design consistent with current architecture; do not add a broad schema framework.
- Validation errors name the offending path, e.g. `routingPolicy.rules[0].use.executor`.

### Non-goals

- No executable policy callbacks.
- No general-purpose JSON schema subsystem.
- No routing-engine changes.

### Acceptance criteria

- RED tests reject nested object, array, null, NaN, Infinity and function values in both `when` and `use`.
- A plain valid scalar map still passes.
- Composition refuses an invalid profile before registering/starting product providers.
- No product process or provider start occurs on invalid composition.
- Profile immutability tests remain green.
- Profile/composition suites, typecheck and constraints pass.

## Global Constraints

- Policy is deterministic declarative scalar data only.
- Invalid input fails before dispatch/product startup.
- Keep the validation seam centralized and small.

---

### Task 1: Add adversarial RED validation tests

**Files:**
- Modify: `packages/core/profile/tests/profile.spec.ts`

- [ ] Add table-driven invalid values for `{ nested: true }`, `[]`, `null`, `NaN`, `Infinity`, `-Infinity`, function and bigint.
- [ ] Exercise invalid values on both `when` and `use`.
- [ ] Assert errors include the precise dotted/indexed field path.
- [ ] Add inherited-property case using `Object.create(...)` if composition accepts unknown parsed values.
- [ ] Run `pnpm vitest run packages/core/profile/tests/profile.spec.ts`; expected: FAIL.

### Task 2: Enforce scalar values in `validateRules`

**Files:**
- Modify: `packages/core/profile/src/index.ts`

- [ ] Add a small `validateScalarTable(value, path)` helper.
- [ ] Require an own plain object container.
- [ ] Iterate `Object.entries()` and accept only string, boolean, or finite number.
- [ ] Throw `ProfileValidationError` at the exact entry path for every rejected value.
- [ ] Reuse the helper for both `when` and `use`.
- [ ] Run profile tests; expected: PASS.

### Task 3: Close the composition bypass

**Files:**
- Modify: `packages/composition/runtime/src/index.ts`
- Modify: `packages/composition/runtime/tests/bundle.spec.ts`

- [ ] Add a RED test passing an invalid profile via an unsafe cast/plain JS-shaped object.
- [ ] Assert composition fails before provider registration side effects escape and before any product seam is reached.
- [ ] Call `validateProfile(options.profile)` before `routedExecutors()` or introduce the minimal validated-profile seam if that produces cleaner ownership.
- [ ] Preserve all-or-nothing registration rollback.
- [ ] Run composition tests; expected: PASS.

### Task 4: Verify and commit

- [ ] Run `pnpm vitest run packages/core/profile/tests/profile.spec.ts packages/composition/runtime/tests/bundle.spec.ts`.
- [ ] Run `pnpm run typecheck`.
- [ ] Run `pnpm run constraints`.
- [ ] Inspect the diff for new executable-policy escape hatches.
- [ ] Commit: `fix(profile): enforce scalar policy boundaries`.

## Independent verification

Fresh review should construct invalid profiles outside TypeScript's type system and prove that both registry and composition reject them before dispatch.