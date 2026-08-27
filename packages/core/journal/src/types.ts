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
  DiagnosisContract,
  EvidenceRef,
  Finding,
  Risk,
  Role,
  RoutedPermissionMode,
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

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** One workflow accepted, with the objective it was accepted for. */
    'harness/workflow-start': {
      workflowId: string
      objectiveId: string
      profileId: string
      cwd: string
      requirement: string
      risk: Risk
      workload: Workload
    }
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
