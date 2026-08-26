/**
 * The composition root: one place that turns configuration into a populated
 * executor runtime.
 *
 * Composition is the only thing here. The runtime owns dispatch, each provider
 * owns one product, and a profile owns which executor a route may name — this
 * package just holds them in the same hand and refuses a combination that
 * cannot serve the policy it was given. Nothing it does starts a product
 * process: a provider is a description of how to start one, and the first
 * process appears on the first dispatch.
 *
 * @module @trick-harness/composition
 */

import type {
  ExecutorProvider,
  ExecutorRegistration,
  HarnessExecutorRuntime,
} from '@trick-harness/executor'
import { createExecutorRuntime } from '@trick-harness/executor'
import { validateProfile } from '@trick-harness/profile'
import type { HarnessProfile, PolicyRuleDefinition } from '@trick-harness/profile'
import { createCodexProvider, type CodexProviderOptions } from '@trick-harness/provider-codex'
import { createOpencodeProvider, type OpencodeAdapter } from '@trick-harness/provider-opencode'

/** Thrown when a set of providers cannot serve the policy it was composed with. */
export class BundleCompositionError extends Error {
  /** Stable machine-readable failure code. */
  readonly code = 'BUNDLE_COMPOSITION' as const

  /**
   * Construct a composition failure.
   * @param message - what the composition is missing.
   */
  constructor(message: string) {
    super(message)
    this.name = 'BundleCompositionError'
  }
}

/** What the OpenCode provider needs to be constructed. */
export interface OpencodeBundleOptions {
  /** The product seam the provider drives; supply `createSdkAdapter()` in production. */
  readonly adapter: OpencodeAdapter
}

/** What the Codex provider needs to be constructed. */
export type CodexBundleOptions = CodexProviderOptions

/**
 * Which providers this composition includes, and the policy it must serve.
 *
 * Every entry is optional, including all of them at once: an empty composition
 * is a valid runtime with nothing registered, which is what makes "this
 * executor can be left out entirely" a configuration choice rather than a code
 * change. A provider that is not configured is not imported into the
 * composition, not registered, and not reachable by a route.
 */
export interface HarnessRuntimeBundleOptions {
  /** Include the OpenCode executor. */
  readonly opencode?: OpencodeBundleOptions
  /** Include the Codex executor. */
  readonly codex?: CodexBundleOptions
  /**
   * Providers this package does not know about.
   *
   * The seam that keeps a future executor from being a bundle edit: anything
   * satisfying the provider contract composes here on equal terms with the two
   * named above.
   */
  readonly extraProviders?: readonly ExecutorProvider[]
  /**
   * Policy the composition must be able to serve.
   *
   * When present, every executor the profile's routing table names must be
   * registered, or composition fails. The check runs here rather than at
   * dispatch because a missing executor is a deployment mistake, and finding it
   * at the first route means finding it halfway through someone's work.
   */
  readonly profile?: HarnessProfile
}

/** A composed runtime and the handle that takes it apart again. */
export interface HarnessRuntimeBundle {
  /** The populated runtime. */
  readonly runtime: HarnessExecutorRuntime
  /** The registered executor names, in registration order. */
  readonly executors: readonly string[]
  /**
   * Unregister everything this composition registered and end runs in flight.
   *
   * The bundle owns its runtime, so disposing it is disposing that runtime:
   * the promise settles only once every run has come back through its
   * provider's teardown.
   * @returns Nothing; resolves when the runtime is quiet.
   */
  dispose(): Promise<void>
}

/** What a composition added to a runtime it does not own. */
export interface BundleComposition {
  /** The registered executor names, in registration order. */
  readonly executors: readonly string[]
  /** Unregister exactly the providers this composition registered. */
  dispose(): void
}

/**
 * Read the executor names a profile's routing table can produce.
 *
 * Both rule lists are read, because a fallback route is dispatched exactly when
 * something has already gone wrong and is the worst moment to discover that its
 * executor was never registered. Rows naming no executor are advisory policy
 * this composition has no opinion about.
 * @param profile - the profile whose routing table is read.
 * @returns the distinct executor names, in first-appearance order.
 */
export function routedExecutors(profile: HarnessProfile): readonly string[] {
  const { rules, fallbackRules } = profile.routingPolicy
  const names: string[] = []
  const rows: readonly PolicyRuleDefinition[] = [...rules, ...fallbackRules]
  for (const rule of rows) {
    const executor = rule.use['executor']
    if (typeof executor !== 'string' || names.includes(executor)) continue
    names.push(executor)
  }
  return Object.freeze(names)
}

/**
 * Build the providers this configuration asks for, in a stable order.
 * @param options - the composition configuration.
 * @returns the constructed providers, none of which has started anything.
 */
function buildProviders(options: HarnessRuntimeBundleOptions): readonly ExecutorProvider[] {
  const providers: ExecutorProvider[] = []
  if (options.opencode !== undefined) providers.push(createOpencodeProvider(options.opencode.adapter))
  if (options.codex !== undefined) providers.push(createCodexProvider(options.codex))
  providers.push(...options.extraProviders ?? [])
  return providers
}

/**
 * Register a configured set of providers on an existing runtime.
 *
 * Registration is all-or-nothing: a provider the runtime rejects, or a profile
 * the composition cannot serve, takes every registration this call made back
 * out. A half-composed runtime would dispatch some routes and fail others,
 * which is a worse failure than not loading.
 * @param runtime - the runtime to compose onto.
 * @param options - which providers to include and which policy to satisfy.
 * @returns the composition's executor names and its disposer.
 */
export function composeHarnessRuntime(
  runtime: HarnessExecutorRuntime,
  options: HarnessRuntimeBundleOptions = {},
): BundleComposition {
  const registrations: ExecutorRegistration[] = []
  const executors: string[] = []
  // Reversed through a copy: `dispose` is the same function, and a caller who
  // disposes twice must not be quietly reordering the list under itself.
  const undo = (): void => {
    for (const registration of [...registrations].reverse()) registration.dispose()
  }
  // Before anything is constructed, let alone registered. A profile only has to
  // be well-typed to the compiler, and a deserialized one has not been near a
  // compiler at all; reading its routing table first would mean a product
  // provider had already been built for policy that was never policy.
  if (options.profile !== undefined) validateProfile(options.profile)
  try {
    for (const provider of buildProviders(options)) {
      registrations.push(runtime.register(provider))
      executors.push(provider.name)
    }
    if (options.profile !== undefined) {
      const registered = new Set(runtime.list().map(provider => provider.name))
      const missing = routedExecutors(options.profile).filter(name => !registered.has(name))
      if (missing.length > 0) {
        throw new BundleCompositionError(
          `profile ${JSON.stringify(options.profile.id)} routes to unregistered executor(s): ${missing.join(', ')}`,
        )
      }
    }
  } catch (error: unknown) {
    undo()
    throw error
  }
  return {
    executors: Object.freeze([...executors]),
    dispose: undo,
  }
}

/**
 * Create a runtime and compose the configured providers onto it.
 *
 * The convenience form for a deployment that owns its whole runtime; use
 * {@link composeHarnessRuntime} to add providers to a runtime someone else
 * owns, such as the Cordis service on a live context.
 * @param options - which providers to include and which policy to satisfy.
 * @returns the composed bundle.
 */
export function createHarnessRuntimeBundle(
  options: HarnessRuntimeBundleOptions = {},
): HarnessRuntimeBundle {
  const runtime = createExecutorRuntime()
  const composition = composeHarnessRuntime(runtime, options)
  return {
    runtime,
    executors: composition.executors,
    async dispose(): Promise<void> {
      composition.dispose()
      await runtime.dispose()
    },
  }
}

export * from './harness.ts'
