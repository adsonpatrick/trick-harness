/** Runnable keyless snapshot for the ordinary Plurora stage-result instruction. */

import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { WorkflowObjective } from '@trick-harness/contracts'
import type { StageSpec } from '@trick-harness/engineering-workflow'
import { createPluroraWorkflowHandlers } from '../src/workflow-handlers.ts'

const root = resolve(import.meta.dirname, '../../..')
const expected = join(root, 'scripts/snapshots/plurora-stage-result-prompt/prompt.expected.txt')
const refreshing = process.env['DSH_SNAPSHOT'] === 'record' || process.env['DSH_SNAPSHOT'] === 'refresh'

const STAGE: StageSpec = Object.freeze({ stageId: 'implement-1', role: 'implement' })

const OBJECTIVE: WorkflowObjective = Object.freeze({
  id: 'plurora-prompt-snapshot',
  cwd: '/workspace/plurora',
  requirement: 'add the activation canary marker',
  risk: 'low',
  workload: 'light',
  profileId: 'plurora',
  approvedArtifacts: {
    spec: { path: 'docs/spec.md', sha256: 'a'.repeat(64) },
    plan: { path: 'docs/plan.md', sha256: 'b'.repeat(64) },
  },
})

describe('Plurora stage-result prompt runnable snapshot', () => {
  it('records the complete final-line envelope the real host gives an implement stage', async () => {
    const prompt = `${createPluroraWorkflowHandlers().task(STAGE, OBJECTIVE)}\n`

    if (refreshing) {
      await mkdir(dirname(expected), { recursive: true })
      await writeFile(expected, prompt)
    } else {
      await access(expected)
    }
    await expect(prompt).toMatchFileSnapshot(expected)
  })
})
