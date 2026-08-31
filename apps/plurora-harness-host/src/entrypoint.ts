/**
 * The executable lifecycle around the Plurora host composition.
 *
 * The host itself accepts injected seams so it can be tested without product
 * processes. This module is the one production boundary that supplies those
 * seams, validates operator input before constructing them, and owns their
 * shutdown order.
 *
 * @module apps/plurora-harness-host/entrypoint
 */

import { isAbsolute, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { createSdkAdapter } from '@trick-harness/provider-opencode'
import type { OpencodeAdapter } from '@trick-harness/provider-opencode'
import { nativeCatalogueReader, type NativeCatalogueOptions } from './catalogue.ts'
import { DEFAULT_DISPOSE_GRACE_MS, startPluroraHost, type PluroraHost, type PluroraHostOptions } from './main.ts'
import type { ModelCatalogReader } from './model-registry.ts'

/** The environment key that grants access to this host's loopback control server. */
export const CONTROL_TOKEN_ENV = 'PLURORA_HARNESS_TOKEN'

/** The only supported operator invocation. */
export const USAGE = 'Usage: plurora-host [--project-root <absolute-path>] [--session-id <id>]'

/** Validated executable input. */
export interface PluroraHostInvocation {
  /** Whether the caller requested usage without a host start. */
  readonly help: boolean
  /** The checkout containing `plurora-harness.json`. */
  readonly projectRoot: string
  /** The optional durable session identifier selected by the operator. */
  readonly sessionId?: string
}

/** A managed subprocess service created for exactly one host lifecycle. */
export interface ManagedSubprocess {
  /** The shared spawn seam supplied to the host and native Codex catalogue. */
  readonly spawn: PluroraHostOptions['spawn']
  /** Stop every process tree the service still owns and await quiescence. */
  dispose(): Promise<void>
}

/** The executable's injectable process and product seams. */
export interface PluroraHostRuntime {
  /** The directory used when no project root argument is supplied. */
  readonly cwd: string
  /** Inherited native-provider environment, passed through without rewriting values. */
  readonly env: Record<string, string | undefined>
  /** Write one safe operational line to standard output. */
  readonly writeOut: (line: string) => void
  /** Write one safe diagnostic line to standard error. */
  readonly writeError: (line: string) => void
  /** Subscribe to process termination and return its unsubscriber. */
  readonly subscribeTermination: (listener: () => void) => () => void
  /** Create the process-tree owner for a host run. */
  readonly createSubprocess: () => Promise<ManagedSubprocess>
  /** Bind native authenticated model catalogues for the selected checkout. */
  readonly createCatalogue: (options: NativeCatalogueOptions) => ModelCatalogReader
  /** Bind the real OpenCode SDK adapter. */
  readonly createOpencode: () => OpencodeAdapter
  /** Start the composed host. */
  readonly start: (options: PluroraHostOptions) => Promise<PluroraHost>
}

/** Reject an invocation with a safe, stable operator-facing message. */
function refuse(message: string): never {
  throw new Error(`plurora-host: ${message}`)
}

/** Parse the only command-line settings the executable accepts. */
export function parsePluroraHostArgs(argv: readonly string[], cwd: string): PluroraHostInvocation {
  if (!isAbsolute(cwd)) refuse('the current working directory must be absolute')
  if (argv.length === 1 && argv[0] === '--help') return { help: true, projectRoot: resolve(cwd) }
  if (argv.includes('--help')) refuse('--help cannot be combined with a host start')

  let projectRoot = resolve(cwd)
  let sessionId: string | undefined
  let sawProjectRoot = false
  let sawSessionId = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--project-root') {
      if (sawProjectRoot) refuse('--project-root was supplied more than once')
      const value = argv[index + 1]
      if (value === undefined || value.trim() === '') refuse('--project-root requires an absolute path')
      if (!isAbsolute(value)) refuse('--project-root requires an absolute path')
      projectRoot = resolve(value)
      sawProjectRoot = true
      index += 1
      continue
    }
    if (argument === '--session-id') {
      if (sawSessionId) refuse('--session-id was supplied more than once')
      const value = argv[index + 1]
      if (value === undefined || value.trim() === '') refuse('--session-id requires a non-blank id')
      sessionId = value
      sawSessionId = true
      index += 1
      continue
    }
    refuse(`unknown argument ${JSON.stringify(argument)}`)
  }
  return sessionId === undefined
    ? { help: false, projectRoot }
    : { help: false, projectRoot, sessionId }
}

/** Render a failure without carrying a raw provider cause into process output. */
function diagnostic(error: unknown): string {
  if (error instanceof Error) return `plurora-host: ${error.name}: ${error.message}`
  return 'plurora-host: startup failed'
}

/** Wait until the executable is asked to terminate. */
function waitForTermination(subscribe: PluroraHostRuntime['subscribeTermination']): { wait: Promise<void>; unsubscribe: () => void } {
  let unsubscribe: (() => void) | undefined
  const wait = new Promise<void>((resolveTermination) => {
    unsubscribe = subscribe(resolveTermination)
  })
  return { wait, unsubscribe: () => { unsubscribe?.() } }
}

/** Run one validated host lifecycle, returning a conventional process exit code. */
export async function runPluroraHost(invocation: PluroraHostInvocation, runtime: PluroraHostRuntime): Promise<number> {
  if (invocation.help) {
    runtime.writeOut(USAGE)
    return 0
  }

  const controlToken = runtime.env[CONTROL_TOKEN_ENV]
  if (controlToken?.trim() === undefined || controlToken.trim() === '') {
    runtime.writeError(`plurora-host: ${CONTROL_TOKEN_ENV} is required`)
    return 1
  }

  let subprocess: ManagedSubprocess | undefined
  let host: PluroraHost | undefined
  let termination: ReturnType<typeof waitForTermination> | undefined
  try {
    const controller = new AbortController()
    termination = waitForTermination(listener => runtime.subscribeTermination(() => {
      controller.abort()
      listener()
    }))
    subprocess = await runtime.createSubprocess()
    const catalogue = runtime.createCatalogue({
      projectRoot: invocation.projectRoot,
      env: runtime.env as Record<string, string>,
      disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
      spawn: subprocess.spawn,
      signal: controller.signal,
    })
    host = await runtime.start({
      projectRoot: invocation.projectRoot,
      controlToken,
      signal: controller.signal,
      catalogue,
      spawn: subprocess.spawn,
      opencode: runtime.createOpencode(),
      ...(invocation.sessionId === undefined ? {} : { sessionId: invocation.sessionId }),
    })
    runtime.writeOut(`plurora-host: listening on http://${host.control.host}:${String(host.control.port)}`)
    await termination.wait
    return 0
  }
  catch (error: unknown) {
    runtime.writeError(diagnostic(error))
    return 1
  }
  finally {
    termination?.unsubscribe()
    const failures: unknown[] = []
    if (host !== undefined) {
      try {
        await host.dispose()
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (subprocess !== undefined) {
      try {
        await subprocess.dispose()
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (failures.length > 0) runtime.writeError(diagnostic(new AggregateError(failures, 'host shutdown failed')))
  }
}

/** Create the executable's production process and product seams. */
export function createProductionRuntime(options: Pick<PluroraHostRuntime, 'cwd' | 'env' | 'writeOut' | 'writeError' | 'subscribeTermination'>): PluroraHostRuntime {
  return {
    ...options,
    async createSubprocess() {
      const ctx = new Context()
      try {
        await ctx.plugin(LocalSubprocessRuntime)
        return {
          spawn: ctx.subprocess.spawn.bind(ctx.subprocess),
          dispose: async () => { await ctx.fiber.dispose() },
        }
      } catch (error: unknown) {
        await ctx.fiber.dispose()
        throw error
      }
    },
    createCatalogue: nativeCatalogueReader,
    createOpencode: createSdkAdapter,
    start: startPluroraHost,
  }
}
