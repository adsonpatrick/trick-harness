/**
 * The pull-request remediation lifecycle: what runs after the work is on a
 * branch a person can see, and when the branch is ready for one.
 *
 * The ordinary stage plan certifies a working tree. This one certifies a pull
 * request, which is a different thing: the branch is delivered as soon as
 * implementation verifies, and every certifying stage after that reads the same
 * published diff a human reviewer would. A repair therefore does not just edit
 * the tree — it is followed by a fresh delivery, so the next review reads the
 * fix rather than the diff that provoked it.
 *
 * `PR READY` is the only terminal state that says a person may merge, and it is
 * deliberately narrow: every stage passed, no material finding is outstanding,
 * and the run did not run out of repair cycles on its way there. Everything
 * else — a defect that survived the ceiling, a decision nobody made, a stage
 * that could not tell — lands somewhere a person has to look.
 *
 * @packageDocumentation
 */

import type { Finding, Role, WorkflowObjective, WorkflowVerdict } from '@trick-harness/contracts'
import { triage } from './triage.ts'
import type { StageFacts, StageSpec, WorkflowCertificationDecision, WorkflowOutcome } from './types.ts'

/** How a pull-request run finished, in the vocabulary a person reads. */
export type PullRequestState = 'PR_READY' | 'BLOCKED' | 'FAIL' | 'PARTIAL' | 'INCONCLUSIVE'

/** What one pull-request run produced, and what it only reported. */
export interface PullRequestOutcome {
  /** The workflow this reads, unchanged. */
  readonly outcome: WorkflowOutcome
  /** The terminal state, in pull-request terms. */
  readonly state: PullRequestState
  /**
   * Confirmed defects still outstanding when the run stopped.
   *
   * A repaired defect leaves this set by being absent from the stage that
   * re-ran after the repair, not by being marked resolved: the run believes the
   * last reading of the branch, never the claim of the stage that edited it.
   */
  readonly openDefects: readonly Finding[]
  /**
   * Findings that were carried and never acted on — improvements, suspicions,
   * observations. They are reported because somebody should read them, and not
   * implemented because nobody asked for them.
   */
  readonly reportedFindings: readonly Finding[]
  /** Human-readable result. */
  readonly summary: string
}

/**
 * The stages a pull-request run performs, decided before anything is dispatched.
 *
 * Delivery moves ahead of certification here, which is the whole difference
 * from the working-tree plan: a review that reads an unpublished tree is
 * reviewing something no person can comment on. Risk still decides how much
 * certification is bought, and the run finishes with a fresh verification
 * whatever else ran, so nothing is declared ready on the strength of a reading
 * taken before the last repair.
 * @param objective - The approved objective.
 * @returns The stages in the order they will run.
 */
export function planPullRequestStages(objective: WorkflowObjective): readonly StageSpec[] {
  const stages: StageSpec[] = [
    { stageId: 'implement-1', role: 'implement' },
    { stageId: 'verify-1', role: 'verify' },
    { stageId: 'delivery-1', role: 'delivery' },
    { stageId: 'review-1', role: 'review' },
  ]
  if (objective.risk !== 'low') stages.push({ stageId: 'qa-1', role: 'qa' })
  if (objective.risk === 'critical') stages.push({ stageId: 'security-1', role: 'security' })
  // Conformance runs last of the certifying stages, and after every reading
  // that can still open a repair cycle: it asks whether the branch as it now
  // stands satisfies what was approved, and a repair after it would make its
  // answer describe a tree that no longer exists.
  stages.push({ stageId: 'conformance-1', role: 'conformance' })
  stages.push({ stageId: 'verify-final', role: 'verify' })
  return Object.freeze(stages)
}

/** The last time each role ran, so an earlier reading cannot outvote a later one. */
function latestByRole(stages: readonly StageFacts[]): ReadonlyMap<Role, StageFacts> {
  const latest = new Map<Role, StageFacts>()
  for (const stage of stages) latest.set(stage.role, stage)
  return latest
}

/**
 * Read a finished workflow as a pull-request result.
 *
 * Only the last stage of each role is consulted for outstanding defects. A bug
 * that a review found and a repair fixed appears in the review that found it
 * and is absent from the review that re-ran afterwards, and it is the second
 * reading that describes the branch as it now stands.
 * @param outcome - The workflow as the runner finished it.
 * @returns The same run, stated in pull-request terms.
 */
export function assessPullRequest(outcome: WorkflowOutcome): PullRequestOutcome {
  const latest = latestByRole(outcome.stages)
  const openDefects: Finding[] = []
  const reportedFindings: Finding[] = []
  for (const stage of latest.values()) {
    const triaged = triage(stage.findings)
    openDefects.push(...triaged.repairable, ...triaged.blocking)
    reportedFindings.push(...triaged.reported)
  }

  const state = stateOf(outcome, openDefects)
  return Object.freeze({
    outcome,
    state,
    openDefects: Object.freeze(openDefects),
    reportedFindings: Object.freeze(reportedFindings),
    summary: summaryOf(state, outcome, openDefects, reportedFindings),
  })
}

/** Roles that can change what the branch holds, so a reading before one is stale. */
const MUTATING_ROLES: readonly Role[] = ['implement', 'repair', 'delivery']

/**
 * Why conformance does not support a ready pull request, or `undefined`.
 *
 * Three separate ways it can fail to: the run never established conformance at
 * all, it established it and then changed the branch afterwards, or it
 * established that the implementation does not satisfy what was approved.
 * @param outcome - The workflow as the runner finished it.
 * @returns The state to report instead of `PR_READY`, or `undefined`.
 */
function conformanceShortfall(outcome: WorkflowOutcome): PullRequestState | undefined {
  const read = outcome.stages.findLastIndex(stage => stage.role === 'conformance')
  // A run that never asked has not answered. Ready is a claim that the branch
  // satisfies the approved Spec and Plan, and silence is not that claim.
  if (read === -1) return 'INCONCLUSIVE'
  const changed = outcome.stages.findLastIndex(stage => MUTATING_ROLES.includes(stage.role))
  if (changed > read) return 'INCONCLUSIVE'
  const verdict = outcome.stages[read]?.verdict ?? 'INCONCLUSIVE'
  return verdict === 'PASS' ? undefined : terminalOf(verdict)
}

/** Map a workflow's own terminal facts onto the pull-request vocabulary. */
function stateOf(outcome: WorkflowOutcome, openDefects: readonly Finding[]): PullRequestState {
  // Checked before the verdict rather than after: a run whose last certifying
  // reading still names a confirmed defect is not ready, whatever it concluded
  // about itself, and a ceiling reached is exactly the case where it might.
  if (openDefects.length > 0 && outcome.verdict === 'PASS') return 'PARTIAL'
  if (outcome.state === 'completed' && outcome.verdict === 'PASS') {
    return conformanceShortfall(outcome) ?? 'PR_READY'
  }
  return terminalOf(outcome.verdict)
}

/** The pull-request state for a workflow verdict that is not a clean pass. */
function terminalOf(verdict: WorkflowVerdict): PullRequestState {
  if (verdict === 'BLOCKED') return 'BLOCKED'
  if (verdict === 'FAIL') return 'FAIL'
  if (verdict === 'PARTIAL') return 'PARTIAL'
  return 'INCONCLUSIVE'
}

/** State the result the way a person reading the pull request needs it stated. */
function summaryOf(
  state: PullRequestState,
  outcome: WorkflowOutcome,
  openDefects: readonly Finding[],
  reportedFindings: readonly Finding[],
): string {
  const carried = reportedFindings.length === 0
    ? ''
    : `; ${String(reportedFindings.length)} finding(s) reported and not implemented`
  if (state !== 'PR_READY' && outcome.verdict === 'PASS' && openDefects.length === 0) {
    return 'every stage passed, but conformance does not stand for the branch as it is now: '
      + `${outcome.summary}${carried}`
  }
  if (state === 'PR_READY') {
    return `the pull request is ready for a person after ${String(outcome.repairCycles)} repair cycle(s)${carried}`
  }
  if (openDefects.length > 0) {
    return `${String(openDefects.length)} defect(s) are still open, so the pull request is not ready: `
      + `${outcome.summary}${carried}`
  }
  return `${outcome.summary}${carried}`
}

/**
 * Whether a finished run may be certified outside the harness.
 *
 * One projection, derived from {@link assessPullRequest} and nothing else. The
 * temptation is to restate the conditions here — conformance passed, the final
 * verification passed, no defect is open — and that restatement is exactly the
 * bug: it is a second definition of ready that starts identical and drifts, so
 * a later narrowing of `PR_READY` leaves the certification a branch-protection
 * rule requires standing on the older, weaker one. This asks the same function
 * a person reading the run would.
 *
 * `summary` is for the journal. Nothing here reaches a status field: what the
 * certifier publishes is chosen by the capability from the state alone.
 *
 * @param outcome - the workflow as the runner finished it.
 * @returns whether the run is ready, with the verdict and summary behind it.
 */
export function certificationDecision(outcome: WorkflowOutcome): WorkflowCertificationDecision {
  const assessed = assessPullRequest(outcome)
  return Object.freeze({
    ready: assessed.state === 'PR_READY',
    verdict: outcome.verdict,
    summary: assessed.summary,
  })
}
