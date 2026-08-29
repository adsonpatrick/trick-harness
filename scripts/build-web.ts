/** Build the Web frontend through the package manager that launched this script. */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pnpmInvocation } from './pnpm-invocation.ts'

// Spawning a bare `pnpm` would depend on a `pnpm` on PATH, which is not there
// when the repository is driven through `corepack pnpm`: corepack shims the
// name for its own process, not for the children a lifecycle script spawns.
// Every other script here already resolves the manager from `npm_execpath`.
const invocation = pnpmInvocation(['--filter', '@deepseek-ai/dsh-web-frontend', 'run', 'build'])
const result = spawnSync(invocation.command, invocation.args, {
  cwd: resolve(import.meta.dirname, '..'),
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
process.exitCode = result.status ?? 1
