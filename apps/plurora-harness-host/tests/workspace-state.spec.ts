import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowObjective } from '@trick-harness/contracts'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { changedPathsBetween } from '@trick-harness/engineering-workflow'
import { createGitWorkspaceStateReader } from '../src/workspace-state.ts'

const roots: string[] = []
const REVISION = 'a'.repeat(40)
const RAW = (status: 'A' | 'D' | 'M', path: string) =>
  `:100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} ${status}\0${path}\0`
const OBJECTIVE = {
  id: 'workspace-test',
  cwd: '',
  requirement: 'read workspace state',
  risk: 'low',
  workload: 'light',
  profileId: 'test',
  approvedArtifacts: {
    spec: { path: 'spec.md', sha256: 'b'.repeat(64) },
    plan: { path: 'plan.md', sha256: 'c'.repeat(64) },
  },
} satisfies WorkflowObjective

function fakeGit(outputs: readonly string[]): { specs: SubprocessSpawnSpec[]; spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle } {
  const specs: SubprocessSpawnSpec[] = []
  const spawn = (spec: SubprocessSpawnSpec): SubprocessHandle => {
    const index = specs.length
    specs.push(spec)
    const outcome: SubprocessOutcome = { exitCode: 0, signal: null }
    return {
      pid: 200 + index,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        stdout: {
          readFrom: () => ({ text: outputs[index] ?? '', nextOffset: 0, lossy: false }),
        },
      },
      done: Promise.resolve(outcome),
      terminate: vi.fn(),
      waitForExit: vi.fn(async () => true),
    }
  }
  return { specs, spawn }
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'harness-workspace-state-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Git workspace snapshots', () => {
  it('discovers deleted, renamed, and untracked candidates with argv-only Git reads', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'new.ts'), 'new content')
    await writeFile(join(root, 'untracked.txt'), 'untracked content')
    const git = fakeGit([
      `${REVISION}\n`,
      'src/old.ts\0src/new.ts\0src/deleted.ts\0src/file\tname.ts\0',
      'src/new.ts\0untracked.txt\0.plurora-harness/sessions/session.jsonl\0',
      RAW('D', 'src/old.ts') + RAW('A', 'src/new.ts') + RAW('D', 'src/deleted.ts')
        + RAW('D', 'src/file\tname.ts'),
    ])
    const reader = createGitWorkspaceStateReader({ projectRoot: root, disposeGraceMs: 5000, spawn: git.spawn })
    const snapshot = await reader.snapshot({ ...OBJECTIVE, cwd: root }, new AbortController().signal)

    expect(snapshot.entries.map(entry => entry.path)).toEqual([
      'src/deleted.ts', 'src/file\tname.ts', 'src/new.ts', 'src/old.ts', 'untracked.txt',
    ])
    expect(git.specs.slice(0, 3).map(spec => spec.argv)).toEqual([
      ['git', '-c', 'core.excludesFile=', 'rev-parse', 'HEAD'],
      ['git', '-c', 'core.excludesFile=', 'diff', '--name-only', '-z', '--no-renames', 'HEAD'],
      ['git', '-c', 'core.excludesFile=', 'ls-files', '--others', '--exclude-standard', '-z'],
    ])
    expect(git.specs[3]?.argv).toEqual([
      'git', '-c', 'core.excludesFile=', 'diff', '--raw', '-z', '--no-renames', 'HEAD',
    ])
    expect(git.specs.every(spec => spec.cwd === root)).toBe(true)
    expect(snapshot.entries.every(entry => !entry.fingerprint.includes('new content'))).toBe(true)
  })

  it('fingerprints content changes to paths that were already dirty', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src', 'already-dirty.ts')
    await writeFile(file, 'initial bytes')
    const git = fakeGit([
      `${REVISION}\n`, 'src/already-dirty.ts\0', '', RAW('M', 'src/already-dirty.ts'),
      `${REVISION}\n`, 'src/already-dirty.ts\0', '', RAW('M', 'src/already-dirty.ts'),
    ])
    const reader = createGitWorkspaceStateReader({ projectRoot: root, disposeGraceMs: 5000, spawn: git.spawn })
    const objective = { ...OBJECTIVE, cwd: root }
    const before = await reader.snapshot(objective, new AbortController().signal)
    await writeFile(file, 'subsequent bytes')
    const after = await reader.snapshot(objective, new AbortController().signal)

    expect(changedPathsBetween(before, after)).toContain('src/already-dirty.ts')
    expect(before.entries[0]?.fingerprint).not.toBe(after.entries[0]?.fingerprint)
  })
})
