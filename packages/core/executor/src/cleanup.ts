/**
 * The only sanctioned way to turn a teardown exception into a durable fact.
 *
 * A provider that built this value by hand would eventually build it from the
 * exception's `message`, and a teardown exception is raised by product code
 * holding a URL, a port, a token header or a response body. So the constructor
 * lives here, takes the raw error, and never reads anything off it but the
 * class name — and refuses even that unless it looks like a class name.
 *
 * @module @trick-harness/executor
 */

import type { ExecutorCleanupFailure } from './types.ts'

/**
 * What an error class name is allowed to look like before it may be quoted.
 *
 * `name` is an ordinary writable property, so it is only conventionally a class
 * name: anything that reaches this module may have had prose assigned to it.
 * The shape below is what a declared class is called, and nothing longer.
 */
const CLASS_NAME = /^[A-Za-z][A-Za-z0-9_$]{0,63}$/

/** Stand-in used whenever the thrown value cannot be named safely. */
const UNNAMED = 'Error'

/**
 * Describe one failed teardown in terms that can be written to a durable log.
 *
 * @param category - the fixed machine-readable cleanup class; caller-owned and
 * expected to be a literal, never derived from the error.
 * @param error - whatever the product's teardown path threw.
 * @returns a frozen fact carrying the category and a class name, and no other
 * byte of the error.
 */
export function cleanupFailure(category: string, error: unknown): ExecutorCleanupFailure {
  const name = error instanceof Error ? error.name : UNNAMED
  const safe = typeof name === 'string' && CLASS_NAME.test(name) ? name : UNNAMED
  return Object.freeze({ category, safeDiagnostic: `${category} failed (${safe})` })
}
