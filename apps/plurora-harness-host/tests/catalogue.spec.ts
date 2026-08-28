/**
 * OpenCode reports providers and models separately and is asked for one joined
 * id. These tests pin the join, which is the only judgement in that binding.
 *
 * @module apps/plurora-harness-host/tests/catalogue
 */

import { describe, expect, it } from 'vitest'
import { normalizeOpencodeModels } from '../src/catalogue.ts'

describe('normalizeOpencodeModels', () => {
  it('joins each provider to each of its models the way a route names them', () => {
    expect(normalizeOpencodeModels([
      { id: 'opencode', models: { 'grok-code': {}, 'claude-sonnet-4-5': {} } },
      { id: 'opencode-go', models: { 'mimo-v2.5': {} } },
    ])).toEqual(['opencode/grok-code', 'opencode/claude-sonnet-4-5', 'opencode-go/mimo-v2.5'])
  })

  it('reports nothing for a provider that offers no models', () => {
    expect(normalizeOpencodeModels([{ id: 'nvidia', models: {} }])).toEqual([])
  })

  it('drops a half-named pair rather than reporting an id nobody can route to', () => {
    expect(normalizeOpencodeModels([
      { id: '', models: { 'a': {} } },
      { id: 'opencode', models: { '': {} } },
    ])).toEqual([])
  })

  it('reports an empty catalogue rather than failing when nothing is configured', () => {
    expect(normalizeOpencodeModels([])).toEqual([])
  })
})
