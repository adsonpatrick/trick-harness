/** The minimal fixture profile stays valid and stays minimal. */

import { describe, expect, it } from 'vitest'
import { createProfileRegistry, validateProfile } from '@trick-harness/profile'
import { minimalProfile } from '../profile.ts'

describe('minimal fixture profile', () => {
  it('satisfies the profile contract', () => {
    expect(() => validateProfile(minimalProfile)).not.toThrow()
  })

  it('registers under its declared identity', () => {
    const registry = createProfileRegistry()
    registry.register(minimalProfile)
    expect(registry.get('fixture-minimal').policyVersion).toBe('fixture-v1.0.0')
  })

  it('enables no integration, so it needs no project credentials to be useful', () => {
    expect(minimalProfile.integrationPolicy.enabled).toEqual([])
    expect(minimalProfile.integrationPolicy.rules).toEqual([])
  })

  it('stays minimal: one routing rule and no fallbacks', () => {
    expect(minimalProfile.routingPolicy.rules).toHaveLength(1)
    expect(minimalProfile.routingPolicy.fallbackRules).toEqual([])
  })

  it('cannot weaken review independence below the contract', () => {
    expect(minimalProfile.independencePolicy.high).toBe('cross-executor-required')
    expect(minimalProfile.independencePolicy.critical).toBe('cross-executor-required')
  })
})
