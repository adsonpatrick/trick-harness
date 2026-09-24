# Agent Note: Plurora approved-artifact Markdown extraction

Status: implemented

English | [中文](2026-09-24-plurora-approved-artifact-markdown.zh.md)

## Problem

The deterministic conformance reader treated one Markdown spelling as the obligation contract: Specs needed explicit bold identifiers and Plans needed level-three English `Task` headings. A human-readable approved artifact could therefore state acceptance criteria or tasks clearly in another common Markdown form while the workflow reported that it declared no obligations.

## Decision

Explicit Spec declarations such as `- **AC1:** requirement` remain valid anywhere in the document. Inside a named acceptance section, the reader also accepts top-level ordered, unordered, and checkbox list items and assigns stable `SPEC-CRITERION-N` identifiers in document order. Acceptance headings are recognized in English, Portuguese, and Spanish after case, accent, and trailing-colon normalization.

Plan tasks are recognized from level-two or level-three `Task N` and `Tarefa N` headings with a colon, period, hyphen, en dash, or em dash separator. Deeper headings remain task details. The same task recognition controls Plan write-set extraction, so an alternate task heading does not separate obligation scoring from delivery scope.

The reader remains deterministic. Lists outside a recognized acceptance section, prose that merely mentions a criterion, and unnamed Plan headings establish no obligation.

## Verification

`packages/core/engineering-workflow/tests/conformance.spec.ts` covers explicit identifiers, numbered and bulleted acceptance sections, English and Portuguese headings, task depths, generated identifiers, section boundaries, and empty-artifact refusal. The Plurora conformance end-to-end suite proves the resulting manifest remains enforceable through final verification.

## Alternatives considered

- **Ask a model to infer obligations from arbitrary prose** - rejected because the implementation would be judged against a nondeterministic set chosen during the run.
- **Treat every document list as an obligation** - rejected because examples, context, risks, and references commonly use lists and would silently widen the approved contract.
- **Require one canonical Markdown spelling** - rejected because presentation differences that preserve clear section semantics should not make an otherwise approved artifact unreadable.

## Consequences

- Common Spec and Plan formats remain machine-readable without requiring every author to memorize one exact Markdown template.
- The recognized headings and list boundaries are finite and testable; genuinely unstructured prose still fails closed.
- Generated criterion identifiers are stable for unchanged document order, so conformance answers can be checked exactly.
