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
    for (const side of ['when', 'use'] as const) {
      const table = field(rule, side)
      if (typeof table !== 'object' || table === null || Array.isArray(table)) {
        throw new ProfileValidationError(`${path}[${index}].${side}`, 'must be a flat object')
      }
    }
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
 * Validate a candidate profile against the contract.
 * @param candidate - the value to check; may be any shape.
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
  validateRules(field(field(candidate, 'securityPolicy'), 'rules'), 'securityPolicy.rules', { allowEmpty: true })

  const integrationPolicy = field(candidate, 'integrationPolicy')
  validateStringList(field(integrationPolicy, 'enabled'), 'integrationPolicy.enabled')
  validateRules(field(integrationPolicy, 'rules'), 'integrationPolicy.rules', { allowEmpty: true })

  validateStringList(
    field(field(candidate, 'trustedComposition'), 'excludedPluginIds'),
    'trustedComposition.excludedPluginIds',
  )
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
