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
import { OpencodeMalformedResponseError, OpencodeServerStartError, OpencodeSessionAbortedError } from './runtime-errors.ts'
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
function bindClient(url: string, directory: string): OpencodeClientHandle {
  const client = createOpencodeClient({ baseUrl: url, directory })
  return {
    async createSession(dir: string): Promise<string> {
      const created: unknown = await client.session.create({
        query: { directory: dir },
        throwOnError: true,
      })
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
        throw error
      }
      if (!isRecord(answered) || !isRecord(answered.data) || !Array.isArray(answered.data.parts)) {
        throw new OpencodeMalformedResponseError('prompt-response-missing-data')
      }
      return { parts: answered.data.parts as OpencodePromptResult['parts'] }
    },

    async abortSession(sessionId: string): Promise<void> {
      await client.session.abort({ path: { id: sessionId }, throwOnError: true })
    },
  }
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
      try {
        server = await createOpencodeServer({
          hostname: options.hostname,
          port: options.port,
          timeout: settings.startupTimeoutMs,
          signal: options.signal,
          config: { permission: { ...options.config.permission } },
        })
      } catch (error) {
        // Only the SDK's exact timeout text is classified; no raw cause is exposed.
        if (error instanceof Error && error.message === `Timeout waiting for server to start after ${settings.startupTimeoutMs}ms`) {
          throw new OpencodeStartupTimeoutError(settings.startupTimeoutMs)
        }
        throw new OpencodeServerStartError()
      }
      return { url: server.url, close: async () => { server.close(); return undefined } }
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
  const timer = setTimeout(() => controller.abort(), timeoutMs)
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
