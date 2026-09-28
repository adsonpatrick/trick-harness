import { describe, expect, it } from 'vitest'
import { changedPathsBetween, reconcileWorkspaceMutation } from '../src/workspace-state.ts'
import type { WorkspaceSnapshot } from '../src/types.ts'

function snapshot(entries: WorkspaceSnapshot['entries'], revision = 'a'.repeat(40)): WorkspaceSnapshot {
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

  it('detects staged and worktree state independently for the same path', () => {
    const before = snapshot([{ path: 'src/a.ts', surface: 'index', fingerprint: 'staged' }])
    const after = snapshot([
      { path: 'src/a.ts', surface: 'index', fingerprint: 'staged' },
      { path: 'src/a.ts', surface: 'worktree', fingerprint: 'unstaged' },
    ])
    expect(changedPathsBetween(before, after)).toEqual(['src/a.ts'])
  })

  it('rejects snapshots from different revisions', () => {
    expect(() => changedPathsBetween(snapshot([]), snapshot([], 'b'.repeat(40))))
      .toThrow(/revision/)
  })
})

describe('reconciling an interrupted workspace mutation', () => {
  it.each([
    ['no change', [], [], 'NO_MUTATION'],
    ['in-scope change', [], [{ path: 'src/a.ts', fingerprint: 'new' }], 'IN_SCOPE_MUTATION'],
    ['out-of-scope change', [], [{ path: 'docs/a.md', fingerprint: 'new' }], 'OUT_OF_SCOPE_MUTATION'],
    ['pre-existing dirty path touched', [{ path: 'src/a.ts', fingerprint: 'old' }], [{ path: 'src/a.ts', fingerprint: 'new' }], 'PREEXISTING_USER_STATE_TOUCHED'],
  ] as const)('%s has a stable bounded disposition', (_name, beforeEntries, afterEntries, status) => {
    const result = reconcileWorkspaceMutation(snapshot(beforeEntries), snapshot(afterEntries), {
      allowedPaths: ['src/a.ts'], writerQuiescent: true, observable: true,
    })
    expect(result.status).toBe(status)
  })

  it('does not authorize continuation while the writer is live or a surface is unobservable', () => {
    const clean = snapshot([])
    expect(reconcileWorkspaceMutation(clean, clean, {
      allowedPaths: [], writerQuiescent: false, observable: true,
    })).toMatchObject({ conclusive: false, reasonCode: 'WRITER_NOT_QUIESCENT' })
    expect(reconcileWorkspaceMutation(clean, clean, {
      allowedPaths: [], writerQuiescent: true, observable: false,
    })).toMatchObject({ status: 'UNOBSERVABLE_MUTATION_SURFACE', conclusive: false })
  })

  it('refuses to classify a moved revision as an ordinary file mutation', () => {
    expect(reconcileWorkspaceMutation(snapshot([]), snapshot([], 'b'.repeat(40)), {
      allowedPaths: ['src/a.ts'], writerQuiescent: true, observable: true,
    })).toMatchObject({ status: 'REVISION_MOVED', conclusive: false })
  })
})
