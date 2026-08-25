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

import type {
  ExecutorCapabilities,
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
    return { category: 'route-unsupported', availability: true, safeDiagnostic: error.message }
  }
  const name = error instanceof Error ? error.name : 'Error'
  return {
    category: 'provider-error',
    availability: false,
    safeDiagnostic: `opencode run failed (${name})`,
  }
}

/**
 * Close a server, swallowing a teardown error.
 *
 * A failure to close cannot change the run's outcome and must not mask it, but
 * it also must not be silent, so it surfaces on the context's diagnostics path
 * rather than as a thrown value.
 * @param server - the server this run owns.
 */
async function closeQuietly(server: OpencodeServerHandle): Promise<void> {
  try {
    await server.close()
  } catch {
    // Teardown failure is reported by the owning runtime's disposal path.
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
          try {
            await client.abortSession(sessionId)
          } catch {
            // A session that is already gone needs no abort.
          }
        }
        if (server !== undefined) await closeQuietly(server)
      }
    },
  }
}
