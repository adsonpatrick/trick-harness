/** Experimental and fork-local package publication and dependency constraints. */

import { sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkExperimentalDependencyIsolation,
  checkExperimentalManifest,
  checkForkLocalManifest,
  checkWorkspace,
  type WorkspaceManifest,
} from './check-workspace-constraints.ts'

const experimental: WorkspaceManifest = {
  dir: 'packages/experimental/prototype',
  manifest: { name: '@deepseek-ai/dsh-experimental-prototype', private: true },
}

describe('experimental workspace constraints', () => {
  it('requires the experimental package-name prefix', () => {
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, name: '@deepseek-ai/dsh-prototype' },
    })).toEqual([
      '@deepseek-ai/dsh-prototype: experimental package name must start with "@deepseek-ai/dsh-experimental-"',
    ])
  })

  it('requires private manifests without publication metadata', () => {
    expect(checkExperimentalManifest(experimental)).toEqual([])
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, private: false, publishConfig: { access: 'public' } },
    })).toEqual([
      '@deepseek-ai/dsh-experimental-prototype: experimental package must set "private": true',
      '@deepseek-ai/dsh-experimental-prototype: experimental package must omit publishConfig',
    ])
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'rejects release %s on an experimental package',
    (section) => {
      expect(checkExperimentalDependencyIsolation([experimental, {
        dir: 'packages/core/consumer',
        manifest: {
          name: '@deepseek-ai/dsh-consumer',
          [section]: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
        },
      }])).toEqual([
        `@deepseek-ai/dsh-consumer: ${section}.@deepseek-ai/dsh-experimental-prototype must not reference an experimental package`,
      ])
    },
  )

  it('allows development and experimental consumers but rejects the Python release runtime', () => {
    const manifests: WorkspaceManifest[] = [experimental, {
      dir: 'packages/core/test-only',
      manifest: {
        name: '@deepseek-ai/dsh-test-only',
        devDependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'packages/experimental/consumer',
      manifest: {
        name: '@deepseek-ai/dsh-experimental-consumer',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'python/sdk-runtime',
      manifest: {
        name: '@deepseek-ai/dsh-python-runtime',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }]

    expect(checkExperimentalDependencyIsolation(manifests)).toEqual([
      '@deepseek-ai/dsh-python-runtime: dependencies.@deepseek-ai/dsh-experimental-prototype must not reference an experimental package',
    ])
  })
})

const forkLocal: WorkspaceManifest = {
  dir: 'packages/core/profile',
  manifest: { name: '@trick-harness/profile', private: true },
}

describe('fork-local Trick Harness workspace constraints', () => {
  it.each([
    ['packages/core/profile', '@trick-harness/profile'],
    ['packages/providers/opencode', '@trick-harness/provider-opencode'],
    ['packages/integrations/github-delivery', '@trick-harness/integration-github-delivery'],
  ])('accepts a private fork-local package at %s', (dir, name) => {
    expect(checkForkLocalManifest({ dir, manifest: { name, private: true } })).toEqual([])
  })

  it('ignores manifests outside the fork-local namespace', () => {
    expect(checkForkLocalManifest({
      dir: 'packages/core/agent',
      manifest: { name: '@deepseek-ai/dsh-agent', publishConfig: { access: 'public' } },
    })).toEqual([])
  })

  it('rejects a publishable fork-local package', () => {
    expect(checkForkLocalManifest({
      ...forkLocal,
      manifest: { ...forkLocal.manifest, private: false },
    })).toEqual([
      '@trick-harness/profile: fork-local package must set "private": true',
    ])
  })

  it('rejects fork-local publication metadata', () => {
    expect(checkForkLocalManifest({
      ...forkLocal,
      manifest: { ...forkLocal.manifest, publishConfig: { access: 'public' } },
    })).toEqual([
      '@trick-harness/profile: fork-local package must omit publishConfig',
    ])
  })

  it.each([
    'packages/experimental/profile',
    'packages/session/profile',
    'vendor/profile',
    'apps/host/nested',
  ])('rejects the fork-local namespace outside an approved directory (%s)', (dir) => {
    expect(checkForkLocalManifest({ ...forkLocal, dir })).toEqual([
      '@trick-harness/profile: fork-local package must live under packages/core, packages/providers, '
      + 'packages/integrations, packages/composition, or apps',
    ])
  })

  it('accepts a fork-local deployment app under apps', () => {
    expect(checkForkLocalManifest({ ...forkLocal, dir: 'apps/plurora-harness-host' })).toEqual([])
  })

  it('exempts fork-local packages from release-member publication rules', () => {
    expect(checkWorkspace(forkLocal)).toEqual([])
  })

  it('leaves upstream release-member rules unchanged', () => {
    // The gate prefixes each error with a platform-native path; the rules under
    // test are separator-independent, so compare on the normalized form.
    const errors = checkWorkspace({
      dir: 'packages/core/agent',
      manifest: { name: '@deepseek-ai/dsh-agent', private: true },
    }).map(error => error.split(sep).join('/'))
    expect(errors).toEqual([
      'packages/core/agent/package.json: @deepseek-ai/dsh-agent: release member must not set "private": true',
      'packages/core/agent/package.json: @deepseek-ai/dsh-agent: release member must set publishConfig.access to "public"',
      'packages/core/agent/package.json: @deepseek-ai/dsh-agent: release member repository must use git+https://github.com/deepseek-ai/deepseek-harness.git with directory packages/core/agent',
      'packages/core/agent/package.json: @deepseek-ai/dsh-agent: @deepseek-ai/cordis must be a peerDependency',
      'packages/core/agent/package.json: @deepseek-ai/dsh-agent: @deepseek-ai/cordis must also be a devDependency',
      'packages/core/agent/package.json: @deepseek-ai/dsh-agent: package.json version must match root version 0.1.1-rc.2',
      'packages/core/agent/package.json: @deepseek-ai/dsh-agent: package.json must set "type": "module"',
      'packages/core/agent/package.json: @deepseek-ai/dsh-agent: package.json must set "main": "lib/index.js"',
      'packages/core/agent/package.json: @deepseek-ai/dsh-agent: package.json must set "types": "lib/types/index.d.ts"',
      'packages/core/agent/package.json: @deepseek-ai/dsh-agent: package.json exports["."].types must be "./lib/types/index.d.ts"',
      'packages/core/agent/package.json: @deepseek-ai/dsh-agent: package.json exports["."].default must be "./lib/index.js"',
      'packages/core/agent/package.json: @deepseek-ai/dsh-agent: package.json files must be ["lib/index.js","lib/invariant.js","lib/types/**/*.d.ts"]',
    ])
  })
})
