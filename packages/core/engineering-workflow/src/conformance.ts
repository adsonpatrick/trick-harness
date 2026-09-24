/**
 * The deterministic half of the conformance gate.
 *
 * Conformance asks whether an implementation satisfies the Spec and Plan a
 * human approved. The obligation set that question is scored against is built
 * here, by plain code reading the approved documents — never by the model whose
 * work is being judged, which would let it choose what it is held to. A model
 * answers the obligations; this module decides what they are and refuses any
 * answer that does not line up with them.
 *
 * Nothing here reads the filesystem or a provider. The documents arrive as
 * text with the hashes that identify them, so one pair of documents always
 * produces one manifest.
 *
 * @packageDocumentation
 */

import type {
  ApprovedArtifactSet,
  ConformanceContract,
  ConformanceItemStatus,
  ConformanceManifest,
  ConformanceObligation,
  ConformanceSource,
  ConformanceStatusSummary,
} from '@trick-harness/contracts'
import { CONFORMANCE_ITEM_STATUSES, CONFORMANCE_SOURCES } from '@trick-harness/contracts'
import { ChangeImpactError, normalizeRepositoryPath } from '@trick-harness/change-impact'

/** A manifest or a result the gate refuses, named so a caller can tell the refusals apart. */
export class ConformanceError extends Error {
  /** Machine-readable cause. */
  readonly code:
    | 'duplicate-obligation'
    | 'no-obligations'
    | 'artifact-mismatch'
    | 'unanswered-obligation'
    | 'unknown-obligation'
    | 'altered-obligation'
    | 'unreadable-write-set'

  /**
   * @param code - Machine-readable cause.
   * @param message - What was refused, stated without quoting caller data.
   */
  constructor(code: ConformanceError['code'], message: string) {
    super(message)
    this.name = 'ConformanceError'
    this.code = code
  }
}

/** The approved documents an obligation set is built from. */
export interface ConformanceArtifactInput {
  /** The approved Spec, verbatim. */
  readonly specText: string
  /** The approved Plan, verbatim. */
  readonly planText: string
  /** SHA-256 of the Spec, which is half of its identity. */
  readonly specSha256: string
  /** SHA-256 of the Plan, which is half of its identity. */
  readonly planSha256: string
  /** Definition of Done obligations, supplied by deterministic profile policy. */
  readonly dod: readonly ConformanceObligation[]
  /** Delivered paths the Plan never approved, or none when nothing drifted. */
  readonly unplannedPaths?: readonly string[]
}

/**
 * A declared Spec acceptance criterion.
 *
 * Anchored at the start of a line and allowing no leading indentation, because
 * an indented bullet is a note under a criterion rather than a criterion of its
 * own, and prose that names an id it does not declare is not an obligation.
 */
const SPEC_CRITERION = /^-\s+\*\*([A-Z][A-Z0-9-]*\d+):\*\*\s+(.+)$/

/**
 * A Markdown heading, split into its depth and label.
 */
const MARKDOWN_HEADING = /^(#{1,6})\s+(.+?)\s*#*$/

/** A top-level list item inside an acceptance section. */
const ACCEPTANCE_LIST_ITEM = /^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|[1-9][0-9]*[.)]\s+)(.+)$/

/**
 * A declared Plan task heading.
 *
 * Plans commonly put tasks at level two or three. A deeper heading is a
 * section inside a task rather than another independently scored task.
 */
const PLAN_TASK = /^(#{2,3})\s+(?:Task|Tarefa)\s+([1-9][0-9]*)\s*(?::|[.\-–—])\s*(.+)$/iu

/** Normalize a heading label for the finite set of supported section names. */
function normalizedHeading(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .replace(/:$/, '')
    .trim()
    .toLocaleLowerCase('en-US')
}

/** Whether a heading opens a section whose top-level list items are acceptance criteria. */
function isAcceptanceHeading(value: string): boolean {
  return [
    'acceptance criterion',
    'acceptance criteria',
    'acceptance requirements',
    'success criteria',
    'criterio de aceitacao',
    'criterios de aceitacao',
    'requisitos de aceitacao',
    'criterio de aceptacion',
    'criterios de aceptacion',
  ].includes(normalizedHeading(value))
}

/** Read explicit criteria and ordinary list items inside a named acceptance section. */
function declaredSpecCriteria(text: string): readonly ConformanceObligation[] {
  const found: ConformanceObligation[] = []
  let acceptanceDepth: number | undefined
  let generated = 0

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const heading = MARKDOWN_HEADING.exec(line)
    if (heading !== null) {
      const depth = (heading[1] ?? '').length
      if (isAcceptanceHeading(heading[2] ?? '')) acceptanceDepth = depth
      else if (acceptanceDepth !== undefined && depth <= acceptanceDepth) acceptanceDepth = undefined
      continue
    }

    const explicit = SPEC_CRITERION.exec(line)
    if (explicit !== null) {
      found.push(Object.freeze({
        id: explicit[1] ?? '',
        source: 'spec',
        requirement: (explicit[2] ?? '').trim(),
        required: true,
      }))
      continue
    }

    if (acceptanceDepth === undefined) continue
    const listed = ACCEPTANCE_LIST_ITEM.exec(line)
    if (listed === null) continue
    generated += 1
    found.push(Object.freeze({
      id: `SPEC-CRITERION-${generated}`,
      source: 'spec',
      requirement: (listed[1] ?? '').trim(),
      required: true,
    }))
  }

  return found
}

/** Read task headings from the common English and Portuguese Plan forms. */
function declaredPlanTasks(text: string): readonly ConformanceObligation[] {
  const found: ConformanceObligation[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = PLAN_TASK.exec(line.trimEnd())
    if (match === null) continue
    found.push(Object.freeze({
      id: `PLAN-TASK-${match[2] ?? ''}`,
      source: 'plan',
      requirement: (match[3] ?? '').trim(),
      required: true,
    }))
  }
  return found
}

/** The label opening the block a task lists its files under. */
const FILES_BLOCK = /^\*\*Files:\*\*\s*$/

/** Any other bold label, a heading or a rule, all of which close the block. */
const BLOCK_END = /^(?:\*\*|#{1,6}\s|---\s*$)/

/** A row inside a Files block, whatever it commits the task to doing. */
const FILE_ENTRY = /^-\s+(?:Create|Modify|Test|Delete):\s*(.*)$/

/** The repository path inside a file entry, and nothing after it. */
const QUOTED_PATH = /^`([^`]+)`/

/**
 * A trailing source-line locator, stripped only once the path is in hand.
 *
 * Stripped last on purpose: a path is read up to its closing backtick first,
 * so a filename that legitimately contains a colon is not cut in half by a
 * rule that was looking for line numbers.
 */
const LINE_LOCATOR = /:\d+(?:-\d+)?$/

/** Glob metacharacters, which an approved plan has no business naming. */
const GLOB_METACHARACTER = /[*?[\]{}]/

/**
 * Read the set of files the approved Plan committed to writing.
 *
 * This is the planned half of change impact, and it is deliberately read by
 * plain code from the document a person approved rather than reported by the
 * stage about to do the work. A stage that could state its own planned set
 * could widen it after the fact and make every unplanned file look approved.
 *
 * Only rows inside a `**Files:**` block belonging to a `### Task N:` section
 * count. A Files block in the preamble summarises the plan rather than
 * committing a task to anything, and a `- Modify:` line in prose is prose.
 *
 * @param planText - The approved Plan, verbatim.
 * @returns The unique repository paths, sorted, so two reads of one document
 * produce one set that can be compared with a delivered one.
 * @throws {ConformanceError} when a declared entry names something that is not
 * a concrete repository-relative path.
 */
export function extractApprovedPlanWriteSet(planText: string): readonly string[] {
  const paths = new Set<string>()
  let inTask = false
  let inFiles = false

  for (const raw of planText.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (PLAN_TASK.test(line)) {
      inTask = true
      inFiles = false
      continue
    }
    if (inTask && FILES_BLOCK.test(line)) {
      inFiles = true
      continue
    }
    if (inFiles && BLOCK_END.test(line)) {
      inFiles = false
      continue
    }
    if (!inFiles) continue

    const entry = FILE_ENTRY.exec(line)
    if (entry === null) continue
    paths.add(readEntryPath(entry[1] ?? ''))
  }

  return Object.freeze([...paths].sort())
}

/**
 * Read one file entry down to the single path it names.
 *
 * A malformed row is refused rather than skipped. Skipping it would drop a
 * file the plan approved out of the planned set, and the delivered change
 * would then be reported as reaching past what a person agreed to.
 *
 * @param body - Whatever followed the entry's `Create:`/`Modify:` label.
 * @returns The path in repository-relative POSIX form.
 * @throws {ConformanceError} when the row names no concrete path.
 */
function readEntryPath(body: string): string {
  const quoted = QUOTED_PATH.exec(body.trim())
  if (quoted === null || (quoted[1] ?? '').trim().length === 0) {
    throw new ConformanceError('unreadable-write-set', 'the approved Plan declares a file entry naming no path')
  }
  const candidate = (quoted[1] ?? '').trim().replace(LINE_LOCATOR, '')
  if (GLOB_METACHARACTER.test(candidate)) {
    throw new ConformanceError('unreadable-write-set', 'the approved Plan declares a pattern where it owes a concrete file')
  }
  try {
    return normalizeRepositoryPath(candidate)
  }
  catch (cause) {
    // The path is never quoted back. These refusals are journalled, and a plan
    // is a document a person wrote, which is a place a secret reaches.
    if (cause instanceof ChangeImpactError) {
      throw new ConformanceError('unreadable-write-set', 'the approved Plan declares a file entry that is not a repository-relative path')
    }
    throw cause
  }
}

/**
 * Build the obligation set an implementation is judged against.
 *
 * The order is Spec, then Plan, then Definition of Done, each in the order its
 * document declares them, so two runs over one pair of documents produce one
 * manifest and a journalled manifest can be compared with a later one.
 *
 * @param input - The approved documents and the policy's Definition of Done.
 * @returns The manifest, frozen through its obligations.
 * @throws {ConformanceError} when an id is declared twice, or a document declares nothing.
 */
export function buildConformanceManifest(input: ConformanceArtifactInput): ConformanceManifest {
  const spec = declaredSpecCriteria(input.specText)
  if (spec.length === 0) {
    throw new ConformanceError('no-obligations', 'the approved Spec declares no acceptance criterion')
  }
  const plan = declaredPlanTasks(input.planText)
  if (plan.length === 0) {
    throw new ConformanceError('no-obligations', 'the approved Plan declares no task')
  }

  const obligations = [...spec, ...plan, ...input.dod.map(item => Object.freeze({ ...item }))]
  // An id names one obligation. Two under one id means a result answering it
  // has answered one of them and silently skipped the other.
  if (new Set(obligations.map(item => item.id)).size !== obligations.length) {
    throw new ConformanceError('duplicate-obligation', 'the approved artifacts declare one id twice')
  }

  return Object.freeze({
    specSha256: input.specSha256,
    planSha256: input.planSha256,
    obligations: Object.freeze(obligations),
    unplannedPaths: Object.freeze([...input.unplannedPaths ?? []]),
  })
}

/**
 * Hold a returned conformance result to the obligations that were set.
 *
 * Every refusal here is a way a result could otherwise score the work against
 * a set the model chose: leaving an obligation unanswered, answering one twice,
 * inventing one, restating one as something easier, or having been produced
 * against different documents altogether.
 *
 * @param manifest - The obligation set built from the approved artifacts.
 * @param result - The result to hold to it.
 * @returns The result, unchanged, once it lines up with the manifest.
 * @throws {ConformanceError} when it does not.
 */
export function validateConformanceCoverage(
  manifest: ConformanceManifest,
  result: ConformanceContract,
): ConformanceContract {
  if (result.specSha256 !== manifest.specSha256 || result.planSha256 !== manifest.planSha256) {
    throw new ConformanceError('artifact-mismatch', 'the result was produced against other documents')
  }

  const answered = new Set<string>()
  for (const item of result.items) {
    if (answered.has(item.id)) {
      throw new ConformanceError('duplicate-obligation', 'the result answers one obligation twice')
    }
    answered.add(item.id)
    const obligation = manifest.obligations.find(candidate => candidate.id === item.id)
    if (obligation === undefined) {
      throw new ConformanceError('unknown-obligation', 'the result answers an obligation the artifacts never set')
    }
    // Neither the requirement nor its source is quoted in the refusal: both are
    // free text off a provider, and a rejection is journalled.
    if (item.requirement !== obligation.requirement || item.source !== obligation.source) {
      throw new ConformanceError('altered-obligation', 'the result restates an approved obligation')
    }
  }

  if (answered.size !== manifest.obligations.length) {
    throw new ConformanceError('unanswered-obligation', 'the result leaves an approved obligation unanswered')
  }

  return result
}

/**
 * Reduce a validated reading to what a status poll and a durable log may hold.
 *
 * Counting rather than carrying: every field here is a hash, a path, a number
 * or a verdict, so nothing a provider wrote can reach a log that outlives the
 * run by travelling inside the summary. The counts are built over the whole
 * status vocabulary, so a status nothing landed on reads as zero rather than
 * as absent — a reader can tell "no failures" from "this build did not count
 * failures".
 *
 * @param artifacts - The approved documents, for the paths they were read from.
 * @param manifest - The obligation set that was judged.
 * @param result - The validated reading.
 * @returns The bounded summary.
 */
export function summarizeConformance(
  artifacts: ApprovedArtifactSet,
  manifest: ConformanceManifest,
  result: ConformanceContract,
): ConformanceStatusSummary {
  const expected = {} as Record<ConformanceSource, number>
  for (const source of CONFORMANCE_SOURCES) {
    expected[source] = manifest.obligations.filter(item => item.source === source).length
  }
  const counts = {} as Record<ConformanceItemStatus, number>
  for (const status of CONFORMANCE_ITEM_STATUSES) {
    counts[status] = result.items.filter(item => item.status === status).length
  }
  return Object.freeze({
    specPath: artifacts.spec.path,
    specSha256: manifest.specSha256,
    planPath: artifacts.plan.path,
    planSha256: manifest.planSha256,
    expected: Object.freeze(expected),
    counts: Object.freeze(counts),
    verdict: result.verdict,
  })
}
