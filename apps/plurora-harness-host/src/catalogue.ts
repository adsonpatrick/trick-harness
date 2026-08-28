/**
 * The native model catalogues, read from the products themselves.
 *
 * This module is the deployment's binding to two authenticated accounts, and it
 * is the only place in this app that talks to either product. Both reads are
 * read-only in the strong sense: OpenCode is asked for its provider
 * configuration and Codex for its model list, and neither call starts a session,
 * spends a token, or writes to the account.
 *
 * The environment is passed through untouched on purpose. A boot check that
 * injected an API key or rewrote a Codex home would change how every later run
 * authenticates, which is a much larger thing than the gap it was closing.
 *
 * @module apps/plurora-harness-host/catalogue
 */

import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { listCodexModels } from '@deepseek-ai/dsh-subagent-codex'
import type { ModelCatalogReader } from './model-registry.ts'

/** What a native catalogue read needs from the deployment. */
export interface NativeCatalogueOptions {
  /** The checkout both products are rooted in. */
  readonly projectRoot: string
  /** The environment Codex is spawned under, passed through exactly as given. */
  readonly env: Record<string, string>
  /** Subprocess termination grace for the Codex app-server. */
  readonly disposeGraceMs: number
  /** Shared subprocess service spawn operation. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Cancels either read. */
  readonly signal: AbortSignal
}

/** One provider entry as OpenCode's configuration endpoint reports it. */
export interface OpencodeProviderEntry {
  /** The provider id, the left half of a routed model id. */
  readonly id: string
  /** The models this provider offers, keyed by model id. */
  readonly models: Readonly<Record<string, unknown>>
}

/**
 * Flatten OpenCode's provider configuration into the ids a route names.
 *
 * OpenCode reports providers and their models separately but is asked for
 * `provider/model`, so this is where the two halves become the one string a
 * deployment's registry can be compared against. Anything unnamed on either
 * side is dropped rather than joined into a half-formed id that would then
 * fail to match and report the wrong problem.
 *
 * @param providers - the provider entries the endpoint reported.
 * @returns every `provider/model` pair, in the order reported.
 */
export function normalizeOpencodeModels(providers: readonly OpencodeProviderEntry[]): readonly string[] {
  const ids: string[] = []
  for (const provider of providers) {
    if (provider.id === '') continue
    for (const model of Object.keys(provider.models)) {
      if (model !== '') ids.push(`${provider.id}/${model}`)
    }
  }
  return ids
}

/**
 * Bind the two native catalogues this deployment is validated against.
 *
 * @param options - the checkout, the environment, and how to spawn and cancel.
 * @returns a reader over both authenticated catalogues.
 */
export function nativeCatalogueReader(options: NativeCatalogueOptions): ModelCatalogReader {
  return {
    async opencodeModels() {
      // Port 0 on loopback: the server exists only for this one read, is never
      // reachable off the machine, and is closed before the answer is returned.
      const server = await createOpencodeServer({
        hostname: '127.0.0.1',
        port: 0,
        signal: options.signal,
      })
      try {
        const client = createOpencodeClient({ baseUrl: server.url, directory: options.projectRoot })
        const answered = await client.config.providers({ throwOnError: true })
        return normalizeOpencodeModels(answered.data.providers)
      } finally {
        await server.close()
      }
    },

    async codexModels() {
      return await listCodexModels({
        cwd: options.projectRoot,
        env: options.env,
        disposeGraceMs: options.disposeGraceMs,
        spawn: options.spawn,
        signal: options.signal,
      })
    },
  }
}
