/** Compatibility evidence for the exact generated OpenCode SDK contract. */

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpencodeClient } from '@opencode-ai/sdk'
import { createSdkAdapter } from '../src/adapter.ts'
import { OpencodeHttpStatusError, OpencodeMalformedResponseError } from '../src/runtime-errors.ts'

afterEach(() => { vi.unstubAllGlobals() })

const providerPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  readonly dependencies: { readonly '@opencode-ai/sdk': string }
}

describe('@opencode-ai/sdk compatibility contract', () => {
  it('remains pinned to the SDK contract reviewed by the adapter', () => {
    expect(providerPackage.dependencies['@opencode-ai/sdk']).toBe('1.18.23')
  })

  it('forwards the attempt signal and does not retry one failed prompt request internally', async () => {
    const controller = new AbortController()
    let observed: Request | undefined
    const fetch = vi.fn(async (request: Request): Promise<Response> => {
      observed = request
      throw new TypeError('private transport detail')
    })
    const client = createOpencodeClient({
      baseUrl: 'http://127.0.0.1:49152',
      directory: '/work',
      signal: controller.signal,
      fetch,
    })

    await expect(client.session.prompt({
      path: { id: 'ses_1' },
      query: { directory: '/work' },
      body: { parts: [{ type: 'text', text: 'task' }] },
      throwOnError: true,
    })).rejects.toThrow(TypeError)

    expect(fetch).toHaveBeenCalledOnce()
    expect(observed?.signal).toBeDefined()
    expect(observed?.signal.aborted).toBe(false)
    expect(observed?.method).toBe('POST')
    expect(new URL(observed?.url ?? 'http://invalid').pathname).toBe('/session/ses_1/message')
  })

  it('aborts a pending prompt fetch when the attempt signal is canceled', async () => {
    const controller = new AbortController()
    const fetch = vi.fn((request: Request): Promise<Response> => new Promise((_resolve, reject) => {
      if (request.signal.aborted) {
        reject(new Error('request canceled'))
        return
      }
      request.signal.addEventListener('abort', () => { reject(new Error('request canceled')) }, { once: true })
    }))
    const client = createOpencodeClient({
      baseUrl: 'http://127.0.0.1:49152',
      signal: controller.signal,
      fetch,
    })
    const pending = client.session.prompt({
      path: { id: 'ses_1' }, query: { directory: '/work' },
      body: { parts: [{ type: 'text', text: 'task' }] }, throwOnError: true,
    })

    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledOnce() })
    controller.abort()
    await expect(pending).rejects.toBeDefined()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('captures a provider HTTP status and cancels its body before the SDK parses it', async () => {
    const cancel = vi.fn(async () => undefined)
    const response = { ok: false, status: 503, body: { cancel } } as unknown as Response
    const fetch = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetch)
    const client = createSdkAdapter({ startupTimeoutMs: 1_000 })
      .connect('http://127.0.0.1:49152', '/work', new AbortController().signal)

    await expect(client.prompt({ sessionId: 'ses_1', directory: '/work', text: 'task' }))
      .rejects.toBeInstanceOf(OpencodeHttpStatusError)
    expect(fetch).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('maps malformed JSON from the pinned SDK to one bounded response error', async () => {
    const fetch = vi.fn(async () => new Response('{', {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    const client = createSdkAdapter({ startupTimeoutMs: 1_000 })
      .connect('http://127.0.0.1:49152', '/work', new AbortController().signal)

    await expect(client.prompt({ sessionId: 'ses_1', directory: '/work', text: 'task' }))
      .rejects.toBeInstanceOf(OpencodeMalformedResponseError)
    expect(fetch).toHaveBeenCalledOnce()
  })
})
