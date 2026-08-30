import { describe, expect, it } from 'vitest'

import type { ConformanceContract, ConformanceObligation } from '@trick-harness/contracts'

import { ConformanceError, buildConformanceManifest, extractApprovedPlanWriteSet, validateConformanceCoverage } from '../src/conformance.ts'

const SPEC_SHA = 'a'.repeat(64)
const PLAN_SHA = 'b'.repeat(64)

const SPEC = [
  '# Conformance spec',
  '',
  '## Acceptance criteria',
  '',
  '- **ND1:** the host refuses to start without a deployment file',
  '- **CF2:** conformance never holds workspace write authority',
  '  - a nested bullet that states no criterion',
  '- **R-10:** every rejection names a field without quoting its value',
  '',
  'Prose that mentions ND1 again without declaring it.',
].join('\n')

const PLAN = [
  '# Conformance plan',
  '',
  '### Task 1: Add the conformance role',
  '',
  'Some body text.',
  '',
  '#### Task 9: a deeper heading that declares no task',
  '',
  '### Task 2: Build the deterministic manifest',
].join('\n')

const DOD: readonly ConformanceObligation[] = [
  { id: 'DOD-GATES', source: 'dod', requirement: 'every deterministic gate passes', required: true },
]

const input = { specText: SPEC, planText: PLAN, specSha256: SPEC_SHA, planSha256: PLAN_SHA, dod: DOD }

/**
 * A result that answers every obligation the fixture manifest states.
 *
 * @param status - Status to answer each obligation with.
 * @returns The contract.
 */
function answerAll(status: ConformanceContract['items'][number]['status'] = 'PASS'): ConformanceContract {
  const manifest = buildConformanceManifest(input)
  return {
    specSha256: SPEC_SHA,
    planSha256: PLAN_SHA,
    items: manifest.obligations.map(obligation => ({
      id: obligation.id,
      source: obligation.source,
      requirement: obligation.requirement,
      status,
      implementationEvidence: [],
      verificationEvidence: [],
      summary: 'answered',
    })),
    verdict: 'PASS',
    summary: 'all obligations answered',
  }
}

describe('building the obligation set the implementation is judged against', () => {
  it('reads every declared Spec criterion, and only the declared ones', () => {
    // The obligation set is what conformance is scored against, so a criterion
    // missed here is one nothing ever has to satisfy. Prose that names an id it
    // does not declare is not a criterion, and neither is a nested bullet.
    const spec = buildConformanceManifest(input).obligations.filter(o => o.source === 'spec')
    expect(spec.map(o => o.id)).toEqual(['ND1', 'CF2', 'R-10'])
    expect(spec[0]?.requirement).toBe('the host refuses to start without a deployment file')
    expect(spec.every(o => o.required)).toBe(true)
  })

  it('reads every Plan task heading at the depth the plans are written at', () => {
    const plan = buildConformanceManifest(input).obligations.filter(o => o.source === 'plan')
    expect(plan.map(o => o.id)).toEqual(['PLAN-TASK-1', 'PLAN-TASK-2'])
    expect(plan[1]?.requirement).toBe('Build the deterministic manifest')
  })

  it('carries the supplied Definition of Done through unchanged', () => {
    const dod = buildConformanceManifest(input).obligations.filter(o => o.source === 'dod')
    expect(dod).toEqual(DOD)
  })

  it('orders the obligations the same way for the same documents', () => {
    // The manifest is journalled and compared across runs. If the order came
    // from a set or a map's iteration, two runs over one pair of documents
    // would produce two manifests and neither would be the approved one.
    const once = buildConformanceManifest(input)
    const twice = buildConformanceManifest(input)
    expect(once.obligations.map(o => o.id)).toEqual(twice.obligations.map(o => o.id))
    expect(once.obligations.map(o => o.id))
      .toEqual(['ND1', 'CF2', 'R-10', 'PLAN-TASK-1', 'PLAN-TASK-2', 'DOD-GATES'])
  })

  it('carries the hashes that say which documents these obligations came from', () => {
    const manifest = buildConformanceManifest(input)
    expect(manifest.specSha256).toBe(SPEC_SHA)
    expect(manifest.planSha256).toBe(PLAN_SHA)
  })

  it('refuses a duplicate id, since one id would then mean two obligations', () => {
    const specText = `${SPEC}\n- **ND1:** a second criterion under an id already taken`
    expect(() => buildConformanceManifest({ ...input, specText }))
      .toThrow(new ConformanceError('duplicate-obligation', 'the approved artifacts declare one id twice'))
    const dod = [...DOD, { id: 'ND1', source: 'dod', requirement: 'collides', required: true } as const]
    expect(() => buildConformanceManifest({ ...input, dod })).toThrow(ConformanceError)
  })

  it('refuses artifacts that declare nothing, rather than passing a run that proved nothing', () => {
    // An empty obligation set makes every implementation conformant, which is
    // the opposite of what this gate is for. Far likelier is that the document
    // is not written the way the extraction reads, and that has to be loud.
    expect(() => buildConformanceManifest({ ...input, specText: '# no criteria here' }))
      .toThrow(new ConformanceError('no-obligations', 'the approved Spec declares no acceptance criterion'))
    expect(() => buildConformanceManifest({ ...input, planText: '# no tasks here' }))
      .toThrow(new ConformanceError('no-obligations', 'the approved Plan declares no task'))
  })

  it('hands back a manifest nothing downstream can edit', () => {
    const manifest = buildConformanceManifest(input)
    expect(Object.isFrozen(manifest)).toBe(true)
    expect(Object.isFrozen(manifest.obligations)).toBe(true)
    expect(Object.isFrozen(manifest.obligations[0])).toBe(true)
  })

  it('reads only the documents it was handed, and reaches no filesystem or model', () => {
    // Stated as a property of the module rather than of one call: the manifest
    // is the deterministic half of this gate, and a read of anything not passed
    // in is a way for a run's answer to depend on something nobody approved.
    const source = String(buildConformanceManifest)
    expect(source).not.toMatch(/readFile|require|import\(/)
  })
})

describe('holding a returned conformance result to the obligations that were set', () => {
  it('accepts a result that answers every obligation exactly once', () => {
    const validated = validateConformanceCoverage(buildConformanceManifest(input), answerAll())
    expect(validated.items).toHaveLength(6)
    expect(validated.verdict).toBe('PASS')
  })

  it('refuses a result that left an obligation unanswered', () => {
    // Silence is not conformance. A model that answered five of six obligations
    // has said nothing about the sixth, and a gate that let that PASS would be
    // scoring the implementation against a set the model chose.
    const result = answerAll()
    const short = { ...result, items: result.items.slice(1) }
    expect(() => validateConformanceCoverage(buildConformanceManifest(input), short))
      .toThrow(new ConformanceError('unanswered-obligation', 'the result leaves an approved obligation unanswered'))
  })

  it('refuses a result that answered one obligation twice', () => {
    const result = answerAll()
    const doubled = { ...result, items: [...result.items, result.items[0]!] }
    expect(() => validateConformanceCoverage(buildConformanceManifest(input), doubled))
      .toThrow(ConformanceError)
  })

  it('refuses an answer to an obligation nobody set', () => {
    const result = answerAll()
    const invented = {
      ...result,
      items: [...result.items, { ...result.items[0]!, id: 'ND99' }],
    }
    expect(() => validateConformanceCoverage(buildConformanceManifest(input), invented))
      .toThrow(new ConformanceError('unknown-obligation', 'the result answers an obligation the artifacts never set'))
  })

  it('refuses an answer that restated the obligation as something easier', () => {
    // The requirement travels with the answer so a person reading the journal
    // sees what was judged. If the model may rewrite it, it can answer a
    // requirement it invented under the id of the one that was approved.
    const result = answerAll()
    for (const field of ['requirement', 'source'] as const) {
      const edited = {
        ...result,
        items: result.items.map((item, index) =>
          index === 0 ? { ...item, [field]: field === 'source' ? 'dod' : 'something easier' } : item),
      }
      expect(() => validateConformanceCoverage(buildConformanceManifest(input), edited))
        .toThrow(new ConformanceError('altered-obligation', 'the result restates an approved obligation'))
    }
  })

  it('refuses a result computed against different documents than the approved ones', () => {
    const manifest = buildConformanceManifest(input)
    for (const hashes of [{ specSha256: 'c'.repeat(64) }, { planSha256: 'c'.repeat(64) }]) {
      expect(() => validateConformanceCoverage(manifest, { ...answerAll(), ...hashes }))
        .toThrow(new ConformanceError('artifact-mismatch', 'the result was produced against other documents'))
    }
  })

  it('names what was refused without quoting the requirement it was refused over', () => {
    // Rejections are journalled, and a requirement is free text a secret can
    // reach. The code says which rule failed; the payload stays out of it.
    const result = answerAll()
    const secret = 'sk-live-000111222333'
    const edited = {
      ...result,
      items: result.items.map((item, index) => index === 0 ? { ...item, requirement: secret } : item),
    }
    try {
      validateConformanceCoverage(buildConformanceManifest(input), edited)
      expect.unreachable('the altered obligation should have been refused')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConformanceError)
      expect((error as Error).message).not.toContain(secret)
    }
  })
})

describe('reading the write set the approved plan named', () => {
  const APPROVED = [
    '# A plan',
    '',
    'Prose before any task.',
    '',
    '**Files:**',
    '- Modify: `docs/not-a-task.md`',
    '',
    '### Task 1: First task',
    '',
    '**Files:**',
    '- Create: `src/lib/auth/session.ts`',
    '- Modify: `src/proxy.ts`',
    '- Test: `src/lib/auth/tests/session.spec.ts`',
    '- Delete: `src/lib/auth/legacy.ts`',
    '',
    '**Dependencies:**',
    '',
    '- Modify: `src/never-approved.ts`',
    '',
    '- [ ] **Step 1: do the thing** in `src/also-not-approved.ts`',
    '',
    '### Task 2: Second task',
    '',
    '**Files:**',
    '- Modify: `src/proxy.ts:120-145`',
    '- Create: `supabase/migrations/0001_init.sql`',
  ].join('\n')

  it('reads every declared entry kind and says each path once', () => {
    expect(extractApprovedPlanWriteSet(APPROVED)).toStrictEqual([
      'src/lib/auth/legacy.ts',
      'src/lib/auth/session.ts',
      'src/lib/auth/tests/session.spec.ts',
      'src/proxy.ts',
      'supabase/migrations/0001_init.sql',
    ])
  })

  it('reads only Files blocks that belong to a task', () => {
    // A Files block in the preamble is a summary of the whole plan, and a
    // `- Modify:` line in prose is prose. Counting either would approve a path
    // no task committed to, which is exactly the drift this set detects.
    const set = extractApprovedPlanWriteSet(APPROVED)

    expect(set).not.toContain('docs/not-a-task.md')
    expect(set).not.toContain('src/never-approved.ts')
    expect(set).not.toContain('src/also-not-approved.ts')
  })

  it('drops a line locator only after the path has been read', () => {
    expect(extractApprovedPlanWriteSet(APPROVED)).toContain('src/proxy.ts')
  })

  it('returns nothing when the plan names no file', () => {
    // Empty is the honest answer and the safe one: it means the plan approved
    // no path, so every delivered path is reported as unplanned. Guessing a
    // set here would approve work nobody wrote down.
    expect(extractApprovedPlanWriteSet('### Task 1: A task\n\nNo files block.\n')).toStrictEqual([])
  })

  it('refuses a declared entry that is not a repository-relative path', () => {
    for (const entry of ['/etc/passwd', 'C:/Users/x/secrets.ts', '../outside/x.ts', 'src/../../x.ts']) {
      expect(() => extractApprovedPlanWriteSet(`### Task 1: T\n\n**Files:**\n- Modify: \`${entry}\`\n`), entry)
        .toThrow(ConformanceError)
    }
  })

  it('refuses a pattern where the plan owes a concrete file', () => {
    // A glob is a promise to touch an unknown number of files, and a planned
    // set that contains one cannot be compared with a delivered set at all.
    for (const entry of ['src/**/*.ts', 'src/x?.ts', 'src/[ab].ts', 'src/{a,b}.ts']) {
      expect(() => extractApprovedPlanWriteSet(`### Task 1: T\n\n**Files:**\n- Modify: \`${entry}\`\n`), entry)
        .toThrow(ConformanceError)
    }
  })

  it('refuses a declared entry whose path it could not read at all', () => {
    for (const line of ['- Modify: src/unquoted.ts', '- Create: `src/unclosed.ts', '- Delete: ``']) {
      expect(() => extractApprovedPlanWriteSet(`### Task 1: T\n\n**Files:**\n${line}\n`), line)
        .toThrow(ConformanceError)
    }
  })

  it('names what it refused without quoting the path', () => {
    try {
      extractApprovedPlanWriteSet('### Task 1: T\n\n**Files:**\n- Modify: `../keys/sk-live-000111.ts`\n')
      expect.unreachable('the traversing path should have been refused')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConformanceError)
      expect((error as Error).message).not.toContain('sk-live')
    }
  })

  it('reads one path as one path however a plan spelled it', () => {
    const plan = [
      '### Task 1: T',
      '',
      '**Files:**',
      '- Create: `src\\lib\\auth\\session.ts`',
      '- Modify: `./src/lib/auth/session.ts`',
    ].join('\n')

    expect(extractApprovedPlanWriteSet(plan)).toStrictEqual(['src/lib/auth/session.ts'])
  })

  it('carries no document content beyond the paths', () => {
    const plan = '### Task 1: Rotate the service role key\n\n**Files:**\n- Modify: `src/x.ts`\n'

    expect(JSON.stringify(extractApprovedPlanWriteSet(plan))).not.toContain('service role')
  })
})
