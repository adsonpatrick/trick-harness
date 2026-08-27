/**
 * The OpenCode executor provider.
 *
 * One run means one scoped server on loopback, one session rooted in
 * `request.cwd`, one prompt, and owned teardown. Nothing this provider does
 * reaches the user's OpenCode configuration: the permission block travels as
 * in-memory server config, and the model travels on the prompt itself.
 *
 * @module @trick-harness/provider-opencode
 */

import { cleanupFailure } from '@trick-harness/executor'
import type {
  ExecutorCapabilities,
  ExecutorCleanupFailure,
  ExecutorFailure,
  ExecutorProvider,
  ExecutorResult,
  ExecutorStartRequest,
} from '@trick-harness/executor'
import { permissionConfig, parseModel, OpencodeRouteError } from './config.ts'
import type { OpencodeAdapter, OpencodeClientHandle, OpencodeServerHandle } from './types.ts'

export type * from './types.ts'
export { OpencodeRouteError, permissionConfig, parseModel } from './config.ts'
// The SDK binding is part of the package's public surface, and the build emits
// only `index` and `invariant` entries, so it is re-exported here rather than
// living behind a subpath that could never be built.
export { createSdkAdapter } from './adapter.ts'

/** The provider name routes select this executor by. */
export const OPENCODE_EXECUTOR = 'opencode'

/**
 * What this provider honours per run.
 *
 * `reasoningEffort` is false because `@opencode-ai/sdk@1.18.23` has no
 * reasoning-effort field anywhere in its generated contract. Declaring it false
 * makes the executor runtime refuse a route that demands one, which is the
 * point: silently dropping it would leave a durable route fact claiming an
 * effort the run never applied. Routing policy may still *state* an effort as
 * advisory intent — see `PolicyRuleDefinition.use`.
 */
export const OPENCODE_CAPABILITIES: ExecutorCapabilities = {
  modelOverride: true,
  reasoningEffort: false,
  permissionModes: ['read-only', 'workspace-write'],
}

/** Loopback host; the port is chosen by the OS so concurrent runs never collide. */
const LOOPBACK = '127.0.0.1'
const EPHEMERAL_PORT = 0

/**
 * Reduce a final assistant message to its text.
 *
 * Only text parts are kept, and only from the final message: the executor
 * contract returns a bounded result, not the child's transcript.
 * @param parts - the final message's parts.
 * @returns the concatenated text.
 */
function finalText(parts: readonly { type: string; text?: string }[]): string {
  return parts
    .filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('')
}

/**
 * Classify a thrown error into a safe structured failure.
 *
 * The message is deliberately the error's own `name` plus a short reason, never
 * the raw cause, stack, environment, or response body: this value reaches
 * durable event logs and PR comments, and OpenCode talks to providers the user
 * is authenticated against.
 * @param error - whatever the adapter threw.
 * @returns a failure carrying no credential-bearing text.
 */
function classify(error: unknown): ExecutorFailure {
  if (error instanceof OpencodeRouteError) {
    // Not an availability failure. The executor is reachable and refusing a
    // route it cannot express, which is a deployment or policy mistake and is
    // deterministic: a fallback route would spend a second run to be told the
    // same thing by a different product, and would file the outage of a healthy
    // executor as the cause.
    return { category: 'route-unsupported', availability: false, safeDiagnostic: error.message }
  }
  const name = error instanceof Error ? error.name : 'Error'
  return {
    category: 'provider-error',
    availability: false,
    safeDiagnostic: `opencode run failed (${name})`,
  }
}

/** Cleanup category for a session this run could not abort. */
export const OPENCODE_SESSION_ABORT_CLEANUP = 'opencode-session-abort'

/** Cleanup category for a scoped server this run could not close. */
export const OPENCODE_SERVER_CLOSE_CLEANUP = 'opencode-server-close'

/**
 * Run one teardown step, reporting a failure instead of raising or hiding it.
 *
 * Raising is wrong because teardown runs after the outcome is decided and would
 * replace a real answer with the story of the cleanup; hiding is wrong because
 * a server that would not close is a leaked port and a live process, and the
 * only party that can act on that is the one reading the result.
 * @param category - the fixed cleanup class for this step.
 * @param step - the teardown to attempt.
 * @returns the cleanup fact, or `undefined` when the step succeeded.
 */
async function teardown(
  category: string,
  step: () => unknown,
): Promise<ExecutorCleanupFailure | undefined> {
  try {
    await step()
    return undefined
  } catch (error) {
    return cleanupFailure(category, error)
  }
}

/**
 * Drive one run to its outcome, appending any teardown fault to `cleanup`.
 *
 * Split out from `start` because the outcome and the teardown record are
 * produced at different moments: this function's `finally` is where cleanup
 * happens, and a `finally` cannot amend the value being returned through it
 * without swallowing what that value was.
 * @param adapter - the OpenCode surface to drive.
 * @param request - the resolved request.
 * @param cleanup - collector the teardown path appends its faults to.
 * @returns the primary outcome, decided without reference to teardown.
 */
async function runOnce(
  adapter: OpencodeAdapter,
  request: ExecutorStartRequest,
  cleanup: ExecutorCleanupFailure[],
): Promise<ExecutorResult> {
  let server: OpencodeServerHandle | undefined
  let client: OpencodeClientHandle | undefined
  let sessionId: string | undefined
  let settled = false
  // Read through a call so the compiler cannot narrow the flag and conclude
  // a later check is dead: the signal is aborted by the caller between
  // these statements, which is exactly the case being checked.
  const aborted = (): boolean => request.signal.aborted
  try {
    // Translate before spawning anything: a route this provider cannot
    // express should cost no process.
    const permission = permissionConfig(request.route.permissionMode)
    const model = request.route.model === undefined ? undefined : parseModel(request.route.model)

    server = await adapter.startServer({
      hostname: LOOPBACK,
      port: EPHEMERAL_PORT,
      signal: request.signal,
      config: { permission },
    })
    client = adapter.connect(server.url, request.cwd)
    sessionId = await client.createSession(request.cwd)

    if (aborted()) return { status: 'aborted', output: '' }

    const result = await client.prompt({
      sessionId,
      directory: request.cwd,
      ...(model === undefined ? {} : { model }),
      text: request.task,
    })
    if (aborted()) return { status: 'aborted', output: '' }
    settled = true
    return { status: 'completed', output: finalText(result.parts) }
  } catch (error) {
    if (aborted()) return { status: 'aborted', output: '' }
    return { status: 'error', output: '', failure: classify(error) }
  } finally {
    // Ownership is explicit and unconditional. A turn that did not finish
    // on its own is aborted first, so the product stops working rather than
    // losing its transport mid-run; a turn that already returned needs no
    // abort. The server closes on every path either way.
    if (!settled && client !== undefined && sessionId !== undefined) {
      const boundClient = client
      const boundSession = sessionId
      const fault = await teardown(
        OPENCODE_SESSION_ABORT_CLEANUP,
        () => boundClient.abortSession(boundSession),
      )
      if (fault !== undefined) cleanup.push(fault)
    }
    if (server !== undefined) {
      const boundServer = server
      const fault = await teardown(OPENCODE_SERVER_CLOSE_CLEANUP, () => boundServer.close())
      if (fault !== undefined) cleanup.push(fault)
    }
  }
}

/**
 * Create the OpenCode executor provider.
 * @param adapter - the OpenCode surface to drive; supply a fake in tests.
 * @returns a provider ready to register on an executor runtime.
 */
export function createOpencodeProvider(adapter: OpencodeAdapter): ExecutorProvider {
  return {
    name: OPENCODE_EXECUTOR,
    capabilities: OPENCODE_CAPABILITIES,

    async start(request: ExecutorStartRequest): Promise<ExecutorResult> {
      const cleanup: ExecutorCleanupFailure[] = []
      const result = await runOnce(adapter, request, cleanup)
      // Attached, never merged into the outcome: a completed run whose server
      // would not close stays completed, and carries the fact that it did not.
      return cleanup.length === 0 ? result : { ...result, cleanup: Object.freeze([...cleanup]) }
    },
  }
}
