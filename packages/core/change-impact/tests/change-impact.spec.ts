/** What a set of repository paths means for the run that touches them. */

import { describe, expect, it } from 'vitest'
import type { ChangeImpactPolicyDefinition } from '@trick-harness/profile'
import {
  ChangeImpactError,
  classifyChangeImpact,
  mergeChangeImpact,
  normalizeRepositoryPath,
} from '../src/index.ts'

/** A policy with a broad rule, a narrow one under it, and a database rule. */
const policy: ChangeImpactPolicyDefinition = {
  writeVolume: { smallMaxFiles: 3, mediumMaxFiles: 12 },
  rules: [
    {
      id: 'migrations',
      paths: ['db/migrations/**'],
      use: {
        surface: 'database',
        riskFloor: 'critical',
        requiredCapability: 'database-verification',
        evidenceProfile: 'db-standard',
        databaseMutation: true,
      },
    },
    {
      id: 'auth',
      paths: ['src/lib/auth/**', 'src/features/auth/**', 'src/proxy.ts'],
      use: { surface: 'auth', riskFloor: 'critical', taskClass: 'auth', evidenceProfile: 'auth-standard' },
    },
    {
      id: 'ui',
      paths: ['src/features/**', 'src/components/**'],
      use: { surface: 'ui', riskFloor: 'medium', evidenceProfile: 'ui-standard' },
    },
    {
      id: 'config',
      paths: ['.github/**'],
      use: { surface: 'delivery', riskFloor: 'high', evidenceProfile: 'delivery-standard' },
    },
  ],
}

/** Classify one planned set against the fixture policy. */
function planned(paths: readonly string[], approvedPlannedPaths?: readonly string[]) {
  return classifyChangeImpact({
    source: 'planned',
    paths,
    policy,
    ...approvedPlannedPaths === undefined ? {} : { approvedPlannedPaths },
  })
}

describe('normalizing a repository path', () => {
  it('reads one path as one path whatever separator wrote it', () => {
    // The planned set is read from a document written on some machine and the
    // actual set from git on another. Two spellings of one file would be two
    // paths, and the second would be scored as unplanned work.
    expect(normalizeRepositoryPath('src\\lib\\auth\\route-policy.ts')).toBe('src/lib/auth/route-policy.ts')
    expect(normalizeRepositoryPath('src//lib///auth/session.ts')).toBe('src/lib/auth/session.ts')
    expect(normalizeRepositoryPath('./src/x.ts')).toBe('src/x.ts')
    expect(normalizeRepositoryPath('src/./x.ts')).toBe('src/x.ts')
    expect(normalizeRepositoryPath('src/x.ts/')).toBe('src/x.ts')
  })

  it('leaves an already-normal path exactly as it is', () => {
    expect(normalizeRepositoryPath('supabase/migrations/0001_init.sql')).toBe('supabase/migrations/0001_init.sql')
  })

  it('refuses a path that is not repository-relative', () => {
    for (const input of ['/etc/passwd', 'C:/Users/x', 'c:\\Users\\x', '\\\\server\\share\\x']) {
      expect(() => normalizeRepositoryPath(input)).toThrow(ChangeImpactError)
    }
  })

  it('refuses a path that walks out of the repository', () => {
    for (const input of ['../secrets/keys.ts', 'src/../../etc/passwd', '..', 'src/..']) {
      expect(() => normalizeRepositoryPath(input)).toThrow(ChangeImpactError)
    }
  })

  it('refuses a path that names nothing', () => {
    for (const input of ['', '   ', '.', './']) {
      expect(() => normalizeRepositoryPath(input)).toThrow(ChangeImpactError)
    }
  })

  it('names what it refused without quoting the path', () => {
    // A refusal is journalled and a path is repository text, which is a place a
    // secret gets written by accident at least once.
    let raised: unknown
    try {
      normalizeRepositoryPath('../secrets/service-role-key.ts')
    }
    catch (error) {
      raised = error
    }

    expect(raised).toBeInstanceOf(ChangeImpactError)
    expect((raised as Error).message).not.toContain('service-role')
  })
})

describe('classifying what a change touches', () => {
  it('lets every matching rule contribute rather than stopping at the first', () => {
    // This is where classification differs from routing. A signup form is an
    // auth surface and a UI surface at once, and first-match-wins would drop
    // whichever the policy happened to list second.
    const facts = planned(['src/features/auth/signup-form.tsx'])

    expect(facts.matchedRuleIds).toStrictEqual(['auth', 'ui'])
    expect(facts.surfaces).toStrictEqual(['auth', 'ui'])
    expect(facts.evidenceProfiles).toStrictEqual(['auth-standard', 'ui-standard'])
  })

  it('takes the highest risk floor any matched rule requires', () => {
    expect(planned(['src/features/auth/signup-form.tsx']).riskFloor).toBe('critical')
    expect(planned(['src/features/profile/avatar.tsx']).riskFloor).toBe('medium')
    expect(planned(['.github/workflows/ci.yml']).riskFloor).toBe('high')
  })

  it('reports a path no rule claims without inventing a floor for it', () => {
    const facts = planned(['README.md'])

    expect(facts.matchedRuleIds).toStrictEqual([])
    expect(facts.surfaces).toStrictEqual([])
    expect(facts.riskFloor).toBe('low')
    expect(facts.pathCount).toBe(1)
  })

  it('accumulates in policy order and says each thing once', () => {
    const facts = planned([
      'src/components/button.tsx',
      'src/lib/auth/session.ts',
      'src/features/auth/login.tsx',
    ])

    expect(facts.surfaces).toStrictEqual(['auth', 'ui'])
    expect(facts.taskClasses).toStrictEqual(['auth'])
    expect(facts.evidenceProfiles).toStrictEqual(['auth-standard', 'ui-standard'])
    expect(facts.matchedRuleIds).toStrictEqual(['auth', 'ui'])
  })

  it('matches dotted directories, which is where delivery policy lives', () => {
    // A matcher that skipped dotfiles by default would leave `.github/`
    // unclassified, and supply-chain changes would route as ordinary work.
    expect(planned(['.github/workflows/release.yml']).surfaces).toStrictEqual(['delivery'])
  })

  it('counts one file once however many times it was listed', () => {
    expect(planned(['src/x.ts', 'src/x.ts', 'src\\x.ts']).pathCount).toBe(1)
  })

  it('carries the database marker whenever a rule sets it', () => {
    expect(planned(['db/migrations/0001_init.sql']).databaseMutation).toBe(true)
    expect(planned(['db/migrations/0001_init.sql']).requiredCapabilities).toStrictEqual(['database-verification'])
    expect(planned(['src/components/button.tsx']).databaseMutation).toBe(false)
  })

  it('matches a whole path segment rather than a suffix of one', () => {
    // `src/lib/authority/` is not the auth library, and a rule that matched it
    // would raise unrelated work to critical for the rest of the run.
    expect(planned(['src/lib/authority/quota.ts']).surfaces).toStrictEqual([])
  })

  it('refuses to classify a path it could not read as repository-relative', () => {
    expect(() => planned(['/etc/passwd'])).toThrow(ChangeImpactError)
  })

  it('records the reading it was asked for', () => {
    expect(planned(['src/x.ts']).source).toBe('planned')
    expect(classifyChangeImpact({ source: 'actual', paths: ['src/x.ts'], policy }).source).toBe('actual')
  })

  it('returns facts a holder cannot edit', () => {
    const facts = planned(['src/lib/auth/session.ts'])

    expect(Object.isFrozen(facts)).toBe(true)
    expect(Object.isFrozen(facts.surfaces)).toBe(true)
  })
})

describe('scoring how large a change is', () => {
  it('scores nothing as nothing', () => {
    expect(planned([]).writeVolume).toBe('none')
  })

  it('scores each band at its declared bounds', () => {
    const files = (count: number): string[] => Array.from({ length: count }, (_, index) => `src/f${index}.ts`)

    expect(planned(files(1)).writeVolume).toBe('small')
    expect(planned(files(3)).writeVolume).toBe('small')
    expect(planned(files(4)).writeVolume).toBe('medium')
    expect(planned(files(12)).writeVolume).toBe('medium')
    expect(planned(files(13)).writeVolume).toBe('large')
  })
})

describe('resolving the two readings into one policy', () => {
  const objectiveRisk = 'low' as const

  it('never lets either reading lower what the other established', () => {
    // A delivered change that turned out to touch migrations is a database
    // change nobody planned, and a planned database change stays one even if
    // the diff came back small. Resolution moves in one direction only.
    const merged = mergeChangeImpact({
      objectiveRisk,
      planned: planned(['src/components/button.tsx']),
      actual: classifyChangeImpact({ source: 'actual', paths: ['db/migrations/0002_add.sql'], policy }),
    })

    expect(merged.effectiveRisk).toBe('critical')
    expect(merged.databaseMutation).toBe(true)
    // Planned first, then what delivery added to it. The resolution has no
    // policy to order by, and chronological order says something a sorted one
    // would not: which surfaces were foreseen and which were discovered.
    expect(merged.surfaces).toStrictEqual(['ui', 'database'])
    expect(merged.requiredCapabilities).toStrictEqual(['database-verification'])
  })

  it('takes the maximum write volume across both readings', () => {
    const many = Array.from({ length: 20 }, (_, index) => `src/f${index}.ts`)
    const merged = mergeChangeImpact({
      objectiveRisk,
      planned: planned(['src/x.ts']),
      actual: classifyChangeImpact({ source: 'actual', paths: many, policy }),
    })

    expect(merged.writeVolume).toBe('large')
  })

  it('never resolves below the risk the objective was opened at', () => {
    const merged = mergeChangeImpact({ objectiveRisk: 'high', planned: planned(['README.md']) })

    expect(merged.effectiveRisk).toBe('high')
  })

  it('leaves the actual reading absent until there is a branch to read', () => {
    const merged = mergeChangeImpact({ objectiveRisk, planned: planned(['src/x.ts']) })

    expect('actual' in merged).toBe(false)
    expect(merged.effectiveRisk).toBe('low')
  })

  it('names the paths the approved plan did not', () => {
    // Scope drift is the fact this whole reading exists to surface: work that
    // reached past what a person approved looks exactly like work that did
    // not, until someone subtracts one set from the other.
    const facts = classifyChangeImpact({
      source: 'actual',
      paths: ['src/lib/auth/session.ts', 'db/migrations/0003_drop.sql'],
      policy,
      approvedPlannedPaths: ['src/lib/auth/session.ts'],
    })

    expect(facts.unplannedPaths).toStrictEqual(['db/migrations/0003_drop.sql'])
  })

  it('compares the two sets after normalizing both, not as they were written', () => {
    const facts = classifyChangeImpact({
      source: 'actual',
      paths: ['src\\lib\\auth\\session.ts'],
      policy,
      approvedPlannedPaths: ['./src/lib/auth/session.ts'],
    })

    expect(facts.unplannedPaths).toStrictEqual([])
  })

  it('claims nothing about scope when no approved set was supplied', () => {
    // An empty list here would read as "every path was approved", which is the
    // opposite of what not having been told means.
    expect(planned(['src/x.ts']).unplannedPaths).toStrictEqual([])
    expect(planned(['src/x.ts'], []).unplannedPaths).toStrictEqual(['src/x.ts'])
  })

  it('returns a resolution a holder cannot edit', () => {
    const merged = mergeChangeImpact({ objectiveRisk, planned: planned(['src/x.ts']) })

    expect(Object.isFrozen(merged)).toBe(true)
    expect(Object.isFrozen(merged.surfaces)).toBe(true)
  })
})
