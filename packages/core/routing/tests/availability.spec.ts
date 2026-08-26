import { describe, expect, it } from 'vitest'

import type { RouteDecision, RoutingContext, WorkflowVerdict } from '@trick-harness/contracts'
import {
  AVAILABILITY_FAILURES,
  DEFAULT_CIRCUIT_POLICY,
  DEFAULT_MODEL_REGISTRY,
  QUALITY_FAILURES,
  RoutingError,
  capVerdict,
  classifyFailure,
  degradedExecutors,
  isAvailabilityFailure,
  openCircuit,
  recordFailure,
  recordSuccess,
  refreshCircuit,
  route,
  tryProbe,
} from '../src/index.ts'
import type { CircuitPolicy, PolicyRule, RoutingPolicy } from '../src/index.ts'

const rules: readonly PolicyRule[] = [
  { id: 'review', when: { role: 'review' }, use: { executor: 'codex', tier: 'codex.balanced', effort: 'high' } },
  { id: 'security', when: { role: 'security' }, use: { executor: 'codex', tier: 'codex.frontier', effort: 'xhigh' } },
  { id: 'implement', when: { role: 'implement' }, use: { executor: 'codex', tier: 'codex.balanced' } },
  { id: 'default', when: {}, use: { executor: 'codex', tier: 'codex.fast' } },
]

const policy: RoutingPolicy = {
  policyVersion: 'test-v1.0.0',
  rules,
  fallbackRules: [
    {
      id: 'codex-out-judging',
      when: { unavailable: 'codex', role: 'review' },
      use: { executor: 'opencode', tier: 'opencode.reasoning-fast' },
    },
    { id: 'codex-out', when: { unavailable: 'codex' }, use: { executor: 'opencode', tier: 'opencode.workhorse' } },
  ],
  registry: DEFAULT_MODEL_REGISTRY,
}

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

describe('telling an outage apart from a wrong answer', () => {
  it('treats quota, rate, capacity and transient infra as availability', () => {
    for (const failure of AVAILABILITY_FAILURES) {
      expect(classifyFailure(failure), failure).toBe('availability')
      expect(isAvailabilityFailure(failure), failure).toBe(true)
    }
    expect(AVAILABILITY_FAILURES).toContain('usage-limit-exceeded')
  })

  it('treats a turn that happened and went wrong as quality, never as an outage', () => {
    // Routing around these would retry the same task on a second product and
    // then report the second opinion as a recovery.
    for (const failure of QUALITY_FAILURES) {
      expect(classifyFailure(failure), failure).toBe('quality')
      expect(isAvailabilityFailure(failure), failure).toBe(false)
    }
    expect(QUALITY_FAILURES).toEqual(expect.arrayContaining([
      'context-window-exceeded',
      'bad-request',
      'sandbox-denied',
      'cyber-policy-refusal',
      'wrong-answer',
      'failed-verification',
    ]))
  })

  it('refuses a category it was never told about rather than defaulting either way', () => {
    expect(() => classifyFailure('weird-thing')).toThrow(RoutingError)
    expect(() => classifyFailure('weird-thing')).toThrow(expect.objectContaining({ code: 'unknown-failure' }))
  })

  it('classifies the same category the same way every time', () => {
    expect(classifyFailure('server-overloaded')).toBe(classifyFailure('server-overloaded'))
  })
})

describe('the executor circuit breaker', () => {
  const at = 1_000_000
  const strict: CircuitPolicy = { cooldownMs: 1_000, maxProbes: 1 }

  it('starts available with no probes spent', () => {
    expect(openCircuit('codex', at)).toStrictEqual({ executor: 'codex', state: 'AVAILABLE', since: at, probes: 0 })
  })

  it('degrades on an availability failure and says which one, once', () => {
    const first = recordFailure(openCircuit('codex', at), 'usage-limit-exceeded', at + 5)
    expect(first.circuit.state).toBe('DEGRADED')
    expect(first.circuit.failureClass).toBe('usage-limit-exceeded')
    expect(first.transitions).toStrictEqual([
      { executor: 'codex', from: 'AVAILABLE', to: 'DEGRADED', reason: 'failure:usage-limit-exceeded', at: at + 5 },
    ])
    // A second failure while already degraded is not a second transition: the
    // durable record would otherwise read as repeated outages.
    expect(recordFailure(first.circuit, 'server-overloaded', at + 6).transitions).toStrictEqual([])
  })

  it('does not degrade an executor for being wrong', () => {
    for (const failure of QUALITY_FAILURES) {
      const outcome = recordFailure(openCircuit('codex', at), failure, at + 5)
      expect(outcome.circuit.state, failure).toBe('AVAILABLE')
      expect(outcome.transitions, failure).toStrictEqual([])
    }
  })

  it('withholds a probe until the cooldown has passed', () => {
    const degraded = recordFailure(openCircuit('codex', at), 'transport-unavailable', at).circuit
    expect(tryProbe(degraded, strict, at + 999).allowed).toBe(false)
    const probe = tryProbe(degraded, strict, at + 1_000)
    expect(probe.allowed).toBe(true)
    expect(probe.circuit.probes).toBe(1)
  })

  it('stops probing once the budget is spent, and does not guess a reset time', () => {
    const degraded = recordFailure(openCircuit('codex', at), 'usage-limit-exceeded', at).circuit
    const spent = tryProbe(degraded, strict, at + 1_000).circuit
    const failedProbe = recordFailure(spent, 'usage-limit-exceeded', at + 1_100).circuit
    expect(tryProbe(failedProbe, strict, at + 1_000_000).allowed).toBe(false)
    expect(failedProbe.state).toBe('DEGRADED')
  })

  it('recovers only on a probe that actually succeeded', () => {
    const degraded = recordFailure(openCircuit('codex', at), 'server-overloaded', at).circuit
    const recovered = recordSuccess(degraded, at + 2_000)
    expect(recovered.circuit).toStrictEqual(openCircuit('codex', at + 2_000))
    expect(recovered.transitions).toStrictEqual([
      { executor: 'codex', from: 'DEGRADED', to: 'AVAILABLE', reason: 'probe-succeeded', at: at + 2_000 },
    ])
  })

  it('recovers on an explicit human refresh, and records that it was one', () => {
    const degraded = recordFailure(openCircuit('codex', at), 'usage-limit-exceeded', at).circuit
    const refreshed = refreshCircuit(degraded, at + 10)
    expect(refreshed.circuit.state).toBe('AVAILABLE')
    expect(refreshed.transitions[0]?.reason).toBe('manual-refresh')
    expect(refreshed.circuit.probes).toBe(0)
  })

  it('reports nothing for observations that changed nothing', () => {
    const available = openCircuit('codex', at)
    expect(recordSuccess(available, at + 1).transitions).toStrictEqual([])
    expect(refreshCircuit(available, at + 1).transitions).toStrictEqual([])
    expect(tryProbe(available, DEFAULT_CIRCUIT_POLICY, at + 1)).toStrictEqual({ allowed: true, circuit: available })
  })

  it('names the degraded executors a route should be told about', () => {
    const codex = recordFailure(openCircuit('codex', at), 'transport-unavailable', at).circuit
    expect(degradedExecutors([codex, openCircuit('opencode', at)])).toStrictEqual(['codex'])
  })
})

describe('routing around a degraded executor', () => {
  it('takes the fallback the profile authorised and says what it fell back from', () => {
    const decision = route(context({ degradedExecutors: ['codex'] }), policy)
    expect(decision.executor).toBe('opencode')
    expect(decision.fallbackFrom).toBe('codex')
    expect(decision.reasonCodes).toContain('fallback:codex')
    expect(decision.resolvedModel).toBe('MiMo V2.5')
  })

  it('leaves the primary route alone when nothing is degraded', () => {
    expect(route(context(), policy).executor).toBe('codex')
    expect(route(context(), policy).fallbackFrom).toBeUndefined()
  })

  it('prefers a reviewer that is not the executor which wrote the code', () => {
    const decision = route(
      context({
        role: 'review',
        risk: 'high',
        independenceRequirement: 'cross-executor-required',
        implementationExecutor: 'opencode',
        degradedExecutors: ['codex'],
      }),
      // Both fallback rows name opencode here, so independence cannot be
      // preserved and the run has to say so rather than quietly pass.
      policy,
    )
    expect(decision.executor).toBe('opencode')
    expect(decision.reasonCodes).toContain('independence:unsatisfied')
  })

  it('picks the fallback row that avoids the implementer when one exists', () => {
    const threeWay: RoutingPolicy = {
      ...policy,
      fallbackRules: [
        { id: 'codex-out-a', when: { unavailable: 'codex' }, use: { executor: 'opencode', tier: 'opencode.workhorse' } },
        {
          id: 'codex-out-b',
          when: { unavailable: 'codex' },
          use: { executor: 'gemini', tier: 'opencode.reasoning-fast' },
        },
      ],
    }
    const decision = route(
      context({ role: 'review', implementationExecutor: 'opencode', degradedExecutors: ['codex'] }),
      threeWay,
    )
    expect(decision.executor).toBe('gemini')
  })

  it('refuses a route rather than dispatching to an executor known to be down', () => {
    const decision = (): RouteDecision => route(context({ role: 'implement', degradedExecutors: ['codex'] }), {
      ...policy,
      fallbackRules: [],
    })
    expect(decision).toThrow(expect.objectContaining({ code: 'no-fallback' }))
  })

  it('will not fall back onto a second executor that is also degraded', () => {
    expect(() => route(context({ degradedExecutors: ['codex', 'opencode'] }), policy))
      .toThrow(expect.objectContaining({ code: 'no-fallback' }))
  })

  it('keeps a fallback route read-only for a judging role', () => {
    expect(route(context({ role: 'review', degradedExecutors: ['codex'] }), policy).permissionMode)
      .toBe('read-only')
  })
})

describe('the assurance a weakened route can support', () => {
  function decisionOn(overrides: Partial<RoutingContext>): { readonly context: RoutingContext; readonly decision: RouteDecision } {
    const input = context({ degradedExecutors: ['codex'], ...overrides })
    return { context: input, decision: route(input, policy) }
  }

  it('will not let a critical security stage pass on a fallback route', () => {
    const { context: input, decision } = decisionOn({ role: 'security', risk: 'critical' })
    expect(capVerdict('PASS', input, decision)).toBe('BLOCKED')
  })

  it('lowers a high-risk review that fell back to PARTIAL', () => {
    const { context: input, decision } = decisionOn({ role: 'review', risk: 'high' })
    expect(capVerdict('PASS', input, decision)).toBe('PARTIAL')
  })

  it('lowers a pass reached without the independence the risk called for', () => {
    const input = context({
      role: 'review',
      risk: 'critical',
      independenceRequirement: 'cross-executor-required',
      implementationExecutor: 'codex',
    })
    const decision = route(input, { ...policy, fallbackRules: [] })
    expect(decision.reasonCodes).toContain('independence:unsatisfied')
    expect(capVerdict('PASS', input, decision)).toBe('PARTIAL')
  })

  it('leaves a low-risk pass alone', () => {
    // A weaker route is only a weaker assurance where the risk asked for the
    // stronger one; capping everything would make the signal meaningless.
    const { context: input, decision } = decisionOn({ role: 'review', risk: 'low' })
    const capped: WorkflowVerdict = capVerdict('PASS', input, decision)
    expect(capped).toBe('PASS')
  })

  it('never softens a verdict the stage already reached', () => {
    const { context: input, decision } = decisionOn({ role: 'security', risk: 'critical' })
    for (const verdict of ['FAIL', 'PARTIAL', 'INCONCLUSIVE', 'BLOCKED'] as const) {
      expect(capVerdict(verdict, input, decision), verdict).toBe(verdict)
    }
  })

  it('leaves the verdict of a full-strength route untouched', () => {
    const input = context({ role: 'review', risk: 'critical' })
    expect(capVerdict('PASS', input, route(input, policy))).toBe('PASS')
  })
})
