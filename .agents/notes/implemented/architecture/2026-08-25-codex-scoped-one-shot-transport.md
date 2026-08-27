# Agent Note: Codex scoped one-shot transport

Status: implemented

## Problem

The harness routes each unit of work to an executor with a per-run model and reasoning effort. Codex is one of those executors, and `@deepseek-ai/dsh-subagent-codex` already owns everything hard about driving it: the package-local wrapper resolution, the app-server handshake, the ephemeral thread, the sixteen-variant error taxonomy, the permission diagnostics, and process-tree disposal to quiescence. Reimplementing that for a routed worker would fork the taxonomy and the teardown guarantees, which is exactly the divergence the fork is supposed to avoid.

The package could not be reused as it stood, for two independent reasons. Its only entry point, `startCodexRun`, takes a `SubagentStartRequest` — it reads `request.prompt`, `request.signal`, and, through the Provider above it, `request.parent.session.header.cwd`. A routed worker has no delegating parent Session to construct one from. And `CodexRunSpec` has no way to express a per-run model or effort, because the shared subagent capability surface (`NO_START_CAPABILITIES`) does not carry one; the child's model comes entirely from native Codex configuration.

Rewriting global Codex defaults so a run picks up a different model was never available: per-run routing must not rewrite the user's product configuration, and `CODEX_HOME` is shared state.

## Decision

Split the existing entry point into a plain transport and an adapter.

`startCodexTask(request: CodexTaskRequest, spec: CodexTaskSpec)` is the transport. `CodexTaskRequest` is `{ texts, signal }` — only what the lifecycle actually consumes. `CodexTaskSpec` extends `CodexRunSpec` with an optional `routing: CodexRouting`. `startCodexRun` is now a one-line adapter that converts `request.prompt` through the unchanged `textTask` validation and passes no routing, so every existing consumer keeps its exact behaviour and its exact wire frames.

Routing travels on `turn/start`, and both field names were read out of the app-server JSON schema generated from the pinned package rather than from documentation. Running `node <package-local wrapper> app-server generate-json-schema --out <dir>` against `@openai/codex@0.147.0` produces a `v2/` directory whose params types are the ones the `ClientRequest` schema binds to the `thread/start` and `turn/start` methods under its "NEW APIs" branch. The verified facts:

| Field | Location | Schema type |
| --- | --- | --- |
| `model` | `ThreadStartParams` | `string \| null` |
| `model` | `TurnStartParams` | `string \| null`, "Override the model for this turn and subsequent turns." |
| `effort` | `TurnStartParams` | `ReasoningEffort \| null`, "Override the reasoning effort for this turn and subsequent turns." |
| `ReasoningEffort` | definition | `{"type": "string", "minLength": 1}` |

Two consequences follow directly from that table. `ThreadStartParams` has no effort field at all, so effort can only be expressed on the turn; putting the model there too keeps a single routing seam instead of two. And `ReasoningEffort` is deliberately not a closed enum — the schema describes it as "a non-empty reasoning effort value advertised by the model", and the advertised set is read per model from `Model.supportedReasoningEfforts` in the `model/list` response. Validation therefore rejects an empty or blank value and nothing else, because a fixed `low`/`medium`/`high` list would be an invention this repository cannot verify and would reject a valid value the moment a model advertises another one.

An unset field is omitted from the emitted frame rather than sent as an explicit null: the schema permits null, but null reads as "clear the override", which is not the same request as "do not override". Validation runs before the subprocess spawn, so an unusable route costs no process and reaches no frame.

`startCodexTask` and its three types are re-exported from `src/index.ts`. The package's build emits only the `index` and `invariant` entries, so a subpath export would name a file that could never exist.

## Alternatives considered

**Route by rewriting Codex configuration.** Writing a model into `CODEX_HOME`'s config, or pointing the child at a generated config file, would reach every concurrent run and outlive the one that set it. Per-run routing that mutates shared product state is the failure mode the constraint exists to prevent.

**Pass the model as a CLI flag.** `codexAppServerArgv()` is deliberately fixed, and app-server takes its per-turn parameters over JSON-RPC. A flag would also apply to the whole process rather than the turn.

**Extend `SubagentStartRequest` with routing.** That is a generic upstream contract shared by every subagent provider, most of which have no notion of a model override. Widening it to serve one provider is the core divergence the fork's ledger rule exists to refuse.

**Build a second Codex client in a fork-local package.** It would duplicate the error taxonomy, the permission diagnostics, and the disposal guarantees, and would drift from them on the first upstream fix. The extension point that was missing was small; the duplication would not have been.

**Put the model on `thread/start` and only the effort on `turn/start`.** Both are schema-valid, but splitting one routing decision across two frames means two places to keep consistent and two places to test, for no behavioural difference in a one-shot run that has exactly one turn.

**Validate effort against a fixed enum.** Rejected as guessing. The schema constrains a non-empty string and points at a per-model advertised set; a hardcoded list would fail closed on values the product accepts.

## Consequences

`startCodexRun` is behaviour-preserving, and the package's existing suites prove it: all fifty-seven pre-existing tests in `tests/subagent-codex.spec.ts` pass unchanged, and the fourteen real-product tests still drive a real `app-server` against a loopback fixture. Seven new tests cover the transport — that an unrouted run emits neither field on `turn/start` nor a model on `thread/start`, that a routed run emits the verified fields verbatim, that only a supplied field appears, that a blank model or effort is rejected before `spawn` is called, and that the spawned child's environment is exactly the explicit deployment environment with no Codex home or config path added.

This is a material divergence in an upstream package rather than a fork-local addition, so it is recorded in the divergence ledger. It is additive: no existing export changed shape, and no existing frame changed content.

The schema evidence is pinned to `@openai/codex@0.147.0`, alongside the compatibility baseline the package README already documents. Upgrading that pin means regenerating the schema and re-reading these two field definitions before trusting them, exactly as the existing protocol evidence requires.

Effort validation will accept a value the selected model does not advertise, and the app-server will reject it at turn time with its own error, surfaced through the existing taxonomy. Reading `Model.supportedReasoningEfforts` to reject earlier would require a `model/list` round trip on every run; that is a worthwhile refinement once a routed worker exists to justify the extra call, and is deferred.
