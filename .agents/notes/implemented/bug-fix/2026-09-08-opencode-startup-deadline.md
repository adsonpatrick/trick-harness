# Agent Note: OpenCode server startup deadline

Status: implemented

English | [中文](2026-09-08-opencode-startup-deadline.zh.md)

## Problem

OpenCode cold starts on Windows can exceed the SDK's five-second default. An activation workflow recorded executor failure after 5818 ms; an isolated SDK startup reproduced the five-second timeout, while the same startup with a sixty-second limit became ready after 12961 ms. The generic provider diagnostic hides this distinction from operators.

## Decision

The real adapter requires an explicit startup deadline. The Plurora executable supplies sixty seconds by default and validates `PLURORA_OPENCODE_STARTUP_TIMEOUT_MS` before creating resources. This bound covers readiness, not prompt execution. The SDK continues to own its timer, cancellation and startup-failure termination.

An exact SDK startup-timeout exception becomes `OpencodeStartupTimeoutError`, with a bounded explanation containing only the configured duration. Other exceptions retain the existing generic diagnostic. Startup timeout remains a provider failure without automatic fallback.

## Alternatives considered

**Keep the SDK default and retry.** The observed cold start exceeds that limit; retries do not address the deadline and can obscure a reproducible failure.

**Increase the outer launcher health timeout.** The failing timer belongs to the per-stage OpenCode server after the host is already healthy, so the launcher cannot change it.

**Remove the startup deadline.** A server that never announces readiness still needs a bounded failure and cancellation path.

## Consequences

Slow healthy startup can finish, while a failed startup can take longer to report. Operators can tune the bound without modifying a pinned checkout. A fresh host is required after changing the setting.

SDK-boundary tests exercise delayed readiness, timeout diagnostics, redaction and cancellation. The assembled Plurora snapshot records startup failure before delivery. The local startup reproduction makes no model request; it does not certify the full live canary or operating-system teardown on every platform.
