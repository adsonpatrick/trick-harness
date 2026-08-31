# Plurora Host Executable Entrypoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a supported executable that boots and cleanly stops the Plurora host from a NeuroVia checkout without accepting credentials or policy on its command line.

**Architecture:** Keep parsing and lifecycle orchestration in a testable `entrypoint.ts` module. The self-executing `bin.ts` supplies only Node process adapters; it reads the inherited `PLURORA_HARNESS_TOKEN`, owns signal listeners and selects the production seams. The entrypoint creates the `LocalSubprocessRuntime` in a Cordis context, passes its managed `spawn` method to the existing host, and disposes host then runtime in all terminal paths.

**Tech Stack:** TypeScript ESM, Node.js `^22.19.0 || >=24.0.0`, pnpm `11.7.0`, Vitest, Cordis, `@deepseek-ai/dsh-subprocess-local`, existing OpenCode and Codex catalogue adapters.

## Global Constraints

- The executable is owned by `apps/plurora-harness-host`; NeuroVia remains an HTTP control-client consumer and imports no `@trick-harness/*` package.
- The only accepted control credential is inherited `PLURORA_HARNESS_TOKEN`; never read an env file, accept it in argv, include it in diagnostics, or write it to durable state.
- The only accepted arguments are `--help`, `--project-root <absolute-path>`, and `--session-id <non-blank-id>`; unknown, repeated, blank, missing-value and relative-root forms fail before production seams start.
- The executable must preserve `startPluroraHost()` boot ordering, use `createSdkAdapter()`, `nativeCatalogueReader()`, and `ctx.subprocess.spawn`, and pass the inherited environment unchanged to the catalogue reader.
- `SIGINT` and `SIGTERM` abort one controller; successful signal shutdown awaits `host.dispose()` and the subprocess Cordis fiber. Startup failure also releases all acquired resources and exits non-zero.
- Startup output may name only the loopback control URL. Failure output contains error name/message only; no cause, stack, environment value, argv echo, or token.
- No live run is part of automated verification: authenticated OpenCode/Codex catalogue reads require a deliberate operator action and do not authorize database, GitHub, merge, release, deployment, or certification mutations.
- Follow the repository documentation standard: create an Agent Note for this non-trivial lifecycle decision and verify its Markdown links and format.

---

## File Structure

- `apps/plurora-harness-host/src/entrypoint.ts` — validates invocation data, owns startup/shutdown ordering, and exports an injectable runner for unit tests.
- `apps/plurora-harness-host/src/bin.ts` — Node-only executable adapter: `process.argv`, inherited environment, signal handlers, console writers and process exit code.
- `apps/plurora-harness-host/tests/entrypoint.spec.ts` — unit tests for parser, secrecy, production seam wiring, startup failure and orderly shutdown.
- `apps/plurora-harness-host/package.json` — declares the local subprocess implementation.
- `package.json` — exposes `pnpm run plurora-host` via `node --import tsx/esm` for a checked-out workspace.
- `.agents/notes/implemented/architecture/2026-08-31-plurora-host-executable-entrypoint.md` — records the current lifecycle and ownership decision.

### Task 1: Testable invocation parser and lifecycle runner

**Files:**

- Create: `apps/plurora-harness-host/src/entrypoint.ts`
- Create: `apps/plurora-harness-host/tests/entrypoint.spec.ts`
- Modify: `apps/plurora-harness-host/package.json`

**Interfaces:**

- Produces `parsePluroraHostArgs(argv: readonly string[], cwd: string): PluroraHostInvocation` where `PluroraHostInvocation = { readonly help: boolean; readonly projectRoot: string; readonly sessionId?: string }`.
- Produces `runPluroraHost(invocation, runtime): Promise<number>` where `runtime` supplies only injectable environment, logging, signal subscription and `start(options)` seams.
- Consumes `startPluroraHost(options: PluroraHostOptions): Promise<PluroraHost>`, `nativeCatalogueReader(options)`, `createSdkAdapter()`, `Context`, and `LocalSubprocessRuntime`.

- [ ] **Step 1: Write failing parser and lifecycle tests**

Create `tests/entrypoint.spec.ts` with fakes that record construction and disposal. Cover the exact public contract:

```ts
import { describe, expect, it, vi } from 'vitest'
import { parsePluroraHostArgs, runPluroraHost } from '../src/entrypoint.ts'

describe('parsePluroraHostArgs', () => {
  it('uses cwd and accepts an explicit session id', () => {
    expect(parsePluroraHostArgs(['--session-id', 'replay-1'], '/repo')).toStrictEqual({
      help: false, projectRoot: '/repo', sessionId: 'replay-1',
    })
  })

  it.each([
    [['--project-root', 'relative']],
    [['--project-root']],
    [['--session-id', '']],
    [['--session-id', 'one', '--session-id', 'two']],
    [['--token', 'secret']],
  ])('refuses malformed operator input: %j', argv => {
    expect(() => parsePluroraHostArgs(argv, '/repo')).toThrow(/plurora-host:/)
  })
})

it('does not construct a runtime when the inherited token is blank', async () => {
  const runtime = fakeRuntime({ PLURORA_HARNESS_TOKEN: '  ' })
  await expect(runPluroraHost(invocation(), runtime)).resolves.toBe(1)
  expect(runtime.started).toBe(0)
  expect(runtime.lines.join('\n')).not.toContain('PLURORA_HARNESS_TOKEN')
})

it('passes the unmodified environment and managed spawn to the host', async () => {
  const runtime = fakeRuntime({ PLURORA_HARNESS_TOKEN: 'redacted', PATH: '/native/path' })
  runtime.stop()
  await expect(runPluroraHost(invocation(), runtime)).resolves.toBe(0)
  expect(runtime.start).toHaveBeenCalledWith(expect.objectContaining({
    projectRoot: '/repo', controlToken: 'redacted', sessionId: undefined,
    spawn: runtime.managedSpawn,
  }))
  expect(runtime.catalogue).toHaveBeenCalledWith(expect.objectContaining({ env: runtime.env }))
  expect(runtime.lines.join('\n')).not.toContain('redacted')
  expect(runtime.disposal).toEqual(['host', 'subprocess'])
})
```

Add cases where `start` rejects after runtime creation (exit `1`, dispose subprocess, error name/message only) and where `--help` emits usage and does not read a token or construct any seam.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
corepack pnpm exec vitest run apps/plurora-harness-host/tests/entrypoint.spec.ts
```

Expected: FAIL because `../src/entrypoint.ts` does not exist.

- [ ] **Step 3: Implement parsing and runner ownership**

Create `src/entrypoint.ts`. Use `node:path` `isAbsolute()` and `resolve()` only to validate and normalize the selected root. Parse argv left-to-right; `--help` may appear alone, and every other occurrence is an error. Emit the following non-secret usage text exactly from the runner:

```ts
const USAGE = 'Usage: plurora-host [--project-root <absolute-path>] [--session-id <id>]'
```

Define a narrow injected runtime with this shape so tests never start product processes:

```ts
export interface PluroraHostRuntime {
  readonly cwd: string
  readonly env: Record<string, string | undefined>
  readonly writeOut: (line: string) => void
  readonly writeError: (line: string) => void
  readonly subscribeTermination: (listener: () => void) => () => void
  readonly createSubprocess: () => Promise<{ spawn: PluroraHostOptions['spawn']; dispose(): Promise<void> }>
  readonly createCatalogue: (options: NativeCatalogueOptions) => ModelCatalogReader
  readonly createOpencode: () => OpencodeAdapter
  readonly start: (options: PluroraHostOptions) => Promise<PluroraHost>
}
```

`runPluroraHost()` must first return `0` for `help`; then reject a missing/trim-empty token with the fixed diagnostic `plurora-host: PLURORA_HARNESS_TOKEN is required`. Only after that check may it create the subprocess runtime, catalogue, adapter and host. Create an `AbortController`, subscribe once, and let the subscription call `controller.abort()`. After a successful `start`, emit `plurora-host: listening on http://${host.control.host}:${host.control.port}` and await a promise resolved by the signal listener. In `finally`, unsubscribe, await `host.dispose()` if created, then await subprocess disposal. Catch errors at the outer boundary and emit only `plurora-host: ${error.name}: ${error.message}` when `error instanceof Error`, otherwise `plurora-host: startup failed`; return `1`.

Implement `createProductionRuntime()` in the same module. It creates a `Context`, awaits `ctx.plugin(LocalSubprocessRuntime)`, returns `ctx.subprocess.spawn` plus `fiber.dispose()`, calls `nativeCatalogueReader({ projectRoot, env, disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS, spawn, signal })`, and returns `createSdkAdapter()` and `startPluroraHost`. Add `@deepseek-ai/dsh-subprocess-local` as a workspace dependency in the host package.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
corepack pnpm exec vitest run apps/plurora-harness-host/tests/entrypoint.spec.ts
corepack pnpm run typecheck:plurora-host
```

Expected: both PASS.

- [ ] **Step 5: Commit the testable runtime entrypoint**

```bash
git add apps/plurora-harness-host/src/entrypoint.ts apps/plurora-harness-host/tests/entrypoint.spec.ts apps/plurora-harness-host/package.json
git commit -m "feat(trick): add Plurora host lifecycle runner"
```

### Task 2: Self-executing bin, workspace command, and lifecycle record

**Files:**

- Create: `apps/plurora-harness-host/src/bin.ts`
- Modify: `apps/plurora-harness-host/package.json`
- Modify: `package.json`
- Create: `.agents/notes/implemented/architecture/2026-08-31-plurora-host-executable-entrypoint.md`
- Test: `apps/plurora-harness-host/tests/entrypoint.spec.ts`

**Interfaces:**

- Consumes `parsePluroraHostArgs`, `createProductionRuntime`, and `runPluroraHost` from Task 1.
- Produces the workspace command `pnpm run plurora-host -- [args]`.

- [ ] **Step 1: Extend tests for Node process adaptation**

Add a testable `runProcess(argv, processLike)` export in `src/bin.ts`; give `processLike` `argv`, `cwd()`, `env`, `on`, `off`, `stdout.write`, `stderr.write`, and mutable `exitCode`. Test that it strips the node/script entries, delegates signal subscription for both `SIGINT` and `SIGTERM`, sends help to stdout, sends errors to stderr, and sets `exitCode` to the runner result without calling `process.exit()`.

```ts
it('maps Node process input without force-exiting during teardown', async () => {
  const processLike = fakeProcess(['node', 'bin.ts', '--help'])
  await runProcess(processLike, fakeRuntime())
  expect(processLike.exitCode).toBe(0)
  expect(processLike.stdout).toContain('Usage: plurora-host')
  expect(processLike.exit).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the new bin test and confirm RED**

Run:

```bash
corepack pnpm exec vitest run apps/plurora-harness-host/tests/entrypoint.spec.ts
```

Expected: FAIL because `runProcess` and `src/bin.ts` do not exist.

- [ ] **Step 3: Implement the executable and package wiring**

Create `src/bin.ts` with `#!/usr/bin/env node`, a module JSDoc block, `runProcess()`, and a single top-level call:

```ts
const result = await runProcess(process)
process.exitCode = result
```

`runProcess()` must subscribe using both `processLike.on('SIGINT', listener)` and `processLike.on('SIGTERM', listener)`, return cleanup callbacks that call `off`, and delegate all interpretation to `parsePluroraHostArgs()` and `runPluroraHost()`. Do not use `process.exit()`: Node must retain enough event-loop time for the awaited disposer chain.

Add to root `package.json` scripts:

```json
"plurora-host": "node --import tsx/esm apps/plurora-harness-host/src/bin.ts"
```

Create the Agent Note under the `architecture` implemented-note directory. State the durable current contract: the host is started from a project root, only the inherited token grants control-server access, the process owns its signal-to-abort bridge, all acquired resources quiesce before exit, and authenticated live catalogues are intentionally outside automated tests. Link to `apps/plurora-harness-host/src/entrypoint.ts` and the executable spec; do not duplicate a tutorial or change narrative.

- [ ] **Step 4: Run focused and host-wide verification**

Run:

```bash
corepack pnpm exec vitest run apps/plurora-harness-host/tests/entrypoint.spec.ts
corepack pnpm --filter @trick-harness/plurora-host test
corepack pnpm run typecheck:plurora-host
corepack pnpm run verify-md-links
corepack pnpm run verify-agent-note-format
git diff --check
```

Expected: every command exits `0`. Do not run the executable against an authenticated account as part of this task.

- [ ] **Step 5: Commit the executable surface and documentation**

```bash
git add apps/plurora-harness-host/src/bin.ts apps/plurora-harness-host/src/entrypoint.ts apps/plurora-harness-host/tests/entrypoint.spec.ts apps/plurora-harness-host/package.json package.json .agents/notes/implemented/architecture/2026-08-31-plurora-host-executable-entrypoint.md
git commit -m "feat(trick): expose the Plurora host executable"
```

### Task 3: Independent verification and NeuroVia handoff boundary

**Files:**

- Verify: `apps/plurora-harness-host/src/entrypoint.ts`
- Verify: `apps/plurora-harness-host/src/bin.ts`
- Verify: `apps/plurora-harness-host/tests/entrypoint.spec.ts`
- Verify: `docs/superpowers/specs/2026-08-31-plurora-host-executable-entrypoint.md`

**Interfaces:**

- Consumes the executable committed by Tasks 1–2.
- Produces fresh evidence that the host has a bounded startup/shutdown interface; it does not produce a live NeuroVia certification or cloud database claim.

- [ ] **Step 1: Run an independent code review**

Review the committed diff against the approved specification. Reject it if any path accepts a token outside `PLURORA_HARNESS_TOKEN`, logs raw errors/environment/argv, starts a resource before argument/token validation, fails to dispose host or subprocess runtime, binds a non-loopback endpoint, or introduces a NeuroVia import into Trick Harness.

- [ ] **Step 2: Re-run verification from a clean process**

Run:

```bash
corepack pnpm --filter @trick-harness/plurora-host test
corepack pnpm run typecheck:plurora-host
corepack pnpm run verify-md-links
corepack pnpm run verify-agent-note-format
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 3: Record the integration handoff**

Record in the task report that this completes only the external host blocker. The subsequent NeuroVia task must repin `plurora-harness.json` to the reviewed Harness commit, supply its required `project.protectedBranch` and current semantic registry, run `npm run harness:check`, and perform a live start only with an explicit operator-provided environment token. It must not claim host, database, GitHub-status, branch-protection, or certification evidence before that controlled run. Do not commit a task report or `.scratch/` artifact.

## Self-Review

1. **Spec coverage:** Task 1 implements criteria 1–4 and malformed-input/credential boundaries; Task 2 implements criteria 5–7 and the required durable rationale; Task 3 independently checks every boundary and explicitly leaves authenticated live startup to the operator.
2. **Placeholder scan:** searched the plan for the workflow's prohibited placeholder patterns; none are present.
3. **Type consistency:** `PluroraHostInvocation`, `parsePluroraHostArgs`, `runPluroraHost`, `createProductionRuntime`, and `runProcess` retain identical spellings and call direction across all tasks.
