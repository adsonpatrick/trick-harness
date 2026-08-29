import { readFile } from 'node:fs/promises'
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

  it('has a restated expectation for every vocabulary this package exports', async () => {
    // The test above can only catch drift in a vocabulary the invariant already
    // watches. A vocabulary added and never pinned passes it silently, which is
    // the failure this one exists for: a new closed set is durable data the
    // moment a consumer switches on it, and it has to be pinned on purpose.
    const source = await readFile(new URL('../src/invariant.ts', import.meta.url), 'utf8')
    const exported = await readFile(new URL('../src/types.ts', import.meta.url), 'utf8')

    for (const [, name] of exported.matchAll(/^export const ([A-Z_]+) = \[/gm)) {
      expect(source, `${name} is exported as a vocabulary but nothing pins it`).toContain(name)
    }
  })
})
