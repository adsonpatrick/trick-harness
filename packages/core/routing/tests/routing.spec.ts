import { describe, expect, it } from 'vitest'

import type { RoutingContext } from '@trick-harness/contracts'
import { DEFAULT_MODEL_REGISTRY, RoutingError, route } from '../src/index.ts'
import type { PolicyRule, RoutingPolicy } from '../src/index.ts'

/** A minimal two-executor table, ordered most-specific first. */
const rules: readonly PolicyRule[] = [
  { id: 'critical-review', when: { role: 'review', risk: 'critical' }, use: { executor: 'codex', tier: 'codex.frontier', effort: 'xhigh' } },
  { id: 'review', when: { role: 'review' }, use: { executor: 'codex', tier: 'codex.balanced', effort: 'high' } },
  { id: 'implement', when: { role: 'implement' }, use: { executor: 'opencode', tier: 'opencode.workhorse' } },
  { id: 'default', when: {}, use: { executor: 'codex', tier: 'codex.fast' } },
]

const policy: RoutingPolicy = {
  policyVersion: 'test-v1.0.0',
  rules,
  fallbackRules: [
    { id: 'codex-out', when: { unavailable: 'codex' }, use: { executor: 'opencode', tier: 'opencode.reasoning-fast' } },
  ],
  registry: DEFAULT_MODEL_REGISTRY,
}

/** A routing context with every required field, for mutation per test. */
function context(overrides: Partial<RoutingContext> = {}): RoutingContext {
  return {
    role: 'implement',
    workload: 'medium',
    risk: 'low',
    writeVolume: 'medium',
    independenceRequirement: 'fresh-context',
    priorAttempts: 0,
    priorRouteFailures: [],
    degradedExecutors: [],
    requiredCapabilities: [],
    ...overrides,
  }
}

/** Replace one rule in the table, keeping the rest and their order. */
function withRule(id: string, replacement: PolicyRule): RoutingPolicy {
  return { ...policy, rules: rules.map(rule => rule.id === id ? replacement : rule) }
}

describe('routing one context through one policy', () => {
  it('is pure: the same inputs produce an identical decision every time', () => {
    const input = context({ role: 'review', risk: 'critical' })
    expect(route(input, policy)).toStrictEqual(route(input, policy))
  })

  it('applies the first matching rule rather than the most specific one it can find', () => {
    // Specificity is the profile author's ordering decision, visible in the
    // diff. A scoring pass here would route runs by a rule nobody can see.
    const shadowed: RoutingPolicy = { ...policy, rules: [rules[1] as PolicyRule, rules[0] as PolicyRule] }
    expect(route(context({ role: 'review', risk: 'critical' }), shadowed).semanticModelTier)
      .toBe('codex.balanced')
    expect(route(context({ role: 'review', risk: 'critical' }), policy).semanticModelTier)
      .toBe('codex.frontier')
  })

  it('records the policy version and a reason code for the rule and the tier', () => {
    const decision = route(context({ role: 'review' }), policy)
    expect(decision.policyVersion).toBe('test-v1.0.0')
    expect(decision.reasonCodes).toStrictEqual(['role:review', 'rule:review', 'tier:codex.balanced'])
  })

  it('resolves the semantic tier through the registry instead of naming a model', () => {
    expect(route(context({ role: 'implement' }), policy).resolvedModel).toBe('MiMo V2.5')
  })

  it('changes the resolved model when the registry changes, and nothing else', () => {
    const rebadged: RoutingPolicy = {
      ...policy,
      registry: { ...DEFAULT_MODEL_REGISTRY, 'opencode.workhorse': 'MiMo V3.0' },
    }
    const before = route(context({ role: 'implement' }), policy)
    const after = route(context({ role: 'implement' }), rebadged)
    expect(after.resolvedModel).toBe('MiMo V3.0')
    expect({ ...after, resolvedModel: before.resolvedModel }).toStrictEqual(before)
  })

  it('carries the reasoning effort a rule states, and omits it where none is stated', () => {
    expect(route(context({ role: 'review' }), policy).reasoningEffort).toBe('high')
    expect(Object.hasOwn(route(context({ role: 'implement' }), policy), 'reasoningEffort')).toBe(false)
  })

  it('falls through to the catch-all rather than failing on an unlisted role', () => {
    expect(route(context({ role: 'delivery' }), policy).semanticModelTier).toBe('codex.fast')
  })
})

describe('the authority a route grants', () => {
  it('gives a writing role workspace access and a judging role none', () => {
    expect(route(context({ role: 'implement' }), policy).permissionMode).toBe('workspace-write')
    for (const role of ['review', 'debug', 'qa', 'verify', 'security'] as const) {
      expect(route(context({ role }), policy).permissionMode, role).toBe('read-only')
    }
  })

  it('refuses a policy row that would let a judging role edit the work it judges', () => {
    const escalating = withRule('review', {
      id: 'review',
      when: { role: 'review' },
      use: { executor: 'codex', tier: 'codex.balanced', permissionMode: 'workspace-write' },
    })
    expect(() => route(context({ role: 'review' }), escalating))
      .toThrow(expect.objectContaining({ code: 'permission-escalation' }))
  })

  it('accepts a row that merely restates the mode the role already has', () => {
    const restating = withRule('implement', {
      id: 'implement',
      when: { role: 'implement' },
      use: { executor: 'opencode', tier: 'opencode.workhorse', permissionMode: 'workspace-write' },
    })
    expect(route(context(), restating).permissionMode).toBe('workspace-write')
  })
})

describe('a policy the router cannot apply', () => {
  it('rejects a rule matching on a fact nobody supplies', () => {
    // Silently never matching is the dangerous outcome: the policy would look
    // like it covered a case it did not.
    const unknown = withRule('implement', {
      id: 'implement',
      when: { phase: 'afternoon' },
      use: { executor: 'opencode', tier: 'opencode.workhorse' },
    })
    expect(() => route(context(), unknown)).toThrow(RoutingError)
    expect(() => route(context(), unknown)).toThrow(expect.objectContaining({ code: 'unknown-fact' }))
  })

  it('rejects a tier no registry serves', () => {
    const stale = withRule('implement', {
      id: 'implement',
      when: { role: 'implement' },
      use: { executor: 'opencode', tier: 'opencode.retired' },
    })
    expect(() => route(context(), stale)).toThrow(expect.objectContaining({ code: 'unknown-tier' }))
  })

  it('rejects a rule that names no executor or no tier', () => {
    for (const use of [{ tier: 'codex.fast' }, { executor: 'codex' }, { executor: '  ', tier: 'codex.fast' }]) {
      const incomplete = withRule('implement', { id: 'implement', when: { role: 'implement' }, use })
      expect(() => route(context(), incomplete)).toThrow(expect.objectContaining({ code: 'incomplete-rule' }))
    }
  })

  it('rejects a context no rule matches at all', () => {
    const narrow: RoutingPolicy = { ...policy, rules: [rules[2] as PolicyRule] }
    expect(() => route(context({ role: 'review' }), narrow))
      .toThrow(expect.objectContaining({ code: 'no-rule' }))
  })
})

describe('an explicit human override', () => {
  it('wins over the table for the run it was given for', () => {
    const decision = route(
      context({ role: 'implement', userOverride: { executor: 'codex', semanticModelTier: 'codex.frontier' } }),
      policy,
    )
    expect(decision.executor).toBe('codex')
    expect(decision.resolvedModel).toBe('GPT-5.6 Sol')
    expect(decision.reasonCodes).toContain('override:user')
  })

  it('does not survive into the next run', () => {
    const overridden = context({ userOverride: { executor: 'codex', semanticModelTier: 'codex.frontier' } })
    route(overridden, policy)
    expect(route(context(), policy).executor).toBe('opencode')
  })

  it('still resolves through the registry, so it cannot name a model nobody serves', () => {
    expect(() => route(
      context({ userOverride: { executor: 'codex', semanticModelTier: 'codex.imaginary' } }),
      policy,
    )).toThrow(expect.objectContaining({ code: 'unknown-tier' }))
  })

  it('is rejected when it names no tier or no executor', () => {
    expect(() => route(context({ userOverride: { executor: 'codex' } }), policy))
      .toThrow(expect.objectContaining({ code: 'invalid-override' }))
    expect(() => route(context({ userOverride: { executor: ' ', semanticModelTier: 'codex.fast' } }), policy))
      .toThrow(expect.objectContaining({ code: 'invalid-override' }))
  })

  it('still cannot give a judging role write authority', () => {
    const decision = route(
      context({ role: 'review', userOverride: { executor: 'opencode', semanticModelTier: 'opencode.workhorse' } }),
      policy,
    )
    expect(decision.permissionMode).toBe('read-only')
  })
})

describe('keeping a certifying stage independent of the work it certifies', () => {
  it('re-routes away from the implementer when the table offers someone else', () => {
    const decision = route(
      context({
        role: 'review',
        risk: 'high',
        independenceRequirement: 'cross-executor-required',
        implementationExecutor: 'codex',
      }),
      // Both review rows name codex, so the alternative has to come from the
      // fallback table — which is exactly the case an independence re-route is
      // for, and is different from an outage.
      policy,
    )
    expect(decision.executor).toBe('opencode')
    expect(decision.reasonCodes).toContain('independence:cross-executor-required')
  })

  it('leaves a route alone when the implementer was somebody else', () => {
    const decision = route(
      context({ role: 'review', independenceRequirement: 'cross-executor-required', implementationExecutor: 'opencode' }),
      policy,
    )
    expect(decision.executor).toBe('codex')
    expect(decision.reasonCodes).not.toContain('independence:unsatisfied')
  })

  it('does not re-route when only a fresh context was required', () => {
    const decision = route(
      context({ role: 'review', independenceRequirement: 'fresh-context', implementationExecutor: 'codex' }),
      policy,
    )
    expect(decision.executor).toBe('codex')
    expect(decision.reasonCodes).not.toContain('independence:unsatisfied')
  })

  it('records that independence went unmet rather than refusing to route', () => {
    // Refusing would turn a missing second opinion into an outage; hiding it
    // would turn one into a false PASS. The workflow decides which it is.
    const isolated: RoutingPolicy = { ...policy, fallbackRules: [] }
    const decision = route(
      context({
        role: 'review',
        independenceRequirement: 'cross-executor-required',
        implementationExecutor: 'codex',
      }),
      isolated,
    )
    expect(decision.executor).toBe('codex')
    expect(decision.reasonCodes).toContain('independence:unsatisfied')
  })
})
