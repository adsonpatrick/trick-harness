/** Reusable-boundary rules keeping project policy out of generic Trick Harness packages. */

import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectSourceViolations,
  forkLocalPackageGroups,
  isGenericPackageSource,
  PROJECT_POLICY_IDENTIFIERS,
} from './check-trick-boundaries.ts'

describe('generic package selection', () => {
  it.each([
    'packages/core/profile/src/index.ts',
    'packages/core/routing/src/engine.ts',
    'packages/providers/opencode/src/index.ts',
    'packages/integrations/github-delivery/src/index.ts',
    'packages/core/routing/tests/engine.spec.ts',
  ])('treats %s as a generic package source', (file) => {
    expect(isGenericPackageSource(file)).toBe(true)
  })

  it.each([
    'profiles/plurora/profile.ts',
    'profiles/plurora/tests/profile.spec.ts',
    'profiles/fixtures/minimal/profile.ts',
    'packages/session/session/src/index.ts',
    'packages/core/profile/README.md',
    'docs/trick-harness/upstream.md',
    'scripts/check-trick-boundaries.ts',
    'packages/core/profile/node_modules/dep/index.ts',
    'packages/core/profile/lib/index.js',
  ])('leaves %s outside the generic scan', (file) => {
    expect(isGenericPackageSource(file)).toBe(false)
  })
})

describe('profile import direction', () => {
  it.each([
    ["import { pluroraProfile } from 'profiles/plurora/profile.ts'", 'profiles/plurora/profile.ts'],
    ["export { pluroraProfile } from '../../../../profiles/plurora/profile.ts'", 'profiles/plurora/profile.ts'],
    ["const p = await import('../../../../profiles/fixtures/minimal/profile.ts')", 'profiles/fixtures/minimal/profile.ts'],
    ["const p = require('../../../../profiles/plurora/routing-policy.ts')", 'profiles/plurora/routing-policy.ts'],
    ["import type { X } from '../../../../profiles/plurora/qa-policy.ts'", 'profiles/plurora/qa-policy.ts'],
  ])('rejects %s', (source, resolved) => {
    expect(collectSourceViolations('packages/core/routing/src/engine.ts', source)).toEqual([
      `packages/core/routing/src/engine.ts:1: generic package must not import project policy (${resolved})`,
    ])
  })

  it('allows imports that stay within the generic layers', () => {
    const source = [
      "import type { HarnessProfile } from '@trick-harness/profile'",
      "import { registry } from '../registry.ts'",
      "import { Context } from '@deepseek-ai/cordis'",
    ].join('\n')
    expect(collectSourceViolations('packages/core/routing/src/engine.ts', source)).toEqual([])
  })

  it('does not mistake a lookalike directory for the profiles tree', () => {
    const source = "import { x } from '../profiles-fixture/data.ts'"
    expect(collectSourceViolations('packages/core/routing/src/engine.ts', source)).toEqual([])
  })

  it('reports the line each forbidden import sits on', () => {
    const source = [
      "import { ok } from '../registry.ts'",
      '',
      "import { bad } from '../../../../profiles/plurora/profile.ts'",
    ].join('\n')
    expect(collectSourceViolations('packages/core/routing/src/engine.ts', source)).toEqual([
      'packages/core/routing/src/engine.ts:3: generic package must not import project policy (profiles/plurora/profile.ts)',
    ])
  })
})

describe('project-policy identifiers', () => {
  it('names every identifier the amendment reserves', () => {
    expect([...PROJECT_POLICY_IDENTIFIERS]).toEqual([
      'adsonpatrick/neuro-via',
      'neurovia-dev',
      'uljaajwwnygopsyvwsre',
      'Notion',
      'Linear',
      'Plurora Design System',
    ])
  })

  it.each([...PROJECT_POLICY_IDENTIFIERS])('rejects %s inside a generic package', (identifier) => {
    expect(collectSourceViolations(
      'packages/integrations/github-delivery/src/index.ts',
      `const target = ${JSON.stringify(identifier)}`,
    )).toEqual([
      `packages/integrations/github-delivery/src/index.ts:1: generic package must not name project-specific identifier ${JSON.stringify(identifier)}`,
    ])
  })

  it('allows the bare project name, which provenance and profile tests legitimately use', () => {
    expect(collectSourceViolations(
      'packages/core/routing/src/engine.ts',
      '/** Route decisions are profile-driven; Plurora is one profile. */',
    )).toEqual([])
  })

  it('reports one violation per occurrence line', () => {
    const source = [
      "const repo = 'adsonpatrick/neuro-via'",
      "const branch = 'neurovia-dev'",
    ].join('\n')
    expect(collectSourceViolations('packages/core/routing/src/engine.ts', source)).toEqual([
      'packages/core/routing/src/engine.ts:1: generic package must not name project-specific identifier "adsonpatrick/neuro-via"',
      'packages/core/routing/src/engine.ts:2: generic package must not name project-specific identifier "neurovia-dev"',
    ])
  })
})

describe('the one-way arrow between generic layers', () => {
  /** The real workspace layout, so the test cannot drift from what ships. */
  const groups = forkLocalPackageGroups(resolve(import.meta.dirname, '..'))

  it('knows which group each fork-local package lives in', () => {
    expect(groups.get('@trick-harness/executor')).toBe('packages/core')
    expect(groups.get('@trick-harness/profile')).toBe('packages/core')
    expect(groups.get('@trick-harness/provider-codex')).toBe('packages/providers')
    expect(groups.get('@trick-harness/composition')).toBe('packages/composition')
  })

  it.each([
    ['packages/core/executor/src/index.ts', '@trick-harness/provider-codex', 'packages/providers'],
    ['packages/core/executor/src/index.ts', '@trick-harness/composition', 'packages/composition'],
    ['packages/providers/codex/src/index.ts', '@trick-harness/composition', 'packages/composition'],
    ['packages/integrations/x/src/index.ts', '@trick-harness/composition', 'packages/composition'],
  ])('rejects %s importing %s', (file, specifier, imported) => {
    const from = file.split('/').slice(0, 2).join('/')
    expect(collectSourceViolations(file, `import { x } from '${specifier}'`, groups)).toEqual([
      `${file}:1: ${from} must not import ${imported} (${specifier}): the dependency arrow runs one way`,
    ])
  })

  it.each([
    ['packages/providers/codex/src/index.ts', '@trick-harness/executor'],
    ['packages/providers/codex/src/config.ts', '@trick-harness/executor'],
    ['packages/composition/runtime/src/index.ts', '@trick-harness/provider-opencode'],
    ['packages/composition/runtime/src/index.ts', '@trick-harness/profile'],
    ['packages/core/executor/src/index.ts', '@trick-harness/profile'],
  ])('allows %s importing %s', (file, specifier) => {
    expect(collectSourceViolations(file, `import { x } from '${specifier}'`, groups)).toEqual([])
  })

  it('applies to a subpath specifier as well as the bare package name', () => {
    expect(collectSourceViolations(
      'packages/core/executor/src/index.ts',
      "import { x } from '@trick-harness/composition/invariant'",
      groups,
    )).toEqual([
      'packages/core/executor/src/index.ts:1: packages/core must not import packages/composition (@trick-harness/composition/invariant): the dependency arrow runs one way',
    ])
  })

  it('says nothing about upstream packages, which the fork does not layer', () => {
    expect(collectSourceViolations(
      'packages/core/executor/src/index.ts',
      "import { Context } from '@deepseek-ai/cordis'",
      groups,
    )).toEqual([])
  })
})
