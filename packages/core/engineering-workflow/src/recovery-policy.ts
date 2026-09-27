import { createHash } from 'node:crypto'
import {
  RECOVERY_DISPOSITIONS,
  ROLES,
  STAGE_CONSTRAINT_CLASSES,
} from '@trick-harness/contracts'
import type {
  ExecutorFailureCategory,
  IndependenceRequirement,
  RecoveryDecision,
  RecoveryDisposition,
  Risk,
  Role,
  RoutedPermissionMode,
  StageConstraintClass,
} from '@trick-harness/contracts'

export type { RecoveryDecision } from '@trick-harness/contracts'

/** Finite recovery limits selected by a deployment profile. */
export interface RecoveryBudgetPolicy {
  readonly version: string
  readonly attemptDeadlineMsByRole: Readonly<Record<Role, number>>
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
}

/** The immutable, hashed recovery limits admitted for one workflow. */
export type FrozenRecoveryBudgetPolicy = RecoveryBudgetPolicy & { readonly sha256: string }

/** A bounded fact classified before the recovery policy runs. */
export type RecoveryFailureFact =
  | { readonly kind: 'executor'; readonly category: ExecutorFailureCategory }
  | {
    readonly kind: 'constraint'
    readonly constraintClass: StageConstraintClass
    readonly toolDeclared?: boolean
    readonly affectedBoundary?: 'provider' | 'workspace' | 'host'
  }
  | { readonly kind: 'artifact'; readonly confirmed: boolean }
  | { readonly kind: 'human'; readonly reasonCode: string }
  | {
    readonly kind: 'recovered-mutation'
    readonly sourceAttemptId: string
    readonly checkpointId: string
    readonly reconciliationId: string
    readonly evidenceAnchorId: string
    readonly verificationStageId: string
    readonly verificationExecutor: string
    readonly verificationRole: Role
    readonly verificationPermissionMode: RoutedPermissionMode
    readonly writerQuiescent: boolean
    readonly attributionProven: boolean
    readonly scopeProven: boolean
  }
  | { readonly kind: 'unknown' }

/** The workspace facts recovery is allowed to act on. */
export interface RecoveryWorkspaceState {
  readonly state: 'known-clean' | 'mutated' | 'ambiguous' | 'unreadable' | 'reconciled'
  readonly writerQuiescent: boolean
  readonly reconstructible: boolean
  readonly attributionProven: boolean
  readonly scopeProven: boolean
  readonly checkpointId?: string
}

/** Durable facts consumed by the deterministic recovery policy. */
export interface RecoveryContext {
  readonly stageId: string
  readonly role: Role
  readonly risk: Risk
  readonly permissionMode: RoutedPermissionMode
  readonly attempt: number
  readonly priorRecoveryAttempts: {
    readonly sameExecutorRetries: number
    readonly reroutes: number
    readonly reprovisions: number
    readonly reconciliations: number
    readonly transitions: number
  }
  readonly priorRouteFailures: number
  readonly executor: string
  readonly constraints: readonly StageConstraintClass[]
  readonly failure: RecoveryFailureFact
  readonly workspace: RecoveryWorkspaceState
  readonly externalSideEffect: { readonly state: 'none' | 'confirmed' | 'pending' | 'unknown'; readonly operationId?: string }
  readonly independenceRequirement: IndependenceRequirement
  readonly compatibleExecutors: readonly string[]
  readonly budgets: RecoveryBudgetPolicy
  readonly nowMs: number
  readonly recoveryStartedAtMs: number
  readonly verificationStageId?: string
}

/** Refusal caused by a profile recovery policy that is missing or malformed. */
export class RecoveryPolicyError extends Error {
  override readonly name = 'RecoveryPolicyError'
}

/** Validate, detach, and hash the exact finite policy that governs a workflow. */
export function freezeRecoveryBudgetPolicy(policy: RecoveryBudgetPolicy): FrozenRecoveryBudgetPolicy {
  validateRecoveryBudgetPolicy(policy)
  const attemptDeadlineMsByRole = Object.freeze(Object.fromEntries(
    ROLES.map(role => [role, policy.attemptDeadlineMsByRole[role]]),
  ) as Record<Role, number>)
  const bounded = Object.freeze({
    version: policy.version,
    attemptDeadlineMsByRole,
    maxSameExecutorRetriesPerStage: policy.maxSameExecutorRetriesPerStage,
    maxReroutesPerStage: policy.maxReroutesPerStage,
    maxReprovisionsPerStage: policy.maxReprovisionsPerStage,
    maxReconciliationsPerStage: policy.maxReconciliationsPerStage,
    maxRecoveryTransitionsPerWorkflow: policy.maxRecoveryTransitionsPerWorkflow,
    recoveryDeadlineMs: policy.recoveryDeadlineMs,
    backoffInitialMs: policy.backoffInitialMs,
    backoffMultiplier: policy.backoffMultiplier,
    backoffMaxMs: policy.backoffMaxMs,
    quiescenceDeadlineMs: policy.quiescenceDeadlineMs,
  })
  const sha256 = createHash('sha256').update(JSON.stringify(bounded)).digest('hex')
  return Object.freeze({ ...bounded, sha256 })
}

/** Refuse missing, extra, or unbounded profile recovery values. */
export function validateRecoveryBudgetPolicy(policy: RecoveryBudgetPolicy): void {
  const requiredKeys = [
    'version', 'attemptDeadlineMsByRole', 'maxSameExecutorRetriesPerStage', 'maxReroutesPerStage',
    'maxReprovisionsPerStage', 'maxReconciliationsPerStage', 'maxRecoveryTransitionsPerWorkflow',
    'recoveryDeadlineMs', 'backoffInitialMs', 'backoffMultiplier', 'backoffMaxMs', 'quiescenceDeadlineMs',
  ]
  if (Object.keys(policy).length !== requiredKeys.length || Object.keys(policy).some(key => !requiredKeys.includes(key))) {
    throw new RecoveryPolicyError('POLICY_CONFIGURATION_INVALID: policy has missing or unknown fields')
  }
  if (typeof policy.version !== 'string' || policy.version.length < 1 || policy.version.length > 64) {
    throw new RecoveryPolicyError('POLICY_CONFIGURATION_INVALID: version is missing or too long')
  }
  if (Object.keys(policy.attemptDeadlineMsByRole).length !== ROLES.length
    || ROLES.some(role => !isPositiveInteger(policy.attemptDeadlineMsByRole[role]))) {
    throw new RecoveryPolicyError('POLICY_CONFIGURATION_INVALID: every role needs one finite attempt deadline')
  }
  for (const key of [
    'maxSameExecutorRetriesPerStage',
    'maxReroutesPerStage',
    'maxReprovisionsPerStage',
    'maxReconciliationsPerStage',
    'maxRecoveryTransitionsPerWorkflow',
  ] as const) {
    if (!Number.isSafeInteger(policy[key]) || policy[key] < 0) {
      throw new RecoveryPolicyError(`POLICY_CONFIGURATION_INVALID: ${key} must be a nonnegative integer`)
    }
  }
  for (const key of ['recoveryDeadlineMs', 'backoffInitialMs', 'backoffMaxMs', 'quiescenceDeadlineMs'] as const) {
    if (!isPositiveInteger(policy[key])) {
      throw new RecoveryPolicyError(`POLICY_CONFIGURATION_INVALID: ${key} must be a positive finite integer`)
    }
  }
  if (!Number.isFinite(policy.backoffMultiplier) || policy.backoffMultiplier < 1) {
    throw new RecoveryPolicyError('POLICY_CONFIGURATION_INVALID: backoffMultiplier must be finite and at least one')
  }
}

/** Choose one safe recovery action without changing workflow state. */
export function decideRecovery(context: RecoveryContext): RecoveryDecision {
  const budgets = freezeRecoveryBudgetPolicy(context.budgets)
  if (!isIdentifier(context.stageId) || !isIdentifier(context.executor)) {
    return pause('RECOVERY_CONTEXT_INVALID')
  }
  if (!Number.isSafeInteger(context.attempt) || context.attempt < 1
    || !Number.isSafeInteger(context.nowMs) || context.nowMs < 0
    || !Number.isSafeInteger(context.recoveryStartedAtMs) || context.recoveryStartedAtMs < 0
    || context.nowMs < context.recoveryStartedAtMs
    || !Number.isSafeInteger(context.recoveryStartedAtMs + budgets.recoveryDeadlineMs)
    || !Number.isSafeInteger(context.priorRouteFailures) || context.priorRouteFailures < 0
    || Object.values(context.priorRecoveryAttempts).some(value => !Number.isSafeInteger(value) || value < 0)) {
    return pause('RECOVERY_CLOCK_OR_ATTEMPT_INVALID')
  }
  if (context.priorRecoveryAttempts.transitions >= budgets.maxRecoveryTransitionsPerWorkflow) {
    return terminal('TERMINAL_INCONCLUSIVE', 'RECOVERY_TRANSITION_BUDGET_EXHAUSTED')
  }
  if (context.nowMs >= context.recoveryStartedAtMs + budgets.recoveryDeadlineMs) {
    return terminal('TERMINAL_INCONCLUSIVE', 'RECOVERY_DEADLINE_EXCEEDED')
  }

  const workspaceUncertain = context.workspace.state === 'mutated'
    || context.workspace.state === 'ambiguous'
    || context.workspace.state === 'unreadable'
    || ((context.role === 'implement' || context.role === 'repair')
      && context.permissionMode === 'workspace-write'
      && context.workspace.state !== 'reconciled')
  if (workspaceUncertain) {
    if (!context.workspace.writerQuiescent
      || !context.workspace.attributionProven
      || !context.workspace.scopeProven
      || context.workspace.checkpointId === undefined
      || !isIdentifier(context.workspace.checkpointId)) return pause('WORKSPACE_RECONCILIATION_UNPROVEN')
    if (context.priorRecoveryAttempts.reconciliations >= budgets.maxReconciliationsPerStage) {
      return terminal('TERMINAL_INCONCLUSIVE', 'WORKSPACE_RECONCILIATION_BUDGET_EXHAUSTED')
    }
    return {
      disposition: 'RECONCILE_WORKSPACE',
      reasonCode: 'WORKSPACE_STATE_UNCERTAIN',
      attemptId: `${context.stageId}:${String(context.attempt)}`,
      checkpointId: context.workspace.checkpointId,
    }
  }
  if (context.externalSideEffect.state !== 'none') {
    const operationId = context.externalSideEffect.operationId
    return operationId !== undefined && isIdentifier(operationId)
      ? {
        disposition: 'RECONCILE_WORLD_STATE',
        reasonCode: context.externalSideEffect.state === 'confirmed'
          ? 'CONFIRMED_EXTERNAL_SIDE_EFFECT'
          : 'EXTERNAL_OUTCOME_UNKNOWN',
        operationId,
      }
      : pause('EXTERNAL_OPERATION_ID_MISSING')
  }

  const failure = context.failure
  if (failure.kind === 'recovered-mutation') return verifyRecoveredMutation(context, failure)
  if (failure.kind === 'human') return pause('HUMAN_DECISION_REQUIRED')
  if (failure.kind === 'artifact') {
    return failure.confirmed
      ? terminal('TERMINAL_FAIL', 'CONFIRMED_ARTIFACT_DEFECT')
      : terminal('TERMINAL_INCONCLUSIVE', 'ARTIFACT_DEFECT_UNCONFIRMED')
  }
  if (failure.kind === 'unknown') return pause('UNKNOWN_FAILURE_NOT_RETRYABLE')
  if (failure.kind === 'constraint') return constraintDecision(context, budgets, failure)
  return executorFailureDecision(context, budgets, failure.category)
}

/** Parse an untrusted decision object and reject fields not valid for its variant. */
export function parseRecoveryDecision(value: unknown): RecoveryDecision {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RecoveryPolicyError('recovery decision must be an object')
  }
  const record = value as Record<string, unknown>
  const disposition = record.disposition
  if (typeof disposition !== 'string' || !(RECOVERY_DISPOSITIONS as readonly string[]).includes(disposition)) {
    throw new RecoveryPolicyError('recovery decision has an unknown disposition')
  }
  const required: Record<RecoveryDisposition, readonly string[]> = {
    RETRY_SAME_EXECUTOR: ['executor', 'attempt', 'retryAtMs'],
    REROUTE_EXECUTOR: ['executor'],
    REPROVISION_WORKSPACE: [],
    RECONCILE_WORKSPACE: ['attemptId', 'checkpointId'],
    RECONCILE_WORLD_STATE: ['operationId'],
    VERIFY_RECOVERED_MUTATION: ['sourceAttemptId', 'checkpointId', 'reconciliationId', 'evidenceAnchorId', 'verificationStageId'],
    PAUSE_FOR_HUMAN: [],
    TERMINAL_BLOCKED: [],
    TERMINAL_INCONCLUSIVE: [],
    TERMINAL_FAIL: [],
  }
  const fields = ['disposition', 'reasonCode', ...required[disposition as RecoveryDisposition]]
  if (Object.keys(record).some(key => !fields.includes(key))) throw new RecoveryPolicyError('recovery decision has an unknown field')
  if (fields.some(key => !Object.hasOwn(record, key))) throw new RecoveryPolicyError('recovery decision is missing a required field')
  if (typeof record.reasonCode !== 'string' || !isReasonCode(record.reasonCode)) {
    throw new RecoveryPolicyError('recovery decision reasonCode is invalid')
  }
  for (const key of required[disposition as RecoveryDisposition]) {
    if (key === 'attempt' || key === 'retryAtMs') {
      if (!Number.isSafeInteger(record[key]) || (record[key] as number) < (key === 'attempt' ? 1 : 0)) {
        throw new RecoveryPolicyError(`recovery decision ${key} is invalid`)
      }
    } else if (!isIdentifier(record[key])) {
      throw new RecoveryPolicyError(`recovery decision ${key} is invalid`)
    }
  }
  return Object.freeze({ ...record }) as unknown as RecoveryDecision
}

function constraintDecision(
  context: RecoveryContext,
  budgets: FrozenRecoveryBudgetPolicy,
  failure: Extract<RecoveryFailureFact, { kind: 'constraint' }>,
): RecoveryDecision {
  if (!STAGE_CONSTRAINT_CLASSES.includes(failure.constraintClass)) return pause('CONSTRAINT_CLASS_INVALID')
  switch (failure.constraintClass) {
    case 'EXECUTOR_CAPABILITY_GAP':
      return reroute(context, budgets, 'EXECUTOR_CAPABILITY_GAP')
    case 'SANDBOX_LIMITATION':
      return reprovision(context, budgets, 'SANDBOX_LIMITATION')
    case 'MISSING_TOOL':
      return failure.toolDeclared === true
        ? reprovision(context, budgets, 'DECLARED_TOOL_MISSING')
        : pause('UNDECLARED_TOOL_MISSING')
    case 'EXTERNAL_RUNTIME_UNREADABLE':
      return failure.affectedBoundary === 'workspace'
        ? reprovision(context, budgets, 'EXTERNAL_WORKSPACE_UNREADABLE')
        : retryOrReroute(context, budgets, 'EXTERNAL_RUNTIME_UNREADABLE')
    case 'EXTERNAL_SERVICE_UNAVAILABLE':
      return retryOrReroute(context, budgets, 'EXTERNAL_SERVICE_UNAVAILABLE')
  }
}

function executorFailureDecision(
  context: RecoveryContext,
  budgets: FrozenRecoveryBudgetPolicy,
  category: ExecutorFailureCategory,
): RecoveryDecision {
  if (category === 'transport-unavailable' || category === 'server-overloaded') {
    return retryOrReroute(context, budgets, 'TRANSIENT_EXECUTOR_UNAVAILABLE')
  }
  if (category === 'sandbox-denied') return reprovision(context, budgets, 'SANDBOX_RESTRICTION')
  if (category === 'unauthorized' || category === 'bad-request' || category === 'other') {
    return pause('NON_RECOVERABLE_OR_UNKNOWN_EXECUTOR_FAILURE')
  }
  return pause('EXECUTOR_FAILURE_REQUIRES_CLASSIFICATION')
}

function retryOrReroute(
  context: RecoveryContext,
  budgets: FrozenRecoveryBudgetPolicy,
  reasonCode: string,
): RecoveryDecision {
  if (context.priorRecoveryAttempts.sameExecutorRetries < budgets.maxSameExecutorRetriesPerStage) {
    const retryIndex = context.priorRecoveryAttempts.sameExecutorRetries + 1
    const delayMs = Math.min(budgets.backoffMaxMs, budgets.backoffInitialMs * budgets.backoffMultiplier ** (retryIndex - 1))
    const retryAtMs = Math.ceil(context.nowMs + delayMs)
    if (!Number.isSafeInteger(retryAtMs)) return pause('RECOVERY_CLOCK_OR_ATTEMPT_INVALID')
    if (retryAtMs >= context.recoveryStartedAtMs + budgets.recoveryDeadlineMs) {
      return terminal('TERMINAL_INCONCLUSIVE', 'RECOVERY_DEADLINE_EXCEEDED')
    }
    return {
      disposition: 'RETRY_SAME_EXECUTOR',
      reasonCode,
      executor: context.executor,
      attempt: context.attempt + 1,
      retryAtMs,
    }
  }
  return reroute(context, budgets, reasonCode)
}

function reroute(context: RecoveryContext, budgets: FrozenRecoveryBudgetPolicy, reasonCode: string): RecoveryDecision {
  const executor = context.compatibleExecutors.find(candidate =>
    candidate !== context.executor && isIdentifier(candidate))
  if (executor === undefined || context.priorRecoveryAttempts.reroutes >= budgets.maxReroutesPerStage) {
    return pause('NO_BOUNDED_COMPATIBLE_ROUTE')
  }
  return { disposition: 'REROUTE_EXECUTOR', reasonCode, executor }
}

function reprovision(context: RecoveryContext, budgets: FrozenRecoveryBudgetPolicy, reasonCode: string): RecoveryDecision {
  if (!context.workspace.reconstructible) return pause('WORKSPACE_NOT_RECONSTRUCTIBLE')
  if (context.priorRecoveryAttempts.reprovisions >= budgets.maxReprovisionsPerStage) {
    return pause('REPROVISION_BUDGET_EXHAUSTED')
  }
  return { disposition: 'REPROVISION_WORKSPACE', reasonCode }
}

function verifyRecoveredMutation(
  context: RecoveryContext,
  failure: Extract<RecoveryFailureFact, { kind: 'recovered-mutation' }>,
): RecoveryDecision {
  const fields = [failure.sourceAttemptId, failure.checkpointId, failure.reconciliationId,
    failure.evidenceAnchorId, failure.verificationStageId]
  if (context.role !== 'implement' || context.workspace.state !== 'reconciled'
    || !failure.writerQuiescent || !failure.attributionProven || !failure.scopeProven
    || failure.verificationRole !== 'verify' || failure.verificationPermissionMode !== 'read-only'
    || failure.verificationStageId !== context.verificationStageId
    || !context.compatibleExecutors.includes(failure.verificationExecutor)
    || (context.independenceRequirement !== 'fresh-context' && failure.verificationExecutor === context.executor)
    || fields.some(field => !isIdentifier(field))) return pause('RECOVERED_MUTATION_VERIFICATION_UNPROVEN')
  return {
    disposition: 'VERIFY_RECOVERED_MUTATION',
    reasonCode: 'RECONCILED_MUTATION_REQUIRES_FRESH_VERIFICATION',
    sourceAttemptId: failure.sourceAttemptId,
    checkpointId: failure.checkpointId,
    reconciliationId: failure.reconciliationId,
    evidenceAnchorId: failure.evidenceAnchorId,
    verificationStageId: failure.verificationStageId,
  }
}

function pause(reasonCode: string): RecoveryDecision {
  return { disposition: 'PAUSE_FOR_HUMAN', reasonCode }
}

function terminal(disposition: 'TERMINAL_BLOCKED' | 'TERMINAL_INCONCLUSIVE' | 'TERMINAL_FAIL', reasonCode: string): RecoveryDecision {
  return { disposition, reasonCode }
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
}

function isReasonCode(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(value)
}
