/**
 * What a repository change touches, decided by code rather than reported.
 *
 * Everything a run is held to downstream — the risk it is judged at, the stages
 * it must pass, the evidence it must produce — is derived here from two things:
 * the paths involved, and a profile's declared path rules. Neither is a model's
 * account of its own work, which is the reason this package exists at all. A
 * stage that could state its own impact could lower the bar it is about to be
 * measured against, and it would do so in the same pull request.
 *
 * Two readings are kept apart. `planned` comes from the approved Plan before
 * any mutation-capable stage runs; `actual` comes from the published branch
 * after delivery. Merging them is monotonic in every field: neither can lower
 * what the other established, and neither can lower the risk the objective was
 * opened at.
 *
 * @module @trick-harness/change-impact
 */

import picomatch from 'picomatch'
import { RISKS, WRITE_VOLUMES } from '@trick-harness/contracts'
import type { ChangeImpactFacts, ChangeImpactSource, EffectiveChangeImpact, Risk, WriteVolume } from '@trick-harness/contracts'
import type { ChangeImpactPolicyDefinition, ChangeImpactRuleDefinition } from '@trick-harness/profile'

export type { ChangeImpactFacts, ChangeImpactSource, EffectiveChangeImpact }

/**
 * Raised when a path cannot be read as a repository-relative path.
 *
 * The message names what was wrong and never the path. These refusals reach a
 * journal, and a repository path is text somebody eventually writes a secret
 * into by accident.
 */
export class ChangeImpactError extends Error {
  /** Stable machine-readable failure code. */
  readonly code = 'CHANGE_IMPACT_INVALID_PATH' as const

  /**
   * @param detail - what the path must be, stated without quoting what it was.
   */
  constructor(detail: string) {
    super(`a repository path ${detail}`)
    this.name = 'ChangeImpactError'
  }
}

/** A path rooted at a Windows volume, which is never repository-relative. */
const DRIVE_LETTER = /^[a-zA-Z]:/

/**
 * Reduce one repository path to the single spelling everything else compares.
 *
 * The planned set is read from a document a person wrote and the actual set
 * from git, on machines that need not agree about separators. Two spellings of
 * one file would count as two paths, and the second would be reported as work
 * nobody approved.
 *
 * @param input - the path as its source wrote it.
 * @returns the path in repository-relative POSIX form.
 * @throws {ChangeImpactError} when it is rooted, empty, or walks upward.
 */
export function normalizeRepositoryPath(input: string): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new ChangeImpactError('must be a non-empty string')
  }
  // Backslashes fold first so one path is one path: a POSIX host reads
  // `docs\..\..\x` as one strange filename, and the same string on Windows is a
  // traversal. Folding before the checks means both hosts see the traversal.
  const folded = input.replaceAll('\\', '/')
  if (folded.startsWith('/') || DRIVE_LETTER.test(folded)) {
    throw new ChangeImpactError('must be repository-relative')
  }
  const segments: string[] = []
  for (const segment of folded.split('/')) {
    // Empty segments are duplicate separators or a trailing slash, and `.` is
    // the same directory under a second spelling. Both are dropped rather than
    // refused: they are how ordinary tools write an ordinary path.
    if (segment === '' || segment === '.') continue
    // `..` is not dropped. Resolving it here would silently turn a path that
    // left the repository into one inside it, and the classification would then
    // be of a file the run never touched.
    if (segment === '..') throw new ChangeImpactError('must not walk out of the repository')
    segments.push(segment)
  }
  if (segments.length === 0) throw new ChangeImpactError('must name a file')
  return segments.join('/')
}

/** Position on the risk ladder, for taking a maximum over it. */
function riskRank(risk: Risk): number {
  return RISKS.indexOf(risk)
}

/** The higher of two risks. */
function higherRisk(left: Risk, right: Risk): Risk {
  return riskRank(left) >= riskRank(right) ? left : right
}

/** The larger of two write volumes. */
function largerVolume(left: WriteVolume, right: WriteVolume): WriteVolume {
  return WRITE_VOLUMES.indexOf(left) >= WRITE_VOLUMES.indexOf(right) ? left : right
}

/**
 * Add a value to an accumulator once, keeping the order it first appeared in.
 *
 * Policy order is the order rules are declared, and it is what a reader sees in
 * the recorded facts. A set would lose it and a sort would replace it with one
 * nobody chose.
 */
function accumulate(into: string[], value: string | undefined): void {
  if (value === undefined || into.includes(value)) return
  into.push(value)
}

/**
 * Build one matcher per rule, ahead of the paths it will be tried against.
 *
 * `dot: true` because a policy's most sensitive rules live in dotted
 * directories — `.github/workflows` is the supply chain — and a matcher that
 * skipped them by default would leave those changes classified as ordinary.
 * `windows: false` because every path reaching here has already been folded to
 * POSIX form, so letting the matcher apply platform rules a second time would
 * make classification depend on which machine ran it.
 */
function matcherFor(rule: ChangeImpactRuleDefinition): (path: string) => boolean {
  return picomatch([...rule.paths], { dot: true, windows: false })
}

/** Score a file count against the profile's declared bands. */
function volumeOf(pathCount: number, policy: ChangeImpactPolicyDefinition): WriteVolume {
  if (pathCount === 0) return 'none'
  if (pathCount <= policy.writeVolume.smallMaxFiles) return 'small'
  if (pathCount <= policy.writeVolume.mediumMaxFiles) return 'medium'
  return 'large'
}

/** What one classification call is given. */
export interface ClassifyChangeImpactInput {
  /** Which of the two readings this is. */
  readonly source: ChangeImpactSource
  /** The paths involved, in whatever spelling their source used. */
  readonly paths: readonly string[]
  /** The project's declared path rules and volume bands. */
  readonly policy: ChangeImpactPolicyDefinition
  /**
   * The paths the approved Plan named, when the caller knows them.
   *
   * Absent and empty mean different things. Absent is "nobody said", and no
   * path is reported as unplanned; empty is "the plan named nothing", and every
   * path is.
   */
  readonly approvedPlannedPaths?: readonly string[]
}

/**
 * Decide what a set of paths means for the run that touches them.
 *
 * Every rule that matches contributes. This is the one place the harness does
 * not resolve first-match-wins, and the difference is deliberate: a signup form
 * is an auth surface and a UI surface at once, and a policy forced to pick one
 * would drop whichever it happened to list second — along with the evidence
 * bar that half carried.
 *
 * @param input - the reading, the paths, the policy and any approved set.
 * @returns the facts, frozen.
 * @throws {ChangeImpactError} when a path is not repository-relative.
 */
export function classifyChangeImpact(input: ClassifyChangeImpactInput): ChangeImpactFacts {
  const paths = [...new Set(input.paths.map(normalizeRepositoryPath))]

  const surfaces: string[] = []
  const taskClasses: string[] = []
  const requiredCapabilities: string[] = []
  const evidenceProfiles: string[] = []
  const matchedRuleIds: string[] = []
  let riskFloor: Risk = 'low'
  let databaseMutation = false

  for (const rule of input.policy.rules) {
    const matches = matcherFor(rule)
    if (!paths.some(path => matches(path))) continue
    matchedRuleIds.push(rule.id)
    accumulate(surfaces, rule.use.surface)
    accumulate(taskClasses, rule.use.taskClass)
    accumulate(requiredCapabilities, rule.use.requiredCapability)
    accumulate(evidenceProfiles, rule.use.evidenceProfile)
    if (rule.use.riskFloor !== undefined) riskFloor = higherRisk(riskFloor, rule.use.riskFloor)
    // A rule can turn the marker on and none can turn it off. Detected database
    // state is a fact about the change, not a setting a later rule may revise.
    if (rule.use.databaseMutation === true) databaseMutation = true
  }

  const approved = input.approvedPlannedPaths === undefined
    ? undefined
    : new Set(input.approvedPlannedPaths.map(normalizeRepositoryPath))

  return Object.freeze({
    source: input.source,
    pathCount: paths.length,
    surfaces: Object.freeze(surfaces),
    riskFloor,
    writeVolume: volumeOf(paths.length, input.policy),
    taskClasses: Object.freeze(taskClasses),
    requiredCapabilities: Object.freeze(requiredCapabilities),
    evidenceProfiles: Object.freeze(evidenceProfiles),
    databaseMutation,
    matchedRuleIds: Object.freeze(matchedRuleIds),
    unplannedPaths: Object.freeze(approved === undefined ? [] : paths.filter(path => !approved.has(path))),
  })
}

/** What one resolution call is given. */
export interface MergeChangeImpactInput {
  /** The risk the objective was opened at. */
  readonly objectiveRisk: Risk
  /** What the approved plan said the change would touch. */
  readonly planned: ChangeImpactFacts
  /** What the published branch turned out to touch, once there is one. */
  readonly actual?: ChangeImpactFacts
}

/** Union two ordered lists, keeping first appearance and saying each thing once. */
function union(left: readonly string[], right: readonly string[]): readonly string[] {
  const merged: string[] = []
  for (const value of [...left, ...right]) accumulate(merged, value)
  return Object.freeze(merged)
}

/**
 * Resolve the two readings into the single policy the run is held to.
 *
 * Monotonic in every field, and that is the whole guarantee. A delivered change
 * that turned out to touch migrations is a database change even though nobody
 * planned one, and a planned database change stays one even if the diff came
 * back small — because the alternative is a run that lowers its own bar by
 * delivering less than it said it would.
 *
 * @param input - the objective's risk and the readings taken so far.
 * @returns the resolution, frozen; `actual` is absent until there is one.
 */
export function mergeChangeImpact(input: MergeChangeImpactInput): EffectiveChangeImpact {
  const { planned, actual, objectiveRisk } = input
  const floors = actual === undefined
    ? planned.riskFloor
    : higherRisk(planned.riskFloor, actual.riskFloor)

  return Object.freeze({
    planned,
    ...actual === undefined ? {} : { actual },
    effectiveRisk: higherRisk(objectiveRisk, floors),
    writeVolume: actual === undefined
      ? planned.writeVolume
      : largerVolume(planned.writeVolume, actual.writeVolume),
    surfaces: union(planned.surfaces, actual?.surfaces ?? []),
    taskClasses: union(planned.taskClasses, actual?.taskClasses ?? []),
    requiredCapabilities: union(planned.requiredCapabilities, actual?.requiredCapabilities ?? []),
    evidenceProfiles: union(planned.evidenceProfiles, actual?.evidenceProfiles ?? []),
    databaseMutation: planned.databaseMutation || (actual?.databaseMutation ?? false),
  })
}
