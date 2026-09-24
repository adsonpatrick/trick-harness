/** Keyless host workflow over real temporary Git repositories and recorded provider responses. */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { OpencodeAdapter } from '@trick-harness/provider-opencode'
import { OpencodeStartupTimeoutError } from '@trick-harness/provider-opencode'
import { pluroraProfile } from '../../../profiles/plurora/profile.ts'
import { PLURORA_SEMANTIC_TIERS } from '../src/config.ts'
import { startPluroraHost } from '../src/main.ts'
import { RESULT_MARKER } from '../src/workflow-handlers.ts'

const MARKER = 'docs/verification/canary/marker.md'
const CONTENT = 'Documentation-only activation marker.\n'
const BRANCH = 'test/activation-canary'
const SPEC = '# Canary\n\n- **C1:** Create the documentation marker.\n'
const PLAN = `# Plan\n\n### Task 1: Create marker\n\n- Create: \`${MARKER}\`\n`
const RESULT = `${RESULT_MARKER} ${JSON.stringify({
  verdict: 'PASS', summary: 'Recorded provider response: marker verified.', findings: [],
  evidence: [{ kind: 'diff', locator: MARKER, summary: 'Documentation marker.' }],
})}`
const expected = resolve(import.meta.dirname, '../../../scripts/snapshots/plurora-delivery-branch/workflow.expected.json')

/** Run only real Git operations, rooted in the fixture checkout. */
function git(cwd: string, ...argv: string[]): string {
  const result = spawnSync('git', argv, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`fixture git failed: ${argv[0]}: ${result.stderr}`)
  return result.stdout.trim()
}

/** Wrap a settled command in the host's managed subprocess interface. */
function settled(stdout: string, exitCode: number | null): SubprocessHandle {
  return {
    pid: 1, stdin: undefined, stdout: undefined, stderr: undefined,
    collected: { stdout: { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) } },
    done: Promise.resolve({ exitCode, signal: null }),
    terminate() {},
    waitForExit: async () => true,
  }
}

describe('Plurora checkout delivery runnable snapshot', () => {
  it('delivers its bound branch and refuses protected, detached or changed checkouts', async () => {
    const transcript: unknown[] = []
    for (const scenario of ['feature', 'switched', 'protected', 'detached', 'startup-timeout'] as const) {
      const root = await mkdtemp(join(tmpdir(), 'plurora-delivery-'))
      const project = join(root, 'checkout')
      const remote = join(root, 'origin.git')
      let host: Awaited<ReturnType<typeof startPluroraHost>> | undefined
      try {
        await mkdir(project)
        git(root, 'init', '--bare', remote)
        git(project, 'init', '-b', 'main')
        git(project, 'config', 'user.name', 'Harness fixture')
        git(project, 'config', 'user.email', 'fixture@example.invalid')
        git(project, 'config', 'commit.gpgsign', 'false')
        await mkdir(join(root, 'hooks'))
        git(project, 'config', 'core.hooksPath', join(root, 'hooks'))
        await mkdir(join(project, 'docs'))
        await writeFile(join(project, 'docs/spec.md'), SPEC)
        await writeFile(join(project, 'docs/plan.md'), PLAN)
        const registry = Object.fromEntries(PLURORA_SEMANTIC_TIERS.map(tier => [tier, `fixture/${tier}`]))
        await writeFile(join(project, 'plurora-harness.json'), JSON.stringify({
          repository: 'adsonpatrick/trick-harness', revision: 'b'.repeat(40),
          projectRepository: 'adsonpatrick/neuro-via', profile: 'plurora', policyVersion: pluroraProfile.policyVersion,
          controlServerUrl: 'http://127.0.0.1:0', environment: 'development',
          database: { strategy: 'shared-cloud-development', projectRef: 'uljaajwwnygopsyvwsre' },
          project: { protectedBranch: 'main' }, modelRegistry: registry,
        }))
        git(project, 'add', '--', 'docs', 'plurora-harness.json')
        git(project, 'commit', '-m', 'Fixture baseline')
        git(project, 'remote', 'add', 'origin', remote)
        git(project, 'push', '-u', 'origin', 'main')
        if (scenario === 'detached') git(project, 'checkout', '--detach')
        else if (scenario !== 'protected') git(project, 'switch', '-c', BRANCH)
        const baseline = git(project, 'rev-parse', 'HEAD')

        // Only GitHub is simulated. Git commits, branch guards and local-remote pushes are real.
        let opened = false
        const spawn = (spec: SubprocessSpawnSpec): SubprocessHandle => {
          if (spec.argv[0] === 'git') {
            const result = spawnSync('git', spec.argv.slice(1), { cwd: spec.cwd, encoding: 'utf8', windowsHide: true })
            return settled(result.stdout, result.status)
          }
          if (spec.argv[0] !== 'gh') throw new Error('unexpected fixture subprocess')
          if (spec.argv[1] === 'pr' && spec.argv[2] === 'create') { opened = true; return settled('', 0) }
          if (spec.argv[1] === 'pr' && spec.argv[2] === 'view') {
            return settled(opened ? JSON.stringify({ number: 1, url: 'https://github.com/fixture/project/pull/1', state: 'OPEN', headRefName: BRANCH }) : '', opened ? 0 : 1)
          }
          // Certification is outside this scenario and cannot become success from a fixture PR.
          return settled('', 1)
        }
        const opencode: OpencodeAdapter = {
          startServer: async () => {
            if (scenario === 'startup-timeout') throw new OpencodeStartupTimeoutError(60000)
            return { url: 'http://127.0.0.1:1', close() {} }
          },
          connect: () => ({
            createSession: async () => 'recorded-implement', abortSession: async () => {},
            async prompt() {
              await mkdir(join(project, 'docs/verification/canary'), { recursive: true })
              await writeFile(join(project, MARKER), CONTENT)
              return { parts: [{ type: 'text', text: RESULT }] }
            },
          }),
        }
        host = await startPluroraHost({
          projectRoot: project, controlToken: 'fixture-control', signal: new AbortController().signal,
          spawn, opencode,
          catalogue: {
            opencodeModels: async () => Object.values(registry),
            codexModels: async () => Object.values(registry).map(id => ({ id, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] })),
          },
        })
        host.harness.runtime.register({
          name: 'recorded-verifier',
          capabilities: { modelOverride: true, reasoningEffort: true, permissionModes: ['read-only'] },
          start: async () => ({ status: 'completed', output: RESULT }),
        })
        if (scenario === 'switched') git(project, 'switch', '-c', 'test/other')
        const outcome = await host.harness.run({
          id: 'opencode-generated-id', cwd: project, requirement: 'Create the approved documentation marker.',
          risk: 'low', workload: 'light', profileId: 'plurora',
          approvedArtifacts: {
            spec: { path: 'docs/spec.md', sha256: createHash('sha256').update(SPEC).digest('hex') },
            plan: { path: 'docs/plan.md', sha256: createHash('sha256').update(PLAN).digest('hex') },
          },
        }, undefined, { role: 'verify', executor: 'recorded-verifier', semanticModelTier: 'codex.balanced' })
        const delivery = outcome.stages.find(stage => stage.role === 'delivery')
        if (scenario === 'startup-timeout') {
          expect(delivery).toBeUndefined()
          expect(outcome.stages).toHaveLength(1)
          expect(outcome.stages[0]?.verdict).toBe('FAIL')
        } else {
          expect(delivery?.verdict).toBe(scenario === 'feature' ? 'PASS' : 'FAIL')
        }
        if (scenario === 'feature') {
          expect(git(remote, 'show', `refs/heads/${BRANCH}:${MARKER}`)).toBe(CONTENT.trim())
          expect(git(project, 'diff', '--name-only', `${baseline}..HEAD`)).toBe(MARKER)
          expect(git(project, 'log', '-1', '--pretty=%s')).toBe('chore(harness): deliver approved workflow change')
        } else {
          expect(git(project, 'rev-parse', 'HEAD')).toBe(baseline)
          expect(git(project, 'diff', '--cached', '--name-only')).toBe('')
          expect(opened).toBe(false)
        }
        transcript.push({ scenario, branch: git(project, 'rev-parse', '--abbrev-ref', 'HEAD'),
          ...(scenario === 'startup-timeout' ? { startupSummary: outcome.stages[0]?.summary } : {}),
          ...(scenario === 'feature' ? { commitSubject: git(project, 'log', '-1', '--pretty=%s') } : {}),
          stages: outcome.stages.slice(0, 3).map(({ role, verdict }) => ({ role, verdict })),
          deliverySummary: delivery?.summary, pullRequestSimulated: opened })
      } finally {
        await host?.dispose()
        await rm(root, { recursive: true, force: true })
      }
    }
    const output = `${JSON.stringify(transcript, null, 2)}\n`
    if (process.env['DSH_SNAPSHOT'] === 'refresh') {
      await mkdir(resolve(expected, '..'), { recursive: true })
      await writeFile(expected, output)
    }
    expect(output).toBe(await readFile(expected, 'utf8'))
  })
})
