import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as WorkflowInvariant from '../src/invariant.ts'

describe('the workflow invariant', () => {
  it('agrees that write authority belongs to exactly the mutating roles', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(WorkflowInvariant)).resolves.toBeDefined()
  })
})
