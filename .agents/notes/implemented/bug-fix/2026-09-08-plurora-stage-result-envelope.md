# Agent Note: Plurora stage-result envelope recovery

Status: implemented

English | [中文](2026-09-08-plurora-stage-result-envelope.zh.md)

## Problem

The Plurora host could parse a stage's final `HARNESS-RESULT:` JSON object and still reject the stage-result contract without giving an operator a durable distinction from a missing or unreadable envelope. The ordinary-stage prompt named top-level fields but did not show a complete JSON object, so an executor could omit required structure while attempting to comply.

## Decision

`workflow-handlers.ts` reports a parsed-but-invalid stage result as `stage-result-invalid` and keeps the diagnostic fixed. It does not journal the model output, parser message, rejected value, or contract path. Other unreadable-envelope failures remain distinct from this contract rejection.

The ordinary-stage prompt ends with a complete, valid JSON example containing `verdict`, `summary`, `findings`, and `evidence`. It requires that single final line without a fence or following prose, names the accepted verdict and evidence vocabularies, and states the required shape for a non-empty finding.

## Verification

`apps/plurora-harness-host/tests/workflow-handlers.spec.ts` proves the safe rejection code excludes rejected model text and pins the canonical envelope. `apps/plurora-harness-host/tests/stage-result-prompt.snapshot.ts` snapshots the prompt assembled through the real host handler without a model credential.

## Alternatives considered

- **Journal the parser error or final model message** - rejected because either can contain repository-derived secrets and would put unbounded model content into durable state.
- **Relax the stage-result contract** - rejected because missing evidence or findings structure would weaken the workflow's evidence boundary instead of explaining the rejected report.
- **Retry the stage without a diagnosis** - rejected because a retry can repeat writes and leaves the operator unable to distinguish a report-shape problem from an executor failure.

## Consequences

- An operator can identify a stage-result schema mismatch from the bounded workflow status while raw stage output remains outside the journal.
- Executors receive a reproducible envelope for the ordinary no-finding case and explicit requirements when findings exist.
- A canary retry must start a new workflow after the reviewed Harness revision is pinned; it cannot turn a blocked workflow into evidence retroactively.
