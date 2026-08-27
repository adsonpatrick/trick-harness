import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as ContractsInvariant from '../src/invariant.ts'

describe('the contract vocabulary invariant', () => {
  it('agrees with the vocabulary this package ships', async () => {
    // The invariant restates every vocabulary rather than importing its
    // expectation, so this is the test that keeps the two views honest: a value
    // added, removed, or reordered on one side and not the other fails here at
    // install time rather than in whichever consumer switched on it.
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(ContractsInvariant)).resolves.toBeDefined()
  })
})
