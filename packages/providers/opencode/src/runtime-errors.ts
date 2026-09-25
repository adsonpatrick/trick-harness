/** Fixed-message adapter/provider errors safe to classify and persist. */

import type { OpencodeMalformedResponseCode } from './types.ts'

/** The SDK aborted its own session without a caller cancellation. */
export class OpencodeSessionAbortedError extends Error {
  override readonly name = 'OpencodeSessionAbortedError'

  constructor() {
    super('OpenCode aborted the active session before returning a valid result')
  }
}

/** A successful SDK response did not satisfy the adapter contract. */
export class OpencodeMalformedResponseError extends Error {
  override readonly name = 'OpencodeMalformedResponseError'

  constructor(readonly code: OpencodeMalformedResponseCode) {
    super('OpenCode returned an incomplete SDK response')
  }
}

/** The server could not be started for a reason other than its deadline. */
export class OpencodeServerStartError extends Error {
  override readonly name = 'OpencodeServerStartError'

  constructor() {
    super('OpenCode server failed before becoming ready')
  }
}

/** A prompt failed without yielding an SDK result. */
export class OpencodePromptFailureError extends Error {
  override readonly name = 'OpencodePromptFailureError'

  constructor() {
    super('OpenCode prompt failed before returning a valid result')
  }
}
