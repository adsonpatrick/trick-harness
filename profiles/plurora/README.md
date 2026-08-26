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

**Bounds are three repair cycles and twenty-four executor starts.** Past three cycles, repeated failure has in practice meant the diagnosis is wrong rather than the fix incomplete; continuing spends budget on the same misunderstanding. The start bound covers a whole workflow including review and QA fan-out, so a stuck run ends as a bounded failure a human can read.

**Delivery automation is deliberately incomplete.** The harness may push the current feature branch and open or update its pull request. It may not force-push, rewrite history, push to the protected default branch, merge, or release. Merge stays a human decision so an automated run is never the last approval on its own work.

**Database work is cloud-only.** Migrations run against an isolated Supabase Preview Branch, with no local and no shared-dev fallback. A fallback path is exactly the path that eventually runs a migration against something that matters.

The policy stores no preview branch name. It names the Supabase project and states that a preview branch is required and that its identity is the pull request the work is running under; the integration resolves the actual branch from the current PR and workflow context at run time. If that branch cannot be resolved or created, the workflow is `BLOCKED` — it never falls back to a shared development branch, and never to a local or Docker database.

**Self-modifying plugins are excluded from trusted composition.** The trusted workflow state machine is what enforces every other rule here. A plugin that can rewrite it at runtime would make the whole policy set advisory, so the exclusion is stated rather than left as an empty list.
