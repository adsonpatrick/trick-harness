# Harness V2 Plan D — verification and rollout evidence ledger

This is the Plan D evidence ledger required by Task 1. It records what has been demonstrated, what has not been attempted yet, and what cannot be attempted, one row per acceptance criterion. A row is only PASS when direct evidence exists for it; missing real-environment evidence is PARTIAL or INCONCLUSIVE and never PASS.

**Location deviation.** Plan D's file map names `docs/agents/harness-v2-evidence.md`. That directory does not exist in this repository — `docs/agents/` is a `neuro-via` convention, and the plan's own references to it (`docs/agents/operating-model.md`) belong to the product repository. This repository keeps its evidence in `docs/verification/`, which is also the directory excluded from bilingual pairing, so the ledger lives here instead. Nothing else about the task changes.

**Governing amendment.** `docs/superpowers/specs/2026-08-27-harness-v2-scope-amendment.md` withdraws criterion 8, retains criterion 9 as a standing property, keeps criteria 24, 25 and 26 required, and reclassifies criteria 23, 27 and the Supabase half of 30 as PRO-OPTIONAL.

## Task 1 — frozen verification targets

| Target | Value |
| --- | --- |
| Trick Harness branch | `feat/harness-v2-plan-d-verification` |
| Trick Harness HEAD at freeze | `f9acbdcfecb68c3520cfece538fc6ac220e2cec7` |
| Trick Harness `master` (remote, authoritative) | `01a8b762b197135f38d4001d9f13a9dab3dfb7f9` |
| Recorded upstream baseline | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` |
| `neuro-via` SHA/status | NOT AVAILABLE — Plan C has not run and the repository is not present in this environment |

### Fork and licence provenance

Read from the GitHub API rather than from the local clone. The repository reports `fork: true` with both `parent` and `source` equal to `deepseek-ai/deepseek-harness`, so the fork relationship is the approved one and not a mirror or a history-less copy.

`LICENSE` retains the MIT notice, and its content is byte-identical to upstream: the local blob hashes to `c1f7a78e89e4e4dc7b86664c3b3c76eb5eee1785`, which is the same object id the GitHub contents API reports for `deepseek-ai/deepseek-harness`. Nothing in the fork has altered the licence.

`HEAD` descends from the recorded baseline `b150a551b8`, confirmed by ancestry rather than by comparing messages.

### Baseline contamination — classified, not repaired

`pnpm run hygiene` fails one of its thirteen gates. The failure is inherited from upstream and is not caused by any Harness V2 work, so it is classified here and left alone rather than retried until green, as Task 1 requires.

`pnpm run rescope-vendor:check` reports two edits it can neither find pending nor find cleanly applied: `knip-logger-console` against `knip.json`, and `vendoring-cookbook-name-invariant-zh` against `docs/cookbook/adding-a-vendored-package.zh.md`. The anchors those edits search for are absent from both files.

The attribution is conclusive. Both target files were last modified by upstream commits — `a42102fb27` on 2026-08-20 and `8d3674695b` on 2026-08-18 — and the codemod itself is upstream, introduced by `194828e8b8`. Neither file differs between this branch and `master`. Most directly, the anchors are already absent at the recorded baseline `b150a551b8`: `git show b150a551b8:knip.json` contains no `logger-console` entry, and the baseline Chinese cookbook does not contain the sentence the edit expects. Upstream's own rescope codemod is out of step with upstream's own files, and was already so before this fork began its V2 work.

This is a real defect and it is recorded as one. It is not a Harness V2 defect, it blocks no acceptance criterion below, and Plan D's read-only posture means it is not repaired in this context.

### Secret hygiene

The twelve passing hygiene gates ran on this tree. No credential, connection string, access token or database password appears in this ledger, and none is recorded in any artefact produced by Plan D. Where a credential store had to be examined at all — the Codex and OpenCode configuration files — only SHA-256 prefixes, byte sizes, modification times and field *names* were read; no token value was read, copied or written anywhere. The `neuro-via` half of the hygiene sweep cannot run; see the ledger rows.

## Task 2 — the deterministic suites, and what fails in them

### The Harness V2 scope is green

`pnpm run test:trick`, which covers `packages/core`, `packages/providers`, `packages/integrations`, `packages/composition` and `profiles`, passes completely at the frozen HEAD: 85 files, 1951 tests, no failures. The four gates that run beside it — `constraints`, `typecheck`, `lint`, `build` — all pass. `pnpm run constraints` reports `check-trick-boundaries: generic packages carry no project-policy dependency`, which is criterion R1 stated directly by the tool that enforces it.

A focused re-run of the criterion-bearing suites — `tests/trick-harness`, `packages/core/routing`, `packages/core/engineering-workflow`, `packages/core/executor`, `packages/core/journal` — passes 12 files and 270 tests.

### The whole-repository suites fail, and the failures are upstream

`pnpm run test` (the entire monorepo, not just the fork's scope) fails. Two runs were made; they disagree on the count, which is itself worth stating: the first reported 16 failed files and 39 failed tests, the second 11 failed files. The second run used the JSON reporter and so can name them:

`packages/client/ui-primitives/tests/code-block.client.spec.tsx`, `packages/client/ui-trajectory/tests/client-bundle.client.spec.ts`, `packages/sandbox/sandbox-windows-acl/tests/runner.spec.ts`, `packages/session/session-persistence-sqlite/tests/differential.spec.ts`, `packages/shell/pwsh-sandbox/tests/sandbox.spec.ts`, `packages/shell/tool-pwsh-persistent/tests/loader-composition.spec.ts`, `packages/subagent/subagent-claude-code/tests/real-product.spec.ts`, `packages/test-support/acp-snapshot/tests/harness.spec.ts`, `scripts/change-scope.spec.ts`, `scripts/oxlint-contract.spec.ts`, `scripts/test-invariants.spec.ts`.

The attribution is conclusive and was measured, not assumed: `git log b150a551b8..HEAD` returns **zero** commits for every one of those eleven paths. No Harness V2 commit has touched any of them. They are upstream areas — client UI, the Windows ACL sandbox, SQLite session persistence, the PowerShell shell, the Claude Code subagent, ACP test support, and repository scripts — failing at the baseline this fork inherited.

That the count differs between runs means at least five of them are order- or load-sensitive rather than deterministic. That instability is also upstream's, and it is recorded rather than chased.

`packages/subagent/subagent-claude-code/tests/real-product.spec.ts` deserves a line of its own: it fails because the Claude Code product is not installed. Under the 2026-08-27 amendment Claude Code is not an executor of this harness, so this failure is consistent with the agreed scope rather than a gap in it.

### `pnpm run test:snapshot` fails, and one of those failures is ours

The snapshot suite reports 10 failing files. Nine are upstream by the same measurement — `apps/cli`, `examples/acp-agent`, `examples/headless-agent`, `examples/jsonrpc-agent` all return zero commits since the baseline.

The tenth, `scripts/harness-control-transcript.snapshot.ts`, returns one commit: `369b5e1d4f feat(trick): compose the harness from one profile`. It is Harness V2 work and it is broken. See finding D2-02.

## Task 2 findings

### D2-01 — the trusted-composition exclusion list is inert

`profiles/plurora/security-policy.ts:56` declares `trustedComposition.excludedPluginIds` as `cordis-plugin-hmr`, `model-authored-runtime-plugin` and `self-modifying-workflow-plugin`, with a comment explaining that a plugin able to rewrite the workflow state machine at runtime would make every other policy advisory. The reasoning is right. The list does nothing.

Nothing in the runtime ever reads it. The only non-type reference outside tests is `packages/core/profile/src/index.ts:253`, which calls `validateStringList` on it — that checks the field is an array of strings and nothing more. No composition code consults the list to refuse mounting a plugin, and `packages/composition/runtime/src` does not mount profile-named plugins at all. The two tests that mention it, `profiles/plurora/tests/profile.spec.ts:139-140`, assert only that the profile's own data contains the strings; they exercise no enforcement, so they would keep passing if enforcement never existed, which is what they are doing now.

The consequence is narrow but real: if a self-modifying or model-authored plugin were added to the composition, the profile's exclusion would not stop it. The property is declared and reviewed but not enforced.

This matters to Plan D specifically. Task 12's activation gate requires that the trusted Plurora composition exclude self-modification and model-authored runtime plugins. Today that gate can only be satisfied by reading a list, not by demonstrating a refusal.

### D2-02 — the control-transcript snapshot reads a workflow by the wrong identity

`scripts/harness-control-transcript.snapshot.ts` fails reproducibly and in isolation, in 104ms, with `TypeError: Cannot read properties of undefined (reading 'map')` at line 189. It is not flaky and it is not load-related.

The cause is an identity confusion the control-server contract explicitly warns about. `statusThroughHttp` posts an objective and then reads back `GET /workflows/${objective.id}`. But the workflow id is minted by the Harness, not taken from the objective: `packages/composition/runtime/src/harness.ts:373` mints it with `options.workflowIdFactory ?? randomUUID`, and the snapshot supplies no factory. The contract in `packages/core/control-server/src/types.ts` states the rule outright — *"The objective's own id is not that identity — the same objective may be run again — so nothing here derives one from the payload."*

So the read returns 404 with an error body, and `degradedStatus.stages` is `undefined`. The recorded expectation at `scripts/snapshots/harness-control-transcript/transcript.expected.json` shows a well-formed status whose `workflowId` equals the objective id, so the read did once resolve: the artefact was recorded before minting moved to `randomUUID` and was never re-recorded afterwards.

The failure is worse than a broken test, and repairing it showed why. Once the read is addressed correctly the transcript changes substance, not just identity: the recorded artefact claimed eight passing stages ending in a published branch, and the truth is that this composition has no delivery capability and the lifecycle blocks at `delivery-1`. The stale snapshot had been asserting that a run publishes work that no capability port was ever composed to publish.

## Task 3 — OpenCode cockpit, bridge, and worker

### The control surface, over real HTTP

A `HarnessControlServer` was bound and exercised with real `fetch` requests rather than through an in-process test double. It bound `127.0.0.1` on an ephemeral port and minted a per-process token.

| Request | Result |
| --- | --- |
| `GET /health`, no credential | `200 {"status":"ok","workflows":0}` |
| `POST /workflows`, no credential | `401 unauthorized` |
| `POST /workflows`, bearer token, with a route override | `202`, state `running` |
| `GET /workflows/<id>` | `200`, bounded status, no provider output and no stage findings |
| `GET /nope` | `404` |
| `POST /workflows/<id>/cancel` | `200`, state `canceled` |
| `GET /health` after `dispose()` | connection refused |

The override arrived at the starter as `{ role: 'implement', executor: 'opencode', semanticModelTier: 'flash' }` — passed through per run, not written anywhere. A malformed override was refused with `400` *before* a workflow id existed, so no durable record of an unstarted run was created.

### The worker path is programmatic, and it runs without a key

The real `@opencode-ai/sdk@1.18.23` entry path was exercised end to end, which closes the smoke that Plan A Task 4 Step 4 had left deferred. `createSdkAdapter().startServer(...)` started a real OpenCode server on `127.0.0.1` on an ephemeral port, `createOpencodeClient` connected to it, a real session was created and then aborted.

The run carried no credentials: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `NVIDIA_API_KEY` and `OPENCODE_API_KEY` were all absent from the process. The permission block sent to the scoped server was the full explicit `read-only` set — `edit`, `bash`, `webfetch`, `doom_loop` and `external_directory` all `deny` — rather than an omission left to a product default.

Nothing screen-drives the TUI. `packages/providers/opencode/src` contains no pty, no terminal allocation and no synthetic keystrokes; the only product entry points are `createOpencodeServer` and `createOpencodeClient`, and the model rides on the prompt body, which is the one place OpenCode accepts one.

### Global OpenCode state is untouched

Hashed before the run and again after it, and unchanged in content and in modification time:

| File | SHA-256 prefix | Modified |
| --- | --- | --- |
| `~/.config/opencode/opencode.jsonc` | `738a882a59ff810b` | 2026-08-03 10:35:26 |
| `~/.local/share/opencode/auth.json` | `2d443bf6ed64905a` | 2026-07-12 21:28:28 |

### What Task 3 could not do

The cockpit half — starting OpenCode's TUI inside `neuro-via`, confirming `harness_run`, `harness_status` and `harness_cancel` are discoverable there, and inspecting the bridge configuration for `repository=adsonpatrick/trick-harness` and `profile=plurora` — requires the `neuro-via` repository, which Plan C has not yet produced and which is not present in this environment. Criterion 3 is therefore PARTIAL: the Harness side of the bridge is proven over real HTTP, the cockpit side is not proven at all.

## Task 4 — Codex on native subscription authentication

### Correction to an earlier reading

An earlier probe found no `codex` on `PATH` and this ledger was on course to record Task 4 as BLOCKED. That reading was wrong, and the mistake was to probe `PATH` at all. The provider never consults it: `packages/subagent/subagent-codex/src/run.ts:253` builds its argv as `[process.execPath, CODEX_PACKAGE_BIN, 'app-server', '--stdio']`, where the binary is resolved from the package-local `@openai/codex` manifest — deliberately *"independent of the host `PATH`"*. `@openai/codex@0.147.0` is installed in the package. Task 4 was runnable the whole time.

### Native authentication readiness, without reading a secret

`~/.codex/auth.json` was examined for structure only. It reports `auth_mode = chatgpt` and its `OPENAI_API_KEY` field is `null`. The `tokens` object has the field names `access_token`, `account_id`, `id_token` and `refresh_token`; no value of any of them was read. `~/.codex/config.toml` sets `model = "gpt-5.6-sol"` and `model_reasoning_effort = "medium"`.

### A real keyless run

The Codex provider was driven through `createCodexProvider(...).start(...)` with the real local subprocess service. It spawned `node codex.js app-server --stdio` from the package-local payload, with `explicitEnvKeys: []` — no environment entry supplied at all — and completed, returning the requested output.

The credential check ran against the child environment the subprocess seam actually builds: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `SUPABASE_ACCESS_TOKEN` and `NVIDIA_API_KEY` are all absent from it. The run authenticated on the ChatGPT plan through the user's own Codex installation, which is criterion 6 demonstrated rather than asserted.

### Per-run model and effort, with global config proven unchanged

A second run routed `model = gpt-5.6-sol` with `reasoningEffort = high` — a deliberate departure from the `medium` the global config sets. It completed. Immediately afterwards both global files were byte-identical and mtime-identical to their pre-run state:

| File | SHA-256 prefix | Modified, before and after |
| --- | --- | --- |
| `~/.codex/config.toml` | `048d9006c7f4b755` | 2026-08-20 16:24:25 |
| `~/.codex/auth.json` | `e2c0c9fbd6fc273e` | 2026-08-20 14:05:58 |

### An unroutable model fails loudly

A run routed to `gpt-5.1-codex`, which this account cannot reach, returned `status: error` with `availability: false` and a bounded diagnostic. It did not silently fall back to the configured default and it did not report success with empty output. That is the no-silent-degradation property behaving correctly on a real product.

### What Task 4 did not do

Quota exhaustion was not induced. The fallback and circuit-breaker evidence is the deterministic classified fixture at the provider boundary in `packages/core/routing/tests/availability.spec.ts`, which is what Plan D Task 4 Step 6 asks for in as many words — *"without intentionally exhausting paid quota"*. It is recorded as a fixture, not as a live outage.

## Task 5 — core independence without a third executor

Criterion 9 holds by construction rather than by configuration, which is a stronger reading of it than the toggle test the original plan described.

No Claude executor exists anywhere in the composed scope. `profiles/plurora/routing-policy.ts` names exactly two executors across every rule — `codex` and `opencode` — and no source file in `profiles/`, `packages/composition/`, `packages/core/routing/src` or `packages/providers/` refers to a Claude runtime at all. The only occurrences of the string in that scope are inside `packages/composition/runtime/tests/`, where `claude-code` is an arbitrary name for a test double proving that an extra provider *can* be registered. Nothing composes one.

So there is no toggle to flip. The whole deterministic suite has always run with no Claude executor present, and it is green; both remaining executors have now been driven against their real products under Tasks 3 and 4. Criterion 9 is PASS and criterion 8 is WITHDRAWN, citing the scope amendment.

The independence property is not silently satisfied when only one executor is usable. `packages/core/routing/src/index.ts:309` appends the reason code `independence:unsatisfied` to the decision rather than failing the run or pretending the requirement was met, and `packages/core/routing/src/availability.ts:311` treats a decision carrying it as weakened. `packages/core/engineering-workflow/src/index.ts:762` reads the same code when deciding what a stage may certify. Three suites assert both directions — that the code appears when independence cannot be had, and that it does not appear when it can.

### A representative OpenCode→Codex workflow, run against both real products

The independence claim above is about what is composed; this is the run that exercises it. A single Harness was composed with both real providers — the OpenCode SDK adapter and the Codex subprocess provider — over a two-stage workflow at `risk: high`, which the independence policy resolves to `cross-executor-required`. Routing sent `implement-1` to OpenCode at `workspace-write` and `verify-1` to Codex at `read-only`.

Both stages reached their products and answered. The run completed with `verdict: PASS` in 22.9s; `distinctExecutorsUsed` is `["opencode","codex"]`, and the two products returned the distinct strings each was asked for — `IMPLEMENTED` from OpenCode, `VERIFIED` from Codex — which is what distinguishes a real model reply from a stub. Neither task read files nor ran commands, so the run mutated nothing.

The OpenCode model was resolved from the host's own authenticated provider list rather than guessed: `opencode-go/mimo-v2.5`, the `provider/model` pair the SDK's `/config/providers` route reports for an account already signed in through the official product flow. No API key was injected into either process; Codex ran on the ChatGPT-plan route as under Task 4.

This is the step the plan calls "run a representative OpenCode→Codex workflow". It had briefly been ticked on the strength of the two executors having been driven separately under Tasks 3 and 4, which is a weaker fact than the checkbox claims. The run above is the actual evidence, and the tick now stands on it.

## Task 9 — restart, replay and process quiescence

A workflow was driven to a durable nonterminal stage through the real control server, with a provider that starts a genuine OS process and blocks until the run is cancelled. Everything below is read from the world or from the durable log, never from the run's own memory.

### Reconstruction from the durable log alone

While `implement-1` was still in flight, a **second** composition was built over the same session and asked about the workflow. It shares no run state with the first — only the durable events. It answered `state: interrupted`, `verdict: INCONCLUSIVE`, `openStages: ["implement-1"]`, `requiresWorldVerification: true`, and the summary *"workflow was interrupted; verify the world before retrying — stages still open: implement-1"*.

That is criterion 28 exactly: the durable facts reconstruct, the in-flight stage whose effect is unknown becomes `interrupted` and `INCONCLUSIVE`, the reader is told to re-read the world before retrying, and nothing resumes. Building the second Harness started no work; it read.

After the first Harness was disposed, the same reconstruction reported `state: terminal`, `verdict: INCONCLUSIVE`, `openStages: []` and the summary *"the run was canceled during verify"* — a clean cancellation is a terminal fact, and the log says which of the two it was rather than blurring them. A workflow id nobody ran reconstructs as nothing at all rather than as an empty success.

### Quiescence, verified against the operating system

The child process really existed and really went away. `tasklist` confirmed pid 11892 alive while the stage was running, and absent once `dispose()` returned. The socket was refused on the next request. Cancellation travelled the seam's own termination path — the run's `AbortSignal` was handed to the subprocess spec — rather than a kill the test performed itself, so what is proven is the Harness terminating its owned tree, not a script terminating a process. No orphan remained.

### The durable payload holds facts, not reasoning

Every key present anywhere in the nine durable events was enumerated: `cwd`, `data`, `durationMs`, `evidence`, `executor`, `objectiveId`, `outcome`, `permissionMode`, `policyVersion`, `profileId`, `reasonCodes`, `requirement`, `resolvedModel`, `risk`, `role`, `semanticModelTier`, `seq`, `stageId`, `state`, `summary`, `time`, `type`, `verdict`, `workflowId`, `workload`.

There is no `reasoning`, `thinking`, `chainOfThought`, `transcript`, `rawOutput`, `output` or `prompt` key. Private chain-of-thought is neither required by replay nor persisted by it: everything the journal keeps is an observable fact about what was decided and what happened.

### What Task 9 did not do

Compaction and pruning were not exercised against a log large enough to trigger them; the reconstruction above ran on a nine-event log. The cancel half was exercised through the control server's own cancel route under Task 3 rather than through OpenCode's `harness_cancel` tool, which needs the `neuro-via` bridge.

## Task 10 — independent verification, and the half that cannot run here

The parts of Task 10 that live in this repository were carried out; the parts that need `neuro-via` were not, and are not reported as if they had been.

**Boundaries.** R1 is proven by the static boundary test rather than by reading imports: `scripts/check-trick-boundaries.ts`, run through `pnpm run constraints`, reports that generic packages carry no project-policy dependency. R2 through R4 are proven by `profiles/plurora/tests/` and `tests/trick-harness/dual-profile.spec.ts`, which boot a minimal fixture profile with no Plurora policy loaded and run fixture workflows under both profiles from one build.

**Trusted composition.** Inspected independently, and the inspection is what produced D2-01: the exclusion list was declared and never read. It is now enforced at composition time and proven by a refusal test. No self-modifying or model-authored runtime plugin is mounted anywhere in this repository, and a deployment that tried to mount one against the Plurora profile would now be refused rather than reviewed.

**Mock-only certification.** The inspection found a real instance, and it is D2-02. The control-transcript snapshot had been certifying that a run reached a published branch through eight passing stages, when the composition it runs has no delivery capability at all and the lifecycle blocks before delivery. That is precisely the failure mode this step exists to catch: an artefact asserting an external effect that never occurred. It is repaired, and the artefact now records the block.

**Not run here.** The `neuro-via` bridge, permission floor, database scripts, skills, CI and Security/Git-flow review cannot be performed, because the repository is absent. The standard Codex security audit over the bridge and database surfaces is likewise scoped to code that does not exist in this environment. The Harness-side security surfaces were verified directly under Tasks 3, 4 and 8 instead — keyless provider paths, unmodified global credential stores, an empty child environment, denied Supabase command paths, and a control server whose only unauthenticated route is `/health`.

**Triage.** Two confirmed defects, both eligible for repair, both repaired in a separate pass and re-verified. No product or design decision was auto-fixed. The upstream `rescope-vendor:check` failure and the eleven upstream test files are reported and not repaired, because they are outside the fork's scope and Plan D does not authorise editing them.

## Tasks 11 and 12 — not reachable in this environment

Both tasks are written against `neuro-via`. Task 11 reconciles the pin in `neuro-via/plurora-harness.json` against the final Trick Harness SHA, re-runs the bridge health check and one read-only workflow against that pin, and writes the criteria artefact into `neuro-via/docs/agents/`. Task 12 activates V2 by editing operator documentation that lives in the same repository and by confirming the final pin.

None of that can be done from here, and none of it is simulated. What this repository can supply toward them is complete: the criteria ledger above, the two PRO-OPTIONAL criteria named with their entitlement status, criterion 8 recorded as WITHDRAWN, no unresolved material finding, and a trusted composition that now refuses self-modifying and model-authored runtime plugins rather than merely listing them. The activation gate's remaining condition — that the final `neuro-via` pin match an independently verified Trick Harness SHA — is the one thing only `neuro-via` can satisfy.

Merge, release and deploy authority was not touched by any of this work and remains human-controlled. The one real delivery Plan D performed opened a pull request and closed it unmerged.

## Task 6 and 7 — real delivery on a disposable branch

The delivery capability was run against the real `adsonpatrick/trick-harness` remote on a disposable branch, `plan-d-task6-canary`.

The first delivery committed, pushed and opened a pull request: commit `16cb9b0ccd`, PR [#5](https://github.com/adsonpatrick/trick-harness/pull/5), `created: true`. Its eleven commands were exactly the delivery set — `git rev-parse --abbrev-ref HEAD`, `git add -- <one path>`, `git diff --cached --name-only`, `git commit -m`, `git rev-parse --verify HEAD`, `git push -u origin refs/heads/…:refs/heads/…`, `git rev-parse --verify refs/remotes/origin/…`, `gh pr view`, `gh pr create`, `gh pr view`, `gh pr checks`. No force flag, no deleting refspec, no merge, and nothing addressed to a protected branch.

The second delivery, on the same branch, is the repair-cycle half: it produced a new commit `0d180a026c` and reported the same PR #5 with `created: false`. A repair updates the pull request it already has rather than opening another.

Every one of the three durable records was written after a read of the world rather than from intent — the push record after `git rev-parse --verify refs/remotes/origin/plan-d-task6-canary`, the pull-request record after `gh pr view`. That is criterion 30's requirement for the GitHub half: authoritative world-state reads, not executor prose.

### Cleanup, and the world afterwards

The canary was closed without merging and its branch deleted. The outcomes were then read back from GitHub rather than assumed: PR #5 reports `state: CLOSED`, `mergedAt: null`; `git ls-remote --heads origin plan-d-task6-canary` returns nothing; and `master` is still `01a8b762b197135f38d4001d9f13a9dab3dfb7f9`, the SHA frozen in Task 1. The Harness never merged anything, and no protected branch moved.

Cleanup is recorded as evidence in its own right and does not erase the primary result above.

## Task 8 — the database criteria that do not need an entitlement

### Criterion 24, re-proven under Plan D

The Supabase preview capability was run against the real Supabase Management API, on the real parent project, asking for a branch named `plan-d-task8-failclosed`. It issued exactly one command — `supabase branches create plan-d-task8-failclosed --project-ref <parent> --experimental` — which failed, and the capability stopped.

The outcome was `status: BLOCKED`, `completedGates: []`, `mutations: []`, with `identity`, `health`, `migration-push`, `migration-list` and `lint` all skipped and the summary *"no safe preview database could be used, so nothing was validated"*. No fallback was attempted, the parent project was not touched, and no shared development database was substituted. That is the fail-closed property, demonstrated against the real API rather than a seam.

### Criterion 25, by construction

No local Docker Supabase and no Docker shadow database is required anywhere. This is enforced rather than merely unused: `packages/integrations/supabase-preview/src/commands.ts:21` denies the command prefixes `start`, `stop`, `test db`, `db reset`, `db pull` and `db diff`, and the flags `--local` and `--linked`, and `assertAllowed` refuses any program other than the Supabase CLI itself.

No script in the root `package.json` invokes Docker or Supabase. One CI workflow, `.github/workflows/build-exe-for-python-sdk.yml`, uses `docker run` — for manylinux Python wheel builds, with no database involved.

### What Task 8 did not do

No preview branch was created, because branching requires the Pro entitlement the organisation does not hold. Criteria 23 and 27 and the Supabase half of 30 are reported `NOT_APPLICABLE — entitlement absent` under the amendment, and are never reported PASS on the strength of a seam test, a scripted double or an MCP call.

## Acceptance criteria ledger

Verdict vocabulary: **PASS** direct evidence exists; **PARTIAL** partly evidenced; **PENDING** the Plan D task that proves it has not run yet; **BLOCKED** cannot run for a named external reason; **NOT_APPLICABLE** withdrawn or entitlement-absent by amendment.

| # | Criterion | Best evidence | Verdict |
| --- | --- | --- | --- |
| 1 | Fork runs without hosted DSH service | Whole suite, four gates and every canary ran locally against no hosted service | PASS |
| 2 | Upstream licence/provenance preserved | Fork parent and `LICENSE` blob identity read from the GitHub API | PASS |
| 3 | OpenCode TUI starts/observes workflow through stable bridge | Control server exercised over real HTTP, and the transcript snapshot repaired to read the minted id; cockpit side needs `neuro-via` | PARTIAL — Harness side only |
| 4 | OpenCode executes as worker without screen-driving the TUI | Real `@opencode-ai/sdk` server and session; no pty or terminal anywhere in the provider | PASS |
| 5 | Router-selected OpenCode model does not mutate global/cockpit defaults | Global config and auth hashes and mtimes identical across a real run | PASS |
| 6 | Codex executes on native ChatGPT-plan auth without an API key | Real `app-server` run completed; `auth_mode = chatgpt`, no key in the child environment | PASS |
| 7 | Codex model/effort applies per run and does not mutate global defaults | Real run at `high` against a `medium` global default; both global files unchanged | PASS |
| 8 | Claude Code executes as optional worker | Withdrawn by the 2026-08-27 scope amendment | NOT_APPLICABLE — withdrawn |
| 9 | Disabling Claude does not break core OpenCode/Codex workflows | No Claude executor exists in the composed scope at all, so the property holds by construction; both real executors ran | PASS |
| 10 | Router uses versioned deterministic policy and logs every decision | `packages/core/routing`, green in the focused Plan D run | PASS |
| 11 | Heavy implementation routes to MiMo V2.5 unless overridden | `profiles/plurora/tests/routing.spec.ts`, green | PASS |
| 12 | Codex selection uses semantic registry and intentional effort | Real per-run effort override, plus the registry tests | PASS |
| 13 | Codex quota exhaustion triggers approved fallback without silent degradation | `packages/core/routing/tests/availability.spec.ts` fixture; a real unroutable model also failed loudly | PASS — fixture, as Task 4 Step 6 directs |
| 14 | Circuit breaker prevents repeated known-failing Codex quota attempts | Same suite, green | PASS |
| 15 | Fresh-context review enforced | `packages/core/engineering-workflow/tests/lifecycle.spec.ts`, green | PASS |
| 16 | Cross-executor independence enforced, or assurance impact explicit | A `cross-executor-required` run put implement on real OpenCode and verify on real Codex in one workflow; `independence:unsatisfied` recording green for the case where it cannot be had | PASS |
| 17 | Read-only diagnosis produces a Diagnosis Contract before repair | `packages/core/engineering-workflow`, green | PASS |
| 18 | Confirmed bugs repaired, retested and independently re-reviewed | Workflow suite green; the repair half of the real loop is the second delivery only | PARTIAL |
| 19 | Product/design decisions never auto-fixed for green status | Workflow suite, green | PASS |
| 20 | QA runs independently and can fail PR readiness | Workflow suite, green | PASS |
| 21 | Authorized branch commit/push/PR without force-push or merge authority | Real canary on `plan-d-task6-canary`: commit, push, PR #5, closed unmerged, `master` unmoved | PASS |
| 22 | Review/repair loops bounded and terminate with a valid verdict | `maxRepairCycles=3`, `maxExecutorStarts=24`, enforced in the green workflow suite | PASS |
| 23 | DB-changing PRs obtain isolated Supabase Preview Branches | Requires Pro entitlement the organisation does not hold | NOT_APPLICABLE — entitlement absent |
| 24 | Preview unavailable blocks instead of mutating a shared dev fallback | Real API refused the branch; `BLOCKED`, zero mutations, parent untouched | PASS |
| 25 | No check requires local Docker Supabase or a Docker shadow DB | Denied command prefixes and flags in `commands.ts`; no script or DB workflow needs Docker | PASS |
| 26 | Local-Docker DB gates retired so they cannot stay canonical | Work lives in `neuro-via` | BLOCKED — Plan C not run |
| 27 | RLS changes verify denial and allowed access | Requires Pro entitlement | NOT_APPLICABLE — entitlement absent |
| 28 | Replay reconstructs route/fallback/finding/verdict/delivery facts | A second composition reconstructed an in-flight run from the durable log alone as `interrupted`/`INCONCLUSIVE` with the open stage named; every durable key is an observable fact | PASS |
| 29 | Provider processes cancel/dispose to quiescence without orphans | `tasklist` confirmed a real child alive during the stage and gone once `dispose()` returned, with the socket refused; two real Codex process trees also came down with no cleanup fault | PASS |
| 30 | Integration tests verify actual repo/GitHub/Supabase effects | GitHub half proven by world reads on the real remote; Supabase half entitlement-gated | PARTIAL — GitHub half only |
| R1 | Generic packages carry no dependency on `profiles/plurora` or `neuro-via` | `pnpm run constraints`, run under Plan D | PASS |
| R2 | `profiles/plurora` reproduces all binding Plurora behaviour | `profiles/plurora/tests/`, green | PASS |
| R3 | Minimal fixture profile boots without loading Plurora policy | `tests/trick-harness/dual-profile.spec.ts`, green | PASS |
| R4 | One build runs fixture workflows under both profiles without Core change | `tests/trick-harness/dual-profile.spec.ts`, green | PASS |
| R5 | `neuro-via` selects `profile=plurora` via config/bridge | Work lives in `neuro-via` | BLOCKED — Plan C not run |

## What this ledger cannot cover

Two criteria, 26 and R5, live in `adsonpatrick/neuro-via`, which Plan C has not yet touched and which is not present in this environment. Plan D's stated prerequisite is that Plans R, A, B and C all be complete; C is not, so those rows are BLOCKED rather than PENDING, and the `neuro-via` keyless gate block in Task 2 cannot run at all. The cockpit half of criterion 3 is blocked for the same reason.

Two criteria, 23 and 27, plus the Supabase half of 30, are entitlement-gated by the scope amendment and are reported NOT_APPLICABLE rather than skipped in silence. They become required the moment the organisation holds the Pro plan, with no other change to this plan.

Two defects found by Plan D, D2-01 and D2-02, are recorded above and repaired in the consolidation section below rather than in the verification pass that found them.

## Consolidation — the two findings, repaired and re-verified

Plan D's verification pass is read-only, so both defects were recorded first and repaired afterwards, in this section, with the suites re-run against the repairs.

### D2-02 repaired — the snapshot now names the run the Harness minted

`statusThroughHttp` now reads back the `workflowId` carried by the `202` response instead of the objective id, which is what the control-server contract says a caller must do, and it polls until the run leaves `running` rather than reading once. `harnessWith` supplies a deterministic `workflowIdFactory`, the supported way to make an execution id readable without pretending the objective supplies one.

The re-recorded transcript is materially different from the stale one, and the difference is the finding's real weight. All three surfaces now settle at `BLOCKED` with the summary *"stage delivery-1 publishes the work, and this deployment composed no delivery capability to do it"*. That is correct: publishing is a capability port and never a stage handed to an executor, and this keyless composition has no such port. The snapshot's own documentation was updated to say so, because an artefact that showed a branch published here would be showing a model improvising a mutation nobody granted.

The consequence for coverage is stated rather than hidden. The transcript no longer exercises the review-to-repair loop, because the lifecycle now stops before reaching it. That loop remains covered deterministically by `packages/core/engineering-workflow`, which is green. Restoring it in this artefact would require a seam for composing a delivery capability from a double, which composition does not offer today and which is a design change rather than a verification one; it is not made here.

Two further points came out of reviewing the repair itself, and both are fixed. The status poll is bounded and pauses between reads, so a run that never settles is reported as a defect rather than hanging the suite and saturating the loopback socket. And the objective ids no longer share a prefix with the minted execution ids: the two are different identities, and a transcript in which they looked alike is what let a read by the wrong one go unnoticed for as long as it did.

`vitest run --config vitest.snapshot.config.ts scripts/harness-control-transcript.snapshot.ts` passes.

### D2-01 repaired — the exclusion list now refuses

`trustedComposition.excludedPluginIds` is now enforced at the one boundary where a plugin id can enter a composed Harness. `HarnessCompositionOptions` gained `pluginIds`, the ids a deployment intends to mount, and `assertAuthorised` throws `BundleCompositionError` when any of them appears in the profile's exclusion list. A deployment that mounts nothing passes nothing and the check is a no-op, which is every composition in this repository today.

The point of the change is that the property is now provable by refusal rather than by reading a list. `packages/composition/runtime/tests/harness.spec.ts` asserts both halves: composing with `self-modifying-workflow-plugin` against a profile that excludes it throws, and composing with an unexcluded plugin id does not. That is what Task 12's activation gate needs in order to be satisfiable by a demonstration.

### Gates re-run after both repairs

| Gate | Result |
| --- | --- |
| `pnpm run constraints` | pass — generic packages carry no project-policy dependency |
| `pnpm run typecheck` | pass |
| `pnpm run lint` | pass |
| `pnpm run test:trick` | pass — 85 files, 1952 tests |
| the control-transcript snapshot | pass |

The test count rose by one, from 1951 to 1952, which is the exclusion-refusal test. Nothing else in the fork's scope changed verdict.
