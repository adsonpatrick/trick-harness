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
import type {
  OpencodeAdapter,
  OpencodeClientHandle,
  OpencodePromptRequest,
  OpencodePromptResult,
  OpencodeServerHandle,
  OpencodeServerOptions,
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
      const created = await client.session.create({
        query: { directory: dir },
        throwOnError: true,
      })
      return created.data.id
    },

    async prompt(request: OpencodePromptRequest): Promise<OpencodePromptResult> {
      // The model rides on the prompt body, which is the only place OpenCode
      // accepts one. Nothing here writes to a user or global config path.
      const answered = await client.session.prompt({
        path: { id: request.sessionId },
        query: { directory: request.directory },
        body: {
          ...(request.model === undefined ? {} : { model: request.model }),
          parts: [{ type: 'text', text: request.text }],
        },
        throwOnError: true,
      })
      return { parts: answered.data.parts }
    },

    async abortSession(sessionId: string): Promise<void> {
      await client.session.abort({ path: { id: sessionId }, throwOnError: true })
    },
  }
}

/**
 * Create the adapter backed by the real product.
 * @returns an adapter that starts scoped OpenCode servers on demand.
 */
export function createSdkAdapter(): OpencodeAdapter {
  return {
    async startServer(options: OpencodeServerOptions): Promise<OpencodeServerHandle> {
      // `config` is an in-memory `Config` scoped to this server instance only.
      const server = await createOpencodeServer({
        hostname: options.hostname,
        port: options.port,
        signal: options.signal,
        config: { permission: { ...options.config.permission } },
      })
      return { url: server.url, close: () => { server.close() } }
    },

    connect: bindClient,
  }
}
