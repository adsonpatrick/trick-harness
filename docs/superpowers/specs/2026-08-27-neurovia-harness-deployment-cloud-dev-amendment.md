# Plurora Harness V2 — NeuroVia Deployment & Cloud Development Database Amendment

- **Date:** 2026-08-27
- **Status:** APPROVED — owner decision 2026-08-27
- **Amends:** `2026-08-25-plurora-engineering-harness-v2-design.md`, `2026-08-25-plurora-engineering-harness-v2-reusable-core-amendment.md`, `2026-08-27-harness-v2-scope-amendment.md`, and Plan C (`2026-08-25-plurora-harness-v2-neuro-via-integration.md`)
- **Scope:** NeuroVia deployment topology, product-native model registry resolution, and the canonical Supabase Cloud development database authority

## 1. Decision summary

The Plurora deployment will use `neurovia-dev` as its canonical Supabase Cloud development database. Its current project ref is `uljaajwwnygopsyvwsre`. A database-changing development workflow may apply and validate versioned migrations against that project when the workflow passes the deterministic database authority gates in this amendment. Supabase Preview Branches remain supported as an optional future isolation strategy, but they are not a prerequisite for development execution and their absence is not a reason to block a workflow that is otherwise authorized to use `neurovia-dev`.

The deployment will also gain an explicit runtime host. `neuro-via` will not import the private `@trick-harness/*` workspace packages as npm dependencies. A runnable Plurora host lives in the exact-SHA Trick Harness checkout and exposes the existing loopback control server. `neuro-via` verifies the checkout, starts/stops that host, and talks to it only through the bounded HTTP bridge.

The model registry is deployment configuration, not project routing policy. `profiles/plurora` continues to decide semantic tiers and routing; the deployment maps every semantic tier used by that profile to a product-native model id that the authenticated OpenCode/Codex installations actually accept.

## 2. Canonical environment topology

```text
Developer / OpenCode TUI
        |
        | harness_run / harness_status / harness_cancel
        v
neuro-via project bridge
        |
        | loopback HTTP + process-local bearer
        v
Pinned Trick Harness checkout
        |
        +-- Plurora runtime host
        |     +-- profile=plurora
        |     +-- deployment model registry
        |     +-- OpenCode provider
        |     +-- Codex provider
        |     +-- GitHubDelivery
        |     +-- project database-verification capability
        |
        +--------------------------------------+
                                               |
                                    Supabase Cloud development
                                    neurovia-dev
                                    ref uljaajwwnygopsyvwsre
```

Future production is a separate authority boundary:

```text
neurovia-dev   -> development / Harness validation authority
neurovia-prod  -> future production authority; no automatic Harness deployment authority
```

Creating `neurovia-prod` later does not implicitly grant any existing Harness workflow permission to mutate it. Production migration/deploy policy requires a separate approved design and explicit authority.

## 3. Database authority

### 3.1 `neurovia-dev` is an authorized target, not a fallback

The old rule prohibited a shared development target when Preview Branch creation was unavailable. That rule is superseded for the Plurora development deployment.

The new rule is deterministic:

```text
environment = development
configuredDatabaseTarget = neurovia-dev
configuredProjectRef = uljaajwwnygopsyvwsre
=> neurovia-dev is the only remote database a development DB workflow may mutate
```

There is no runtime sequence `preview failed -> try neurovia-dev`. Preview isolation and shared development are distinct configured strategies. The Plurora deployment currently selects the shared-development strategy explicitly.

### 3.2 Cloud-only remains binding

The following remain prohibited as canonical verification paths:

- `supabase start`;
- `supabase db reset --local`;
- `supabase test db --local`;
- local Docker/Postgres or a Docker shadow database;
- an arbitrary linked Supabase project;
- production as a development fallback;
- Dashboard/SQL-editor changes that replace migration-file history.

Migration files under `supabase/migrations` remain the schema authority.

### 3.3 Shared-development safety gates

Every database-mutating workflow targeting `neurovia-dev` must execute this state machine:

```text
identify configured target
-> verify project ref == uljaajwwnygopsyvwsre
-> acquire exclusive DB mutation lock
-> reconcile repository migration history with remote migration history
-> refuse unexplained drift
-> apply pending migration files through the supported Supabase remote migration path
-> re-read remote migration history
-> remote lint
-> pgTAP
-> RLS allow assertions
-> RLS deny assertions
-> applicable integration/security checks
-> durable evidence
-> release DB mutation lock
```

A failed prerequisite skips dependent gates. The lock is released in cleanup even on failure. Failure to establish target identity, lock ownership, migration-history compatibility, credentials, or any mandatory verification returns `BLOCKED` or `FAILED` as appropriate; it never selects another database.

### 3.4 Concurrency

Only one database-mutating Harness workflow may operate on `neurovia-dev` at a time. Code-only workflows may continue concurrently. The lock must be effective across separate local Harness processes, not only within one JavaScript object, because two VS Code windows or terminals may start independent hosts.

The durable record names the workflow id, target project ref, migration versions observed/applied, gate outcomes, and lock lifecycle. It records no DB URL, password, access token, raw SQL output containing secrets, or private model reasoning.

### 3.5 No automatic migration repair

Unexpected migration history is an investigation boundary. The Harness may not automatically execute `supabase migration repair`, rewrite already-applied migration files, or invent a migration to reconcile drift. Unexplained drift is `BLOCKED` and must be reviewed by a human.

## 4. Generic database-verification seam

The core workflow concept is broader than Preview Branches. The existing `DatabasePreviewCapabilityPort`/`databasePreview` naming is superseded by a generic database-verification capability that reports bounded evidence and owns deterministic database mutation/verification.

The generic seam must not know `neurovia-dev`, Supabase Preview Branches, Plurora, or any project ref. It expresses only that a declared database change requires a deterministic verifier before publication.

A compatibility alias may be retained temporarily to avoid an unnecessary one-shot migration of every caller, but new composition code and the Plurora host use the generic naming.

The built-in `supabase-preview` integration remains available for projects that choose Preview Branches. Plurora's current deployment uses a project database-verification adapter that executes the reviewed `neuro-via` cloud-development verification command against the pinned target.

## 5. Runtime host ownership

### 5.1 Host belongs with the pinned runtime checkout

`@trick-harness/*` packages are private workspace packages. The canonical installation must not depend on `file:../trick-harness/...` package references or require publishing those packages to npm.

A runnable Plurora host therefore lives in the Trick Harness repository, above the reusable mechanism/profile layers. It may import the private workspaces because it executes inside the same pnpm workspace. It accepts a `neuro-via` project root and reads only the bounded non-secret deployment configuration defined by Plan C.

Dependency direction becomes:

```text
core <- providers/integrations <- composition <- profiles <- Plurora host <- neuro-via bridge
```

The host is project deployment glue. It may depend on `profiles/plurora`; generic Core/providers/integrations still may not.

### 5.2 NeuroVia launcher responsibilities

The `neuro-via` launcher:

1. resolves `TRICK_HARNESS_HOME` from process environment or an explicitly documented local default;
2. verifies the checkout remote identifies `adsonpatrick/trick-harness`;
3. verifies `HEAD` equals the exact 40-hex revision committed in `plurora-harness.json`;
4. refuses a dirty or wrong-revision runtime checkout for normal operation;
5. starts the Plurora host with `neuro-via` as the project root;
6. obtains the process-local control token without writing it to the repository;
7. waits for loopback `/health` before returning ready;
8. shuts the host down and waits for quiescence.

The OpenCode custom tools remain clients. They never gain shell, git delivery, Supabase mutation, merge, release, or deploy authority.

## 6. Deployment model registry

### 6.1 Semantic tiers remain policy

`profiles/plurora/routing-policy.ts` continues to select semantic tiers such as:

- `codex.fast`;
- `codex.balanced`;
- `codex.frontier`;
- `opencode.reasoning-fast`;
- `opencode.workhorse`.

No model id is duplicated into routing rules in `neuro-via`.

### 6.2 Native model ids are deployment data

The deployment supplies a complete `ModelRegistry` keyed by semantic tier. For example, structurally:

```json
{
  "codex.fast": "<supported-codex-model-id>",
  "codex.balanced": "<supported-codex-model-id>",
  "codex.frontier": "<supported-codex-model-id>",
  "opencode.reasoning-fast": "<authenticated-provider>/<supported-model-id>",
  "opencode.workhorse": "<authenticated-provider>/<supported-model-id>"
}
```

The angle-bracket values above describe the schema only; the committed installation config must contain actual non-secret ids discovered from the products in use.

For OpenCode, bootstrap queries the authenticated server/provider catalogue and refuses a configured pair that is not advertised. For Codex, bootstrap validates each configured model through the provider's supported native path without rewriting global Codex configuration. A missing semantic tier is a startup error, not a silent fallback to `DEFAULT_MODEL_REGISTRY`, because `DEFAULT_MODEL_REGISTRY` contains human/product names rather than guaranteed provider-native ids.

Per-run overrides continue to reference semantic tiers and never rewrite the registry or global product config.

## 7. Configuration ownership

`neuro-via/plurora-harness.json` is non-secret deployment metadata and owns:

- repository: `adsonpatrick/trick-harness`;
- exact runtime revision;
- profile: `plurora`;
- policy version;
- loopback control-server URL;
- environment: `development`;
- database strategy: `shared-cloud-development`;
- database project ref: `uljaajwwnygopsyvwsre`;
- complete semantic-tier -> native-model-id registry.

Credentials remain in native product stores or runtime environment only. The config must reject keys matching secret/token/password/connection-string classes.

## 8. Superseded statements

For the Plurora deployment, the following statements in older Specs/Plans are superseded:

- "all DB-changing workflows require an isolated Supabase Preview Branch";
- "shared `neurovia-dev` is never an allowed target";
- "Preview Branch entitlement absence blocks every development schema workflow";
- "the `neuro-via` bridge is sufficient without defining who hosts `composeHarness()`";
- examples that map registry keys such as `implementation`/`reasoning` instead of the semantic tier names consumed by the router.

The previous 2026-08-27 amendment remains authoritative for Claude Code removal and for the historical fact that the positive Preview Branch path was not proven. This amendment changes the Plurora development execution strategy; it does not retroactively claim a Preview canary passed.

## 9. Acceptance criteria

- **ND1:** `neurovia-dev` (`uljaajwwnygopsyvwsre`) is the only configured development DB mutation target.
- **ND2:** a wrong/unknown project ref blocks before migration mutation.
- **ND3:** two DB-mutating local workflows cannot concurrently own the shared-dev DB lock.
- **ND4:** unexplained local/remote migration-history drift blocks and never auto-repairs.
- **ND5:** successful DB verification proves remote migration history, lint, pgTAP, RLS allow and RLS deny evidence.
- **ND6:** no canonical path starts local Supabase/Docker/Postgres.
- **ND7:** production is not reachable through the development database capability.
- **ND8:** the runnable Plurora host executes from the exact pinned Trick Harness checkout; `neuro-via` imports no private Trick workspace package.
- **ND9:** every semantic tier used by `profiles/plurora` resolves to a product-native model id accepted by the authenticated product before the host reports ready.
- **ND10:** OpenCode can start/status/cancel a real workflow through the NeuroVia bridge and the loopback host without gaining direct delivery/DB authority.
- **ND11:** runtime shutdown waits for executor/control-server/database-capability quiescence and leaves no owned child process.
- **ND12:** the final activation record pins the post-amendment Trick Harness SHA and records that shared cloud development, not Preview Branching, is the active Plurora DB strategy.

## 10. Rollout consequence

Plan C may proceed only after the small Trick Harness enablement required by this amendment is implemented and independently verified. Plan C then installs the client/launcher/project DB command in `neuro-via`, pins the resulting known-good Trick Harness SHA, and runs fresh end-to-end bridge evidence. Plan D Tasks 11/12 remain the final reconciliation/activation gate.
