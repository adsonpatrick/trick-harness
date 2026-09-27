/**
 * The real `@opencode-ai/sdk` binding for the adapter seam.
 *
 * This is the only module in the package that imports the SDK, so an SDK
 * change lands here rather than throughout the provider, and the provider's
 * own behaviour stays testable against a fake.
 *
 * Every call uses `throwOnError: true`. The generated client otherwise returns
 * a result tuple whose `error` is an easily ignored field, and an ignored
 * transport error would surface as an empty successful run — a durable route
 * fact recording that a task completed with no output when it never ran.
 *
 * @module @trick-harness/provider-opencode/adapter
 */

import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { OpencodeStartupTimeoutError } from './startup-error.ts'
import {
  OpencodeHttpStatusError,
  OpencodeMalformedResponseError,
  OpencodePromptFailureError,
  OpencodeServerStartError,
  OpencodeSessionAbortedError,
  OpencodeTransportFailureError,
} from './runtime-errors.ts'
import type {
  OpencodeAdapter,
  OpencodeClientHandle,
  OpencodePromptRequest,
  OpencodePromptResult,
  OpencodeServerHandle,
  OpencodeServerOptions,
  OpencodeSdkOptions,
} from './types.ts'

/**
 * Bind one running server's client to the seam this provider consumes.
 * @param url - the loopback URL the scoped server is listening on.
 * @param directory - the working directory every request is rooted in.
 * @returns the narrow client handle.
 */
function bindClient(url: string, directory: string, signal: AbortSignal): OpencodeClientHandle {
  const client = createOpencodeClient({ baseUrl: url, directory, signal, fetch: fetchWithoutResponseBodies })
  return {
    async createSession(dir: string): Promise<string> {
      let created: unknown
      try {
        created = await client.session.create({ query: { directory: dir }, throwOnError: true })
      } catch (error) {
        if (error instanceof OpencodeHttpStatusError || error instanceof OpencodeTransportFailureError) throw error
        if (error instanceof SyntaxError) throw new OpencodeMalformedResponseError('session-id-missing')
        throw error
      }
      const id = isRecord(created) && isRecord(created.data) ? created.data.id : undefined
      if (typeof id !== 'string' || id.trim() === '') {
        throw new OpencodeMalformedResponseError('session-id-missing')
      }
      return id
    },

    async prompt(request: OpencodePromptRequest): Promise<OpencodePromptResult> {
      // The model rides on the prompt body, which is the only place OpenCode
      // accepts one. Nothing here writes to a user or global config path.
      let answered: unknown
      try {
        answered = await client.session.prompt({
          path: { id: request.sessionId },
          query: { directory: request.directory },
          body: {
            ...(request.model === undefined ? {} : { model: request.model }),
            parts: [{ type: 'text', text: request.text }],
          },
          throwOnError: true,
        })
      } catch (error) {
        if (error instanceof Error && error.name === 'MessageAbortedError') {
          throw new OpencodeSessionAbortedError()
        }
        if (error instanceof OpencodeHttpStatusError || error instanceof OpencodeTransportFailureError) throw error
        if (error instanceof SyntaxError) throw new OpencodeMalformedResponseError('prompt-response-missing-data')
        throw error
      }
      if (!isRecord(answered) || !isRecord(answered.data) || !Array.isArray(answered.data.parts)) {
        throw new OpencodeMalformedResponseError('prompt-response-missing-data')
      }
      const providerError = answered.data.error
      if (isRecord(providerError)) {
        if (providerError.name === 'MessageAbortedError') throw new OpencodeSessionAbortedError()
        if (providerError.name === 'ProviderAuthError') throw new OpencodeHttpStatusError(401)
        if (providerError.name === 'APIError' && isRecord(providerError.data)
          && typeof providerError.data.statusCode === 'number') {
          throw new OpencodeHttpStatusError(providerError.data.statusCode)
        }
        throw new OpencodePromptFailureError()
      }
      return { parts: answered.data.parts as OpencodePromptResult['parts'] }
    },

    async abortSession(sessionId: string): Promise<void> {
      await client.session.abort({ path: { id: sessionId }, throwOnError: true })
    },
  }
}

const REQUEST_TIMEOUT_CODES = new Set([
  'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
])
const CONNECTION_FAILURE_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN',
])

/** Inspect only one allowlisted Node system code; never traverse or stringify a cause. */
function systemCode(error: unknown): string | undefined {
  if (!(error instanceof TypeError) || !('cause' in error)) return undefined
  const cause: unknown = error.cause
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return undefined
  return typeof cause.code === 'string' ? cause.code : undefined
}

/** Preserve a status signal without letting the SDK read or throw the body. */
async function fetchWithoutResponseBodies(request: Request): Promise<Response> {
  let response: Response
  try {
    response = await globalThis.fetch(request)
  } catch (error) {
    const code = systemCode(error)
    if (code !== undefined && REQUEST_TIMEOUT_CODES.has(code)) {
      throw new OpencodeTransportFailureError('request-timeout')
    }
    if (code !== undefined && CONNECTION_FAILURE_CODES.has(code)) {
      throw new OpencodeTransportFailureError('connection-failed')
    }
    throw error
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new OpencodeHttpStatusError(response.status)
  }
  return response
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Create the adapter backed by the real product.
 * @param settings - the deployment's explicit server-readiness deadline; it does not limit prompts.
 * @returns an adapter that starts scoped OpenCode servers on demand.
 */
export function createSdkAdapter(settings: OpencodeSdkOptions): OpencodeAdapter {
  return {
    async startServer(options: OpencodeServerOptions): Promise<OpencodeServerHandle> {
      if (settings.spawn !== undefined && settings.cwd !== undefined) {
        return await startManagedServer(
          settings.spawn,
          settings.cwd,
          settings.disposeGraceMs ?? 5_000,
          settings.startupTimeoutMs,
          settings.quiescenceDeadlineMs ?? 120_000,
          options,
        )
      }
      // `config` is an in-memory `Config` scoped to this server instance only.
      let server: Awaited<ReturnType<typeof createOpencodeServer>>
      const deadline = new AbortController()
      const timer = setTimeout(() => { deadline.abort() }, settings.startupTimeoutMs)
      try {
        server = await createOpencodeServer({
          hostname: options.hostname,
          port: options.port,
          timeout: Math.min(settings.startupTimeoutMs + 1, 2_147_483_647),
          signal: AbortSignal.any([options.signal, deadline.signal]),
          config: { permission: { ...options.config.permission } },
        })
      } catch {
        if (deadline.signal.aborted && !options.signal.aborted) {
          throw new OpencodeStartupTimeoutError(settings.startupTimeoutMs)
        }
        throw new OpencodeServerStartError()
      } finally {
        clearTimeout(timer)
      }
      return { url: server.url, close: () => {
        server.close()
        return Promise.resolve(undefined)
      } }
    },

    connect: bindClient,
  }
}

async function startManagedServer(
  spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle,
  cwd: string,
  graceMs: number,
  startupTimeoutMs: number,
  quiescenceDeadlineMs: number,
  options: OpencodeServerOptions,
): Promise<OpencodeServerHandle> {
  let child: SubprocessHandle
  try {
    child = spawn({
      argv: ['opencode', 'serve', `--hostname=${options.hostname}`, `--port=${String(options.port)}`],
      cwd,
      env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(options.config) },
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 256 * 1024 },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs,
      signal: options.signal,
    })
  } catch {
    throw new OpencodeServerStartError()
  }
  let offset = 0
  const completion = child.done.then(() => true, () => true)
  const deadline = Date.now() + startupTimeoutMs
  try {
    while (Date.now() < deadline) {
      if (options.signal.aborted) throw new OpencodeServerStartError()
      const read = child.collected.stdout?.readFrom(offset)
      if (read === undefined || read.lossy) throw new OpencodeServerStartError()
      offset = read.nextOffset
      const match = read.text.match(/opencode server listening[^\r\n]*\bon\s+(https?:\/\/[^\s]+)/)
      if (match?.[1] !== undefined) {
        let proof: { readonly processId: number; readonly observedAtMs: number } | undefined
        return {
          url: match[1],
          async close() {
            if (proof !== undefined) return proof
            if (!await stopAndJoin(child, quiescenceDeadlineMs)) throw new OpencodeServerStartError()
            proof = Object.freeze({ processId: child.pid, observedAtMs: Date.now() })
            return proof
          },
        }
      }
      if (await Promise.race([completion, delay(10).then(() => false)])) throw new OpencodeServerStartError()
    }
    throw new OpencodeStartupTimeoutError(startupTimeoutMs)
  } catch (error) {
    await stopAndJoin(child, quiescenceDeadlineMs).catch(() => false)
    if (error instanceof OpencodeStartupTimeoutError) throw error
    throw new OpencodeServerStartError()
  }
}

async function stopAndJoin(child: SubprocessHandle, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    child.terminate()
    if (!await child.waitForExit(controller.signal)) return false
    await child.done
    return true
  } finally {
    clearTimeout(timer)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
