# Harness V2 Change Impact, Risk & Policy Enforcement Amendment

**Status:** Approved design direction from the 2026-08-28 end-to-end SDLC audit; this amendment is the normative source for Plan G.

## Problem

Harness V2 currently carries `risk`, `workload`, `taskClass`, `writeVolume`, `requiredCapabilities`, QA policy and security policy as separate concepts, but the runtime does not yet derive them from one trusted view of what the change actually touches.

Three failure modes follow:

1. `WorkflowObjective.risk` can be lower than the risk implied by the files/surfaces being changed, so a correct risk-driven lifecycle may omit QA or Security for a sensitive change.
2. `profiles/plurora/qa-policy.ts` and `security-policy.ts` declare surface-specific requirements, but the current PR stage planner primarily selects QA/Security from `objective.risk` rather than resolving those policies from the changed surfaces.
3. `RoutingContext` supports `taskClass`, `writeVolume` and `requiredCapabilities`, but the runner currently leaves `requiredCapabilities` empty, does not hydrate `taskClass` from change evidence, and derives write volume almost entirely from role.

The result is policy that is reviewable but not fully enforceable. Plan G makes change impact a deterministic input to routing, lifecycle and evidence requirements.

## Binding decisions

### 1. Planned and actual impact are distinct

Every implementation workflow has two deterministic readings:

```text
approved Plan write set
        ↓
PLANNED CHANGE IMPACT

published branch diff
        ↓
ACTUAL CHANGE IMPACT
```

Planned impact is available before the first mutation-capable implementation dispatch. Actual impact is recomputed from the published branch after delivery and again after every repair/redelivery cycle before certification resumes.

Neither reading is produced by a model.

### 2. Risk is monotonic

The effective risk for a stage is the maximum of all trusted floors known at that point:

```text
effectiveRisk = max(
  objective.risk,
  plannedImpact.riskFloor,
  actualImpact.riskFloor,
)
```

A classifier may raise risk. It may never lower a risk explicitly approved on the objective.

### 3. Classification is path-based and profile-owned

Generic Core owns matching and merge semantics. The Plurora profile owns the path-to-surface rules.

Repository-relative paths are normalized to POSIX `/` form before matching. Matching uses `picomatch` with `dot: true`; patterns are compiled once per policy resolution. No custom glob parser is introduced.

The matcher is deterministic and receives only normalized repository-relative paths. Absolute paths and traversal segments are invalid classifier inputs.

### 4. Change-impact rules accumulate

Unlike routing, change-impact rules are not first-match-wins. Every matching rule contributes facts.

A rule may contribute:

```ts
interface ChangeImpactRuleUse {
  readonly surface?: string
  readonly riskFloor?: Risk
  readonly taskClass?: string
  readonly requiredCapability?: string
  readonly evidenceProfile?: string
  readonly databaseMutation?: boolean
}
```

Multiple matching rules may therefore classify one file as, for example, both `database` and `auth`.

### 5. QA and Security policies become executable lifecycle policy

The effective set of changed surfaces is resolved against `qaPolicy.rules` and `securityPolicy.rules`.

QA policy may:
- raise the effective risk floor;
- require independent QA;
- require one or more named evidence profiles.

Security policy may:
- raise the effective risk floor;
- require a Security stage;
- require the configured independence level;
- remain blocking.

A declared surface-specific QA/Security rule that matches the effective impact must affect the stage plan. It may not remain documentation-only.

### 6. Certification stages are selected after actual impact exists

The PR lifecycle is split into two deterministic phases:

```text
IMPLEMENTATION PHASE
implement -> focused verify -> delivery

CERTIFICATION PHASE
actual-impact resolution
-> review
-> applicable QA
-> applicable Security
-> conformance
-> verify-final
```

Plan F adds `conformance`. Plan G does not replace it.

The actual-impact reading may add QA/Security requirements beyond those predicted by planned impact. It never removes gates already required by planned impact or the approved objective.

### 7. Repair invalidates impact-dependent certification

After any repair followed by redelivery:

```text
re-read published diff
-> recompute actual impact
-> recompute effective risk/policy requirements
-> rerun the required certifying stages
```

A repair that expands the write surface into `auth`, `database`, `credentials`, `dependencies`, `delivery`, or another higher-risk surface must escalate the remaining certification automatically.

### 8. Routing consumes resolved impact facts

`RoutingContext` is populated from the effective impact rather than placeholders:

- `risk` = effective risk;
- `writeVolume` = deterministic write-volume classification;
- `taskClass` = highest-precedence classified task class when one exists, otherwise the approved objective task class when present;
- `requiredCapabilities` = sorted unique required capabilities;
- `workload` remains the approved objective workload;
- `implementationExecutor` and independence semantics remain unchanged.

Sensitive classifier-produced task classes outrank a caller-provided generic task class. A caller may supply semantic intent such as `refactor` or `test-generation`, but cannot suppress a classifier-produced `auth`, `rls`, or `tenant-isolation` class.

### 9. Write volume is factual, not role-shaped

The Plurora change-impact policy defines file-count thresholds:

```text
0 files     -> none
1-3 files   -> small
4-12 files  -> medium
13+ files   -> large
```

For a mutating stage, effective write volume is the maximum of:
- the current change-set file-count volume; and
- any explicit rule floor.

Read-only roles remain `none` regardless of diff size.

These thresholds are Plurora policy, not generic Core constants.

### 10. Database mutation is detected from trusted change evidence

Database verification cannot depend only on the caller setting `databaseChange`.

If planned or actual impact contains `databaseMutation=true`, the workflow requires the configured deterministic database verification capability before delivery/certification can succeed.

A caller may explicitly require DB verification earlier, but cannot disable it when the trusted classifier detects database mutation.

### 11. Evidence profiles are stable identifiers

Change impact and QA policy resolve scalar evidence-profile IDs such as:

```text
db-standard
auth-standard
api-standard
ui-standard
dependency-standard
delivery-standard
```

Plan G carries those IDs into the applicable certifying stage specifications and durable facts. The NeuroVia installation maps them to concrete project gates during Plan C*; generic Core does not embed npm commands or NeuroVia paths.

### 12. Planned scope drift is observable

Actual paths not present in the approved Plan write set are retained as `unplannedPaths` in the actual/effective impact fact. They do not automatically mean the implementation is wrong, but they are visible to Code Review and Conformance and prevent silent scope expansion.

Plan F remains the authority that decides whether the resulting Plan/implementation mismatch is acceptable; Plan G only makes the mismatch deterministic and unavoidable as evidence.

### 13. Bounded durable evidence

The journal/status projection records only bounded change-impact facts:

- source (`planned` or `actual`);
- normalized path count;
- surfaces;
- effective risk floor;
- write volume;
- task classes;
- required capabilities;
- evidence-profile IDs;
- database-mutation flag;
- matched rule IDs;
- unplanned path count and repository-relative path list subject to an explicit bound.

It never stores file contents, diffs, prompts, credentials or model reasoning.

### 14. Generic Core remains reusable

No `packages/` module may contain `neuro-via`, the Supabase project ref, Plurora-specific repository paths, or Plurora evidence-profile commands.

`profiles/plurora` may contain Plurora path classifiers and policy IDs. `apps/plurora-harness-host` may read the actual project Git state because it is deployment glue above Core.

## Initial Plurora surface policy

The implementation must cover at least these surfaces with explicit tests:

```text
Database:
  supabase/migrations/**
  supabase/tests/**
  scripts/db/**

Auth / authorization:
  src/lib/auth/**
  src/features/auth/**
  src/features/admin-auth/**
  src/proxy.ts

Dependencies / supply chain:
  package.json
  package-lock.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  .github/workflows/**

Delivery automation:
  .github/**
  scripts/git/**

UI / Design System:
  src/components/ui/**
  src/features/**
  src/app/**
  src/shell/**
```

More specific rules must be evaluated before/general alongside broad UI rules so a file under an auth feature cannot become merely `ui`.

`rls` and `tenant-isolation` are additionally contributed by database paths whose approved Plan/task metadata explicitly names those task classes; Plan G does not attempt semantic SQL parsing.

## Acceptance criteria

- **CI1:** Before the first mutating implementation dispatch, the workflow has a deterministic `planned` impact derived from the exact approved Plan bytes/hash and its declared write-set paths.
- **CI2:** After delivery and after every repair/redelivery, the workflow has a deterministic `actual` impact derived from the published branch diff, not model self-report.
- **CI3:** `effectiveRisk` is monotonic and equals the maximum trusted floor; no classifier or caller metadata can lower an already higher risk.
- **CI4:** Path classification is profile-owned, cumulative, POSIX-normalized and implemented through reviewed `picomatch` matching with dotfiles enabled.
- **CI5:** A Plurora auth/credentials/database/delivery/dependency surface cannot bypass the QA/Security policy that matches it merely because `objective.risk` was lower.
- **CI6:** The stage planner uses resolved surface policy to decide applicable QA and Security stages; matching policy rows are executable, not advisory.
- **CI7:** `RoutingContext.taskClass`, `risk`, `writeVolume` and `requiredCapabilities` are populated from resolved impact facts and covered by regression tests.
- **CI8:** Heavy/large implementation and repair continue to obey the existing MiMo hard invariant after write-volume becomes factual.
- **CI9:** A detected database mutation requires the deterministic database-verification capability even when the caller omitted an explicit DB-change declaration.
- **CI10:** Evidence-profile IDs required by the effective impact are carried into applicable certifying stage specs/facts and are available to Plan F Conformance/Plan C* project evidence wiring.
- **CI11:** Actual paths outside the approved Plan write set are surfaced as bounded `unplannedPaths` and cannot disappear from the certification evidence.
- **CI12:** Repair/redelivery recomputes actual impact and may only preserve or strengthen the remaining certification requirements.
- **CI13:** Change-impact facts are journalled/status-visible without file contents, raw diffs, secrets, transcripts or reasoning.
- **CI14:** Generic packages contain no NeuroVia-specific path/ref assumptions; Plurora classifiers remain in `profiles/plurora` or deployment glue.
- **CI15:** Adversarial tests prove at minimum: low-risk auth is escalated; database mutation cannot skip DB verification; a repair that adds an auth file adds Security; an unplanned sensitive path is surfaced; Windows-style input is normalized; `../` and absolute classifier paths are refused; and a broad UI match cannot erase a more sensitive surface.

## Non-goals

- Plan G does not implement the GitHub required status check; that is Plan H.
- Plan G does not implement Idea Intake, Definition of Ready, Design Assurance, Release Readiness, deploy or incident workflows.
- Plan G does not perform semantic source-code or SQL analysis to infer intent.
- Plan G does not let a model author or modify classifier rules at runtime.
- Plan G does not replace Plan F Conformance; it supplies stronger deterministic evidence and gate selection to it.

## Sequencing

Plan G requires Plan E and Plan F to be complete and independently reviewed because it reuses the runnable Plurora host and approved-artifact/conformance seams.

Canonical execution order becomes:

```text
Plan E — deployment/host enablement
  -> Plan F — Conformance / DoD
  -> Plan G — Change Impact / Risk / Policy Enforcement
  -> Plan H — GitHub Harness Certification
  -> Plan C* + NeuroVia wiring
  -> Plan D Tasks 11/12
```
