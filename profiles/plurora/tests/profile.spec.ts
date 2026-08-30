/** Plurora profile contract conformance and the policy decisions that must not drift. */

import { describe, expect, it } from 'vitest'
import type { RoutingContext } from '@trick-harness/contracts'
import { createProfileRegistry, validateProfile } from '@trick-harness/profile'
import { DEFAULT_MODEL_REGISTRY, RoutingError, route } from '@trick-harness/routing'
import { pluroraDodObligations, pluroraProfile } from '../profile.ts'

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

  it('authorizes no security defect for automatic repair', () => {
    expect(pluroraProfile.securityPolicy.repairRules).toEqual([])
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

  it('certifies through a capability that can do nothing but publish a status', () => {
    // The capability a branch-protection rule waits on is the last thing
    // between an automated run and a merge button. The policy says so in the
    // only way that survives a reader who skips the prose: every mutation that
    // is not publishing a status is named and denied.
    expect(rule(pluroraProfile.integrationPolicy.rules, 'github-certification')).toMatchObject({
      publishes: 'commit-status',
      target: 'pull-request-head',
      required: 'before-pull-request-ready',
      allowCommit: false,
      allowPush: false,
      allowPullRequestEdit: false,
      allowMerge: false,
      allowRelease: false,
      allowDeploy: false,
    })
  })

  it('leaves the status context to the deployment, since a rule is configured by its exact name', () => {
    // A context written here is one a run could satisfy by publishing under a
    // name no branch-protection rule is watching, and one no reviewer reading
    // the pull request could tell apart from the name that was configured.
    expect(JSON.stringify(pluroraProfile)).not.toContain('plurora/harness-certification')
    expect(rule(pluroraProfile.integrationPolicy.rules, 'github-certification'))
      .toMatchObject({ contextSource: 'deployment' })
  })

  it('keeps database execution cloud-only with no fallback path', () => {
    expect(rule(pluroraProfile.integrationPolicy.rules, 'supabase-preview')).toMatchObject({
      execution: 'cloud-only',
      allowLocalFallback: false,
      allowSharedDevFallback: false,
    })
  })

  it('names its capabilities in the vocabulary the composition consumes', () => {
    // Two files disagreeing about what a capability is called is not a naming
    // quibble: the composition refuses an integration the profile does not
    // enable, so a profile that spells it differently turns on nothing and
    // says nothing about having done so.
    expect([...pluroraProfile.integrationPolicy.enabled]).toStrictEqual([
      'github-delivery',
      'github-certification',
      'supabase-preview',
      'database-verification',
      'control-server',
      'notion-knowledge',
      'linear-issues',
    ])
    expect(JSON.stringify(pluroraProfile.integrationPolicy)).not.toContain('supabase-preview-branches')
  })

  // The profile states which strategies are authorised. Which database any of
  // them reaches is a deployment fact: a ref written down here is one every
  // reader of the repository can point a migration at, and one no reviewer can
  // tell apart from the ref the running deployment actually used.
  it('names no database and no project ref anywhere in its policy data', () => {
    const policy = JSON.stringify(pluroraProfile)
    expect(policy).not.toContain('neurovia-dev')
    expect(policy).not.toContain('uljaajwwnygopsyvwsre')
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

/**
 * Build a routing context, overriding whichever facts a case is about.
 * @param overrides - the facts this case varies.
 * @returns the context, with nothing implemented yet and nothing degraded.
 */
function context(overrides: Partial<RoutingContext> = {}): RoutingContext {
  return {
    role: 'implement',
    workload: 'medium',
    risk: 'medium',
    writeVolume: 'small',
    independenceRequirement: 'none',
    priorAttempts: 0,
    priorRouteFailures: [],
    degradedExecutors: [],
    requiredCapabilities: [],
    ...overrides,
  }
}

const policy = {
  policyVersion: pluroraProfile.policyVersion,
  rules: pluroraProfile.routingPolicy.rules,
  fallbackRules: pluroraProfile.routingPolicy.fallbackRules,
  registry: DEFAULT_MODEL_REGISTRY,
}

/** What one routed run got, reduced to the three facts the matrix is about. */
interface RoutedTier {
  readonly executor: string
  readonly tier: string
  readonly effort: string | undefined
}

/**
 * Route one context through Plurora's own table.
 * @param overrides - the facts this case varies.
 * @returns the executor, tier and effort the table produced.
 */
function routed(overrides: Partial<RoutingContext> = {}): RoutedTier {
  const decision = route(context(overrides), policy)
  return {
    executor: decision.executor,
    tier: decision.semanticModelTier,
    effort: decision.reasoningEffort,
  }
}

describe('the approved routing matrix', () => {
  it.each([
    ['refinement', { role: 'refine' }, 'opencode', 'opencode.reasoning-fast', undefined],
    ['planning', { role: 'plan' }, 'opencode', 'opencode.reasoning-fast', undefined],
    ['small implementation', { role: 'implement', workload: 'light', writeVolume: 'small' },
      'opencode', 'opencode.workhorse', undefined],
    ['medium implementation', { role: 'implement', workload: 'medium' },
      'opencode', 'opencode.workhorse', undefined],
    ['heavy implementation', { role: 'implement', workload: 'heavy' },
      'opencode', 'opencode.workhorse', undefined],
    ['large-write implementation', { role: 'implement', writeVolume: 'large' },
      'opencode', 'opencode.workhorse', undefined],
    ['heavy repair', { role: 'repair', workload: 'heavy' },
      'opencode', 'opencode.workhorse', undefined],
    ['large-write repair', { role: 'repair', writeVolume: 'large' },
      'opencode', 'opencode.workhorse', undefined],
    ['broad refactor', { role: 'implement', taskClass: 'refactor', workload: 'heavy' },
      'opencode', 'opencode.workhorse', undefined],
    ['heavy test generation', { role: 'implement', taskClass: 'test-generation', workload: 'heavy' },
      'opencode', 'opencode.workhorse', undefined],
    ['routine review', { role: 'review' }, 'codex', 'codex.balanced', 'high'],
    ['difficult diagnosis', { role: 'debug', workload: 'heavy' }, 'codex', 'codex.balanced', 'high'],
    ['qa charter analysis', { role: 'qa' }, 'codex', 'codex.balanced', 'high'],
    ['high-risk architecture review', { role: 'review', risk: 'high' },
      'codex', 'codex.frontier', 'xhigh'],
    ['critical-risk review', { role: 'review', risk: 'critical' },
      'codex', 'codex.frontier', 'xhigh'],
    ['security-sensitive review', { role: 'security' }, 'codex', 'codex.frontier', 'xhigh'],
    ['auth analysis', { role: 'review', taskClass: 'auth' }, 'codex', 'codex.frontier', 'xhigh'],
    ['rls analysis', { role: 'review', taskClass: 'rls' }, 'codex', 'codex.frontier', 'xhigh'],
    ['tenant-isolation analysis', { role: 'review', taskClass: 'tenant-isolation' },
      'codex', 'codex.frontier', 'xhigh'],
    ['exceptional unresolved reasoning', { role: 'debug', priorAttempts: 2 },
      'codex', 'codex.frontier', 'max'],
  ] as const)('routes %s', (_name, facts, executor, tier, effort) => {
    expect(routed(facts as Partial<RoutingContext>)).toEqual({ executor, tier, effort })
  })

  it('spends the top budget only on an escalation somebody can point to', () => {
    // Two attempts already spent is the whole gate. Without it the same
    // diagnosis is ordinary work at the balanced tier, and that asymmetry is
    // what keeps the most expensive route from becoming the default one.
    expect(routed({ role: 'debug', priorAttempts: 0 }).effort).toBe('high')
    expect(routed({ role: 'debug', priorAttempts: 1 }).effort).toBe('high')
  })

  it.each(['auth', 'rls', 'tenant-isolation'] as const)(
    'keeps the implementation of a %s change on the workhorse, not the reviewer',
    (taskClass) => {
      // The task class raises the *review* of these three areas to the top
      // tier. Letting it also capture the implementation would hand write-heavy
      // work to the reviewing executor precisely where the work is riskiest.
      expect(routed({ role: 'implement', taskClass, workload: 'heavy' }))
        .toEqual({ executor: 'opencode', tier: 'opencode.workhorse', effort: undefined })
    },
  )

  it('never sends heavy or write-large work to a reasoning tier', () => {
    for (const role of ['implement', 'repair'] as const) {
      for (const facts of [{ workload: 'heavy' }, { writeVolume: 'large' }] as const) {
        expect(routed({ role, ...facts }).tier, `${role} ${JSON.stringify(facts)}`)
          .toBe('opencode.workhorse')
      }
    }
  })
})

describe('availability fallback preserves what the stage was for', () => {
  it.each([
    ['review', { role: 'review' }, 'opencode.reasoning-fast'],
    ['security review', { role: 'security' }, 'opencode.reasoning-fast'],
    ['diagnosis', { role: 'debug' }, 'opencode.reasoning-fast'],
    ['verification', { role: 'verify' }, 'opencode.reasoning-fast'],
    ['qa analysis', { role: 'qa' }, 'opencode.reasoning-fast'],
    ['heavy qa execution', { role: 'qa', workload: 'heavy' }, 'opencode.workhorse'],
    ['implementation', { role: 'implement' }, 'opencode.workhorse'],
    ['repair', { role: 'repair' }, 'opencode.workhorse'],
    ['a refactor', { role: 'plan', taskClass: 'refactor' }, 'opencode.workhorse'],
    ['test generation', { role: 'plan', taskClass: 'test-generation' }, 'opencode.workhorse'],
    // A review *of* a refactor is still judgement work: the task class says
    // what the change is, not what this stage was asked to do with it.
    ['a review of a refactor', { role: 'review', taskClass: 'refactor' }, 'opencode.reasoning-fast'],
  ] as const)('moves %s off a degraded Codex to the right tier', (_name, facts, tier) => {
    const decision = routed({ ...facts, degradedExecutors: ['codex'] })
    expect(decision.executor).toBe('opencode')
    expect(decision.tier).toBe(tier)
  })

  it.each([
    ['heavy implementation', { role: 'implement', workload: 'heavy' }],
    ['large-write repair', { role: 'repair', writeVolume: 'large' }],
    ['heavy qa execution', { role: 'qa', workload: 'heavy' }],
  ] as const)('moves %s onto Codex when OpenCode is the degraded one', (_name, facts) => {
    // The project owner's rule: a degraded OpenCode routes to Codex when Codex
    // can actually take the work. What is not allowed is doing it quietly, so
    // the decision has to carry where it fell back from.
    const decision = route(
      context({ ...facts, degradedExecutors: ['opencode'] }),
      policy,
    )
    expect(decision.executor).toBe('codex')
    expect(decision.reasonCodes).toContain('fallback:opencode')
  })

  it('stops rather than inventing a route when neither executor is usable', () => {
    // Blocking here is the correct answer, not a defect: with nothing available
    // to dispatch to, the alternative is a run attributed to an executor that
    // never took it.
    expect(() => route(
      context({ role: 'implement', workload: 'heavy', degradedExecutors: ['opencode', 'codex'] }),
      policy,
    )).toThrow(RoutingError)
  })

  it('has no Codex-unavailable row that answers judgement work with the workhorse', () => {
    // The residual row decides every case nobody enumerated, and it is the row
    // a reviewer is least likely to read. It must therefore be the conservative
    // answer rather than the cheap one.
    const residual = pluroraProfile.routingPolicy.fallbackRules
      .find(entry => entry.id === 'codex-unavailable')
    expect(residual?.when).toEqual({ unavailable: 'codex' })
    expect(residual?.use['tier']).toBe('opencode.reasoning-fast')
  })
})

describe('supabase preview policy names no standing execution target', () => {
  /** The Supabase rule's policy block. */
  function supabase(): Record<string, unknown> {
    return rule(pluroraProfile.integrationPolicy.rules, 'supabase-preview')
  }

  it('requires a preview branch whose identity is the pull request in flight', () => {
    expect(supabase()).toMatchObject({
      parentProjectRefSource: 'deployment-config',
      execution: 'cloud-only',
      previewBranchRequired: true,
      previewBranchIdentity: 'pull-request',
      onPreviewUnavailable: 'blocked',
    })
  })

  it('blocks rather than falling back when no preview branch can be had', () => {
    expect(supabase()['onPreviewUnavailable']).toBe('blocked')
    expect(supabase()['allowLocalFallback']).toBe(false)
    expect(supabase()['allowSharedDevFallback']).toBe(false)
  })

  it('stores no branch name at all, so none can be read as the target', () => {
    // Not merely "not the shared development branch": any branch name checked
    // into policy is a standing target, and the only correct target is one that
    // does not exist until the pull request does.
    expect(supabase()['branch']).toBeUndefined()
    expect(JSON.stringify(supabase())).not.toContain('neurovia-dev')
  })
})

describe('the database fallbacks this project does not have', () => {
  /** Every string this profile carries, wherever it is nested. */
  const serialized = JSON.stringify(pluroraProfile)

  it('names no local, linked or shared database anywhere in its policy', () => {
    // Written as a search over the whole profile rather than over the one rule
    // that is supposed to hold the answer. A fallback added later would be
    // added somewhere, and the point of this assertion is that there is no
    // somewhere it could hide.
    for (const forbidden of ['--local', '--linked', 'supabase start', 'db reset', 'test db']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('names no shared development database as anything at all', () => {
    // `neurovia-dev` is the database everyone else is using. A migration
    // validated against it is not validated, it is the incident.
    expect(serialized).not.toContain('neurovia-dev')
  })
})

describe('the Plurora Definition of Done', () => {
  it('states the eight obligations every certified branch carries', () => {
    // Held as data in the profile rather than asked of the model: a Definition
    // of Done the run could negotiate is not a definition of done.
    expect(pluroraDodObligations.map(item => item.id)).toEqual([
      'DOD-APPROVED-ARTIFACTS',
      'DOD-DIFF-COHERENCE',
      'DOD-FRESH-EVIDENCE',
      'DOD-NO-MATERIAL-DEFECT',
      'DOD-APPLICABLE-QA',
      'DOD-APPLICABLE-SECURITY',
      'DOD-DELIVERY-WORLD',
      'DOD-FINAL-VERIFY-READY',
    ])
  })

  it('makes every obligation required and sourced from the Definition of Done', () => {
    // An optional obligation is one a result may answer with anything, which
    // for a readiness gate is the same as not having stated it.
    for (const item of pluroraDodObligations) {
      expect(item.source, item.id).toBe('dod')
      expect(item.required, item.id).toBe(true)
      expect(item.requirement.length, item.id).toBeGreaterThan(20)
    }
  })

  it('states obligations in terms of the harness, naming no project file, database or model', () => {
    // This profile is Plurora's policy, and the obligations travel into the
    // journal. A NeuroVia path, a database reference or a native model id
    // written here would make a generic gate depend on one deployment.
    const text = pluroraDodObligations.map(item => `${item.id} ${item.requirement}`).join('\n')
    expect(text).not.toMatch(/neurovia|supabase|postgres|\.ts\b|\.md\b|gpt-|mimo|deepseek|claude/i)
  })

  it('collides with no obligation an approved Spec or Plan can declare', () => {
    // Spec ids and `PLAN-TASK-n` are the other two halves of the manifest, and
    // a shared id would silently drop one of the two obligations under it.
    for (const item of pluroraDodObligations) {
      expect(item.id.startsWith('DOD-'), item.id).toBe(true)
    }
    expect(new Set(pluroraDodObligations.map(item => item.id)).size).toBe(pluroraDodObligations.length)
  })
})
