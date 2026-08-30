/**
 * Plurora's approved routing defaults, asserted end to end through the real
 * router rather than by reading the table back.
 *
 * The table is data; what matters is the decision it produces for a run. These
 * rows are the approved policy of section 7.6 of the design spec, and the
 * binding invariant of section 7.5 — heavy work goes to MiMo V2.5 — is asserted
 * on its own below rather than left implied by one row.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL_REGISTRY, route } from '@trick-harness/routing'
import type { RoutingPolicy } from '@trick-harness/routing'
import type { Risk, Role, RoutingContext, Workload, WriteVolume } from '@trick-harness/contracts'
import { pluroraProfile } from '../profile.ts'

const policy: RoutingPolicy = {
  policyVersion: pluroraProfile.policyVersion,
  rules: pluroraProfile.routingPolicy.rules,
  fallbackRules: pluroraProfile.routingPolicy.fallbackRules,
  registry: DEFAULT_MODEL_REGISTRY,
}

/** A routing context with every required field, for mutation per row. */
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

interface Row {
  readonly what: string
  readonly context: Partial<RoutingContext>
  readonly model: string
  readonly effort?: string
}

/** Section 7.6 of the design spec, one row per approved work type. */
const approved: readonly Row[] = [
  { what: 'routine refinement', context: { role: 'refine' }, model: 'DeepSeek V4 Flash' },
  { what: 'routine planning', context: { role: 'plan' }, model: 'DeepSeek V4 Flash' },
  { what: 'implementation small', context: { role: 'implement', workload: 'light' }, model: 'MiMo V2.5' },
  { what: 'implementation medium', context: { role: 'implement', workload: 'medium' }, model: 'MiMo V2.5' },
  { what: 'implementation heavy', context: { role: 'implement', workload: 'heavy' }, model: 'MiMo V2.5' },
  { what: 'many-file repair', context: { role: 'repair', workload: 'heavy' }, model: 'MiMo V2.5' },
  { what: 'routine independent code review', context: { role: 'review' }, model: 'GPT-5.6 Terra', effort: 'high' },
  { what: 'difficult bug diagnosis', context: { role: 'debug' }, model: 'GPT-5.6 Terra', effort: 'high' },
  { what: 'high-risk architecture review', context: { role: 'review', risk: 'high' }, model: 'GPT-5.6 Sol', effort: 'xhigh' },
  { what: 'security-sensitive review', context: { role: 'security' }, model: 'GPT-5.6 Sol', effort: 'xhigh' },
  { what: 'critical auth and tenant isolation', context: { role: 'review', risk: 'critical' }, model: 'GPT-5.6 Sol', effort: 'xhigh' },
  { what: 'QA charter analysis', context: { role: 'qa' }, model: 'GPT-5.6 Terra', effort: 'high' },
  { what: 'QA execution volume', context: { role: 'qa', workload: 'heavy' }, model: 'MiMo V2.5' },
]

describe('the approved Plurora routing defaults', () => {
  for (const row of approved) {
    it(`routes ${row.what}`, () => {
      const decision = route(context(row.context), policy)
      expect(decision.resolvedModel).toBe(row.model)
      expect(decision.reasoningEffort).toBe(row.effort)
      expect(decision.policyVersion).toBe('plurora-v2.0.0')
      expect(decision.reasonCodes.length).toBeGreaterThan(0)
    })
  }

  it('reserves the frontier tier for risk and security rather than spending it routinely', () => {
    expect(route(context({ role: 'review' }), policy).semanticModelTier).toBe('codex.balanced')
    expect(route(context({ role: 'implement' }), policy).semanticModelTier).toBe('opencode.workhorse')
  })

  it('never routes a routine run at the maximum effort tier', () => {
    // `max` is an escalation, not a default; no approved row may reach it.
    for (const row of approved) {
      expect(route(context(row.context), policy).reasoningEffort, row.what).not.toBe('max')
    }
  })
})

describe('the binding heavy-work invariant', () => {
  const heavy: readonly { readonly what: string; readonly context: Partial<RoutingContext> }[] = [
    { what: 'broad implementation', context: { role: 'implement', workload: 'heavy' } },
    { what: 'a large write surface', context: { role: 'implement', writeVolume: 'large' } },
    { what: 'a broad approved refactor', context: { role: 'implement', workload: 'heavy', writeVolume: 'large' } },
    { what: 'high-volume test repair', context: { role: 'repair', workload: 'heavy', writeVolume: 'large' } },
    { what: 'a long repair sequence', context: { role: 'repair', priorAttempts: 2 } },
    { what: 'QA execution volume', context: { role: 'qa', workload: 'heavy' } },
  ]

  for (const row of heavy) {
    it(`sends ${row.what} to MiMo V2.5`, () => {
      // Section 7.5 is binding for this profile: heavy work routes to the
      // workhorse. Spending a frontier reasoning model on mechanical volume
      // buys nothing and takes the budget the hard reviews need.
      const decision = route(context(row.context), policy)
      expect(decision.resolvedModel).toBe('MiMo V2.5')
      expect(decision.executor).toBe('opencode')
    })
  }

  it('yields only to an explicit human override for that one run', () => {
    const overridden = context({
      role: 'implement',
      workload: 'heavy',
      userOverride: { executor: 'codex', semanticModelTier: 'codex.frontier' },
    })
    expect(route(overridden, policy).resolvedModel).toBe('GPT-5.6 Sol')
    expect(route(context({ role: 'implement', workload: 'heavy' }), policy).resolvedModel).toBe('MiMo V2.5')
  })
})

describe('independence under the approved table', () => {
  it('moves a required cross-executor review off the implementer', () => {
    const decision = route(
      context({
        role: 'review',
        risk: 'high',
        independenceRequirement: pluroraProfile.independencePolicy.high,
        implementationExecutor: 'codex',
      }),
      policy,
    )
    expect(decision.executor).toBe('opencode')
    expect(decision.reasonCodes).toContain('independence:cross-executor-required')
  })

  it('leaves the frontier review in place when MiMo did the implementation', () => {
    const decision = route(
      context({
        role: 'review',
        risk: 'critical',
        independenceRequirement: pluroraProfile.independencePolicy.critical,
        implementationExecutor: 'opencode',
      }),
      policy,
    )
    expect(decision.resolvedModel).toBe('GPT-5.6 Sol')
    expect(decision.reasonCodes).not.toContain('independence:unsatisfied')
  })

  it('routes every role the vocabulary declares, so no stage is unroutable', () => {
    const roles: readonly Role[] = [
      'refine', 'plan', 'implement', 'debug', 'repair', 'verify', 'review', 'security', 'qa', 'delivery',
      'conformance',
    ]
    const risks: readonly Risk[] = ['low', 'medium', 'high', 'critical']
    const workloads: readonly Workload[] = ['light', 'medium', 'heavy']
    const volumes: readonly WriteVolume[] = ['none', 'small', 'medium', 'large']
    for (const role of roles) {
      for (const risk of risks) {
        for (const workload of workloads) {
          for (const writeVolume of volumes) {
            expect(() => route(context({ role, risk, workload, writeVolume }), policy), `${role}/${risk}`)
              .not.toThrow()
          }
        }
      }
    }
  })
})

describe('conformance routing under the approved table', () => {
  const byRisk: readonly { readonly risk: Risk; readonly model: string; readonly effort: string }[] = [
    { risk: 'low', model: 'GPT-5.6 Terra', effort: 'high' },
    { risk: 'medium', model: 'GPT-5.6 Terra', effort: 'high' },
    { risk: 'high', model: 'GPT-5.6 Sol', effort: 'xhigh' },
    { risk: 'critical', model: 'GPT-5.6 Sol', effort: 'xhigh' },
  ]

  for (const row of byRisk) {
    it(`reads ${row.risk}-risk conformance on ${row.model}`, () => {
      // Conformance is the last thing that can stop a branch reaching a human,
      // so it is priced like the review it stands beside rather than like the
      // implementation it judges.
      const decision = route(context({ role: 'conformance', risk: row.risk }), policy)
      expect(decision.resolvedModel).toBe(row.model)
      expect(decision.reasoningEffort).toBe(row.effort)
    })
  }

  it('never sends conformance to the executor that writes the code', () => {
    // The whole gate is a second opinion. A row that let the workhorse answer
    // it would have the implementation grading itself.
    for (const row of byRisk) {
      expect(route(context({ role: 'conformance', risk: row.risk }), policy).executor).toBe('codex')
    }
  })

  it('still answers conformance when Codex is unavailable, at a stated cost', () => {
    const decision = route(context({ role: 'conformance', degradedExecutors: ['codex'] }), policy)
    expect(decision.executor).toBe('opencode')
    expect(decision.semanticModelTier).toBe('opencode.reasoning-fast')
  })

  it('cannot claim independent conformance when the fallback lands on the implementer', () => {
    // High risk requires a different executor from the one that wrote the code.
    // With Codex down the fallback is OpenCode, which is where the
    // implementation ran, so the run must say the requirement went unmet rather
    // than pass a reading that is not independent of the work it judges.
    for (const risk of ['high', 'critical'] as const) {
      const decision = route(
        context({
          role: 'conformance',
          risk,
          independenceRequirement: pluroraProfile.independencePolicy[risk],
          implementationExecutor: 'opencode',
          degradedExecutors: ['codex'],
        }),
        policy,
      )
      expect(decision.executor, risk).toBe('opencode')
      expect(decision.reasonCodes, risk).toContain('independence:unsatisfied')
    }
  })

  it('is independent when Codex is up, whichever executor implemented', () => {
    const decision = route(
      context({
        role: 'conformance',
        risk: 'critical',
        independenceRequirement: pluroraProfile.independencePolicy.critical,
        implementationExecutor: 'opencode',
      }),
      policy,
    )
    expect(decision.executor).toBe('codex')
    expect(decision.reasonCodes).not.toContain('independence:unsatisfied')
  })
})

describe('routing a change classified from its own paths', () => {
  it('keeps a classified large write on the workhorse whatever the change is about', () => {
    // What a stage is for outranks what it is about. A large auth
    // implementation is still an implementation, and a task-class row sitting
    // above the volume rows would send it to the reviewing executor — which is
    // exactly the fall-through the table's ordering exists to prevent.
    for (const taskClass of ['auth-change', 'refactor', 'test-generation', 'ui-change']) {
      const decision = route(context({ role: 'implement', writeVolume: 'large', taskClass }), policy)
      expect(decision.resolvedModel, taskClass).toBe('MiMo V2.5')
      expect(decision.executor, taskClass).toBe('opencode')
    }
  })

  it('keeps heavy classified work on the workhorse at every risk the paths can raise it to', () => {
    for (const risk of ['low', 'medium', 'high', 'critical'] as const) {
      const decision = route(context({ role: 'implement', workload: 'heavy', risk }), policy)
      expect(decision.resolvedModel, risk).toBe('MiMo V2.5')
    }
  })

  it('routes a capability-carrying change on the same explainable reasons', () => {
    // The capability the classifier attached travels with the context; it does
    // not silently become a routing fact, and the decision stays traceable to
    // one named rule and one named tier.
    const decision = route(
      context({ role: 'implement', risk: 'critical', requiredCapabilities: ['database-verification'] }),
      policy,
    )

    expect(decision.reasonCodes.some(code => code.startsWith('rule:'))).toBe(true)
    expect(decision.reasonCodes.some(code => code.startsWith('tier:'))).toBe(true)
    expect(decision.resolvedModel).toBe('MiMo V2.5')
  })
})
