import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as RoutingInvariant from '../src/invariant.ts'

describe('the routing invariant', () => {
  it('agrees with the tier registry and fact set this package ships', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(RoutingInvariant)).resolves.toBeDefined()
  })
})
