# Trick Harness Cloud-Dev & Plurora Host Enablement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the small runtime capabilities required before NeuroVia can install Harness V2: a generic deterministic database-verification seam, support for a project-supplied cloud-development verifier, and a runnable Plurora host inside the pinned Trick Harness checkout.

**Architecture:** Keep the existing reusable runtime and built-in `supabase-preview` integration intact, but stop making Preview Branches the only implementation of database verification. The engineering workflow consumes a generic database-verification port; composition can either adapt the existing Preview integration or accept an explicitly injected verifier. A new private `apps/plurora-harness-host` application sits above `profiles/plurora`, composes OpenCode/Codex/GitHub plus the injected NeuroVia DB verifier, validates the deployment model registry, and exposes the existing loopback control server.

**Tech Stack:** TypeScript, Node.js 22.19+/24+, pnpm 11.7.0, existing `@trick-harness/*` workspaces, DSH subprocess/session packages, OpenCode SDK, Codex app-server, Supabase CLI invoked only by the NeuroVia project verifier, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-27-neurovia-harness-deployment-cloud-dev-amendment.md`

## Global Constraints

- Generic Core/composition contracts contain no `neuro-via`, `neurovia-dev`, Supabase project ref, Notion, Linear, or Plurora Design System assumption.
- `profiles/plurora` may select project policy; the new runnable host may depend on that profile because it is explicitly Plurora deployment glue.
- The existing `supabase-preview` package remains available and tested; this plan does not pretend its positive real-cloud path has been proven.
- Project DB mutation remains a deterministic capability port; no model executor receives shell authority as a substitute.
- Merge/release/deploy remain human/out-of-scope authority.
- No secret, DB URL, control token, provider credential, raw stderr, or private model reasoning is journalled.
- A project-supplied verifier and the built-in Preview verifier may not both own the same run; ambiguous composition is refused.
- The host uses the exact `ModelRegistry` supplied by deployment configuration and never falls back to `DEFAULT_MODEL_REGISTRY` for a real product run.

---

### Task 1: Generalize the Workflow Database Capability Vocabulary

**Files:**
- Modify: `packages/core/engineering-workflow/src/types.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Test: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Test: `packages/core/engineering-workflow/tests/lifecycle.spec.ts`

**Interfaces:**
- Produces `WorkflowDatabaseVerificationInput`, `WorkflowDatabaseVerificationResult`, `DatabaseVerificationCapabilityPort`.
- `WorkflowCapabilities` exposes `databaseVerification?: DatabaseVerificationCapabilityPort`.
- Retain deprecated type aliases `WorkflowDatabasePreviewInput`, `WorkflowDatabasePreviewResult`, `DatabasePreviewCapabilityPort` only if needed to keep existing fork callers compiling during this change.

- [ ] **Step 1: Write RED type/runtime tests** proving a DB-changing lifecycle invokes `capabilities.databaseVerification.verify(...)`, blocks when that capability is absent, and records the same bounded evidence/verdict behavior that `databasePreview` currently provides.
- [ ] **Step 2: Run the focused tests and verify RED.**

```bash
corepack pnpm vitest run packages/core/engineering-workflow/tests/workflow.spec.ts packages/core/engineering-workflow/tests/lifecycle.spec.ts
```

- [ ] **Step 3: Rename the generic contracts** in `types.ts` and update the runner in `index.ts` so the workflow concept is database verification, not Preview Branching.

Required shape:

```ts
export interface WorkflowDatabaseVerificationInput {
  readonly stageId: string
  readonly objective: WorkflowObjective
}

export interface WorkflowDatabaseVerificationResult {
  readonly status: 'PASSED' | 'FAILED' | 'BLOCKED'
  readonly summary: string
  readonly evidence: readonly EvidenceRef[]
  readonly findings: readonly Finding[]
}

export interface DatabaseVerificationCapabilityPort {
  verify(
    input: WorkflowDatabaseVerificationInput,
    signal: AbortSignal,
  ): Promise<WorkflowDatabaseVerificationResult>
}

export interface WorkflowCapabilities {
  readonly delivery?: DeliveryCapabilityPort
  readonly databaseVerification?: DatabaseVerificationCapabilityPort
}
```

- [ ] **Step 4: Keep compatibility aliases only at the export boundary**, marked deprecated, and ensure no new runtime code reads `databasePreview`.
- [ ] **Step 5: Run focused tests GREEN, then `typecheck`.**

```bash
corepack pnpm vitest run packages/core/engineering-workflow/tests/workflow.spec.ts packages/core/engineering-workflow/tests/lifecycle.spec.ts
corepack pnpm run typecheck
```

- [ ] **Step 6: Commit.**

```bash
git add packages/core/engineering-workflow
git commit -m "refactor(trick): generalize database verification capability"
```

---

### Task 2: Let Composition Inject One Deterministic Database Verifier

**Files:**
- Modify: `packages/composition/runtime/src/harness.ts`
- Modify: `packages/composition/runtime/src/index.ts` if exports require it
- Test: `packages/composition/runtime/tests/harness.spec.ts`
- Test: `profiles/plurora/tests/composition.spec.ts`

**Interfaces:**

```ts
export interface HarnessProjectCapabilities {
  readonly databaseVerification?: DatabaseVerificationCapabilityPort
}

export interface HarnessCompositionOptions {
  // existing fields...
  readonly capabilities?: HarnessProjectCapabilities
}
```

- [ ] **Step 1: Write RED tests** for three cases: injected verifier is used for a DB-changing workflow; existing `integrations.supabase` still adapts to the same generic port; supplying both injected verification and built-in Preview config is rejected as ambiguous authority.
- [ ] **Step 2: Verify RED.**

```bash
corepack pnpm vitest run packages/composition/runtime/tests/harness.spec.ts profiles/plurora/tests/composition.spec.ts
```

- [ ] **Step 3: Implement the composition rule:**

```text
capabilities.databaseVerification present AND integrations.supabase present
=> BundleCompositionError

capabilities.databaseVerification present
=> use it

else integrations.supabase present
=> adapt SupabasePreview to DatabaseVerificationCapabilityPort

else
=> no DB verification capability
```

- [ ] **Step 4: Preserve the existing `supabase-preview` authorization checks** for the built-in integration; project capability injection is authorized separately by the profile capability id added in Task 3.
- [ ] **Step 5: Run GREEN + constraints/typecheck.**

```bash
corepack pnpm vitest run packages/composition/runtime/tests/harness.spec.ts profiles/plurora/tests/composition.spec.ts
corepack pnpm run constraints
corepack pnpm run typecheck
```

- [ ] **Step 6: Commit.**

```bash
git add packages/composition profiles/plurora/tests/composition.spec.ts
git commit -m "feat(trick): inject project database verification capability"
```

---

### Task 3: Amend the Plurora Integration Policy Without Embedding the DB Target

**Files:**
- Modify: `profiles/plurora/integrations.ts`
- Modify: `profiles/plurora/tests/profile.spec.ts`
- Modify: `profiles/plurora/tests/composition.spec.ts`

**Interfaces:**
- Add canonical capability id `database-verification` to Plurora's enabled integration/capability vocabulary.
- Do **not** add `neurovia-dev` or `uljaajwwnygopsyvwsre` to the profile.

- [ ] **Step 1: Write RED profile tests** proving Plurora authorizes deterministic database verification but generic profile data contains no project ref or database name.
- [ ] **Step 2: Update the profile data** so `github-delivery`, `control-server`, and `database-verification` are enabled. Keep `supabase-preview` only if the built-in optional strategy still needs profile authorization; it is not the active Plurora deployment strategy.
- [ ] **Step 3: Run profile/composition tests GREEN.**

```bash
corepack pnpm vitest run profiles/plurora/tests/profile.spec.ts profiles/plurora/tests/composition.spec.ts
```

- [ ] **Step 4: Run the project-identifier boundary scan** and confirm neither `neurovia-dev` nor `uljaajwwnygopsyvwsre` appears in generic packages/profile policy.

```bash
corepack pnpm run constraints
```

- [ ] **Step 5: Commit.**

```bash
git add profiles/plurora
git commit -m "feat(trick): authorize Plurora database verification capability"
```

---

### Task 4: Create the Private Plurora Runtime Host Application

**Files:**
- Create: `apps/plurora-harness-host/package.json`
- Create: `apps/plurora-harness-host/tsconfig.json`
- Create: `apps/plurora-harness-host/src/config.ts`
- Create: `apps/plurora-harness-host/src/model-registry.ts`
- Create: `apps/plurora-harness-host/src/project-database.ts`
- Create: `apps/plurora-harness-host/src/main.ts`
- Create: `apps/plurora-harness-host/tests/config.spec.ts`
- Create: `apps/plurora-harness-host/tests/model-registry.spec.ts`
- Create: `apps/plurora-harness-host/tests/project-database.spec.ts`
- Create: `apps/plurora-harness-host/tests/host.spec.ts`
- Modify: root build/test config only where `apps/*` convention requires registration.

**Interfaces:**

```ts
export interface PluroraDeploymentConfig {
  readonly repository: 'adsonpatrick/trick-harness'
  readonly revision: string
  readonly profile: 'plurora'
  readonly policyVersion: string
  readonly controlServerUrl: string
  readonly environment: 'development'
  readonly database: {
    readonly strategy: 'shared-cloud-development'
    readonly projectRef: string
  }
  readonly modelRegistry: Readonly<Record<string, string>>
}

export async function startPluroraHost(options: {
  projectRoot: string
  controlToken: string
  signal: AbortSignal
}): Promise<{ dispose(): Promise<void> }>
```

- [ ] **Step 1: Add RED config tests** requiring exact repository/profile, exact 40-hex revision, loopback URL, `environment=development`, `database.strategy=shared-cloud-development`, non-empty project ref, and exactly the semantic tiers used by `profiles/plurora`.
- [ ] **Step 2: Add secret-key rejection tests** for any committed config key matching `token|secret|password|api[_-]?key|connection|dbUrl` case-insensitively.
- [ ] **Step 3: Implement config parsing** from `<projectRoot>/plurora-harness.json`; do not accept routing rules or permission modes there.
- [ ] **Step 4: Create `package.json` as private** with workspace dependencies on composition/profile/providers/subprocess/session packages and scripts `build`, `test`, `start` following existing app conventions.
- [ ] **Step 5: Run config tests GREEN and commit the host skeleton.**

```bash
corepack pnpm --filter @trick-harness/plurora-host test
```

```bash
git add apps/plurora-harness-host
git commit -m "feat(trick): add Plurora runtime host skeleton"
```

---

### Task 5: Validate Product-Native Model IDs Before Host Readiness

**Files:**
- Modify: `apps/plurora-harness-host/src/model-registry.ts`
- Modify: `apps/plurora-harness-host/src/main.ts`
- Test: `apps/plurora-harness-host/tests/model-registry.spec.ts`
- Test: `apps/plurora-harness-host/tests/host.spec.ts`
- Modify only if needed: `packages/providers/codex` app-server wire to expose a read-only `model/list` query already supported by the pinned app-server protocol.

**Interfaces:**

```ts
export interface ModelCatalogReader {
  opencodeModels(): Promise<readonly string[]>
  codexModels(): Promise<readonly { id: string; reasoningEfforts: readonly string[] }[]>
}

export function validateDeploymentRegistry(
  registry: Readonly<Record<string, string>>,
  requiredTiers: readonly string[],
  catalogs: { opencode: readonly string[]; codex: readonly string[] },
): void
```

- [ ] **Step 1: Generate/read the pinned Codex app-server schema** and confirm `model/list` exists before adding any wire method; the current upstream protocol exposes `model/list`, but the implementation must follow the pinned package schema rather than main-branch memory.
- [ ] **Step 2: Write RED tests** for missing tier, duplicate/empty id, OpenCode pair not advertised by the authenticated provider catalogue, and Codex id absent from app-server `model/list`.
- [ ] **Step 3: Implement OpenCode catalogue discovery** through the official SDK/server provider configuration endpoint used by the pinned SDK; normalize to `provider/model` ids.
- [ ] **Step 4: Implement Codex catalogue discovery** as a read-only app-server `model/list` call. It must not create a model turn, consume a task run, rewrite `CODEX_HOME`, or inject `OPENAI_API_KEY`.
- [ ] **Step 5: Make host startup validate every semantic tier referenced by `profiles/plurora` before the control server reports ready.** `DEFAULT_MODEL_REGISTRY` is never substituted.
- [ ] **Step 6: Run tests GREEN plus provider focused suites.**

```bash
corepack pnpm --filter @trick-harness/plurora-host test
corepack pnpm vitest run packages/providers/codex/tests/codex.spec.ts profiles/plurora/tests/routing.spec.ts
```

- [ ] **Step 7: Commit.**

```bash
git add apps/plurora-harness-host packages/providers/codex
git commit -m "feat(trick): validate deployment model registry"
```

---

### Task 6: Adapt the Fixed NeuroVia DB Verification Command as a Capability

**Files:**
- Modify: `apps/plurora-harness-host/src/project-database.ts`
- Modify: `apps/plurora-harness-host/src/main.ts`
- Test: `apps/plurora-harness-host/tests/project-database.spec.ts`
- Test: `apps/plurora-harness-host/tests/host.spec.ts`

**Interface contract with Plan C:**

The host executes only this project command in the supplied `projectRoot`:

```text
npm run db:verify:harness -- --json
```

The command exits non-zero on `FAILED`/`BLOCKED` and emits exactly one bounded JSON object on stdout:

```ts
interface ProjectDatabaseVerificationEnvelope {
  readonly schemaVersion: 1
  readonly status: 'PASSED' | 'FAILED' | 'BLOCKED'
  readonly targetProjectRef: string
  readonly summary: string
  readonly evidence: readonly {
    readonly kind: 'gate' | 'test'
    readonly locator: string
    readonly summary: string
  }[]
}
```

- [ ] **Step 1: Write RED tests** proving the adapter uses argv arrays/no shell, fixed command only, project cwd only, bounded output, schemaVersion=1, target ref equality with deployment config, and rejects malformed/multi-object/raw-secret output.
- [ ] **Step 2: Implement the adapter** with DSH managed subprocess ownership, `waitForExit()` quiescence, cancellation, and safe failure taxonomy.
- [ ] **Step 3: Map the envelope to `DatabaseVerificationCapabilityPort` evidence**; do not pass raw stdout to journal/status.
- [ ] **Step 4: Wire it into `composeHarness({ capabilities: { databaseVerification } })`.**
- [ ] **Step 5: Run tests GREEN.**

```bash
corepack pnpm --filter @trick-harness/plurora-host test
```

- [ ] **Step 6: Commit.**

```bash
git add apps/plurora-harness-host
git commit -m "feat(trick): adapt project cloud database verification"
```

---

### Task 7: Wire the Plurora Host Lifecycle and Control Server

**Files:**
- Modify: `apps/plurora-harness-host/src/main.ts`
- Test: `apps/plurora-harness-host/tests/host.spec.ts`
- Test: `profiles/plurora/tests/composition.spec.ts`

**Host behavior:**

```text
load project config
-> verify config/profile/policy version
-> validate model registry against native catalogues
-> create durable Session + flush implementation
-> register OpenCode/Codex providers
-> register GitHubDelivery
-> register injected project database verifier
-> compose profile=plurora
-> bind configured loopback control address using supplied token
-> ready
```

- [ ] **Step 1: Write RED host tests** proving no socket is advertised before model/config validation, wrong profile/policyVersion fails before side effects, and disposal waits for control-server + providers + DB subprocess quiescence.
- [ ] **Step 2: Implement a durable session store** using the DSH session persistence mechanism already approved by the Harness; do not substitute an in-memory-only flush in the runnable host.
- [ ] **Step 3: Implement workflow handlers** using the approved Plurora PR lifecycle and bounded task/interpret contracts; they may interpret provider results but never grant deterministic mutation authority to the provider.
- [ ] **Step 4: Bind the existing control server** to the configured loopback address and the caller-supplied process token.
- [ ] **Step 5: Run the host integration suite GREEN.**

```bash
corepack pnpm --filter @trick-harness/plurora-host test
corepack pnpm run test:trick
```

- [ ] **Step 6: Commit.**

```bash
git add apps/plurora-harness-host profiles/plurora
git commit -m "feat(trick): run the Plurora Harness host"
```

---

### Task 8: Verification, Documentation and Known-Good SHA

**Files:**
- Modify: `README.trick-harness.md`
- Modify: `docs/verification/2026-08-27-harness-v2-plan-d-evidence.md` by append-only follow-up section or create a dated follow-up evidence file
- Create: `docs/verification/2026-08-27-neurovia-deployment-enablement-evidence.md`

- [ ] **Step 1: Run deterministic gates.**

```bash
corepack pnpm run constraints
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run build
corepack pnpm run test:trick
corepack pnpm --filter @trick-harness/plurora-host test
```

- [ ] **Step 2: Run a real OpenCode/Codex model-catalog startup smoke** using native authenticated product stores and prove no global config/auth file content or mtime changed.
- [ ] **Step 3: Run a host HTTP smoke** with a non-DB read-only objective: health -> start -> status -> cancel/dispose, and prove process-tree quiescence.
- [ ] **Step 4: Do not fake the NeuroVia DB canary in this repository.** Record `PENDING PLAN C` until the project command exists in `neuro-via`.
- [ ] **Step 5: Update README** with the correct semantic-tier registry shape and the runnable host command; keep claims limited to evidence actually run.
- [ ] **Step 6: Independent review** the diff for routing, authority, secret handling, subprocess quiescence, profile boundary and host dependency direction. Fix confirmed bugs, then rerun affected gates.
- [ ] **Step 7: Record the exact reviewed 40-hex SHA** as the only SHA Plan C may pin initially.
- [ ] **Step 8: Commit evidence/docs.**

```bash
git add README.trick-harness.md docs/verification
git commit -m "docs(trick): verify NeuroVia deployment enablement"
```

## Completion Contract

This plan is complete when the generic workflow can consume a project-supplied deterministic database verifier, the existing Supabase Preview integration remains green, the Plurora profile authorizes database verification without embedding NeuroVia identifiers, the runnable host executes inside the Trick Harness workspace, every configured semantic tier is validated against the native authenticated product catalogues, the host can reach only the fixed project DB verification command, deterministic gates pass, and a reviewed exact SHA is recorded for Plan C.
