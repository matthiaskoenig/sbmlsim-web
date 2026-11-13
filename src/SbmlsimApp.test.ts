// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { FAILURE_MESSAGES } from './client'
import type {
  AppDeclaration,
  PanelAxis,
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

/** The app as a test gives it, without what the service derives from the panels. */
type Given = Omit<AppDeclaration, 'shared' | 'heads'>

/** The app every test starts from: two pages, two variants and the texts of the footer. */
function app(more: Partial<AppDeclaration> = {}): Given {
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
    panel: {
      id,
      title: `Title of ${id}`,
      subtitle: subtitlesOf[id] ?? '',
      x_label: 'time [h]',
      y_label: '',
    },
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

/** A choice knob, which no grid covers unless a run asks for it. */
function choiceKnob(id: string): PanelAxis {
  return {
    id,
    label: `knob ${id}`,
    target: `target${id}`,
    unit: 'mg',
    kind: 'choice',
    min: null,
    max: null,
    steps: 5,
    choices: [
      { label: 'low', value: 12.5 },
      { label: 'high', value: 25 },
    ],
    default: 25,
  }
}

/** A range knob of its own id, which a run grids over by default. */
function rangeKnob(id: string): PanelAxis {
  const declared = panelDeclaration('panelA').axes[0]
  if (declared === undefined) {
    throw new Error('the declaration has no knob')
  }
  return { ...declared, id, label: `knob ${id}`, target: `target${id}` }
}

/** The answer of a run of a panel. */
function run(request: SimulateRequest): SimulateResponse {
  return {
    contract: 'panel/1',
    spec_hash: 'a'.repeat(64),
    x: [0, 1, 2],
    // the axis of the answer is the knob the request gridded over
    dims: [
      {
        id: Object.keys(request.grid ?? {})[0] ?? 'knobA',
        label: 'knob',
        unit: null,
        values: [0, 0.5, 1],
      },
    ],
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

/**
 * Work the shared knobs of an app out of the knobs of its panels, as the
 * service does: the ids more than one panel of a page declares, in the order
 * the first panel which declares one lists them.
 */
function sharedOf(given: Given): AppDeclaration['shared'] {
  return Object.fromEntries(
    given.pages.map((page) => {
      const first = new Map<string, PanelAxis>()
      const declaring = new Map<string, string[]>()
      for (const id of page.panels) {
        for (const knob of knobsOf[id] ?? panelDeclaration(id).axes) {
          if (!first.has(knob.id)) {
            first.set(knob.id, knob)
          }
          declaring.set(knob.id, [...(declaring.get(knob.id) ?? []), id])
        }
      }
      const shared = [...first.values()]
        .filter((knob) => (declaring.get(knob.id) ?? []).length > 1)
        .map((knob) => ({
          knob,
          panels: (declaring.get(knob.id) ?? []).map((id) => ({ id, title: `Title of ${id}` })),
        }))
      return [page.id, shared]
    }),
  )
}

/** Work the heads of the panels of an app out of their declarations, as the service does. */
function headsOf(given: Given): AppDeclaration['heads'] {
  return Object.fromEntries(
    given.pages.map((page) => [
      page.id,
      page.panels.map((id) => {
        const { title, subtitle } = panelDeclaration(id).panel
        return { id, title, subtitle }
      }),
    ]),
  )
}

/** The app the stub answers, `null` for a request which cannot reach it. */
let declared: Given | null = app()

/** The subtitle of a panel by its id, for a panel which declares one. */
let subtitlesOf: Record<string, string> = {}

/** The knobs of a panel by its id, for a panel which declares others than `knobA`. */
let knobsOf: Record<string, PanelAxis[]> = {}

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
  knobsOf = {}
  subtitlesOf = {}
  calls = []
  hang = null
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as SimulateRequest) : null
    calls.push({ url, body })
    if (declared === null) {
      return Promise.reject(new TypeError('Failed to fetch'))
    }
    if (url.endsWith('/app')) {
      return Promise.resolve(
        json({ ...declared, shared: sharedOf(declared), heads: headsOf(declared) }),
      )
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
    const declaredKnobs = knobsOf[id]
    const answer = panelDeclaration(id)
    return Promise.resolve(
      json(declaredKnobs === undefined ? answer : { ...answer, axes: declaredKnobs }),
    )
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
  vi.useRealTimers()
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
    const read = calls.filter((one) => one.url.endsWith('/panels/panelB')).length
    const select = part(element, '.variant-select') as HTMLSelectElement
    expect([...select.options].map((one) => one.value)).toEqual(['variantA', 'variantB'])
    select.value = 'variantB'
    select.dispatchEvent(new Event('change'))
    await new Promise((resolve) => setTimeout(resolve, 400))
    await settled()
    const after = simulations().slice(2)
    expect(after.map((one) => one.variant)).toEqual(['variantB', 'variantB'])
    // the declarations are not read again for a variant, only the SBML changes
    expect(calls.filter((one) => one.url.endsWith('/panels/panelB')).length).toBe(read)
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

  it('breaks a citation where it has to, so a long url does not scroll a phone sideways', async () => {
    const element = await shell()
    expect(getComputedStyle(part(element, '.citation')).overflowWrap).toBe('anywhere')
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

  it('lays its panels out in as many columns as fit 30rem and collapses an empty track', async () => {
    const element = await shell()
    const style = [...element.shadowRoot.querySelectorAll('style')]
      .map((one) => one.textContent)
      .join('\n')
    // one column below about 976px of the width of the shell, two above, and a
    // lone panel takes the row, which `auto-fit` is for and `auto-fill` is not
    expect(style).toMatch(/repeat\(auto-fit,\s*minmax\(min\(100%,\s*30rem\),\s*1fr\)\)/)
    expect(style).not.toMatch(/auto-fill/)
  })

  it('reserves the head of every card with the heads of the app, laid out and never shown', async () => {
    subtitlesOf = { panelC: 'what panel C answers' }
    const element = await shell({ page: 'pageB' })
    const reserves = [...element.shadowRoot.querySelectorAll('.cell')].map((cell) => {
      const reserve = cell.querySelector(':scope > .reserve')
      return {
        hidden: reserve?.getAttribute('aria-hidden'),
        title: reserve?.querySelector('.reserve-title')?.textContent.trim() ?? null,
        subtitle: reserve?.querySelector('.reserve-subtitle')?.textContent.trim() ?? null,
      }
    })
    // the texts the panels will draw in their heads, a subtitle only where one is declared
    expect(reserves).toEqual([
      { hidden: 'true', title: 'Title of panelB', subtitle: null },
      { hidden: 'true', title: 'Title of panelC', subtitle: 'what panel C answers' },
    ])
    const style = [...element.shadowRoot.querySelectorAll('style')]
      .map((one) => one.textContent)
      .join('\n')
    expect(style).toMatch(/\.cell > \.reserve \{[^}]*visibility: hidden/)
  })

  it('reserves no head for a panel which declares neither a title nor a subtitle', async () => {
    declared = app({ pages: [{ id: 'pageA', title: 'Page A', panels: ['panelA'] }] })
    const element = await shell()
    expect(element.shadowRoot.querySelector('.reserve-head')).not.toBeNull()
    // the stub derives the heads from the declarations; an empty head is none
    const answered = {
      ...declared,
      shared: {},
      heads: { pageA: [{ id: 'panelA', title: '', subtitle: '' }] },
    }
    vi.stubGlobal('fetch', (url: string) =>
      url.endsWith('/app')
        ? Promise.resolve(json(answered))
        : Promise.reject(new TypeError('Failed to fetch')),
    )
    element.remove()
    const empty = await shell()
    expect(empty.shadowRoot.querySelector('.reserve')).not.toBeNull()
    expect(empty.shadowRoot.querySelector('.reserve-head')).toBeNull()
  })

  it('paints its own surface and declares the scheme of its controls', async () => {
    const element = await shell()
    const style = [...element.shadowRoot.querySelectorAll('style')]
      .map((one) => one.textContent)
      .join('\n')
    expect(style).toMatch(/:host\s*{[^}]*background:\s*var\(--_bg\)/)
    expect(style).toMatch(/:host\s*{[^}]*color-scheme:\s*light dark/)
    expect(style).toMatch(/:host\(\[theme='dark'\]\)\s*{[^}]*color-scheme:\s*dark/)
  })

  it('has no landmark of its own, a named region for the grid and a live region', async () => {
    const element = await shell()
    expect(element.shadowRoot.querySelector('main')).toBeNull()
    expect(part(element, '.grid').getAttribute('aria-label')).toBe('Page A')
    const live = part(element, '.live')
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(live.textContent).toBe('')
    tabs(element)[1]?.click()
    await settled()
    expect(live.textContent).toBe('Showing Page B')
    expect(part(element, '.grid').getAttribute('aria-label')).toBe('Page B')
  })

  it('tells the page which page a reader switched to, once per switch', async () => {
    const element = await shell()
    const heard: unknown[] = []
    element.addEventListener('sbmlsim-page', (event) => heard.push((event as CustomEvent).detail))
    tabs(element)[1]?.click()
    await settled()
    tabs(element)[1]?.click()
    await settled()
    tabs(element)[0]?.click()
    await settled()
    expect(heard).toEqual([{ page: 'pageB' }, { page: 'pageA' }])
  })

  it('keeps one answer per panel for the footer however many simulations ran', async () => {
    const element = await shell()
    const panel = part(element, 'sbmlsim-panel')
    const answer = (sha: string): CustomEvent =>
      new CustomEvent('sbmlsim-result', {
        detail: { provenance: { ...run({}).provenance, panel: 'panelA', model_sha256: sha } },
        bubbles: true,
        composed: true,
      })
    for (let move = 0; move < 50; move += 1) {
      panel.dispatchEvent(answer('d'.repeat(64)))
    }
    panel.dispatchEvent(answer('e'.repeat(64)))
    await settled()
    // the latest answer of the panel is what the footer names, and the first ones are gone
    const text = part(element, '.simulated').textContent
    expect(text).toContain('model eeeeeeee')
    expect(text).not.toContain('dddddddd')
    expect(text).not.toContain('cccccccc')
  })

  it('places the panels under the tag register was called with', async () => {
    try {
      expect(register('x-panel', 'x-app')).toBe(true)
      const element = document.createElement('x-app') as AppElement
      element.setAttribute('endpoint', '/api-root')
      element.setAttribute('model', 'modelA')
      document.body.append(element)
      await settled()
      expect([...element.shadowRoot.querySelectorAll('x-panel')]).toHaveLength(1)
      expect(element.shadowRoot.querySelector('sbmlsim-panel')).toBeNull()
      expect(element.shadowRoot.querySelector('x-panel')?.getAttribute('heading-level')).toBe('2')
    } finally {
      // the default call puts the shells back on the default panel tag
      register()
    }
    expect(panels(await shell())).toEqual(['panelA'])
  })

  it('keeps the tag it was built with when the elements are registered again', async () => {
    const before = await shell()
    try {
      expect(register('y-panel', 'y-app')).toBe(true)
      // a page change rebuilds the grid, which is when a tag read on every
      // render rather than once would change under the shell
      tabs(before)[1]?.click()
      await settled()
      expect(before.shadowRoot.querySelector('y-panel')).toBeNull()
      expect(panels(before)).toEqual(['panelB', 'panelC'])
    } finally {
      register()
    }
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

describe('the knobs the panels of a page share', () => {
  /** Get the shadow root of a panel the shell placed. */
  function inside(panel: Element): ShadowRoot {
    if (panel.shadowRoot === null) {
      throw new Error('the panel has no shadow root')
    }
    return panel.shadowRoot
  }

  /** Get a panel the shell placed by its id. */
  function placed(element: AppElement, id: string): Element {
    return part(element, `sbmlsim-panel[panel="${id}"]`)
  }

  /** Get the ids of the knobs a panel draws a control of. */
  function panelKnobs(element: AppElement, id: string): string[] {
    return [...inside(placed(element, id)).querySelectorAll('.knob select, .knob input')].map(
      (one) => one.id,
    )
  }

  /** Get the ids of the knobs the shell draws a control of. */
  function shellKnobs(element: AppElement): string[] {
    return [...element.shadowRoot.querySelectorAll('.knobs .knob select, .knobs .knob input')].map(
      (one) => one.id,
    )
  }

  /** The simulations one panel asked for. */
  function simulationsOf(id: string): SimulateRequest[] {
    return calls
      .filter((one) => one.url.endsWith(`/panels/${id}/simulate`))
      .map((one) => one.body ?? {})
  }

  it('draws one control of a knob two panels of the page declare, and none in the panels', async () => {
    const element = await shell({ page: 'pageB' })
    expect(shellKnobs(element)).toEqual(['knob-knobA'])
    expect(panelKnobs(element, 'panelB')).toEqual([])
    expect(panelKnobs(element, 'panelC')).toEqual([])
    expect(placed(element, 'panelB').getAttribute('values')).toBe('{"knobA":1}')
    expect(placed(element, 'panelC').getAttribute('values')).toBe('{"knobA":1}')
    // the control is the one the panel draws, with its label, its unit and its value
    expect(part(element, '.knobs .knob-label').textContent.trim()).toBe('knob A [mg]')
    expect(part(element, '.knobs .knob-value').textContent.trim()).toBe('1')
    const slider = part(element, '#knob-knobA') as HTMLInputElement
    expect([slider.min, slider.max, slider.step, slider.value]).toEqual(['0', '1', '0.01', '1'])
    // the page of one panel keeps its knob in its panel
    tabs(element)[0]?.click()
    await settled()
    expect(element.shadowRoot.querySelector('.knobs')).toBeNull()
    expect(panelKnobs(element, 'panelA')).toEqual(['knob-knobA'])
    expect(placed(element, 'panelA').hasAttribute('values')).toBe(false)
  })

  it('moves every panel which declares the knob to one value', async () => {
    knobsOf = {
      panelB: [rangeKnob('knobB'), choiceKnob('knobS')],
      panelC: [choiceKnob('knobS'), rangeKnob('knobC')],
    }
    const element = await shell({ page: 'pageB' })
    expect(shellKnobs(element)).toEqual(['knob-knobS'])
    const select = part(element, '#knob-knobS') as HTMLSelectElement
    select.value = '12.5'
    select.dispatchEvent(new Event('change'))
    await new Promise((resolve) => setTimeout(resolve, 400))
    await settled()
    expect(placed(element, 'panelB').getAttribute('values')).toBe('{"knobS":12.5}')
    expect(placed(element, 'panelC').getAttribute('values')).toBe('{"knobS":12.5}')
    // neither panel grids over the shared knob, so each runs once over it, and
    // what each drew is the state the one control is at
    expect(simulationsOf('panelB')).toEqual([
      { values: { knobS: 25 }, grid: { knobB: 3 }, variant: 'variantA' },
      { values: { knobB: 1 }, grid: { knobS: 2 }, variant: 'variantA' },
    ])
    expect(simulationsOf('panelC')).toEqual([
      { values: { knobS: 25 }, grid: { knobC: 3 }, variant: 'variantA' },
      { values: { knobC: 1 }, grid: { knobS: 2 }, variant: 'variantA' },
    ])
    expect(panelKnobs(element, 'panelB')).toEqual(['knob-knobB'])
    expect(panelKnobs(element, 'panelC')).toEqual(['knob-knobC'])
  })

  it('leaves a panel which declares no shared knob alone when one moves', async () => {
    declared = app({
      pages: [{ id: 'pageA', title: 'Page A', panels: ['panelB', 'panelC', 'panelD'] }],
    })
    knobsOf = {
      panelB: [rangeKnob('knobB'), choiceKnob('knobS')],
      panelC: [rangeKnob('knobC'), choiceKnob('knobS')],
      panelD: [rangeKnob('knobD'), choiceKnob('knobT')],
    }
    const element = await shell()
    expect(shellKnobs(element)).toEqual(['knob-knobS'])
    expect(placed(element, 'panelD').hasAttribute('values')).toBe(false)
    expect(panelKnobs(element, 'panelD')).toEqual(['knob-knobD', 'knob-knobT'])
    const select = part(element, '#knob-knobS') as HTMLSelectElement
    select.value = '12.5'
    select.dispatchEvent(new Event('change'))
    await new Promise((resolve) => setTimeout(resolve, 400))
    await settled()
    expect(simulationsOf('panelB')).toHaveLength(2)
    expect(simulationsOf('panelD')).toHaveLength(1)
    expect(placed(element, 'panelD').hasAttribute('values')).toBe(false)
  })

  it('lists the shared knobs in the order the first panel which declares one lists them', async () => {
    declared = app({
      pages: [{ id: 'pageA', title: 'Page A', panels: ['panelB', 'panelC', 'panelD'] }],
    })
    knobsOf = {
      panelB: [choiceKnob('knobT'), choiceKnob('knobOwn')],
      panelC: [choiceKnob('knobS'), choiceKnob('knobT')],
      panelD: [choiceKnob('knobS')],
    }
    const element = await shell()
    expect(shellKnobs(element)).toEqual(['knob-knobT', 'knob-knobS'])
    expect(placed(element, 'panelB').getAttribute('values')).toBe('{"knobT":25}')
    expect(placed(element, 'panelC').getAttribute('values')).toBe('{"knobT":25,"knobS":25}')
    expect(placed(element, 'panelD').getAttribute('values')).toBe('{"knobS":25}')
    expect(panelKnobs(element, 'panelB')).toEqual(['knob-knobOwn'])
  })

  it('starts the shared knobs at their defaults when the page is shown again', async () => {
    const element = await shell({ page: 'pageB' })
    const slider = part(element, '#knob-knobA') as HTMLInputElement
    slider.value = '0.5'
    slider.dispatchEvent(new Event('input'))
    await settled()
    expect(placed(element, 'panelB').getAttribute('values')).toBe('{"knobA":0.5}')
    tabs(element)[0]?.click()
    await settled()
    tabs(element)[1]?.click()
    await settled()
    expect((part(element, '#knob-knobA') as HTMLInputElement).value).toBe('1')
    expect(placed(element, 'panelB').getAttribute('values')).toBe('{"knobA":1}')
    expect(placed(element, 'panelC').getAttribute('values')).toBe('{"knobA":1}')
    // the shell reads no declaration of a panel, the panel reads its own on every visit
    expect(calls.filter((one) => one.url.endsWith('/panels/panelB'))).toHaveLength(2)
  })

  it('reads which knobs a page shares from the app and no declaration of a panel', async () => {
    const element = await shell({ page: 'pageB' })
    expect(shellKnobs(element)).toEqual(['knob-knobA'])
    // the only request of the shell is the app; each panel reads itself once
    expect(calls.filter((one) => one.url.endsWith('/panels/panelB'))).toHaveLength(1)
    expect(calls.filter((one) => one.url.endsWith('/panels/panelC'))).toHaveLength(1)
    expect(calls.filter((one) => !one.url.includes('/panels/')).map((one) => one.url)).toEqual([
      '/api-root/api/models/modelA/app',
    ])
  })

  it('draws every panel at the state of the shared controls whatever knob it grids over', async () => {
    declared = app({
      pages: [{ id: 'pageA', title: 'Page A', panels: ['panelB', 'panelC', 'panelD'] }],
    })
    // panelB and panelD grid over their range knob, panelC over the choice
    knobsOf = {
      panelB: [rangeKnob('knobR'), choiceKnob('knobS')],
      panelC: [choiceKnob('knobS'), choiceKnob('knobT')],
      panelD: [rangeKnob('knobR'), choiceKnob('knobS'), choiceKnob('knobT')],
    }
    const element = await shell()
    vi.useFakeTimers()
    expect(shellKnobs(element)).toEqual(['knob-knobR', 'knob-knobS', 'knob-knobT'])
    const select = (id: string): HTMLSelectElement =>
      part(element, `#knob-${id}`) as HTMLSelectElement
    const slider = part(element, '#knob-knobR') as HTMLInputElement
    const moves: [HTMLInputElement | HTMLSelectElement, string, string][] = [
      [select('knobS'), '12.5', 'change'],
      [slider, '0.4', 'input'],
      [slider, '0.3', 'input'],
      [select('knobT'), '12.5', 'change'],
      [slider, '0.3', 'change'],
      [select('knobS'), '25', 'change'],
      [select('knobT'), '25', 'change'],
      [select('knobS'), '12.5', 'change'],
    ]
    for (const [control, value, kind] of moves) {
      control.value = value
      control.dispatchEvent(new Event(kind))
      await vi.advanceTimersByTimeAsync(30)
    }
    await vi.advanceTimersByTimeAsync(500)
    const state = { knobR: 0.3, knobS: 12.5, knobT: 25 }
    for (const id of ['panelB', 'panelC', 'panelD']) {
      const declares = (knobsOf[id] ?? []).map((one) => one.id)
      const given = JSON.parse(placed(element, id).getAttribute('values') ?? '{}') as Record<
        string,
        number
      >
      expect(given, id).toEqual(
        Object.fromEntries(declares.map((knob) => [knob, state[knob as keyof typeof state]])),
      )
      // the last run of the panel is at the state of the controls: a knob it
      // grids over is read out of its answer, every other one was sent
      const last = simulationsOf(id).at(-1) ?? {}
      for (const knob of declares) {
        const sent = last.values?.[knob]
        const gridded = last.grid?.[knob] !== undefined
        expect(gridded || sent === state[knob as keyof typeof state], `${id} ${knob}`).toBe(true)
      }
      expect(inside(placed(element, id)).querySelector('.error'), id).toBeNull()
    }
  })

  it('resets the shared knobs of the page, and only where they moved', async () => {
    const element = await shell({ page: 'pageB' })
    const button = part(element, '.knobs button.reset') as HTMLButtonElement
    // a reset with nothing to do says so and stays focusable
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    const slider = part(element, '#knob-knobA') as HTMLInputElement
    slider.value = '0.5'
    slider.dispatchEvent(new Event('input'))
    await settled()
    expect(button.hasAttribute('aria-disabled')).toBe(false)
    button.click()
    await settled()
    expect((part(element, '#knob-knobA') as HTMLInputElement).value).toBe('1')
    expect(placed(element, 'panelB').getAttribute('values')).toBe('{"knobA":1}')
    expect(placed(element, 'panelC').getAttribute('values')).toBe('{"knobA":1}')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.disabled).toBe(false)
  })

  it('tells a screen reader which panels a shared control sets', async () => {
    const element = await shell({ page: 'pageB' })
    const slider = part(element, '#knob-knobA')
    const described = slider.getAttribute('aria-describedby') ?? ''
    expect(part(element, `#${described}`).textContent.trim()).toBe(
      'Sets Title of panelB, Title of panelC',
    )
  })

  it('shares a knob whose id is a name every object has', async () => {
    knobsOf = {
      panelB: [choiceKnob('constructor'), choiceKnob('__proto__')],
      panelC: [choiceKnob('constructor'), choiceKnob('__proto__')],
    }
    const element = await shell({ page: 'pageB' })
    expect(shellKnobs(element)).toEqual(['knob-constructor', 'knob-__proto__'])
    expect((part(element, '#knob-constructor') as HTMLSelectElement).value).toBe('25')
    expect(placed(element, 'panelB').getAttribute('values')).toBe(
      '{"constructor":25,"__proto__":25}',
    )
    const select = part(element, '#knob-__proto__') as HTMLSelectElement
    select.value = '12.5'
    select.dispatchEvent(new Event('change'))
    await settled()
    expect(placed(element, 'panelC').getAttribute('values')).toBe(
      '{"constructor":25,"__proto__":12.5}',
    )
    expect(panelKnobs(element, 'panelB')).toEqual([])
  })

  it('keeps the keys a shared knob uses from the page', async () => {
    const element = await shell({ page: 'pageB' })
    const seen: string[] = []
    document.addEventListener('keydown', (event) => seen.push(event.key))
    const slider = part(element, '#knob-knobA')
    for (const key of ['ArrowLeft', 'End', 'n']) {
      slider.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true }))
    }
    expect(seen).toEqual(['n'])
  })

  it('keeps a shared knob of a page whose panel cannot be read', async () => {
    let refused = true
    const stub = globalThis.fetch
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (url.endsWith('/panels/panelC') && refused) {
        refused = false
        return Promise.resolve({ ok: false, status: 500 } as Response)
      }
      return stub(url, init)
    })
    const element = await shell({ page: 'pageB' })
    // the panel which could not be read says so, and the page keeps one control
    expect(shellKnobs(element)).toEqual(['knob-knobA'])
    expect(panelKnobs(element, 'panelB')).toEqual([])
    expect(inside(placed(element, 'panelC')).querySelector('.error')?.textContent).toBe(
      FAILURE_MESSAGES.http,
    )
    expect(placed(element, 'panelC').getAttribute('values')).toBe('{"knobA":1}')
  })
})
