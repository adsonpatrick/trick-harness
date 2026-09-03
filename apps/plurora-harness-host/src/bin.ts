#!/usr/bin/env node
/**
 * Node process adapter for the Plurora host executable.
 *
 * This file deliberately owns no host policy. It translates Node's argv,
 * inherited environment, output streams, and termination signals into the
 * testable lifecycle runner, then leaves Node alive until that runner has
 * released every resource it acquired.
 *
 * @module apps/plurora-harness-host/bin
 */

import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createProductionRuntime, parsePluroraHostArgs, runPluroraHost, type PluroraHostRuntime } from './entrypoint.ts'

/** The Node process surface the executable needs. */
export interface PluroraHostProcess {
  /** Node invocation arguments, including executable and script paths. */
  readonly argv: readonly string[]
  /** The absolute current working directory. */
  cwd(): string
  /** The inherited process environment. */
  readonly env: Record<string, string | undefined>
  /** Standard output. */
  readonly stdout: { write(line: string): unknown }
  /** Standard error. */
  readonly stderr: { write(line: string): unknown }
  /** Subscribe to a process signal. */
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  /** Remove a process signal listener. */
  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  /** Conventional completion status; Node exits naturally after teardown. */
  exitCode: number | string | null | undefined
}

/** Run the executable through a Node process-shaped adapter. */
export async function runProcess(
  processLike: PluroraHostProcess,
  runtime?: PluroraHostRuntime,
): Promise<number> {
  const selectedRuntime = runtime ?? createProductionRuntime({
    cwd: processLike.cwd(),
    env: processLike.env,
    writeOut: (line) => { processLike.stdout.write(`${line}\n`) },
    writeError: (line) => { processLike.stderr.write(`${line}\n`) },
    subscribeTermination: (listener) => {
      const onTermination = (): void => { listener() }
      processLike.on('SIGINT', onTermination)
      processLike.on('SIGTERM', onTermination)
      return () => {
        processLike.off('SIGINT', onTermination)
        processLike.off('SIGTERM', onTermination)
      }
    },
  })
  let result: number
  try {
    result = await runPluroraHost(parsePluroraHostArgs(processLike.argv.slice(2), selectedRuntime.cwd), selectedRuntime)
  } catch (error: unknown) {
    const message = error instanceof Error ? `plurora-host: ${error.name}: ${error.message}` : 'plurora-host: startup failed'
    selectedRuntime.writeError(message)
    result = 1
  }
  processLike.exitCode = result
  return result
}

/** Whether this module is being invoked as Node's executable target. */
function invokedDirectly(): boolean {
  const script = process.argv[1]
  return script !== undefined && import.meta.url === pathToFileURL(resolve(script)).href
}

if (invokedDirectly()) {
  await runProcess(process)
}
