# Agent Note: Plurora delivery uses a policy-safe commit subject

Status: implemented

English | [中文](2026-09-24-plurora-delivery-commit-subject.zh.md)

## Problem

A workflow objective is natural-language input, not a Git commit subject. Using it as the subject lets punctuation, capitalization, length, or arbitrary phrasing violate the target repository's commit-message policy after implementation and verification have passed.

## Decision

The [Plurora delivery description](../../../../apps/plurora-harness-host/src/workflow-handlers.ts) always records `chore(harness): deliver approved workflow change` as the commit subject. The objective id and delivery stage remain in the commit body, while the bounded natural-language requirement remains the PR title.

The fixed subject is deterministic, repository-neutral, and valid Conventional Commit syntax. Workflow text cannot select a commit type, scope, or description.

## Alternatives considered

**Normalize the objective into Conventional Commit syntax.** Inferring a type and scope from prose is ambiguous, and rewriting arbitrary text still creates repository-specific length and character-policy risks.

**Parse a requested commit message from the approved Plan.** This expands the Plan contract and gives document prose control over Git metadata without a dedicated validated field.

**Keep the objective as the commit subject.** Bounding the text limits size but does not satisfy syntax policies.

## Consequences

Delivery commits have a generic subject; the PR title and commit trailers retain workflow-specific identity. Repositories with stricter policies than Conventional Commits may still refuse delivery and require an explicit deployment-level policy.

The [handler regression test](../../../../apps/plurora-harness-host/tests/workflow-handlers.spec.ts) separates the fixed commit subject from the descriptive PR title. The [keyless delivery snapshot](../../../../apps/plurora-harness-host/tests/delivery-branch.snapshot.ts) records the subject from a real temporary Git commit and push.
