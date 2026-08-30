/**
 * What Plurora actually publishes on a pull request, adversarially.
 *
 * The composition spec proves the deployment comes up; this one drives the same
 * real profile over a scripted GitHub remote and asks the only question a
 * branch-protection rule asks: which status states reached the pull request,
 * and for which commit. Nothing here mocks readiness — every run is a real run
 * of the real lifecycle, and the fakes sit at the subprocess seam, where a
 * remote would be. A test that stubbed the readiness predicate would prove that
 * a run which decides it is ready publishes success, which is the one thing
 * nobody doubts.
 *
 * @module profiles/plurora/tests/certification
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { composeHarness } from '@trick-harness/composition'
import type { ComposedHarness } from '@trick-harness/composition'
import type {
  ConformanceManifest, DiagnosisContract, EvidenceRef, Finding, StageResult, WorkflowObjective, WorkflowOutcome,
} from '@trick-harness/contracts'
import type { ExecutorProvider } from '@trick-harness/executor'
import { projectWorkflow } from '@trick-harness/journal'
import { DEFAULT_MODEL_REGISTRY } from '@trick-harness/routing'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { pluroraProfile } from '../profile.ts'

/** The product repository this deployment is allowed to certify into. */
const REPOSITORY = 'adsonpatrick/neuro-via'

/** The exact name the branch-protection rule being answered is configured with. */
const CONTEXT = 'plurora/harness-certification'

/** The commit the scripted checkout is on at the start of every run. */
const REVISION = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** A commit somebody else pushed while the run was reading the first one. */
const MOVED_REVISION = '9daeafb9864cf43055ae93beb0afd6c7d144bfa4'

/** The fixed strings the capability is allowed to publish, by state. */
const DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  pending: 'Harness engineering certification in progress',
  success: 'Harness engineering certification passed',
  failure: 'Harness engineering certification did not pass',
  error: 'Harness engineering certification could not complete',
})

const ARTIFACTS = Object.freeze({
  specText: '- **ND1:** the work satisfies the approved specification',
  planText: '### Task 1: do the approved work',
  specSha256: 'a'.repeat(64),
  planSha256: 'b'.repeat(64),
})

/** A conformance reading that answers every obligation the manifest states. */
const CONFORMS = {
  loadApprovedArtifacts: async (): Promise<typeof ARTIFACTS> => ARTIFACTS,
  conformance: (
    _stage: unknown,
    _executor: string,
    _result: unknown,
    manifest: ConformanceManifest,
  ): unknown => ({
    specSha256: manifest.specSha256,
    planSha256: manifest.planSha256,
    items: manifest.obligations.map(obligation => ({
      id: obligation.id,
      source: obligation.source,
      requirement: obligation.requirement,
      status: 'PASS',
      implementationEvidence: [],
      verificationEvidence: [],
      summary: 'satisfied',
    })),
    verdict: 'PASS',
    summary: 'the branch satisfies the approved artifacts',
  }),
}

const OBJECTIVE: WorkflowObjective = Object.freeze({
  id: 'wf-plurora-certification',
  cwd: '/repo',
  requirement: 'add the thing',
  risk: 'low',
  workload: 'medium',
  profileId: 'plurora',
  approvedArtifacts: {
    spec: { path: 'docs/spec.md', sha256: ARTIFACTS.specSha256 },
    plan: { path: 'docs/plan.md', sha256: ARTIFACTS.planSha256 },
  },
})

const EVIDENCE: EvidenceRef = Object.freeze({ kind: 'test', locator: 'thing.spec.ts', summary: 'red' })

/** A diagnosis good enough for the repair path to be allowed to start. */
const DIAGNOSIS: DiagnosisContract = Object.freeze({
  symptom: 'the thing is wrong',
  reproduction: 'vitest run thing.spec.ts',
  expectedVsActual: 'expected right, got wrong',
  observedEvidence: Object.freeze([EVIDENCE]),
  affectedBoundary: 'src/thing.ts',
  ruledOutHypotheses: Object.freeze(['the caller']),
  rootCauseHypothesis: 'the thing rounds too early',
  confidence: 'high',
  regressionTestSeam: 'thing.spec.ts',
  minimalRepairSurface: 'thing.ts',
  unknowns: Object.freeze([]),
  securityRelevance: 'none',
})

/** What the repair reports having done, in the shape the runner requires. */
const REPAIRED = Object.freeze({
  regressionTest: EVIDENCE,
  focusedGreen: Object.freeze({ kind: 'test' as const, locator: 'thing.spec.ts', summary: 'green' }),
  rootCauseAddressed: true,
})

/** One confirmed defect, shaped as a certifying stage would report it. */
const BUG: Finding = Object.freeze({
  id: 'f-1',
  class: 'BUG',
  raisedBy: 'review',
  summary: 'the thing rounds too early',
  confirmed: true,
  evidence: Object.freeze([EVIDENCE]),
})

/** One status the scripted remote accepted, as it was constructed. */
interface Post {
  readonly state: string
  readonly context: string
  readonly description: string
  readonly targetUrl: string
  readonly revision: string
}

/** What a scripted remote is currently telling the checkout and the API. */
interface RemoteState {
  /** The commit `git rev-parse` reports, which a test may move mid-run. */
  head: string
  /** What the pull request API reports for state, base and head. */
  pullRequest: { state: string; base: string; headRef: string; sha: string }
  /** What `gh repo view` says this checkout is. */
  repository: string
  /** Whether the status POST is refused, standing in for auth or network loss. */
  postFails: boolean
}

/** A scripted GitHub, and the record of every status that reached it. */
interface Remote {
  readonly state: RemoteState
  readonly posts: Post[]
  /** Every command the run constructed, for the assertions about leakage. */
  readonly issued: SubprocessSpawnSpec[]
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
}

/**
 * A settled command over a fixed answer, shaped like the subprocess seam.
 * @param stdout - what the command wrote.
 * @param exitCode - how it ended.
 * @returns the handle.
 */
function answered(stdout: string, exitCode = 0): SubprocessHandle {
  const reader = (text: string) => ({ readFrom: () => ({ text, nextOffset: text.length, lossy: false }) })
  return {
    pid: -1,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: { stdout: reader(stdout), stderr: reader('') },
    done: Promise.resolve({ exitCode, signal: null }),
    terminate: () => {},
    waitForExit: () => Promise.resolve(true),
  }
}

/** The value of one `-f key=value` pair in a constructed argv. */
function field(argv: readonly string[], key: string): string {
  const at = argv.findIndex(word => word.startsWith(`${key}=`))
  return at === -1 ? '' : (argv[at]?.slice(key.length + 1) ?? '')
}

/**
 * A GitHub that answers delivery and certification and remembers the statuses.
 *
 * Stateful on purpose: the read-back after a POST answers with what was really
 * posted, so a run that published one state and reported another has somewhere
 * to be caught. The commit a status is filed under is read off the POST path
 * rather than assumed, which is what lets the moved-head case be described
 * without the test choosing the answer.
 * @param over - what this remote reports differently from a healthy one.
 * @returns the remote.
 */
function remote(over: Partial<RemoteState> = {}): Remote {
  const state: RemoteState = {
    head: REVISION,
    pullRequest: { state: 'open', base: 'main', headRef: 'feature', sha: REVISION },
    repository: REPOSITORY,
    postFails: false,
    ...over,
  }
  const posts: Post[] = []
  const issued: SubprocessSpawnSpec[] = []
  // What the index holds, echoed back from what was actually staged rather
  // than fixed here: the bar a change buys is read off the delivered paths, so
  // a fake that answered with its own list would decide which stages ran.
  let staged: readonly string[] = []
  const spawn = (spec: SubprocessSpawnSpec): SubprocessHandle => {
    issued.push(spec)
    const argv = spec.argv.join(' ')
    if (spec.argv[0] === 'git' && spec.argv[1] === 'add') {
      staged = spec.argv.slice(spec.argv.indexOf('--') + 1)
      return answered('')
    }
    if (argv.includes('--abbrev-ref') || argv.includes('branch --show-current')) return answered('feature')
    if (argv.includes('diff --cached')) return answered(staged.join('\n'))
    if (argv.includes('rev-parse')) return answered(state.head)
    if (argv.startsWith('gh repo view')) return answered(state.repository)
    if (argv.startsWith('gh pr view')) {
      return answered(JSON.stringify({
        number: 7,
        url: `https://github.com/${REPOSITORY}/pull/7`,
        state: state.pullRequest.state.toUpperCase(),
        headRefName: state.pullRequest.headRef,
      }))
    }
    if (argv.includes('--method POST') && argv.includes('/statuses/')) {
      if (state.postFails) return answered('', 1)
      const path = spec.argv.find(word => word.includes('/statuses/')) ?? ''
      posts.push({
        state: field(spec.argv, 'state'),
        context: field(spec.argv, 'context'),
        description: field(spec.argv, 'description'),
        targetUrl: field(spec.argv, 'target_url'),
        revision: path.slice(path.lastIndexOf('/') + 1),
      })
      return answered('')
    }
    const read = /\/commits\/([0-9a-f]{40})\/statuses/.exec(argv)
    if (read !== null) {
      const filed = posts.filter(post => post.revision === read[1])
      return answered(JSON.stringify(
        [...filed].reverse().map((post, at) => ({ id: 1000 + at, state: post.state, context: post.context })),
      ))
    }
    if (argv.includes('/pulls/7')) {
      return answered(JSON.stringify({
        state: state.pullRequest.state,
        base: { ref: state.pullRequest.base },
        head: { ref: state.pullRequest.headRef, sha: state.pullRequest.sha },
      }))
    }
    return answered('')
  }
  return { state, posts, issued, spawn }
}

/**
 * A product boundary that answers whatever the test told it to.
 * @param name - the executor name.
 * @param output - what every start of it returns.
 * @returns the provider.
 */
function scriptedProvider(name: string, output: string): ExecutorProvider {
  return {
    name,
    capabilities: {
      modelOverride: true,
      reasoningEffort: true,
      permissionModes: ['read-only', 'workspace-write'],
    },
    start: async () => ({ status: 'completed', output }),
  }
}

/** Read one stage's result the way a run where everything passed reads it. */
function passing(stage: { role: string }, executor: string): StageResult {
  return { role: stage.role, executor, verdict: 'PASS', summary: `${stage.role} passed`, findings: [], evidence: [] }
}

/**
 * All-pass, except for one role that reports the verdict a test needs.
 * @param role - the role to answer differently.
 * @param verdict - what that role concludes about the branch.
 * @returns the interpreter.
 */
function failing(
  role: string,
  verdict: 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED',
): (stage: { role: string; stageId: string }, executor: string) => StageResult {
  return (stage, executor) => stage.role === role
    ? { role: stage.role, executor, verdict, summary: `${stage.role} did not pass`, findings: [], evidence: [] }
    : passing(stage, executor)
}

/** Everything one scripted run of the real Plurora profile needs told to it. */
interface RunOptions {
  /** How each stage result is read, when all-pass is not what the test needs. */
  readonly interpret?: (stage: { role: string; stageId: string }, executor: string) => StageResult
  /** The files the delivery reports having changed, which set the bar. */
  readonly files?: readonly string[]
  /** What the executors write, for the tests about what may not be copied out. */
  readonly output?: string
  /** Called as each delivery is described, so a test can move the branch. */
  readonly redeliver?: () => void
}

describe('what Plurora actually publishes on a pull request', () => {
  let harnesses: ComposedHarness[] = []

  afterEach(async () => {
    const open = harnesses
    harnesses = []
    await Promise.all(open.map(async harness => harness.dispose()))
  })

  /**
   * Compose the real Plurora profile over one scripted remote and run it.
   * @param github - the remote every command is answered by.
   * @param options - what this run does differently.
   * @returns the outcome and the session it was journalled into.
   */
  async function run(
    github: Remote,
    options: RunOptions = {},
  ): Promise<{ outcome: WorkflowOutcome; session: Session }> {
    const session = Session.create(SessionId('plurora-certification'))
    const harness = composeHarness({
      profile: pluroraProfile,
      registry: DEFAULT_MODEL_REGISTRY,
      session,
      flush: async () => true,
      workflow: {
        interpret: options.interpret ?? passing,
        task: stage => `${stage.role}: do the work`,
        // Supplied only where a test is about the bar a change buys, because
        // measuring it is what makes the run plan the stages that certify it.
        // The paths are read from the delivery rather than declared twice: a
        // reader that could disagree with what was staged would be choosing
        // which certifying stages ran.
        ...options.files === undefined
          ? {}
          : {
            changeImpact: {
              plannedPaths: async () => [...options.files ?? []],
              actualPaths: async () => [...options.files ?? []],
            },
          },
        ...CONFORMS,
        diagnose: () => DIAGNOSIS,
        repairEvidence: () => REPAIRED,
        describeDelivery: (input) => {
          options.redeliver?.()
          return {
            branch: 'feature',
            files: [...options.files ?? ['src/thing.ts']],
            message: `deliver ${input.stageId}`,
            pullRequest: { title: 'the thing', body: 'what it does', base: 'main' },
          }
        },
      },
      integrations: {
        github: { cwd: '/repo', spawn: github.spawn },
        githubCertification: {
          cwd: '/repo',
          repository: REPOSITORY,
          baseBranch: 'main',
          context: CONTEXT,
          spawn: github.spawn,
        },
      },
      providers: {
        extraProviders: [
          scriptedProvider('opencode', options.output ?? 'opencode ran'),
          scriptedProvider('codex', options.output ?? 'codex ran'),
        ],
      },
    })
    harnesses.push(harness)
    const outcome = await harness.run(OBJECTIVE)
    return { outcome, session }
  }

  it('marks the delivered commit pending and answers it with success only once everything passed', async () => {
    const github = remote()

    const { outcome } = await run(github)

    expect(outcome.state).toBe('completed')
    expect(github.posts.map(post => post.state)).toEqual(['pending', 'success'])
    // One commit, one context, and the description GitHub shows is the fixed
    // sentence for the state rather than anything the run had to say.
    for (const post of github.posts) {
      expect(post.revision).toBe(REVISION)
      expect(post.context).toBe(CONTEXT)
      expect(post.description).toBe(DESCRIPTIONS[post.state])
      expect(post.targetUrl).toBe(`https://github.com/${REPOSITORY}/pull/7`)
    }
  })

  it('never certifies success when conformance did not stand for the delivered branch', async () => {
    // Every other stage green, which is the case this gate exists for: CI is
    // the reading a reviewer already trusts, and it says nothing about whether
    // the branch is what the approved spec and plan asked for.
    const github = remote()

    const { outcome } = await run(github, { interpret: failing('conformance', 'FAIL') })

    expect(github.posts.map(post => post.state)).toEqual(['pending', 'failure'])
    expect(outcome.verdict).not.toBe('PASS')
  })

  it('never certifies success when conformance established nothing either way', async () => {
    // The other way conformance can be missing, and the one a run can actually
    // produce: the stage ran, and it came back without a claim. Ready is the
    // claim that the branch satisfies what was approved, and silence is not it.
    const github = remote()

    await run(github, { interpret: failing('conformance', 'INCONCLUSIVE') })

    expect(github.posts.map(post => post.state)).toEqual(['pending', 'failure'])
  })

  it('never certifies success when conformance passed but the final verification did not', async () => {
    // The run closes on a verification that ran after every certifying reading.
    // A conformance PASS with nothing standing behind it is a claim about a
    // tree that was still being worked on afterwards.
    const github = remote()

    await run(github, {
      interpret: (stage, executor) => stage.stageId.startsWith('verify-final')
        ? { role: stage.role, executor, verdict: 'FAIL', summary: 'the final check did not pass', findings: [], evidence: [] }
        : passing(stage, executor),
    })

    expect(github.posts.map(post => post.state)).toEqual(['pending', 'failure'])
  })

  it('never certifies success when the security reading an auth change requires did not pass', async () => {
    // The delivered paths, not the objective's own word about itself, are what
    // buys the security stage: this objective was opened as low-risk.
    const github = remote()

    const { outcome } = await run(github, {
      files: ['src/lib/auth/session.ts'],
      interpret: failing('security', 'FAIL'),
    })

    // The stage really was planned, which is half of what this row is about: a
    // security reading nobody asked for is not a security reading that passed.
    expect(outcome.stages.map(stage => stage.role)).toContain('security')

    expect(github.posts.map(post => post.state)).toEqual(['pending', 'failure'])
  })

  it('publishes failure rather than success for a run that ended blocked', async () => {
    const github = remote()

    const { outcome } = await run(github, { interpret: failing('review', 'BLOCKED') })

    expect(outcome.verdict).toBe('BLOCKED')
    expect(github.posts.map(post => post.state)).toEqual(['pending', 'failure'])
  })

  it('puts the commit back to pending even where an older success is already standing on it', async () => {
    const github = remote()
    // A green certification from a previous run of the same commit, which is
    // exactly what re-running an already-certified branch starts from. Left
    // standing, it would keep the merge button on for the whole of the new run.
    github.posts.push({
      state: 'success',
      context: CONTEXT,
      description: DESCRIPTIONS['success'] ?? '',
      targetUrl: `https://github.com/${REPOSITORY}/pull/7`,
      revision: REVISION,
    })

    await run(github, { interpret: failing('conformance', 'FAIL') })

    // Latest wins on GitHub, and this run's first act was to make the latest
    // one pending. The stale success never described the work being done now.
    expect(github.posts.map(post => post.state)).toEqual(['success', 'pending', 'failure'])
  })

  it('refuses to certify a head that moved out from under the run', async () => {
    const github = remote()

    const { outcome } = await run(github, {
      interpret: (stage, executor) => {
        // Somebody pushed while the certifying half was reading the branch.
        if (stage.role === 'conformance') {
          github.state.head = MOVED_REVISION
          github.state.pullRequest.sha = MOVED_REVISION
        }
        return passing(stage, executor)
      },
    })

    // Everything this run read was about the commit it delivered, and the
    // branch it would now be certifying is one nothing here has looked at. The
    // pending status stays where it is, which is what keeps the merge button
    // off until a person looks.
    expect(github.posts.map(post => post.state)).toEqual(['pending'])
    expect(github.posts.at(-1)?.revision).toBe(REVISION)
    expect(outcome.state).not.toBe('completed')
  })

  it('marks the branch a repair replaced pending again, and never certifies the one it replaced', async () => {
    const github = remote()
    let deliveries = 0
    let reviews = 0

    const { outcome } = await run(github, {
      // A repair publishes a second branch, and the commit the first pending
      // status was filed against is not the commit anybody would now be asked
      // to merge.
      redeliver: () => {
        deliveries += 1
        if (deliveries === 2) {
          github.state.head = MOVED_REVISION
          github.state.pullRequest.sha = MOVED_REVISION
        }
      },
      interpret: (stage, executor) => {
        if (stage.role !== 'review') return passing(stage, executor)
        reviews += 1
        return reviews === 1
          ? { role: stage.role, executor, verdict: 'FAIL', summary: 'a defect', findings: [BUG], evidence: [] }
          : passing(stage, executor)
      },
    })

    expect(outcome.state).toBe('completed')
    expect(github.posts.map(post => post.state)).toEqual(['pending', 'pending', 'success'])
    expect(github.posts.map(post => post.revision)).toEqual([REVISION, MOVED_REVISION, MOVED_REVISION])
    // What was certified is the commit the second delivery produced. The first
    // one keeps the pending it was given, which is not a merge signal.
    expect(github.posts.filter(post => post.revision === REVISION).map(post => post.state)).toEqual(['pending'])
  })

  it('publishes nothing at all when the checkout is not the repository it certifies', async () => {
    const github = remote({ repository: 'someone-else/a-fork' })

    const { outcome } = await run(github)

    expect(github.posts).toEqual([])
    expect(outcome.state).not.toBe('completed')
  })

  it('publishes nothing at all when the pull request targets a base this deployment does not certify', async () => {
    const github = remote({ pullRequest: { state: 'open', base: 'release/2.0', headRef: 'feature', sha: REVISION } })

    const { outcome } = await run(github)

    expect(github.posts).toEqual([])
    expect(outcome.state).not.toBe('completed')
  })

  it('publishes nothing at all when the pull request is no longer open', async () => {
    const github = remote({ pullRequest: { state: 'closed', base: 'main', headRef: 'feature', sha: REVISION } })

    const { outcome } = await run(github)

    expect(github.posts).toEqual([])
    expect(outcome.state).not.toBe('completed')
  })

  it('fails closed when the status cannot be published at all', async () => {
    // Credentials gone, network gone, the API refusing: from here they are the
    // same event, and none of them is a reason to conclude a branch is ready.
    const github = remote({ postFails: true })

    const { outcome, session } = await run(github)

    expect(github.posts).toEqual([])
    expect(outcome.state).not.toBe('completed')
    expect(outcome.verdict).not.toBe('PASS')
    // And nothing is left half-open: a capability window that never closed
    // would tell the next restart a status may be standing when none is.
    expect(projectWorkflow(session.events, OBJECTIVE.id).openCapabilities).toEqual([])
  })

  it('copies nothing from the run into the status, however loudly the run says it', async () => {
    const secret = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz'
    const path = '/home/operator/checkouts/neuro-via/.env'
    const github = remote()

    await run(github, {
      output: `wrote ${path} with ${secret}`,
      interpret: (stage, executor) => ({
        role: stage.role,
        executor,
        verdict: 'PASS',
        summary: `${stage.role}: ${secret} at ${path}`,
        findings: [],
        evidence: [],
      }),
    })

    expect(github.posts.map(post => post.state)).toEqual(['pending', 'success'])
    // A status carries a state, a context, a fixed description and the pull
    // request's own URL, all chosen from the state alone. There is no field for
    // any of this to travel in, including the one it would be most natural to
    // fill from the run.
    const everything = JSON.stringify(github.issued.map(spec => spec.argv))
    expect(everything).not.toContain(secret)
    expect(everything).not.toContain('.env')
    for (const post of github.posts) expect(post.description).toBe(DESCRIPTIONS[post.state])
  })
})
