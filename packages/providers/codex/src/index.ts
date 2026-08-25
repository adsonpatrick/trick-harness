/**
 * The Codex executor provider.
 *
 * One run means one `codex app-server --stdio` child from the package-local
 * official payload, one ephemeral thread rooted in `request.cwd`, one turn, and
 * disposal to process-tree quiescence. Authentication, account state, and every
 * setting this provider does not route come from the user's own Codex
 * installation: nothing here reads, writes, or synthesises `CODEX_HOME`, a
 * Codex profile, a config file, or an API key.
 *
 * @module @trick-harness/provider-codex
 */

import {
  DEFAULT_CODEX_PERMISSION_MODE,
  DEFAULT_DISPOSE_GRACE_MS,
  parseCodexDiagnostic,
  startCodexTask,
  type CodexPermissionMode,
  type CodexRouting,
} from '@deepseek-ai/dsh-subagent-codex'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type {
  ExecutorCapabilities,
  ExecutorProvider,
  ExecutorResult,
  ExecutorStartRequest,
} from '@trick-harness/executor'
import { CodexRouteError, executorFailure, sandboxMode } from './config.ts'

export {
  CodexRouteError,
  executorFailure,
  isAvailabilityFailure,
  sandboxMode,
  NON_AVAILABILITY_CATEGORIES,
} from './config.ts'

/** The provider name routes select this executor by. */
export const CODEX_EXECUTOR = 'codex'

/**
 * What this provider honours per run.
 *
 * Both overrides are true because the pinned app-server schema has a field for
 * each — `TurnStartParams.model` and `TurnStartParams.effort` — and the
 * transport emits them per turn without touching any global default.
 */
export const CODEX_CAPABILITIES: ExecutorCapabilities = {
  modelOverride: true,
  reasoningEffort: true,
  permissionModes: ['read-only', 'workspace-write'],
}

/** How a Codex child is launched and supervised, independent of any one route. */
export interface CodexProviderOptions {
  /** The subprocess seam; supply `ctx.subprocess.spawn` in a composed runtime. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /**
   * Explicit environment entries for the child, layered over the subprocess
   * seam's credential-scrubbed parent environment.
   *
   * Empty by default, and deliberately not populated from the host: injecting
   * an API key merely because one exists on the machine would silently move a
   * subscription run onto metered billing under a different identity.
   */
  readonly env?: Record<string, string>
  /**
   * Native non-interactive approval policy.
   *
   * Defaults to `never`, which is the only unattended mode: a routed worker has
   * no human to answer an approval request. The route's permission mode then
   * fixes the sandbox on top of it.
   */
  readonly permissionMode?: CodexPermissionMode
  /** Grace in milliseconds for app-server process-tree termination. */
  readonly disposeGraceMs?: number
}

/**
 * Reduce a child's final output to text.
 * @param output - the terminal assistant content blocks.
 * @returns the concatenated text, empty when the child produced none.
 */
function finalText(output: SubagentResult['output']): string {
  return output
    .map(block => block.type === 'text' ? block.text : '')
    .join('')
}

/**
 * Map a settled child result onto the executor contract.
 * @param result - the child's terminal result.
 * @returns the bounded executor result.
 */
function translate(result: SubagentResult): ExecutorResult {
  if (result.stopReason === 'completed') {
    return { status: 'completed', output: finalText(result.output) }
  }
  if (result.stopReason === 'aborted') {
    return { status: 'aborted', output: finalText(result.output) }
  }
  // A diagnostic this package cannot parse is reported as `unknown` rather
  // than forwarded: the string is provider-authored and safe by contract, but
  // its shape is not, and a category read out of unrecognised prose would be
  // a guess that fallback routing then acts on.
  const facts = result.diagnostic === undefined
    ? undefined
    : parseCodexDiagnostic(result.diagnostic)
  return {
    status: 'error',
    output: '',
    failure: executorFailure(facts?.category ?? 'unknown', facts?.httpStatus),
  }
}

/**
 * Create the Codex executor provider.
 * @param options - the subprocess seam and deployment-owned child settings.
 * @returns a provider ready to register on an executor runtime.
 */
export function createCodexProvider(options: CodexProviderOptions): ExecutorProvider {
  return {
    name: CODEX_EXECUTOR,
    capabilities: CODEX_CAPABILITIES,

    async start(request: ExecutorStartRequest): Promise<ExecutorResult> {
      let run: SubagentRun | undefined
      // Read through a call so the compiler cannot narrow the flag and treat a
      // later check as dead: the caller aborts between these statements, which
      // is exactly the case being checked.
      const aborted = (): boolean => request.signal.aborted
      try {
        // Translate before spawning: a route this provider cannot express
        // should cost no process.
        const routing: CodexRouting = {
          sandbox: sandboxMode(request.route.permissionMode),
          ...request.route.model === undefined ? {} : { model: request.route.model },
          ...request.route.reasoningEffort === undefined
            ? {}
            : { effort: request.route.reasoningEffort },
        }
        run = await startCodexTask({ texts: [request.task], signal: request.signal }, {
          cwd: request.cwd,
          permissionMode: options.permissionMode ?? DEFAULT_CODEX_PERMISSION_MODE,
          env: options.env ?? {},
          disposeGraceMs: options.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS,
          spawn: options.spawn,
          routing,
        })
        return translate(await run.result)
      } catch (error) {
        if (aborted()) return { status: 'aborted', output: '' }
        if (error instanceof CodexRouteError) {
          return {
            status: 'error',
            output: '',
            failure: {
              category: 'route-unsupported',
              availability: true,
              safeDiagnostic: error.message,
            },
          }
        }
        const name = error instanceof Error ? error.name : 'Error'
        return {
          status: 'error',
          output: '',
          failure: {
            category: 'provider-error',
            availability: false,
            safeDiagnostic: `codex run failed (${name})`,
          },
        }
      } finally {
        // Disposal is unconditional and awaited: the run owns a real process
        // tree, and the executor contract promises quiescence, not a request
        // to stop. A teardown fault cannot change the outcome above.
        if (run !== undefined) {
          try {
            await run.dispose()
          } catch {
            // Reported by the owning runtime's disposal path.
          }
        }
      }
    },
  }
}
