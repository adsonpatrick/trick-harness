# Trick Harness Change Impact, Risk & Policy Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Harness deterministically derive planned/actual change impact and use it to enforce effective risk, QA/Security stages, database verification, routing facts and evidence profiles instead of trusting caller-provided risk alone.

**Architecture:** Add a reusable `@trick-harness/change-impact` core package that compiles declarative profile path rules with Picomatch and produces bounded impact facts. Split the PR lifecycle at delivery: planned impact governs mutation-capable work, actual published-diff impact governs certification, and repair/redelivery recomputes impact before certification resumes. `profiles/plurora` owns path/risk/evidence policy; the runnable Plurora host supplies approved-Plan paths and actual Git diff paths without putting NeuroVia assumptions into generic Core.

**Tech Stack:** TypeScript, Node.js `^22.19.0 || >=24.0.0`, pnpm `11.7.0`, `picomatch` `4.0.5`, `@types/picomatch` `4.0.3`, existing contracts/profile/routing/journal/engineering-workflow/composition packages, post-Plan-E `apps/plurora-harness-host`, post-Plan-F conformance contracts, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-harness-v2-change-impact-risk-policy-enforcement-amendment.md`

**Requires:** Plan E and Plan F complete and independently reviewed. Execute Plan G against the final reviewed post-Plan-F head, not against current `master` if Plan E/F are still unmerged.

## Global Constraints

- Change impact is deterministic code; no model creates, edits or downgrades classification facts.
- `effectiveRisk` is monotonic: `max(objective risk, planned risk floor, actual risk floor)`.
- Planned impact exists before the first mutation-capable implementation dispatch.
- Actual impact is computed from the published branch after delivery and after every repair/redelivery.
- Generic `packages/` contain no NeuroVia repository paths, Supabase project refs or concrete Plurora gate commands.
- Plurora path classifiers live in `profiles/plurora`; actual Git reading lives in `apps/plurora-harness-host`.
- Path rules accumulate. Routing remains first-match-wins.
- Repository paths are normalized to POSIX `/`, must be relative, and may not contain `..` traversal segments.
- Picomatch is called with `dot: true`; do not introduce a second custom glob implementation.
- Read-only roles always have `writeVolume='none'`.
- A detected database mutation cannot be disabled by caller metadata.
- Existing MiMo hard invariants for implementation/repair remain binding.
- Existing Plan F Conformance remains required before `verify-final`; Plan G supplies it stronger deterministic evidence rather than replacing it.
- Merge/release/deploy remain human-controlled.

---

### Task 1: Add Change-Impact Contracts and Profile Policy Types

**Files:**
- Modify: `packages/core/contracts/src/types.ts`
- Modify: `packages/core/contracts/src/index.ts`
- Modify: `packages/core/contracts/tests/contracts.spec.ts`
- Modify: `packages/core/contracts/tests/invariant.spec.ts`
- Modify: `packages/core/profile/src/types.ts`
- Modify: `packages/core/profile/src/index.ts`
- Modify: `packages/core/profile/tests/profile.spec.ts`

**Interfaces:**

```ts
export const CHANGE_IMPACT_SOURCES = ['planned', 'actual'] as const
export type ChangeImpactSource = typeof CHANGE_IMPACT_SOURCES[number]

export interface ChangeImpactFacts {
  readonly source: ChangeImpactSource
  readonly pathCount: number
  readonly surfaces: readonly string[]
  readonly riskFloor: Risk
  readonly writeVolume: WriteVolume
  readonly taskClasses: readonly string[]
  readonly requiredCapabilities: readonly string[]
  readonly evidenceProfiles: readonly string[]
  readonly databaseMutation: boolean
  readonly matchedRuleIds: readonly string[]
  readonly unplannedPaths: readonly string[]
}

export interface EffectiveChangeImpact {
  readonly planned: ChangeImpactFacts
  readonly actual?: ChangeImpactFacts
  readonly effectiveRisk: Risk
  readonly writeVolume: WriteVolume
  readonly surfaces: readonly string[]
  readonly taskClasses: readonly string[]
  readonly requiredCapabilities: readonly string[]
  readonly evidenceProfiles: readonly string[]
  readonly databaseMutation: boolean
}

export interface WorkflowObjective {
  // existing fields
  readonly taskClass?: string
}
```

```ts
export interface ChangeImpactRuleDefinition {
  readonly id: string
  readonly paths: readonly string[]
  readonly use: Readonly<{
    surface?: string
    riskFloor?: Risk
    taskClass?: string
    requiredCapability?: string
    evidenceProfile?: string
    databaseMutation?: boolean
  }>
}

export interface ChangeImpactPolicyDefinition {
  readonly rules: readonly ChangeImpactRuleDefinition[]
  readonly writeVolume: Readonly<{
    smallMaxFiles: number
    mediumMaxFiles: number
  }>
}

export interface HarnessProfile {
  // existing policies
  readonly changeImpactPolicy: ChangeImpactPolicyDefinition
}
```

- [ ] **Step 1: Write RED contract tests** proving `ChangeImpactFacts` vocabulary is exported, `WorkflowObjective.taskClass` accepts only a bounded non-empty string when present, and `EffectiveChangeImpact` cannot be constructed by the parsers with unknown risk/write-volume values.
- [ ] **Step 2: Write RED profile validation tests** for duplicate rule IDs, empty pattern arrays, absolute patterns, traversal patterns, empty `use`, invalid risk floors, non-positive thresholds and `smallMaxFiles >= mediumMaxFiles`.
- [ ] **Step 3: Run RED.**

```bash
corepack pnpm vitest run packages/core/contracts/tests/contracts.spec.ts packages/core/contracts/tests/invariant.spec.ts packages/core/profile/tests/profile.spec.ts
```

- [ ] **Step 4: Implement the contracts and validators.** Freeze parsed arrays/objects using the package's existing immutable-return pattern. Profile validation must reject path patterns beginning with `/`, drive-letter prefixes such as `C:`, and any `/../` or leading `../` segment.
- [ ] **Step 5: Run GREEN + typecheck.**

```bash
corepack pnpm vitest run packages/core/contracts/tests/contracts.spec.ts packages/core/contracts/tests/invariant.spec.ts packages/core/profile/tests/profile.spec.ts
corepack pnpm run typecheck
```

- [ ] **Step 6: Commit.**

```bash
git add packages/core/contracts packages/core/profile
git commit -m "feat(trick): add deterministic change impact contracts"
```

---

### Task 2: Build the Generic Change-Impact Classifier

**Files:**
- Create: `packages/core/change-impact/package.json`
- Create: `packages/core/change-impact/tsconfig.json`
- Create: `packages/core/change-impact/src/index.ts`
- Create: `packages/core/change-impact/src/invariant.ts`
- Create: `packages/core/change-impact/tests/change-impact.spec.ts`
- Modify: `pnpm-lock.yaml`

**Dependencies:**

```json
{
  "dependencies": {
    "picomatch": "4.0.5"
  },
  "devDependencies": {
    "@types/picomatch": "4.0.3",
    "@trick-harness/contracts": "workspace:^",
    "@trick-harness/profile": "workspace:^"
  }
}
```

`picomatch` is used only as a matcher. Context7 confirms `picomatch(pattern, options)` returns a boolean matcher and supports `dot` plus explicit Windows-separator behavior; this package normalizes inputs itself and calls Picomatch with POSIX-form paths and `{ dot: true, windows: false }`.

**Interfaces:**

```ts
export function normalizeRepositoryPath(input: string): string

export function classifyChangeImpact(input: {
  readonly source: ChangeImpactSource
  readonly paths: readonly string[]
  readonly policy: ChangeImpactPolicyDefinition
  readonly approvedPlannedPaths?: readonly string[]
}): ChangeImpactFacts

export function mergeChangeImpact(input: {
  readonly objectiveRisk: Risk
  readonly planned: ChangeImpactFacts
  readonly actual?: ChangeImpactFacts
}): EffectiveChangeImpact
```

**Ordering:**

```ts
const RISK_ORDER = ['low', 'medium', 'high', 'critical'] as const
const WRITE_VOLUME_ORDER = ['none', 'small', 'medium', 'large'] as const
```

- [ ] **Step 1: Write RED normalization tests** for `src\\lib\\auth\\route-policy.ts -> src/lib/auth/route-policy.ts`, duplicate slash removal, `./src/x.ts -> src/x.ts`, absolute POSIX refusal, drive-letter refusal, empty path refusal and `../` traversal refusal.
- [ ] **Step 2: Write RED classifier tests** proving all matching rules accumulate; duplicate surfaces/classes/capabilities/evidence IDs are deduplicated in policy order; dotfiles match; broad UI and specific auth can both survive; and matched-rule IDs are stable.
- [ ] **Step 3: Write RED write-volume tests** for exactly `0=none`, `1..smallMaxFiles=small`, `smallMaxFiles+1..mediumMaxFiles=medium`, and larger=`large`.
- [ ] **Step 4: Write RED merge tests** proving effective risk/write volume take the maximum, actual facts cannot lower planned facts, and actual paths absent from `approvedPlannedPaths` populate `unplannedPaths`.
- [ ] **Step 5: Run RED.**

```bash
corepack pnpm vitest run packages/core/change-impact/tests/change-impact.spec.ts
```

- [ ] **Step 6: Add the package dependency exactly.**

```bash
corepack pnpm --filter @trick-harness/change-impact add picomatch@4.0.5
corepack pnpm --filter @trick-harness/change-impact add -D @types/picomatch@4.0.3 @trick-harness/contracts@workspace:^ @trick-harness/profile@workspace:^
```

- [ ] **Step 7: Implement classifier/merge logic** with precompiled matchers per call, stable policy-order accumulation and frozen outputs. Do not use basename matching; rules are repository-relative path rules.
- [ ] **Step 8: Run GREEN, constraints and typecheck.**

```bash
corepack pnpm vitest run packages/core/change-impact/tests/change-impact.spec.ts
corepack pnpm run constraints
corepack pnpm run typecheck
```

- [ ] **Step 9: Commit.**

```bash
git add packages/core/change-impact pnpm-lock.yaml
git commit -m "feat(trick): classify repository change impact"
```

---

### Task 3: Define Plurora Surfaces, Risk Floors and Evidence Profiles

**Files:**
- Create: `profiles/plurora/change-impact-policy.ts`
- Modify: `profiles/plurora/qa-policy.ts`
- Modify: `profiles/plurora/security-policy.ts`
- Modify: `profiles/plurora/profile.ts`
- Modify: `profiles/plurora/tests/profile.spec.ts`
- Create: `profiles/plurora/tests/change-impact.spec.ts`
- Modify: `profiles/plurora/tests/routing.spec.ts`

**Plurora policy:**

```ts
export const changeImpactPolicy: ChangeImpactPolicyDefinition = {
  writeVolume: { smallMaxFiles: 3, mediumMaxFiles: 12 },
  rules: [
    { id: 'database-migrations', paths: ['supabase/migrations/**'], use: { surface: 'database', riskFloor: 'critical', requiredCapability: 'database-verification', evidenceProfile: 'db-standard', databaseMutation: true } },
    { id: 'database-tests', paths: ['supabase/tests/**'], use: { surface: 'database', riskFloor: 'critical', evidenceProfile: 'db-standard' } },
    { id: 'database-tooling', paths: ['scripts/db/**'], use: { surface: 'database', riskFloor: 'high', evidenceProfile: 'db-standard' } },

    { id: 'auth-library', paths: ['src/lib/auth/**'], use: { surface: 'auth', riskFloor: 'critical', taskClass: 'auth', evidenceProfile: 'auth-standard' } },
    { id: 'auth-feature', paths: ['src/features/auth/**', 'src/features/admin-auth/**'], use: { surface: 'auth', riskFloor: 'critical', taskClass: 'auth', evidenceProfile: 'auth-standard' } },
    { id: 'auth-proxy', paths: ['src/proxy.ts'], use: { surface: 'auth', riskFloor: 'critical', taskClass: 'auth', evidenceProfile: 'auth-standard' } },

    { id: 'dependencies', paths: ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'], use: { surface: 'dependencies', riskFloor: 'high', taskClass: 'dependency', evidenceProfile: 'dependency-standard' } },
    { id: 'workflow-supply-chain', paths: ['.github/workflows/**'], use: { surface: 'dependencies', riskFloor: 'high', taskClass: 'dependency', evidenceProfile: 'dependency-standard' } },
    { id: 'delivery-automation', paths: ['.github/**', 'scripts/git/**'], use: { surface: 'delivery', riskFloor: 'high', taskClass: 'delivery', evidenceProfile: 'delivery-standard' } },

    { id: 'design-system', paths: ['src/components/ui/**'], use: { surface: 'ui', riskFloor: 'medium', evidenceProfile: 'ui-standard' } },
    { id: 'application-ui', paths: ['src/features/**', 'src/app/**', 'src/shell/**'], use: { surface: 'ui', riskFloor: 'medium', evidenceProfile: 'ui-standard' } },
  ],
}
```

Update QA/Security policy so their `use` rows state risk/evidence requirements that Plan G resolves:

```text
database      -> critical, db-standard, independent QA
auth          -> critical, auth-standard, Security required
api           -> high, api-standard
ui            -> medium, ui-standard
dependencies  -> high, dependency-standard, Security required
delivery      -> high, delivery-standard, Security required
credentials   -> critical, Security required
```

- [ ] **Step 1: Write RED profile tests** for each path family above, including `.github/workflows/ci.yml` matching both `dependencies` and `delivery`, and `src/features/auth/signup-form.tsx` matching both `auth` and broad `ui` without losing `auth`.
- [ ] **Step 2: Write RED risk tests** proving `objective risk=low` plus auth resolves to critical and UI resolves to medium.
- [ ] **Step 3: Write RED security-trigger tests** proving auth/dependencies/delivery/credentials resolve Security as required independently of the caller risk.
- [ ] **Step 4: Implement the policy and add it to `pluroraProfile`.** Keep NeuroVia product ref/database name out of this file.
- [ ] **Step 5: Run GREEN.**

```bash
corepack pnpm vitest run profiles/plurora/tests/change-impact.spec.ts profiles/plurora/tests/profile.spec.ts profiles/plurora/tests/routing.spec.ts
corepack pnpm run constraints
```

- [ ] **Step 6: Commit.**

```bash
git add profiles/plurora
git commit -m "feat(trick): define Plurora change impact policy"
```

---

### Task 4: Extract the Planned Write Set from the Approved Superpowers Plan

**Files:**
- Modify: `packages/core/engineering-workflow/src/conformance.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/tests/conformance.spec.ts`

**Requires from Plan F:** `conformance.ts` exists and receives the exact approved Plan bytes whose SHA-256 was verified before mutation.

**Interface:**

```ts
export function extractApprovedPlanWriteSet(planText: string): readonly string[]
```

**Accepted file-entry grammar:**

```text
- Create: `path/to/file.ts`
- Modify: `path/to/file.ts`
- Test: `path/to/file.spec.ts`
- Delete: `path/to/file.ts`
```

The parser only reads entries inside a `**Files:**` block belonging to a `### Task N:` section. It strips a trailing source-line locator such as `:120-145` only after the closing repository path has been identified. Paths containing glob metacharacters `* ? [ ] { }` are refused: the approved Plan is expected to name concrete write/test files.

- [ ] **Step 1: Write RED tests** using a two-task Superpowers fixture with Create/Modify/Test/Delete rows, duplicate paths, prose outside `**Files:**`, and line-range suffixes.
- [ ] **Step 2: Write adversarial RED tests** for zero file rows, absolute paths, `../`, glob patterns, Windows drive paths, malformed backticks and a fake `- Modify:` line outside a Files block.
- [ ] **Step 3: Run RED.**

```bash
corepack pnpm vitest run packages/core/engineering-workflow/tests/conformance.spec.ts
```

- [ ] **Step 4: Implement the deterministic parser** by reusing `normalizeRepositoryPath` from `@trick-harness/change-impact`; return sorted first-seen unique paths and no document content beyond the path list.
- [ ] **Step 5: Run GREEN + typecheck.**

```bash
corepack pnpm vitest run packages/core/engineering-workflow/tests/conformance.spec.ts
corepack pnpm run typecheck
```

- [ ] **Step 6: Commit.**

```bash
git add packages/core/engineering-workflow
git commit -m "feat(trick): extract approved plan write set"
```

---

### Task 5: Read the Actual Published Diff in the Plurora Host

**Files:**
- Create: `apps/plurora-harness-host/src/change-set.ts`
- Create: `apps/plurora-harness-host/tests/change-set.spec.ts`
- Modify: `apps/plurora-harness-host/src/config.ts`
- Modify: `apps/plurora-harness-host/tests/config.spec.ts`
- Modify: `apps/plurora-harness-host/src/main.ts`

**Config addition:**

```ts
interface PluroraDeploymentConfig {
  // Plan E fields
  readonly project: {
    readonly protectedBranch: string
  }
}
```

Plan C* will set `protectedBranch: 'main'` in NeuroVia's non-secret `plurora-harness.json`.

**Interfaces:**

```ts
export interface ProjectChangeSetReader {
  actualPaths(signal: AbortSignal): Promise<readonly string[]>
}

export function createGitChangeSetReader(input: {
  readonly projectRoot: string
  readonly protectedBranch: string
  readonly subprocess: ManagedSubprocessService
}): ProjectChangeSetReader
```

**Git algorithm:**

```text
git merge-base HEAD origin/<protectedBranch>
-> git diff --name-status -z --diff-filter=ACMRTUXB <mergeBase>..HEAD
-> for A/M/T/U/X/B retain path
-> for R/C retain both old and new path
-> normalize/dedupe
```

- [ ] **Step 1: Write RED parser tests** for add/modify/rename/copy records, NUL separation, malformed status records and secret-safe bounded errors.
- [ ] **Step 2: Write RED subprocess tests** proving argv-array/no-shell execution, project cwd only, configured branch only, abort propagation and whole-tree `waitForExit()` before completion.
- [ ] **Step 3: Write RED config tests** requiring non-empty simple branch names and rejecting refs containing whitespace, `..`, `~`, `^`, `:`, `?`, `*`, `[` or a leading `-`.
- [ ] **Step 4: Implement the reader.** It may read Git state only; it must not fetch, checkout, reset, merge or modify refs.
- [ ] **Step 5: Run GREEN.**

```bash
corepack pnpm --filter @trick-harness/plurora-host test
corepack pnpm run typecheck
```

- [ ] **Step 6: Commit.**

```bash
git add apps/plurora-harness-host
git commit -m "feat(trick): read published project change set"
```

---

### Task 6: Resolve Effective Policy and Split the PR Lifecycle at Delivery

**Files:**
- Modify: `packages/core/engineering-workflow/src/types.ts`
- Create: `packages/core/engineering-workflow/src/impact-policy.ts`
- Modify: `packages/core/engineering-workflow/src/lifecycle.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Create: `packages/core/engineering-workflow/tests/impact-policy.spec.ts`
- Modify: `packages/core/engineering-workflow/tests/lifecycle.spec.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`

**Interfaces:**

```ts
export interface ChangeImpactReader {
  plannedPaths(objective: WorkflowObjective, signal: AbortSignal): Promise<readonly string[]>
  actualPaths(objective: WorkflowObjective, signal: AbortSignal): Promise<readonly string[]>
}

export interface CertificationRequirements {
  readonly effectiveRisk: Risk
  readonly qaRequired: boolean
  readonly securityRequired: boolean
  readonly evidenceProfiles: readonly string[]
  readonly independenceRequirement: IndependenceRequirement
}

export function resolveCertificationRequirements(
  profile: HarnessProfile,
  impact: EffectiveChangeImpact,
): CertificationRequirements

export function planPullRequestImplementationStages(): readonly StageSpec[]
export function planPullRequestCertificationStages(
  requirements: CertificationRequirements,
): readonly StageSpec[]
```

**Lifecycle after Plan F + Plan G:**

```text
implement
-> verify
-> delivery
-> resolve actual impact
-> review
-> QA when policy/risk requires
-> Security when policy requires
-> conformance
-> verify-final
```

- [ ] **Step 1: Write RED policy-resolution tests** proving all matching `qaPolicy.rules` and `securityPolicy.rules` are accumulated across all impact surfaces rather than first-match-only.
- [ ] **Step 2: Write RED lifecycle tests** where `objective.risk='low'` plus actual auth surface still produces `review -> qa -> security -> conformance -> verify-final`.
- [ ] **Step 3: Write RED UI tests** where low objective plus UI produces QA but not Security.
- [ ] **Step 4: Write RED low-risk docs-only fixture** proving it does not gain QA/Security when no policy requires them, while still retaining review/conformance/final verification.
- [ ] **Step 5: Refactor the runner into implementation and certification phases.** Planned impact is computed before `implement`; actual impact is computed only after successful delivery and before any certifying review.
- [ ] **Step 6: Preserve assurance monotonicity.** If planned impact already required Security, actual impact may not remove it even if the final diff no longer matches the sensitive path; the approved/planned requirement remains part of the effective impact for that run.
- [ ] **Step 7: Run GREEN.**

```bash
corepack pnpm vitest run packages/core/engineering-workflow/tests/impact-policy.spec.ts packages/core/engineering-workflow/tests/lifecycle.spec.ts packages/core/engineering-workflow/tests/workflow.spec.ts
corepack pnpm run typecheck
```

- [ ] **Step 8: Commit.**

```bash
git add packages/core/engineering-workflow
git commit -m "feat(trick): enforce change impact in PR lifecycle"
```

---

### Task 7: Feed Effective Impact into Routing Without Weakening MiMo Invariants

**Files:**
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Modify: `profiles/plurora/tests/routing.spec.ts`
- Modify: `packages/core/routing/tests/routing.spec.ts`

**Routing context construction:**

```ts
function routingContextFor(stage: StageSpec, impact: EffectiveChangeImpact): RoutingContext {
  return {
    role: stage.role,
    workload: objective.workload,
    risk: impact.effectiveRisk,
    writeVolume: READ_ONLY_ROLES.includes(stage.role) ? 'none' : impact.writeVolume,
    independenceRequirement: profile.independencePolicy[impact.effectiveRisk],
    taskClass: impact.taskClasses[0] ?? objective.taskClass,
    requiredCapabilities: impact.requiredCapabilities,
    // existing attempts/degraded/implementationExecutor/override fields
  }
}
```

Classifier-produced task classes are ordered by profile rule order and therefore precede the optional objective task class.

- [ ] **Step 1: Write RED tests** proving auth impact feeds `taskClass='auth'`, critical risk and `xhigh` Codex judgement routes where applicable.
- [ ] **Step 2: Write RED write-volume tests** proving a 13-file implementation/repair routes through existing `large-write-implementation` / `large-write-repair` to `opencode.workhorse`.
- [ ] **Step 3: Write RED fallback test** proving factual large/heavy implementation still cannot fall through to a non-MiMo route except an explicit human run override permitted by the existing hard-invariant contract.
- [ ] **Step 4: Write RED capability test** proving database impact puts `database-verification` in `requiredCapabilities` and the durable route reason remains explainable.
- [ ] **Step 5: Replace role-shaped write-volume construction** with impact-aware construction while preserving `none` for every read-only role.
- [ ] **Step 6: Run GREEN.**

```bash
corepack pnpm vitest run packages/core/engineering-workflow/tests/workflow.spec.ts profiles/plurora/tests/routing.spec.ts packages/core/routing/tests/routing.spec.ts
corepack pnpm run typecheck
```

- [ ] **Step 7: Commit.**

```bash
git add packages/core/engineering-workflow packages/core/routing profiles/plurora/tests/routing.spec.ts
git commit -m "feat(trick): route from effective change impact"
```

---

### Task 8: Make Database Verification and Evidence Profiles Impact-Driven

**Files:**
- Modify: `packages/core/engineering-workflow/src/types.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Modify: `packages/core/engineering-workflow/tests/lifecycle.spec.ts`
- Modify: `packages/composition/runtime/src/harness.ts`
- Modify: `packages/composition/runtime/tests/harness.spec.ts`

**Stage extension:**

```ts
export interface StageSpec {
  readonly stageId: string
  readonly role: Role
  readonly requiredEvidenceProfiles?: readonly string[]
}
```

**DB rule:**

```ts
const databaseRequired =
  explicitDatabaseChange === 'required'
  || effectiveImpact.databaseMutation
```

There is no inverse caller field that can force this false.

- [ ] **Step 1: Write RED DB test** where objective/caller omits `databaseChange`, planned path includes `supabase/migrations/20260828090000_example.sql`, and delivery is BLOCKED when no database verification capability exists.
- [ ] **Step 2: Write RED DB-positive test** proving the same classified migration runs the deterministic `databaseVerification.verify` capability before delivery can succeed.
- [ ] **Step 3: Write RED evidence-profile tests** proving `ui-standard` is carried to QA for UI and `auth-standard` is carried to QA/Security/conformance-relevant stage facts for auth.
- [ ] **Step 4: Implement impact-driven DB requirement and immutable evidence-profile arrays** on certification stages. Do not put concrete npm commands into StageSpec.
- [ ] **Step 5: Ensure composition supplies the Plan E generic DB verifier unchanged.** Plan G must not reintroduce Preview-only semantics.
- [ ] **Step 6: Run GREEN.**

```bash
corepack pnpm vitest run packages/core/engineering-workflow/tests/workflow.spec.ts packages/core/engineering-workflow/tests/lifecycle.spec.ts packages/composition/runtime/tests/harness.spec.ts
corepack pnpm run typecheck
```

- [ ] **Step 7: Commit.**

```bash
git add packages/core/engineering-workflow packages/composition/runtime
git commit -m "feat(trick): gate capabilities from change impact"
```

---

### Task 9: Recompute Actual Impact After Repair and Surface Scope Drift

**Files:**
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Modify: `packages/core/engineering-workflow/src/repair.ts`
- Modify: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Modify: `packages/core/engineering-workflow/tests/repair.spec.ts`
- Modify: `packages/core/engineering-workflow/tests/conformance.spec.ts`

**Repair rule:**

```text
confirmed repair
-> repair stage
-> focused verification
-> delivery
-> actualPaths()
-> classify actual impact again
-> merge with original planned/effective requirements
-> rerun required review/QA/Security/conformance/final verify
```

- [ ] **Step 1: Write RED adversarial test** starting from a medium UI change where repair unexpectedly adds `src/lib/auth/access-decision.ts`; the second certification pass must become critical and include Security.
- [ ] **Step 2: Write RED scope-drift test** where the approved Plan write set contains two files and actual diff contains a third; the actual impact must retain the normalized third path in `unplannedPaths`.
- [ ] **Step 3: Write RED non-downgrade test** where a repair removes the sensitive file from the final diff; certification must still retain the stronger planned/previous requirement for that workflow rather than downgrade.
- [ ] **Step 4: Wire `unplannedPaths` into the Plan F conformance input/evidence** as deterministic scope evidence. Conformance remains responsible for deciding whether the mismatch fails a Plan obligation; the classifier does not invent a product finding.
- [ ] **Step 5: Implement recomputation after every successful redelivery** before the next certifying stage is planned.
- [ ] **Step 6: Run GREEN.**

```bash
corepack pnpm vitest run packages/core/engineering-workflow/tests/workflow.spec.ts packages/core/engineering-workflow/tests/repair.spec.ts packages/core/engineering-workflow/tests/conformance.spec.ts
corepack pnpm run typecheck
```

- [ ] **Step 7: Commit.**

```bash
git add packages/core/engineering-workflow
git commit -m "feat(trick): recertify repaired change impact"
```

---

### Task 10: Journal and Expose Bounded Change-Impact Facts

**Files:**
- Modify: `packages/core/journal/src/types.ts`
- Modify: `packages/core/journal/src/index.ts`
- Modify: `packages/core/journal/tests/journal.spec.ts`
- Modify: `packages/core/control-server/src/types.ts`
- Modify: `packages/core/control-server/src/index.ts`
- Modify: `packages/core/control-server/tests/server.spec.ts`
- Modify: `packages/composition/runtime/tests/harness.spec.ts`

**Journal API:**

```ts
journal.changeImpact(facts: ChangeImpactFacts & { readonly effectiveRisk: Risk }): Promise<void>
```

**Bound:** store at most the first 100 normalized `unplannedPaths`; store total `unplannedPathCount` separately so truncation is observable.

- [ ] **Step 1: Write RED journal tests** for one planned and two actual impact facts, restart projection ordering, sorted/deduped scalar arrays and no duplicate file contents/diff payload fields.
- [ ] **Step 2: Write RED redaction/bounds test** with 150 unplanned paths; projection exposes count=150 and only 100 bounded path strings.
- [ ] **Step 3: Write RED control-status test** proving status exposes the latest planned/actual impact summary, effective risk, evidence-profile IDs and DB mutation flag without raw diff text.
- [ ] **Step 4: Implement durable event/projection support** using the existing journal checkpoint semantics; impact fact must be flushed before the mutating/certifying phase whose policy depends on it begins.
- [ ] **Step 5: Run GREEN.**

```bash
corepack pnpm vitest run packages/core/journal/tests/journal.spec.ts packages/core/control-server/tests/server.spec.ts packages/composition/runtime/tests/harness.spec.ts
corepack pnpm run typecheck
```

- [ ] **Step 6: Commit.**

```bash
git add packages/core/journal packages/core/control-server packages/composition/runtime/tests/harness.spec.ts
git commit -m "feat(trick): journal effective change impact"
```

---

### Task 11: Wire the Plurora Host and Run Adversarial End-to-End Verification

**Files:**
- Modify: `apps/plurora-harness-host/src/workflow-handlers.ts`
- Modify: `apps/plurora-harness-host/src/main.ts`
- Modify: `apps/plurora-harness-host/tests/host.spec.ts`
- Modify: `apps/plurora-harness-host/tests/change-set.spec.ts`
- Modify: `profiles/plurora/tests/composition.spec.ts`
- Modify: `README.trick-harness.md`
- Create: `docs/verification/2026-08-28-change-impact-risk-enforcement-evidence.md`

**Host wiring:**

```text
verified approved Plan bytes
-> extractApprovedPlanWriteSet
-> planned impact
-> start implementation phase
-> GitHub delivery
-> actual Git change-set reader
-> actual/effective impact
-> policy-driven certification
```

- [ ] **Step 1: Add a host integration fixture** with an approved two-file Plan and a low-risk objective whose actual diff contains `src/lib/auth/route-policy.ts`; assert effective risk becomes critical and Security is scheduled.
- [ ] **Step 2: Add a DB fixture** where the Plan contains a migration but no explicit `databaseChange`; assert missing verifier BLOCKS and injected verifier permits continuation.
- [ ] **Step 3: Add a repair fixture** where the first published diff is UI-only and the repaired diff introduces auth; assert recertification strengthens to Security/cross-executor-required.
- [ ] **Step 4: Add a large-write fixture** with 13 changed files and prove implementation/repair route to `opencode.workhorse` under the existing Plurora hard invariant.
- [ ] **Step 5: Add a scope-drift fixture** proving one unplanned file reaches status and Conformance evidence and prevents the file from disappearing from the final certification record.
- [ ] **Step 6: Run focused package gates.**

```bash
corepack pnpm vitest run packages/core/change-impact/tests/change-impact.spec.ts
corepack pnpm vitest run packages/core/engineering-workflow/tests/impact-policy.spec.ts packages/core/engineering-workflow/tests/workflow.spec.ts packages/core/engineering-workflow/tests/lifecycle.spec.ts packages/core/engineering-workflow/tests/repair.spec.ts packages/core/engineering-workflow/tests/conformance.spec.ts
corepack pnpm vitest run profiles/plurora/tests/change-impact.spec.ts profiles/plurora/tests/routing.spec.ts profiles/plurora/tests/profile.spec.ts profiles/plurora/tests/composition.spec.ts
corepack pnpm --filter @trick-harness/plurora-host test
```

- [ ] **Step 7: Run full deterministic gates.**

```bash
corepack pnpm run constraints
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run build
corepack pnpm run test:trick
```

- [ ] **Step 8: Run fresh real-product smoke** from the Plurora host using the already authenticated OpenCode/Codex catalogues from Plan E. Use a disposable Git fixture/worktree for path-impact verification; do not mutate NeuroVia or a live database in Plan G verification.
- [ ] **Step 9: Perform an independent read-only Codex Engineering Guardrails review** against CI1-CI15. Treat any policy-declared-but-unenforced row, downgrade path, caller-only DB bypass or sensitive-surface omission as merge-blocking.
- [ ] **Step 10: Fix confirmed defects and rerun every affected focused gate plus `test:trick`.**
- [ ] **Step 11: Record evidence** in `docs/verification/2026-08-28-change-impact-risk-enforcement-evidence.md`, including exact head SHA, commands, exit statuses, CI1-CI15 matrix, known limitations and independent-review verdict.
- [ ] **Step 12: Update README** only with implemented/proven behavior and commit.

```bash
git add apps/plurora-harness-host profiles/plurora README.trick-harness.md docs/verification/2026-08-28-change-impact-risk-enforcement-evidence.md
git commit -m "docs(trick): record change impact enforcement evidence"
```

## Completion Contract

Plan G is complete only when CI1-CI15 are all backed by fresh evidence; planned impact is proven before mutation; actual published impact is proven before certification and after repair/redelivery; risk cannot decrease; QA/Security policy rows actually control lifecycle stages; routing receives factual risk/taskClass/writeVolume/capabilities; database mutation cannot bypass deterministic verification; evidence-profile IDs reach certifying stages; unplanned paths remain visible; all generic packages remain free of NeuroVia assumptions; full deterministic gates pass; and an independent read-only review finds no material policy-enforcement gap.

## Execution Handoff

Execute this plan only after Plan E and Plan F have produced a reviewed post-Plan-F SHA. Recommended execution mode is **Superpowers Subagent-Driven Development** with one fresh implementer per task and independent spec/code review between tasks; Tasks 6-10 share workflow contracts and must be integrated serially even if Tasks 2, 3 and 5 are explored in parallel read-only work.
