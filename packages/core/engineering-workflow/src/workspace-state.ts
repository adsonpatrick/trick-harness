import { normalizeRepositoryPath } from '@trick-harness/change-impact'
import type { WorkspaceSnapshot } from './types.ts'

/** A workspace snapshot pair that cannot be compared safely. */
export class WorkspaceStateError extends Error {
  override readonly name = 'WorkspaceStateError'
}

/**
 * Compare two snapshots of one checkout revision and return every path whose
 * state changed, including paths that were already dirty in the first snapshot.
 */
export function changedPathsBetween(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): readonly string[] {
  if (before.revision !== after.revision) {
    throw new WorkspaceStateError('workspace snapshots belong to different revisions')
  }

  const beforePaths = indexEntries(before)
  const afterPaths = indexEntries(after)
  const changed: string[] = []
  for (const path of new Set([...beforePaths.keys(), ...afterPaths.keys()])) {
    if (beforePaths.get(path) !== afterPaths.get(path)) changed.push(path)
  }
  return Object.freeze(changed.sort())
}

function indexEntries(snapshot: WorkspaceSnapshot): Map<string, string> {
  const indexed = new Map<string, string>()
  for (const entry of snapshot.entries) {
    let path: string
    try {
      path = normalizeRepositoryPath(entry.path)
    } catch {
      throw new WorkspaceStateError('workspace snapshot contains an invalid repository path')
    }
    if (indexed.has(path)) throw new WorkspaceStateError('workspace snapshot contains duplicate paths')
    indexed.set(path, entry.fingerprint)
  }
  return indexed
}
