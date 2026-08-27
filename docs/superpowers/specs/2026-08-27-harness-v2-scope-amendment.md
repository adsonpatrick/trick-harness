# Plurora Engineering Harness V2 — Executor and Database Scope Amendment

- **Date:** 2026-08-27
- **Status:** Approved — owner decision 2026-08-27
- **Amends:** `2026-08-25-plurora-engineering-harness-v2-design.md`, as already amended by `2026-08-25-plurora-engineering-harness-v2-reusable-core-amendment.md`
- **Scope:** Removal of Claude Code from the executor set, and reclassification of every acceptance criterion that requires a paid Supabase entitlement

## 1. Why this amendment exists

The V2 design was written against a set of products the owner expected to keep. Two of them turned out not to be part of this system, and the design has been carrying them as obligations ever since.

The first is Claude Code as a worker executor. It was omitted during Plan A by an explicit owner decision and has never been implemented. Acceptance criterion 8 already describes it as optional *while maintained*, but Plan D Task 5 turned it into a hard activation gate, so an executor that was deliberately never built would have blocked the rollout of everything that was.

The second is Supabase Preview Branching. It requires the Pro plan for the whole organisation. The owner decided on 2026-08-27 not to buy it, which is recorded in `docs/verification/2026-08-26-harness-v2-pr-review-remediation.md`. Six acceptance criteria were written as if the entitlement were always present, so the plan set could reach BLOCKED on a paid feature rather than on a defect.

Neither decision is a gap in the implementation. This amendment makes the contract describe the system the owner actually wants, so that a run which stops describes a real problem and not a purchase.

## 2. Claude Code is removed from the executor set

Claude Code is **not** an executor of this harness. It is not degraded, not optional-but-expected, and not pending — it is out of scope.

The composed executor set is OpenCode and Codex. `profiles/plurora` already names exactly those two, and the routing policy already blocks rather than inventing a route when neither is usable. No code change follows from this amendment; it removes an obligation the code never took on.

This does not restrict how the owner uses Claude Code as a tool at the keyboard. It says only that no harness workflow dispatches work to it as a routed worker, and no evidence artefact is expected to contain a Claude worker run.

### Consequences for the acceptance criteria

- **Criterion 8** — *"Claude Code executes as optional worker through official SDK/CLI/native path while maintained"* — is **WITHDRAWN**. There is no maintained Claude runtime in this system to demonstrate it against.
- **Criterion 9** — *"Disabling Claude does not break core OpenCode/Codex workflows"* — is **RETAINED and strengthened**. It is no longer a toggle test but a standing property: the whole suite runs, and has always run, with no Claude executor present at all. Evidence is the existing deterministic suite rather than a disable/enable cycle.

The criterion count moves from 35 to 34. Criterion 8's number is retired rather than reused, so existing references to criteria 9 through 30 stay valid.

## 3. Supabase criteria are split by entitlement

The Supabase criteria are separated into what a free-plan organisation can prove and what requires the Pro entitlement. The split is by what the property actually needs, not by what is convenient to skip.

**Retained as required.** These hold on the free plan and are not waived:

- **Criterion 24** — preview creation unavailable must block, never fall back to a shared development database. This is the fail-closed half, and it is the one that protects the parent project. It has been demonstrated against the real Supabase API, which answered `branches create` with HTTP 402; the workflow blocked and mutated nothing.
- **Criterion 25** — no check may require a local Docker Supabase or a Docker shadow database. This is a negative property, provable by inspection and by the absence of those paths.
- **Criterion 26** — local-Docker database gates must be retired so they cannot silently remain canonical. This is work in the product repository and needs no entitlement.

**Reclassified as PRO-OPTIONAL.** These require a real preview branch and therefore a paid entitlement. They are not withdrawn, because the capability that implements them is built, tested against seams, and ready; they are conditional on the organisation holding the entitlement at the time of the run:

- **Criterion 23** — DB-changing pull requests obtain isolated preview branches.
- **Criterion 27** — RLS changes verify both denial and allowed access.
- **Criterion 30, Supabase half** — integration tests verify actual Supabase effects. The GitHub half of criterion 30 is retained as required and has been demonstrated against the real remote.

A PRO-OPTIONAL criterion is reported as `NOT_APPLICABLE — entitlement absent` when the organisation is on a plan without branching, and becomes required the moment the entitlement exists. It is never reported as PASS on the strength of a seam test, a scripted double, or an MCP call. The prohibition on substituting unit tests for external proof is unchanged and remains in force.

## 4. What this amendment does not change

- Merge, release and deploy remain outside automatic authority and stay human-controlled.
- Deterministic mutation authority stays with the capability ports; no model executor receives a generic shell as a substitute.
- The parent Supabase project is never an execution target, and no local or shared-dev fallback is introduced by this amendment. Removing the requirement to *prove* preview isolation on a free plan does not permit mutating the parent instead.
- Security auto-repair stays fail-closed; product and design decisions stay BLOCKED rather than auto-fixed.
- Durable state still holds observable facts and no private model reasoning.
- Evidence still records no secrets, connection strings or provider auth material.

## 5. Consequences for the plan set

**Plan D** — Task 5 no longer gates activation on a Claude runtime; it becomes the standing core-independence check under the retained criterion 9. Task 8 keeps every step that runs without the entitlement, including the unavailable-branch fixture that proves BLOCKED, and marks the preview-dependent steps PRO-OPTIONAL. Task 12 may activate V2 with PRO-OPTIONAL criteria unmet, provided the activation record names them.

**The PR-review remediation program** — its completion contract required both real canaries to pass. Under this amendment the Supabase positive canary is PRO-OPTIONAL, so its absence is no longer an unmet requirement. The independent final review's verdict of PARTIAL was issued under the previous contract and stands as the record of that reading; it is not retroactively rewritten. What changes is forward-looking: Plan C is no longer blocked by the deferred canary.

**Plan C** — unblocked with respect to the Supabase entitlement. Its own prerequisites are otherwise unchanged.

## 6. Honest statement of what is now unproven

This amendment reduces what the system promises. It does not increase what has been demonstrated, and the following remains true and should not be read past:

- No real Supabase preview branch has ever been provisioned by this harness. That a real preview reports a ref distinct from its parent, becomes healthy inside the timeout, and accepts a migration is covered only against scripted seams.
- The Supabase capability's positive path is therefore ready rather than proven, and this amendment makes that acceptable rather than making it proven.
- Removing Claude removes an executor, and with it the cross-executor independence that a third product would have supplied. Independence assurance now rests on OpenCode and Codex alone, and when only one of them is usable, `independence:unsatisfied` is recorded exactly as before.
