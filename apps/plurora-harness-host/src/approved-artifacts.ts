import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ApprovedArtifactSet } from '@trick-harness/contracts'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

export class ApprovedArtifactError extends Error { override readonly name = 'ApprovedArtifactError' }

export interface RegisteredArtifactSource { readonly repository: string; readonly checkout: string }
export interface ApprovedArtifactResolverOptions {
  readonly sources?: Readonly<Record<string, RegisteredArtifactSource>>
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  readonly disposeGraceMs: number
}

function repositoryOf(remote: string): string | undefined {
  const value = remote.trim().replace(/\.git$/, '')
  const scp = /^git@github\.com:([^/]+)\/([^/]+)$/.exec(value)
  if (scp !== null) return `${scp[1]}/${scp[2]}`.toLowerCase()
  try {
    const url = new URL(value)
    if (url.hostname.toLowerCase() !== 'github.com') return undefined
    const parts = url.pathname.replace(/^\//, '').split('/')
    if (parts.length !== 2 || parts.some(part => part === '')) return undefined
    return `${parts[0]}/${parts[1]}`.toLowerCase()
  } catch { return undefined }
}

async function git(root: string, argv: readonly string[], options: ApprovedArtifactResolverOptions, signal: AbortSignal): Promise<string> {
  let child: SubprocessHandle
  try {
    child = options.spawn({ argv: ['git', '-c', 'core.excludesFile=', '-C', root, ...argv], cwd: root, graceMs: options.disposeGraceMs, signal, stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 * 1024 }, stderr: { maxBytes: 1024 * 1024 } } })
  } catch { throw new ApprovedArtifactError('the registered approved-artifact source could not be read') }
  try {
    const result = await child.done
    if (!await child.waitForExit() || result.exitCode !== 0) throw new ApprovedArtifactError('the registered approved-artifact source could not be verified')
    const output = child.collected.stdout?.readFrom(0)
    if (output === undefined || output.lossy) throw new ApprovedArtifactError('the registered approved-artifact source produced no bounded verification output')
    return output.text.trim()
  } finally { child.terminate() }
}

function pathIn(root: string, path: string): string {
  const resolved = resolve(root, path.replaceAll('\\', '/'))
  const inside = relative(root, resolved)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) throw new ApprovedArtifactError('an approved document is outside its registered source')
  return resolved
}

export async function loadApprovedArtifacts(
  cwd: string, artifacts: ApprovedArtifactSet, options: ApprovedArtifactResolverOptions, signal: AbortSignal,
): Promise<{ readonly specText: string; readonly planText: string; readonly specSha256: string; readonly planSha256: string }> {
  let root = cwd
  if (artifacts.source !== undefined) {
    const source = options.sources?.[artifacts.source.id]
    if (source === undefined) throw new ApprovedArtifactError('the approved-artifact source is not registered by this deployment')
    if (!isAbsolute(source.checkout)) throw new ApprovedArtifactError('the registered approved-artifact source has no absolute checkout')
    const remote = repositoryOf(await git(source.checkout, ['remote', 'get-url', 'origin'], options, signal))
    if (remote !== source.repository.toLowerCase() || await git(source.checkout, ['rev-parse', 'HEAD'], options, signal) !== artifacts.source.revision) throw new ApprovedArtifactError('the registered approved-artifact source does not match its approval')
    root = source.checkout
  }
  let specText: string
  let planText: string
  try {
    [specText, planText] = await Promise.all([readFile(pathIn(root, artifacts.spec.path), 'utf8'), readFile(pathIn(root, artifacts.plan.path), 'utf8')])
  } catch { throw new ApprovedArtifactError('the registered approved-artifact documents could not be read') }
  const specSha256 = createHash('sha256').update(specText, 'utf8').digest('hex')
  const planSha256 = createHash('sha256').update(planText, 'utf8').digest('hex')
  if (specSha256 !== artifacts.spec.sha256 || planSha256 !== artifacts.plan.sha256) throw new ApprovedArtifactError('the approved artifacts do not match their declared hashes')
  return { specText, planText, specSha256, planSha256 }
}
