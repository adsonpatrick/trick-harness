/**
 * These handlers are the only place a model's own words become a verdict this
 * workflow acts on, which makes them the cheapest thing to defeat every gate
 * above them. These tests pin that prose is not evidence, that a stage cannot
 * name its own role, that nothing credential-shaped survives into the journal,
 * and that describing a delivery is all these handlers can do about one.
 *
 * @module apps/plurora-harness-host/tests/workflow-handlers
 */

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { StageSpec } from '@trick-harness/engineering-workflow'
import type { ExecutorResult } from '@trick-harness/executor'
import type { ConformanceManifest, WorkflowObjective } from '@trick-harness/contracts'
import { FINDING_CLASSES, ROLES, parseConformanceContract } from '@trick-harness/contracts'
import { pluroraDodObligations } from '../../../profiles/plurora/profile.ts'
import {
  MAX_SUMMARY_CHARS,
  RESULT_MARKER,
  createPluroraWorkflowHandlers,
} from '../src/workflow-handlers.ts'

const STAGE: StageSpec = { stageId: 'implement-1', role: 'implement' }

/** An approved Spec declaring one criterion the extraction reads. */
const SPEC_TEXT = '# Spec\n\n- **ND1:** the column is nullable\n'

/** An approved Plan declaring one task the extraction reads. */
const PLAN_TEXT = '# Plan\n\n### Task 1: Add the migration\n'

/** The identity half of an approved document. */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

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

describe('the Plurora stage interpreter', () => {
  it('reads a stated envelope as the stage result', () => {
    const result = createPluroraWorkflowHandlers({ branch: 'test/canary' }).interpret(STAGE, 'codex', completed(envelope()))
    expect(result.verdict).toBe('PASS')
    expect(result.summary).toBe('added the column and its migration')
    expect(result.evidence).toHaveLength(1)
  })

  it('blocks a stage that stated nothing, because prose is not evidence', () => {
    const result = createPluroraWorkflowHandlers({ branch: 'test/canary' })
      .interpret(STAGE, 'codex', { status: 'completed', output: 'Everything looks great! All tests pass.' })
    expect(result.verdict).toBe('BLOCKED')
    expect(result.summary).toContain('established nothing')
  })

  it('blocks rather than fails an unreadable envelope, since neither was established', () => {
    const result = createPluroraWorkflowHandlers({ branch: 'test/canary' })
      .interpret(STAGE, 'codex', completed({ verdict: 'GREAT', summary: 'x', findings: [], evidence: [] }))
    expect(result.verdict).toBe('BLOCKED')
  })

  it('identifies a parsed but invalid result without journalling the stage output', () => {
    const result = createPluroraWorkflowHandlers({ branch: 'test/canary' })
      .interpret(STAGE, 'codex', completed(envelope({
        findings: [{
          id: 'F-1',
          class: 'NOT_A_CLASS',
          raisedBy: 'qa',
          summary: 'the test environment refused a write',
          confirmed: true,
          evidence: [],
        }],
      })))

    expect(result.summary).toContain('stage-result-invalid')
    expect(result.summary).toContain('stage.findings[0].class')
    expect(result.summary).not.toContain('NOT_A_CLASS')
  })

  it('states every closed vocabulary an ordinary result may use', () => {
    const prompt = createPluroraWorkflowHandlers({ branch: 'test/canary' }).task(STAGE, OBJECTIVE)

    for (const findingClass of FINDING_CLASSES) expect(prompt).toContain(`"${findingClass}"`)
    for (const role of ROLES) expect(prompt).toContain(`"${role}"`)
  })

  it('takes the role and the executor from the runtime, never from the stage', () => {
    // A stage that could name its own role could route its work past the
    // policy that decided which role was allowed to do it.
    const result = createPluroraWorkflowHandlers({ branch: 'test/canary' })
      .interpret(STAGE, 'codex', completed(envelope({ role: 'reviewer', executor: 'opencode' })))
    expect(result.role).toBe('implement')
    expect(result.executor).toBe('codex')
  })

  it('reads the last envelope, so one quoted inside an explanation cannot stand in', () => {
    const output = `Earlier I wrote ${RESULT_MARKER} ${JSON.stringify(envelope({ verdict: 'PASS' }))}\n`
      + `${RESULT_MARKER} ${JSON.stringify(envelope({ verdict: 'FAIL', summary: 'the column is wrong' }))}`
    const result = createPluroraWorkflowHandlers({ branch: 'test/canary' }).interpret(STAGE, 'codex', { status: 'completed', output })
    expect(result.verdict).toBe('FAIL')
  })

  it('blocks a cancelled stage rather than reading whatever it had said so far', () => {
    const result = createPluroraWorkflowHandlers({ branch: 'test/canary' })
      .interpret(STAGE, 'codex', { status: 'aborted', output: `${RESULT_MARKER} ${JSON.stringify(envelope())}` })
    expect(result.verdict).toBe('BLOCKED')
  })

  it('blocks an executor failure, carrying only the diagnostic its own boundary redacted', () => {
    const result = createPluroraWorkflowHandlers({ branch: 'test/canary' }).interpret(STAGE, 'codex', {
      status: 'error',
      output: '',
      failure: { category: 'transport', availability: true, safeDiagnostic: 'the app-server closed the connection' },
    })
    expect(result.verdict).toBe('BLOCKED')
    expect(result.summary).toBe('the app-server closed the connection')
  })

  it('bounds a stage summary rather than journalling however much it wrote', () => {
    const long = 'x'.repeat(MAX_SUMMARY_CHARS * 3)
    const result = createPluroraWorkflowHandlers({ branch: 'test/canary' }).interpret(STAGE, 'codex', completed(envelope({ summary: long })))
    expect(result.summary.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS + 1)
  })

  it('journals no credential a finding carried in its own evidence', () => {
    // The top-level evidence list is filtered; a finding carries its own, and
    // the promise this host makes is about the journal, not about one field.
    const secret = 'postgresql://user:hunter2@db.example.com:5432/plurora'
    const result = createPluroraWorkflowHandlers({ branch: 'test/canary' }).interpret(STAGE, 'codex', completed(envelope({
      findings: [{
        id: 'F-1',
        class: 'BUG',
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
    const result = createPluroraWorkflowHandlers({ branch: 'test/canary' }).interpret(STAGE, 'codex', completed(envelope({
      summary: `connected with ${secret}`,
      evidence: [{ kind: 'log', locator: secret, summary: 'the session' }],
    })))
    expect(JSON.stringify(result)).not.toContain('hunter2')
    expect(JSON.stringify(result)).not.toContain('db.example.com')
  })
})

describe('the Plurora task text', () => {
  it('states the envelope the stage owes back, since nothing else asks for one', () => {
    const text = createPluroraWorkflowHandlers({ branch: 'test/canary' }).task(STAGE, OBJECTIVE)
    expect(text).toContain(RESULT_MARKER)
    expect(text).toContain(OBJECTIVE.requirement)
    expect(text).toContain(STAGE.role)
  })

  it('gives the stage a complete JSON result it can reproduce without guessing fields', () => {
    const text = createPluroraWorkflowHandlers({ branch: 'test/canary' }).task(STAGE, OBJECTIVE)

    expect(text).toContain('exactly one final line')
    expect(text).toContain(`${RESULT_MARKER} {"verdict":"PASS","summary":"one line","findings":[],"evidence":[{"kind":"diff","locator":"repository-relative/path","summary":"one line"}]}`)
  })

  it('tells the stage the mutations it is not the one performing', () => {
    const text = createPluroraWorkflowHandlers({ branch: 'test/canary' }).task(STAGE, OBJECTIVE)
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
    const handlers = createPluroraWorkflowHandlers({ branch: 'test/canary' })
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

  it('publishes on the branch supplied by the host', () => {
    expect(describeAfter(completed(envelope())).branch).toBe('test/canary')
  })

  it('delivers the checkout branch when the objective has an unrelated generated id', () => {
    const handlers = createPluroraWorkflowHandlers({ branch: 'test/trick-harness-v2-activation-rerun' })
    handlers.interpret(STAGE, 'opencode', completed(envelope()))
    const request = handlers.describeDelivery?.({
      stageId: 'delivery-1',
      objective: { ...OBJECTIVE, id: 'opencode-ebc62d40-cc38-4dc6-a6ec-596d8ad96551' },
    })
    expect(request?.branch).toBe('test/trick-harness-v2-activation-rerun')
  })

  it('uses a conventional commit subject independently of the natural-language requirement', () => {
    const requirement = 'Create the approved documentation marker.'
    const handlers = createPluroraWorkflowHandlers({ branch: 'test/canary' })
    handlers.interpret(STAGE, 'codex', completed(envelope()))
    const request = handlers.describeDelivery?.({
      stageId: 'delivery-1',
      objective: { ...OBJECTIVE, requirement },
    })
    expect(request?.message).toBe(
      `chore(harness): deliver approved workflow change\n\nObjective: ${OBJECTIVE.id}\nStage: delivery-1`,
    )
    expect(request?.pullRequest.title).toBe(requirement)
  })

  it('opens against the base branch and says merging stays a human decision', () => {
    const request = describeAfter(completed(envelope()))
    expect(request.pullRequest.base).toBe('main')
    expect(request.pullRequest.body).toContain('human decision')
  })
})

describe('the Plurora repair reading', () => {
  it('believes no repair that did not state its own evidence', () => {
    const handlers = createPluroraWorkflowHandlers({ branch: 'test/canary' })
    const claimed = handlers.repairEvidence?.(STAGE, 'codex', completed(envelope()))
    expect(claimed?.rootCauseAddressed).toBe(false)
    expect(claimed?.regressionTest).toBeUndefined()
  })

  it('reads a stated regression test and focused green run', () => {
    const handlers = createPluroraWorkflowHandlers({ branch: 'test/canary' })
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
    const handlers = createPluroraWorkflowHandlers({ branch: 'test/canary' })
    expect(handlers.diagnose?.(STAGE, 'codex', completed(envelope()))).toBeUndefined()
    expect(handlers.diagnose?.(STAGE, 'codex', completed(envelope({ diagnosis: { cause: 'a guess' } }))))
      .toBeUndefined()
  })
})

describe('reading the approved documents back', () => {
  /** A checkout holding a Spec and a Plan, plus the objective naming them. */
  async function checkout(spec: string, plan: string): Promise<WorkflowObjective> {
    const cwd = await mkdtemp(join(tmpdir(), 'plurora-approved-'))
    await mkdir(join(cwd, 'docs'), { recursive: true })
    await writeFile(join(cwd, 'docs/spec.md'), spec, 'utf8')
    await writeFile(join(cwd, 'docs/plan.md'), plan, 'utf8')
    return {
      ...OBJECTIVE,
      cwd,
      approvedArtifacts: {
        spec: { path: 'docs/spec.md', sha256: sha256(spec) },
        plan: { path: 'docs/plan.md', sha256: sha256(plan) },
      },
    }
  }

  it('reads the documents the objective names and hashes what it actually read', async () => {
    const objective = await checkout(SPEC_TEXT, PLAN_TEXT)
    const read = createPluroraWorkflowHandlers({ branch: 'test/canary' }).loadApprovedArtifacts

    const loaded = await read?.(objective, new AbortController().signal)

    expect(loaded?.specText).toBe(SPEC_TEXT)
    expect(loaded?.planText).toBe(PLAN_TEXT)
    expect(loaded?.specSha256).toBe(objective.approvedArtifacts.spec.sha256)
    expect(loaded?.planSha256).toBe(objective.approvedArtifacts.plan.sha256)
  })

  it('reports the document as it stands now, not as it was approved', async () => {
    // The hash is computed over what was read rather than copied off the
    // objective. Copying it would make every re-read agree with the approval by
    // construction, which is the one thing this read exists to check.
    const objective = await checkout(SPEC_TEXT, PLAN_TEXT)
    await writeFile(join(objective.cwd, 'docs/plan.md'), PLAN_TEXT + '### Task 3: unapproved\n', 'utf8')
    const read = createPluroraWorkflowHandlers({ branch: 'test/canary' }).loadApprovedArtifacts

    const loaded = await read?.(objective, new AbortController().signal)

    expect(loaded?.planSha256).not.toBe(objective.approvedArtifacts.plan.sha256)
  })

  it('refuses a path that leaves the checkout, whatever it is spelled as', async () => {
    // The approved path is data on an objective, and an objective can be opened
    // over the control server. A traversal here would hand a model's stage the
    // text of any file the host process can read, under the name of a Spec.
    const objective = await checkout(SPEC_TEXT, PLAN_TEXT)
    const read = createPluroraWorkflowHandlers({ branch: 'test/canary' }).loadApprovedArtifacts
    for (const path of ['../outside.md', 'docs/../../outside.md', '/etc/passwd', 'docs\\..\\..\\outside.md']) {
      const escaping = {
        ...objective,
        approvedArtifacts: { ...objective.approvedArtifacts, spec: { path, sha256: 'a'.repeat(64) } },
      }
      await expect(read?.(escaping, new AbortController().signal)).rejects.toThrow()
    }
  })

  it('names no path in what it raises, since a refusal is journalled', async () => {
    const objective = await checkout(SPEC_TEXT, PLAN_TEXT)
    const escaping = {
      ...objective,
      approvedArtifacts: {
        ...objective.approvedArtifacts,
        spec: { path: '../secrets/service-role.md', sha256: 'a'.repeat(64) },
      },
    }
    const read = createPluroraWorkflowHandlers({ branch: 'test/canary' }).loadApprovedArtifacts

    const raised = await read?.(escaping, new AbortController().signal).catch((error: unknown) => error)

    expect(raised).toBeInstanceOf(Error)
    expect((raised as Error).message).not.toContain('service-role')
    expect((raised as Error).message).not.toContain(objective.cwd)
  })
})

describe('the Definition of Done these handlers carry', () => {
  it('supplies the profile policy rather than letting a document declare it', () => {
    // The Spec and the Plan are written per objective; the Definition of Done is
    // the standing bar, and a run that could read it out of the same documents
    // it is judged against could lower it in the same pull request.
    expect(createPluroraWorkflowHandlers({ branch: 'test/canary' }).dodObligations).toEqual(pluroraDodObligations)
  })
})

describe('reading a conformance result back', () => {
  const CONFORMANCE: StageSpec = { stageId: 'conformance-1', role: 'conformance' }

  const MANIFEST: ConformanceManifest = Object.freeze({
    specSha256: 'a'.repeat(64),
    planSha256: 'b'.repeat(64),
    obligations: Object.freeze([
      { id: 'ND1', source: 'spec', requirement: 'the column is nullable', required: true },
    ] as const),
    unplannedPaths: Object.freeze([]),
  })

  /** A conformance envelope answering the fixture manifest. */
  function answer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      conformance: {
        specSha256: MANIFEST.specSha256,
        planSha256: MANIFEST.planSha256,
        items: MANIFEST.obligations.map(obligation => ({
          id: obligation.id,
          source: obligation.source,
          requirement: obligation.requirement,
          status: 'PASS',
          implementationEvidence: [],
          verificationEvidence: [],
          summary: 'the migration adds it nullable',
        })),
        verdict: 'PASS',
        summary: 'every approved obligation is met',
        ...overrides,
      },
    }
  }

  it('hands back the stated result so the runtime can hold it to the manifest', () => {
    const handlers = createPluroraWorkflowHandlers({ branch: 'test/canary' })

    const read = handlers.conformance?.(CONFORMANCE, 'codex', completed(answer()), MANIFEST)

    expect(parseConformanceContract(read).verdict).toBe('PASS')
  })

  it('establishes nothing when the stage printed no envelope this host can read', () => {
    const handlers = createPluroraWorkflowHandlers({ branch: 'test/canary' })
    for (const result of [
      { status: 'completed', output: 'I checked everything and it all looks conformant.' } as ExecutorResult,
      completed({ verdict: 'PASS' }),
      completed(answer({ items: 'all of them' })),
    ]) {
      // Not a pass and not a fail: `undefined` is refused upstream as a result
      // that established nothing, which is what an unreadable claim is.
      expect(handlers.conformance?.(CONFORMANCE, 'codex', result, MANIFEST)).toBeUndefined()
    }
  })

  it('reads a result off an errored or cancelled stage as nothing at all', () => {
    const handlers = createPluroraWorkflowHandlers({ branch: 'test/canary' })
    const failed: ExecutorResult = {
      status: 'error',
      output: RESULT_MARKER + ' ' + JSON.stringify(answer()),
      failure: { category: 'transport', availability: true, safeDiagnostic: 'the executor exited' },
    }

    expect(handlers.conformance?.(CONFORMANCE, 'codex', failed, MANIFEST)).toBeUndefined()
    expect(handlers.conformance?.(CONFORMANCE, 'codex', { status: 'aborted', output: '' }, MANIFEST)).toBeUndefined()
  })

  it('never lets the stage claim which documents it was judged against', () => {
    // The hashes identify the approved artifacts. A stage that could state its
    // own would answer obligations from documents nobody approved and still
    // line up with the manifest it was checked against.
    const handlers = createPluroraWorkflowHandlers({ branch: 'test/canary' })
    const forged = answer({ specSha256: 'c'.repeat(64), planSha256: 'd'.repeat(64) })

    const read = parseConformanceContract(handlers.conformance?.(CONFORMANCE, 'codex', completed(forged), MANIFEST))

    expect(read.specSha256).toBe(MANIFEST.specSha256)
    expect(read.planSha256).toBe(MANIFEST.planSha256)
  })

  it('names the approved documents the conformance stage has to answer against', () => {
    // The stage is told which documents state the obligations, because a stage
    // that had to guess would answer whichever ones it happened to open.
    const prompt = createPluroraWorkflowHandlers({ branch: 'test/canary' }).task(CONFORMANCE, OBJECTIVE)

    expect(prompt).toContain('docs/spec.md')
    expect(prompt).toContain('docs/plan.md')
    expect(prompt).toContain('conformance')
  })

  it('tells the conformance stage it may not change the tree it is judging', () => {
    // Stated in the prompt as well as enforced by the permission mode: a stage
    // that edits the branch it is scoring is answering about its own work.
    expect(createPluroraWorkflowHandlers({ branch: 'test/canary' }).task(CONFORMANCE, OBJECTIVE))
      .toMatch(/read-only|may not change/i)
  })

  it('states the envelope a conformance answer owes back', () => {
    const prompt = createPluroraWorkflowHandlers({ branch: 'test/canary' }).task(CONFORMANCE, OBJECTIVE)

    expect(prompt).toContain(RESULT_MARKER)
    expect(prompt).toContain('conformance')
    expect(prompt).toContain('implementationEvidence')
  })
})
