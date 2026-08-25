/**
 * The narrow OpenCode surface this provider depends on.
 *
 * The provider is written against this seam rather than against
 * `@opencode-ai/sdk` directly, so the behaviour that matters — which
 * configuration reaches the server, which model reaches the prompt, what
 * happens on cancellation — is testable without a real product process, and so
 * an SDK change lands in one adapter instead of throughout the provider.
 *
 * @module @trick-harness/provider-opencode/types
 */

/** OpenCode's per-tool permission decision. */
export type OpencodePermission = 'ask' | 'allow' | 'deny'

/**
 * The permission block of OpenCode's config.
 *
 * Field names and values are taken verbatim from `Config.permission` in
 * `@opencode-ai/sdk@1.18.23`; see the package Agent Note.
 */
export interface OpencodePermissionConfig {
  readonly edit: OpencodePermission
  readonly bash: OpencodePermission
  readonly webfetch: OpencodePermission
  readonly doom_loop: OpencodePermission
  readonly external_directory: OpencodePermission
}

/** The in-memory config handed to one server instance. */
export interface OpencodeServerConfig {
  readonly permission: OpencodePermissionConfig
}

/** Options for starting one scoped server. */
export interface OpencodeServerOptions {
  readonly hostname: string
  readonly port: number
  readonly signal: AbortSignal
  readonly config: OpencodeServerConfig
}

/** A running server this provider owns and must close. */
export interface OpencodeServerHandle {
  readonly url: string
  close(): void | Promise<void>
}

/** A provider/model pair, which is how OpenCode names a model. */
export interface OpencodeModel {
  readonly providerID: string
  readonly modelID: string
}

/** One prompt sent to one session. */
export interface OpencodePromptRequest {
  readonly sessionId: string
  readonly directory: string
  /** Absent when the route named no model, leaving the server default in place. */
  readonly model?: OpencodeModel
  readonly text: string
}

/** One part of an assistant message. */
export interface OpencodeMessagePart {
  readonly type: string
  readonly text?: string
}

/** The final assistant message for one prompt. */
export interface OpencodePromptResult {
  readonly parts: readonly OpencodeMessagePart[]
}

/** The client bound to one running server. */
export interface OpencodeClientHandle {
  createSession(directory: string): Promise<string>
  prompt(request: OpencodePromptRequest): Promise<OpencodePromptResult>
  abortSession(sessionId: string): Promise<void>
}

/** Everything the provider needs from OpenCode, and nothing more. */
export interface OpencodeAdapter {
  startServer(options: OpencodeServerOptions): Promise<OpencodeServerHandle>
  connect(url: string, directory: string): OpencodeClientHandle
}
