# Agent Note: Trick Harness fork foundation

Status: implemented

## Problem

Plurora needs a durable engineering harness that orchestrates multiple coding executors, enforces lifecycle invariants outside model memory, routes work by cost and capability, and survives subscription quota exhaustion. DeepSeek Harness already solves the hard runtime problems this needs — plugin/profile/bundle composition, capability seams, a durable session log, scoped tool authority, bounded workflow orchestration, cancellation to quiescence — so re-implementing it would be waste dressed as ownership.

Two failure modes had to be foreclosed before any runtime code was written. The first is a fake fork: an empty repository, an archive upload, or a history-less copy that claims ancestry it cannot demonstrate, leaving the project unable to merge upstream fixes and unable to show where its code came from. The second is unbounded divergence: a fork that edits generic upstream core wherever convenient becomes unmergeable within a release or two, and the cost lands exactly when an upstream security fix needs to be pulled in.

There is also a licensing obligation. Upstream ships MIT, and a fork that quietly drops the notice or republishes fork-local code under upstream's release identity is a compliance problem, not a style problem.

## Decision

`adsonpatrick/trick-harness` is a real GitHub fork of `deepseek-ai/deepseek-harness`, verified through the GitHub API rather than asserted: `gh repo view --json isFork,parent` reports `isFork=true` with parent `deepseek-ai/deepseek-harness`. The fork gate runs before any runtime change, and a false result blocks the work rather than being worked around by populating an independent repository and calling it a fork.

The baseline is pinned to exact SHAs in [docs/trick-harness/upstream.md](../../../../docs/trick-harness/upstream.md). At the baseline `origin/master`, `upstream/master`, and `git merge-base HEAD upstream/master` are all `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`, so the fork starts with zero behavioral divergence from upstream `0.1.1-rc.2`. That file is also the divergence ledger: every change to a generic upstream package or gate is recorded there with the extension seam that was considered and rejected.

The `upstream` remote is a required part of the working configuration, not an optional convenience. Keeping it reachable is what makes ancestry verifiable and merges possible; a clone that loses it is repaired rather than tolerated.

Divergence is governed by one rule: prefer extension over core divergence. Fork-local behavior belongs in fork-local packages, project profiles, bundles and plugins, executor providers, capability policies, and workflow definitions. Editing generic upstream core such as `packages/core/agent-loop` requires evidence that no documented extension point can express the requirement, and that evidence goes in the ledger.

The upstream MIT `LICENSE` and `THIRD_PARTY_NOTICES.md` are preserved verbatim. Fork-local packages take a distinct private scope and are never published, so fork-local code never rides on upstream's release identity.

## Alternatives considered

**Re-implement the orchestration runtime from scratch.** This buys total freedom and pays for it twice: once to rebuild session durability, capability seams, subagent lifecycle, and cancellation semantics that already work, and again forever, because every upstream fix would have to be re-derived rather than merged. The runtime problems DeepSeek Harness solves are not the problems Plurora is trying to solve.

**Vendor DeepSeek Harness as a dependency and extend it from outside.** Rejected because the required work reaches surfaces a consumer cannot reach: workspace gates, TypeScript project references, the release-member policy, and the executor transport all need repository-level change. A consumer-only posture would have forced those changes into awkward wrappers while still leaving no path to contribute fixes back.

**Copy the source into a fresh repository without the GitHub fork relationship.** This is the tempting shortcut, and it is what the fork gate exists to prevent. It looks identical on day one and diverges into an unmergeable dead end, with no mechanical way to prove provenance and no `upstream` remote to fetch from.

**Track a pinned upstream tag and never sync.** Rejected because it converts every upstream security fix into a manual backport. The accepted risk is the opposite one: upstream breaking changes are absorbed, and the ledger keeps the divergence intentional and reviewable.

**Let divergence be governed by review judgment alone.** Rejected because "prefer extension" without a written evidence requirement decays under deadline pressure. Requiring the rejected seam to be named in the ledger makes the cheap edit visibly more expensive than the correct one.

## Consequences

Upstream fixes remain mergeable, and the cost of that is real: upstream breaking changes are accepted risk, and a sync can require reworking fork-local adapters. The ledger makes that cost visible and attributable instead of discovering it during an emergency merge.

Recording exact SHAs rather than branch names means the baseline cannot silently drift. It also means the record goes stale by design and must be updated on each sync — a branch name would have looked more durable while telling the reader nothing about what was actually built.

Requiring evidence before editing generic core makes some changes deliberately harder. That is the intended trade: the friction is paid in fork-local packages and profiles, which is where fork-local behavior belongs anyway.

The private fork-local scope keeps the fork out of upstream's publication path entirely, at the cost of never being able to publish a fork-local package without a separate approved decision. That decision has not been made and is not implied by this note.
