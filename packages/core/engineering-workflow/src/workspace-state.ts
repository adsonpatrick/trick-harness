import { createHash } from 'node:crypto'
import { normalizeRepositoryPath } from '@trick-harness/change-impact'
import type { WorkspaceCheckpointRecord, WorkspaceReconciliationRecord } from '@trick-harness/journal'
import type { WorkspaceSnapshot } from './types.ts'

export const WORKSPACE_RECONCILIATION_STATUSES = [
  'NO_MUTATION',
  'IN_SCOPE_MUTATION',
  'OUT_OF_SCOPE_MUTATION',
  'PREEXISTING_USER_STATE_TOUCHED',
  'REVISION_MOVED',
  'SNAPSHOT_UNREADABLE',
  'UNOBSERVABLE_MUTATION_SURFACE',
] as const

export type WorkspaceReconciliationStatus = typeof WORKSPACE_RECONCILIATION_STATUSES[number]

export interface WorkspaceReconciliationOptions {
  readonly allowedPaths: readonly string[]
  readonly writerQuiescent: boolean
  readonly observable: boolean
}

export interface WorkspaceReconciliation {
  readonly status: WorkspaceReconciliationStatus
  readonly conclusive: boolean
  readonly changedPaths: readonly string[]
  readonly reasonCode?: string
}

/** Create a content-free durable checkpoint identity from one path-state snapshot. */
export function createWorkspaceCheckpoint(
  snapshot: WorkspaceSnapshot,
  identity: { readonly stageId: string; readonly attemptId: string; readonly capturedAtMs: number },
): WorkspaceCheckpointRecord {
  if (!/^[a-f0-9]{40}$/.test(snapshot.revision) || !Number.isSafeInteger(identity.capturedAtMs)
    || identity.capturedAtMs < 0) {
    throw new WorkspaceStateError('workspace checkpoint metadata is invalid')
  }
  const entries = indexEntries(snapshot)
  const boundedEntries = [...entries].map(([path, fingerprint]) => ({
    path: path.slice(path.indexOf(':') + 1),
    surface: path.slice(0, path.indexOf(':')) as 'index' | 'worktree' | 'untracked',
    fingerprint: createHash('sha256').update(fingerprint, 'utf8').digest('hex'),
  })).sort((left, right) => left.path.localeCompare(right.path) || left.surface.localeCompare(right.surface))
  const sha256 = createHash('sha256')
    .update(JSON.stringify({ revision: snapshot.revision, entries: boundedEntries }), 'utf8')
    .digest('hex')
  return Object.freeze({
    checkpointId: `checkpoint:${sha256.slice(0, 24)}`,
    stageId: identity.stageId,
    attemptId: identity.attemptId,
    revision: snapshot.revision,
    entries: Object.freeze(boundedEntries.map(entry => Object.freeze(entry))),
    sha256,
    capturedAtMs: identity.capturedAtMs,
    observable: snapshot.observable === true,
  })
}

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
  for (const key of new Set([...beforePaths.keys(), ...afterPaths.keys()])) {
    if (beforePaths.get(key) !== afterPaths.get(key)) changed.push(key.slice(key.indexOf(':') + 1))
  }
  return Object.freeze([...new Set(changed)].sort())
}

/** Reconcile a writer's observed diff against its durable pre-attempt snapshot. */
export function reconcileWorkspaceMutation(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
  options: WorkspaceReconciliationOptions,
): WorkspaceReconciliation {
  if (!options.observable) return result('UNOBSERVABLE_MUTATION_SURFACE', false, [], 'MUTATION_SURFACE_UNOBSERVABLE')
  if (before.revision !== after.revision) return result('REVISION_MOVED', false, [], 'WORKSPACE_REVISION_MOVED')

  let changedPaths: readonly string[]
  let allowedPaths: Set<string>
  try {
    changedPaths = changedPathsBetween(before, after)
    allowedPaths = new Set(options.allowedPaths.map(normalizeRepositoryPath))
  } catch {
    return result('SNAPSHOT_UNREADABLE', false, [], 'WORKSPACE_SNAPSHOT_UNREADABLE')
  }

  const beforePaths = new Set(before.entries.map(entry => entry.path))
  if (changedPaths.some(path => beforePaths.has(path))) {
    return result('PREEXISTING_USER_STATE_TOUCHED', false, changedPaths, 'PREEXISTING_USER_STATE_TOUCHED')
  }
  let status: WorkspaceReconciliationStatus
  if (changedPaths.length === 0) status = 'NO_MUTATION'
  else if (changedPaths.every(path => allowedPaths.has(path))) status = 'IN_SCOPE_MUTATION'
  else status = 'OUT_OF_SCOPE_MUTATION'

  if (!options.writerQuiescent) {
    return result(status, false, changedPaths, 'WRITER_NOT_QUIESCENT')
  }
  const conclusive = status === 'NO_MUTATION' || status === 'IN_SCOPE_MUTATION'
  return result(status, conclusive, changedPaths, conclusive ? undefined : status)
}

/** Bind a read-only reconciliation observation to its pre-write checkpoint. */
export function createWorkspaceReconciliationRecord(
  resultValue: WorkspaceReconciliation,
  identity: {
    readonly checkpointId: string
    readonly stageId: string
    readonly attemptId: string
    readonly recordedAtMs: number
    readonly writerQuiescent: boolean
    readonly writerQuiescenceReasonCode?:
      | 'ATTEMPT_UNKNOWN'
      | 'WRITER_STILL_ACTIVE'
      | 'CONTAINMENT_UNAVAILABLE'
      | 'QUIESCENCE_DEADLINE_EXCEEDED'
    readonly writerProof?:
      | { readonly kind: 'owned-process-tree-exited'; readonly processId: number; readonly observedAtMs: number }
      | { readonly kind: 'write-authority-revoked'; readonly evidenceId: string; readonly observedAtMs: number }
  },
): WorkspaceReconciliationRecord {
  const changedPaths = [...resultValue.changedPaths].sort()
  const payload = {
    checkpointId: identity.checkpointId,
    stageId: identity.stageId,
    attemptId: identity.attemptId,
    status: resultValue.status,
    changedPaths,
    writerQuiescent: identity.writerQuiescent,
    ...identity.writerQuiescenceReasonCode === undefined
      ? {} : { writerQuiescenceReasonCode: identity.writerQuiescenceReasonCode },
    ...(identity.writerProof === undefined ? {} : { writerProof: identity.writerProof }),
    conclusive: resultValue.conclusive,
    recordedAtMs: identity.recordedAtMs,
  }
  const digest = createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')
  return Object.freeze({
    reconciliationId: `reconciliation:${digest.slice(0, 24)}`,
    ...payload,
    changedPaths: Object.freeze(changedPaths),
  })
}

function result(
  status: WorkspaceReconciliationStatus,
  conclusive: boolean,
  changedPaths: readonly string[],
  reasonCode?: string,
): WorkspaceReconciliation {
  return Object.freeze({
    status,
    conclusive,
    changedPaths: Object.freeze([...changedPaths]),
    ...reasonCode === undefined ? {} : { reasonCode },
  })
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
    const surface = entry.surface ?? 'worktree'
    const key = `${surface}:${path}`
    if (indexed.has(key)) throw new WorkspaceStateError('workspace snapshot contains duplicate paths on one surface')
    indexed.set(key, entry.fingerprint)
  }
  return indexed
}
