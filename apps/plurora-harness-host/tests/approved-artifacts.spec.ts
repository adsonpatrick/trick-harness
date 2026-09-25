import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { ApprovedArtifactError, loadApprovedArtifacts } from '../src/approved-artifacts.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

function fake(outputs: readonly string[]) {
  const specs: SubprocessSpawnSpec[] = []
  const terminate = vi.fn()
  return {
    specs, terminate,
    spawn: (spec: SubprocessSpawnSpec): SubprocessHandle => {
      const text = outputs[specs.length] ?? ''
      specs.push(spec)
      const done: Promise<SubprocessOutcome> = Promise.resolve({ exitCode: 0, signal: null })
      return {
        pid: specs.length, stdin: undefined, stdout: undefined, stderr: undefined, done, terminate,
        waitForExit: async () => true,
        collected: { stdout: { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) } },
      }
    },
  }
}

describe('registered approved artifacts', () => {
  it('reads only a source whose remote, revision and document hashes match approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'approved-artifacts-')); roots.push(root)
    await mkdir(join(root, 'docs')); await writeFile(join(root, 'docs', 'spec.md'), 'spec'); await writeFile(join(root, 'docs', 'plan.md'), 'plan')
    const git = fake(['git@github.com:adsonpatrick/trick-harness.git\n', `${'a'.repeat(40)}\n`])
    const result = await loadApprovedArtifacts('/workspace', {
      spec: { path: 'docs/spec.md', sha256: hash('spec') }, plan: { path: 'docs/plan.md', sha256: hash('plan') },
      source: { id: 'design', revision: 'a'.repeat(40) },
    }, {
      sources: { design: { repository: 'adsonpatrick/trick-harness', checkout: root } },
      spawn: git.spawn, disposeGraceMs: 1,
    }, new AbortController().signal)
    expect(result.specText).toBe('spec')
    expect(git.specs[0]?.argv).toContain('core.excludesFile=')
    expect(git.terminate).toHaveBeenCalledTimes(2)
  })

  it('refuses a mismatched registered source before reading artifacts', async () => {
    const git = fake(['https://github.com/other/repository.git\n'])
    await expect(loadApprovedArtifacts('/workspace', { spec: { path: 'x', sha256: 'a'.repeat(64) }, plan: { path: 'y', sha256: 'b'.repeat(64) }, source: { id: 'design', revision: 'a'.repeat(40) } }, { sources: { design: { repository: 'adsonpatrick/trick-harness', checkout: tmpdir() } }, spawn: git.spawn, disposeGraceMs: 1 }, new AbortController().signal)).rejects.toThrow(ApprovedArtifactError)
  })

  it('refuses a source whose checked out revision differs from approval', async () => {
    const git = fake(['https://github.com/adsonpatrick/trick-harness.git\n', `${'b'.repeat(40)}\n`])
    await expect(loadApprovedArtifacts('/workspace', { spec: { path: 'x', sha256: 'a'.repeat(64) }, plan: { path: 'y', sha256: 'b'.repeat(64) }, source: { id: 'design', revision: 'a'.repeat(40) } }, { sources: { design: { repository: 'adsonpatrick/trick-harness', checkout: tmpdir() } }, spawn: git.spawn, disposeGraceMs: 1 }, new AbortController().signal)).rejects.toThrow(ApprovedArtifactError)
  })

  it('refuses paths that escape the registered checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'approved-artifacts-')); roots.push(root)
    const git = fake(['https://github.com/adsonpatrick/trick-harness.git\n', `${'a'.repeat(40)}\n`])
    await expect(loadApprovedArtifacts('/workspace', { spec: { path: '../spec.md', sha256: 'a'.repeat(64) }, plan: { path: 'plan.md', sha256: 'b'.repeat(64) }, source: { id: 'design', revision: 'a'.repeat(40) } }, { sources: { design: { repository: 'adsonpatrick/trick-harness', checkout: root } }, spawn: git.spawn, disposeGraceMs: 1 }, new AbortController().signal)).rejects.toThrow(ApprovedArtifactError)
  })

  it('refuses documents whose content no longer matches approved hashes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'approved-artifacts-')); roots.push(root)
    await writeFile(join(root, 'spec.md'), 'changed'); await writeFile(join(root, 'plan.md'), 'plan')
    const git = fake(['https://github.com/adsonpatrick/trick-harness.git\n', `${'a'.repeat(40)}\n`])
    await expect(loadApprovedArtifacts('/workspace', { spec: { path: 'spec.md', sha256: hash('spec') }, plan: { path: 'plan.md', sha256: hash('plan') }, source: { id: 'design', revision: 'a'.repeat(40) } }, { sources: { design: { repository: 'adsonpatrick/trick-harness', checkout: root } }, spawn: git.spawn, disposeGraceMs: 1 }, new AbortController().signal)).rejects.toThrow(ApprovedArtifactError)
  })
})
