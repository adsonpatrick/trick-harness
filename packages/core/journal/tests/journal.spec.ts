import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import { KNOWN_SESSION_EVENT_TYPES, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  DiagnosisContract,
  EvidenceRef,
  Finding,
  RouteDecision,
  WorkflowObjective,
} from '@trick-harness/contracts'
import {
  HARNESS_EVENT_TYPES,
  JournalError,
  WorkflowJournal,
  isHarnessEventType,
  projectWorkflow,
} from '../src/index.ts'

const objective: WorkflowObjective = {
  id: 'obj-1',
  cwd: '/repo',
  requirement: 'the delivery stage must not push to a protected branch',
  risk: 'high',
  workload: 'medium',
  profileId: 'plurora',
  approvedArtifacts: {
    spec: { path: 'docs/spec.md', sha256: 'a'.repeat(64) },
    plan: { path: 'docs/plan.md', sha256: 'b'.repeat(64) },
  },
}

const decision: RouteDecision = {
  executor: 'opencode',
  semanticModelTier: 'opencode.workhorse',
  resolvedModel: 'MiMo V2.5',
  permissionMode: 'workspace-write',
  reasonCodes: ['role:implement', 'rule:implementation', 'tier:opencode.workhorse'],
  policyVersion: 'plurora-v1.0.0',
}

const evidence: readonly EvidenceRef[] = [
  { kind: 'test', locator: 'packages/core/journal/tests/journal.spec.ts', summary: 'focused suite green' },
]

const finding: Finding = {
  id: 'f-1',
  class: 'BUG',
  raisedBy: 'review',
  summary: 'the delivery stage accepts a protected branch',
  confirmed: true,
  evidence: [{ kind: 'diff', locator: 'src/delivery.ts', summary: 'no branch check before push' }],
}

const diagnosis: DiagnosisContract = {
  symptom: 'a push to master is accepted',
  reproduction: 'run the delivery stage with branch master',
  expectedVsActual: 'expected refusal, observed a push',
  observedEvidence: [{ kind: 'log', locator: 'run-4', summary: 'push accepted' }],
  affectedBoundary: 'the delivery stage branch guard',
  ruledOutHypotheses: ['the remote is misconfigured'],
  rootCauseHypothesis: 'the guard runs after the push is constructed',
  confidence: 'high',
  regressionTestSeam: 'delivery.spec.ts',
  minimalRepairSurface: 'src/delivery.ts',
  unknowns: [],
  securityRelevance: 'possible',
}

describe('the harness event vocabulary', () => {
  it('declares the sixteen events the lifecycle needs, in lifecycle order', () => {
    expect([...HARNESS_EVENT_TYPES]).toStrictEqual([
      'harness/workflow-start',
      'harness/route-decision',
      'harness/route-fallback',
      'harness/executor-start',
      'harness/executor-end',
      'harness/capability-start',
      'harness/capability-end',
      'harness/finding',
      'harness/diagnosis',
      'harness/verdict',
      'harness/delivery',
      'harness/blocker',
      'harness/conformance',
      'harness/change-impact',
      'harness/circuit-breaker',
      'harness/workflow-end',
    ])
  })

  it('is known to the build that reads logs back', () => {
    // The read path refuses a log holding a type outside this set, so a harness
    // assembled without this package's declaration merge fails to reconstruct a
    // session that used one rather than reading it back with facts missing.
    for (const type of HARNESS_EVENT_TYPES) {
      expect(KNOWN_SESSION_EVENT_TYPES.has(type), type).toBe(true)
    }
  })

  it('recognises its own types and nothing else', () => {
    expect(isHarnessEventType('harness/verdict')).toBe(true)
    expect(isHarnessEventType('harness/telepathy')).toBe(false)
    expect(isHarnessEventType('user/message')).toBe(false)
  })
})

describe('writing and replaying one workflow', () => {
  let session: Session
  let flush: Mock<() => Promise<boolean>>
  let journal: WorkflowJournal

  beforeEach(() => {
    session = Session.create(SessionId('s-1'))
    flush = vi.fn(async () => Promise.resolve(true))
    journal = new WorkflowJournal(session, 'wf-1', flush)
  })

  /** Project the session as a fresh process would: from the log alone. */
  function replay(workflowId = 'wf-1'): ReturnType<typeof projectWorkflow> {
    return projectWorkflow(session.events, workflowId)
  }

  it('serializes every event type without the append path rejecting a payload', async () => {
    journal.start(objective)
    journal.routeDecision({ stageId: 'impl-1', role: 'implement', decision })
    await journal.routeFallback(
      { stageId: 'impl-1', role: 'implement', decision: { ...decision, fallbackFrom: 'codex' } },
      'usage-limit-exceeded',
      { independence: 'reduced', assurance: 'lowered' },
    )
    journal.executorStart({ stageId: 'impl-1', role: 'implement', decision })
    journal.executorEnd('impl-1', 'opencode', 'completed', 1_200)
    await journal.beginCapability('deliver-1', 'github-delivery', true)
    await journal.endCapability('deliver-1', 'github-delivery', 'completed', 900)
    journal.finding('review-1', finding)
    await journal.diagnosis('debug-1', diagnosis)
    await journal.verdict('verify-1', 'verify', 'PASS', 'focused suite green', evidence)
    await journal.delivery({ action: 'push', branch: 'feat/x', commitSha: 'abc123' })
    await journal.blocker({ stageId: 'refine-1', kind: 'product-decision', summary: 'which branch is protected', evidence })
    journal.conformance({
      specPath: 'docs/spec.md',
      specSha256: 'a'.repeat(64),
      planPath: 'docs/plan.md',
      planSha256: 'b'.repeat(64),
      expected: { spec: 2, plan: 2, dod: 8 },
      counts: { PASS: 12, MISSING: 0, PARTIAL: 0, FAIL: 0, BLOCKED: 0, INCONCLUSIVE: 0 },
      verdict: 'PASS',
    })
    await journal.changeImpact({
      source: 'actual',
      pathCount: 2,
      surfaces: ['ui'],
      riskFloor: 'medium',
      writeVolume: 'small',
      taskClasses: ['ui-change'],
      requiredCapabilities: [],
      evidenceProfiles: ['ui-standard'],
      databaseMutation: false,
      matchedRuleIds: ['ui'],
      unplannedPaths: [],
      effectiveRisk: 'medium',
    })
    journal.circuitBreaker('codex', 'AVAILABLE', 'DEGRADED', 'failure:usage-limit-exceeded')
    await journal.end('completed', 'PASS', 'delivered')

    const written = session.events.filter(event => event.type.startsWith('harness/')).map(event => event.type)
    expect(written).toStrictEqual([...HARNESS_EVENT_TYPES])
  })

  it('replays the objective, routes, findings, diagnoses, verdicts and delivery from the log alone', async () => {
    journal.start(objective)
    journal.routeDecision({ stageId: 'impl-1', role: 'implement', decision })
    journal.finding('review-1', finding)
    await journal.diagnosis('debug-1', diagnosis)
    await journal.verdict('verify-1', 'verify', 'PARTIAL', 'one finding open', evidence)
    await journal.delivery({ action: 'pr-open', branch: 'feat/x', prNumber: 7, prUrl: 'https://example.invalid/pr/7' })

    const state = replay()
    expect(state.objective).toStrictEqual({
      id: 'obj-1',
      cwd: '/repo',
      requirement: objective.requirement,
      risk: 'high',
      workload: 'medium',
      profileId: 'plurora',
      approvedArtifacts: objective.approvedArtifacts,
    })
    expect(state.routes).toStrictEqual([{
      stageId: 'impl-1',
      role: 'implement',
      executor: 'opencode',
      resolvedModel: 'MiMo V2.5',
      permissionMode: 'workspace-write',
      reasonCodes: decision.reasonCodes,
      policyVersion: 'plurora-v1.0.0',
    }])
    expect(state.findings).toStrictEqual([finding])
    expect(state.diagnoses).toStrictEqual([diagnosis])
    expect(state.verdicts[0]?.verdict).toBe('PARTIAL')
    expect(state.deliveries).toStrictEqual([{
      action: 'pr-open',
      branch: 'feat/x',
      prNumber: 7,
      prUrl: 'https://example.invalid/pr/7',
    }])
  })

  it('marks the route a fallback amended, without losing the decision it replaced', async () => {
    journal.routeDecision({ stageId: 'review-1', role: 'review', decision })
    await journal.routeFallback(
      { stageId: 'review-1', role: 'review', decision: { ...decision, fallbackFrom: 'codex' } },
      'usage-limit-exceeded',
      { independence: 'lost', assurance: 'lowered' },
    )
    expect(replay().routes[0]?.fallbackFrom).toBe('codex')
  })

  it('reports the stages a restart must verify before retrying', () => {
    journal.executorStart({ stageId: 'impl-1', role: 'implement', decision })
    journal.executorEnd('impl-1', 'opencode', 'completed', 10)
    journal.executorStart({ stageId: 'impl-2', role: 'implement', decision })

    const state = replay()
    expect(state.openStages).toStrictEqual(['impl-2'])
    expect(state.executorStarts).toBe(2)
    expect(state.end).toBeUndefined()
  })

  it('projects the last circuit state each executor was left in', () => {
    journal.circuitBreaker('codex', 'AVAILABLE', 'DEGRADED', 'failure:usage-limit-exceeded')
    journal.circuitBreaker('codex', 'DEGRADED', 'AVAILABLE', 'manual-refresh')
    journal.circuitBreaker('opencode', 'AVAILABLE', 'DEGRADED', 'failure:server-overloaded')
    expect(replay().circuits).toStrictEqual({ codex: 'AVAILABLE', opencode: 'DEGRADED' })
  })

  it('keeps one workflow out of another workflow`s projection', async () => {
    journal.start(objective)
    const other = new WorkflowJournal(session, 'wf-2', flush)
    other.finding('review-1', finding)
    await other.end('failed', 'FAIL', 'broken')

    expect(replay().findings).toStrictEqual([])
    expect(replay().end).toBeUndefined()
    expect(replay('wf-2').findings).toStrictEqual([finding])
    expect(replay('wf-2').end?.state).toBe('failed')
  })

  it('returns an empty projection for a workflow the log never saw', () => {
    expect(replay('wf-absent')).toStrictEqual({
      workflowId: 'wf-absent',
      routes: [],
      findings: [],
      diagnoses: [],
      verdicts: [],
      deliveries: [],
      blockers: [],
      circuits: {},
      openStages: [],
      openCapabilities: [],
      executorStarts: 0,
    })
  })
})

describe('what the journal refuses to lose', () => {
  let session: Session
  let flush: Mock<() => Promise<boolean>>
  let journal: WorkflowJournal

  beforeEach(() => {
    session = Session.create(SessionId('s-2'))
    flush = vi.fn(async () => Promise.resolve(true))
    journal = new WorkflowJournal(session, 'wf-1', flush)
  })

  it('checkpoints exactly the facts a restart would otherwise act against', async () => {
    journal.start(objective)
    journal.routeDecision({ stageId: 'impl-1', role: 'implement', decision })
    journal.executorStart({ stageId: 'impl-1', role: 'implement', decision })
    journal.executorEnd('impl-1', 'opencode', 'completed', 5)
    journal.finding('review-1', finding)
    journal.circuitBreaker('codex', 'AVAILABLE', 'DEGRADED', 'failure:usage-limit-exceeded')
    expect(flush).not.toHaveBeenCalled()

    await journal.routeFallback({ stageId: 'impl-1', role: 'implement', decision }, 'usage-limit-exceeded', { independence: 'preserved', assurance: 'unchanged' })
    await journal.diagnosis('debug-1', diagnosis)
    await journal.verdict('verify-1', 'verify', 'PASS', 'green', evidence)
    await journal.delivery({ action: 'commit', branch: 'feat/x', commitSha: 'abc' })
    await journal.blocker({ kind: 'design-decision', summary: 'unclear', evidence })
    await journal.end('completed', 'PASS', 'done')
    expect(flush).toHaveBeenCalledTimes(6)
  })

  it('survives pruning everything that is not a durable harness fact', async () => {
    journal.start(objective)
    journal.finding('review-1', finding)
    await journal.verdict('verify-1', 'verify', 'PARTIAL', 'one finding open', evidence)
    const before = projectWorkflow(session.events, 'wf-1')

    // Compaction and tool-result pruning act on the conversation surface. The
    // durable facts live in their own events, so removing every other event
    // must leave the projection identical.
    const pruned = session.events.filter(event => event.type.startsWith('harness/'))
    expect(projectWorkflow(pruned, 'wf-1')).toStrictEqual(before)
    expect(projectWorkflow(pruned, 'wf-1').findings[0]?.evidence).toStrictEqual(finding.evidence)
  })

  it('refuses a log holding a harness fact this build cannot interpret', () => {
    const foreign = [{ type: 'harness/telepathy', data: { workflowId: 'wf-1' } }] as unknown as SessionEvent[]
    expect(() => projectWorkflow(foreign, 'wf-1')).toThrow(JournalError)
    expect(() => projectWorkflow(foreign, 'wf-1')).toThrow(expect.objectContaining({ code: 'unknown-event' }))
  })

  it('ignores events that are not the journal`s to interpret', () => {
    const foreign = [{ type: 'user/message', data: { workflowId: 'wf-1' } }] as unknown as SessionEvent[]
    expect(projectWorkflow(foreign, 'wf-1').findings).toStrictEqual([])
  })
})

describe('what never reaches the durable log', () => {
  it('writes the declared fields of a finding and drops whatever else was attached', () => {
    const session = Session.create(SessionId('s-3'))
    const journal = new WorkflowJournal(session, 'wf-1', async () => Promise.resolve(true))
    const leaky = {
      ...finding,
      transcript: 'the model reasoned at length about the branch guard',
      toolCalls: [{ name: 'read', args: { path: '.env' } }],
    } as unknown as Finding

    journal.finding('review-1', leaky)

    const logged = session.events.find(event => event.type === 'harness/finding')
    const payload = logged?.data as { finding: Record<string, unknown> } | undefined
    expect(Object.keys(payload?.finding ?? {}).sort()).toStrictEqual([
      'class',
      'confirmed',
      'evidence',
      'id',
      'raisedBy',
      'summary',
    ])
    expect(JSON.stringify(logged)).not.toContain('reasoned at length')
    expect(JSON.stringify(logged)).not.toContain('.env')
  })

  it('writes the declared fields of a diagnosis and drops the reasoning that produced it', async () => {
    const session = Session.create(SessionId('s-4'))
    const journal = new WorkflowJournal(session, 'wf-1', async () => Promise.resolve(true))
    const leaky = { ...diagnosis, chainOfThought: 'first I suspected the remote' } as unknown as DiagnosisContract

    await journal.diagnosis('debug-1', leaky)

    const logged = session.events.find(event => event.type === 'harness/diagnosis')
    expect(JSON.stringify(logged)).not.toContain('first I suspected')
    expect((logged?.data as { diagnosis: DiagnosisContract }).diagnosis.rootCauseHypothesis)
      .toBe(diagnosis.rootCauseHypothesis)
  })

  it('omits an optional field rather than writing it empty', () => {
    const session = Session.create(SessionId('s-5'))
    const journal = new WorkflowJournal(session, 'wf-1', async () => Promise.resolve(true))
    journal.executorEnd('impl-1', 'opencode', 'completed', 3)
    const payload = session.events.find(event => event.type === 'harness/executor-end')?.data
    expect(Object.hasOwn(payload as object, 'failureClass')).toBe(false)
  })
})

describe('two attempts at one objective', () => {
  it('keeps each attempt to its own projection', async () => {
    const session = Session.create(SessionId('two-attempts'))
    const flush = async (): Promise<boolean> => true
    const first = new WorkflowJournal(session, 'wf-a', flush)
    const second = new WorkflowJournal(session, 'wf-b', flush)

    first.start(objective)
    first.routeDecision({ stageId: 's-1', role: 'implement', decision })
    first.finding('s-1', finding)
    await first.end('failed', 'FAIL', 'the first attempt failed')
    second.start(objective)
    second.routeDecision({ stageId: 's-1', role: 'implement', decision })

    const one = projectWorkflow(session.events, 'wf-a')
    const two = projectWorkflow(session.events, 'wf-b')

    // Both attempts name the same objective, which is the point: the logical
    // thing a person asked for is stable, and each attempt at it is separate.
    expect(one.objective?.id).toBe('obj-1')
    expect(two.objective?.id).toBe('obj-1')
    expect(one.findings.length).toBe(1)
    expect(two.findings).toEqual([])
    expect(one.end?.state).toBe('failed')
    // A second attempt reading the first one's end would report itself finished
    // before it had run a stage.
    expect(two.end).toBeUndefined()
    expect(two.routes.length).toBe(1)
  })
})

describe('the executor start barrier', () => {
  it('appends the route and the start, then checkpoints, in that order', async () => {
    const session = Session.create(SessionId('barrier'))
    const order: string[] = []
    const journal = new WorkflowJournal(session, 'wf-1', async () => {
      order.push(...session.events.map(event => event.type))
      return true
    })

    await journal.beginExecutor({ stageId: 's-1', role: 'implement', decision })

    // The checkpoint sees both facts. One that saw only the route would leave a
    // restart able to say what was authorised and not that anything ran.
    expect(order).toEqual(['harness/route-decision', 'harness/executor-start'])
  })

  it('refuses a checkpoint that did not happen, however it says so', async () => {
    const session = Session.create(SessionId('barrier-failed'))
    const refusing = new WorkflowJournal(session, 'wf-1', async () => false)
    const rejecting = new WorkflowJournal(session, 'wf-2', async () => {
      throw new Error('the disk is full')
    })

    // `false` and a rejection are the same fact — the checkpoint did not
    // happen — so they cannot mean different things to whoever is about to
    // start a provider on the strength of it.
    await expect(refusing.beginExecutor({ stageId: 's-1', role: 'implement', decision }))
      .rejects.toThrow(JournalError)
    await expect(rejecting.beginExecutor({ stageId: 's-1', role: 'implement', decision }))
      .rejects.toThrow(/the disk is full/)
  })
})

describe('the deterministic capability window', () => {
  it('records that a capability ran without recording what it said', async () => {
    const session = Session.create(SessionId('capability'))
    const order: string[] = []
    const journal = new WorkflowJournal(session, 'wf-1', async () => {
      order.push(session.events.at(-1)?.type ?? '')
      return true
    })

    journal.start(objective)
    await journal.beginCapability('deliver-1', 'github-delivery', true)
    await journal.endCapability('deliver-1', 'github-delivery', 'completed', 42)

    // Each half is durable on its own, because the gap between them is exactly
    // the window a restart needs to be able to see.
    expect(order).toEqual(['harness/capability-start', 'harness/capability-end'])
    const started = session.events.find(event => event.type === 'harness/capability-start')
    expect(started?.data).toStrictEqual({
      workflowId: 'wf-1',
      stageId: 'deliver-1',
      capability: 'github-delivery',
      mutationPossible: true,
    })
    const ended = session.events.find(event => event.type === 'harness/capability-end')
    expect(Object.hasOwn(ended?.data as object, 'failureClass')).toBe(false)
    // No stdout, no connection string, no token: the log says a push happened,
    // never how to repeat it.
    expect(JSON.stringify(session.events)).not.toContain('postgres')
  })

  it('replays a start with no end as a window still open', async () => {
    const session = Session.create(SessionId('capability-open'))
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)

    journal.start(objective)
    await journal.beginCapability('deliver-1', 'github-delivery', true)
    await journal.beginCapability('deliver-1', 'supabase-preview', false)
    await journal.endCapability('deliver-1', 'supabase-preview', 'completed', 7)

    const replayed = projectWorkflow(session.events, 'wf-1')
    expect(replayed.openCapabilities).toEqual(['deliver-1:github-delivery'])
  })

  it('leaves one window open when the same capability ran twice and answered once', async () => {
    const session = Session.create(SessionId('capability-twice'))
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)

    journal.start(objective)
    await journal.beginCapability('deliver-1', 'github-delivery', true)
    await journal.beginCapability('deliver-1', 'github-delivery', true)
    await journal.endCapability('deliver-1', 'github-delivery', 'error', 3, 'transport-unavailable')

    // Set arithmetic would report nothing open here, which is the one answer a
    // restart must not be given.
    expect(projectWorkflow(session.events, 'wf-1').openCapabilities)
      .toEqual(['deliver-1:github-delivery'])
  })

  it('refuses a checkpoint that did not happen on either half', async () => {
    const session = Session.create(SessionId('capability-refused'))
    const journal = new WorkflowJournal(session, 'wf-1', async () => false)

    await expect(journal.beginCapability('deliver-1', 'github-delivery', true))
      .rejects.toThrow(expect.objectContaining({ code: 'flush-failed' }))
    await expect(journal.endCapability('deliver-1', 'github-delivery', 'completed', 1))
      .rejects.toThrow(JournalError)
  })
})

describe('what the log remembers about approved artifacts and conformance', () => {
  const summary = {
    specPath: 'docs/spec.md',
    specSha256: 'a'.repeat(64),
    planPath: 'docs/plan.md',
    planSha256: 'b'.repeat(64),
    expected: { spec: 2, plan: 2, dod: 8 },
    counts: { PASS: 11, MISSING: 1, PARTIAL: 0, FAIL: 0, BLOCKED: 0, INCONCLUSIVE: 0 },
    verdict: 'PARTIAL' as const,
  }

  it('records which documents a workflow was approved against', () => {
    // Without this the log can say a run passed conformance but not what it was
    // conformant to, and a Spec edited afterwards leaves no trace of the change.
    const session = Session.create(SessionId('s-c1'))
    new WorkflowJournal(session, 'wf-1', async () => true).start(objective)
    const [event] = session.events
    expect(event?.data).toMatchObject({
      specPath: 'docs/spec.md',
      specSha256: 'a'.repeat(64),
      planPath: 'docs/plan.md',
      planSha256: 'b'.repeat(64),
    })
  })

  it('carries the artifact identity and the conformance reading through a replay', () => {
    const session = Session.create(SessionId('s-c2'))
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    journal.start(objective)
    journal.conformance(summary)

    const projection = projectWorkflow([...session.events], 'wf-1')
    expect(projection.objective?.approvedArtifacts).toEqual(objective.approvedArtifacts)
    expect(projection.conformance).toEqual(summary)
  })

  it('keeps the last conformance reading, since a repair invalidates the earlier one', () => {
    const session = Session.create(SessionId('s-c3'))
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    journal.start(objective)
    journal.conformance({ ...summary, verdict: 'FAIL' })
    journal.conformance(summary)
    expect(projectWorkflow([...session.events], 'wf-1').conformance?.verdict).toBe('PARTIAL')
  })

  it('writes counts and hashes rather than the documents or the model output', () => {
    // The conformance payload is the one place a whole Spec, a prompt or a
    // provider transcript could reach a durable log by being handed over with
    // the summary. The event is rebuilt field by field so it cannot.
    const session = Session.create(SessionId('s-c4'))
    const journal = new WorkflowJournal(session, 'wf-1', async () => true)
    journal.start(objective)
    journal.conformance({
      ...summary,
      specText: '# the whole approved spec',
      planText: '# the whole approved plan',
      prompt: 'the instruction the model was given',
      transcript: 'what the model said',
      reasoning: 'why it said it',
      items: [{ id: 'ND1', summary: 'free text off a provider' }],
    } as never)

    const written = JSON.stringify(session.events)
    for (const key of ['specText', 'planText', 'prompt', 'transcript', 'reasoning', 'items']) {
      expect(written, key).not.toContain(key)
    }
  })

  it('rebuilds the nested counts on the way back, not only on the way in', () => {
    // The write path rebuilds every field, so nothing rides in on a summary. A
    // read path that carried `expected` and `counts` by reference would undo
    // half of that: a log this process did not write — an older build's, or one
    // edited on disk — could put free text back into a projection that a status
    // surface then renders.
    const session = Session.create(SessionId('s-c5'))
    new WorkflowJournal(session, 'wf-1', async () => true).start(objective)
    const events = [...session.events, {
      ...session.events[0],
      type: 'harness/conformance',
      data: {
        workflowId: 'wf-1',
        ...summary,
        expected: { ...summary.expected, transcript: 'what the model said' },
        counts: { ...summary.counts, reasoning: 'why it said it' },
      },
    } as never]

    const read = projectWorkflow(events, 'wf-1').conformance

    expect(read?.expected).toEqual(summary.expected)
    expect(read?.counts).toEqual(summary.counts)
    expect(JSON.stringify(read)).not.toContain('transcript')
    expect(JSON.stringify(read)).not.toContain('reasoning')
  })

  it('names the conformance event in the vocabulary the read path knows', () => {
    expect(HARNESS_EVENT_TYPES).toContain('harness/conformance')
    expect(KNOWN_SESSION_EVENT_TYPES.has('harness/conformance')).toBe(true)
    expect(isHarnessEventType('harness/conformance')).toBe(true)
  })
})

describe('recording what the change turned out to be', () => {
  let session: Session
  let flush: Mock<() => Promise<boolean>>
  let journal: WorkflowJournal

  beforeEach(() => {
    session = Session.create(SessionId('s'))
    flush = vi.fn(async () => Promise.resolve(true))
    journal = new WorkflowJournal(session, 'wf-1', flush)
  })

  /** One reading of a change set, as the classifier hands it over. */
  function reading(
    source: 'planned' | 'actual',
    overrides: Record<string, unknown> = {},
  ): Parameters<WorkflowJournal['changeImpact']>[0] {
    return {
      source,
      pathCount: 2,
      surfaces: ['ui'],
      riskFloor: 'medium',
      writeVolume: 'small',
      taskClasses: ['ui-change'],
      requiredCapabilities: [],
      evidenceProfiles: ['ui-standard'],
      databaseMutation: false,
      matchedRuleIds: ['ui'],
      unplannedPaths: [],
      effectiveRisk: 'medium',
      ...overrides,
    }
  }

  it('checkpoints the reading before the phase whose policy depends on it', async () => {
    // The planned reading is what authorises the first writable tree. A run
    // that mutated on the strength of a classification the log never kept
    // could not say afterwards what it believed it was doing.
    await journal.changeImpact(reading('planned'))

    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('refuses to report a durability that did not happen', async () => {
    flush.mockResolvedValueOnce(false)

    await expect(journal.changeImpact(reading('planned'))).rejects.toBeInstanceOf(JournalError)
  })

  it('keeps the latest reading of each kind, in the order they were written', async () => {
    await journal.changeImpact(reading('planned'))
    await journal.changeImpact(reading('actual', { effectiveRisk: 'medium', surfaces: ['ui'] }))
    await journal.changeImpact(reading('actual', { effectiveRisk: 'critical', surfaces: ['ui', 'auth'] }))

    const projected = projectWorkflow(session.events, 'wf-1').changeImpact
    expect(projected?.planned?.effectiveRisk).toBe('medium')
    // The second delivery replaced the first: the standing fact about the
    // branch a person would review is the last one recorded about it.
    expect(projected?.actual?.effectiveRisk).toBe('critical')
    expect(projected?.actual?.surfaces).toStrictEqual(['auth', 'ui'])
  })

  it('says each surface once, in one order, whatever order it was given them', async () => {
    await journal.changeImpact(reading('planned', { surfaces: ['ui', 'auth', 'ui'], evidenceProfiles: ['b', 'a'] }))

    const projected = projectWorkflow(session.events, 'wf-1').changeImpact
    expect(projected?.planned?.surfaces).toStrictEqual(['auth', 'ui'])
    expect(projected?.planned?.evidenceProfiles).toStrictEqual(['a', 'b'])
  })

  it('records no field that could carry a diff or the contents of a file', async () => {
    await journal.changeImpact(reading('actual', { unplannedPaths: ['src/ui/button.tsx'] }))

    const appended = session.events.filter(event => isHarnessEventType(event.type)
      && event.type === 'harness/change-impact')
    const payload = appended.at(-1)?.data as unknown as Record<string, unknown>
    for (const forbidden of ['diff', 'patch', 'contents', 'text', 'output', 'stderr']) {
      expect(Object.keys(payload)).not.toContain(forbidden)
    }
  })

  it('bounds the unplanned paths it keeps and still says how many there were', async () => {
    const many = Array.from({ length: 150 }, (_, index) => `src/generated/file-${String(index).padStart(3, '0')}.ts`)
    await journal.changeImpact(reading('actual', { unplannedPaths: many }))

    const projected = projectWorkflow(session.events, 'wf-1').changeImpact
    // The count is the fact; the list is a sample of it. A projection that kept
    // only the list would let 150 unapproved files read as 100.
    expect(projected?.actual?.unplannedPathCount).toBe(150)
    expect(projected?.actual?.unplannedPaths).toHaveLength(100)
  })

  it('leaves a workflow that classified nothing with no impact at all', () => {
    expect(projectWorkflow(session.events, 'wf-1').changeImpact).toBeUndefined()
  })
})
