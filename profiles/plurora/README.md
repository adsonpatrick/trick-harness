# Plurora profile

Plurora's policy set: the first production consumer of the reusable Trick Harness core. Every project-specific decision the harness acts on for Plurora is assembled in [profile.ts](profile.ts) from the modules beside it.

## Files

| File | Owns |
| --- | --- |
| [routing-policy.ts](routing-policy.ts) | Which executor and semantic model tier each stage and risk level gets, and where work goes when an executor is unavailable. |
| [workflow-policy.ts](workflow-policy.ts) | Repair-cycle and executor-start bounds, and the required review independence per risk level. |
| [qa-policy.ts](qa-policy.ts) | What evidence a change of each shape must produce before it is eligible for human merge. |
| [security-policy.ts](security-policy.ts) | Which changed surfaces select security review, and which plugins are excluded from trusted composition. |
| [integrations.ts](integrations.ts) | Which integrations are enabled and the limits placed on each. |

## Decisions worth knowing before you edit

**Routing names tiers, never model ids.** `codex.frontier` and `opencode.workhorse` are resolved by the core semantic model registry. A model generation change is therefore one edit in core, not a rewrite across every profile — and a test here fails if a literal model name creeps into the table.

**Fallbacks cross executors.** When a primary executor is unavailable, work moves to the other one rather than retrying the same executor at a lower tier. An outage is the usual cause, and a same-executor retry would spend the start budget without changing the outcome.

**An OpenCode outage may send heavy work to Codex, and may also stop the run.** The heavy-work invariant binds the primary route. When OpenCode is unavailable the work falls back to Codex while Codex is usable, and the fallback is never silent: the durable route fact names what it fell back from. With no usable executor left the run blocks, and that block is the expected outcome rather than a defect — the alternative is routing heavy mechanical work to a product that cannot take it, or inventing a route to one that is not there. Every reroute is a real start and is charged against the start budget below.

**A person may override one stage's route, and only one.** The override names a role, an executor and a semantic tier for a single run. It is spent on the first stage of that role, recorded in the durable route facts, and carried into nothing else: not the next stage, not the next run, and never into this table. Permission mode still follows the role, so an override cannot give a reviewing stage a writable working tree.

**Bounds are three repair cycles and twenty-four executor starts.** Past three cycles, repeated failure has in practice meant the diagnosis is wrong rather than the fix incomplete; continuing spends budget on the same misunderstanding. The start bound covers a whole workflow including review and QA fan-out, so a stuck run ends as a bounded failure a human can read.

**Delivery automation is deliberately incomplete.** The harness may push the current feature branch and open or update its pull request. It may not force-push, rewrite history, push to the protected default branch, merge, or release. Merge stays a human decision so an automated run is never the last approval on its own work.

**Database work is cloud-only.** Migrations run against an isolated Supabase Preview Branch, with no local and no shared-dev fallback. A fallback path is exactly the path that eventually runs a migration against something that matters.

The policy stores no preview branch name. It names the Supabase *parent* project and states that a preview branch is required and that its identity is the pull request the work is running under; the integration resolves the actual branch from the current PR and workflow context at run time. If that branch cannot be resolved or created, the workflow is `BLOCKED` — it never falls back to a shared development branch, and never to a local or Docker database.

The capability ids in `enabled` are the ids the composition consumes, spelled the same way. A profile that spells one differently does not fail to load — it turns that capability off and says nothing about having done so, which is the quieter and worse of the two failures available.

**Self-modifying plugins are excluded from trusted composition.** The trusted workflow state machine is what enforces every other rule here. A plugin that can rewrite it at runtime would make the whole policy set advisory, so the exclusion is stated rather than left as an empty list.

## The absence of a fallback is asserted, not just intended

Two tests hold this. One reads every string in the profile — not only the Supabase rule — and fails if `--local`, `--linked`, `supabase start`, `db reset`, `test db` or `neurovia-dev` appears anywhere in it, because a fallback added later would be added somewhere and the point is that there is no somewhere it could hide. The other composes this profile for real and runs a whole preview validation through it, then reads back every command the capability issued and asserts the same set is absent, and that the parent project ref appears only where branches are created and asked about.
