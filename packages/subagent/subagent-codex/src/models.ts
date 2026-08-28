/**
 * Reading the authenticated Codex model catalogue.
 *
 * A deployment needs to know at boot whether the models its policy routes to
 * exist for the signed-in account. The only honest way to answer that is to ask
 * the product, and the only read-only way to ask it is `model/list`.
 *
 * This module is deliberately narrow about what "read-only" means. It starts the
 * same app-server the run path starts, in the same way, and then does strictly
 * less: no thread, no turn, no tokens spent, and nothing written to the account.
 * It also passes the caller's environment through untouched — it neither injects
 * `OPENAI_API_KEY` nor rewrites the Codex home, so a machine signed in through
 * ChatGPT stays signed in through ChatGPT and a boot check never silently
 * changes how later runs authenticate.
 *
 * @module @deepseek-ai/dsh-subagent-codex/models
 */

import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { DEFAULT_CODEX_PERMISSION_MODE, codexAppServerArgv, disposeCodexChild } from './run.ts'
import { CodexAppServerWire, type CodexCatalogModel } from './wire.ts'

/** Everything one catalogue read needs. */
export interface CodexModelListSpec {
  /** Working directory for the app-server, as for a run. */
  readonly cwd: string
  /** The environment to spawn under, passed through exactly as given. */
  readonly env: Record<string, string>
  /** Subprocess termination grace for the release below. */
  readonly disposeGraceMs: number
  /** Shared subprocess service spawn operation. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Cancels the spawn, the handshake and the read. */
  readonly signal: AbortSignal
}

/**
 * Read the model catalogue the signed-in Codex account can be asked for.
 *
 * @param spec - where to run, what to run under, and how to cancel.
 * @returns every advertised model id and the reasoning efforts it supports.
 * @throws {Error} when the app-server could not be started or answered invalidly.
 */
export async function listCodexModels(spec: CodexModelListSpec): Promise<readonly CodexCatalogModel[]> {
  const child = spec.spawn({
    argv: codexAppServerArgv(),
    cwd: spec.cwd,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    graceMs: spec.disposeGraceMs,
    env: spec.env,
  })
  const wire = new CodexAppServerWire(
    child.stdout as NonNullable<SubprocessHandle['stdout']>,
    child.stdin as NonNullable<SubprocessHandle['stdin']>,
    // No turn is ever started here, so the permission mode is never consulted.
    // The default keeps this call from being a second place that decides one.
    DEFAULT_CODEX_PERMISSION_MODE,
  )
  wire.start()
  try {
    await wire.initialize(spec.signal)
    return await wire.listModels(spec.signal)
  } finally {
    // A boot check that leaks an app-server per attempt would be worse than the
    // gap it closes, so the process is released on the failing path too.
    await disposeCodexChild(wire, child)
  }
}
