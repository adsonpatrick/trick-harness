import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as JournalInvariant from '../src/invariant.ts'

describe('the journal invariant', () => {
  it('agrees with the vocabulary this package ships and the read path knows', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(JournalInvariant)).resolves.toBeDefined()
  })
})
