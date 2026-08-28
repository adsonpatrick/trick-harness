/**
 * These handlers are the only place a model's own words become a verdict this
 * workflow acts on, which makes them the cheapest thing to defeat every gate
 * above them. These tests pin that prose is not evidence, that a stage cannot
 * name its own role, that nothing credential-shaped survives into the journal,
 * and that describing a delivery is all these handlers can do about one.
 *
 * @module apps/plurora-harness-host/tests/workflow-handlers
 */

import { describe, expect, it } from 'vitest'
import type { StageSpec } from '@trick-harness/engineering-workflow'
import type { ExecutorResult } from '@trick-harness/executor'
import type { WorkflowObjective } from '@trick-harness/contracts'
import {
  DELIVERY_BRANCH_PREFIX,
  MAX_BRANCH_NAME_CHARS,
  MAX_SUMMARY_CHARS,
  RESULT_MARKER,
  createPluroraWorkflowHandlers,
  deliveryBranch,
} from '../src/workflow-handlers.ts'

const STAGE: StageSpec = { stageId: 'implement-1', role: 'implement' }

const OBJECTIVE: WorkflowObjective = {
  id: 'PLU-42',
  cwd: '/workspace/plurora',
  requirement: 'add a nullable column to the flights table',
  risk: 'medium',
  workload: 'light',
  profileId: 'plurora',
  approvedArtifacts: {
    spec: { path: 'docs/spec.md', sha256: 'a'.repeat(64) },
    plan: { path: 'docs/plan.md', sha256: 'b'.repeat(64) },
  },
}

/** A completed provider result whose final output carries `envelope`. */
function completed(envelope: unknown, prose = 'I had a look and it seems fine.\n'): ExecutorResult {
  return { status: 'completed', output: `${prose}${RESULT_MARKER} ${JSON.stringify(envelope)}` }
}

/** A well-formed envelope, overridable field by field. */
function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    verdict: 'PASS',
    summary: 'added the column and its migration',
    findings: [],
    evidence: [{ kind: 'diff', locator: 'supabase/migrations/0002_flights.sql', summary: 'the migration' }],
    ...overrides,
  }
}

describe('deliveryBranch', () => {
  it('derives the branch from the objective, so the run and the operator agree in advance', () => {
    expect(deliveryBranch('PLU-42')).toBe(`${DELIVERY_BRANCH_PREFIX}plu-42`)
  })

  it('keeps a branch name to characters a branch may hold', () => {
    expect(deliveryBranch('feat/thing; rm -rf /')).toBe(`${DELIVERY_BRANCH_PREFIX}feat-thing-rm-rf`)
  })

  it('never yields the bare prefix, which would be a branch nobody named', () => {
    expect(deliveryBranch('!!!')).toBe(`${DELIVERY_BRANCH_PREFIX}objective`)
  })

  it('yields a name git will accept, since a rejected refname explains nothing', () => {
    // Each of these is an ordinary objective id and an invalid refname: git
    // refuses `..`, a leading dot, a trailing dot and a `.lock` suffix. A run
    // that derived one would be refused at delivery with nothing saying why.
    for (const id of ['a..b', '.hidden', 'x.lock', 'trailing.', '...']) {
      const branch = deliveryBranch(id)
      expect(branch).not.toContain('..')
      expect(branch.startsWith(`${DELIVERY_BRANCH_PREFIX}.`)).toBe(false)
      expect(branch.endsWith('.')).toBe(false)
      expect(branch.endsWith('.lock')).toBe(false)
    }
  })

  it('bounds the name, because an objective id is not a length git agreed to', () => {
    expect(deliveryBranch('a'.repeat(300)).length).toBeLessThanOrEqual(MAX_BRANCH_NAME_CHARS)
  })
})

describe('the Plurora stage interpreter', () => {
  it('reads a stated envelope as the stage result', () => {
    const result = createPluroraWorkflowHandlers().interpret(STAGE, 'codex', completed(envelope()))
    expect(result.verdict).toBe('PASS')
    expect(result.summary).toBe('added the column and its migration')
    expect(result.evidence).toHaveLength(1)
  })

  it('blocks a stage that stated nothing, because prose is not evidence', () => {
    const result = createPluroraWorkflowHandlers()
      .interpret(STAGE, 'codex', { status: 'completed', output: 'Everything looks great! All tests pass.' })
    expect(result.verdict).toBe('BLOCKED')
    expect(result.summary).toContain('established nothing')
  })

  it('blocks rather than fails an unreadable envelope, since neither was established', () => {
    const result = createPluroraWorkflowHandlers()
      .interpret(STAGE, 'codex', completed({ verdict: 'GREAT', summary: 'x', findings: [], evidence: [] }))
    expect(result.verdict).toBe('BLOCKED')
  })

  it('takes the role and the executor from the runtime, never from the stage', () => {
    // A stage that could name its own role could route its work past the
    // policy that decided which role was allowed to do it.
    const result = createPluroraWorkflowHandlers()
      .interpret(STAGE, 'codex', completed(envelope({ role: 'reviewer', executor: 'opencode' })))
    expect(result.role).toBe('implement')
    expect(result.executor).toBe('codex')
  })

  it('reads the last envelope, so one quoted inside an explanation cannot stand in', () => {
    const output = `Earlier I wrote ${RESULT_MARKER} ${JSON.stringify(envelope({ verdict: 'PASS' }))}\n`
      + `${RESULT_MARKER} ${JSON.stringify(envelope({ verdict: 'FAIL', summary: 'the column is wrong' }))}`
    const result = createPluroraWorkflowHandlers().interpret(STAGE, 'codex', { status: 'completed', output })
    expect(result.verdict).toBe('FAIL')
  })

  it('blocks a cancelled stage rather than reading whatever it had said so far', () => {
    const result = createPluroraWorkflowHandlers()
      .interpret(STAGE, 'codex', { status: 'aborted', output: `${RESULT_MARKER} ${JSON.stringify(envelope())}` })
    expect(result.verdict).toBe('BLOCKED')
  })

  it('blocks an executor failure, carrying only the diagnostic its own boundary redacted', () => {
    const result = createPluroraWorkflowHandlers().interpret(STAGE, 'codex', {
      status: 'error',
      output: '',
      failure: { category: 'transport', availability: true, safeDiagnostic: 'the app-server closed the connection' },
    })
    expect(result.verdict).toBe('BLOCKED')
    expect(result.summary).toBe('the app-server closed the connection')
  })

  it('bounds a stage summary rather than journalling however much it wrote', () => {
    const long = 'x'.repeat(MAX_SUMMARY_CHARS * 3)
    const result = createPluroraWorkflowHandlers().interpret(STAGE, 'codex', completed(envelope({ summary: long })))
    expect(result.summary.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS + 1)
  })

  it('journals no credential a finding carried in its own evidence', () => {
    // The top-level evidence list is filtered; a finding carries its own, and
    // the promise this host makes is about the journal, not about one field.
    const secret = 'postgresql://user:hunter2@db.example.com:5432/plurora'
    const result = createPluroraWorkflowHandlers().interpret(STAGE, 'codex', completed(envelope({
      findings: [{
        id: 'F-1',
        class: 'defect',
        raisedBy: 'implement',
        summary: 'the migration is wrong',
        confirmed: true,
        evidence: [{ kind: 'log', locator: secret, summary: 'the session' }],
      }],
    })))
    expect(JSON.stringify(result)).not.toContain('hunter2')
    expect(JSON.stringify(result)).not.toContain('db.example.com')
  })

  it('journals no credential a stage put in a field this host keeps', () => {
    const secret = 'postgresql://user:hunter2@db.example.com:5432/plurora'
    const result = createPluroraWorkflowHandlers().interpret(STAGE, 'codex', completed(envelope({
      summary: `connected with ${secret}`,
      evidence: [{ kind: 'log', locator: secret, summary: 'the session' }],
    })))
    expect(JSON.stringify(result)).not.toContain('hunter2')
    expect(JSON.stringify(result)).not.toContain('db.example.com')
  })
})

describe('the Plurora task text', () => {
  it('states the envelope the stage owes back, since nothing else asks for one', () => {
    const text = createPluroraWorkflowHandlers().task(STAGE, OBJECTIVE)
    expect(text).toContain(RESULT_MARKER)
    expect(text).toContain(OBJECTIVE.requirement)
    expect(text).toContain(STAGE.role)
  })

  it('tells the stage the mutations it is not the one performing', () => {
    const text = createPluroraWorkflowHandlers().task(STAGE, OBJECTIVE)
    for (const denied of ['commit', 'push', 'pull request', 'merge', 'release', 'database']) {
      expect(text).toContain(denied)
    }
  })
})

describe('the Plurora delivery description', () => {
  /** Interpret one stage, then describe the delivery that would follow it. */
  function describeAfter(result: ExecutorResult): ReturnType<NonNullable<
    ReturnType<typeof createPluroraWorkflowHandlers>['describeDelivery']
  >> {
    const handlers = createPluroraWorkflowHandlers()
    handlers.interpret(STAGE, 'codex', result)
    const describe_ = handlers.describeDelivery
    if (describe_ === undefined) throw new Error('the Plurora handlers must describe a delivery')
    return describe_({ stageId: 'delivery', objective: OBJECTIVE })
  }

  it('publishes exactly the paths the stages cited, and nothing the tree happens to hold', () => {
    const request = describeAfter(completed(envelope({
      evidence: [
        { kind: 'diff', locator: 'src/b.ts', summary: 'changed' },
        { kind: 'diff', locator: 'src/a.ts', summary: 'changed' },
        { kind: 'log', locator: 'build.log', summary: 'not a change' },
      ],
    })))
    expect(request.files).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('names no write set at all when no stage cited a change', () => {
    // Delivery refuses an empty set, which is the right failure: a run that
    // published whatever the tree held would be unbounded by definition.
    expect(describeAfter(completed(envelope({ evidence: [] }))).files).toEqual([])
  })

  it('publishes on the branch the objective derives, never one a model chose', () => {
    expect(describeAfter(completed(envelope())).branch).toBe(deliveryBranch(OBJECTIVE.id))
  })

  it('bounds the commit subject the same way it bounds the pull request title', () => {
    const long = 'x'.repeat(MAX_SUMMARY_CHARS * 3)
    const handlers = createPluroraWorkflowHandlers()
    handlers.interpret(STAGE, 'codex', completed(envelope()))
    const request = handlers.describeDelivery?.({
      stageId: 'delivery',
      objective: { ...OBJECTIVE, requirement: long },
    })
    const subject = request?.message.split('\n', 1)[0] ?? ''
    expect(subject.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS + 1)
  })

  it('opens against the base branch and says merging stays a human decision', () => {
    const request = describeAfter(completed(envelope()))
    expect(request.pullRequest.base).toBe('main')
    expect(request.pullRequest.body).toContain('human decision')
  })
})

describe('the Plurora repair reading', () => {
  it('believes no repair that did not state its own evidence', () => {
    const handlers = createPluroraWorkflowHandlers()
    const claimed = handlers.repairEvidence?.(STAGE, 'codex', completed(envelope()))
    expect(claimed?.rootCauseAddressed).toBe(false)
    expect(claimed?.regressionTest).toBeUndefined()
  })

  it('reads a stated regression test and focused green run', () => {
    const handlers = createPluroraWorkflowHandlers()
    const claimed = handlers.repairEvidence?.(STAGE, 'codex', completed(envelope({
      repair: {
        rootCauseAddressed: true,
        regressionTest: { kind: 'test', locator: 'tests/flights.spec.ts', summary: 'fails before the fix' },
        focusedGreen: { kind: 'test', locator: 'tests/flights.spec.ts', summary: 'passes after it' },
      },
    })))
    expect(claimed?.rootCauseAddressed).toBe(true)
    expect(claimed?.regressionTest?.locator).toBe('tests/flights.spec.ts')
  })

  it('reads no diagnosis out of a stage that did not state a whole one', () => {
    const handlers = createPluroraWorkflowHandlers()
    expect(handlers.diagnose?.(STAGE, 'codex', completed(envelope()))).toBeUndefined()
    expect(handlers.diagnose?.(STAGE, 'codex', completed(envelope({ diagnosis: { cause: 'a guess' } }))))
      .toBeUndefined()
  })
})
