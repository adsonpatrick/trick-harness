/** Plurora profile contract conformance and the policy decisions that must not drift. */

import { describe, expect, it } from 'vitest'
import { createProfileRegistry, validateProfile } from '@trick-harness/profile'
import { pluroraProfile } from '../profile.ts'

/** Find one rule by id in a list, failing the test rather than returning undefined. */
function rule(rules: readonly { id: string }[], id: string): Record<string, unknown> {
  const found = rules.find(entry => entry.id === id)
  expect(found, `missing rule ${id}`).toBeDefined()
  return (found as unknown as { use: Record<string, unknown> }).use
}

describe('plurora profile', () => {
  it('satisfies the profile contract', () => {
    expect(() => validateProfile(pluroraProfile)).not.toThrow()
  })

  it('registers under its declared identity', () => {
    const registry = createProfileRegistry()
    registry.register(pluroraProfile)
    expect(registry.get('plurora').policyVersion).toBe('plurora-v2.0.0')
  })

  it('bounds remediation and executor starts', () => {
    expect(pluroraProfile.workflowPolicy).toEqual({ maxRepairCycles: 3, maxExecutorStarts: 24 })
  })

  it('requires cross-executor review for high and critical risk', () => {
    expect(pluroraProfile.independencePolicy.high).toBe('cross-executor-required')
    expect(pluroraProfile.independencePolicy.critical).toBe('cross-executor-required')
  })

  it('ends the routing table with a catch-all so no request is unroutable', () => {
    const { rules } = pluroraProfile.routingPolicy
    expect(rules.at(-1)?.id).toBe('default')
    expect(rules.at(-1)?.when).toEqual({})
  })

  it('places no catch-all before the default route', () => {
    const { rules } = pluroraProfile.routingPolicy
    for (const entry of rules.slice(0, -1)) {
      expect(Object.keys(entry.when).length, `rule ${entry.id} matches everything`).toBeGreaterThan(0)
    }
  })

  it('falls back across executors rather than retrying the failed one', () => {
    for (const entry of pluroraProfile.routingPolicy.fallbackRules) {
      expect(entry.use.executor).not.toBe(entry.when.unavailable)
    }
  })

  it('names only tiers the semantic model registry resolves', () => {
    const tiers = new Set([
      'codex.fast',
      'codex.balanced',
      'codex.frontier',
      'opencode.reasoning-fast',
      'opencode.workhorse',
    ])
    const routes = [...pluroraProfile.routingPolicy.rules, ...pluroraProfile.routingPolicy.fallbackRules]
    for (const entry of routes) expect(tiers).toContain(entry.use.tier)
  })

  it('names no literal model id, so a model generation change stays a core edit', () => {
    const routes = [...pluroraProfile.routingPolicy.rules, ...pluroraProfile.routingPolicy.fallbackRules]
    for (const entry of routes) {
      expect(JSON.stringify(entry.use)).not.toMatch(/GPT-|DeepSeek|MiMo/i)
    }
  })

  it('requires independent review for every critical and high risk QA rule', () => {
    for (const entry of pluroraProfile.qaPolicy.rules) {
      if (entry.use.risk !== 'critical' && entry.use.risk !== 'high') continue
      expect(entry.use.independentReview, `rule ${entry.id}`).toBe(true)
    }
  })

  it('routes database work to preview-branch evidence', () => {
    expect(rule(pluroraProfile.qaPolicy.rules, 'database-migration')).toMatchObject({
      evidence: 'preview-branch-migration',
      risk: 'critical',
    })
  })

  it('makes every security trigger blocking', () => {
    expect(pluroraProfile.securityPolicy.rules.length).toBeGreaterThan(0)
    for (const entry of pluroraProfile.securityPolicy.rules) {
      expect(entry.use.blocking, `rule ${entry.id}`).toBe(true)
    }
  })

  it('withholds every destructive delivery capability from automation', () => {
    expect(rule(pluroraProfile.integrationPolicy.rules, 'github-delivery')).toMatchObject({
      allowForcePush: false,
      allowHistoryRewrite: false,
      allowDefaultBranchPush: false,
      allowMerge: false,
      allowRelease: false,
    })
  })

  it('keeps database execution cloud-only with no fallback path', () => {
    expect(rule(pluroraProfile.integrationPolicy.rules, 'supabase-preview')).toMatchObject({
      execution: 'cloud-only',
      allowLocalFallback: false,
      allowSharedDevFallback: false,
    })
  })

  it('declares a rule for every enabled integration', () => {
    const ruled = new Set(pluroraProfile.integrationPolicy.rules.map(entry => String(entry.when.integration)))
    for (const enabled of pluroraProfile.integrationPolicy.enabled) expect(ruled).toContain(enabled)
  })

  it('excludes self-modifying plugins from the trusted composition', () => {
    expect(pluroraProfile.trustedComposition.excludedPluginIds).toContain('model-authored-runtime-plugin')
    expect(pluroraProfile.trustedComposition.excludedPluginIds).toContain('self-modifying-workflow-plugin')
  })
})
