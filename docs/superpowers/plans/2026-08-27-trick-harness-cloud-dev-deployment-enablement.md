# Trick Harness Cloud-Dev & Plurora Host Enablement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the runtime capabilities required before NeuroVia installs Harness V2: a generic deterministic database-verification seam, a project-supplied verifier path, and a runnable Plurora host inside the pinned Trick Harness checkout.

**Architecture:** Preserve the built-in `supabase-preview` integration, but make the engineering workflow consume a generic database-verification port. Composition accepts either the built-in Preview adapter or one explicitly injected project verifier and rejects dual authority. A private `apps/plurora-harness-host` application sits above `profiles/plurora`, validates product-native model ids, composes the real providers/integrations, adapts NeuroVia's fixed DB verification command, and exposes the existing loopback control server.

**Tech Stack:** TypeScript, Node.js `^22.19.0 || >=24.0.0`, pnpm `11.7.0`, existing `@trick-harness/*` workspaces, DSH subprocess/session packages, OpenCode SDK, Codex app-server, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-27-neurovia-harness-deployment-cloud-dev-amendment.md`

## Global Constraints

- Generic Core/providers/integrations/composition contain no NeuroVia database name/project ref or product-repository assumption.
- `profiles/plurora` owns project policy; `apps/plurora-harness-host` is explicitly Plurora deployment glue and may depend on that profile.
- Existing `supabase-preview` remains buildable/tested as an optional strategy.
- Project DB mutation is a deterministic capability; no model executor receives shell authority as a substitute.
- A project verifier and built-in Preview verifier cannot both own one composition.
- No credential, DB URL, control token, raw stderr or private model reasoning is journalled.
- Merge/release/deploy remain human-controlled.
- Real deployments use their supplied `ModelRegistry`; `DEFAULT_MODEL_REGISTRY` is never substituted.

---

### Task 1: Generalize the Workflow Database Capability

**Files:**
- Modify: `packages/core/engineering-workflow/src/types.ts`
- Modify: `packages/core/engineering-workflow/src/index.ts`
- Test: `packages/core/engineering-workflow/tests/workflow.spec.ts`
- Test: `packages/core/engineering-workflow/tests/lifecycle.spec.ts`

**Interfaces:**

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

Retain deprecated aliases `WorkflowDatabasePreviewInput`, `WorkflowDatabasePreviewResult` and `DatabasePreviewCapabilityPort` for one compatibility cycle, each pointing to the new generic type. New runtime code must use only `databaseVerification`.

- [ ] Write RED tests proving DB-changing lifecycle calls `databaseVerification.verify`, blocks if it is absent, and preserves bounded DB evidence/verdict semantics.
- [ ] Run RED:

```bash
corepack pnpm vitest run packages/core/engineering-workflow/tests/workflow.spec.ts packages/core/engineering-workflow/tests/lifecycle.spec.ts
```

- [ ] Implement the types/runner rename and compatibility aliases.
- [ ] Run GREEN + typecheck:

```bash
corepack pnpm vitest run packages/core/engineering-workflow/tests/workflow.spec.ts packages/core/engineering-workflow/tests/lifecycle.spec.ts
corepack pnpm run typecheck
```

- [ ] Commit:

```bash
git add packages/core/engineering-workflow
git commit -m "refactor(trick): generalize database verification capability"
```

---

### Task 2: Inject One Project Database Verifier Through Composition

**Files:**
- Modify: `packages/composition/runtime/src/harness.ts`
- Test: `packages/composition/runtime/tests/harness.spec.ts`
- Test: `profiles/plurora/tests/composition.spec.ts`

**Interface:**

```ts
export interface HarnessProjectCapabilities {
  readonly databaseVerification?: DatabaseVerificationCapabilityPort
}

export interface HarnessCompositionOptions {
  // existing fields unchanged
  readonly capabilities?: HarnessProjectCapabilities
}
```

`packages/composition/runtime/src/index.ts` already re-exports `./harness.ts`; no new export file is required.

- [ ] Write RED tests for injected verifier, built-in Preview adapter, and ambiguous dual verifier refusal.
- [ ] Run RED:

```bash
corepack pnpm vitest run packages/composition/runtime/tests/harness.spec.ts profiles/plurora/tests/composition.spec.ts
```

- [ ] Implement exactly:

```text
capabilities.databaseVerification + integrations.supabase => BundleCompositionError
capabilities.databaseVerification only                    => use injected port
integrations.supabase only                                => adapt SupabasePreview to generic port
neither                                                   => no database verification port
```

- [ ] Preserve the existing built-in `supabase-preview` authorization boundary.
- [ ] Run GREEN + constraints/typecheck:

```bash
corepack pnpm vitest run packages/composition/runtime/tests/harness.spec.ts profiles/plurora/tests/composition.spec.ts
corepack pnpm run constraints
corepack pnpm run typecheck
```

- [ ] Commit:

```bash
git add packages/composition/runtime profiles/plurora/tests/composition.spec.ts
git commit -m "feat(trick): inject project database verification capability"
```

---

### Task 3: Authorize Generic DB Verification in the Plurora Profile

**Files:**
- Modify: `profiles/plurora/integrations.ts`
- Modify: `profiles/plurora/tests/profile.spec.ts`
- Modify: `profiles/plurora/tests/composition.spec.ts`

- [ ] Write RED tests requiring `database-verification` in Plurora's enabled capability vocabulary and forbidding `neurovia-dev`/`uljaajwwnygopsyvwsre` anywhere in profile data.
- [ ] Enable `github-delivery`, `control-server`, `database-verification` and retain `supabase-preview` as an optional built-in strategy capability; the active deployment chooses only one verifier at composition time.
- [ ] Run:

```bash
corepack pnpm vitest run profiles/plurora/tests/profile.spec.ts profiles/plurora/tests/composition.spec.ts
corepack pnpm run constraints
```

- [ ] Commit:

```bash
git add profiles/plurora
git commit -m "feat(trick): authorize Plurora database verification capability"
```

---

### Task 4: Create the Private Plurora Host App

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
- Modify: root `package.json` (`test:trick` must include `apps/plurora-harness-host`)

**Interface:**

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

- [ ] Write RED config tests requiring exact repository/profile, 40-hex revision, loopback URL, development/shared-cloud strategy, non-empty project ref and the exact semantic tiers referenced by the Plurora routing policy.
- [ ] Add recursive secret-key rejection for `token|secret|password|api[_-]?key|connection|dbUrl`.
- [ ] Implement `<projectRoot>/plurora-harness.json` parsing. Reject routing rules, permission modes and provider credentials in that file.
- [ ] Create private package `@trick-harness/plurora-host` with workspace dependencies on composition/profile/providers/subprocess/session packages.
- [ ] Add `apps/plurora-harness-host` to root `test:trick`.
- [ ] Run:

```bash
corepack pnpm --filter @trick-harness/plurora-host test
corepack pnpm run typecheck
```

- [ ] Commit:

```bash
git add apps/plurora-harness-host package.json
git commit -m "feat(trick): add Plurora runtime host skeleton"
```

---

### Task 5: Validate Native OpenCode and Codex Model Catalogues

**Files:**
- Modify: `apps/plurora-harness-host/src/model-registry.ts`
- Modify: `apps/plurora-harness-host/src/main.ts`
- Modify: `packages/subagent/subagent-codex/src/wire.ts`
- Modify: `packages/subagent/subagent-codex/src/index.ts`
- Test: `apps/plurora-harness-host/tests/model-registry.spec.ts`
- Test: `apps/plurora-harness-host/tests/host.spec.ts`
- Test: `packages/subagent/subagent-codex/tests/subagent-codex.spec.ts`
- Test: `packages/subagent/subagent-codex/tests/real-product.spec.ts`

**Interface:**

```ts
export interface ModelCatalogReader {
  opencodeModels(): Promise<readonly string[]>
  codexModels(): Promise<readonly { id: string; reasoningEfforts: readonly string[] }[]>
}
```

- [x] Generate/read the **pinned** `@openai/codex` app-server JSON schema and add a read-only `model/list` wire method matching that schema. Do not code from upstream-main types alone.
- [x] Write RED tests for missing tier, empty id, OpenCode pair absent from authenticated catalogue, and Codex id absent from `model/list`.
- [x] Implement OpenCode catalogue discovery through the official SDK/server provider configuration endpoint and normalize to `provider/model` ids.
- [x] Implement Codex `model/list` discovery without starting a model turn, rewriting Codex config/auth, or injecting `OPENAI_API_KEY`.
- [x] Make host readiness fail until every semantic tier used by `profiles/plurora` resolves in the relevant native catalogue.
- [x] Run:

```bash
corepack pnpm --filter @trick-harness/plurora-host test
corepack pnpm vitest run packages/subagent/subagent-codex/tests/subagent-codex.spec.ts packages/subagent/subagent-codex/tests/real-product.spec.ts profiles/plurora/tests/routing.spec.ts
```

- [x] Commit:

```bash
git add apps/plurora-harness-host packages/subagent/subagent-codex
git commit -m "feat(trick): validate deployment model registry"
```

---

### Task 6: Adapt NeuroVia's Fixed DB Command

**Files:**
- Modify: `apps/plurora-harness-host/src/project-database.ts`
- Modify: `apps/plurora-harness-host/src/main.ts`
- Test: `apps/plurora-harness-host/tests/project-database.spec.ts`
- Test: `apps/plurora-harness-host/tests/host.spec.ts`

**Fixed child command:**

```text
npm run db:verify:harness -- --json
```

**Envelope:**

```ts
export interface ProjectDatabaseVerificationEnvelope {
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

- [x] Write RED tests proving argv-array/no-shell execution, fixed command only, project cwd only, bounded single JSON envelope, configured project-ref equality and secret/raw-output rejection.
- [x] Implement with DSH managed subprocess ownership, cancellation and `waitForExit()` quiescence.
- [x] Map only validated envelope fields into `DatabaseVerificationCapabilityPort`; raw stdout/stderr never reaches journal/status.
- [x] Wire through `composeHarness({ capabilities: { databaseVerification } })`.
- [x] Run host tests and commit.

---

### Task 7: Complete Host Lifecycle and Durable Runtime

**Files:**
- Modify: `apps/plurora-harness-host/src/main.ts`
- Create: `apps/plurora-harness-host/src/session-store.ts`
- Create: `apps/plurora-harness-host/src/workflow-handlers.ts`
- Test: `apps/plurora-harness-host/tests/host.spec.ts`
- Test: `profiles/plurora/tests/composition.spec.ts`

**Startup sequence:**

```text
load config
-> validate profile/policy version
-> validate native model catalogues
-> create durable Session/flush
-> register OpenCode/Codex
-> bind GitHubDelivery
-> bind injected project DB verifier
-> compose profile=plurora
-> start loopback control server with supplied token
-> ready
```

- [x] Write RED tests proving no readiness before config/model validation, profile mismatch fails before side effects, and disposal waits for control/server/provider/DB subprocess quiescence.
- [x] Implement durable session persistence using the DSH session persistence package already used by the fork; no in-memory-only runnable host.
- [x] Implement workflow handlers using the approved Plurora PR lifecycle; handlers may interpret provider results but cannot perform GitHub/DB mutation directly.
- [x] Bind the existing control server to configured loopback address and caller-supplied process token.
- [x] Run:

```bash
corepack pnpm --filter @trick-harness/plurora-host test
corepack pnpm run test:trick
```

- [x] Commit.

---

### Task 8: Independent Verification and Known-Good SHA

**Files:**
- Modify: `README.trick-harness.md`
- Create: `docs/verification/2026-08-27-neurovia-deployment-enablement-evidence.md`

- [x] Run deterministic gates:

```bash
corepack pnpm run constraints
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run build
corepack pnpm run test:trick
corepack pnpm --filter @trick-harness/plurora-host test
```

- [x] Run real authenticated OpenCode + Codex catalogue startup against a throwaway copy of the real
      credential directory (`CODEX_HOME` pointed at a temporary copy of `~/.codex`, likewise for OpenCode),
      and prove the copy's config and auth files are byte-identical before and after the run. The real
      home directory is never on the path the run can write to, which is the property this gate is for.
      Content equality is the assertion; mtime is not, because `auth_mode: chatgpt` rewrites `auth.json`
      on every token refresh, making an mtime assertion fail for a reason that has nothing to do with us.
- [x] Run host HTTP smoke: health -> start read-only workflow -> status -> cancel/dispose; prove whole process-tree quiescence.
- [x] Record the NeuroVia DB canary as `PENDING PLAN C`; do not simulate a project command that does not exist yet.
- [x] Update README only with behavior actually implemented/proven.
- [x] Perform independent review of authority, secret handling, host dependency direction, model validation and subprocess lifecycle. Fix confirmed bugs and rerun affected gates.
- [x] Record the final reviewed exact 40-hex SHA as the only initial SHA Plan C* may pin.
- [x] Commit evidence/docs.

## Completion Contract

Complete only when the generic workflow uses `databaseVerification`, existing Preview tests remain green, Plurora authorizes generic verification without embedding NeuroVia identifiers, the runnable host executes inside the Trick workspace, every Plurora semantic tier is validated against native authenticated catalogues, the host can execute only the fixed project DB verification command, deterministic/real-product gates pass, and a reviewed exact SHA is recorded for the NeuroVia installation.
