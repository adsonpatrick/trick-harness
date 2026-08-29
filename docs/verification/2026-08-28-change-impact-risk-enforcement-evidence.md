# Change-Impact Risk and Policy Enforcement — Verification Evidence

Plan: `docs/superpowers/plans/2026-08-28-trick-harness-change-impact-risk-policy-enforcement.md`. Amendment: `docs/superpowers/specs/2026-08-28-harness-v2-change-impact-risk-policy-enforcement-amendment.md`.

Everything below was produced on the tree recorded in section 7. Anything not listed as proven here is not proven at this SHA.

## 1. Deterministic gates

Run on Windows 11, Node 24.19.0, pnpm 11.7.0 via corepack, from the repository root.

| Command | Exit | Result |
| --- | --- | --- |
| `corepack pnpm run constraints` | 0 | `check-trick-boundaries: generic packages carry no project-policy dependency.` |
| `corepack pnpm run typecheck` | 0 | `tsc -b tsconfig.client.json`, then `tsc -b apps/plurora-harness-host/tsconfig.json` |
| `corepack pnpm run lint` | 0 | `tsx scripts/run-oxlint.ts .` |
| `corepack pnpm run build` | 0 | `build: recorded 200 client artifact(s) with 1 public value(s)` |
| `corepack pnpm run test:trick` | 0 | 2359 tests across 99 files |

Focused suites, run before the full gates:

| Command | Exit | Result |
| --- | --- | --- |
| `corepack pnpm vitest run packages/core profiles apps/plurora-harness-host` | 0 | 2135 tests across 91 files |
| `corepack pnpm vitest run apps/plurora-harness-host/tests/change-impact-end-to-end.spec.ts` | 0 | 12 tests |

## 2. Host wiring

`apps/plurora-harness-host` now supplies the runtime's `changeImpact` reader, which is what puts every run this host serves into its measured form.

- `plannedPaths` re-reads the approved Plan from the checkout, compares its SHA-256 against the one the objective was approved with, and refuses without quoting either hash. Only then does `extractApprovedPlanWriteSet` parse the `**Files:**` rows. A Plan edited after approval blocks the run before any classification is journalled, rather than classifying the run from the edit.
- `actualPaths` delegates to the Git reader in `apps/plurora-harness-host/src/change-set.ts`. No stage is asked what it touched.
- `packages/composition/runtime/src/harness.ts` gained the `changeImpact` handler seam. The plan's Task 11 file list omits this file; without it nothing could hand a reader to `WorkflowRunner`, so it was added as a necessary deviation and is included in the commit.
- The reader is absent rather than present-and-undefined when a deployment composes none: the runtime distinguishes the two, and a run holding a reader that answers nothing would plan its certification from a change set nobody read.

## 3. Adversarial end-to-end lifecycle

`apps/plurora-harness-host/tests/change-impact-end-to-end.spec.ts` drives the real `WorkflowRunner`, the real `pluroraProfile`, the real routing policy resolved against a model registry, and the real host handlers, against an approved Plan written to a real temp checkout. Runs are started without a caller `plan`, so the lifecycle is measured rather than fixed.

| Scenario | Proven |
| --- | --- |
| A change that turned out to be something other than its objective | An objective opened at `low` whose branch delivered `src/lib/auth/route-policy.ts` is certified at critical, with a security stage the fixed low-risk plan would never have contained |
| A migration nobody declared | A delivered `supabase/migrations/**` file with no `databaseChange` declaration and no composed verifier is `BLOCKED`; with a verifier composed the run completes and the schema is verified before the branch is published |
| A repair that widened the change after the bar was set | A repair that adds an auth file re-reads the published branch, re-plans the certification half, and adds the security reading the first pass did not owe |
| A change too large for the tier that would have written it | Thirteen delivered `src/app/panel-N.tsx` files resolve `writeVolume: 'large'`, and that measured volume — not the caller's word — is what reaches the router |
| A delivered file the approved Plan never named | The unplanned path is surfaced in the certification evidence and does not disappear across a repair and redelivery |

## 4. Real-product smoke

### 4.1 Disposable Git fixture, real subprocess seam

Per the plan's Step 8, path impact was verified against a throwaway Git fixture. NeuroVia and every live database were untouched.

A bare repository plus a clone was created under the system temp directory, a base commit pushed to `main`, a feature branch created delivering three files, and one unrelated commit landed on `main` afterwards so the reader had to resolve a merge base rather than diff against the tip. `createGitChangeSetReader` was then driven through the real `LocalSubprocessRuntime` spawn — not the fake spawn the unit suite uses — and its output classified by the real Plurora policy.

```text
actualPaths      = ["src/app/gate.tsx","src/lib/auth/route-policy.ts","supabase/migrations/0001_gate.sql"]
surfaces         = ["database","auth","ui"]
riskFloor        = critical
writeVolume      = small
databaseMutation = true
requiredCaps     = ["database-verification"]
evidenceProfiles = ["db-standard","auth-standard","ui-standard"]
matchedRuleIds   = ["database-migrations","auth-library","application-ui"]
unplannedPaths   = ["src/lib/auth/route-policy.ts","supabase/migrations/0001_gate.sql"]
planned.risk     = medium | planned.dbMutation = false
effectiveRisk    = critical
effective.dbMut  = true
effective.caps   = ["database-verification"]
```

The unrelated `main` commit is absent from `actualPaths`, so the merge base was resolved rather than assumed. The planned reading — an approved Plan naming only `src/app/gate.tsx` — resolves to `medium` with no database mutation, and the delivered one raises both. Nothing lowers.

### 4.2 Authenticated native catalogues

Both catalogues were read once, read-only, through `nativeCatalogueReader`, with the real environment passed through untouched. No model turn was started, no Codex configuration or auth was rewritten, and no `OPENAI_API_KEY` was injected.

```text
opencode: OK 133 models; ["opencode-go/deepseek-v4-flash","opencode-go/mimo-v2.5", ...]
codex: OK 6 models; [{"id":"gpt-5.6-sol", ...},{"id":"gpt-5.6-luna", ...}, ...]
```

## 5. Independent read-only review — CI1 to CI15

Performed against the amendment's conformance invariants. Two findings were confirmed and fixed under Step 10; the matrix below states the post-fix position.

| Invariant | Verdict | Evidence |
| --- | --- | --- |
| CI1 planned impact before first mutating dispatch | PASS | `#drive` classifies `planned` before the stage loop and checkpoints it; the host's `plannedPaths` verifies the approved Plan's SHA-256 first |
| CI2 actual impact from the published branch after every delivery | PASS | Re-read after every delivery, not only the first; section 4.1 proves the reading is Git's, not a stage's |
| CI3 monotonic `effectiveRisk` | PASS | `mergeChangeImpact`, `retainStrongerImpact` and `applyCertificationRequirements` all merge with max/union; no path lowers |
| CI4 profile-owned, cumulative, POSIX-normalized, one `picomatch` | PASS | Single call site, `{ dot: true, windows: false }`; `normalizeRepositoryPath` folds backslashes before its checks |
| CI5 sensitive surface cannot be bypassed by a lower `objective.risk` | PASS after fix | Finding B below: `credentials` and `api` were declared in the QA/Security tables and unreachable from any path rule |
| CI6 matched policy rows are executable | PASS after fix | Finding A below: the risk a matched QA row established chose stages but not how they were routed |
| CI7 routing context populated from impact facts | PASS | `impactRoutingFacts`; asserted end to end in section 3's write-volume row |
| CI8 MiMo hard invariant survives factual write volume | PASS | The `packages/core/routing` invariant suite is unchanged and green; large implement and repair still route to `opencode.workhorse` |
| CI9 detected DB mutation cannot be disabled by caller metadata | PASS | The delivery gate takes the caller's declaration **or** the measured `databaseMutation`; there is no caller field that turns the second half off |
| CI10 evidence-profile IDs reach certifying stages | PASS | `planPullRequestCertificationStages` puts the same frozen list on every certifying `StageSpec` |
| CI11 unplanned paths bounded and visible | PASS | `summarizeChangeImpact` records the count before the cap, so the cap never understates the delivery |
| CI12 repair/redelivery may only preserve or strengthen | PASS | `retainStrongerImpact`; section 3's repair row |
| CI13 no contents, diffs, secrets, transcripts or reasoning journalled | PASS | The durable record is rebuilt field by field rather than spread, and every refusal in the reader and in `#classify` declines to quote Git output or the reader's own error text |
| CI14 generic packages carry no NeuroVia assumptions | PASS | `constraints` gate; a search for NeuroVia paths, Supabase refs and Plurora names across `packages/` returns nothing outside tests |
| CI15 adversarial coverage | PASS | Section 3's five lifecycles plus the profile and classifier suites covering Windows-style input, `..` refusal, absolute refusal, and a broad UI match that does not erase auth or database |

### Finding A — a QA row's risk chose stages but not routing (fixed)

`resolveCertificationRequirements` takes the maximum of the impact's risk and every matched QA row's `risk`. That resolved value selected which certifying stages ran, but the stages were then routed — and their independence requirement read — off the *unraised* `impact.effectiveRisk`. `CertificationRequirements.independenceRequirement` was computed and consumed nowhere.

Reproduced before the fix on a `scripts/db/**` change, whose path floor is `high` while the `database-migration` QA row states `critical`:

```text
impact.effectiveRisk          = high
requirements.effectiveRisk    = critical
ROUTED risk                   = high
```

At today's Plurora tables `high` and `critical` route review and conformance to the same tier and effort, so no run misrouted in practice — but the coupling was absent, and any future row that separated the two would have been silently advisory. Fixed by `applyCertificationRequirements` in `packages/core/engineering-workflow/src/impact-policy.ts`, folded back into `measurement.impact` in the runner before the reading is journalled and before the certification half is planned. Monotonic: it raises risk and unions evidence, and touches neither reading.

### Finding B — declared sensitive surfaces no path could reach (fixed)

Plurora's `qaPolicy` and `securityPolicy` declared rows for the `credentials` and `api` surfaces, including the blocking `credential-handling` security trigger, while `changeImpactPolicy` contained no rule producing either surface. Both rows were unreachable — a policy a reviewer reads as enforced and no run can ever be held to. The amendment names `credentials` explicitly in CI5, so this is a sensitive-surface omission.

```text
surfaces produced by paths    = ["auth","database","delivery","dependencies","ui"]
surfaces declared in policy   = ["api","auth","credentials","database","delivery","dependencies","ui"]
DECLARED BUT UNREACHABLE      = ["api","credentials"]
```

Fixed by two rules in `profiles/plurora/change-impact-policy.ts`: `credential-material` (`.env`, `.env.*`, `src/lib/secrets/**` to `credentials`, critical, `secret-scan`) and `api-routes` (`src/app/api/**` to `api`, high, `api-standard`, task class `api`). A regression test now asserts both directions of the surface correspondence, so a future row on either side that the other cannot reach fails the profile suite.

**These path choices are an assumption, flagged rather than hidden.** The plan's Task 3 states the QA/Security table for `credentials` and `api` but supplies no path families for them. The paths above follow the Next.js app-router and Supabase conventions the rest of the policy already uses. If Plurora keeps credential material or route handlers elsewhere, these two rules are the lines to correct — the enforcement mechanism does not change.

## 6. Known limitations

- The plan's Step 8 asks for a smoke "from the Plurora host". This repository contains no `plurora-harness.json`, so no full host boot was performed here. What was exercised instead is every host seam Plan G touches — the Git change-set reader through the real subprocess service, and both authenticated catalogues — plus the whole measured lifecycle through the real runner and the real handlers. A full host boot remains covered by the Plan E evidence.
- Step 9 asks for a "Codex Engineering Guardrails review". No `codex` CLI is on PATH in this environment; the Codex binding available here is the app-server `model/list` read in section 4.2, which cannot conduct a review. Section 5 is therefore a review conducted in-session against CI1-CI15, with each verdict traced to a named file or to a run whose output is quoted above. It is not an independently-authored second opinion and should not be recorded as one.
- The NeuroVia database canary is still `PENDING PLAN C`. Nothing in this verification touched NeuroVia or any live database.
- The Supabase Preview Branch path remains unproven for want of an organization entitlement.
- Merge, release and deploy remain human-controlled. Nothing here changes that.

## 7. Head SHA

```text
195cbbcf080a3037340c885b6824852a3cff781a
```

Its parent is `a1a81e726b043f4abdc8752cc5b3d56e17b4b2dc`. Every gate, lifecycle and smoke in sections 1 through 6 was run on the source this commit records. The only thing added after the last of them was documentation — this file, the README paragraph and the plan's checkboxes — so no runtime, profile or test file differs between what was gated and what is recorded here.
