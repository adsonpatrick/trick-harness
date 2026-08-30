/**
 * Validated registry for project profiles.
 *
 * Core owns the mechanism — the shape a profile must have and the guarantee
 * that an invalid one never reaches a runtime — while each profile owns the
 * project's choices. Validation runs at registration, not at lookup, so a bad
 * policy table fails where it was introduced rather than deep inside a routing
 * decision that a reviewer would have to reconstruct after the fact.
 *
 * @module @trick-harness/profile
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  HarnessProfile,
  HarnessProfileRegistry,
  IndependencePolicyDefinition,
  ProfileRegistration,
} from './types.ts'

export type * from './types.ts'

/** Lowercase kebab-case, the form a profile id is recorded in durable facts as. */
const PROFILE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** `<name>-v<major>.<minor>.<patch>`, recorded alongside every route decision. */
const POLICY_VERSION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*-v\d+\.\d+\.\d+$/

/**
 * Review independence each risk level requires.
 *
 * Held as data rather than left to the type system alone: a profile authored in
 * plain JavaScript, or loaded from outside the build, still cannot downgrade
 * high-risk work to same-executor review.
 */
const REQUIRED_INDEPENDENCE: IndependencePolicyDefinition = {
  low: 'fresh-context',
  medium: 'cross-executor-preferred',
  high: 'cross-executor-required',
  critical: 'cross-executor-required',
}

/** Policy blocks every profile must carry, even when their contents are empty. */
const REQUIRED_BLOCKS = [
  'routingPolicy',
  'workflowPolicy',
  'independencePolicy',
  'qaPolicy',
  'securityPolicy',
  'integrationPolicy',
  'trustedComposition',
  'changeImpactPolicy',
] as const

/** Thrown when a candidate profile does not satisfy the contract. */
export class ProfileValidationError extends Error {
  /** Stable machine-readable failure code. */
  readonly code = 'PROFILE_INVALID' as const

  /**
   * Construct a field-attributed validation failure.
   * @param field - dotted path of the offending field.
   * @param detail - what the field must satisfy.
   */
  constructor(field: string, detail: string) {
    super(`profile ${field}: ${detail}`)
    this.name = 'ProfileValidationError'
  }
}

/** Thrown when a lookup names a profile that is not registered. */
export class ProfileNotFoundError extends Error {
  /** Stable machine-readable failure code. */
  readonly code = 'PROFILE_NOT_FOUND' as const

  /**
   * Construct a lookup failure naming the requested id.
   * @param id - the profile id that was not registered.
   */
  constructor(id: string) {
    super(`profile ${JSON.stringify(id)} is not registered`)
    this.name = 'ProfileNotFoundError'
  }
}

/** Read one property off an unknown candidate without narrowing it first. */
function field(candidate: unknown, key: string): unknown {
  return (candidate as Record<string, unknown> | null)?.[key]
}

/** Require a positive integer bound, so a repair loop is guaranteed to terminate. */
function requirePositiveInteger(value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ProfileValidationError(path, 'must be a positive integer')
  }
}

/** Require an array, distinguishing an empty decision from an absent one. */
function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new ProfileValidationError(path, 'must be an array')
  return value
}

/**
 * Validate one flat table of policy values.
 *
 * Policy is data a router reads, never behavior it runs, and that distinction
 * is only real if it is checked at the boundary: a nested object, an array or a
 * function that reaches a rule is a decision the profile made somewhere the
 * routing engine cannot see. `Object.entries` is what reads the table, so an
 * inherited field declares nothing and a symbol key is not policy at all.
 * @param value - the candidate table, as a caller or a parser produced it.
 * @param path - dotted path of the table, for attributing a failure.
 * @param options - whether a table with no entries is a decision or an omission.
 * @throws {ProfileValidationError} naming the exact entry that fails.
 */
function validateScalarTable(value: unknown, path: string, { allowEmpty }: { allowEmpty: boolean }): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProfileValidationError(path, 'must be a flat object')
  }
  const entries = Object.entries(value)
  if (!allowEmpty && entries.length === 0) {
    throw new ProfileValidationError(path, 'must declare at least one value')
  }
  for (const [key, entry] of entries) {
    const at = `${path}.${key}`
    if (typeof entry === 'string' || typeof entry === 'boolean') continue
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) {
        throw new ProfileValidationError(at, 'must be a finite number')
      }
      continue
    }
    throw new ProfileValidationError(at, 'must be a string, a finite number or a boolean')
  }
}

/** Validate one rule list and reject ids repeated within it. */
function validateRules(value: unknown, path: string, { allowEmpty }: { allowEmpty: boolean }): void {
  const rules = requireArray(value, path)
  if (!allowEmpty && rules.length === 0) {
    throw new ProfileValidationError(path, 'must declare at least one rule')
  }
  const seen = new Set<string>()
  for (const [index, rule] of rules.entries()) {
    const id = field(rule, 'id')
    if (typeof id !== 'string' || id.length === 0) {
      throw new ProfileValidationError(`${path}[${index}].id`, 'must be a non-empty string')
    }
    if (seen.has(id)) {
      throw new ProfileValidationError(`${path}[${index}].id`, `repeats rule id ${JSON.stringify(id)}`)
    }
    seen.add(id)
    // An empty `when` is the catch-all rule and a real decision; an empty `use`
    // is a rule that routes to nothing, which is an omission rather than one.
    validateScalarTable(field(rule, 'when'), `${path}[${index}].when`, { allowEmpty: true })
    validateScalarTable(field(rule, 'use'), `${path}[${index}].use`, { allowEmpty: false })
  }
}

/** Validate every string entry of a declared id list. */
function validateStringList(value: unknown, path: string): void {
  for (const [index, entry] of requireArray(value, path).entries()) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new ProfileValidationError(`${path}[${index}]`, 'must be a non-empty string')
    }
  }
}

/**
 * Validate the declared security-repair allowlist, when one is declared.
 *
 * Absent is legitimate and means fail-closed. Present and malformed is not: a
 * rule that names no boundary, or names one as something other than a string,
 * would silently authorise nothing while reading like it authorises something.
 * @param value - the declared rules, or undefined.
 * @throws ProfileValidationError naming the first field that fails.
 */
function validateSecurityRepairRules(value: unknown): void {
  if (value === undefined) return
  const path = 'securityPolicy.repairRules'
  const seen = new Set<string>()
  for (const [index, entry] of requireArray(value, path).entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new ProfileValidationError(`${path}[${index}]`, 'must be an object')
    }
    const id = field(entry, 'id')
    if (typeof id !== 'string' || id.length === 0) {
      throw new ProfileValidationError(`${path}[${index}].id`, 'must be a non-empty string')
    }
    if (seen.has(id)) {
      throw new ProfileValidationError(`${path}[${index}].id`, `repeats rule id ${JSON.stringify(id)}`)
    }
    seen.add(id)
    if (field(entry, 'findingClass') !== 'SECURITY_BUG') {
      throw new ProfileValidationError(`${path}[${index}].findingClass`, 'must be "SECURITY_BUG"')
    }
    validateStringList(field(entry, 'allowedBoundaries'), `${path}[${index}].allowedBoundaries`)
  }
}

/** Risk levels a path rule may raise a run to; see {@link ChangeImpactRiskFloor}. */
const RISK_FLOORS = ['low', 'medium', 'high', 'critical']

/** What a matched path rule may contribute, and what each contribution must be. */
const IMPACT_USE_FIELDS = {
  surface: 'string',
  riskFloor: 'risk',
  taskClass: 'string',
  requiredCapability: 'string',
  evidenceProfile: 'string',
  databaseMutation: 'boolean',
} as const

/**
 * Validate one repository-relative glob pattern.
 *
 * A pattern is matched against paths that have already been normalized to
 * repository-relative POSIX form. So a pattern that is rooted — at `/`, at a
 * drive letter, at a UNC share — or that walks upward can only ever match
 * nothing. Accepting one would leave a policy whose surface reads as covered
 * and is not, which is worse than a policy that fails at registration.
 * @param value - the candidate pattern.
 * @param path - dotted path of the pattern, for attributing a failure.
 * @throws {ProfileValidationError} naming the pattern's own field path.
 */
function validatePathPattern(value: unknown, path: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ProfileValidationError(path, 'must be a non-empty string')
  }
  const posix = value.replaceAll('\\', '/')
  if (posix.startsWith('/') || /^[a-zA-Z]:/.test(posix)) {
    throw new ProfileValidationError(path, 'must be a repository-relative pattern')
  }
  if (posix.split('/').includes('..')) {
    throw new ProfileValidationError(path, 'must not walk out of the repository')
  }
}

/**
 * Validate one path rule's contribution row.
 *
 * Stated as a closed set of known fields rather than as a shape check, because
 * the failure this guards against is a misspelling: `surfaces` instead of
 * `surface` is a rule that reads like policy, passes every structural test and
 * contributes nothing to the classification it was written for.
 * @param value - the candidate `use` row.
 * @param path - dotted path of the row, for attributing a failure.
 * @throws {ProfileValidationError} naming the exact entry that fails.
 */
function validateImpactUse(value: unknown, path: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProfileValidationError(path, 'must be a flat object')
  }
  const entries = Object.entries(value)
  if (entries.length === 0) {
    throw new ProfileValidationError(path, 'must contribute at least one value')
  }
  for (const [key, entry] of entries) {
    const at = `${path}.${key}`
    const expected = (IMPACT_USE_FIELDS as Record<string, string | undefined>)[key]
    if (expected === undefined) {
      throw new ProfileValidationError(at, 'is not a field the classifier reads')
    }
    if (expected === 'risk') {
      if (typeof entry !== 'string' || !RISK_FLOORS.includes(entry)) {
        throw new ProfileValidationError(at, `must be one of ${RISK_FLOORS.join(', ')}`)
      }
      continue
    }
    if (expected === 'boolean') {
      if (typeof entry !== 'boolean') throw new ProfileValidationError(at, 'must be a boolean')
      continue
    }
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new ProfileValidationError(at, 'must be a non-empty string')
    }
  }
}

/**
 * Validate the project's change-impact policy.
 *
 * An empty rule list is a legitimate decision — a project that has not
 * classified its paths yet — and is not the same as a missing list, which is an
 * omission the runtime cannot tell apart from a decision unless it is refused.
 * @param value - the candidate policy block.
 * @throws {ProfileValidationError} naming the first field that fails.
 */
function validateChangeImpactPolicy(value: unknown): void {
  const path = 'changeImpactPolicy'
  const rules = requireArray(field(value, 'rules'), `${path}.rules`)
  const seen = new Set<string>()
  for (const [index, rule] of rules.entries()) {
    const at = `${path}.rules[${index}]`
    const id = field(rule, 'id')
    if (typeof id !== 'string' || id.length === 0) {
      throw new ProfileValidationError(`${at}.id`, 'must be a non-empty string')
    }
    if (seen.has(id)) {
      // Matched rule ids are durable facts a later reader routes on; two rules
      // under one id make a recorded fact ambiguous about what produced it.
      throw new ProfileValidationError(`${at}.id`, `repeats rule id ${JSON.stringify(id)}`)
    }
    seen.add(id)
    const paths = requireArray(field(rule, 'paths'), `${at}.paths`)
    if (paths.length === 0) {
      throw new ProfileValidationError(`${at}.paths`, 'must declare at least one pattern')
    }
    for (const [patternIndex, pattern] of paths.entries()) {
      validatePathPattern(pattern, `${at}.paths[${patternIndex}]`)
    }
    validateImpactUse(field(rule, 'use'), `${at}.use`)
  }

  const writeVolume = field(value, 'writeVolume')
  requirePositiveInteger(field(writeVolume, 'smallMaxFiles'), `${path}.writeVolume.smallMaxFiles`)
  requirePositiveInteger(field(writeVolume, 'mediumMaxFiles'), `${path}.writeVolume.mediumMaxFiles`)
  if ((field(writeVolume, 'mediumMaxFiles') as number) <= (field(writeVolume, 'smallMaxFiles') as number)) {
    throw new ProfileValidationError(`${path}.writeVolume.mediumMaxFiles`, 'must be greater than smallMaxFiles')
  }
}

/**
 * Validate a candidate profile against the contract.
 * @param candidate - the value to check; may be any shape.
 * @returns nothing; the assertion signature narrows `candidate` in the caller.
 * @throws ProfileValidationError naming the first field that fails.
 */
export function validateProfile(candidate: unknown): asserts candidate is HarnessProfile {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new ProfileValidationError('root', 'must be an object')
  }

  const id = field(candidate, 'id')
  if (typeof id !== 'string' || !PROFILE_ID_PATTERN.test(id)) {
    throw new ProfileValidationError('id', 'must be lowercase kebab-case')
  }

  const policyVersion = field(candidate, 'policyVersion')
  if (typeof policyVersion !== 'string' || !POLICY_VERSION_PATTERN.test(policyVersion)) {
    throw new ProfileValidationError('policyVersion', 'must match <name>-v<major>.<minor>.<patch>')
  }

  for (const block of REQUIRED_BLOCKS) {
    const value = field(candidate, block)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ProfileValidationError(block, 'must be present and an object')
    }
  }

  const routingPolicy = field(candidate, 'routingPolicy')
  validateRules(field(routingPolicy, 'rules'), 'routingPolicy.rules', { allowEmpty: false })
  validateRules(field(routingPolicy, 'fallbackRules'), 'routingPolicy.fallbackRules', { allowEmpty: true })

  const workflowPolicy = field(candidate, 'workflowPolicy')
  requirePositiveInteger(field(workflowPolicy, 'maxRepairCycles'), 'workflowPolicy.maxRepairCycles')
  requirePositiveInteger(field(workflowPolicy, 'maxExecutorStarts'), 'workflowPolicy.maxExecutorStarts')

  const independencePolicy = field(candidate, 'independencePolicy')
  for (const [level, required] of Object.entries(REQUIRED_INDEPENDENCE)) {
    if (field(independencePolicy, level) !== required) {
      throw new ProfileValidationError(`independencePolicy.${level}`, `must be ${JSON.stringify(required)}`)
    }
  }

  validateRules(field(field(candidate, 'qaPolicy'), 'rules'), 'qaPolicy.rules', { allowEmpty: true })
  const securityPolicy = field(candidate, 'securityPolicy')
  validateRules(field(securityPolicy, 'rules'), 'securityPolicy.rules', { allowEmpty: true })
  validateSecurityRepairRules(field(securityPolicy, 'repairRules'))

  const integrationPolicy = field(candidate, 'integrationPolicy')
  validateStringList(field(integrationPolicy, 'enabled'), 'integrationPolicy.enabled')
  validateRules(field(integrationPolicy, 'rules'), 'integrationPolicy.rules', { allowEmpty: true })

  validateStringList(
    field(field(candidate, 'trustedComposition'), 'excludedPluginIds'),
    'trustedComposition.excludedPluginIds',
  )

  validateChangeImpactPolicy(field(candidate, 'changeImpactPolicy'))
}

/** Recursively freeze a registry-owned copy so a holder cannot edit live policy. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

/** One stored registration, kept identity-tagged so a stale handle is inert. */
interface ProfileEntry {
  readonly profile: HarnessProfile
}

/**
 * Create a standalone validated profile registry.
 *
 * Independent of Cordis so profiles can be validated in a plain unit test, in a
 * build-time check, or in a tool that never starts a runtime.
 * @returns an empty registry.
 */
export function createProfileRegistry(): HarnessProfileRegistry {
  const entries = new Map<string, ProfileEntry>()

  return {
    register(profile: HarnessProfile): ProfileRegistration {
      validateProfile(profile)
      if (entries.has(profile.id)) {
        throw new ProfileValidationError('id', `profile ${JSON.stringify(profile.id)} is already registered`)
      }
      const entry: ProfileEntry = { profile: deepFreeze(structuredClone(profile)) }
      entries.set(profile.id, entry)
      return {
        dispose(): void {
          // Identity-checked: a handle disposed twice must not evict the
          // registration that replaced it under the same id.
          if (entries.get(profile.id) === entry) entries.delete(profile.id)
        },
      }
    },
    get(id: string): HarnessProfile {
      const entry = entries.get(id)
      if (entry === undefined) throw new ProfileNotFoundError(id)
      return entry.profile
    },
    list(): readonly HarnessProfile[] {
      return Object.freeze([...entries.values()].map(entry => entry.profile))
    },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    profiles: ProfileRegistry
  }
}

/** Cordis service exposing the validated profile registry as `ctx.profiles`. */
export class ProfileRegistry extends Service implements HarnessProfileRegistry {
  private readonly registry = createProfileRegistry()

  /**
   * Create and install the profile registry service.
   * @param ctx - Cordis context that owns the service.
   */
  constructor(ctx: Context) {
    super(ctx, 'profiles')
  }

  /**
   * Validate and register one profile.
   * @param profile - the candidate profile.
   * @returns a handle whose disposal unregisters exactly this registration.
   */
  register(profile: HarnessProfile): ProfileRegistration {
    return this.registry.register(profile)
  }

  /**
   * Look one profile up by id.
   * @param id - the profile id.
   * @returns the registered profile.
   */
  get(id: string): HarnessProfile {
    return this.registry.get(id)
  }

  /**
   * List every registered profile.
   * @returns the profiles, ordered by registration.
   */
  list(): readonly HarnessProfile[] {
    return this.registry.list()
  }
}
