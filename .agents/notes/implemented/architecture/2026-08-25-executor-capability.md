# Agent Note: Executor capability beside SubagentRuntime

Status: implemented

## Problem

Trick Harness routing selects a model and a reasoning effort per run. Upstream DeepSeek Harness already has a subagent capability that spawns and supervises child agents, and the obvious move is to add `model` and `reasoningEffort` to `SubagentStartRequest` and route through it.

That move is wrong twice. It makes every upstream subagent consumer carry Trick Harness routing concerns in a type they have no interest in, and it puts fork edits directly into a file upstream changes often — turning a routine sync into a conflict on the exact type both sides are actively editing. The fork's whole sustainability argument rests on divergence staying inside files the fork owns.

There is a second problem underneath. Routing decides which model runs a task, and that decision is recorded as a durable fact used later for attribution and for QA independence checks. If a provider can accept a route it cannot honour and quietly fall back to a product default, the durable fact names a model that never ran the task. A silent capability gap is not a degraded run; it is a false record.

## Decision

A parallel executor capability, `@trick-harness/executor`, sitting beside `SubagentRuntime` rather than extending it. Upstream's subagent types are untouched.

The runtime owns three things and delegates everything else. It owns which provider a route selects, whether that provider can honour the route, and the lifetime of runs in flight. A provider translates one already-validated request into one product runtime — it does not decide policy, and the model reaching it is already resolved from whatever semantic tier a profile named.

**Capabilities are declared, not discovered.** `ExecutorCapabilities` states whether a provider honours a per-run model override, a per-run reasoning effort, and which permission modes it can actually enforce. A route asking for something undeclared throws before a process is spawned. This is the direct answer to the false-record problem: refusing is strictly better than running under a different model than the one recorded.

**The provider receives a chained signal, not the caller's.** The runtime must be able to end a run the caller has no reason to cancel — disposal, budget exhaustion — so it owns the signal that reaches the provider, forwarding the caller's abort onto it.

**Failures are structured and safe by construction.** `ExecutorFailure` carries a category, an availability flag that drives fallback routing, and a redacted diagnostic. There is deliberately no field for raw stderr or environment. Providers talk to products the user is authenticated against, and this result reaches durable event logs and PR comments.

**`availability` means reachability and nothing else.** The flag spends money: it is what makes a fallback route fire, and a fallback is a second run. A deterministic refusal — a route the provider cannot express, a rejected request, an account a human must fix — is therefore not availability, however much a retry might be wanted. Both providers classify `route-unsupported` as `availability: false` for this reason: the executor is reachable and refusing, so a fallback would pay for a second run to hear the same refusal from a different product and would then file a healthy executor's outage as the cause.

**`dispatchableRoute` is where an advisory field stops being advisory.** A profile's `use` row is a policy decision, not an executor request, and a policy legitimately states a reasoning effort for products that have no field for one — OpenCode's SDK carries none at all. Handing that row to the runtime as written makes every such row undispatchable, which is the opposite of advisory. `dispatchableRoute(provider, intent)` narrows an intent to what one provider declares it honours and returns what it had to drop, so the caller can record "this ran without the effort the policy asked for" on the durable route fact. It is deliberately not a provider concern: a provider that decided for itself which parts of a route to ignore would be deciding policy.

The asymmetry inside it is the substance. Only `reasoningEffort` is droppable. A reasoning budget is a request about how hard to think, and a product without the knob still does the work. A model identifies *who did the work*, so dropping it would produce exactly the false record described above; it is passed through untouched and the runtime refuses the route instead.

**Results are bounded.** `output` is the final result, never the child transcript.

## Alternatives considered

**Extend `SubagentStartRequest` with the routing fields.** Smallest diff today. Rejected: it exports fork policy into a shared upstream type, and it puts the fork's edits on the file most likely to move upstream. Plan A's global constraints forbid it explicitly, and the reasoning holds independently of the plan.

**Wrap `SubagentRuntime` and pass routing through an opaque metadata bag.** Avoids changing the upstream type signature. Rejected: it gets the type-checking backwards. The whole value of the capability contract is that an unhonourable route fails at a boundary with a named error; a metadata bag defers that to whatever the provider chooses to read, which is exactly the silent-fallback failure mode.

**Discover capabilities by probing the product at registration.** More honest in principle — the provider would not have to self-report. Rejected as both fragile and slow: it makes registration depend on a reachable product and on credentials, so a runtime could not be composed offline or in unit CI. A declared capability that lies is a provider bug a test can catch; a probe that fails is a startup outage.

**Let the runtime downgrade an unsupported route instead of refusing.** Tempting for availability — a run happens rather than failing. Rejected: it produces the false durable record this design exists to prevent. Fallback belongs one level up, in the profile's `fallbackRules`, where the substitution is a stated policy decision that gets recorded as such.

**Have providers own their own run lifetimes.** Simpler runtime. Rejected: disposal then has no way to reach a run, and every provider re-implements the same abort-chaining, leaving the correctness of teardown to the least careful provider.

## Consequences

Adding a provider means declaring what it honours and implementing one `start`. The registry, validation, dispatch, cancellation chaining, and active-run accounting are already done and tested once rather than per provider.

Provider authors must keep `ExecutorCapabilities` truthful. A provider that declares `modelOverride: true` and then ignores the field produces exactly the false record this design prevents, and the runtime cannot detect it. This is the contract's soft spot, and it is why each provider package needs a test asserting the override actually reaches the spawned worker — Plan A Task 4 Step 2 requires precisely that.

A route that no provider can honour surfaces as a thrown `ExecutorCapabilityError` rather than a degraded run. Callers must handle it, and profiles must supply fallback rules for the cases they care about.

Two whole-repository files gained entries for this package (`tsconfig.base.json`, `tsconfig.host.json`), both already recorded in the divergence ledger as fork-local namespace registration. See [[2026-08-25-project-profile-seam]].
