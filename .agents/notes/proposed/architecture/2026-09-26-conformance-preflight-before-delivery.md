# Agent Note: Conformance preflight before delivery

Status: proposed

English | [中文](2026-09-26-conformance-preflight-before-delivery.zh.md)

## Problem

The pull-request workflow publishes a branch before its first conformance result is read. A malformed or unreadable StageResult can therefore create a delivery side effect before the run knows whether the approved Spec and Plan can be evaluated.

## Proposal

Run a read-only conformance preflight after implementation verification and before the first delivery capability call. Only a valid `PASS` permits that call. Keep the post-publication conformance reading and final verification: preflight does not incorporate the measured delivered change set, and it does not certify the published revision. Re-run conformance after a repair changes the branch.

## Alternatives considered

**Keep conformance after delivery and rely on `PR_READY` refusal.** This preserves review ordering but still creates a branch or pull request when the conformance result is unreadable, so it does not prevent the side effect that exposed this gap.

**Move every review before delivery.** This avoids publishing before any review but makes reviewers inspect a working tree that no human can inspect on GitHub and changes the workflow's review contract.

## Acceptance criteria

- A missing, malformed, or non-passing preflight result ends the run before the delivery capability is called.
- A passing preflight permits delivery, while the final conformance reading and final verification remain required for `PR_READY`.
- A repair invalidates earlier conformance evidence and requires a fresh reading for the repaired branch.

## Risks

Preflight reads the approved documents and planned work before delivery has measured the final change set. The later conformance reading must remain authoritative for final certification and must account for the delivered paths.
