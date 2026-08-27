# @trick-harness/control-server

A loopback HTTP surface over one Harness: start a workflow, ask how it is going, ask it to stop.

`GET /health`, `POST /workflows`, `GET /workflows/:id`, `POST /workflows/:id/cancel`. That is the whole API, and it is deliberately the whole API — a control plane that can spawn executors with write authority over somebody's working tree earns its endpoints one at a time.

## Loopback is not a default, it is the only option

The host is validated in the constructor against a closed set of loopback addresses, and anything else is refused before a socket exists. There is no flag that widens it and no environment variable that overrides it, because the failure mode of getting this wrong once is a network-reachable endpoint that starts processes.

Every request but `GET /health` carries a bearer token the server mints per process with `randomUUID`. It is never written to a file, an environment variable or a log: a caller reads it from the server object it constructed, inside the process that constructed it. A token nobody can persist is a token nobody can leak from disk, and the health endpoint stays open so a supervisor can tell a live server from a dead port without holding a secret.

## An invalid objective starts nothing

`readObjective` runs before a workflow id exists. It requires every field the workflow needs, refuses a blank one, and refuses a risk or workload outside the closed set the contracts fix. A malformed request therefore never produces a durable record of a run that was never attempted, and never produces a half-started run somebody has to clean up.

## The caller names the objective; the Harness names the run

`POST /workflows` accepts an objective and answers `202` with the execution id the Harness minted for it. That id is not the objective's own. An objective is a thing a person asked for and may ask for again; an execution is one attempt at it, and only the attempt's id can say which of several runs a status is about. There is no field in the request body that sets it, so a caller cannot address a run it does not own or quietly continue a finished one's history.

`GET /workflows/:id` and `POST /workflows/:id/cancel` both address that generated id. A run leaves the live set when it settles and its last status is kept a while; past that, the durable journal answers for it, for exactly the execution asked about.

## A status is a projection, not a stream

`ControlWorkflowStatus` carries the workflow id, a state, a verdict, a bounded summary, a capped list of stages with their own bounded summaries, and two counters. It has no field for provider output, no field for a finding's evidence, and no field for anything a stage reasoned about privately. A bridge that rendered those into a chat window would be publishing somebody's working notes, so there is nowhere for them to go.

Free text is truncated rather than trusted. A summary is a thing a person glances at.

## A restart surfaces interrupted work; it does not resume it

A status for a workflow this process is not running is read from the durable journal through `restart`. A workflow with no recorded end comes back `interrupted` with `requiresWorldVerification` set, and nothing is started. The log can say a repair was in flight; it cannot say what that repair did to the branch. Re-reading the world is a person's decision, and silently retrying a side-effectful stage is exactly the failure this refuses to have.

An id with neither a live run nor a durable record is a `404`, not an empty status.

## Disposal waits for quiescence

`dispose` aborts every owned run, waits for all of them to settle, and only then closes the listener. Closing first would leave a process tree nobody owns and a working tree nobody is watching. A cancel is the same contract in the small: `POST /workflows/:id/cancel` does not answer until the run it aborted has come back with something.

## Usage

```ts
import { HarnessControlServer } from '@trick-harness/control-server'
import type { ControlStartedWorkflow } from '@trick-harness/control-server'
import type { WorkflowObjective } from '@trick-harness/contracts'

declare const startWorkflow: (objective: WorkflowObjective) => ControlStartedWorkflow

const server = new HarnessControlServer({ start: startWorkflow })
const { host, port } = await server.listen()
const response = await fetch(`http://${host}:${String(port)}/workflows`, {
  method: 'POST',
  headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
  body: JSON.stringify({
    id: 'wf-1',
    cwd: '/repo',
    requirement: 'add the thing',
    risk: 'low',
    workload: 'light',
    profileId: 'plurora',
  }),
})
await response.json()
await server.dispose()
```

## Invariant companion

`@trick-harness/control-server/invariant` registers a startup check that the server binds every loopback address and refuses everything else, and that a token exists without anybody configuring one and is not shared between two servers in one process. The expectations are restated in that file rather than imported, so widening the set in the implementation does not quietly widen the check.

## Known Limitations and Deferred Work

- There is no streaming endpoint. A caller polls `GET /workflows/:id`, which is enough for a bridge that renders status and not enough for one that wants a live transcript — and a live transcript is not something this surface intends to carry.
- A completed workflow stays in the live map for the process's lifetime, so its id cannot be reused while the server is up. That is deliberate for a durable workflow id, and it means a long-lived server accumulates finished entries.
- The durable projection reports no stages, because `RestartAssessment` carries open stage ids rather than stage facts. A restart says what is unsettled, not what each stage concluded before the process stopped.
- Only one Harness is served per process. Multi-tenant hosting, per-caller scoping and any authorization finer than one process token are out of scope here.
