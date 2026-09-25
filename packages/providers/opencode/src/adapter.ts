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
      return { url: server.url, close: () => { server.close() } }
    },

    connect: bindClient,
  }
}
