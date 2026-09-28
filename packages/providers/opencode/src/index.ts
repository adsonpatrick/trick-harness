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
  ExecutorFailurePhase,
  ExecutorProvider,
  ExecutorResult,
  ExecutorStartRequest,
  ExecutorWriterQuiescenceProof,
} from '@trick-harness/executor'
import { permissionConfig, parseModel, OpencodeRouteError } from './config.ts'
import { OpencodeStartupTimeoutError } from './startup-error.ts'
import {
  OpencodeAttemptDeadlineError,
  OpencodeHttpStatusError,
  OpencodeMalformedResponseError,
  OpencodePromptFailureError,
  OpencodeServerStartError,
  OpencodeSessionCreateFailureError,
  OpencodeSessionAbortedError,
  OpencodeTransportFailureError,
} from './runtime-errors.ts'
import type { OpencodeAdapter, OpencodeClientHandle, OpencodeServerHandle } from './types.ts'

export type * from './types.ts'
export { OpencodeRouteError, permissionConfig, parseModel } from './config.ts'
// The SDK binding is part of the package's public surface, and the build emits
// only `index` and `invariant` entries, so it is re-exported here rather than
// living behind a subpath that could never be built.
export { createSdkAdapter } from './adapter.ts'
export { OpencodeStartupTimeoutError } from './startup-error.ts'
export {
  OpencodeAttemptDeadlineError,
  OpencodeHttpStatusError,
  OpencodeMalformedResponseError,
  OpencodePromptFailureError,
  OpencodeServerStartError,
  OpencodeSessionCreateFailureError,
  OpencodeSessionAbortedError,
  OpencodeTransportFailureError,
} from './runtime-errors.ts'

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

const PROMPT_FAILURE_DIAGNOSTICS = {
  'unknown-error': {
    code: 'opencode.prompt.provider-unknown', safeDiagnostic: 'OpenCode provider returned an unknown error',
  },
  'output-length': {
    code: 'opencode.prompt.output-length', safeDiagnostic: 'OpenCode provider stopped at its output length limit',
  },
  'rejected-unclassified': {
    code: 'opencode.prompt.rejected-unclassified',
    safeDiagnostic: 'OpenCode prompt call failed without a recognized error signal',
  },
  unclassified: {
    code: 'opencode.prompt.failed', safeDiagnostic: 'OpenCode prompt failed before returning a valid result',
  },
} satisfies Record<OpencodePromptFailureError['kind'], Pick<ExecutorFailure, 'code' | 'safeDiagnostic'>>

/** Loopback host; the port is chosen by the OS so concurrent runs never collide. */
const LOOPBACK = '127.0.0.1'
const EPHEMERAL_PORT = 0
const MAX_ATTEMPT_TIMER_MS = 2_147_483_647

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
 * Every message is fixed safe text, never derived from the raw cause, error
 * name, stack, environment, or response body: this value reaches durable event
 * logs and PR comments, and OpenCode talks to providers the user is
 * authenticated against.
 * @param error - whatever the adapter threw.
 * @returns a failure carrying no credential-bearing text.
 */
export function classifySdkFailure(
  error: unknown,
  context: { readonly failurePhase: ExecutorFailurePhase },
): ExecutorFailure {
  const failurePhase = context.failurePhase
  const phase = error instanceof OpencodeSessionAbortedError ? 'SESSION_ABORT' : failurePhase
  if (error instanceof OpencodeAttemptDeadlineError) {
    return {
      category: 'transport-unavailable', code: 'opencode.attempt.deadline-exceeded',
      safeDiagnostic: 'OpenCode exceeded the Harness attempt deadline', failurePhase: phase,
    }
  }
  if (error instanceof OpencodeTransportFailureError) {
    return {
      category: 'transport-unavailable', code: `opencode.transport.${error.code}`,
      safeDiagnostic: 'OpenCode request transport failed', failurePhase: phase,
    }
  }
  if (error instanceof OpencodeHttpStatusError) {
    const status = Number.isSafeInteger(error.status) && error.status >= 100 && error.status <= 599
      ? error.status : undefined
    const category = status === 429 ? 'usage-limit-exceeded'
      : status === 503 ? 'server-overloaded'
        : status !== undefined && status >= 500 ? 'internal-server-error'
          : status === 401 || status === 403 ? 'unauthorized'
            : status === 400 || status === 422 ? 'bad-request'
              : status === 408 || status === 504 ? 'transport-unavailable' : 'other'
    const code = status === 429 ? 'opencode.http.usage-limit'
      : status === 503 ? 'opencode.http.server-overloaded'
        : status !== undefined && status >= 500 ? 'opencode.http.server-failure'
          : status === 401 || status === 403 ? 'opencode.http.unauthorized'
            : status === 400 || status === 422 ? 'opencode.http.bad-request'
              : status === 408 || status === 504 ? 'opencode.http.timeout' : 'opencode.http.unclassified'
    return {
      category, code, safeDiagnostic: 'OpenCode returned an unsuccessful HTTP status',
      failurePhase: phase, ...(status === undefined ? {} : { httpStatus: status }),
    }
  }
  if (error instanceof OpencodeStartupTimeoutError) {
    return {
      category: 'transport-unavailable',
      code: 'opencode.server.startup-timeout',
      safeDiagnostic: 'OpenCode server did not become ready before the startup deadline',
      failurePhase: phase,
    }
  }
  if (error instanceof OpencodeRouteError) {
    // Not an availability failure. The executor is reachable and refusing a
    // route it cannot express, which is a deployment or policy mistake and is
    // deterministic: a fallback route would spend a second run to be told the
    // same thing by a different product, and would file the outage of a healthy
    // executor as the cause.
    return {
      category: 'bad-request', code: 'opencode.route.unsupported',
      safeDiagnostic: 'OpenCode cannot express the routed request', failurePhase: phase,
    }
  }
  if (error instanceof OpencodeSessionAbortedError) {
    return {
      category: 'other',
      code: 'opencode.prompt.session-aborted',
      safeDiagnostic: 'OpenCode aborted the active session before returning a valid result',
      failurePhase: phase,
    }
  }
  if (error instanceof OpencodeMalformedResponseError) {
    return {
      category: 'other',
      code: error.code === 'session-id-missing'
        ? 'opencode.session.id-missing'
        : 'opencode.prompt.response-missing-data',
      safeDiagnostic: 'OpenCode returned an incomplete SDK response',
      failurePhase: phase,
    }
  }
  if (error instanceof OpencodeServerStartError) {
    return {
      category: 'other',
      code: 'opencode.server.start-failed',
      safeDiagnostic: 'OpenCode server failed before becoming ready',
      failurePhase: phase,
    }
  }
  if (error instanceof OpencodePromptFailureError) {
    return {
      category: 'other', ...PROMPT_FAILURE_DIAGNOSTICS[error.kind], failurePhase: phase,
    }
  }
  if (error instanceof OpencodeSessionCreateFailureError) {
    return {
      category: 'other', code: 'opencode.session.create-failed',
      safeDiagnostic: 'OpenCode session creation failed', failurePhase: phase,
    }
  }
  return {
    category: 'other',
    code: 'opencode.run.failed',
    safeDiagnostic: 'OpenCode run failed before returning a valid result',
    failurePhase: phase,
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
    return cleanupFailure(category, error, 'CLEANUP')
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
  quiescence: { proof?: ExecutorWriterQuiescenceProof },
): Promise<ExecutorResult> {
  if (request.signal.aborted) return { status: 'aborted', output: '' }
  const deadlineAtMs = request.deadlineAtMs
  if (!Number.isSafeInteger(deadlineAtMs) || deadlineAtMs === undefined
    || deadlineAtMs - Date.now() > MAX_ATTEMPT_TIMER_MS) {
    return {
      status: 'error', output: '', failure: {
        category: 'bad-request', code: 'opencode.attempt.deadline-invalid',
        safeDiagnostic: 'OpenCode requires a valid Harness attempt deadline', failurePhase: 'STARTUP',
      },
    }
  }
  if (deadlineAtMs <= Date.now()) {
    return { status: 'error', output: '', failure: classifySdkFailure(new OpencodeAttemptDeadlineError(), { failurePhase: 'STARTUP' }) }
  }
  const deadlineController = new AbortController()
  const deadlineTimer = setTimeout(() => { deadlineController.abort() }, deadlineAtMs - Date.now())
  const attemptSignal = AbortSignal.any([request.signal, deadlineController.signal])
  let server: OpencodeServerHandle | undefined
  let client: OpencodeClientHandle | undefined
  let sessionId: string | undefined
  let settled = false
  let phase: ExecutorFailurePhase = 'STARTUP'
  // Read through a call so the compiler cannot narrow the flag and conclude
  // a later check is dead: the signal is aborted by the caller between
  // these statements, which is exactly the case being checked.
  const aborted = (): boolean => request.signal.aborted
  const deadlineExpired = (): boolean => deadlineController.signal.aborted
  try {
    // Translate before spawning anything: a route this provider cannot
    // express should cost no process.
    const permission = permissionConfig(request.route.permissionMode)
    const model = request.route.model === undefined ? undefined : parseModel(request.route.model)

    server = await adapter.startServer({
      hostname: LOOPBACK,
      port: EPHEMERAL_PORT,
      signal: attemptSignal,
      config: { permission },
    })
    client = adapter.connect(server.url, request.cwd, attemptSignal)
    phase = 'SESSION_CREATE'
    try {
      sessionId = await client.createSession(request.cwd)
    } catch (error) {
      if (error instanceof OpencodeHttpStatusError || error instanceof OpencodeTransportFailureError
        || error instanceof OpencodeSessionAbortedError || error instanceof OpencodeMalformedResponseError) throw error
      if (error instanceof Error && error.name === 'MessageAbortedError') throw new OpencodeSessionAbortedError()
      throw new OpencodeSessionCreateFailureError()
    }

    if (aborted()) return { status: 'aborted', output: '' }
    if (deadlineExpired()) throw new OpencodeAttemptDeadlineError()

    let result
    phase = 'PROMPT'
    try {
      result = await client.prompt({
        sessionId,
        directory: request.cwd,
        ...(model === undefined ? {} : { model }),
        text: request.task,
      })
    } catch (error) {
      if (error instanceof OpencodeSessionAbortedError || error instanceof OpencodeMalformedResponseError
        || error instanceof OpencodePromptFailureError) throw error
      if (error instanceof Error && error.name === 'MessageAbortedError') throw new OpencodeSessionAbortedError()
      if (error instanceof OpencodeHttpStatusError || error instanceof OpencodeTransportFailureError) throw error
      throw new OpencodePromptFailureError('rejected-unclassified')
    }
    if (aborted()) return { status: 'aborted', output: '' }
    if (deadlineExpired()) throw new OpencodeAttemptDeadlineError()
    settled = true
    return { status: 'completed', output: finalText(result.parts) }
  } catch (error) {
    if (aborted()) return { status: 'aborted', output: '' }
    if (deadlineExpired()) {
      return { status: 'error', output: '', failure: classifySdkFailure(new OpencodeAttemptDeadlineError(), { failurePhase: phase }) }
    }
    return { status: 'error', output: '', failure: classifySdkFailure(error, { failurePhase: phase }) }
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
      try {
        const proof = await boundServer.close()
        if (proof !== undefined && Number.isSafeInteger(proof.processId) && proof.processId > 0
          && Number.isSafeInteger(proof.observedAtMs) && proof.observedAtMs >= 0) {
          quiescence.proof = Object.freeze({
            kind: 'owned-process-tree-exited',
            processId: proof.processId,
            observedAtMs: proof.observedAtMs,
          })
        }
      } catch (error) {
        cleanup.push(cleanupFailure(OPENCODE_SERVER_CLOSE_CLEANUP, error, 'CLEANUP'))
      }
    }
    clearTimeout(deadlineTimer)
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
      const quiescence: { proof?: ExecutorWriterQuiescenceProof } = {}
      const result = await runOnce(adapter, request, cleanup, quiescence)
      // Attached, never merged into the outcome: a completed run whose server
      // would not close stays completed, and carries the fact that it did not.
      return {
        ...result,
        ...(quiescence.proof === undefined ? {} : { writerQuiescence: quiescence.proof }),
        ...(cleanup.length === 0 ? {} : { cleanup: Object.freeze([...cleanup]) }),
      }
    },
  }
}
