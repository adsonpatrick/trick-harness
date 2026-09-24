/** Safe startup failure shared by the SDK binding and executor classification. */

/** The SDK stopped its child because it did not announce readiness in time. */
export class OpencodeStartupTimeoutError extends Error {
  override readonly name = 'OpencodeStartupTimeoutError'

  /**
   * @param timeoutMs - the validated readiness deadline supplied to the SDK.
   */
  constructor(timeoutMs: number) {
    super(`OpenCode server did not become ready within ${timeoutMs} ms; increase the startup timeout or inspect OpenCode startup`)
  }
}
