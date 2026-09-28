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

/** A prompt failure retained without provider-controlled diagnostic text. */
export class OpencodePromptFailureError extends Error {
  override readonly name = 'OpencodePromptFailureError'

  constructor(readonly kind: 'unknown-error' | 'output-length' | 'unclassified' | 'rejected-unclassified' = 'unclassified') {
    super('OpenCode prompt failed before returning a valid result')
  }
}

/** A bounded HTTP status captured before the SDK reads an error response body. */
export class OpencodeHttpStatusError extends Error {
  override readonly name = 'OpencodeHttpStatusError'

  constructor(readonly status: number) {
    super('OpenCode returned an unsuccessful HTTP status')
  }
}

/** A Node transport failure identified by a reviewed system error code. */
export class OpencodeTransportFailureError extends Error {
  override readonly name = 'OpencodeTransportFailureError'

  constructor(readonly code: 'request-timeout' | 'connection-failed') {
    super('OpenCode request transport failed')
  }
}

/** The Harness-owned attempt deadline elapsed. */
export class OpencodeAttemptDeadlineError extends Error {
  override readonly name = 'OpencodeAttemptDeadlineError'

  constructor() {
    super('The Harness attempt deadline elapsed')
  }
}

/** Session creation failed with an unclassified SDK error. */
export class OpencodeSessionCreateFailureError extends Error {
  override readonly name = 'OpencodeSessionCreateFailureError'

  constructor() {
    super('OpenCode session creation failed')
  }
}
