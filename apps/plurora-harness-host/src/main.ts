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

import { randomUUID } from 'node:crypto'
import type { ComposedHarness } from '@trick-harness/composition'
import { composeHarness } from '@trick-harness/composition'
import type { DatabaseVerificationCapabilityPort } from '@trick-harness/engineering-workflow'
import type { JournalFlush } from '@trick-harness/journal'
import type { ModelRegistry } from '@trick-harness/routing'
import type { OpencodeAdapter } from '@trick-harness/provider-opencode'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { pluroraProfile } from '../../../profiles/plurora/profile.ts'
import type { PluroraDeploymentConfig } from './config.ts'
import { loadDeploymentConfig } from './config.ts'
import type { ModelCatalogReader } from './model-registry.ts'
import { assertModelsAvailable, buildModelRegistry } from './model-registry.ts'
import { createProjectDatabaseVerifier } from './project-database.ts'
import { openDurableSession } from './session-store.ts'
import { createPluroraWorkflowHandlers } from './workflow-handlers.ts'

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
  /**
   * Shared subprocess service spawn operation.
   *
   * One seam for everything this host starts — the Codex app-server, the
   * delivery commands, the database command — because a deployment that could
   * hand a different spawn to one of them could exempt that one from whatever
   * the shared seam enforces.
   */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** The OpenCode product seam; supply `createSdkAdapter()` in production. */
  readonly opencode: OpencodeAdapter
  /**
   * The durable session's id.
   *
   * Defaults to a fresh one per start. Naming it is how an operator resumes a
   * log deliberately; defaulting to a fixed one would make every restart append
   * onto the last host's history whether or not that was intended.
   */
  readonly sessionId?: string
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
  /** The composed harness: the runtime, the policy and the control server. */
  readonly harness: ComposedHarness
  /** Where the control server actually bound, once it was listening. */
  readonly control: { readonly host: string; readonly port: number }
  /** The durable session workflow facts are journalled into. */
  readonly session: Session
  /** Force a durable checkpoint on that session. */
  readonly flush: JournalFlush
  /** Release everything the host holds. Safe to call more than once. */
  dispose(): Promise<void>
}

/**
 * Start the Plurora host.
 *
 * The order is the contract. Everything that can refuse this deployment runs
 * before anything that changes the machine: the file is read, the policy
 * version is matched, and both native catalogues are asked whether the models
 * exist — all of which are questions — and only then does the host open a
 * durable log, register providers, bind a database and start listening. A boot
 * that fails the model gate therefore leaves no session directory, no
 * registered executor and no open port, which is what makes "not ready" a state
 * an operator can trust rather than a race they have to clean up after.
 *
 * @param options - the project root, the control token, the product seams, and
 *   a cancellation signal.
 * @returns the started host.
 * @throws {PluroraHostError} when the token is missing, the start was
 *   cancelled, or the deployment pins a policy this checkout does not carry.
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

  // Past this line the host starts changing the machine, so everything below
  // is unwound in reverse by the disposer it builds as it goes.
  const disposeGraceMs = options.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS
  const unwind: (() => Promise<void>)[] = []
  try {
    const durable = await openDurableSession({
      projectRoot: options.projectRoot,
      sessionId: options.sessionId ?? `plurora-${randomUUID()}`,
    })
    unwind.push(async () => { await durable.dispose() })

    const databaseVerification = createProjectDatabaseVerifier({
      projectRoot: options.projectRoot,
      projectRef: config.database.projectRef,
      disposeGraceMs,
      spawn: options.spawn,
    })

    const endpoint = new URL(config.controlServerUrl)
    const harness = composeHarness({
      profile: pluroraProfile,
      registry,
      session: durable.session,
      flush: durable.flush,
      workflow: createPluroraWorkflowHandlers(),
      providers: {
        opencode: { adapter: options.opencode },
        codex: { spawn: options.spawn, disposeGraceMs },
        profile: pluroraProfile,
      },
      // Delivery is the project's own checkout, driven through the same
      // subprocess seam as everything else this host starts.
      integrations: { github: { cwd: options.projectRoot, spawn: options.spawn, graceMs: disposeGraceMs } },
      // This deployment verifies a shared cloud development project through the
      // project's own fixed command, so it supplies this port and configures no
      // Supabase preview: the composition refuses both, since two verifiers is
      // two answers about one database with nothing saying which one was held to.
      capabilities: { databaseVerification },
      control: {
        host: endpoint.hostname,
        port: endpoint.port === '' ? undefined : Number(endpoint.port),
        // Supplied by the caller from the environment, never from the file.
        token: options.controlToken,
      } as { host: string; port?: number; token: string },
    })
    unwind.push(async () => { await harness.dispose() })

    if (harness.server === undefined) {
      throw new PluroraHostError('the Plurora profile enables a control server and the composition produced none')
    }
    const control = await harness.server.listen()

    let disposed = false
    return {
      config,
      registry,
      databaseVerification,
      harness,
      control,
      session: durable.session,
      flush: durable.flush,
      async dispose() {
        // Idempotent on purpose: a signal-driven shutdown and an explicit
        // dispose routinely race, and the second one must not fail the process.
        if (disposed) return
        disposed = true
        await unwindAll(unwind)
      },
    }
  }
  catch (error: unknown) {
    // A start that failed halfway is a machine holding a port, a process tree
    // and an open log with nobody left to close them.
    await unwindAll(unwind)
    throw error
  }
}

/**
 * Run every registered disposer, latest first, and wait for all of them.
 *
 * Reverse order because each step was built on the one before it: disposing the
 * harness first settles the runs still writing into the session log, so the log
 * closes after the last append rather than under it. Every disposer runs even
 * when an earlier one throws — a failure to close one resource is not a reason
 * to leak the rest.
 *
 * @param unwind - the disposers, in the order they were registered.
 */
async function unwindAll(unwind: (() => Promise<void>)[]): Promise<void> {
  const failures: unknown[] = []
  for (const dispose of unwind.splice(0).reverse()) {
    try {
      await dispose()
    }
    catch (error: unknown) {
      failures.push(error)
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'the Plurora host did not shut down cleanly')
  }
}
