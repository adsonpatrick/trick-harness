# MODEL-REFRESH-001 — GPT-6 Luna, MiMo 2.6 Flash, and DeepSeek 4.1 Flash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** DEFERRED — do not execute until the post-stability gate in Task 1 passes.

**Goal:** Qualify GPT-6 Luna/Codex CLI, DeepSeek 4.1 Flash/OpenCode Go, and MiMo 2.6 Flash/OpenCode Go against the stabilized Trick Harness baseline, then promote only evidence-backed semantic-tier substitutions without redesigning routing.

**Architecture:** Keep the existing Plurora routing table and semantic tiers as the stable interface. Evaluate candidate models behind `codex.balanced`, `opencode.reasoning-fast`, and `opencode.workhorse`; keep `codex.frontier` on GPT-5.6 Sol for this refresh. Reuse the stabilized Harness qualification/evaluation, isolation, evidence, candidate-policy, promotion, demotion, and rollback mechanisms; if those mechanisms are still absent when this plan is executed, stop rather than implementing them inside this refresh.

**Tech Stack:** TypeScript 6, Node.js 22+, pnpm 11, Vitest, Trick Harness providers for Codex and OpenCode, Codex app-server, OpenCode SDK/OpenCode Go, Git worktrees, existing Trick Harness evaluation/policy machinery.

**Spec:** `docs/superpowers/specs/2026-09-26-model-refresh-qualification-design.md`

## Global Constraints

- Do not begin MODEL-REFRESH-001 until the current Trick Harness activation/hardening work is complete and the runtime has a fresh passing end-to-end canary.
- Production remains on the current approved model registry until an explicit promotion decision is made.
- The qualification unit is the exact model/version + execution harness + provider route + material configuration, not a marketing model name.
- Registration or compatibility PASS grants no production authority.
- Do not add a second router, policy authority, evidence store, verifier, BENCH implementation, Shadow implementation, or promotion system in this plan.
- If the stabilized runtime still lacks the approved evaluation/shadow/candidate-policy capability required by the Spec, record `BLOCKED: EVALUATION_PREREQUISITE_MISSING` and stop MODEL-REFRESH-001.
- Do not weaken tests, verification, conformance, certification, security, scope, delivery, or independence rules to make a candidate pass.
- `profiles/plurora/routing-policy.ts` is read-only for MODEL-REFRESH-001. Evidence that suggests a routing-rule change is recorded as `OUT_OF_SCOPE_ROUTING_REFINEMENT` for a separate design/plan.
- `codex.frontier` remains on the approved GPT-5.6 Sol target during this refresh. GPT-6 Luna competes for `codex.balanced`, not for the critical/frontier tier.
- Expected Codex candidate id: `gpt-6-luna`; the authenticated Codex native catalogue must advertise it before evaluation.
- Expected OpenCode Go DeepSeek pair: `opencode-go/deepseek-v4.1-flash`; the authenticated OpenCode native catalogue must advertise that exact pair before evaluation.
- Expected OpenCode Go MiMo pair: `opencode-go/mimo-v2.6-flash`; because provider catalogues can change faster than documentation, this exact pair must be discovered in the authenticated native catalogue. Do not silently substitute OpenCode Zen Free, direct Xiaomi API, or another provider.
- Candidate failures remain failures even when a baseline/fallback target later recovers the workflow.
- Use isolated worktrees/sandboxes for candidate execution. No qualification run may mutate the production checkout or inherit additional credentials merely to make the run work.
- External benchmarks justify evaluating a model; only Trick Harness evidence may justify promotion.

## Current Baseline to Preserve Until Promotion

As of the plan authoring baseline, `adsonpatrick/neuro-via/plurora-harness.json` resolves:

```json
{
  "codex.balanced": "gpt-5.5",
  "codex.frontier": "gpt-5.6-sol",
  "opencode.reasoning-fast": "opencode-go/glm-5.3-flash",
  "opencode.workhorse": "opencode-go/qwen3.8-max"
}
```

The primary qualification hypothesis is:

```json
{
  "codex.balanced": "gpt-6-luna",
  "codex.frontier": "gpt-5.6-sol",
  "opencode.reasoning-fast": "opencode-go/deepseek-v4.1-flash",
  "opencode.workhorse": "opencode-go/mimo-v2.6-flash"
}
```

This is a hypothesis, not an approved final registry.

## Review Focus

1. **Candidate missing from native catalogue:** qualification must stop for that target; no provider or alias substitution is allowed.
2. **Provider alias resolves a different underlying model/version:** provenance is insufficient; record the target as unqualified until the resolved identity is trustworthy.
3. **Compatibility works but evaluation/promotion machinery is absent:** stop with `EVALUATION_PREREQUISITE_MISSING`; do not build that architecture in this plan.
4. **Fallback recovers a failed candidate attempt:** workflow recovery must not credit the candidate with success or erase its failure/repair evidence.
5. **Evidence suggests changing routing semantics rather than only tier-to-model mappings:** do not edit `routing-policy.ts`; record `OUT_OF_SCOPE_ROUTING_REFINEMENT` and close this refresh with the evidence attached.

---

### Task 1: Revalidate the stabilized runtime and freeze MODEL-REFRESH-001 baseline

**Files:**
- Read: `package.json`
- Read: `profiles/plurora/routing-policy.ts`
- Read: `apps/plurora-harness-host/src/model-registry.ts`
- Read: `apps/plurora-harness-host/src/entrypoint.ts`
- Read: `packages/providers/codex/src/index.ts`
- Read: `packages/providers/opencode/src/index.ts`
- Read: `adsonpatrick/neuro-via/plurora-harness.json`
- Create: `docs/verification/2026-09-26-model-refresh-001-baseline.md`

**Interfaces:**
- Consumes: the stabilized Trick Harness `master`, the pinned NeuroVia `main`, and the approved Model Refresh Spec.
- Produces: a baseline evidence record containing exact Trick Harness SHA, NeuroVia SHA, pinned runtime SHA, current registry, provider/package versions, passing stability evidence, and the availability of the existing qualification/evaluation/promotion path.

- [ ] **Step 1: Create isolated worktrees from the then-current stabilized default branches**

Use `superpowers:using-git-worktrees` at execution time. Do not run candidate work from either normal checkout.

Expected: one clean Trick Harness worktree and one clean NeuroVia worktree, both recording their starting SHAs.

- [ ] **Step 2: Run the Trick Harness stability gates**

From the Trick Harness worktree:

```bash
pnpm run check:all
pnpm run test:trick
pnpm run typecheck:plurora-host
```

Expected: all commands PASS from a clean tree.

- [ ] **Step 3: Run the NeuroVia Harness integration gates**

With `TRICK_HARNESS_HOME` pointing at the isolated Trick Harness worktree:

```bash
npm run harness:check
npm run harness:pin-check
npm run test:harness
```

Then run the canonical activation/end-to-end canary documented by the stabilized Harness.

Expected: pinned runtime verification and canary PASS with process-tree quiescence.

- [ ] **Step 4: Verify the post-stability runtime exposes the approved qualification path**

Inspect the stabilized runtime and its operator documentation for the concrete implementations of:

- controlled evaluation/BENCH;
- isolated comparative or Execution Shadow evaluation;
- evidence recording sufficient to attribute each attempt to an exact target;
- candidate-policy creation or its approved equivalent;
- explicit promotion;
- demotion/rollback.

Expected: each responsibility has a concrete implementation and documented invocation.

If any responsibility is absent, write `BLOCKED: EVALUATION_PREREQUISITE_MISSING` to the baseline evidence with the missing responsibility, commit only the evidence document, and STOP this plan. Do not implement the missing architecture here.

- [ ] **Step 5: Write the immutable baseline record**

In `docs/verification/2026-09-26-model-refresh-001-baseline.md`, record:

- Trick Harness start SHA;
- NeuroVia start SHA;
- NeuroVia pinned Trick Harness runtime SHA;
- current model registry;
- exact commands and PASS results from Steps 2–3;
- the concrete evaluation/shadow/promotion interfaces found in Step 4;
- current provider/package versions;
- statement that `profiles/plurora/routing-policy.ts` is unchanged and out of mutation scope.

Expected: no secrets, raw provider responses, API keys, or unbounded logs.

- [ ] **Step 6: Commit the baseline evidence**

```bash
git add docs/verification/2026-09-26-model-refresh-001-baseline.md
git commit -m "docs(harness): freeze model refresh 001 baseline"
```

Expected: one evidence-only commit.

---

### Task 2: Qualify native catalogue and executor compatibility for the three candidates

**Files:**
- Read: `apps/plurora-harness-host/src/model-registry.ts`
- Read: `apps/plurora-harness-host/tests/model-registry.spec.ts`
- Read: `packages/providers/codex/tests/codex.spec.ts`
- Read: `packages/providers/opencode/tests/opencode.spec.ts`
- Read: `packages/providers/opencode/tests/adapter.spec.ts`
- Temporary only, never committed during qualification: `adsonpatrick/neuro-via/plurora-harness.json`
- Create: `docs/verification/2026-09-26-model-refresh-001-compatibility.md`

**Interfaces:**
- Consumes: Task 1 baseline and the host's native `ModelCatalogReader`/deployment validation path.
- Produces: one compatibility verdict per exact ComputeTarget: `PASS`, `BLOCKED`, or `FAIL`, with safe failure classification and resolved model provenance.

- [ ] **Step 1: Prove GPT-6 Luna is advertised by the authenticated Codex catalogue**

In the isolated NeuroVia worktree, temporarily change only:

```json
"codex.balanced": "gpt-6-luna"
```

Keep `codex.frontier` and both OpenCode entries at baseline.

Run from the Trick Harness worktree:

```bash
pnpm run plurora-host -- validate --project-root <ABSOLUTE_NEUROVIA_WORKTREE>
```

Expected: `plurora-host: deployment is valid`.

If the Codex catalogue does not advertise `gpt-6-luna` or the required balanced-tier effort, record the bounded failure and do not evaluate Luna further.

- [ ] **Step 2: Prove DeepSeek V4.1 Flash is advertised by OpenCode Go**

Restore the baseline config, then temporarily change only:

```json
"opencode.reasoning-fast": "opencode-go/deepseek-v4.1-flash"
```

Run the same `plurora-host validate` command.

Expected: PASS only if the authenticated OpenCode catalogue advertises the exact provider/model pair.

- [ ] **Step 3: Prove MiMo 2.6 Flash is advertised by OpenCode Go**

Restore the baseline config, then temporarily change only:

```json
"opencode.workhorse": "opencode-go/mimo-v2.6-flash"
```

Run the same `plurora-host validate` command.

Expected: PASS only if the authenticated OpenCode catalogue advertises the exact pair.

If it does not, record `BLOCKED: OPENCODE_GO_MODEL_NOT_ADVERTISED`. Do not substitute `opencode/mimo-v2.6-flash-free`, direct Xiaomi API, or another provider.

- [ ] **Step 4: Run one isolated real executor canary per catalogue-compatible candidate**

Using the stabilized Harness's existing canary/evaluation entrypoint, execute a bounded non-production task with each candidate target.

Each run must prove, as applicable:

- request/session startup;
- exact per-run model override;
- required tool invocation;
- valid structured `HARNESS-RESULT`;
- timeout behavior;
- cancellation/abort behavior;
- safe provider failure classification;
- cleanup/process quiescence.

Expected: a candidate is `compatibility=PASS` only if the real executor run satisfies the existing contract. Catalogue availability alone is insufficient.

- [ ] **Step 5: Add compatibility regression tests only for newly discovered adapter defects**

If all three candidates work through the existing generic provider contracts, change no provider code and add no model-specific branches.

If a genuine adapter defect is exposed, first write the smallest failing regression in the owning existing test file:

- Codex: `packages/providers/codex/tests/codex.spec.ts`
- OpenCode provider: `packages/providers/opencode/tests/opencode.spec.ts`
- OpenCode SDK boundary: `packages/providers/opencode/tests/adapter.spec.ts`

Expected: test FAILS for the adapter defect without naming business-routing policy.

Then implement the minimal generic adapter fix in the corresponding existing provider file and rerun the focused test plus `pnpm run test:trick`.

Do not add `if (model === "...")` behavior unless the upstream protocol itself is demonstrably model-specific and the distinction belongs at the provider boundary.

- [ ] **Step 6: Write and commit compatibility evidence**

Write `docs/verification/2026-09-26-model-refresh-001-compatibility.md` with:

- exact advertised target IDs;
- harness/provider path;
- compatibility verdict;
- bounded safe failure code where applicable;
- canary evidence;
- any adapter repair commit SHA.

Restore the isolated NeuroVia registry to the Task 1 baseline before committing.

```bash
git add docs/verification/2026-09-26-model-refresh-001-compatibility.md packages/providers
git commit -m "test(harness): qualify model refresh 001 compatibility"
```

If no provider code changed, commit only the evidence document.

---

### Task 3: Evaluate candidate tier substitutions and cross-challenge the OpenCode hypotheses

**Files:**
- Read only: `profiles/plurora/routing-policy.ts`
- Read only: `apps/plurora-harness-host/src/model-registry.ts`
- Create: `docs/verification/2026-09-26-model-refresh-001-evaluation.md`

**Interfaces:**
- Consumes: Task 1 baseline, Task 2 compatibility PASS targets, the stabilized Harness's existing evaluation/shadow mechanism, and existing workload/verification contracts.
- Produces: paired evidence per semantic tier and workload plus a scoped comparison outcome; it does not mutate production routing.

- [ ] **Step 1: Define the primary same-tier candidate comparisons**

Evaluate these substitutions against the Task 1 baseline using the existing controlled evaluation path:

```text
codex.balanced
  baseline:  gpt-5.5 / Codex
  candidate: gpt-6-luna / Codex

opencode.reasoning-fast
  baseline:  opencode-go/glm-5.3-flash / OpenCode
  candidate: opencode-go/deepseek-v4.1-flash / OpenCode

opencode.workhorse
  baseline:  opencode-go/qwen3.8-max / OpenCode
  candidate: opencode-go/mimo-v2.6-flash / OpenCode

codex.frontier
  control only: gpt-5.6-sol / Codex
```

Expected: production registry unchanged.

- [ ] **Step 2: Exercise the existing use cases behind each tier**

Use the current routing table as the workload source rather than inventing new roles.

For `codex.balanced`, include representative existing stages for:

- routine review;
- diagnosis/debug;
- verification;
- routine conformance;
- QA analysis;
- default judgement.

For `opencode.reasoning-fast`, include representative existing stages for:

- refinement;
- planning;
- delivery;
- eligible Codex-unavailable judgement fallbacks in isolated evaluation.

For `opencode.workhorse`, include representative existing stages for:

- implementation;
- repair;
- heavy QA execution;
- broad refactor;
- test generation.

Use the stabilized evaluation corpus and its existing sample/coverage thresholds. Do not invent weaker MODEL-REFRESH-specific thresholds.

- [ ] **Step 3: Cross-challenge DeepSeek and MiMo without changing routing policy**

In isolated evaluation only:

- challenge `opencode.workhorse` workloads with DeepSeek V4.1 Flash;
- challenge `opencode.reasoning-fast` workloads with MiMo 2.6 Flash.

Purpose: test the hypothesis that DeepSeek is the better reasoning-fast target and MiMo the better workhorse target.

Expected: these challenger assignments remain evaluation-only unless the existing evidence/policy process later supports a same-tier registry decision.

If the result implies the **routing rules themselves** should split or move workloads between tiers, record `OUT_OF_SCOPE_ROUTING_REFINEMENT`; do not edit `profiles/plurora/routing-policy.ts`.

- [ ] **Step 4: Preserve attempt-level evidence**

For every paired comparison, retain the existing evidence fields sufficient to distinguish:

- first-pass success;
- repaired success;
- repair count;
- deterministic verification;
- conformance/certification;
- model/provider/tool failure;
- constraint/capability gap;
- timeout/cancellation;
- cleanup failure;
- latency/wall-clock where available;
- usage/cost where available;
- exact target provenance.

A fallback recovery must preserve both the failed candidate attempt and the successful recovery attempt.

- [ ] **Step 5: Write and commit the evaluation report**

Write `docs/verification/2026-09-26-model-refresh-001-evaluation.md` with:

- corpus/version;
- baseline and candidate target identities;
- coverage by current semantic tier/use case;
- paired outcome summaries using the Harness's existing result vocabulary;
- engineering-cost/latency evidence where available;
- constraints and incompatibilities;
- explicit list of any `OUT_OF_SCOPE_ROUTING_REFINEMENT` findings.

```bash
git add docs/verification/2026-09-26-model-refresh-001-evaluation.md
git commit -m "docs(harness): record model refresh 001 evaluation"
```

---

### Task 4: Produce the scoped candidate-policy decision without changing production

**Files:**
- Read: `docs/verification/2026-09-26-model-refresh-001-baseline.md`
- Read: `docs/verification/2026-09-26-model-refresh-001-compatibility.md`
- Read: `docs/verification/2026-09-26-model-refresh-001-evaluation.md`
- Create: `docs/verification/2026-09-26-model-refresh-001-decision.md`

**Interfaces:**
- Consumes: immutable evidence from Tasks 1–3 and the stabilized Harness's existing candidate-policy compiler/approval mechanism.
- Produces: an evidence-backed scoped candidate policy or an explicit no-change decision. It does not write the production registry.

- [ ] **Step 1: Feed only qualified targets and current evidence into the existing candidate-policy mechanism**

Expected: no target that failed or was blocked in Task 2 is eligible for a production route proposal.

- [ ] **Step 2: Restrict MODEL-REFRESH-001 policy impact to semantic-tier target substitution**

Allowed scope for this refresh:

```text
codex.balanced model mapping
opencode.reasoning-fast model mapping
opencode.workhorse model mapping
```

Not allowed:

```text
codex.frontier downgrade/replacement
routing rule reorder
new role/task-class routing rule
permission change
risk-floor change
verification requirement change
fallback semantic change
```

Expected: a candidate policy either proposes one or more same-tier substitutions or proposes no change.

- [ ] **Step 3: Record the decision**

Write `docs/verification/2026-09-26-model-refresh-001-decision.md` with one row per candidate target:

```text
target
qualification result
eligible tier
evidence refs
candidate-policy impact
decision: REJECT | RETAIN_CANDIDATE | PROMOTION_READY
reason
```

Include a separate section for any routing-policy findings that were deliberately deferred.

- [ ] **Step 4: Commit the decision artifact**

```bash
git add docs/verification/2026-09-26-model-refresh-001-decision.md
git commit -m "docs(harness): decide model refresh 001 candidates"
```

Expected: production remains unchanged after this task.

---

### Task 5: Promote only explicitly approved tier substitutions into NeuroVia

**Files:**
- Modify only after explicit human promotion approval: `adsonpatrick/neuro-via/plurora-harness.json`
- Test: `adsonpatrick/neuro-via/scripts/harness/config.test.mjs`
- Test: `adsonpatrick/neuro-via/scripts/harness/runtime-checkout.test.mjs`
- Test: `adsonpatrick/neuro-via/scripts/harness/neurovia.test.mjs`
- Create: `adsonpatrick/neuro-via/docs/verification/<execution-date>-model-refresh-001-promotion.md`

**Interfaces:**
- Consumes: Task 4 promotion-ready decision plus explicit human approval.
- Produces: the promoted deployment registry, or no production change if nothing is approved.

- [ ] **Step 1: Create a dedicated NeuroVia promotion branch from current `main`**

Do not reuse the evaluation worktree.

Expected: clean branch based on the current production integration state.

- [ ] **Step 2: Write the failing deployment expectation for each approved registry substitution**

Update `scripts/harness/config.test.mjs` only where it pins/validates the production model registry.

The expected final mapping **if and only if all three candidate substitutions are explicitly approved** is:

```json
{
  "codex.balanced": "gpt-6-luna",
  "codex.frontier": "gpt-5.6-sol",
  "opencode.reasoning-fast": "opencode-go/deepseek-v4.1-flash",
  "opencode.workhorse": "opencode-go/mimo-v2.6-flash"
}
```

If promotion approved only a subset, assert only that subset and preserve every unapproved baseline mapping exactly.

- [ ] **Step 3: Run the focused test and verify it fails against the old registry**

```bash
npm run test:harness
```

Expected: FAIL only on the newly approved registry expectation(s).

- [ ] **Step 4: Update `plurora-harness.json` with only the approved substitutions**

Do not edit `policyVersion`, routing rules, risk floors, or unrelated deployment fields solely because a model changed.

- [ ] **Step 5: Run local deployment and integration gates**

```bash
npm run harness:check
npm run harness:pin-check
npm run test:harness
```

Then from the pinned Trick Harness checkout:

```bash
pnpm run plurora-host -- validate --project-root <ABSOLUTE_NEUROVIA_WORKTREE>
```

Expected: all PASS.

- [ ] **Step 6: Run the production-shaped activation canary under the promoted registry**

Use the canonical stabilized activation canary and existing verification/certification path.

Expected: PASS, no out-of-scope mutation, and process-tree quiescence.

On failure, use the existing atomic rollback/demotion procedure; do not repair by weakening the model qualification or routing policy.

- [ ] **Step 7: Record promotion evidence and commit**

Write `docs/verification/<execution-date>-model-refresh-001-promotion.md` with:

- Task 4 decision reference;
- exact promoted mappings;
- pre/post registry;
- test/validate/canary evidence;
- rollback pointer.

Then:

```bash
git add plurora-harness.json scripts/harness/config.test.mjs docs/verification
git commit -m "chore(harness): promote model refresh 001 targets"
```

---

### Task 6: Turn MODEL-REFRESH-001 into the reusable refresh runbook

**Files:**
- Create: `docs/operations/model-refresh.md`
- Create: `docs/verification/2026-09-26-model-refresh-001-closure.md`
- Read: `docs/superpowers/specs/2026-09-26-model-refresh-qualification-design.md`
- Read: all MODEL-REFRESH-001 verification documents

**Interfaces:**
- Consumes: the completed first refresh and the approved reusable Spec.
- Produces: a short operational runbook that future model releases can follow without another architecture design.

- [ ] **Step 1: Write the reusable runbook**

`docs/operations/model-refresh.md` must reduce the proven flow to:

```text
discover candidate
→ record exact target identity
→ native catalogue validation
→ real executor compatibility canary
→ existing BENCH/evaluation
→ existing isolated shadow comparison
→ scoped candidate-policy decision
→ explicit promotion
→ production canary
→ monitor / demote / retire
```

Include the `MODEL-REFRESH-NNN` naming convention and the rule that a missing core evaluation mechanism blocks a refresh rather than being implemented opportunistically.

- [ ] **Step 2: Document what was learned about use-case placement**

Record only evidence-backed conclusions from MODEL-REFRESH-001.

Examples of valid output shape:

```text
codex.balanced → <approved target>
opencode.reasoning-fast → <approved target>
opencode.workhorse → <approved target>
codex.frontier → unchanged
routing-policy refinement → none | separate follow-up required
```

Do not turn external benchmark claims into routing policy.

- [ ] **Step 3: Write closure evidence**

In `docs/verification/2026-09-26-model-refresh-001-closure.md`, record:

- final disposition of all three candidates;
- whether production changed;
- promoted registry if any;
- rejected/blocked candidates and reasons;
- deferred routing-policy findings;
- evidence that future refreshes can reuse the runbook.

- [ ] **Step 4: Run documentation and repository gates**

```bash
pnpm run verify-md-wrap
pnpm run verify-md-links
pnpm run test:trick
pnpm run typecheck:plurora-host
```

Expected: PASS.

- [ ] **Step 5: Commit the runbook and closure**

```bash
git add docs/operations/model-refresh.md docs/verification/2026-09-26-model-refresh-001-closure.md
git commit -m "docs(harness): close model refresh 001"
```

## Definition of Done

MODEL-REFRESH-001 is complete only when:

- the stability gate passed before candidate work began;
- each candidate has exact target provenance and a compatibility verdict;
- no candidate was substituted onto an unadvertised provider route;
- candidate evaluation used the existing stabilized Harness mechanisms;
- baseline and candidate failures remain attributable at attempt level;
- the current routing policy was not rewritten as part of model refresh;
- every production model change came through the existing candidate/promotion path and explicit human approval;
- `codex.frontier` remained GPT-5.6 Sol throughout MODEL-REFRESH-001;
- production canary evidence exists for every promoted mapping;
- rollback/demotion remains available;
- the recurring `docs/operations/model-refresh.md` runbook exists;
- future model releases can repeat the process without a new architecture spec.
