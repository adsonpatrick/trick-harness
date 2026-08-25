/**
 * Evidence that the Trick Harness core is genuinely reusable.
 *
 * Reuse is a claim that is easy to make and easy to lose: a core stays generic
 * only while something fails when it stops being generic. These are the checks
 * that fail. R1 — the core holds two unrelated profiles at once. R3 — no
 * generic package names a project. R4 — the dependency direction runs one way.
 */

import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createProfileRegistry, validateProfile } from '@trick-harness/profile'
import { collectBoundaryViolations } from '../../scripts/check-trick-boundaries.ts'
import { minimalProfile } from '../../profiles/fixtures/minimal/profile.ts'
import { pluroraProfile } from '../../profiles/plurora/profile.ts'

const repositoryRoot = resolve(import.meta.dirname, '../..')

describe('R1: the core serves two independent profiles', () => {
  it('validates both profiles against one unchanged contract', () => {
    expect(() => validateProfile(pluroraProfile)).not.toThrow()
    expect(() => validateProfile(minimalProfile)).not.toThrow()
  })

  it('holds both profiles in one registry at the same time', () => {
    const registry = createProfileRegistry()
    registry.register(pluroraProfile)
    registry.register(minimalProfile)
    expect(registry.list().map(profile => profile.id)).toEqual(['plurora', 'fixture-minimal'])
  })

  it('keeps the two profiles distinguishable by identity', () => {
    expect(pluroraProfile.id).not.toBe(minimalProfile.id)
    expect(pluroraProfile.policyVersion).not.toBe(minimalProfile.policyVersion)
  })

  it('returns each profile’s own policy rather than a shared default', () => {
    const registry = createProfileRegistry()
    registry.register(pluroraProfile)
    registry.register(minimalProfile)
    expect(registry.get('plurora').workflowPolicy.maxExecutorStarts).toBe(24)
    expect(registry.get('fixture-minimal').workflowPolicy.maxExecutorStarts).toBe(4)
  })

  it('lets the profiles disagree on every policy block the contract allows', () => {
    expect(pluroraProfile.routingPolicy).not.toEqual(minimalProfile.routingPolicy)
    expect(pluroraProfile.qaPolicy).not.toEqual(minimalProfile.qaPolicy)
    expect(pluroraProfile.securityPolicy).not.toEqual(minimalProfile.securityPolicy)
    expect(pluroraProfile.integrationPolicy).not.toEqual(minimalProfile.integrationPolicy)
    expect(pluroraProfile.trustedComposition).not.toEqual(minimalProfile.trustedComposition)
  })

  it('holds both profiles to the same review-independence floor', () => {
    // The one block they may not disagree on. If a future profile could relax
    // this, "reusable" would have quietly come to mean "weakenable".
    expect(pluroraProfile.independencePolicy).toEqual(minimalProfile.independencePolicy)
  })

  it('keeps one profile’s disposal from disturbing the other', () => {
    const registry = createProfileRegistry()
    const plurora = registry.register(pluroraProfile)
    registry.register(minimalProfile)
    plurora.dispose()
    expect(registry.list().map(profile => profile.id)).toEqual(['fixture-minimal'])
    expect(registry.get('fixture-minimal')).toEqual(minimalProfile)
  })
})

describe('R3 and R4: generic packages carry no project policy', () => {
  it('reports no boundary violation across the whole repository', () => {
    expect(collectBoundaryViolations(repositoryRoot)).toEqual([])
  })
})
