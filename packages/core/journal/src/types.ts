/**
 * The durable `harness/*` session-event vocabulary.
 *
 * These events are the workflow's memory. Everything the harness needs in order
 * to say what happened — which route ran, what it found, what was delivered —
 * is reconstructed from them alone, so each payload holds observable facts and
 * bounded evidence references rather than the transcript that produced them. A
 * model's reasoning is not a fact about the world and does not belong in a log
 * that outlives the run.
 *
 * @module @trick-harness/journal/types
 */

import type {
  ChangeImpactStatusSummary,
  ConformanceStatusSummary,
  DiagnosisContract,
  EvidenceRef,
  ExternalCertificationState,
  Finding,
  RecoveryDecision,
  Risk,
  Role,
  RoutedPermissionMode,
  StageConstraint,
  Workload,
  WorkflowVerdict,
} from '@trick-harness/contracts'

/** How a workflow stopped, terminal states and the interrupted one alike. */
export type WorkflowEndState = 'completed' | 'failed' | 'canceled' | 'blocked' | 'interrupted'

/** How one executor run stopped. */
export type ExecutorOutcome = 'completed' | 'failed' | 'canceled'

/** The mutations delivery is allowed to record. */
export type DeliveryAction = 'commit' | 'push' | 'pr-open' | 'pr-update'

/** How one deterministic capability run stopped. */
export type CapabilityOutcome = 'completed' | 'aborted' | 'error'

/** Why a workflow stopped short of a verdict. */
export type BlockerKind = 'product-decision' | 'design-decision' | 'budget-exhausted' | 'unroutable' | 'external'

/** Profile recovery limits plus the stable identity frozen at admission. */
export interface RecoveryPolicyRecord {
  readonly version: string
  readonly attemptDeadlineMsByRole: Readonly<Record<string, number>>
  readonly maxSameExecutorRetriesPerStage: number
  readonly maxReroutesPerStage: number
  readonly maxReprovisionsPerStage: number
  readonly maxReconciliationsPerStage: number
  readonly maxRecoveryTransitionsPerWorkflow: number
  readonly recoveryDeadlineMs: number
  readonly backoffInitialMs: number
  readonly backoffMultiplier: number
  readonly backoffMaxMs: number
  readonly quiescenceDeadlineMs: number
  readonly sha256: string
}

/** Recovery counters captured before the next transition is dispatched. */
export interface RecoveryAttemptCounters {
  readonly sameExecutorRetries: number
  readonly reroutes: number
  readonly reprovisions: number
  readonly reconciliations: number
  readonly transitions: number
}

/** One durable policy choice and the frozen workflow budget at that point. */
export interface RecoveryDecisionRecord {
  readonly stageId: string
  readonly attemptId: string
  readonly decision: RecoveryDecision
  readonly recordedAtMs: number
  readonly recoveryDeadlineAtMs: number
  readonly counters: RecoveryAttemptCounters
}

/** Bounded, content-free workspace state captured before a writable attempt. */
export interface WorkspaceCheckpointRecord {
  readonly checkpointId: string
  readonly stageId: string
  readonly attemptId: string
  readonly revision: string
  readonly entries: readonly {
    readonly path: string
    readonly surface: 'index' | 'worktree' | 'untracked'
    readonly fingerprint: string
  }[]
  readonly sha256: string
  readonly capturedAtMs: number
  readonly observable: boolean
}

/** Read-only result for attributing an interrupted writable attempt. */
export interface WorkspaceReconciliationRecord {
  readonly reconciliationId: string
  readonly checkpointId: string
  readonly stageId: string
  readonly attemptId: string
  readonly status: 'NO_MUTATION' | 'IN_SCOPE_MUTATION' | 'OUT_OF_SCOPE_MUTATION'
    | 'PREEXISTING_USER_STATE_TOUCHED' | 'REVISION_MOVED' | 'SNAPSHOT_UNREADABLE'
    | 'UNOBSERVABLE_MUTATION_SURFACE'
  readonly changedPaths: readonly string[]
  readonly writerQuiescent: boolean
  readonly writerProof?: { readonly kind: 'owned-process-tree-exited'; readonly processId: number; readonly observedAtMs: number }
  readonly conclusive: boolean
  readonly recordedAtMs: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** One workflow accepted, with the objective it was accepted for. */
    'harness/workflow-start': {
      workflowId: string
      /** Durable identity of the host session that admitted this workflow. */
      hostRunId?: string
      objectiveId: string
      profileId: string
      cwd: string
      requirement: string
      risk: Risk
      workload: Workload
      /** Repository-relative path of the approved specification. */
      specPath: string
      /** SHA-256 of that specification, so a later edit is visible as a different document. */
      specSha256: string
      /** Repository-relative path of the approved plan. */
      planPath: string
      /** SHA-256 of that plan. */
      planSha256: string
      /** Full finite policy and hash selected before workflow dispatch. */
      recoveryPolicy?: RecoveryPolicyRecord
    }
    /** One deterministic recovery choice, flushed before its action may run. */
    'harness/recovery-decision': { workflowId: string } & RecoveryDecisionRecord
    /** A durable pre-write snapshot identity and path fingerprints. */
    'harness/workspace-checkpoint': { workflowId: string } & WorkspaceCheckpointRecord
    /** A read-only reconciliation observation tied to one durable checkpoint. */
    'harness/workspace-reconciliation': { workflowId: string } & WorkspaceReconciliationRecord
    /**
     * One conformance reading, reduced to hashes, counts and a verdict.
     *
     * The reading itself is a model's answer about approved documents, and
     * neither the documents nor the answer belong in a log that outlives the
     * run. What survives is which documents were judged, how many obligations
     * they set, how the answers came out, and what that made the reading.
     *
     * Written once per conformance stage, so a repair that forced a second
     * reading leaves both and the later one is the branch's standing.
     */
    'harness/conformance': { workflowId: string } & ConformanceStatusSummary
    /**
     * One reading of what the change turned out to be, bounded.
     *
     * Two of these are written per delivery cycle: what the approved Plan
     * committed to writing, and what the published branch turned out to hold.
     * Neither carries a diff — what survives is which surfaces were touched,
     * what that made the run's risk, what evidence it owes, whether it moves
     * database state, and how far outside the Plan it reached.
     *
     * Written once per reading, so a repair that forced a second delivery
     * leaves both and the later one is the branch's standing.
     */
    'harness/change-impact': { workflowId: string } & ChangeImpactStatusSummary
    /**
     * The route one stage was dispatched on, with the reasons that produced it.
     * `reasonCodes` and `policyVersion` are what make the decision explainable
     * later without re-running the router against a policy that has since moved.
     */
    'harness/route-decision': {
      workflowId: string
      stageId: string
      role: Role
      executor: string
      semanticModelTier: string
      resolvedModel: string
      reasoningEffort?: string
      permissionMode: RoutedPermissionMode
      reasonCodes: string[]
      policyVersion: string
    }
    /**
     * A route taken around an executor that could not serve the run.
     * Recorded separately from the decision it produced because a fallback is a
     * fact about assurance, not a routing detail: it names what was asked for,
     * what answered instead, and what that cost in independence.
     */
    'harness/route-fallback': {
      workflowId: string
      stageId: string
      requestedExecutor: string
      fallbackExecutor: string
      failureClass: string
      independenceImpact: 'preserved' | 'reduced' | 'lost'
      assuranceImpact: 'unchanged' | 'lowered'
      reasonCodes: string[]
      policyVersion: string
    }
    /** One executor run began. */
    'harness/executor-start': {
      workflowId: string
      stageId: string
      role: Role
      executor: string
      resolvedModel: string
      permissionMode: RoutedPermissionMode
    }
    /** One executor run ended, with its classified failure when it had one. */
    'harness/executor-end': {
      workflowId: string
      stageId: string
      executor: string
      outcome: ExecutorOutcome
      failureClass?: string
      failureCode?: string
      durationMs: number
    }
    /**
     * A deterministic capability began work for one stage.
     *
     * Written for the same reason an executor start is: the window between
     * asking GitHub or Supabase to do something and hearing back is the window
     * in which the world may have changed without this log knowing. A start
     * with no end is that window, still open, and `mutationPossible` says
     * whether anything in it could have left a mark.
     */
    'harness/capability-start': {
      workflowId: string
      stageId: string
      capability: string
      mutationPossible: boolean
    }
    /** A deterministic capability finished, with its classified failure when it had one. */
    'harness/capability-end': {
      workflowId: string
      stageId: string
      capability: string
      status: CapabilityOutcome
      durationMs: number
      failureClass?: string
    }
    /** One triaged finding, carrying its evidence rather than its narration. */
    'harness/finding': { workflowId: string; stageId: string; finding: Finding }
    /** A bounded environmental constraint a stage reported, kept separate from artifact findings. */
    'harness/stage-constraint': { workflowId: string; stageId: string; constraint: StageConstraint }
    /** Deterministic repair scope authorized before a writable repair stage may begin. */
    'harness/repair-authorization': { workflowId: string; stageId: string; findingId: string; scopeSha256: string; allowedPathCount: number; allowedSurfaces: string[]; reasonCodes: string[] }
    /** One completed diagnosis, as the contract a repair is allowed to act on. */
    'harness/diagnosis': { workflowId: string; stageId: string; diagnosis: DiagnosisContract }
    /** One stage's verdict, and whether a weakened route lowered it. */
    'harness/verdict': {
      workflowId: string
      stageId: string
      role: Role
      verdict: WorkflowVerdict
      summary: string
      evidence: EvidenceRef[]
      lowered?: boolean
    }
    /**
     * One delivery mutation, recorded from re-read state rather than intent.
     * A commit SHA or PR number written here is what the world was observed to
     * hold afterwards, so a restart can tell a completed push from an attempted one.
     */
    'harness/delivery': {
      workflowId: string
      action: DeliveryAction
      branch: string
      commitSha?: string
      prNumber?: number
      prUrl?: string
    }
    /**
     * One certification published against one revision, as it read back.
     *
     * Written after the certifier confirmed its own status, not after the
     * request was sent: what a reviewer sees is the fact worth keeping, and a
     * POST that exited zero is not that fact. `summary` is generated from the
     * state by the runtime and never copied from a model or from command
     * output, and no target URL, description or credential is carried here —
     * this log is read back by people and by other processes.
     */
    'harness/certification': {
      workflowId: string
      revision: string
      externalId: string
      state: ExternalCertificationState
      context: string
      summary: string
      evidence: EvidenceRef[]
    }
    /** Something a person has to decide, recorded instead of guessed at. */
    'harness/blocker': {
      workflowId: string
      stageId?: string
      kind: BlockerKind
      summary: string
      evidence: EvidenceRef[]
    }
    /** One executor circuit transition, as the breaker observed it. */
    'harness/circuit-breaker': {
      workflowId: string
      executor: string
      from: 'AVAILABLE' | 'DEGRADED'
      to: 'AVAILABLE' | 'DEGRADED'
      reason: string
    }
    /** The workflow stopped, terminally or because it was interrupted. */
    'harness/workflow-end': {
      workflowId: string
      state: WorkflowEndState
      verdict: WorkflowVerdict
      summary: string
    }
  }
}
