# Implementation Conformance & DoD Planning Self-Review

- **Date:** 2026-08-28
- **Branch:** `docs/neurovia-integration-deployment-amendment`
- **Scope:** Spec/Plan design only; no runtime implementation is claimed by this evidence
- **Spec:** `docs/superpowers/specs/2026-08-28-harness-v2-implementation-conformance-dod-amendment.md`
- **Harness Plan:** `docs/superpowers/plans/2026-08-28-trick-harness-implementation-conformance-dod.md`
- **NeuroVia Overlay:** `docs/superpowers/plans/2026-08-28-neurovia-conformance-dod-wiring.md`
- **Verdict:** PASS — planning coverage is internally consistent and ready for implementation after the preceding Plan E dependency

## 1. Design decision coverage

| Requirement | Planned owner |
| --- | --- |
| first-class read-only `conformance` role | Harness Plan Tasks 1, 4, 5 |
| approved Spec/Plan path + SHA-256 identity | Harness Tasks 1, 4, 6; NeuroVia Tasks 1-3 |
| deterministic Spec obligation list | Harness Task 3 |
| deterministic Superpowers Plan task list | Harness Task 3 |
| deterministic baseline DoD rows | Harness Task 5 |
| structured conformance result/parser | Harness Task 2 |
| exact expected-ID coverage validation | Harness Tasks 3-4 |
| conformance before `verify-final` | Harness Task 4 |
| `PR_READY` requires conformance PASS + final verify PASS | Harness Task 4; NeuroVia Task 4 |
| low/medium routing `codex.balanced/high` | Harness Task 5 |
| high/critical routing `codex.frontier/xhigh` | Harness Task 5 |
| Codex-unavailable fallback to `opencode.reasoning-fast` | Harness Task 5 |
| high/critical fallback cannot fake cross-executor independence | Harness Tasks 5, 8; NeuroVia Task 6 |
| native Codex model/effort catalogue validation | Harness Tasks 7-8 |
| conformance status/journal bounded and replayable | Harness Task 6 |
| model cannot pick arbitrary external Spec/Plan | NeuroVia Tasks 1-3 |
| `pr-readiness` consumes Harness conformance | NeuroVia Task 4 |
| real missing-plan-task fixture blocks PR readiness | Harness Task 8; NeuroVia Task 6 |

Every **CF1-CF14** acceptance criterion has at least one explicit implementation task and a verification seam.

## 2. Model-selection review

The selected routing follows the existing Plurora rule that judgement work goes to Codex and volume work goes to OpenCode/MiMo:

```text
low / medium conformance  -> codex.balanced, high
high / critical conformance -> codex.frontier, xhigh
Codex unavailable -> opencode.reasoning-fast, degraded assurance
```

Context7's current Codex app-server documentation confirms `model/list` exposes each model's `supportedReasoningEfforts`. Plan F therefore validates the requested effort against the authenticated native catalogue rather than assuming an effort is supported or maintaining a guessed capability table.

Concrete model ids remain deployment data. The current Plurora semantic intent is Terra-class for `codex.balanced` and Sol-class for `codex.frontier`; Plan E/F model-registry work resolves actual native ids before readiness.

## 3. Contract consistency

The approved artifact vocabulary is consistent across Spec and Plans:

```ts
ApprovedArtifactSet {
  spec: { path, sha256 }
  plan: { path, sha256 }
}
```

The conformance vocabulary is consistently:

```text
sources: spec | plan | dod
item statuses: PASS | MISSING | PARTIAL | FAIL | BLOCKED | INCONCLUSIVE
workflow verdict: PASS | PARTIAL | FAIL | BLOCKED | INCONCLUSIVE
```

The baseline DoD contains exactly eight rows and uses `DOD-FINAL-VERIFY-READY` rather than claiming final verification has already run. Actual `verify-final=PASS` remains a separate post-conformance requirement for `PR_READY`.

## 4. Deterministic coverage review

The design does not trust model output to enumerate obligations.

- Spec obligations come from explicit stable acceptance IDs such as `CF1`, `ND1`, `R1`.
- Plan obligations come from every Superpowers `### Task N:` heading and become `PLAN-TASK-N`.
- DoD obligations come from the profile baseline policy.
- Returned conformance items must exactly account for expected IDs; omission, duplication, source/requirement mismatch or hash mismatch cannot PASS.

This is the key control that prevents a model from certifying a plausible subset of the Plan while silently omitting work.

## 5. Path and repository review

Current repository paths were checked against `master` during planning. In particular:

- contracts tests are `packages/core/contracts/tests/contracts.spec.ts` and `invariant.spec.ts`;
- engineering workflow tests include `workflow.spec.ts` and `lifecycle.spec.ts`;
- control-server test is `packages/core/control-server/tests/server.spec.ts`;
- journal source uses `src/types.ts` + `src/index.ts` and tests use `journal.spec.ts` + `invariant.spec.ts`;
- Plurora tests are `routing.spec.ts`, `profile.spec.ts`, and `composition.spec.ts`;
- Codex native app-server wire lives under `packages/subagent/subagent-codex` while the Harness provider lives under `packages/providers/codex`.

Plan F was corrected to those exact paths before this self-review was recorded.

## 6. Placeholder scan

The final Harness and NeuroVia conformance plans were scanned for Superpowers planning red flags `TODO`, `TBD`, and `if needed`; no matches remained. Conditional file ambiguity was removed from the NeuroVia DoD mapping task and fixed dates/paths are used for verification evidence.

The plans intentionally do not hard-code a guessed Codex native model id. This is not a placeholder: the implementation contract requires reading the authenticated native catalogue and persisting the actual non-secret ids in the deployment registry/evidence.

## 7. Independence semantics

The existing Plurora independence policy is preserved:

```text
low      -> fresh-context
medium   -> cross-executor-preferred
high     -> cross-executor-required
critical -> cross-executor-required
```

Therefore Codex-unavailable fallback can still produce explicitly degraded evidence, but a high/critical workflow implemented by OpenCode cannot certify conformance through an OpenCode fallback. The design does not turn fallback availability into a false independent review.

## 8. Verification limitation

This branch contains planning/documentation changes only. Runtime tests, build, typecheck, native model catalogue checks and real conformance lifecycle evidence have not been run because the implementation does not yet exist. The executable Plans require those fresh gates and adversarial fixtures before any completion claim.

## 9. Final planning verdict

**PASS — no open planning blocker found.**

Active execution order is:

```text
Plan E
-> Plan F
-> Plan C* + NeuroVia conformance wiring overlay
-> Plan D Tasks 11/12
```

The SHA NeuroVia initially pins must be the independently reviewed **post-Plan-F** Trick Harness SHA.
