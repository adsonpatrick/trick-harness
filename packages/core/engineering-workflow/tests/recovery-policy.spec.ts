import { describe, expect, it } from 'vitest'
import type { Role, StageConstraintClass } from '@trick-harness/contracts'
import { decideRecovery, freezeRecoveryBudgetPolicy, parseRecoveryDecision } from '../src/recovery-policy.ts'
import type { RecoveryBudgetPolicy, RecoveryContext } from '../src/recovery-policy.ts'

const BUDGETS: RecoveryBudgetPolicy = {
  version: 'test-v1',
  attemptDeadlineMsByRole: Object.fromEntries(
    ['refine', 'plan', 'implement', 'debug', 'repair', 'verify', 'review', 'security', 'qa', 'conformance', 'delivery']
      .map(role => [role, 1_000]),
  ) as Record<Role, number>,
  maxSameExecutorRetriesPerStage: 2,
  maxReroutesPerStage: 1,
  maxReprovisionsPerStage: 1,
  maxReconciliationsPerStage: 1,
  maxRecoveryTransitionsPerWorkflow: 4,
  recoveryDeadlineMs: 10_000,
  backoffInitialMs: 100,
  backoffMultiplier: 2,
  backoffMaxMs: 500,
  quiescenceDeadlineMs: 1_000,
}

function context(overrides: Partial<RecoveryContext> = {}): RecoveryContext {
  return {
    stageId: 'verify-1',
    role: 'verify',
    risk: 'low',
    permissionMode: 'read-only',
    attempt: 1,
    priorRecoveryAttempts: {
      sameExecutorRetries: 0,
      reroutes: 0,
      reprovisions: 0,
      reconciliations: 0,
      transitions: 0,
    },
    priorRouteFailures: 0,
    executor: 'codex',
    constraints: [],
    failure: { kind: 'constraint', constraintClass: 'EXTERNAL_SERVICE_UNAVAILABLE' },
    workspace: {
      state: 'known-clean',
      writerQuiescent: true,
      reconstructible: true,
      attributionProven: true,
      scopeProven: true,
    },
    externalSideEffect: { state: 'none' },
    independenceRequirement: 'fresh-context',
    compatibleExecutors: ['opencode'],
    budgets: BUDGETS,
    nowMs: 1_000,
    recoveryStartedAtMs: 500,
    ...overrides,
  }
}

describe('deterministic recovery policy', () => {
  it.each([
    ['EXTERNAL_SERVICE_UNAVAILABLE', 'RETRY_SAME_EXECUTOR'],
    ['EXECUTOR_CAPABILITY_GAP', 'REROUTE_EXECUTOR'],
    ['SANDBOX_LIMITATION', 'REPROVISION_WORKSPACE'],
    ['MISSING_TOOL', 'PAUSE_FOR_HUMAN'],
    ['EXTERNAL_RUNTIME_UNREADABLE', 'RETRY_SAME_EXECUTOR'],
  ] as const)(
    'maps constraint %s to its safe default disposition %s',
    (constraintClass: StageConstraintClass, disposition: string) => {
      const result = decideRecovery(context({
        failure: {
          kind: 'constraint',
          constraintClass,
          toolDeclared: false,
          affectedBoundary: 'provider',
        },
      }))
      expect(result.disposition).toBe(disposition)
    },
  )

  it('retries transient service failure with deterministic capped backoff', () => {
    expect(decideRecovery(context())).toMatchObject({ disposition: 'RETRY_SAME_EXECUTOR', retryAtMs: 1_100 })
    expect(decideRecovery(context({
      priorRecoveryAttempts: { ...context().priorRecoveryAttempts, sameExecutorRetries: 1 },
    }))).toMatchObject({ disposition: 'RETRY_SAME_EXECUTOR', retryAtMs: 1_200 })
    expect(decideRecovery(context({
      budgets: { ...BUDGETS, maxSameExecutorRetriesPerStage: 4 },
      priorRecoveryAttempts: { ...context().priorRecoveryAttempts, sameExecutorRetries: 3 },
    }))).toMatchObject({ disposition: 'RETRY_SAME_EXECUTOR', retryAtMs: 1_500 })
  })

  it('freezes every numeric budget value into a stable identity and rejects missing values', () => {
    expect(freezeRecoveryBudgetPolicy(BUDGETS)).toEqual(freezeRecoveryBudgetPolicy(BUDGETS))
    expect(freezeRecoveryBudgetPolicy(BUDGETS).sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(() => decideRecovery(context({ budgets: { ...BUDGETS, backoffMultiplier: Number.NaN } })))
      .toThrow(/POLICY_CONFIGURATION_INVALID/)
    expect(() => decideRecovery(context({ budgets: { ...BUDGETS, attemptDeadlineMsByRole: {} as Record<Role, number> } })))
      .toThrow(/POLICY_CONFIGURATION_INVALID/)
    expect(() => decideRecovery(context({ budgets: { ...BUDGETS, quiescenceDeadlineMs: 2_147_483_648 } })))
      .toThrow(/quiescenceDeadlineMs exceeds the timer limit/)
  })

  it('reroutes capability gaps without a blind retry', () => {
    expect(decideRecovery(context({
      failure: { kind: 'constraint', constraintClass: 'EXECUTOR_CAPABILITY_GAP' },
    }))).toMatchObject({ disposition: 'REROUTE_EXECUTOR', executor: 'opencode' })
  })

  it.each(['unauthorized', 'bad-request', 'other'] as const)(
    'does not retry or reroute unclassified or non-availability executor failure %s',
    (category) => {
      expect(decideRecovery(context({ failure: { kind: 'executor', category } })))
        .toMatchObject({ disposition: 'PAUSE_FOR_HUMAN' })
    },
  )

  it('reconciles workspace uncertainty before any mutation-stage retry or reroute', () => {
    expect(decideRecovery(context({
      role: 'implement',
      permissionMode: 'workspace-write',
      failure: { kind: 'executor', category: 'transport-unavailable' },
      workspace: {
        state: 'ambiguous',
        writerQuiescent: true,
        reconstructible: true,
        attributionProven: true,
        scopeProven: true,
        checkpointId: 'checkpoint-1',
      },
    }))).toMatchObject({ disposition: 'RECONCILE_WORKSPACE', checkpointId: 'checkpoint-1' })
  })

  it('pauses while the previous writer is not proven quiescent', () => {
    expect(decideRecovery(context({
      workspace: {
        state: 'mutated',
        writerQuiescent: false,
        reconstructible: true,
        attributionProven: true,
        scopeProven: true,
        checkpointId: 'checkpoint-1',
      },
    }))).toMatchObject({ disposition: 'PAUSE_FOR_HUMAN' })
  })

  it('reconciles a declared missing tool only when the environment can provision it', () => {
    expect(decideRecovery(context({
      failure: { kind: 'constraint', constraintClass: 'MISSING_TOOL', toolDeclared: true },
    })).disposition).toBe('REPROVISION_WORKSPACE')
    expect(decideRecovery(context({
      failure: { kind: 'constraint', constraintClass: 'SANDBOX_LIMITATION' },
      workspace: { ...context().workspace, reconstructible: false },
    })).disposition).toBe('PAUSE_FOR_HUMAN')
  })

  it('reconciles unknown external outcomes before retrying a capability', () => {
    expect(decideRecovery(context({
      externalSideEffect: { state: 'unknown', operationId: 'operation-1' },
      failure: { kind: 'executor', category: 'transport-unavailable' },
    }))).toMatchObject({ disposition: 'RECONCILE_WORLD_STATE', operationId: 'operation-1' })
    expect(decideRecovery(context({
      externalSideEffect: { state: 'confirmed', operationId: 'operation-2' },
      failure: { kind: 'executor', category: 'transport-unavailable' },
    }))).toMatchObject({ disposition: 'RECONCILE_WORLD_STATE', reasonCode: 'CONFIRMED_EXTERNAL_SIDE_EFFECT' })
  })

  it('verifies a reconciled implementation only with complete independent evidence anchors', () => {
    expect(decideRecovery(context({
      role: 'implement',
      permissionMode: 'workspace-write',
      verificationStageId: 'verify-final-1',
      workspace: { ...context().workspace, state: 'reconciled' },
      failure: {
        kind: 'recovered-mutation',
        sourceAttemptId: 'attempt-1',
        checkpointId: 'checkpoint-1',
        reconciliationId: 'reconcile-1',
        evidenceAnchorId: 'evidence-1',
        verificationStageId: 'verify-final-1',
        verificationExecutor: 'opencode',
        verificationRole: 'verify',
        verificationPermissionMode: 'read-only',
        writerQuiescent: true,
        attributionProven: true,
        scopeProven: true,
      },
    }))).toMatchObject({
      disposition: 'VERIFY_RECOVERED_MUTATION',
      sourceAttemptId: 'attempt-1',
      verificationStageId: 'verify-final-1',
    })
  })

  it('refuses recovered-mutation verification for repairs, stale writers, and missing verifier routes', () => {
    const recoveredMutation = {
      kind: 'recovered-mutation' as const,
      sourceAttemptId: 'attempt-1',
      checkpointId: 'checkpoint-1',
      reconciliationId: 'reconcile-1',
      evidenceAnchorId: 'evidence-1',
      verificationStageId: 'verify-final-1',
      verificationExecutor: 'opencode',
      verificationRole: 'verify' as const,
      verificationPermissionMode: 'read-only' as const,
      writerQuiescent: true,
      attributionProven: true,
      scopeProven: true,
    }
    const base = {
      verificationStageId: 'verify-final-1',
      workspace: { ...context().workspace, state: 'reconciled' as const },
      failure: recoveredMutation,
    }
    expect(decideRecovery(context({ ...base, role: 'repair' })).disposition).toBe('PAUSE_FOR_HUMAN')
    expect(decideRecovery(context({
      ...base,
      failure: { ...recoveredMutation, writerQuiescent: false },
    })).disposition).toBe('PAUSE_FOR_HUMAN')
    expect(decideRecovery(context({ ...base, compatibleExecutors: [] })).disposition).toBe('PAUSE_FOR_HUMAN')
  })

  it('refuses automatic recovery for unknown failures, artifact defects, and human-only decisions', () => {
    expect(decideRecovery(context({ failure: { kind: 'unknown' } })).disposition).toBe('PAUSE_FOR_HUMAN')
    expect(decideRecovery(context({ failure: { kind: 'artifact', confirmed: true } })).disposition).toBe('TERMINAL_FAIL')
    expect(decideRecovery(context({ failure: { kind: 'human', reasonCode: 'PRODUCT_DECISION_REQUIRED' } })).disposition)
      .toBe('PAUSE_FOR_HUMAN')
  })

  it('honors zero stage budgets, total transition caps, and absolute recovery deadlines', () => {
    const noRetries = { ...BUDGETS, maxSameExecutorRetriesPerStage: 0 }
    expect(decideRecovery(context({ budgets: noRetries })).disposition).toBe('REROUTE_EXECUTOR')
    expect(decideRecovery(context({
      priorRecoveryAttempts: { ...context().priorRecoveryAttempts, transitions: 4 },
    })).disposition).toBe('TERMINAL_INCONCLUSIVE')
    expect(decideRecovery(context({ nowMs: 20_000 })).disposition).toBe('TERMINAL_INCONCLUSIVE')
  })

  it('stops workspace reconciliation when its per-stage budget is exhausted', () => {
    expect(decideRecovery(context({
      workspace: {
        state: 'ambiguous', writerQuiescent: true, reconstructible: true,
        attributionProven: true, scopeProven: true, checkpointId: 'checkpoint-1',
      },
      priorRecoveryAttempts: { ...context().priorRecoveryAttempts, reconciliations: 1 },
    }))).toMatchObject({ disposition: 'TERMINAL_INCONCLUSIVE', reasonCode: 'WORKSPACE_RECONCILIATION_BUDGET_EXHAUSTED' })
  })

  it('rejects invalid or contradictory decision payloads at runtime', () => {
    expect(() => parseRecoveryDecision({ disposition: 'TERMINAL_FAIL', reasonCode: 'FAILED', retryAllowed: true }))
      .toThrow(/unknown field/)
    expect(() => parseRecoveryDecision({ disposition: 'VERIFY_RECOVERED_MUTATION', reasonCode: 'VERIFY' }))
      .toThrow(/required/)
  })
})
