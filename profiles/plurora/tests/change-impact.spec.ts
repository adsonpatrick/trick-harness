/**
 * What Plurora's own repository paths resolve to, asserted through the real
 * classifier rather than by reading the rule table back.
 *
 * The table is data. What matters is the decision a change gets held to, and
 * that decision is the composition of the path rules, the QA rows and the
 * security triggers — three files that can drift apart while each one still
 * looks correct on its own.
 */

import { describe, expect, it } from 'vitest'
import { classifyChangeImpact, mergeChangeImpact } from '@trick-harness/change-impact'
import type { Risk } from '@trick-harness/contracts'
import { pluroraProfile } from '../profile.ts'

const policy = pluroraProfile.changeImpactPolicy

/** Classify a planned set against Plurora's own policy. */
function planned(...paths: readonly string[]) {
  return classifyChangeImpact({ source: 'planned', paths, policy })
}

/** The risk a change to these paths resolves to, from an objective opened low. */
function resolvedRisk(objectiveRisk: Risk, ...paths: readonly string[]): Risk {
  return mergeChangeImpact({ objectiveRisk, planned: planned(...paths) }).effectiveRisk
}

/** Whether a changed surface triggers Plurora's blocking security review. */
function triggersSecurity(surface: string): boolean {
  return pluroraProfile.securityPolicy.rules.some(
    entry => entry.when['surface'] === surface && entry.use['blocking'] === true,
  )
}

describe('what Plurora path families mean', () => {
  it('reads database paths as the database surface at its own floor', () => {
    expect(planned('supabase/migrations/20260101_add_tenant.sql').surfaces).toStrictEqual(['database'])
    expect(planned('supabase/tests/rls.test.sql').surfaces).toStrictEqual(['database'])
    expect(planned('scripts/db/verify.ts').surfaces).toStrictEqual(['database'])
  })

  it('marks only migrations as a database mutation', () => {
    // A test file and a helper script read the database; a migration changes
    // it. Only the last one needs a preview branch before a person merges.
    expect(planned('supabase/migrations/20260101_add_tenant.sql').databaseMutation).toBe(true)
    expect(planned('supabase/tests/rls.test.sql').databaseMutation).toBe(false)
    expect(planned('scripts/db/verify.ts').databaseMutation).toBe(false)
  })

  it('reads every auth path family as the auth surface', () => {
    for (const path of ['src/lib/auth/session.ts', 'src/features/auth/login.tsx', 'src/features/admin-auth/panel.tsx', 'src/proxy.ts']) {
      expect(planned(path).surfaces, path).toContain('auth')
    }
  })

  it('keeps auth when a path is also ordinary application UI', () => {
    // This is the case first-match-wins would get wrong. A signup form lives
    // under `src/features/`, and losing the auth half would drop the change
    // from critical to medium and take the security trigger with it.
    const facts = planned('src/features/auth/signup-form.tsx')

    expect(facts.surfaces).toStrictEqual(['auth', 'ui'])
    expect(facts.evidenceProfiles).toStrictEqual(['auth-standard', 'ui-standard'])
    expect(facts.riskFloor).toBe('critical')
  })

  it('reads a workflow file as both a supply-chain and a delivery change', () => {
    const facts = planned('.github/workflows/ci.yml')

    expect(facts.surfaces).toStrictEqual(['dependencies', 'delivery'])
    expect(facts.matchedRuleIds).toStrictEqual(['workflow-supply-chain', 'delivery-automation'])
  })

  it('reads a lockfile as the dependency surface', () => {
    expect(planned('pnpm-lock.yaml').surfaces).toStrictEqual(['dependencies'])
    expect(planned('package.json').taskClasses).toStrictEqual(['dependency'])
  })

  it('reads design-system and application UI as one surface at one floor', () => {
    expect(planned('src/components/ui/button.tsx').surfaces).toStrictEqual(['ui'])
    expect(planned('src/app/dashboard/page.tsx').surfaces).toStrictEqual(['ui'])
    expect(planned('src/shell/nav.tsx').surfaces).toStrictEqual(['ui'])
  })

  it('claims nothing about a path no rule names', () => {
    expect(planned('README.md').matchedRuleIds).toStrictEqual([])
  })

  it('names no NeuroVia project ref, database name or product path', () => {
    // The generic packages stay generic by construction; this file is where a
    // concrete tenant would leak in first, because it is the one that talks
    // about real directories.
    expect(JSON.stringify(policy)).not.toMatch(/neurovia/i)
  })
})

describe('what those families resolve to', () => {
  it('raises a low-risk objective to critical when it touches auth', () => {
    expect(resolvedRisk('low', 'src/features/auth/signup-form.tsx')).toBe('critical')
  })

  it('raises a low-risk objective to critical when it touches migrations', () => {
    expect(resolvedRisk('low', 'supabase/migrations/20260101_add_tenant.sql')).toBe('critical')
  })

  it('leaves ordinary UI work at the medium floor its surface carries', () => {
    expect(resolvedRisk('low', 'src/app/dashboard/page.tsx')).toBe('medium')
  })

  it('raises dependency and delivery work to high', () => {
    expect(resolvedRisk('low', 'pnpm-lock.yaml')).toBe('high')
    expect(resolvedRisk('low', '.github/workflows/release.yml')).toBe('high')
  })

  it('never lowers an objective a person opened above the path floor', () => {
    expect(resolvedRisk('critical', 'README.md')).toBe('critical')
  })
})

describe('what those families require of review', () => {
  it('makes security blocking for every surface Plurora treats as sensitive', () => {
    for (const surface of ['auth', 'credentials', 'delivery', 'dependencies']) {
      expect(triggersSecurity(surface), surface).toBe(true)
    }
  })

  it('reaches those triggers from paths rather than from a caller saying so', () => {
    // The trigger is on the surface, and the surface comes from the diff. A
    // caller that declared its change low-risk still lands on the same rule.
    for (const path of ['src/proxy.ts', '.github/workflows/ci.yml', 'scripts/git/publish.ts']) {
      const surfaces = planned(path).surfaces
      expect(surfaces.some(surface => triggersSecurity(surface)), path).toBe(true)
    }
  })

  it('states a QA row for every surface the path rules can produce', () => {
    // A surface with no QA row resolves to the default unit-tests bar, which is
    // how a critical change quietly becomes an ordinary one.
    const produced = new Set(policy.rules.flatMap(entry => entry.use.surface === undefined ? [] : [entry.use.surface]))
    const covered = new Set(pluroraProfile.qaPolicy.rules.flatMap(entry => {
      const surface = entry.when['surface']
      return typeof surface === 'string' ? [surface] : []
    }))
    for (const surface of produced) expect([...covered], surface).toContain(surface)
  })

  it('requires independent QA wherever a path floor is high or critical', () => {
    const floors = new Map<string, Risk>()
    for (const entry of policy.rules) {
      if (entry.use.surface === undefined || entry.use.riskFloor === undefined) continue
      floors.set(entry.use.surface, entry.use.riskFloor)
    }
    for (const entry of pluroraProfile.qaPolicy.rules) {
      const surface = entry.when['surface']
      if (typeof surface !== 'string') continue
      const floor = floors.get(surface)
      if (floor !== 'high' && floor !== 'critical') continue
      expect(entry.use['independentReview'], surface).toBe(true)
    }
  })
})
