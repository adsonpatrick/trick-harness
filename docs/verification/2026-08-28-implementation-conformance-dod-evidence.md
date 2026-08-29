# Implementation Conformance & Definition of Done — verification evidence

Evidence for `docs/superpowers/plans/2026-08-28-trick-harness-implementation-conformance-dod.md`
(Plan F), recorded on 2026-08-28 on branch `feat/harness-v2-plan-f-conformance-dod`.

Everything below was run on this machine. Where the plan says "real", the thing that ran was
the real one; where something was not proven, this file says so rather than inferring it.

## 1. Deterministic gates

| Gate | Result |
| --- | --- |
| `corepack pnpm run constraints` | pass — workspace constraints and `check-trick-boundaries` |
| `corepack pnpm run typecheck` | pass |
| `corepack pnpm run lint` | pass |
| `corepack pnpm run build` | pass (see note) |
| `corepack pnpm run test:trick` | pass — 94 files, 2169 tests |
| `corepack pnpm --filter @trick-harness/plurora-host test` | pass — 8 files, 143 tests |

Note on `build`: unchanged from Plan E. The fork's `build:web` script shells out to a bare
`pnpm`, so on a machine that runs pnpm only through corepack the gate fails before reaching
any of this plan's code. It was run with a `pnpm` shim on `PATH` forwarding to
`corepack pnpm`, and then passes (`build: recorded 200 client artifact(s)`). This is an
environment property of the upstream script and was left unedited.

## 2. The fixture pull-request lifecycle

`apps/plurora-harness-host/tests/conformance-end-to-end.spec.ts` is the executable half of
this record. It holds nothing still: the real `WorkflowRunner` runs against the real Plurora
profile, the real routing table, the real Definition of Done and the real host handlers, over
approved documents written to a real checkout on disk. The obligation set the fixture answers
is built independently of the runtime's, so the coverage check between them is a comparison
of two separately derived sets rather than of one set with itself.

The approved Spec declares two acceptance criteria (`ND1`, `ND2`); the approved Plan declares
two tasks. What the run judged the branch against:

| Source | Count | Ids |
| --- | --- | --- |
| Spec | 2 | `ND1`, `ND2` |
| Plan | 2 | `PLAN-TASK-1`, `PLAN-TASK-2` |
| Definition of Done | 8 | the eight `DOD-*` rows in `profiles/plurora/conformance-policy.ts` |
| **Total** | **12** | |

`outcome.conformance.expected` reads `{ spec: 2, plan: 2, dod: 8 }` — deterministic code
enumerated all twelve before any model was dispatched.

Readiness: the run reaches `PR_READY` only with the last conformance stage at `PASS` and a
`verify-final` stage that ran *after* it and also passed. Both are asserted positionally, so a
conformance reading taken before the branch reached its final state cannot satisfy the gate.

Routing, read off the actual start requests:

| Risk | Executor | Model (via tier) | Reasoning effort | Permission |
| --- | --- | --- | --- | --- |
| low | `codex` | `codex.balanced` | `high` | `read-only` |
| high | `codex` | `codex.frontier` | `xhigh` | `read-only` |

The bounded summary that reaches status and replay carries the two paths, the two hashes, the
per-source expected counts, the per-status counts and the verdict. The test asserts that
neither an approved requirement's text nor the model's own words about it appear anywhere in
it.

## 3. Adversarial fixtures

Each of these is a way a branch could otherwise be called ready. None reaches `PR_READY`.

| Fixture | What it does | Outcome |
| --- | --- | --- |
| Unanswered Plan task | Answers eleven of twelve obligations and states `PASS` | `INCONCLUSIVE` |
| Plan changed after approval | Plan on disk gains a third task; hash no longer matches | `BLOCKED` |
| Spec hash mismatch | Objective names a Spec hash the file does not produce | `BLOCKED` before any stage ran — zero stages, zero executor starts |
| Duplicate result item | Answers `ND1` twice | `INCONCLUSIVE` |
| Unknown obligation | Answers an `ND9` the approved artifacts never declared | `INCONCLUSIVE` |
| Restated obligation | Answers every obligation with a requirement of its own wording | `INCONCLUSIVE` |
| Codex unavailable, high risk | Only OpenCode registered; implementation and judgement collapse onto one executor | `BLOCKED` — the run stops at the first judgement stage for want of an independent executor, and conformance is never reached |

Two notes on the last row. The plan anticipated conformance running on the fallback route and
being capped; what the real policy does is stop earlier, at the first stage whose independence
requirement cannot be met. That is the stronger outcome — there is no reading for a fallback
to launder — and it is what the test now states, rather than the weaker behaviour the plan
predicted. `INCONCLUSIVE` rather than `FAIL` is likewise deliberate throughout: a reading this
runtime cannot hold to the manifest has established nothing, which is a different fact from a
branch that was judged and found wanting.

## 4. Real authenticated Codex catalogue

Read from the authenticated account through the pinned app-server's `model/list`, with no
thread and no turn started, no write to Codex configuration or authentication, no injected
`OPENAI_API_KEY`, and the environment passed through untouched. The probe was a throwaway
script, deleted after it ran. Model ids and advertised reasoning efforts only; no credential,
account identifier or token was read or recorded.

```text
gpt-5.6-sol     [low, medium, high, xhigh, max, ultra]
gpt-5.6-terra   [low, medium, high, xhigh, max, ultra]
gpt-5.6-luna    [low, medium, high, xhigh, max]
gpt-5.5         [low, medium, high, xhigh]
gpt-5.4         [low, medium, high, xhigh]
gpt-5.4-mini    [low, medium, high, xhigh]
```

Every model on this account advertises both `high` and `xhigh`, so any of them can serve
`codex.balanced` at the effort routine conformance asks for and `codex.frontier` at the effort
high and critical conformance asks for. The `max` that `exceptional-escalation` asks of
`codex.frontier` exists only on the gpt-5.6 family, so a deployment that pins `codex.frontier`
to a gpt-5.5 or gpt-5.4 model is refused at boot rather than quietly downgraded — the effort
gate in `apps/plurora-harness-host/src/model-registry.ts` holds each model to what it
advertises, never to the union across the catalogue.

The tiers are checked per model for the same reason: an effort validated against the
catalogue-wide union would pass a model advertising none of it as long as some other model on
the account did.

## 5. Independent review

| Area | Finding |
| --- | --- |
| Role authority | `conformance` is dispatched `read-only`, asserted on the real start request. It is not in `permissionModeFor`'s write set, and it is named separately in the runner only to force an artifact re-read before it runs — not to grant it anything. |
| Artifact path containment | Approved paths are objective data and reachable over the control server. `containedPath` folds backslashes before resolving, so `docs\..\..\x` is a traversal on every platform, and refuses `..`, absolute remainders and the checkout root itself. The refusal names neither the path nor the checkout, because it is journalled. |
| Hash integrity | Hashes are computed over what was actually read, never copied from the objective — the one thing re-reading exists to check. A conformance stage cannot state the hashes it was judged against; the runtime overwrites them with its own. |
| Conformance coverage | Unanswered, duplicated, invented and restated obligations are each refused by name in `validateConformanceCoverage`, and each is exercised end to end in section 3. No refusal quotes the value it refused. |
| Fallback independence | Verified as section 3's last row. The `independence:unsatisfied` reason code and `capVerdict` remain as the second line of defence for the cases that do reach a stage. |
| Journal redaction | The durable conformance record is paths, hashes, counts and a verdict. Documents, transcripts and private reasoning have no field to travel in, and the summary the host stores is bounded and redacted. Asserted negatively in section 2. |
| Pull-request readiness | `PR_READY` requires the latest conformance at `PASS` plus a `verify-final` after it, on top of the existing open-defect invariants. A conformance reading followed by any further stage is stale and is refused. |

No confirmed defect was found in this review. The one correction it produced was to a test's
prediction rather than to the runtime: the Codex-unavailable high-risk case blocks earlier
than the plan expected, and the test now states what the policy actually does.

## 6. Known-good SHA

Gates in section 1, the twelve end-to-end cases in sections 2 and 3, and the catalogue read in
section 4 were all produced on this tree.

The SHA recorded in `docs/verification/2026-08-27-neurovia-deployment-enablement-evidence.md`
is superseded: it predates the conformance role, the Definition of Done and the reasoning-
effort boot gate, and a deployment pinned to it would install a runtime that cannot certify a
branch against approved artifacts at all.

The one initial runtime revision Plan C and its successors may pin:

```text
5061a6861bc7d80617832fc3f144c34dbb85dd44
```

That is the commit this file was first written into, and it is the tree every gate and every
fixture above ran on — the only change after it is the two lines that write the SHA into this
paragraph, which touch no code. This SHA supersedes every intermediate Plan E SHA.

Anything not listed as proven above is not proven at this SHA. In particular the NeuroVia
database canary is still pending Plan C, and the Supabase Preview path is still unproven for
want of an entitlement.
