# Plurora Host Executable Entrypoint

- **Date:** 2026-08-31
- **Status:** Proposed — owner approved the direction; implementation awaits plan review
- **Scope:** The executable bootstrap for `apps/plurora-harness-host`

## Problem

`startPluroraHost()` is a tested composition boundary, but it deliberately requires injected product seams. No executable supplies the local subprocess runtime, native model catalogues, OpenCode SDK adapter, cancellation signal, project root, or environment-only control token. NeuroVia can verify its pinned Trick Harness checkout and address an already-running loopback server, but cannot start that server through a supported host interface.

## Decision

The Trick Harness repository owns the `plurora-host` workspace command. Its source entrypoint lives in `apps/plurora-harness-host/src/bin.ts`; the root workspace runs it through Node with `tsx`. It is not a NeuroVia script and NeuroVia does not import any private Harness package.

The executable accepts an optional `--project-root <absolute-path>` and `--session-id <id>`. Without `--project-root`, it uses the current working directory. It refuses unknown, repeated, missing-value, relative-root, or blank arguments. The project root is the only filesystem target supplied by the operator; `plurora-harness.json` remains the source of deployment policy and endpoint selection.

`PLURORA_HARNESS_TOKEN` is the only control credential accepted by the executable. It is read from the inherited process environment, never from the deployment file or argv, and is never interpolated into output. A missing or blank token fails before any product, session, subprocess, or listener is started.

The bootstrap creates the production seams required by `startPluroraHost()`: `createSdkAdapter()`, `nativeCatalogueReader()` over the unchanged inherited environment, and the local managed subprocess runtime. It creates one abort controller and converts `SIGINT` and `SIGTERM` into its signal. Once startup succeeds it writes a non-secret readiness line containing the loopback URL and waits for cancellation. On startup failure it reports only the error name and message, sets a non-zero exit code, and disposes every resource it acquired. On a signal it waits for `host.dispose()` and the local subprocess runtime to quiesce before exiting.

## Boundaries

- The entrypoint does not read `.env` files, create credentials, alter provider authentication, clone/fetch/check out repositories, or modify `plurora-harness.json`.
- It does not make GitHub, database, merge, release, deploy, or certification mutations merely by starting.
- It does not add project-specific policy: the exact repository, profile, development environment, cloud database strategy, loopback endpoint and certification context remain enforced by the deployment parser and host composition.
- It preserves the existing boot order: token/config/policy/native catalogue failures happen before durable session creation or control-server binding.

## Acceptance Criteria

1. `pnpm run plurora-host -- --help` describes the supported arguments without attempting a start.
2. Argument parsing rejects malformed operator input before constructing production seams.
3. A blank or absent `PLURORA_HARNESS_TOKEN` exits non-zero without exposing a credential or starting a resource.
4. The executable passes the inherited environment unchanged to the native catalogue reader, binds production OpenCode and managed subprocess seams, and passes the selected root/session id to `startPluroraHost()`.
5. A successful start emits only non-secret endpoint information, remains alive, and exits cleanly after `SIGINT` or `SIGTERM`, awaiting host and subprocess teardown.
6. A failed start exits non-zero after disposing already-acquired resources; diagnostics contain no environment values or raw credential-bearing causes.
7. Focused Vitest coverage and `pnpm run typecheck:plurora-host` pass. The existing host test suite continues to pass.

## Verification Limits

Automated tests use fakes for the process seams and never require an authenticated Codex or OpenCode account. A live startup is an explicit operator action because it reads native authenticated catalogues. It is evidence of the host runtime only; it does not certify a NeuroVia branch or authorize a shared-cloud database workflow.
