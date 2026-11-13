import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_TIMEOUT, FAILURE_MESSAGES, PanelClient, PanelRequestError } from './client'
import type { FailureKind } from './client'
import type { PanelDeclaration, SimulateResponse } from './contract'

// Every id below is a neutral one: a model, a panel, a knob, a curve and a
// series are data of a payload and never of this library.

const ENDPOINT = 'https://endpoint.example.org'

/** Build the answer of a route which carries a body. */
function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

/** The smallest declaration which passes the shape check of the client. */
function declaration(contract = 'panel/1'): PanelDeclaration {
  return {
    contract,
    panel: { id: 'panelA', title: 'Panel A', subtitle: '', x_label: 'time', y_label: '' },
    axes: [],
    curves: [],
    data: [],
    simulation: { variant: null, end: 10, points: 2, x_unit: null, preinit: {} },
    limits: { end: 10000, points: 2000, knobs: 4, grid: 64, curves: 16 },
  }
}

/** The smallest answer of a run which passes the shape check of the client. */
function run(): SimulateResponse {
  return {
    contract: 'panel/1',
    spec_hash: 'a'.repeat(64),
    x: [0, 1],
    dims: [],
    curves: { curveA: [[1, 2]] },
    units: { x: null, curveA: 'uM' },
    provenance: {
      model: 'modelA',
      panel: 'panelA',
      model_sha256: 'b'.repeat(64),
      variant: null,
      engine: 'engineA',
      sbmlsim: '0.0.0',
      seconds: 0.5,
      created: '2026-11-12T22:41:35.090689+00:00',
    },
    status: { ok: true, points: 1, failed: [] },
  }
}

/** Serve every request with one answer, or with one failure. */
function serve(answer: (url: string, init: RequestInit | undefined) => Promise<Response>): void {
  globalThis.fetch = vi.fn(answer) as unknown as typeof fetch
}

/** Get the kind of the failure a call ends in. */
async function kindOf(call: Promise<unknown>): Promise<FailureKind | 'none'> {
  try {
    await call
    return 'none'
  } catch (error) {
    return error instanceof PanelRequestError ? error.kind : 'none'
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the client of an endpoint', () => {
  it('reads the declaration of a panel off the route of its ids', async () => {
    const seen: string[] = []
    serve((url) => {
      seen.push(url)
      return Promise.resolve(json(declaration()))
    })
    const client = new PanelClient(`${ENDPOINT}/`, DEFAULT_TIMEOUT)
    const answer = await client.panel('model a', 'panel/a')
    expect(answer.panel.id).toBe('panelA')
    expect(seen).toEqual([`${ENDPOINT}/api/models/model%20a/panels/panel%2Fa`])
  })

  it('posts the values and the grid of a simulation', async () => {
    const bodies: unknown[] = []
    serve((url, init) => {
      bodies.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as unknown)
      expect(init?.method).toBe('POST')
      expect(url.endsWith('/simulate')).toBe(true)
      return Promise.resolve(json(run()))
    })
    const client = new PanelClient(ENDPOINT, DEFAULT_TIMEOUT)
    const answer = await client.simulate('modelA', 'panelA', {
      values: { knobA: 2 },
      grid: { knobB: 3 },
    })
    expect(answer.spec_hash).toBe('a'.repeat(64))
    expect(bodies).toEqual([{ values: { knobA: 2 }, grid: { knobB: 3 } }])
  })

  it('reads the series of the study data', async () => {
    serve(() => Promise.resolve(json({ contract: 'paneldata/1', series: [{ id: 'seriesA' }] })))
    const client = new PanelClient(ENDPOINT, DEFAULT_TIMEOUT)
    const series = await client.data('modelA', 'panelA')
    expect(series).toHaveLength(1)
  })

  it('reads a stored answer off a url of its own', async () => {
    const seen: string[] = []
    serve((url) => {
      seen.push(url)
      return Promise.resolve(json(run()))
    })
    const client = new PanelClient(ENDPOINT, DEFAULT_TIMEOUT)
    await client.stored('./stored.json')
    expect(seen).toEqual(['./stored.json'])
  })

  it('fails with the kind of what went wrong and with nothing else', async () => {
    const client = new PanelClient(ENDPOINT, DEFAULT_TIMEOUT)

    serve(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await kindOf(client.panel('modelA', 'panelA'))).toBe('network')

    serve(() => Promise.resolve(json({ detail: 'nope' }, 404)))
    expect(await kindOf(client.panel('modelA', 'panelA'))).toBe('http')

    serve(() => Promise.resolve(json(declaration('panel/2'))))
    expect(await kindOf(client.panel('modelA', 'panelA'))).toBe('contract')

    serve(() => Promise.resolve(json({ contract: 'panel/1', panel: {} })))
    expect(await kindOf(client.panel('modelA', 'panelA'))).toBe('body')

    serve(() => Promise.resolve(json({ contract: 'panel/1', x: [0], dims: [] })))
    expect(await kindOf(client.simulate('modelA', 'panelA', {}))).toBe('body')
  })

  it('stops a request which is not answered in time', async () => {
    serve(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        }),
    )
    const client = new PanelClient(ENDPOINT, 5)
    expect(await kindOf(client.panel('modelA', 'panelA'))).toBe('timeout')
  })

  it('stops a request its caller stopped, which is no failure of the endpoint', async () => {
    serve(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        }),
    )
    const client = new PanelClient(ENDPOINT, DEFAULT_TIMEOUT)
    const controller = new AbortController()
    const call = client.panel('modelA', 'panelA', controller.signal)
    controller.abort()
    expect(await kindOf(call)).toBe('aborted')
  })

  it('takes the default timeout for one which is no positive number', () => {
    expect(new PanelClient(ENDPOINT, 0).timeoutMs).toBe(DEFAULT_TIMEOUT)
    expect(new PanelClient(ENDPOINT, Number.NaN).timeoutMs).toBe(DEFAULT_TIMEOUT)
    expect(new PanelClient(ENDPOINT, 250).timeoutMs).toBe(250)
  })

  it('tells a reader what failed without naming a url or a host', () => {
    for (const message of Object.values(FAILURE_MESSAGES)) {
      expect(message).not.toMatch(/https?:|\/\/|localhost|\d{1,3}(\.\d{1,3}){3}/)
      expect(message.endsWith('.')).toBe(true)
    }
  })
})
