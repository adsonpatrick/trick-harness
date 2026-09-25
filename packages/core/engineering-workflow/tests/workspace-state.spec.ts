import { describe, expect, it } from 'vitest'
import { changedPathsBetween } from '../src/workspace-state.ts'
import type { WorkspaceSnapshot } from '../src/types.ts'

function snapshot(entries: readonly { path: string; fingerprint: string }[], revision = 'a'.repeat(40)): WorkspaceSnapshot {
  return { revision, entries }
}

describe('comparing workspace snapshots', () => {
  it('returns no paths when fingerprints are unchanged', () => {
    expect(changedPathsBetween(snapshot([{ path: 'src/a.ts', fingerprint: 'same' }]), snapshot([{ path: 'src/a.ts', fingerprint: 'same' }]))).toEqual([])
  })

  it('reports added, removed, and changed paths in sorted order', () => {
    const before = snapshot([
      { path: 'src/removed.ts', fingerprint: 'before' },
      { path: 'src/changed.ts', fingerprint: 'old' },
    ])
    const after = snapshot([
      { path: 'src/changed.ts', fingerprint: 'new' },
      { path: 'src/added.ts', fingerprint: 'after' },
    ])

    expect(changedPathsBetween(before, after)).toEqual(['src/added.ts', 'src/changed.ts', 'src/removed.ts'])
  })

  it('rejects snapshots from different revisions', () => {
    expect(() => changedPathsBetween(snapshot([]), snapshot([], 'b'.repeat(40))))
      .toThrow(/revision/)
  })
})
