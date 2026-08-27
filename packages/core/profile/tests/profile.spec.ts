/** Validation and registration rules for the generic project-policy seam. */

import { describe, expect, it } from 'vitest'
import {
  createProfileRegistry,
  ProfileValidationError,
  validateProfile,
} from '../src/index.ts'
import type { HarnessProfile } from '../src/types.ts'

/** A minimal profile that satisfies every rule, used as the mutation base. */
const valid: HarnessProfile = {
  id: 'fixture-minimal',
  policyVersion: 'fixture-v1.0.0',
  routingPolicy: {
    rules: [{ id: 'default', when: {}, use: { executor: 'fixture' } }],
    fallbackRules: [],
  },
  workflowPolicy: { maxRepairCycles: 1, maxExecutorStarts: 2 },
  independencePolicy: {
    low: 'fresh-context',
    medium: 'cross-executor-preferred',
    high: 'cross-executor-required',
    critical: 'cross-executor-required',
  },
  qaPolicy: { rules: [] },
  securityPolicy: { rules: [] },
  integrationPolicy: { enabled: [], rules: [] },
  trustedComposition: { excludedPluginIds: [] },
}

/** Drop one key from the profile without widening its type at the call site. */
function without(key: keyof HarnessProfile): unknown {
  const { [key]: _removed, ...rest } = valid
  return rest
}

/** Thunk one validation call so `expect(...).toThrow()` gets a statement body. */
const check = (candidate: unknown) => (): void => { validateProfile(candidate) }

describe('validateProfile', () => {
  it('accepts a complete profile', () => {
    expect(check(valid)).not.toThrow()
  })

  it.each(['', '   ', 'Plurora', 'has space', '-leading'])(
    'rejects the invalid profile id %o',
    (id) => {
      expect(check({ ...valid, id })).toThrow(ProfileValidationError)
    },
  )

  it.each(['', 'v1.0.0', 'plurora-2.0.0', 'plurora-v2.0', 'plurora-vX.Y.Z'])(
    'rejects the invalid policy version %o',
    (policyVersion) => {
      expect(check({ ...valid, policyVersion })).toThrow(ProfileValidationError)
    },
  )

  it('accepts the approved Plurora policy version format', () => {
    expect(check({ ...valid, id: 'plurora', policyVersion: 'plurora-v2.0.0' }))
      .not.toThrow()
  })

  it.each([
    'routingPolicy',
    'workflowPolicy',
    'independencePolicy',
    'qaPolicy',
    'securityPolicy',
    'integrationPolicy',
    'trustedComposition',
  ] as const)('rejects a profile missing the %s block', (block) => {
    expect(check(without(block))).toThrow(ProfileValidationError)
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects maxRepairCycles %o', (maxRepairCycles) => {
    expect(check({
      ...valid,
      workflowPolicy: { ...valid.workflowPolicy, maxRepairCycles },
    })).toThrow(ProfileValidationError)
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects maxExecutorStarts %o', (maxExecutorStarts) => {
    expect(check({
      ...valid,
      workflowPolicy: { ...valid.workflowPolicy, maxExecutorStarts },
    })).toThrow(ProfileValidationError)
  })

  it('rejects an absent trusted-composition exclusion list', () => {
    expect(check({ ...valid, trustedComposition: {} }))
      .toThrow(ProfileValidationError)
  })

  it('accepts an empty but present exclusion list', () => {
    expect(check({
      ...valid,
      trustedComposition: { excludedPluginIds: [] },
    })).not.toThrow()
  })

  it('rejects a routing policy with no rules', () => {
    expect(check({
      ...valid,
      routingPolicy: { rules: [], fallbackRules: [] },
    })).toThrow(ProfileValidationError)
  })

  it('rejects duplicate rule ids within one list', () => {
    expect(check({
      ...valid,
      routingPolicy: {
        rules: [
          { id: 'default', when: {}, use: { executor: 'a' } },
          { id: 'default', when: {}, use: { executor: 'b' } },
        ],
        fallbackRules: [],
      },
    })).toThrow(ProfileValidationError)
  })

  it('rejects an independence policy that weakens high-risk review', () => {
    expect(check({
      ...valid,
      independencePolicy: { ...valid.independencePolicy, high: 'fresh-context' },
    })).toThrow(ProfileValidationError)
  })

  it('names the offending field in the failure message', () => {
    expect(check({ ...valid, policyVersion: 'nope' }))
      .toThrow(/policyVersion/)
  })
})

describe('createProfileRegistry', () => {
  it('registers and looks a profile up by id', () => {
    const registry = createProfileRegistry()
    registry.register(valid)
    expect(registry.get('fixture-minimal')).toEqual(valid)
  })

  it('validates on registration rather than on lookup', () => {
    const registry = createProfileRegistry()
    expect(() => registry.register({ ...valid, id: '' })).toThrow(ProfileValidationError)
    expect(registry.list()).toEqual([])
  })

  it('rejects a duplicate profile id', () => {
    const registry = createProfileRegistry()
    registry.register(valid)
    expect(() => registry.register({ ...valid, policyVersion: 'fixture-v2.0.0' }))
      .toThrow(ProfileValidationError)
  })

  it('throws a named error for an unknown id', () => {
    const registry = createProfileRegistry()
    expect(() => registry.get('absent')).toThrow(/absent/)
  })

  it('frees the id when a registration is disposed', () => {
    const registry = createProfileRegistry()
    const registration = registry.register(valid)
    registration.dispose()
    expect(registry.list()).toEqual([])
    expect(() => registry.register(valid)).not.toThrow()
  })

  it('tolerates a repeated dispose without dropping a later registration', () => {
    const registry = createProfileRegistry()
    const registration = registry.register(valid)
    registration.dispose()
    registry.register(valid)
    registration.dispose()
    expect(registry.list()).toHaveLength(1)
  })

  it('lists profiles in registration order', () => {
    const registry = createProfileRegistry()
    registry.register(valid)
    registry.register({ ...valid, id: 'plurora', policyVersion: 'plurora-v2.0.0' })
    expect(registry.list().map(profile => profile.id)).toEqual(['fixture-minimal', 'plurora'])
  })

  it('returns a list that cannot mutate registry state', () => {
    const registry = createProfileRegistry()
    registry.register(valid)
    const listed = registry.list() as HarnessProfile[]
    expect(() => listed.push(valid)).toThrow()
    expect(registry.list()).toHaveLength(1)
  })

  it('returns a frozen profile from lookup', () => {
    const registry = createProfileRegistry()
    registry.register(valid)
    const found = registry.get('fixture-minimal') as { id: string }
    expect(() => { found.id = 'mutated' }).toThrow()
    expect(registry.get('fixture-minimal').id).toBe('fixture-minimal')
  })

  it('keeps two registries independent', () => {
    const first = createProfileRegistry()
    const second = createProfileRegistry()
    first.register(valid)
    expect(second.list()).toEqual([])
  })
})
