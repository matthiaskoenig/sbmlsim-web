// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { FAILURE_MESSAGES } from './client'
import type {
  AppDeclaration,
  PanelDeclaration,
  SimulateRequest,
  SimulateResponse,
} from './contract'
import { APP_TAG, register } from './index'

// The shell runs in a dom, which is `happy-dom` for this file alone. Nothing
// here reaches the network: `fetch` is a stub which answers the routes of an
// app and of its panels, and every id below is a neutral one. The panels the
// shell places are the real elements, so a test sees what a page would.

/** The shell as a page uses it. */
interface AppElement extends HTMLElement {
  /** The root of its shadow tree. */
  shadowRoot: ShadowRoot
}

/** A panel which the shell placed. */
type PlacedPanel = HTMLElement

/** One request the shell and its panels made. */
interface Call {
  /** The url it asked for. */
  url: string
  /** The body of a POST, `null` for a GET. */
  body: SimulateRequest | null
}

/** The app every test starts from: two pages, two variants and the texts of the footer. */
function app(more: Partial<AppDeclaration> = {}): AppDeclaration {
  return {
    contract: 'app/1',
    title: 'Model A',
    subtitle: 'what model A is',
    pages: [
      { id: 'pageA', title: 'Page A', panels: ['panelA'] },
      { id: 'pageB', title: 'Page B', panels: ['panelB', 'panelC'] },
    ],
    variants: [
      { id: 'variantA', label: 'Variant A' },
      { id: 'variantB', label: 'Variant B' },
    ],
    citation: 'Author et al. (2026)',
    doi: '10.5281/zenodo.0000000',
    licenses: ['CC BY-SA 4.0', 'MIT'],
    ...more,
  }
}

/** The declaration of a panel of the app: one range knob and one curve. */
function panelDeclaration(id: string): PanelDeclaration {
  return {
    contract: 'panel/1',
    panel: { id, title: `Title of ${id}`, subtitle: '', x_label: 'time [h]' },
    axes: [
      {
        id: 'knobA',
        label: 'knob A',
        target: 'targetA',
        unit: 'mg',
        kind: 'range',
        min: 0,
        max: 1,
        steps: 3,
        choices: [],
        default: 1,
      },
    ],
    curves: [{ id: 'curveA', label: 'curve A', unit: 'uM', scale: 'linear' }],
    data: [],
    simulation: { variant: null, end: 120, points: 2, x_unit: 'h', preinit: {} },
    limits: { end: 10000, points: 2000, knobs: 4, grid: 64, curves: 16 },
  }
}

/** The answer of a run of a panel. */
function run(request: SimulateRequest): SimulateResponse {
  return {
    contract: 'panel/1',
    spec_hash: 'a'.repeat(64),
    x: [0, 1, 2],
    dims: [{ id: 'knobA', label: 'knob A', unit: null, values: [0, 0.5, 1] }],
    curves: { curveA: [0, 0.5, 1].map((one) => [0, one, 2 * one]) },
    units: { x: 'h', curveA: 'uM' },
    provenance: {
      model: 'modelA',
      panel: 'panelA',
      model_sha256: (request.variant === 'variantB' ? 'b' : 'c').repeat(64),
      variant: request.variant ?? null,
      engine: 'engineA',
      sbmlsim: '1.2.3',
      seconds: 0.05,
      created: '2026-11-12T22:41:35.090689+00:00',
    },
    status: { ok: true, points: 3, failed: [] },
  }
}

/** The app the stub answers, `null` for a request which cannot reach it. */
let declared: AppDeclaration | null = app()

/** Whether the simulations hang until they are stopped, with the signals they were given. */
let hang: AbortSignal[] | null = null

/** The requests since the test started. */
let calls: Call[] = []

/** Build the answer of a route which carries a body. */
function json(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response
}

/** The requests of the app, which the shell makes once. */
function appCalls(): Call[] {
  return calls.filter((one) => one.url.endsWith('/app'))
}

/** The bodies of the simulations of the panels. */
function simulations(): SimulateRequest[] {
  return calls.filter((one) => one.url.endsWith('/simulate')).map((one) => one.body ?? {})
}

/** Let the requests of the shell and of its panels settle. */
async function settled(): Promise<void> {
  for (let round = 0; round < 8; round += 1) {
    await Promise.resolve()
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** Put the shell in the page and wait for it to read its app. */
async function shell(attributes: Record<string, string> = {}): Promise<AppElement> {
  const element = document.createElement(APP_TAG) as AppElement
  for (const [name, value] of Object.entries({
    endpoint: '/api-root',
    model: 'modelA',
    ...attributes,
  })) {
    element.setAttribute(name, value)
  }
  document.body.append(element)
  await settled()
  return element
}

/** Get one element of the shadow tree of the shell, which the test expects. */
function part(element: AppElement, selector: string): Element {
  const found = element.shadowRoot.querySelector(selector)
  if (found === null) {
    throw new Error(`the shell has no '${selector}'`)
  }
  return found
}

/** Get the panels the shell placed, by their `panel` attribute. */
function panels(element: AppElement): string[] {
  return [...element.shadowRoot.querySelectorAll('sbmlsim-panel')].map(
    (one) => one.getAttribute('panel') ?? '',
  )
}

/** Get the tabs of the navigation. */
function tabs(element: AppElement): HTMLButtonElement[] {
  return [...element.shadowRoot.querySelectorAll<HTMLButtonElement>('.nav .tab')]
}

beforeEach(() => {
  declared = app()
  calls = []
  hang = null
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as SimulateRequest) : null
    calls.push({ url, body })
    if (declared === null) {
      return Promise.reject(new TypeError('Failed to fetch'))
    }
    if (url.endsWith('/app')) {
      return Promise.resolve(json(declared))
    }
    if (url.endsWith('/simulate')) {
      if (hang !== null && init?.signal) {
        hang.push(init.signal)
        return new Promise<never>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('stopped', 'AbortError'))
          })
        })
      }
      return Promise.resolve(json(run(body ?? {})))
    }
    const id = url.split('/panels/')[1] ?? 'panelA'
    return Promise.resolve(json(panelDeclaration(id)))
  })
  class Observing {
    observe(): void {
      // nothing is measured in this dom
    }
    unobserve(): void {
      // nothing is measured, so nothing has to stop
    }
    disconnect(): void {
      // nothing is measured, so nothing has to stop
    }
  }
  vi.stubGlobal('ResizeObserver', Observing)
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the shell of an app', () => {
  it('is registered once under its tag', () => {
    expect(customElements.get(APP_TAG)).toBeDefined()
    expect(register()).toBe(false)
  })

  it('renders a nav entry per page and the panels of the current page', async () => {
    const element = await shell()
    expect(tabs(element).map((one) => one.textContent.trim())).toEqual(['Page A', 'Page B'])
    expect(tabs(element)[0]?.getAttribute('aria-current')).toBe('page')
    expect(tabs(element)[1]?.hasAttribute('aria-current')).toBe(false)
    expect(panels(element)).toEqual(['panelA'])
    expect(part(element, '.title').textContent.trim()).toBe('Model A')
    expect(part(element, '.title').tagName).toBe('H1')
    // the panels sit one level below the title of the app and start themselves
    const placed = part(element, 'sbmlsim-panel')
    expect(placed.getAttribute('heading-level')).toBe('2')
    expect(placed.hasAttribute('auto')).toBe(true)
    expect(appCalls()).toHaveLength(1)
  })

  it('opens on the page the attribute names and on the first page for an unknown one', async () => {
    expect(panels(await shell({ page: 'pageB' }))).toEqual(['panelB', 'panelC'])
    document.body.innerHTML = ''
    expect(panels(await shell({ page: 'nowhere' }))).toEqual(['panelA'])
  })

  it('switches the page without reading the declaration again and freezes what it leaves', async () => {
    // the panel of the first page is waiting for its simulation when it is left
    hang = []
    const element = await shell()
    const left = part(element, 'sbmlsim-panel') as PlacedPanel
    const connectedAtStop: boolean[] = []
    hang[0]?.addEventListener('abort', () => connectedAtStop.push(left.isConnected))
    hang = null
    tabs(element)[1]?.click()
    await settled()
    expect(panels(element)).toEqual(['panelB', 'panelC'])
    expect(tabs(element)[1]?.getAttribute('aria-current')).toBe('page')
    expect(element.getAttribute('page')).toBe('pageB')
    // its work was stopped by `freeze()` while it was still in the page, and
    // not only by its removal, which stops it after it left
    expect(connectedAtStop).toEqual([true])
    expect(left.isConnected).toBe(false)
    expect(appCalls()).toHaveLength(1)
    // the new panels asked for themselves
    expect(calls.some((one) => one.url.endsWith('/panels/panelB'))).toBe(true)
    expect(calls.some((one) => one.url.endsWith('/panels/panelC'))).toBe(true)
  })

  it('passes the chosen variant to every panel of the page', async () => {
    const element = await shell({ page: 'pageB' })
    expect(simulations().map((one) => one.variant)).toEqual(['variantA', 'variantA'])
    const select = part(element, '.variant-select') as HTMLSelectElement
    expect([...select.options].map((one) => one.value)).toEqual(['variantA', 'variantB'])
    select.value = 'variantB'
    select.dispatchEvent(new Event('change'))
    await new Promise((resolve) => setTimeout(resolve, 400))
    await settled()
    const after = simulations().slice(2)
    expect(after.map((one) => one.variant)).toEqual(['variantB', 'variantB'])
    // the declarations are not read again for a variant, only the SBML changes
    expect(calls.filter((one) => one.url.endsWith('/panels/panelB')).length).toBe(1)
    // and the choice stays while the page changes
    tabs(element)[0]?.click()
    await settled()
    expect(simulations().at(-1)?.variant).toBe('variantB')
  })

  it('has no switcher for an app of one variant or none and no nav for one page', async () => {
    declared = app({ variants: [{ id: 'variantA', label: 'Variant A' }] })
    const one = await shell()
    expect(one.shadowRoot.querySelector('.variant')).toBeNull()
    expect(simulations().map((body) => body.variant)).toEqual([undefined])
    document.body.innerHTML = ''
    declared = app({
      variants: [],
      pages: [{ id: 'pageA', title: 'Page A', panels: ['panelA'] }],
    })
    const none = await shell()
    expect(none.shadowRoot.querySelector('.variant')).toBeNull()
    expect(none.shadowRoot.querySelector('.nav')).toBeNull()
    expect(none.shadowRoot.querySelector('.bar')).toBeNull()
    expect(panels(none)).toEqual(['panelA'])
  })

  it('shows the citation, the DOI, the licenses and the versions which simulated', async () => {
    const element = await shell()
    const footer = part(element, '.footer')
    expect(footer.textContent).toContain('Author et al. (2026)')
    expect(footer.textContent).toContain('CC BY-SA 4.0, MIT')
    const link = part(element, '.footer a')
    expect(link.getAttribute('href')).toBe('https://doi.org/10.5281/zenodo.0000000')
    expect(link.textContent).toBe('10.5281/zenodo.0000000')
    const simulated = part(element, '.simulated').textContent
    expect(simulated).toContain('sbmlsim 1.2.3')
    expect(simulated).toContain('engineA')
    expect(simulated).toContain('model cccccccc')
  })

  it('takes a DOI written as a url and links nothing for a script', async () => {
    declared = app({ doi: 'https://doi.org/10.1000/xyz 1' })
    const element = await shell()
    expect(part(element, '.footer a').getAttribute('href')).toBe('https://doi.org/10.1000/xyz%201')
    document.body.innerHTML = ''
    declared = app({ doi: 'javascript:alert(1)' })
    const hostile = await shell()
    expect(part(hostile, '.footer a').getAttribute('href')).toMatch(/^https:\/\/doi\.org\//)
  })

  it('shows a readable error and no empty frame when the endpoint is unreachable', async () => {
    declared = null
    const heard: unknown[] = []
    document.addEventListener('sbmlsim-error', (event) => heard.push((event as CustomEvent).detail))
    const element = await shell({ endpoint: 'https://models.example.org' })
    expect(part(element, '[role=alert]').textContent).toBe(FAILURE_MESSAGES.network)
    for (const gone of ['.head', '.bar', '.nav', '.grid', '.footer', 'sbmlsim-panel']) {
      expect(element.shadowRoot.querySelector(gone)).toBeNull()
    }
    expect(element.shadowRoot.textContent).not.toContain('example.org')
    expect(heard).toEqual([{ kind: 'network', message: FAILURE_MESSAGES.network }])
  })

  it('shows the error of a model without an app in the voice of the panel', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 404 } as Response))
    const element = await shell()
    expect(part(element, '[role=alert]').textContent).toBe(FAILURE_MESSAGES.http)
    expect(element.shadowRoot.querySelector('.grid')).toBeNull()
  })

  it('is one grid column below 760px of its own width', async () => {
    const element = await shell()
    const style = [...element.shadowRoot.querySelectorAll('style')]
      .map((one) => one.textContent)
      .join('\n')
    const narrow =
      /@container \(max-width: 760px\)\s*{\s*\.grid\s*{\s*grid-template-columns:\s*1fr;/
    expect(style).toMatch(narrow)
  })

  it('declares no colour of its own, only the tokens of the design', async () => {
    const element = await shell()
    const style = [...element.shadowRoot.querySelectorAll('style')]
      .map((one) => one.textContent)
      .join('\n')
    expect(style).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    // the stylesheet of the shell itself is the last one, after the tokens
    const own = element.shadowRoot.querySelectorAll('style')
    expect((own[own.length - 1]?.textContent ?? '').replace(/\/\*[^]*?\*\//g, '')).not.toMatch(
      /rgb\(|hsl\(|--sbmlsim-/,
    )
  })
})
