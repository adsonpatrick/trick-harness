# NeuroVia remediation — stable deployment CLI runtime evidence

Evidence for the 2026-09-01 NeuroVia remediation design, section 1 (stable Trick
Harness deployment contract) and section 8 (testing strategy). Recorded on
2026-09-01 on branch `feat/plurora-host-deploy-cli`, worktree isolated at the
pinned base `9ee7ca83258ff607b6f4edca3c429fa19ed4e07f`.

installationAuthoritySha: 1ca7c218b2ab070ed5d1efbad8039bbcf621d0dd

The installation-authority SHA above is the runtime commit (`feat(trick): expose
stable Plurora host CLI`). This evidence file is a later docs-only commit and
is not the revision a deployment pins.

## 1. What the runtime commit adds

The root consumer contract `corepack pnpm run plurora-host` (unchanged script,
already pointing at `apps/plurora-harness-host/src/bin.ts`) now accepts:

```text
plurora-host validate --project-root <absolute-neurovia-root>
plurora-host serve --project-root <absolute-neurovia-root> --ready-file <absolute-json-path>
```

- `validate` runs the same deployment-config, policy-version, model-registry and
  native-catalogue validation that `serve` starts the host on — both commands
  share one reading, `validatePluroraDeployment` in `main.ts` — and changes
  nothing on the machine: no durable session, no control-port bind, no
  GitHub/database mutation. It does not require `PLURORA_HARNESS_TOKEN`, which
  guards only the control server `serve` binds.
- `serve` requires `PLURORA_HARNESS_TOKEN`, starts the host, and only after the
  control server is listening atomically publishes the ready document at
  `--ready-file` (write to a `.tmp` sibling, then rename; `0o600`). The
  envelope is exactly:

  ```text
  {"schemaVersion":1,"status":"READY","controlUrl":"http://127.0.0.1:<port>"}
  ```

  A failed start publishes nothing. `SIGINT`/`SIGTERM` abort the host, wait for
  `dispose()` and preserve the failure exit code when teardown succeeds.
- The legacy bare invocation (`plurora-host --project-root <path>
  [--session-id <id>]`) remains accepted unchanged.
- The plan named a `cli.ts`; the repository's real structure is
  `bin.ts`/`entrypoint.ts`, so the CLI was implemented in `entrypoint.ts`
  (parse + lifecycle) with the new tests in `tests/cli.spec.ts`. No duplicate
  or parallel CLI file was created.

## 2. TDD evidence

RED — `node_modules/.bin/vitest.cmd run apps/plurora-harness-host/tests/cli.spec.ts`
before any implementation: **10 failed, 1 passed**. The failures were exactly
the absent surface: `plurora-host: unknown argument "validate"/"serve"` from
the legacy parser, no `--ready-file` handling, no `writeReadyFile` seam on the
runtime, and the process adapter not mapping `serve`.

GREEN — the same command after implementation, together with the touched
`entrypoint.spec.ts`: **25/25 passed**. The entrypoint fixture gained the new
required `writeReadyFile` seam member and the help-text expectation was updated
to the new usage; both are mechanical consequences of the deliberate contract
change, not behavior changes.

## 3. Deterministic gates

All gates run in the isolated worktree with the direct binaries, because
`corepack pnpm` runs a deps-status check that fails inside a worktree.

| Gate | Result |
| --- | --- |
| `vitest run apps/plurora-harness-host/tests/cli.spec.ts apps/plurora-harness-host/tests/host.spec.ts apps/plurora-harness-host/tests/catalogue.spec.ts apps/plurora-harness-host/tests/entrypoint.spec.ts` | pass — 4 files, 51 tests |
| `tsx scripts/check-workspace-constraints.ts` | pass |
| `tsx scripts/check-trick-boundaries.ts` | pass |
| `tsc -b apps/plurora-harness-host/tsconfig.json` | pass |
| `tsx scripts/run-oxlint.ts .` | pass |
| `vitest run packages/core packages/providers packages/integrations packages/composition profiles apps/plurora-harness-host` (`test:trick` equivalent) | pass — 104 files, 2520 tests |

Nothing is left pending in the deterministic gate set; the full `test:trick`
scope ran fresh with exit 0.

## 4. Real smoke, against disposable credential copies

The authenticated OpenCode/Codex credential directories were copied into a
throwaway staging area and every run pointed `CODEX_HOME`, `XDG_CONFIG_HOME`
and `XDG_DATA_HOME` at the copies. SHA-256 of `codex/config.toml`,
`codex/auth.json`, `opencode/opencode.jsonc` and `opencode/auth.json` was
computed before and after — for the copies and the originals — and was
identical: `credentialsUnchanged: true`, `changed: []`.

The deployment contract exercised was a throwaway checkout holding a copy of
NeuroVia's real `plurora-harness.json` (read from `neuro-via`, never written).

### 4a. Process-level smoke (the contract NeuroVia runs)

| Step | Result |
| --- | --- |
| `node --import tsx/esm apps/plurora-harness-host/src/bin.ts validate --project-root <checkout>` | exit 0, `plurora-host: deployment is valid` |
| `serve ... --ready-file <stage>/ready.json` as a child process | ready file written within the poll window |
| ready envelope | `{"schemaVersion":1,"status":"READY","controlUrl":"http://127.0.0.1:55609"}` |
| `GET /health` with `Authorization: Bearer <token>` | `200 {"status":"ok","workflows":0}` |
| after termination (`Stop-Process` + tree kill) | serve exited, 1 recorded child pid not alive, port closed (connection refused) |

### 4b. Graceful-termination probe (real production seams, in-process)

`runPluroraHost` was driven through `createProductionRuntime` with the real
subprocess service, real catalogue reads and a real control server, against the
same staged credentials. After the ready envelope appeared and authenticated
`/health` answered, the termination listener (the exact callback
`SIGINT`/`SIGTERM` subscribe to) was triggered:

| Step | Result |
| --- | --- |
| exit code | 0 — teardown succeeded and the success path was preserved |
| ready envelope | `{"schemaVersion":1,"status":"READY","controlUrl":"http://127.0.0.1:50552"}` |
| after dispose | port closed; no host-owned child process alive |
| credentials | unchanged |

The only process still alive after dispose was the probe runner's own
`esbuild.exe --service` transform service (tsx infrastructure), proven present
before the host started and never owned by the host; the host's owned tree was
quiescent in both smokes.

## 5. Self-review findings and concerns

- The `--help` text and the legacy help test expectation changed together; the
  new usage documents both the subcommand contract and the retained legacy
  bare invocation. This is a deliberate operator-facing contract change.
- `validate` deliberately does not require `PLURORA_HARNESS_TOKEN`: the token
  guards only the loopback control server, which `validate` never binds. If a
  consumer expects `validate` to fail without a token, that is a contract
  decision to review at integration time.
- `serve` requires `--ready-file`; the legacy bare invocation intentionally
  does not publish a ready file. NeuroVia must use the `serve` subcommand to
  get the readiness contract.
- The ready-file `0o600` mode is honored on POSIX; on Windows the mode is a
  no-op, matching Node semantics. The envelope itself is non-secret.
- The `esbuild.exe --service` observation above is a probe artifact, not a
  host leak, but the graceful probe measured quiescence with a 3-second settle
  to avoid the earlier snapshot race.
- Not proven here (by design): GitHub delivery, database mutation, workflow
  start/status/cancel over the control plane — unchanged from the prior
  enablement evidence and outside this task's surface.

## 6. Commits

```text
1ca7c218b2 feat(trick): expose stable Plurora host CLI        <- installation authority
<evidence commit> docs(trick): record NeuroVia remediation runtime evidence
```