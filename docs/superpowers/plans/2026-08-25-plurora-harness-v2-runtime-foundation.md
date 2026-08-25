# Plurora Harness V2 Runtime Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the real Plurora fork of DeepSeek Harness and establish a tested executor runtime with first-class OpenCode and Codex providers plus optional Claude Code support, without coupling routing policy to the generic upstream subagent API.

**Architecture:** Keep DeepSeek Harness core close to upstream. Add fork-local private packages under `packages/plurora/*` with namespace `@plurora/harness-*`. A new `PluroraExecutorRuntime` sits beside upstream `SubagentRuntime`; providers translate one resolved executor request into official OpenCode, Codex, or Claude product runtimes. Existing upstream Codex/Claude process/protocol code is refactored only enough to expose reusable lower-level one-shot transport while preserving current subagent behavior.

**Tech Stack:** `deepseek-ai/deepseek-harness` at initial upstream baseline `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (`0.1.1-rc.2`), TypeScript strict ESM, Cordis, pnpm 11.7, Vitest, OpenCode official SDK/server/ACP, `@openai/codex` app-server, Claude Agent SDK/CLI, DSH subprocess/session/testing infrastructure.

**Spec:** `docs/superpowers/specs/2026-08-25-plurora-engineering-harness-v2-design.md`

> **Normative override:** Apply `2026-08-25-trick-harness-v2-reusable-core.md` before dispatching any task. It replaces stale repository names, paths, package scope, runtime type names, and policy ownership in this historical detailed plan.

## Global Constraints

- This plan executes in a dedicated real fork; canonical target is now `adsonpatrick/trick-harness` per Plan R.
- Preserve upstream MIT `LICENSE`, git ancestry, and an `upstream` remote.
- Start implementation from the exact current upstream/fork baseline observed at execution; record any drift from the planning baseline before editing.
- Do not add `model`/`reasoningEffort` fields to generic upstream `SubagentStartRequest` solely for Plurora routing.
- Apply Plan R namespace/path substitutions (`@trick-harness/*`, `packages/core`, `packages/providers`, `packages/integrations`).
- Per-run model selection must never rewrite global/user OpenCode or Codex config files.
- Provider credentials/authentication remain product-native; never copy subscription credentials into config, prompts, event logs, or test fixtures.
- OpenCode and Codex are required providers. Claude Code is optional and may be disabled without changing core runtime semantics.
- Provider failures return safe structured facts; raw stderr/environment/credentials are not part of the public result.
- Cancellation/disposal must terminate owned process trees to quiescence.
- Follow upstream package conventions: package README, JSDoc, `./invariant`, Host aggregate registration, focused unit tests, HMR/disposal test, real-composition/product test when visible, Agent Note for non-trivial changes, and relevant docs gates.

---

## Task 1: Create and Baseline the Real Fork

**Files (fork):**
- Preserve: `LICENSE`
- Create: `docs/plurora/upstream.md`
- Create: `.agents/notes/implemented/architecture/<date>-plurora-fork-foundation.md`

**Produces:** a cloneable Plurora-owned fork with upstream ancestry, recorded baseline, and no behavioral changes.

- [ ] **Step 1: Inspect current tools and upstream before mutation**

```bash
gh --version
gh repo fork --help
git --version
```

Fetch the current upstream head and compare it to planning baseline `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. If upstream moved, record the new exact SHA and release/version; do not silently assume the old tree.

- [ ] **Step 2: Create the real fork and clone it**

Use current supported `gh repo fork` syntax. The resulting repository must have GitHub fork ancestry to `deepseek-ai/deepseek-harness`. Plan R updates the canonical repository to `adsonpatrick/trick-harness`.

```bash
gh repo clone adsonpatrick/trick-harness
cd trick-harness
git remote -v
```

Expected: `origin` is the Trick Harness fork. Add/verify `upstream` points to `https://github.com/deepseek-ai/deepseek-harness.git`.

- [ ] **Step 3: Verify clean upstream baseline**

```bash
corepack enable
pnpm install
pnpm run typecheck
pnpm run test
```

Expected: baseline gates pass before Trick changes. If upstream baseline is already red, record exact failure and stop this plan until distinguished from Trick work.

- [ ] **Step 4: Add provenance documentation**

Record upstream repository, initial upstream SHA and DSH version, MIT preservation rule, remote/sync procedure, and divergence ledger rule. Plan R owns the canonical `docs/trick-harness/upstream.md` path.

- [ ] **Step 5: Commit documentation slice**

```bash
git add LICENSE docs/trick-harness .agents/notes
git diff --cached --check
git commit -m "docs(trick): record harness fork provenance"
```

---

## Task 2: Establish the Fork-Local Package Namespace

**Files (fork):**
- Modify: `scripts/check-workspace-constraints.ts`
- Modify: `scripts/check-workspace-constraints.spec.ts`
- Modify: `tsconfig.base.json`
- Later per package: `tsconfig.host.json`
- Create first fixture package per Plan R under `packages/core/profile/*`

**Produces:** private `@trick-harness/*` packages accepted only under Plan R approved paths, while upstream package publication rules remain intact.

- [ ] **Step 1: Write RED workspace-constraint tests** according to Plan R Task 2.
- [ ] **Step 2: Run focused RED**

```bash
pnpm vitest run scripts/check-workspace-constraints.spec.ts
```

- [ ] **Step 3: Implement the narrow fork-local constraint branch** without relaxing upstream publication rules.
- [ ] **Step 4: Add TypeScript path resolution for `@trick-harness/*`** while preserving `@deepseek-ai/dsh-*` mappings.
- [ ] **Step 5: Verify GREEN and repository constraints**

```bash
pnpm vitest run scripts/check-workspace-constraints.spec.ts
pnpm run constraints
```

- [ ] **Step 6: Commit namespace slice**

```bash
git add scripts/check-workspace-constraints* tsconfig.base.json
git commit -m "build(trick): allow private harness packages"
```

---

## Task 3: Add the Common Executor Capability

**Files (fork):**
- Create: `packages/core/executor/package.json`
- Create: `packages/core/executor/tsconfig.json`
- Create: `packages/core/executor/src/types.ts`
- Create: `packages/core/executor/src/index.ts`
- Create: `packages/core/executor/src/invariant.ts`
- Create: `packages/core/executor/tests/executor.spec.ts`
- Create: `packages/core/executor/README.md`
- Modify: `tsconfig.host.json`

**Interface:**

```ts
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type ExecutorPermissionMode = 'read-only' | 'workspace-write'

export interface ExecutorRoute {
  readonly executor: string
  readonly model?: string
  readonly reasoningEffort?: ReasoningEffort
  readonly permissionMode: ExecutorPermissionMode
}

export interface ExecutorStartRequest {
  readonly cwd: string
  readonly task: string
  readonly route: ExecutorRoute
  readonly signal: AbortSignal
}

export interface ExecutorCapabilities {
  readonly modelOverride: boolean
  readonly reasoningEffort: boolean
  readonly permissionModes: readonly ExecutorPermissionMode[]
}

export interface ExecutorFailure {
  readonly category: string
  readonly availability: boolean
  readonly safeDiagnostic: string
  readonly httpStatus?: number
}

export interface ExecutorResult {
  readonly status: 'completed' | 'aborted' | 'error'
  readonly output: string
  readonly failure?: ExecutorFailure
}
```

`HarnessExecutorRuntime` owns named provider registration, lookup, capability validation, start dispatch, unregister/disposal, and active-run lifecycle ownership.

- [ ] **Step 1: Write RED tests** for duplicate provider names, missing provider, unsupported model override, unsupported effort, unsupported permission mode, disposal unregister, and cancellation propagation.
- [ ] **Step 2: Run RED** with package-local Vitest.
- [ ] **Step 3: Implement minimal types/runtime** using Cordis registration effects and branded/opaque IDs where crossing durable/process boundaries.
- [ ] **Step 4: Add runtime invariant** proving registered provider descriptors and active registration ownership are internally consistent.
- [ ] **Step 5: Add README/JSDoc** including no direct model-context effect and explicit failure/cancellation semantics.
- [ ] **Step 6: Register Host project reference** and run:

```bash
pnpm vitest run packages/core/executor/tests/executor.spec.ts
pnpm run typecheck
pnpm run constraints
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/executor tsconfig.host.json
git commit -m "feat(trick): add executor runtime"
```

---

## Task 4: Add the OpenCode Executor Provider

**Files (fork):**
- Create: `packages/providers/opencode/*`
- Modify: lockfile and Host references as required
- Add exact official `@opencode-ai/sdk` version observed at implementation time

**Produces:** fresh OpenCode workers rooted in an explicit worktree/cwd, with scoped model and permission configuration and owned teardown.

- [ ] **Step 1: Verify current OpenCode programmatic contract**

Before coding, inspect installed/current official SDK/server/ACP docs and package types. Record the exact SDK version and supported session/model/config APIs in the package Agent Note. Do not infer APIs from this plan if current SDK differs.

- [ ] **Step 2: Write RED adapter/provider tests**

Test through an internal adapter seam, not by mocking the entire provider:
- `route.model` is supplied only to the spawned worker/session;
- no write occurs to user/global OpenCode config paths;
- `read-only` and `workspace-write` map to actual supported product configuration or fail loud;
- missing/unsupported per-run capability fails before start;
- cancellation closes session/server/process and waits for exit;
- output is bounded final result, not full child transcript.

- [ ] **Step 3: Implement product adapter**

Prefer official server/SDK. Use ACP only if the supported SDK cannot satisfy a required executor capability. Start/connect at loopback, root the worker in `request.cwd`, and keep server/process ownership explicit.

- [ ] **Step 4: Add a real-product keyless/local smoke**

Where OpenCode supports a local fixture/mock provider, use it to prove the real server/SDK entry path. Do not require the user's OpenCode Go quota in ordinary unit CI; real subscription smoke is deferred to Plan D.

- [ ] **Step 5: Verify package gates**

```bash
pnpm vitest run packages/providers/opencode/tests
pnpm run typecheck
pnpm run lint
```

- [ ] **Step 6: Commit**

```bash
git add packages/providers/opencode pnpm-lock.yaml tsconfig.host.json
git commit -m "feat(trick): add OpenCode executor"
```

---

## Task 5: Refactor Codex Transport for Scoped Per-Run Overrides

**Files (fork/upstream package):**
- Modify: `packages/subagent/subagent-codex/src/run.ts`
- Modify: `packages/subagent/subagent-codex/src/wire.ts`
- Modify as needed: `src/index.ts`
- Modify tests: `tests/subagent-codex.spec.ts`, `tests/real-product.spec.ts`
- Modify README/JSDoc/invariant only where public behavior changes

**Produces:** reusable Codex one-shot transport that can accept verified optional model/effort overrides without changing existing `subagent-codex` semantics.

- [ ] **Step 1: Generate the pinned Codex app-server schema**

Use the package-local `@openai/codex` binary:

```bash
node <codex-entry> app-server generate-json-schema --out <temp-dir>
```

Inspect exact current `thread/start` / `turn/start` schema fields for model and reasoning effort. Record verified field names/types in the Agent Note. **Do not guess protocol keys.**

- [ ] **Step 2: Write RED protocol tests**

Add tests proving:
- existing upstream `subagent-codex` starts a thread with no routed model/effort override;
- reusable task helper includes optional verified fields only when supplied;
- invalid effort is rejected before wire emission;
- global `CODEX_HOME` config is not rewritten.

- [ ] **Step 3: Extract a reusable plain-task transport**

Introduce a lower-level request/spec such as `CodexTaskRequest` + `startCodexTask(...)` that accepts text/cwd/signal and optional protocol-verified model/effort. Keep `startCodexRun(SubagentStartRequest, spec)` as an adapter passing no model/effort so upstream consumers remain unchanged.

- [ ] **Step 4: Preserve error taxonomy**

Retain structured categories already emitted by app-server, especially `usageLimitExceeded`, `sessionBudgetExceeded`, connection failures, overload, auth, sandbox, and context-window errors. Do not collapse them into generic text.

- [ ] **Step 5: Run existing and new Codex tests**

```bash
pnpm vitest run packages/subagent/subagent-codex/tests/subagent-codex.spec.ts
pnpm vitest run packages/subagent/subagent-codex/tests/real-product.spec.ts
```

Expected: legacy upstream behavior and new optional overlay behavior both pass.

- [ ] **Step 6: Update docs/Agent Note and commit**

This is a material upstream-package divergence; document why the existing subagent extension point could not express per-run routed Codex workers without reusable transport.

```bash
git add packages/subagent/subagent-codex .agents/notes
git commit -m "refactor(codex): expose scoped one-shot transport"
```

---

## Task 6: Add the Codex Executor Provider

**Files (fork):**
- Create: `packages/providers/codex/*`

**Produces:** routed Codex workers using native ChatGPT-plan authentication and per-run model/effort overrides.

- [ ] **Step 1: Write RED provider tests** for model/effort mapping, read-only/workspace-write permissions, native env credential scrubbing, quota classification, quality-vs-availability distinction, cancellation, and bounded diagnostic output.
- [ ] **Step 2: Implement provider on the Task 5 transport.** Do not inject `OPENAI_API_KEY`. Preserve native Codex home/account state while applying only route-scoped model/effort and permission fields.
- [ ] **Step 3: Map availability failures** at minimum:
  - `usageLimitExceeded` → availability failure;
  - rate/connection/server-overload categories supported by the current product → availability failure where retry/fallback is valid;
  - context-window, bad request, sandbox, cyber-policy, or completed-but-wrong work → not quota fallback.
- [ ] **Step 4: Real fixture/product-path test** proving the provider launches the package-local official Codex transport and emits the requested per-run fields without editing global config.
- [ ] **Step 5: Run package gates and commit**.

```bash
git commit -m "feat(trick): add Codex executor"
```

---

## Task 7: Add Optional Claude Code Executor Compatibility

**Files (fork/upstream + Trick):**
- Minimal refactor in `packages/subagent/subagent-claude-code/*` if required for reusable plain-task transport
- Create: `packages/providers/claude-code/*`

**Produces:** optional executor using official Claude Agent SDK/CLI/native account state; no core dependency.

- [ ] **Step 1: Write RED compatibility tests** proving Claude provider can be omitted entirely and the Harness executor runtime still loads with OpenCode/Codex.
- [ ] **Step 2: Reuse/extract lower-level official SDK query path** rather than duplicating process management.
- [ ] **Step 3: Advertise exact capabilities honestly**. If model/effort per-run override is not part of the maintained V2 requirement/supported product seam, advertise `modelOverride: false`, `reasoningEffort: false` and fail loud when requested.
- [ ] **Step 4: Preserve native authentication/settings** and never extract OAuth credentials or inject an API key in subscription mode.
- [ ] **Step 5: Run upstream Claude tests plus provider tests, then commit.**

```bash
git commit -m "feat(trick): add optional Claude executor"
```

---

## Task 8: Compose the Harness Runtime Bundle

**Files (fork):**
- Create/modify: `packages/core/bundle/*`
- Add loader-composition tests/profile patch
- Update package catalog/docs as required by upstream doc gates

**Produces:** one installable/profile composition that registers the executor runtime and configured providers without starting product processes at load time.

- [ ] **Step 1: Write RED loader-composition test** proving bundle load registers OpenCode/Codex, optionally Claude, and starts zero executor processes until dispatch.
- [ ] **Step 2: Compose through the profile seam**; concrete Plurora policy lives in `profiles/plurora` per Plan R.
- [ ] **Step 3: Prove unload/disposal removes providers** and no orphan handles remain.
- [ ] **Step 4: Add package README/limitations/model-experience text and invariant.**
- [ ] **Step 5: Run focused and repository-wide relevant gates**:

```bash
pnpm run constraints
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run test:coverage
pnpm run build
pnpm run hygiene
pnpm run doc-sync
```

Use the narrower relevant commands first; run the comprehensive set once at the plan boundary because this plan adds multiple package seams and modifies an upstream provider.

- [ ] **Step 6: Verify fork delta**

```bash
git diff upstream/master...HEAD --stat
git log --oneline upstream/master..HEAD
```

Expected: generic core/agent-loop untouched unless an extension-point gap is documented; divergence remains contained to workspace constraints, reusable product transport, Trick packages, profiles, docs/tests.

- [ ] **Step 7: Independent review and commit any bug fixes**

Run an independent code-verification pass. Confirmed bugs are fixed through the normal debug/repair discipline; optional refactors are not folded into this plan.

## Plan A Completion Evidence

Plan A is complete when:
- the GitHub repo is a real fork with preserved MIT/upstream provenance;
- private `@trick-harness/*` packages satisfy fork constraints;
- executor runtime capability tests are green;
- OpenCode provider supports fresh scoped workers without mutating global config;
- Codex provider uses official app-server/native account path with per-run model/effort and structured quota categories;
- Claude can be enabled or omitted without changing core semantics;
- bundle load starts no product worker;
- cancellation/disposal tests prove quiescence;
- relevant upstream package tests and repository gates pass;
- no routing/debugging/QA/product lifecycle is falsely claimed complete before Plan B.