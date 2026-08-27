import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { HARNESS_EVENT_TYPES } from '../src/index.ts'
import * as JournalInvariant from '../src/invariant.ts'

describe('the journal invariant', () => {
  it('agrees with the vocabulary this package ships and the read path knows', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(JournalInvariant)).resolves.toBeDefined()
  })

  it('counts the capability window as part of the durable vocabulary', () => {
    // Named rather than counted: a capability event dropped from the vocabulary
    // stops being written, and the run that loses it still finishes — reporting
    // a delivery window that was never open.
    expect(HARNESS_EVENT_TYPES).toContain('harness/capability-start')
    expect(HARNESS_EVENT_TYPES).toContain('harness/capability-end')
  })
})
