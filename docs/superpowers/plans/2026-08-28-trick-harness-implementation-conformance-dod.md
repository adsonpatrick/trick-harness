# Trick Harness Implementation Conformance & Definition of Done Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class read-only `conformance` stage that proves the published implementation satisfies the approved Spec, approved Superpowers Plan and Plurora Definition of Done before `PR_READY` can be emitted.

**Architecture:** Extend generic contracts with approved-artifact identities and structured conformance results; build a deterministic manifest before model dispatch so required obligations cannot be omitted by the model; insert conformance before final verification in the PR lifecycle; route it as independent Codex judgement work according to risk; surface bounded conformance facts through control/journal/composition. NeuroVia supplies approved artifact paths and project evidence later through the Plan C* conformance wiring overlay.

**Tech Stack:** TypeScript, Node.js `^22.19.0 || >=24.0.0`, pnpm `11.7.0`, existing `@trick-harness/contracts`, `@trick-harness/engineering-workflow`, routing/profile/control-server/composition packages, OpenCode/Codex providers, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-harness-v2-implementation-conformance-dod-amendment.md`

## Global Constraints

- `conformance` is read-only and can never receive workspace mutation authority.
- Model output cannot define the expected Spec/Plan/DoD obligation set; deterministic code does.
- Approved Spec/Plan identity is repository-relative path + SHA-256; whole documents and private reasoning are not journal payloads.
- `PR_READY` requires latest conformance `PASS` plus existing final-verification/open-defect invariants.
- Low/medium conformance uses `codex.balanced` with `high`; high/critical uses `codex.frontier` with `xhigh`.
- Codex-unavailable conformance falls back to `opencode.reasoning-fast` with degraded assurance; it cannot satisfy high/critical cross-executor-required independence when implementation ran on OpenCode.
- Concrete Codex/OpenCode model ids remain deployment registry data and are validated against native authenticated catalogues.
- Missing specified work may enter existing repair only when the approved artifacts are unambiguous; product/design ambiguity remains `BLOCKED`.

---

### Task 1: Add the `conformance` Role and Approved Artifact Contracts

**Files:**
- Modify: `packages/core/contracts/src/types.ts`
- Modify: `packages/core/contracts/src/index.ts`
- Test: `packages/core/contracts/tests/contracts.spec.ts`
- Test: `packages/core/contracts/tests/invariant.spec.ts`

**Interfaces:**

```ts
export interface ApprovedArtifactRef {
  readonly path: string
  readonly sha256: string
}

export interface ApprovedArtifactSet {
  readonly spec: ApprovedArtifactRef
  readonly plan: ApprovedArtifactRef
}

export interface WorkflowObjective {
  readonly id: string
  readonly cwd: string
  readonly requirement: string
  readonly risk: Risk
  readonly workload: Workload
  readonly profileId: string
  readonly approvedArtifacts: ApprovedArtifactSet
}
```

- [x] **Step 1: Write RED contract tests** proving `ROLES` contains `conformance`, `READ_ONLY_ROLES` contains `conformance`, `parseWorkflowObjective` requires `approvedArtifacts`, hashes must match lowercase 64-hex SHA-256, and artifact paths must be non-empty repository-relative strings.
- [x] **Step 2: Run RED.**

```bash
corepack pnpm vitest run packages/core/contracts/tests/contracts.spec.ts packages/core/contracts/tests/invariant.spec.ts
```

- [x] **Step 3: Implement vocabulary/types/parser** in `types.ts` and `index.ts`. Reject absolute paths, `..` traversal segments, missing hashes and malformed hashes without echoing offending values into errors.
- [x] **Step 4: Run GREEN.**

```bash
corepack pnpm vitest run packages/core/contracts/tests/contracts.spec.ts packages/core/contracts/tests/invariant.spec.ts
corepack pnpm run typecheck
```

- [x] **Step 5: Commit.**

```bash
git add packages/core/contracts
git commit -m "feat(trick): add approved artifact conformance contracts"
```

---

### Task 2: Add Structured Conformance Contracts and Parsers

**Files:**
- Modify: `packages/core/contracts/src/types.ts`
- Modify: `packages/core/contracts/src/index.ts`
- Test: `packages/core/contracts/tests/contracts.spec.ts`

**Interfaces:**

```ts
export const CONFORMANCE_SOURCES = ['spec', 'plan', 'dod'] as const
export type ConformanceSource = typeof CONFORMANCE_SOURCES[number]

export const CONFORMANCE_ITEM_STATUSES = [
  'PASS', 'MISSING', 'PARTIAL', 'FAIL', 'BLOCKED', 'INCONCLUSIVE',
] as const
export type ConformanceItemStatus = typeof CONFORMANCE_ITEM_STATUSES[number]

export interface ConformanceObligation {
  readonly id: string
  readonly source: ConformanceSource
  readonly requirement: string
  readonly required: true
}

export interface ConformanceManifest {
  readonly specSha256: string
  readonly planSha256: string
  readonly obligations: readonly ConformanceObligation[]
}

export interface ConformanceItem {
  readonly id: string
  readonly source: ConformanceSource
  readonly requirement: string
  readonly status: ConformanceItemStatus
  readonly implementationEvidence: readonly EvidenceRef[]
  readonly verificationEvidence: readonly EvidenceRef[]
  readonly summary: string
}

export interface ConformanceContract {
  readonly specSha256: string
  readonly planSha256: string
  readonly items: readonly ConformanceItem[]
  readonly verdict: WorkflowVerdict
  readonly summary: string
}
```

- [x] **Step 1: Write RED parser tests** for valid contract, unknown source/status, duplicate/missing fields, undeclared transcript/reasoning fields, malformed hashes and secret-safe errors.
- [x] **Step 2: Implement `parseConformanceContract(value, path='conformance')`** using existing bounded parser helpers and immutable outputs.
- [x] **Step 3: Run GREEN + typecheck.**

```bash
corepack pnpm vitest run packages/core/contracts/tests/contracts.spec.ts
corepack pnpm run typecheck
```

- [x] **Step 4: Commit.**

```bash
git add packages/core/contracts
git commit -m "feat(trick): add conformance result contract"
```

---

### Task 3: Build the Deterministic Spec/Plan/DoD Manifest

**Files:**
- Create: `packages/core/engineering-workflow/src/conformance.ts`
- Create: `packages/core/engineering-workflow/tests/conformance.spec.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`

**Interfaces:**

```ts
export interface ConformanceArtifactInput {
  readonly specText: string
  readonly planText: string
  readonly specSha256: string
  readonly planSha256: string
  readonly dod: readonly ConformanceObligation[]
}

export function buildConformanceManifest(input: ConformanceArtifactInput): ConformanceManifest

export function validateConformanceCoverage(
  manifest: ConformanceManifest,
  result: ConformanceContract,
): ConformanceContract
```

**Extraction rules:**

```text
Spec obligations:
  markdown lines matching ^\s*-\s+\*\*([A-Z][A-Z0-9-]*\d+):\*\*\s+(.+)$

Plan obligations:
  headings matching ^### Task ([1-9][0-9]*):\s+(.+)$
  id = PLAN-TASK-<N>

DoD obligations:
  supplied by deterministic profile policy; duplicate ids rejected
```

- [x] **Step 1: Write RED tests** for ND/CF/R-style Spec criteria, Superpowers task headings, duplicate IDs, zero Spec criteria, zero Plan tasks, deterministic ordering and immutable output.
- [x] **Step 2: Write RED coverage tests** proving omitted expected IDs, duplicate returned IDs, source/requirement mismatch, unknown substitution and hash mismatch cannot validate as PASS.
- [x] **Step 3: Run RED.**

```bash
corepack pnpm vitest run packages/core/engineering-workflow/tests/conformance.spec.ts
```

- [x] **Step 4: Implement extraction and validation** with no model/LLM dependency and no filesystem access in this module.
- [x] **Step 5: Run GREEN.**

```bash
corepack pnpm vitest run packages/core/engineering-workflow/tests/conformance.spec.ts
corepack pnpm run typecheck
```

- [x] **Step 6: Commit.**

```bash
git add packages/core/engineering-workflow
git commit -m "feat(trick): build deterministic conformance manifest"
```

---

### Task 4: Gate the Workflow on Artifact Identity and Conformance

**Files:**
- Modify: `packages/core/engineering-workflow/src/types.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/src/lifecycle.ts`
- Test: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Test: `packages/core/engineering-workflow/tests/lifecycle.spec.ts`
- Test: `packages/core/engineering-workflow/tests/conformance.spec.ts`

**Interfaces:**

```ts
export interface WorkflowRunRequest {
  readonly objective: WorkflowObjective
  readonly implementationExecutor?: string
  readonly interpret: StageInterpreter
  readonly plan?: (objective: WorkflowObjective) => readonly StageSpec[]
  readonly task: (stage: StageSpec, objective: WorkflowObjective) => string
  readonly routeOverride?: StageRouteOverride
  readonly diagnose?: (stage: StageSpec, executor: string, result: ExecutorResult) => unknown
  readonly repairEvidence?: (stage: StageSpec, executor: string, result: ExecutorResult) => RepairEvidence
  readonly databaseChange?: WorkflowDatabaseChange
  readonly loadApprovedArtifacts: (
    objective: WorkflowObjective,
    signal: AbortSignal,
  ) => Promise<{
    specText: string
    planText: string
    specSha256: string
    planSha256: string
  }>
  readonly conformance: (
    stage: StageSpec,
    executor: string,
    result: ExecutorResult,
    manifest: ConformanceManifest,
  ) => unknown
}
```

- [ ] **Step 1: Write RED tests** proving approved artifact hashes are verified before first mutation-capable implementation dispatch and reverified before `conformance`; a changed/missing artifact returns `BLOCKED` before the affected stage.
- [ ] **Step 2: Write RED lifecycle tests** expecting `implement -> verify -> delivery -> review -> applicable qa -> applicable security -> conformance -> verify-final`.
- [ ] **Step 3: Write RED PR-readiness tests** proving no conformance stage, conformance `PARTIAL/FAIL/BLOCKED/INCONCLUSIVE`, or a later mutation without fresh conformance prevents `PR_READY`.
- [ ] **Step 4: Implement workflow integration.** Parse and coverage-validate conformance output before it becomes stage facts. PR lifecycle requests always require the `conformance` callback; a callback that cannot produce a valid contract yields `INCONCLUSIVE`.
- [ ] **Step 5: Ensure repair invalidation.** Any repair/delivery after a conformance reading requires review/applicable QA/security/conformance to run again before `verify-final` may certify the final branch.
- [ ] **Step 6: Run GREEN.**

```bash
corepack pnpm vitest run packages/core/engineering-workflow/tests/conformance.spec.ts packages/core/engineering-workflow/tests/workflow.spec.ts packages/core/engineering-workflow/tests/lifecycle.spec.ts
corepack pnpm run typecheck
```

- [ ] **Step 7: Commit.**

```bash
git add packages/core/engineering-workflow
git commit -m "feat(trick): gate PR readiness on implementation conformance"
```

---

### Task 5: Add Plurora DoD Policy and Conformance Routing

**Files:**
- Modify: `profiles/plurora/routing-policy.ts`
- Modify: `profiles/plurora/workflow-policy.ts`
- Create: `profiles/plurora/conformance-policy.ts`
- Modify: `profiles/plurora/profile.ts`
- Modify: `profiles/plurora/tests/routing.spec.ts`
- Modify: `profiles/plurora/tests/profile.spec.ts`
- Modify: `profiles/plurora/tests/composition.spec.ts`

**Interfaces:**

```ts
export const pluroraDodObligations: readonly ConformanceObligation[] = [
  {
    id: 'DOD-APPROVED-ARTIFACTS',
    source: 'dod',
    requirement: 'approved Spec and Plan paths and SHA-256 hashes still match the workflow objective and current files',
    required: true,
  },
  {
    id: 'DOD-DIFF-COHERENCE',
    source: 'dod',
    requirement: 'the final published diff is coherent and contains no unrelated or stray readiness-affecting artifacts',
    required: true,
  },
  {
    id: 'DOD-FRESH-EVIDENCE',
    source: 'dod',
    requirement: 'all applicable verification gates have fresh evidence for the final implementation state',
    required: true,
  },
  {
    id: 'DOD-NO-MATERIAL-DEFECT',
    source: 'dod',
    requirement: 'no confirmed material defect remains open in the latest certifying stage facts',
    required: true,
  },
  {
    id: 'DOD-APPLICABLE-QA',
    source: 'dod',
    requirement: 'the latest applicable QA stage passed with required evidence or QA is deterministically not required',
    required: true,
  },
  {
    id: 'DOD-APPLICABLE-SECURITY',
    source: 'dod',
    requirement: 'the latest applicable security stage passed with required evidence or security review is deterministically not required',
    required: true,
  },
  {
    id: 'DOD-DELIVERY-WORLD',
    source: 'dod',
    requirement: 'the reviewed branch commit and pull request correspond to the published implementation being certified',
    required: true,
  },
  {
    id: 'DOD-FINAL-VERIFY-READY',
    source: 'dod',
    requirement: 'all prerequisites are satisfied for a fresh final verification stage to certify the branch after conformance',
    required: true,
  },
]
```

**Routing rows:**

```ts
{ id: 'critical-conformance', when: { role: 'conformance', risk: 'critical' }, use: { executor: 'codex', tier: 'codex.frontier', effort: 'xhigh' } }
{ id: 'high-conformance', when: { role: 'conformance', risk: 'high' }, use: { executor: 'codex', tier: 'codex.frontier', effort: 'xhigh' } }
{ id: 'routine-conformance', when: { role: 'conformance' }, use: { executor: 'codex', tier: 'codex.balanced', effort: 'high' } }
{ id: 'codex-unavailable-conformance', when: { unavailable: 'codex', role: 'conformance' }, use: { executor: 'opencode', tier: 'opencode.reasoning-fast' } }
```

- [ ] **Step 1: Write RED routing tests** for all four risk levels and Codex-unavailable fallback.
- [ ] **Step 2: Write RED independence tests** proving high/critical conformance cannot certify when implementation executor is OpenCode and fallback also resolves to OpenCode under `cross-executor-required`.
- [ ] **Step 3: Add the eight baseline DoD rows exactly as above** and reference them from the Plurora profile without embedding NeuroVia file paths, database refs or native model ids.
- [ ] **Step 4: Implement routing rows before generic review/default rows** so conformance-specific routes win deterministically.
- [ ] **Step 5: Run GREEN.**

```bash
corepack pnpm vitest run profiles/plurora/tests/routing.spec.ts profiles/plurora/tests/profile.spec.ts profiles/plurora/tests/composition.spec.ts
corepack pnpm run constraints
corepack pnpm run typecheck
```

- [ ] **Step 6: Commit.**

```bash
git add profiles/plurora
git commit -m "feat(trick): route and define Plurora conformance DoD"
```

---

### Task 6: Carry Approved Artifacts and Conformance Through Control/Journal Status

**Files:**
- Modify: `packages/core/control-server/src/types.ts`
- Modify: `packages/core/control-server/src/index.ts`
- Test: `packages/core/control-server/tests/server.spec.ts`
- Modify: `packages/core/journal/src/types.ts`
- Modify: `packages/core/journal/src/index.ts`
- Test: `packages/core/journal/tests/journal.spec.ts`
- Test: `packages/core/journal/tests/invariant.spec.ts`

**Bounded status shape:**

```ts
interface ConformanceStatusSummary {
  readonly specPath: string
  readonly specSha256: string
  readonly planPath: string
  readonly planSha256: string
  readonly expected: Readonly<Record<'spec' | 'plan' | 'dod', number>>
  readonly counts: Readonly<Record<ConformanceItemStatus, number>>
  readonly verdict: WorkflowVerdict
}
```

- [ ] **Step 1: Write RED API/parser tests** proving workflow start accepts approved artifacts, rejects malformed/absolute/traversal paths, and status exposes only bounded hashes/counts/verdict rather than whole document/model output.
- [ ] **Step 2: Write RED journal tests** proving artifact identity and conformance summary survive replay/restart and no event key stores `specText`, `planText`, `prompt`, `transcript`, `reasoning` or provider output.
- [ ] **Step 3: Implement control and durable projection changes** in the existing `types.ts`/`index.ts` files using current parser/journal conventions.
- [ ] **Step 4: Run GREEN.**

```bash
corepack pnpm vitest run packages/core/control-server packages/core/journal
corepack pnpm run typecheck
```

- [ ] **Step 5: Commit.**

```bash
git add packages/core/control-server packages/core/journal
git commit -m "feat(trick): expose bounded conformance status"
```

---

### Task 7: Wire the Plurora Host and Validate Codex Effort Capability

**Files:**
- Modify: `apps/plurora-harness-host/src/main.ts`
- Modify: `apps/plurora-harness-host/src/model-registry.ts`
- Modify: `apps/plurora-harness-host/src/workflow-handlers.ts`
- Modify: `apps/plurora-harness-host/tests/model-registry.spec.ts`
- Modify: `apps/plurora-harness-host/tests/host.spec.ts`
- Modify: `packages/subagent/subagent-codex/src/wire.ts`
- Modify: `packages/subagent/subagent-codex/src/index.ts`
- Test: `packages/subagent/subagent-codex/tests/subagent-codex.spec.ts`
- Test: `packages/subagent/subagent-codex/tests/real-product.spec.ts`

**Precondition:** Plan E has created `apps/plurora-harness-host` and has added pinned-schema `model/list` wire support. Task 7 extends that concrete implementation; it does not introduce a second model catalogue path.

- [ ] **Step 1: Write RED host tests** proving conformance receives current approved artifact texts only after host-side path containment/hash verification and receives the deterministic manifest including eight Plurora DoD rows.
- [ ] **Step 2: Add RED catalogue tests** proving configured `codex.balanced` advertises `high` and `codex.frontier` advertises `xhigh`; unsupported requested effort blocks host readiness instead of downgrading.
- [ ] **Step 3: Extend the Plan E `model/list` reader** to expose each model's advertised effort strings to the host validator. Preserve product-advertised values/order; do not maintain a guessed model-capability table.
- [ ] **Step 4: Implement the structured conformance interpreter** so provider output is parsed with `parseConformanceContract` and validated against the manifest before stage facts are accepted.
- [ ] **Step 5: Run GREEN + real authenticated catalogue smoke.**

```bash
corepack pnpm --filter @trick-harness/plurora-host test
corepack pnpm vitest run packages/subagent/subagent-codex/tests/subagent-codex.spec.ts packages/subagent/subagent-codex/tests/real-product.spec.ts profiles/plurora/tests/routing.spec.ts
```

- [ ] **Step 6: Commit.**

```bash
git add apps/plurora-harness-host packages/subagent/subagent-codex
git commit -m "feat(trick): wire conformance through the Plurora host"
```

---

### Task 8: Verify Conformance End-to-End and Record the New Installation SHA

**Files:**
- Modify: `README.trick-harness.md`
- Create: `docs/verification/2026-08-28-implementation-conformance-dod-evidence.md`
- Modify: `docs/verification/2026-08-27-neurovia-deployment-enablement-evidence.md`

- [ ] **Step 1: Run deterministic gates.**

```bash
corepack pnpm run constraints
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run build
corepack pnpm run test:trick
corepack pnpm --filter @trick-harness/plurora-host test
```

- [ ] **Step 2: Run a fixture PR lifecycle** whose Spec has two explicit criterion IDs and Plan has two tasks; prove manifest contains exactly 2 Spec + 2 Plan + 8 baseline DoD rows and `PR_READY` is reached only after conformance PASS + verify-final PASS.
- [ ] **Step 3: Run adversarial fixtures:** omitted Plan task, changed Spec hash, duplicate result item, unknown obligation substitution and high-risk OpenCode implementation with Codex unavailable. Each must fail/block/inconclusive according to the Spec instead of reaching `PR_READY`.
- [ ] **Step 4: Run real authenticated Codex catalogue evidence** showing concrete models mapped to `codex.balanced` and `codex.frontier` advertise `high` and `xhigh`; record ids but no credentials.
- [ ] **Step 5: Independently review** role authority, artifact path containment, hash integrity, conformance coverage, fallback independence, journal redaction and PR readiness. Fix confirmed defects and rerun affected gates.
- [ ] **Step 6: Update Plan E evidence** to label its recorded SHA as intermediate and reference the post-Plan-F evidence file as the installation authority.
- [ ] **Step 7: Record the final reviewed exact 40-hex SHA.** This post-Plan-F SHA supersedes every intermediate Plan E SHA as the only initial runtime revision Plan C* may pin.
- [ ] **Step 8: Commit evidence/docs.**

```bash
git add README.trick-harness.md docs/verification
git commit -m "docs(trick): record implementation conformance evidence"
```

## Completion Contract

Plan F is complete only when `conformance` is a read-only first-class role; approved Spec/Plan path+hash identity is durable and revalidated; deterministic code enumerates Spec criteria, Plan tasks and eight baseline DoD rows before model dispatch; incomplete/mismatched conformance output cannot PASS; Plurora routes low/medium conformance to `codex.balanced/high` and high/critical to `codex.frontier/xhigh`; Codex-unavailable fallback is explicit and cannot satisfy required high/critical independence when it collapses onto the implementation executor; `PR_READY` requires latest conformance PASS plus verify-final PASS; bounded status/replay contains no documents/transcripts/reasoning; and a fresh independently reviewed post-Plan-F SHA is recorded for NeuroVia installation.
