/**
 * Pure translations between the executor contract and OpenCode's vocabulary.
 *
 * Kept apart from dispatch so the two decisions most likely to be wrong — what
 * a permission mode actually permits, and how a route's model name becomes a
 * provider/model pair — are readable and testable on their own.
 *
 * @module @trick-harness/provider-opencode/config
 */

import type { ExecutorPermissionMode } from '@trick-harness/executor'
import type { OpencodeModel, OpencodePermissionConfig } from './types.ts'

/** Thrown when a route cannot be expressed in OpenCode's vocabulary. */
export class OpencodeRouteError extends Error {
  /** Stable machine-readable failure code. */
  readonly code = 'OPENCODE_ROUTE' as const

  /**
   * Construct a route translation failure.
   * @param detail - what about the route could not be expressed.
   */
  constructor(detail: string) {
    super(`opencode: ${detail}`)
    this.name = 'OpencodeRouteError'
  }
}

/**
 * Map an executor permission mode onto OpenCode's permission block.
 *
 * Every field is stated explicitly, including the ones being denied. OpenCode
 * treats an absent permission as its own default, so an omitted field would
 * silently widen what a `read-only` run may do — the one failure this mapping
 * exists to prevent. `external_directory` stays denied in both modes: the run
 * is rooted in `request.cwd` and writing outside it is never part of either
 * contract. `doom_loop` is denied in both because `ask` would stall a run with
 * no interactive operator to answer it, and a harness run that hangs on a
 * prompt nobody can see is worse than one that stops.
 * @param mode - the permission mode the route requires.
 * @returns the permission block for that mode.
 * @throws OpencodeRouteError when the mode is not one this provider enforces.
 */
export function permissionConfig(mode: ExecutorPermissionMode): OpencodePermissionConfig {
  switch (mode) {
    case 'read-only':
      return {
        edit: 'deny',
        bash: 'deny',
        webfetch: 'deny',
        doom_loop: 'deny',
        external_directory: 'deny',
      }
    case 'workspace-write':
      return {
        edit: 'allow',
        bash: 'allow',
        webfetch: 'deny',
        doom_loop: 'deny',
        external_directory: 'deny',
      }
    default:
      // Unreachable through the executor runtime, which validates the mode
      // against declared capabilities first. Present so a widened contract
      // fails loudly here instead of falling through to a product default.
      throw new OpencodeRouteError(`unsupported permission mode ${JSON.stringify(String(mode))}`)
  }
}

/**
 * Split a routed model name into the provider/model pair OpenCode expects.
 *
 * OpenCode never takes a bare model id, so a name without a provider is
 * rejected rather than guessed at: guessing would run the task on whichever
 * provider happened to be configured while the durable route fact named
 * something else.
 * @param model - the resolved model name from the route, `provider/model`.
 * @returns the provider and model ids.
 * @throws OpencodeRouteError when the name is not a provider/model pair.
 */
export function parseModel(model: string): OpencodeModel {
  const separator = model.indexOf('/')
  const providerID = model.slice(0, separator)
  const modelID = model.slice(separator + 1)
  if (separator <= 0 || modelID === '' || modelID.includes('/')) {
    throw new OpencodeRouteError(
      `model must be a "provider/model" pair, got ${JSON.stringify(model)}`,
    )
  }
  return { providerID, modelID }
}
