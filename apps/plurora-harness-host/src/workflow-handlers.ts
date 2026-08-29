/**
 * How this deployment reads a provider's output back into the run.
 *
 * The runtime never parses executor output and has no default for doing so, on
 * purpose: reading a model's prose and deciding what it meant is a project's
 * judgement, not a framework's. This module is Plurora's answer to that, and it
 * is deliberately the least powerful answer that works.
 *
 * Two properties hold throughout. First, a stage says what it did in a stated
 * envelope or it has said nothing — prose is not evidence, and a handler that
 * guessed a PASS out of a confident-sounding paragraph would be the single
 * cheapest way to defeat every gate above it. Second, these handlers describe
 * and never act: `describeDelivery` names a branch, a write set and a pull
 * request body, and the deterministic delivery capability is what performs the
 * commit, the push and the pull request. Nothing here touches git, GitHub or a
 * database, so a model that talks its way past the interpreter still reaches
 * only the bounded operation set those capabilities expose.
 *
 * @module apps/plurora-harness-host/workflow-handlers
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { HarnessWorkflowHandlers } from '@trick-harness/composition'
import type {
  ApprovedArtifactRef, DiagnosisContract, EvidenceRef, StageResult, WorkflowObjective,
} from '@trick-harness/contracts'
import { parseConformanceContract, parseDiagnosisContract, parseStageResult } from '@trick-harness/contracts'
import { pluroraDodObligations } from '../../../profiles/plurora/profile.ts'
import type { StageSpec } from '@trick-harness/engineering-workflow'
import type { ExecutorResult } from '@trick-harness/executor'
import { looksLikeSecret } from './redaction.ts'

/**
 * The line a stage is required to end with.
 *
 * One line rather than a fenced block: a fence is something a model reproduces
 * inside its own explanation, and an envelope that can appear twice is an
 * envelope whose meaning depends on which one a parser happened to read.
 */
export const RESULT_MARKER = 'HARNESS-RESULT:'

/** How much of a stage's own summary this deployment journals. */
export const MAX_SUMMARY_CHARS = 400

/** The branch prefix an automated run is allowed to publish under. */
export const DELIVERY_BRANCH_PREFIX = 'harness/'

/**
 * How long a derived branch name may get.
 *
 * An objective id is written by whoever opened the objective and is bounded by
 * nothing; a refname is bounded by the filesystem the ref is stored on. Cutting
 * here means a long id yields a usable branch rather than a delivery that fails
 * on a path length nobody was thinking about.
 */
export const MAX_BRANCH_NAME_CHARS = 80

/** What the handlers need from the deployment. */
export interface PluroraWorkflowHandlerOptions {
  /** The pull request's base branch; the run may never push to it. */
  readonly baseBranch?: string
}

/** The default base for every pull request this deployment opens. */
const DEFAULT_BASE_BRANCH = 'main'

/**
 * The branch one objective's work is published on.
 *
 * Derived from the objective rather than chosen by a model: the delivery
 * capability validates the requested branch against the one the workspace has
 * checked out, so a name a model invented would simply be refused there, later,
 * with nothing explaining why. Deriving it means the operator and the run agree
 * in advance, and a workspace on the wrong branch fails as the mismatch it is.
 *
 * @param objectiveId - the objective being worked.
 * @returns the branch name, restricted to characters git and this policy allow.
 */
export function deliveryBranch(objectiveId: string): string {
  const room = MAX_BRANCH_NAME_CHARS - DELIVERY_BRANCH_PREFIX.length
  const slug = trimEdges(objectiveId.toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, '-')
    // Collapsed after substitution, not before: a run of separators is one
    // separator, and `--` at the head of a segment is a git refname error.
    .replaceAll(/-{2,}/g, '-')
    // `..` is a refname error too, and it is exactly what an id like `a..b`
    // produces through a substitution that leaves dots alone.
    .replaceAll(/\.{2,}/g, '.'))
    .slice(0, room)
  // Trimmed again after the cut, and `.lock` dropped last: both are endings the
  // slicing itself can create, and either one makes git refuse the whole ref.
  const named = trimEdges(slug).replace(/\.lock$/, '')
  return `${DELIVERY_BRANCH_PREFIX}${named === '' ? 'objective' : named}`
}

/** Drop the leading and trailing characters git will not accept on a segment. */
function trimEdges(value: string): string {
  return value.replaceAll(/^[-.]+|[-.]+$/g, '')
}

/** Trim a stage's own text to what this deployment will keep. */
function bounded(value: string): string {
  const line = value.trim().split('\n', 1)[0] ?? ''
  return line.length > MAX_SUMMARY_CHARS ? `${line.slice(0, MAX_SUMMARY_CHARS)}…` : line
}

/**
 * Keep `value` only if it carries nothing credential-shaped.
 *
 * A stage's envelope is written by a model that has just been reading a
 * repository, and this text is journalled. Refusing here turns the accident
 * into a stage that failed to report, which is recoverable; letting it through
 * writes the secret into an append-only log, which is not.
 *
 * @param value - the text the stage wants journalled.
 * @returns the bounded text, or a refusal notice in its place.
 */
function safeSummary(value: string): string {
  const text = bounded(value)
  if (text === '' || looksLikeSecret(text)) {
    return 'the stage reported nothing this host will journal'
  }
  return text
}

/** Read the envelope out of a stage's final output, if it stated one. */
function envelopeOf(output: string): Record<string, unknown> | undefined {
  const at = output.lastIndexOf(RESULT_MARKER)
  if (at === -1) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(output.slice(at + RESULT_MARKER.length).trim())
  }
  catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return parsed as Record<string, unknown>
}

/**
 * The result for a stage that did not state one this host can read.
 *
 * BLOCKED rather than FAIL, and the distinction matters: a stage whose report
 * could not be read has established nothing either way, and recording that as a
 * failure would send the run into a repair cycle for a defect nobody found.
 *
 * @param stage - the stage that ran.
 * @param executor - who ran it.
 * @param reason - what a reader needs, quoting nothing the stage wrote.
 * @returns a BLOCKED stage result.
 */
function unreadable(stage: StageSpec, executor: string, reason: string): StageResult {
  return {
    role: stage.role,
    executor,
    verdict: 'BLOCKED',
    summary: `${reason}, so this stage established nothing`,
    findings: [],
    evidence: [],
  }
}

/**
 * Read one stage's envelope as its result.
 *
 * @param stage - the stage that ran.
 * @param executor - who ran it.
 * @param result - what the provider handed back.
 * @returns the stage's bounded result.
 */
function interpret(stage: StageSpec, executor: string, result: ExecutorResult): StageResult {
  if (result.status === 'aborted') {
    return unreadable(stage, executor, 'the stage was cancelled before it reported')
  }
  if (result.status === 'error') {
    return {
      role: stage.role,
      executor,
      verdict: 'BLOCKED',
      // The provider's diagnostic is already redacted at its own boundary; it
      // is bounded again here because this host decides what its log holds.
      summary: safeSummary(result.failure?.safeDiagnostic ?? 'the executor failed without saying why'),
      findings: [],
      evidence: [],
    }
  }

  const envelope = envelopeOf(result.output)
  if (envelope === undefined) {
    return unreadable(stage, executor, `the stage printed no ${RESULT_MARKER} envelope`)
  }
  let parsed: StageResult
  try {
    // The role and the executor are the runtime's facts, not the stage's: a
    // model that could name its own role could route its work past the policy
    // that decided which role was allowed to do it.
    parsed = parseStageResult({ ...envelope, role: stage.role, executor })
  }
  catch {
    return unreadable(stage, executor, `the ${RESULT_MARKER} envelope was not one this host can read`)
  }
  return {
    ...parsed,
    summary: safeSummary(parsed.summary),
    evidence: safeEvidence(parsed.evidence),
    // A finding carries an evidence list of its own, and the promise this host
    // makes is about what reaches the journal rather than about one field of it.
    findings: parsed.findings
      .filter(item => !looksLikeSecret(item.summary))
      .map(item => ({ ...item, evidence: safeEvidence(item.evidence) })),
  }
}

/**
 * Keep only the references carrying nothing credential-shaped.
 *
 * @param evidence - the references a stage stated.
 * @returns those this host will journal.
 */
function safeEvidence(evidence: readonly EvidenceRef[]): readonly EvidenceRef[] {
  return evidence.filter(item => !looksLikeSecret(item.locator) && !looksLikeSecret(item.summary))
}

/** Raised when an approved document cannot be read the way this host will read one. */
export class ApprovedArtifactError extends Error {
  override readonly name = 'ApprovedArtifactError'
}

/**
 * Resolve one approved document inside the checkout, or refuse to read it.
 *
 * The path is data on an objective, and an objective can be opened over the
 * control server. Without this, a path that walked out of the checkout would
 * hand a stage the text of any file this host process can read under the name
 * of an approved Spec — and the hash check downstream would not notice, because
 * the hash is computed over whatever was read.
 *
 * Backslashes are folded first so one path is one path: a POSIX host treats
 * `docs\..\..\x` as a single strange filename and would let it through, while
 * the same string on Windows is a traversal.
 *
 * @param root - the checkout the run is working in.
 * @param artifact - the approved document's repository-relative path.
 * @returns the absolute path, once it is inside the checkout.
 * @throws {ApprovedArtifactError} when it is not, naming no path.
 */
function containedPath(root: string, artifact: ApprovedArtifactRef): string {
  const resolved = resolve(root, artifact.path.replaceAll('\\', '/'))
  const inside = relative(root, resolved)
  // Empty means the path resolved to the checkout itself, which is a directory
  // and not a document; `..` and an absolute remainder both mean it left.
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    // The refusal names neither the path nor the checkout: it reaches a journal,
    // and the path is attacker-supplied text a secret can be written into.
    throw new ApprovedArtifactError('an approved document is named by a path outside the checkout, so nothing was read')
  }
  return resolved
}

/**
 * Read one approved document and say what it hashes to now.
 *
 * @param root - the checkout the run is working in.
 * @param artifact - the approved document's path and approved hash.
 * @returns the text and the hash of what was actually read.
 * @throws {ApprovedArtifactError} when it is outside the checkout or unreadable.
 */
async function readApproved(root: string, artifact: ApprovedArtifactRef): Promise<{ text: string; sha256: string }> {
  const path = containedPath(root, artifact)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  }
  catch {
    // The cause is dropped: a filesystem error carries the absolute path.
    throw new ApprovedArtifactError('an approved document could not be read from the checkout')
  }
  // Hashed over what was read rather than copied off the objective. Copying it
  // would make every re-read agree with the approval by construction, which is
  // the one thing reading the documents again exists to check.
  return { text, sha256: createHash('sha256').update(text, 'utf8').digest('hex') }
}

/**
 * Prompt text for the stage that scores the branch against what was approved.
 *
 * It names the documents rather than quoting them: the obligations are read out
 * of those documents by deterministic code, and a prompt that carried a copy
 * would be one more version of them for an answer to be produced against. What
 * the stage is told is where they are, that it may not touch the tree it is
 * judging, and the shape of the answer it owes back.
 *
 * @param stage - the conformance stage.
 * @param objective - the objective, which names the approved documents.
 * @returns the prompt.
 */
function conformanceTask(stage: StageSpec, objective: WorkflowObjective): string {
  const { spec, plan } = objective.approvedArtifacts
  return [
    `You are the conformance stage (${stage.stageId}) of one engineering workflow.`,
    `Objective: ${objective.requirement}`,
    'Judge the branch as it stands against the approved documents:',
    `  Spec: ${spec.path}`,
    `  Plan: ${plan.path}`,
    'Answer every acceptance criterion the Spec declares, every task the Plan declares, and every'
    + ' Definition of Done obligation you are given. An obligation you do not answer is not a pass.',
    'This stage is read-only: you may not change the working tree, and work you fixed while judging'
    + ' it is work nobody reviewed.',
    '',
    `End your final message with one line: ${RESULT_MARKER} followed by JSON holding a "conformance"`
    + ' object with the fields items (array of {id, source, requirement, status, implementationEvidence,'
    + ' verificationEvidence, summary}), verdict ("PASS", "FAIL" or "BLOCKED") and summary (one line).',
    'Restate the id, source and requirement of each obligation exactly as they were given to you; a'
    + ' restated requirement is an answer to something nobody approved.',
    'Include no credential, connection string or token in any of those fields.',
  ].join('\n')
}

/** Prompt text for one stage, stating the envelope every stage owes back. */
function task(stage: StageSpec, objective: WorkflowObjective): string {
  if (stage.role === 'conformance') return conformanceTask(stage, objective)
  return [
    `You are the ${stage.role} stage (${stage.stageId}) of one engineering workflow.`,
    `Objective: ${objective.requirement}`,
    `Risk: ${objective.risk}. Workload: ${objective.workload}.`,
    'Do only the work this role covers. You may read and change the working tree.',
    'You may not commit, push, open a pull request, merge, release, or touch a database:'
    + ' those are performed for you once this workflow decides they are warranted.',
    '',
    `End your final message with one line: ${RESULT_MARKER} followed by JSON with the fields`
    + ' verdict ("PASS", "FAIL" or "BLOCKED"), summary (one line), findings (array) and'
    + ' evidence (array of {kind, locator, summary}, kind one of test, diff, log, file, pr, commit, gate).',
    'Cite every file you changed as evidence of kind "diff" with the repository-relative path as its'
    + ' locator; a path you do not cite is a path this workflow will not publish.',
    'Include no credential, connection string or token in any of those fields.',
  ].join('\n')
}

/**
 * Build this deployment's workflow handlers.
 *
 * The returned handlers accumulate the write set across the run: every `diff`
 * locator any stage cited becomes a path delivery is allowed to stage, and
 * nothing else does. That is why a stage that changed a file and did not cite
 * it leaves that file unpublished — the alternative is a delivery whose scope is
 * whatever the working tree happens to hold, which is unbounded by definition.
 *
 * @param options - the base branch, when it is not `main`.
 * @returns the handlers the composition reads provider output through.
 */
export function createPluroraWorkflowHandlers(
  options: PluroraWorkflowHandlerOptions = {},
): HarnessWorkflowHandlers {
  const base = options.baseBranch ?? DEFAULT_BASE_BRANCH
  const writeSet = new Set<string>()

  return {
    interpret(stage, executor, result) {
      const interpreted = interpret(stage, executor, result)
      for (const item of interpreted.evidence) {
        if (item.kind === 'diff') writeSet.add(item.locator.replaceAll('\\', '/'))
      }
      return interpreted
    },
    task,
    dodObligations: pluroraDodObligations,
    async loadApprovedArtifacts(objective) {
      const [spec, plan] = await Promise.all([
        readApproved(objective.cwd, objective.approvedArtifacts.spec),
        readApproved(objective.cwd, objective.approvedArtifacts.plan),
      ])
      return { specText: spec.text, planText: plan.text, specSha256: spec.sha256, planSha256: plan.sha256 }
    },
    conformance(_stage, _executor, result, manifest) {
      if (result.status !== 'completed') return undefined
      const claim = envelopeOf(result.output)?.['conformance']
      if (typeof claim !== 'object' || claim === null || Array.isArray(claim)) return undefined
      try {
        const parsed = parseConformanceContract({
          ...claim,
          // The hashes identify the documents this reading was scored against,
          // and they are the runtime's facts. A stage that could state its own
          // would answer obligations out of documents nobody approved and still
          // line up with the manifest it was checked against.
          specSha256: manifest.specSha256,
          planSha256: manifest.planSha256,
        })
        return { ...parsed, summary: safeSummary(parsed.summary) }
      }
      catch {
        // Not a pass and not a fail: a claim this host cannot read has
        // established nothing, and the runtime ends the run saying exactly that.
        return undefined
      }
    },
    diagnose(_stage, _executor, result): DiagnosisContract | undefined {
      const envelope = envelopeOf(result.output)
      if (envelope === undefined) return undefined
      try {
        return parseDiagnosisContract(envelope['diagnosis'])
      }
      catch {
        // A diagnosis that cannot be read is not a diagnosis. The repair gate
        // refuses on `undefined`, which is the right answer to "the debugger
        // established something, but nothing here can say what".
        return undefined
      }
    },
    repairEvidence(_stage, _executor, result) {
      const envelope = envelopeOf(result.output)
      const claim = envelope?.['repair']
      if (typeof claim !== 'object' || claim === null || Array.isArray(claim)) {
        return { rootCauseAddressed: false }
      }
      const record = claim as Record<string, unknown>
      return {
        ...evidenceOrNothing(record['regressionTest'], 'regressionTest'),
        ...evidenceOrNothing(record['focusedGreen'], 'focusedGreen'),
        rootCauseAddressed: record['rootCauseAddressed'] === true,
      }
    },
    describeDelivery(input) {
      return {
        branch: deliveryBranch(input.objective.id),
        // Sorted so two runs over the same set produce the same request, and a
        // reviewer comparing two deliveries is comparing content, not order.
        files: [...writeSet].toSorted(),
        // Bounded exactly as the pull request title is: the same text, and a
        // commit subject is the one place a wall of it is least readable.
        message: `${bounded(input.objective.requirement) || 'harness change'}\n\n`
          + `Objective: ${input.objective.id}\nStage: ${input.stageId}`,
        pullRequest: {
          title: bounded(input.objective.requirement),
          body: `Objective \`${input.objective.id}\` run by the Plurora harness.\n\n`
            + 'Merging stays a human decision; this run cannot approve or merge its own work.',
          base,
        },
      }
    },
  }
}

/**
 * Read one optional evidence reference out of a repair claim.
 *
 * Returns an absent key rather than `undefined` so the completion gate sees the
 * field as unstated, which is what an unreadable claim actually is.
 *
 * @param value - the claimed reference.
 * @param key - which repair obligation it is about.
 * @returns a single-entry record, or an empty one.
 */
function evidenceOrNothing(value: unknown, key: 'regressionTest' | 'focusedGreen'): Record<string, EvidenceRef> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const locator = record['locator']
  const summary = record['summary']
  const kind = record['kind']
  if (typeof locator !== 'string' || typeof summary !== 'string' || kind !== 'test') return {}
  if (looksLikeSecret(locator) || looksLikeSecret(summary)) return {}
  return { [key]: { kind: 'test', locator, summary: bounded(summary) } }
}
