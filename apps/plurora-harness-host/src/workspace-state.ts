import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readlink } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeRepositoryPath } from '@trick-harness/change-impact'
import type { WorkspaceSnapshot, WorkspaceStateReader } from '@trick-harness/engineering-workflow'
import type { WorkflowObjective } from '@trick-harness/contracts'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { SESSION_REPOSITORY_PATH } from './session-store.ts'

const MAX_GIT_OUTPUT_BYTES = 1024 * 1024
const COMMIT = /^[0-9a-f]{40}$/

/** Raised when a deterministic workspace snapshot could not be established. */
export class WorkspaceStateReadError extends Error {
  override readonly name = 'WorkspaceStateReadError'
}

/** What the deployment-specific reader needs to inspect its checkout. */
export interface GitWorkspaceStateReaderOptions {
  readonly projectRoot: string
  readonly disposeGraceMs: number
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
}

/** Create a read-only Git and filesystem snapshot reader for one checkout. */
export function createGitWorkspaceStateReader(
  options: GitWorkspaceStateReaderOptions,
): WorkspaceStateReader {
  return {
    async snapshot(_objective: WorkflowObjective, signal: AbortSignal): Promise<WorkspaceSnapshot> {
      const revision = (await git(options, ['rev-parse', 'HEAD'], signal, 'read the workspace revision')).trim()
      if (!COMMIT.test(revision)) {
        throw new WorkspaceStateReadError('git did not report one immutable workspace revision')
      }

      const tracked = await pathList(
        options, ['diff', '--name-only', '-z', '--no-renames', 'HEAD'], signal,
        'read changed tracked paths',
      )
      const untracked = await pathList(
        options, ['ls-files', '--others', '--exclude-standard', '-z'], signal,
        'read untracked paths',
      )
      // The host's append-only journal lives in the checkout for deployment
      // isolation, but it is operational state, not part of the change being
      // implemented. Its writes must never widen the measured delivery set.
      const candidates = [...new Set([...tracked, ...untracked])]
        .filter(path => path !== SESSION_REPOSITORY_PATH && !path.startsWith(`${SESSION_REPOSITORY_PATH}/`))
        .sort()
      const metadata = candidates.length === 0
        ? new Map<string, string>()
        : await rawMetadata(options, signal, new Set(tracked))
      const entries = await Promise.all(candidates.map(async path => ({
        path,
        fingerprint: await fingerprint(options.projectRoot, path, metadata.get(path) ?? ''),
      })))
      return Object.freeze({ revision, entries: Object.freeze(entries) })
    },
  }
}

async function pathList(
  options: GitWorkspaceStateReaderOptions,
  args: readonly string[],
  signal: AbortSignal,
  what: string,
): Promise<readonly string[]> {
  const output = await git(options, args, signal, what)
  if (output === '') return []
  if (!output.endsWith('\0')) throw new WorkspaceStateReadError(`git returned a malformed list while trying to ${what}`)
  const fields = output.slice(0, -1).split('\0')
  const normalized = new Set<string>()
  try {
    for (const path of fields) {
      if (path === '') throw new WorkspaceStateReadError(`git returned a malformed list while trying to ${what}`)
      const candidate = normalizeRepositoryPath(path)
      if (normalized.has(candidate)) throw new WorkspaceStateReadError(`git returned a duplicate path while trying to ${what}`)
      normalized.add(candidate)
    }
  } catch {
    throw new WorkspaceStateReadError(`git returned an invalid repository path while trying to ${what}`)
  }
  return Object.freeze([...normalized].sort())
}

async function fingerprint(
  projectRoot: string,
  path: string,
  metadata: string,
): Promise<string> {
  const state = await worktreeFingerprint(projectRoot, path)
  return createHash('sha256').update(JSON.stringify([metadata, state]), 'utf8').digest('hex')
}

async function rawMetadata(
  options: GitWorkspaceStateReaderOptions,
  signal: AbortSignal,
  trackedPaths: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const output = await git(options, ['diff', '--raw', '-z', '--no-renames', 'HEAD'], signal, 'read raw change metadata')
  if (output === '') return new Map()
  if (!output.endsWith('\0')) throw new WorkspaceStateReadError('git returned malformed raw change metadata')
  const fields = output.slice(0, -1).split('\0')
  if (fields.length % 2 !== 0) throw new WorkspaceStateReadError('git returned malformed raw change metadata')
  const metadata = new Map<string, string>()
  for (let index = 0; index < fields.length; index += 2) {
    const header = fields[index] ?? ''
    const path = fields[index + 1] ?? ''
    if (!/^:[0-7]{6} [0-7]{6} [0-9a-f]+ [0-9a-f]+ [ADMTUXB]$/.test(header)) {
      throw new WorkspaceStateReadError('git returned a raw change status this host does not read')
    }
    let normalized: string
    try {
      normalized = normalizeRepositoryPath(path)
    } catch {
      throw new WorkspaceStateReadError('git returned an invalid path in raw change metadata')
    }
    if (!trackedPaths.has(normalized) || metadata.has(normalized)) {
      throw new WorkspaceStateReadError('git raw metadata did not match its tracked path list')
    }
    metadata.set(normalized, header)
  }
  if (metadata.size !== trackedPaths.size) {
    throw new WorkspaceStateReadError('git raw metadata did not cover every tracked path')
  }
  return metadata
}

async function worktreeFingerprint(projectRoot: string, path: string): Promise<string> {
  const absolute = join(projectRoot, ...path.split('/'))
  let info
  try {
    info = await lstat(absolute)
  } catch (error) {
    if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return 'deleted'
    throw new WorkspaceStateReadError('the worktree path could not be inspected')
  }

  if (info.isSymbolicLink()) {
    try {
      return `symlink:${await readlink(absolute)}`
    } catch {
      throw new WorkspaceStateReadError('the worktree symlink could not be read')
    }
  }
  if (!info.isFile()) throw new WorkspaceStateReadError('the worktree contains an unsupported filesystem object')

  const hash = createHash('sha256')
  try {
    for await (const chunk of createReadStream(absolute)) hash.update(chunk as Buffer)
  } catch {
    throw new WorkspaceStateReadError('the worktree file could not be fingerprinted')
  }
  return `file:${hash.digest('hex')}`
}

async function git(
  options: GitWorkspaceStateReaderOptions,
  args: readonly string[],
  signal: AbortSignal,
  what: string,
): Promise<string> {
  let child: SubprocessHandle
  try {
    child = options.spawn({
      argv: ['git', '-c', 'core.excludesFile=', ...args],
      cwd: options.projectRoot,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: MAX_GIT_OUTPUT_BYTES },
        stderr: { maxBytes: MAX_GIT_OUTPUT_BYTES },
      },
      graceMs: options.disposeGraceMs,
      signal,
    })
  } catch {
    throw new WorkspaceStateReadError(`git could not be started to ${what}`)
  }

  try {
    const outcome = await child.done
    if (!await child.waitForExit()) throw new WorkspaceStateReadError(`git did not stop after trying to ${what}`)
    if (outcome.exitCode !== 0) throw new WorkspaceStateReadError(`git could not ${what}`)
    const result = child.collected.stdout?.readFrom(0)
    if (result === undefined || result.lossy) throw new WorkspaceStateReadError(`git output was incomplete while trying to ${what}`)
    return result.text
  } finally {
    child.terminate()
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
