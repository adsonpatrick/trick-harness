# NeuroVia Deployment Amendment Self-Review

- **Date:** 2026-08-27
- **Branch:** `docs/neurovia-integration-deployment-amendment`
- **Scope:** planning/documentation only; no runtime or NeuroVia implementation code is changed by this branch
- **Reviewed Spec:** `docs/superpowers/specs/2026-08-27-neurovia-harness-deployment-cloud-dev-amendment.md`
- **Reviewed Trick Plan:** `docs/superpowers/plans/2026-08-27-trick-harness-cloud-dev-deployment-enablement.md`
- **Reviewed NeuroVia Plan:** `docs/superpowers/plans/2026-08-27-neurovia-harness-installation-amendment.md`
- **Verdict:** PASS — planning coverage and naming are internally consistent; implementation/runtime gates remain intentionally unrun

## 1. Spec coverage

| Spec requirement | Execution owner |
| --- | --- |
| `neurovia-dev` is explicit dev target, not Preview fallback | NeuroVia Plan Tasks 1, 5, 7, 8, 10 |
| future production is a separate authority boundary | NeuroVia Plan Tasks 8-10 |
| cloud-only/no local Docker | NeuroVia Plan Tasks 5, 7-10 |
| cross-process shared DB serialization | NeuroVia Plan Task 6 |
| migration-history reconciliation / no auto repair | NeuroVia Plan Tasks 5, 7 |
| remote migration + history re-read + lint + pgTAP + RLS allow/deny | NeuroVia Plan Task 7 |
| generic database-verification workflow seam | Trick Plan Tasks 1-3 |
| preserve optional built-in Preview strategy | Trick Plan Tasks 1-3, 8 |
| runnable Plurora host inside Trick checkout | Trick Plan Tasks 4, 7-8 |
| NeuroVia imports no private Trick packages | Spec §5, Trick Plan Task 4, NeuroVia Plan Tasks 2-3 |
| exact runtime SHA verification | Trick Plan Task 8, NeuroVia Plan Tasks 1-2, 10 |
| semantic-tier -> native model registry | Trick Plan Tasks 4-5, NeuroVia Plan Task 1 |
| OpenCode catalogue validation | Trick Plan Task 5 |
| Codex pinned app-server `model/list` validation | Trick Plan Task 5 |
| bounded project DB command adapter | Trick Plan Task 6, NeuroVia Plan Task 7 |
| loopback OpenCode run/status/cancel evidence | NeuroVia Plan Tasks 3, 10 |
| quiescent shutdown | Trick Plan Tasks 6-8, NeuroVia Plan Tasks 2, 10 |
| activation records shared-cloud strategy | NeuroVia Plan Task 10 + Plan D Tasks 11/12 |

Every ND1-ND12 acceptance criterion has at least one explicit implementation/verification owner in those rows.

## 2. Placeholder scan

The two executable plans were checked for the Superpowers disallowed planning placeholders `TODO`, `TBD`, and `if needed`; no matches remain. The Plans do not commit fake provider model ids. Instead, the NeuroVia Plan defines the exact registry interface and requires the execution task to capture the actual non-secret native ids from the reviewed Trick host catalogue before the config turns GREEN.

Conditional execution around a real pending migration is intentional runtime branching, not a placeholder: installation must not manufacture a migration merely to exercise the remote mutation path.

## 3. Type and vocabulary consistency

The reviewed package sources currently expose `DatabasePreviewCapabilityPort` / `WorkflowCapabilities.databasePreview`. The amendment deliberately introduces the replacement vocabulary `DatabaseVerificationCapabilityPort` / `databaseVerification`, and Trick Plan Task 1 owns that migration with a one-cycle deprecated alias. Trick Plan Task 2 and the host plan consistently consume the new name.

The project DB envelope is consistent across the two plans:

```ts
interface ProjectDatabaseVerificationEnvelope {
  schemaVersion: 1
  status: 'PASSED' | 'FAILED' | 'BLOCKED'
  targetProjectRef: string
  summary: string
  evidence: {
    kind: 'gate' | 'test'
    locator: string
    summary: string
  }[]
}
```

The host package name is consistently `@trick-harness/plurora-host`, the host path is consistently `apps/plurora-harness-host`, and the fixed child command is consistently `npm run db:verify:harness -- --json`.

The deployment registry consistently uses the five semantic tiers actually selected by `profiles/plurora`: `codex.fast`, `codex.balanced`, `codex.frontier`, `opencode.reasoning-fast`, and `opencode.workhorse`.

The authorized development project ref is consistently `uljaajwwnygopsyvwsre`; the generic Trick packages/profile are explicitly forbidden from embedding that identifier.

## 4. Precedence review

The active plan index now places this amendment above the earlier Preview-only statements and sets the remaining execution order to:

```text
Plan E — Trick cloud-dev / Plurora host enablement
-> Plan C* — NeuroVia installation amendment
-> Plan D Tasks 11/12 — final pin reconciliation and activation
```

Historical Plan C remains useful only where the new overlay does not supersede it. The previous scope amendment remains authoritative for Claude Code removal and for the historical Preview evidence status; it no longer makes Preview Branching a prerequisite for Plurora development execution.

## 5. Documentation claim review

`README.trick-harness.md` now uses semantic-tier keys in its deployment-registry example and explicitly says the shared-development/host path is planned, not already implemented. It no longer presents `{ implementation, reasoning }` as a valid `ModelRegistry` shape and does not claim `neurovia-dev` support exists merely because the amendment is documented.

## 6. Verification limitation

An attempt was made to clone the branch and execute local `git diff --check`, but the execution environment could not resolve `github.com`, so no local git/markdown/runtime gate result is claimed here. GitHub connector reads were used to re-read the final Spec, both Plans, the active index, and current source interfaces during the self-review.

This branch changes planning/documentation only. Runtime tests, typecheck, lint, build, real provider catalogue checks and real NeuroVia/Supabase checks belong to the implementation tasks and must produce fresh evidence before any runtime-completion or installation-completion claim.

## 7. Final self-review verdict

**PASS — PLAN QUALITY / NO OPEN PLANNING BLOCKER.**

This verdict authorizes execution of the approved plan sequence; it is not evidence that Plan E or Plan C* implementation has run, passed, or activated Harness V2.
