# Agent Note: Plurora host executable lifecycle

Status: implemented

English | [中文](2026-08-31-plurora-host-executable-entrypoint.zh.md)

## Problem

The Plurora deployment host required callers to assemble its production process, provider, catalogue, signal, and credential seams. NeuroVia only owns a verified checkout and a loopback control client, so it could not start the host through a maintained interface.

## Decision

[`plurora-host`](../../../../apps/plurora-harness-host/src/bin.ts) is the package-owned executable. It accepts only a project root and optional session id, reads its control credential exclusively from inherited `PLURORA_HARNESS_TOKEN`, and passes the unmodified inherited environment to native model catalogue discovery. Argument and token checks complete before it creates a subprocess service, durable session, provider transport, or listener.

The executable translates `SIGINT` and `SIGTERM` into one abort signal. Its lifecycle runner disposes the composed host before the local managed subprocess context and awaits both, including after failed startup. Output names a loopback endpoint or a bounded error; it never prints environment values, raw causes, or a control token. The approved [entrypoint specification](../../../../docs/superpowers/specs/2026-08-31-plurora-host-executable-entrypoint.md) defines its operator contract.

## Alternatives considered

- **A NeuroVia launcher that imports Harness packages** — it would make the product own runtime seams and bypass the checkout/control-client boundary.
- **A shell-only wrapper** — it would leave parsing, signal ownership, and cleanup platform-dependent and untestable.

## Consequences

- A checked-out Trick Harness exposes one supported process entrypoint while `startPluroraHost()` remains injectable for tests.
- A live start still requires deliberately supplied native provider authentication; automated tests exercise only fakes and make no GitHub, database, release, deployment, or certification claim.
- NeuroVia must repin to a reviewed Harness commit before it can use this executable.
