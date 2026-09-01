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
import { rename, writeFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { createSdkAdapter } from '@trick-harness/provider-opencode'
import type { OpencodeAdapter } from '@trick-harness/provider-opencode'
import { nativeCatalogueReader, type NativeCatalogueOptions } from './catalogue.ts'
import { DEFAULT_DISPOSE_GRACE_MS, startPluroraHost, validatePluroraDeployment, type PluroraHost, type PluroraHostOptions } from './main.ts'
import type { ModelCatalogReader } from './model-registry.ts'

/** The environment key that grants access to this host's loopback control server. */
export const CONTROL_TOKEN_ENV = 'PLURORA_HARNESS_TOKEN'

/** The only supported operator invocations. */
export const USAGE = [
  'Usage: plurora-host <validate|serve> --project-root <absolute-path> [--ready-file <absolute-path>]',
  '       plurora-host [--project-root <absolute-path>] [--session-id <id>]',
].join('\n')

/** Validated executable input. */
export type PluroraHostInvocation =
  /** The caller asked for usage without a host start. */
  | { readonly help: true; readonly projectRoot: string }
  /** Validate the deployment contract without changing the machine. */
  | { readonly command: 'validate'; readonly help: false; readonly projectRoot: string }
  /** Start the host and publish readiness at the ready file once listening. */
  | {
    readonly command: 'serve'
    readonly help: false
    readonly projectRoot: string
    /** The absolute path the ready envelope is atomically published at. */
    readonly readyFile: string
    /** The optional durable session identifier selected by the operator. */
    readonly sessionId?: string
  }
  /** The legacy bare invocation: start the host without a ready file. */
  | { readonly help: false; readonly projectRoot: string; readonly sessionId?: string }

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
  /**
   * Publish the ready document atomically at `path`.
   *
   * Called only after the control server is listening. The envelope itself is
   * a deployment contract and is assembled here; this seam is the one place
   * the executable's file system is touched.
   */
  readonly writeReadyFile: (path: string, envelope: string) => Promise<void>
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

/** Parse the settings the executable accepts. */
export function parsePluroraHostArgs(argv: readonly string[], cwd: string): PluroraHostInvocation {
  if (!isAbsolute(cwd)) refuse('the current working directory must be absolute')
  // pnpm forwards its conventional argument separator to a workspace script.
  // It belongs to the package-manager invocation, not to this host's surface.
  const argumentsAfterSeparator = argv[0] === '--' ? argv.slice(1) : argv
  const first = argumentsAfterSeparator[0]
  if (first === 'validate' || first === 'serve') {
    return parseSubcommand(first, argumentsAfterSeparator.slice(1), cwd)
  }
  if (argumentsAfterSeparator.length === 1 && first === '--help') {
    return { help: true, projectRoot: resolve(cwd) }
  }
  if (argumentsAfterSeparator.includes('--help')) refuse('--help cannot be combined with a host start')

  let projectRoot = resolve(cwd)
  let sessionId: string | undefined
  let sawProjectRoot = false
  let sawSessionId = false
  for (let index = 0; index < argumentsAfterSeparator.length; index += 1) {
    const argument = argumentsAfterSeparator[index]
    if (argument === '--project-root') {
      if (sawProjectRoot) refuse('--project-root was supplied more than once')
      const value = argumentsAfterSeparator[index + 1]
      if (value === undefined || value.trim() === '') refuse('--project-root requires an absolute path')
      if (!isAbsolute(value)) refuse('--project-root requires an absolute path')
      projectRoot = resolve(value)
      sawProjectRoot = true
      index += 1
      continue
    }
    if (argument === '--session-id') {
      if (sawSessionId) refuse('--session-id was supplied more than once')
      const value = argumentsAfterSeparator[index + 1]
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

/** Parse a `validate` or `serve` subcommand's settings. */
function parseSubcommand(
  command: 'validate' | 'serve',
  args: readonly string[],
  cwd: string,
): PluroraHostInvocation {
  if (args.length === 1 && args[0] === '--help') {
    return { help: true, projectRoot: resolve(cwd) }
  }
  if (args.includes('--help')) refuse('--help cannot be combined with a host start')

  let projectRoot = resolve(cwd)
  let readyFile: string | undefined
  let sessionId: string | undefined
  let sawProjectRoot = false
  let sawReadyFile = false
  let sawSessionId = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--project-root') {
      if (sawProjectRoot) refuse('--project-root was supplied more than once')
      const value = args[index + 1]
      if (value === undefined || value.trim() === '') refuse('--project-root requires an absolute path')
      if (!isAbsolute(value)) refuse('--project-root requires an absolute path')
      projectRoot = resolve(value)
      sawProjectRoot = true
      index += 1
      continue
    }
    if (argument === '--ready-file') {
      if (command === 'validate') refuse('--ready-file belongs to serve, not to validate')
      if (sawReadyFile) refuse('--ready-file was supplied more than once')
      const value = args[index + 1]
      if (value === undefined || value.trim() === '') refuse('--ready-file requires an absolute path')
      if (!isAbsolute(value)) refuse('--ready-file requires an absolute path')
      readyFile = resolve(value)
      sawReadyFile = true
      index += 1
      continue
    }
    if (argument === '--session-id') {
      if (command === 'validate') refuse('--session-id belongs to serve, not to validate')
      if (sawSessionId) refuse('--session-id was supplied more than once')
      const value = args[index + 1]
      if (value === undefined || value.trim() === '') refuse('--session-id requires a non-blank id')
      sessionId = value
      sawSessionId = true
      index += 1
      continue
    }
    refuse(`unknown argument ${JSON.stringify(argument)}`)
  }
  if (command === 'validate') return { command, help: false, projectRoot }
  if (readyFile === undefined) refuse('serve requires --ready-file with an absolute path')
  return sessionId === undefined
    ? { command, help: false, projectRoot, readyFile }
    : { command, help: false, projectRoot, readyFile, sessionId }
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

/** Assemble the non-secret ready document, published only after listening. */
function readyEnvelope(control: PluroraHost['control']): string {
  return JSON.stringify({
    schemaVersion: 1,
    status: 'READY',
    controlUrl: `http://${control.host}:${String(control.port)}`,
  }) + '\n'
}

/** Run the read-only deployment validation the stable CLI exposes. */
async function runValidate(
  invocation: Extract<PluroraHostInvocation, { command: 'validate' }>,
  runtime: PluroraHostRuntime,
): Promise<number> {
  let subprocess: ManagedSubprocess | undefined
  try {
    const controller = new AbortController()
    const unsubscribe = runtime.subscribeTermination(() => { controller.abort() })
    try {
      subprocess = await runtime.createSubprocess()
      const catalogue = runtime.createCatalogue({
        projectRoot: invocation.projectRoot,
        env: runtime.env as Record<string, string>,
        disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
        spawn: subprocess.spawn,
        signal: controller.signal,
      })
      // The same reading `serve` starts the host on. Nothing here opens a
      // durable session, binds a port or mutates GitHub/database state.
      await validatePluroraDeployment({ projectRoot: invocation.projectRoot, catalogue })
      runtime.writeOut('plurora-host: deployment is valid')
      return 0
    }
    finally {
      unsubscribe()
    }
  }
  catch (error: unknown) {
    runtime.writeError(diagnostic(error))
    return 1
  }
  finally {
    if (subprocess !== undefined) {
      try {
        await subprocess.dispose()
      }
      catch (error: unknown) {
        runtime.writeError(diagnostic(new AggregateError([error], 'host shutdown failed')))
      }
    }
  }
}

/** Run one validated host lifecycle, returning a conventional process exit code. */
export async function runPluroraHost(invocation: PluroraHostInvocation, runtime: PluroraHostRuntime): Promise<number> {
  if (invocation.help) {
    runtime.writeOut(USAGE)
    return 0
  }
  if ('command' in invocation && invocation.command === 'validate') {
    return await runValidate(invocation, runtime)
  }

  const readyFile = 'command' in invocation ? invocation.readyFile : undefined
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
    // The host only resolves once the control server is listening, so a ready
    // document written here cannot race the port. A failed start publishes
    // nothing: the catch below keeps a stale or half-written envelope from
    // ever being claimed as readiness.
    if (readyFile !== undefined) {
      await runtime.writeReadyFile(readyFile, readyEnvelope(host.control))
    }
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
    async writeReadyFile(path, envelope) {
      // A ready document must never be observed half-written, so the envelope
      // lands at a temporary sibling and is renamed into place only when it is
      // complete. The rename is atomic on the same volume by construction.
      await writeFile(`${path}.tmp`, envelope, { encoding: 'utf8', mode: 0o600 })
      await rename(`${path}.tmp`, path)
    },
  }
}
