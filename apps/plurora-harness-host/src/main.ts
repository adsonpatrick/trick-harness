/**
 * The Plurora runtime host.
 *
 * This app is the deployment, not the harness: it reads where this machine is
 * pointed, resolves the models behind the profile's semantic tiers, and holds
 * the resources open until it is disposed. Everything about *how* a run
 * behaves lives in the profile and the composition; nothing in `packages/`
 * imports this app, and this app adds no policy of its own.
 *
 * @module apps/plurora-harness-host/main
 */

import type { ModelRegistry } from '@trick-harness/routing'
import { pluroraProfile } from '../../../profiles/plurora/profile.ts'
import type { PluroraDeploymentConfig } from './config.ts'
import { loadDeploymentConfig } from './config.ts'
import { buildModelRegistry } from './model-registry.ts'

/** Raised when the host cannot be started with what it was given. */
export class PluroraHostError extends Error {
  override readonly name = 'PluroraHostError'
}

/** What the host needs from whoever is starting it. */
export interface PluroraHostOptions {
  /** The project checkout holding `plurora-harness.json`. */
  readonly projectRoot: string
  /** The control-server token, supplied by the environment and never journalled. */
  readonly controlToken: string
  /** Cancels the start and, once started, the host. */
  readonly signal: AbortSignal
}

/** A started host. */
export interface PluroraHost {
  /** The deployment this host was started on. */
  readonly config: PluroraDeploymentConfig
  /** The models behind the profile's semantic tiers. */
  readonly registry: ModelRegistry
  /** Release everything the host holds. Safe to call more than once. */
  dispose(): Promise<void>
}

/**
 * Start the Plurora host.
 *
 * @param options - the project root, the control token, and a cancellation signal.
 * @returns the started host.
 * @throws {PluroraHostError} when the token is missing or the start was cancelled.
 * @throws {DeploymentConfigError} when the deployment file is missing or breaks a rule.
 * @throws {ModelRegistryError} when a routed tier has no model behind it.
 */
export async function startPluroraHost(options: PluroraHostOptions): Promise<PluroraHost> {
  if (options.controlToken.trim() === '') {
    throw new PluroraHostError('the control token is empty; it is supplied by the environment, not by the deployment file')
  }
  if (options.signal.aborted) {
    throw new PluroraHostError('the start was cancelled before the deployment was read')
  }

  const config = await loadDeploymentConfig(options.projectRoot)
  if (config.policyVersion !== pluroraProfile.policyVersion) {
    throw new PluroraHostError(
      `this deployment pins policy ${JSON.stringify(config.policyVersion)} and this checkout carries `
      + `${JSON.stringify(pluroraProfile.policyVersion)}; the deployment has to be repinned deliberately`,
    )
  }
  const registry = buildModelRegistry(config, pluroraProfile)

  let disposed = false
  return {
    config,
    registry,
    async dispose() {
      // Idempotent on purpose: a signal-driven shutdown and an explicit
      // dispose routinely race, and the second one must not fail the process.
      if (disposed) return
      disposed = true
      await Promise.resolve()
    },
  }
}
