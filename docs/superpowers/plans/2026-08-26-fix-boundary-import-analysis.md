# Boundary Import Analysis Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Suggested issue title:** `[MEDIUM] Harden Trick boundary gate against multiline/dynamic import bypasses`

**Goal:** Make the reusable-layer boundary gate reliably detect forbidden project-profile imports regardless of formatting while avoiding regex false positives.

**Architecture:** Replace line-by-line import regex detection with TypeScript AST traversal using the workspace's existing TypeScript dependency. Keep the existing layer/group and project-identifier policies, but derive module specifiers and source locations from syntax nodes rather than textual layout.

**Tech Stack:** TypeScript compiler API, Vitest, Node.js.

**Spec:** Embedded below.

## Correction Spec

### Problem

`scripts/check-trick-boundaries.ts` scans each line independently with a regex for `import`, `export from`, dynamic `import()` and `require()`. A multiline module specifier expression can escape detection, making a load-bearing architecture gate dependent on formatting. Text regex can also become brittle around comments/strings and future syntax variants.

### Required behavior

- Detect forbidden static imports regardless of line breaks/whitespace.
- Detect forbidden `export ... from` module specifiers.
- Detect literal dynamic `import('...')` across multiple lines.
- Detect literal CommonJS `require('...')` across multiple lines.
- Preserve exact repo-relative resolution semantics for relative specifiers.
- Preserve fork-local layer direction checks.
- Preserve source file/line diagnostics using syntax-node positions.
- Do not treat import-like text in comments or strings as a real dependency.
- Non-literal dynamic import/require expressions are not guessed; they should either be explicitly rejected by policy if needed or left outside this static dependency rule with documented behavior.

### Non-goals

- Do not build a full bundler/module resolver.
- Do not resolve package exports beyond the existing fork-local package group map.
- Do not change the approved dependency direction.

### Acceptance criteria

- RED tests prove multiline static, export-from, dynamic import and require bypasses are caught.
- Tests prove comments and ordinary strings containing `import`/`require` do not create violations.
- Existing layer-direction tests remain green.
- Diagnostics preserve correct source line numbers.
- `pnpm vitest run scripts/check-trick-boundaries.spec.ts` passes.
- `pnpm run constraints` passes.

## Global Constraints

- Architecture policy remains `core <- providers/integrations <- composition <- profiles`.
- Generic packages cannot import project profiles.
- Use existing dependencies; do not add a parser package when TypeScript already provides the needed AST.

---

### Task 1: Add adversarial RED tests

**Files:**
- Modify: `scripts/check-trick-boundaries.spec.ts`

- [ ] Add multiline static import case:

```ts
import {
  pluroraProfile,
} from '../../../../profiles/plurora/profile.ts'
```

- [ ] Add multiline `export { ... } from` case.
- [ ] Add multiline literal `import(
'../../../../profiles/plurora/profile.ts'
)` case.
- [ ] Add multiline literal `require(
'../../../../profiles/plurora/profile.ts'
)` case.
- [ ] Add negative cases for comments and string literals containing import-like text.
- [ ] Assert violation line numbers refer to the syntax node/module specifier line.
- [ ] Run `pnpm vitest run scripts/check-trick-boundaries.spec.ts`; expected: at least multiline cases FAIL against current regex scan.

### Task 2: Introduce syntax-based module-specifier extraction

**Files:**
- Modify: `scripts/check-trick-boundaries.ts`

**Produces:** a focused helper returning literal module specifiers with source positions.

- [ ] Import `typescript` from the workspace dependency.
- [ ] Parse each authored source file with `ts.createSourceFile`, selecting script kind from extension or using TypeScript's inferred mode.
- [ ] Traverse `ImportDeclaration` and `ExportDeclaration` nodes with string-literal module specifiers.
- [ ] Traverse `CallExpression` nodes for `import()` and identifier `require()` with exactly one string-literal argument.
- [ ] Convert node positions to 1-based lines with `sourceFile.getLineAndCharacterOfPosition()`.
- [ ] Return `{ specifier, line }` records to the existing policy evaluator.

### Task 3: Reuse existing policy evaluation on AST facts

**Files:**
- Modify: `scripts/check-trick-boundaries.ts`

- [ ] Remove `SPECIFIER_PATTERN` as the dependency-discovery authority.
- [ ] For each extracted module record, call the existing `resolveSpecifier`, `reachesProfiles`, package-group and `layerAllows` logic.
- [ ] Preserve existing violation wording where practical to avoid unnecessary snapshot churn.
- [ ] Keep the project-specific identifier scan separate if it is intentionally textual; document that distinction.
- [ ] Run focused tests; expected: PASS.

### Task 4: Add real-source regression evidence

**Files:**
- Modify: `scripts/check-trick-boundaries.spec.ts`

- [ ] Assert current fork-local workspace package groups still resolve correctly.
- [ ] Assert a legal multiline import inside allowed layer direction produces no violation.
- [ ] Assert an upstream `@deepseek-ai/*` import remains outside fork-local layering rules.

### Task 5: Verify and commit

- [ ] Run `pnpm vitest run scripts/check-trick-boundaries.spec.ts`.
- [ ] Run `pnpm run constraints`.
- [ ] Run `pnpm run typecheck`.
- [ ] Inspect the diff for accidental new dependency or changed architecture semantics.
- [ ] Commit: `fix(boundaries): parse imports with typescript ast`.

## Independent verification

Fresh review should attempt formatting-based bypasses, comments/string false positives and both allowed/forbidden cross-layer imports. The gate passes only if behavior is syntax-driven rather than line-layout-driven.