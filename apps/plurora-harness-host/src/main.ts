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

import type { DatabaseVerificationCapabilityPort } from '@trick-harness/engineering-workflow'
import type { ModelRegistry } from '@trick-harness/routing'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { pluroraProfile } from '../../../profiles/plurora/profile.ts'
import type { PluroraDeploymentConfig } from './config.ts'
import { loadDeploymentConfig } from './config.ts'
import type { ModelCatalogReader } from './model-registry.ts'
import { assertModelsAvailable, buildModelRegistry } from './model-registry.ts'
import { createProjectDatabaseVerifier } from './project-database.ts'

/**
 * Default subprocess termination grace for what the host starts.
 *
 * Long enough for a database command to close a connection cleanly, short
 * enough that a stuck one does not hold a disposal open indefinitely.
 */
export const DEFAULT_DISPOSE_GRACE_MS = 5_000

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
  /**
   * Read-only access to the native model catalogues.
   *
   * Required rather than optional: a deployment that could skip this check
   * would boot green and fail at the stage that needed the model, which is
   * precisely the failure the check exists to move earlier.
   */
  readonly catalogue: ModelCatalogReader
  /** Shared subprocess service spawn operation, used for the database command. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Subprocess termination grace; defaults to {@link DEFAULT_DISPOSE_GRACE_MS}. */
  readonly disposeGraceMs?: number
}

/** A started host. */
export interface PluroraHost {
  /** The deployment this host was started on. */
  readonly config: PluroraDeploymentConfig
  /** The models behind the profile's semantic tiers. */
  readonly registry: ModelRegistry
  /**
   * The project's database verification capability, bound to this deployment's
   * project ref.
   *
   * Exposed rather than composed here because a composition also decides what
   * else owns a database. This deployment verifies a shared cloud development
   * project through the project's own fixed command, so it supplies this port
   * and configures no Supabase preview integration — the composition refuses
   * both, since two verifiers is two answers about one database with nothing in
   * the run saying which one it was held to.
   */
  readonly databaseVerification: DatabaseVerificationCapabilityPort
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
 * @throws {ModelRegistryError} when a routed tier has no model behind it, or
 *   names one the relevant native catalogue does not advertise.
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
  // The registry being complete says the deployment named a model for every
  // routed tier. This says the accounts can actually be asked for them.
  await assertModelsAvailable(registry, pluroraProfile, options.catalogue)

  const databaseVerification = createProjectDatabaseVerifier({
    projectRoot: options.projectRoot,
    projectRef: config.database.projectRef,
    disposeGraceMs: options.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS,
    spawn: options.spawn,
  })

  let disposed = false
  return {
    config,
    registry,
    databaseVerification,
    async dispose() {
      // Idempotent on purpose: a signal-driven shutdown and an explicit
      // dispose routinely race, and the second one must not fail the process.
      if (disposed) return
      disposed = true
      await Promise.resolve()
    },
  }
}
