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
type Given = Omit<AppDeclaration, 'shared' | 'heads' | 'variant'>

/** The app every test starts from: two pages, two variants and the texts of the footer. */
function app(more: Partial<AppDeclaration> = {}): Given {
  return {
    contract: 'app/1',
    title: 'Model A',
    subtitle: 'what model A is',
    pages: [
      { id: 'pageA', title: 'Page A', panels: ['panelA'], scenarios: [] },
      { id: 'pageB', title: 'Page B', panels: ['panelB', 'panelC'], scenarios: [] },
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
      x_label: 'time',
      y_label: '',
      y_min: null,
      y_max: null,
      x_max: null,
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
    simulation: { variant: null, end: 120, points: 2, x_unit: 'h', preinit: {}, derived: {} },
    limits: { end: 10000, points: 2000, knobs: 8, grid: 64, curves: 16 },
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
function sharedOf(given: Given, variant: string | null = null): AppDeclaration['shared'] {
  return Object.fromEntries(
    given.pages.map((page) => {
      const first = new Map<string, PanelAxis>()
      const declaring = new Map<string, string[]>()
      for (const id of page.panels) {
        const own = variant === null ? undefined : variantKnobs[variant]?.[id]
        for (const knob of own ?? knobsOf[id] ?? panelDeclaration(id).axes) {
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

/** The app of a variant by its id, for one which differs from `declared`; `null` for one the app does not name. */
let variantApps: Record<string, Given | null> = {}

/** The knobs of a panel by its id in a variant, for a variant whose panels declare others. */
let variantKnobs: Record<string, Record<string, PanelAxis[]>> = {}

/** A gate the app of a variant waits for before it answers, `null` for one which answers at once. */
let appGate: Promise<void> | null = null

/** Whether the simulations hang until they are stopped, with the signals they were given. */
let hang: AbortSignal[] | null = null

/** The requests since the test started. */
let calls: Call[] = []

/** Build the answer of a route which carries a body. */
function json(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response
}

/** Get the path of a request, without the query which names its variant. */
function pathOf(call: Call): string {
  return call.url.split('?')[0] ?? ''
}

/** The requests of the app, which the shell makes once per variant it is read in. */
function appCalls(): Call[] {
  return calls.filter((one) => (one.url.split('?')[0] ?? '').endsWith('/app'))
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
  variantApps = {}
  variantKnobs = {}
  appGate = null
  subtitlesOf = {}
  calls = []
  hang = null
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as SimulateRequest) : null
    calls.push({ url, body })
    if (declared === null) {
      return Promise.reject(new TypeError('Failed to fetch'))
    }
    // a route is read in a variant with the query `variant`
    const [path = '', query = ''] = url.split('?')
    const variant = new URLSearchParams(query).get('variant')
    if (path.endsWith('/app')) {
      const given =
        variant !== null && Object.hasOwn(variantApps, variant)
          ? (variantApps[variant] ?? null)
          : declared
      const answer =
        given === null
          ? ({ ok: false, status: 422 } as unknown as Response)
          : json({
              ...given,
              shared: sharedOf(given, variant),
              heads: headsOf(given),
              // the variant the app answers: the one asked for, else the
              // default variant, the first of the stub
              variant: variant ?? given.variants[0]?.id ?? 'variantA',
            })
      const gate = variant === null ? null : appGate
      return gate === null ? Promise.resolve(answer) : gate.then(() => answer)
    }
    if (path.endsWith('/simulate')) {
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
    const id = path.split('/panels/')[1] ?? 'panelA'
    const declaredKnobs =
      (variant === null ? undefined : variantKnobs[variant]?.[id]) ?? knobsOf[id]
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
    expect(calls.some((one) => pathOf(one).endsWith('/panels/panelB'))).toBe(true)
    expect(calls.some((one) => pathOf(one).endsWith('/panels/panelC'))).toBe(true)
  })

  it('passes the chosen variant to every panel of the page', async () => {
    const element = await shell({ page: 'pageB' })
    expect(simulations().map((one) => one.variant)).toEqual(['variantA', 'variantA'])
    const read = calls.filter((one) => pathOf(one).endsWith('/panels/panelB')).length
    const select = part(element, '.variant-select') as HTMLSelectElement
    expect([...select.options].map((one) => one.value)).toEqual(['variantA', 'variantB'])
    select.value = 'variantB'
    select.dispatchEvent(new Event('change'))
    await new Promise((resolve) => setTimeout(resolve, 400))
    await settled()
    const after = simulations().slice(2)
    expect(after.map((one) => one.variant)).toEqual(['variantB', 'variantB'])
    // the app and the declarations are read again in the variant, which they may differ by
    expect(appCalls().map((one) => one.url.split('?')[1])).toEqual([undefined, 'variant=variantB'])
    expect(
      calls
        .filter((one) => pathOf(one).endsWith('/panels/panelB'))
        .slice(read)
        .map((one) => one.url.split('?')[1]),
    ).toEqual(['variant=variantB'])
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
      pages: [{ id: 'pageA', title: 'Page A', panels: ['panelA'], scenarios: [] }],
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

  it('lays its panels out in as many columns as fit 480px and collapses an empty track', async () => {
    const element = await shell()
    const style = [...element.shadowRoot.querySelectorAll('style')]
      .map((one) => one.textContent)
      .join('\n')
    // one column below about 976px of the width of the shell, two above, and a
    // lone panel takes the row, which `auto-fit` is for and `auto-fill` is not
    const grid = /\n\.grid \{[^}]*\}/.exec(style)?.[0] ?? ''
    expect(grid).toMatch(/repeat\(auto-fit,\s*minmax\(min\(100%,\s*480px\),\s*1fr\)\)/)
    expect(grid).not.toMatch(/auto-fill/)
  })

  it('lays itself out in px and never in rem, which the root font of a host changes', async () => {
    const element = await shell()
    const style = [...element.shadowRoot.querySelectorAll('style')]
      .map((one) => one.textContent)
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(style).not.toMatch(/\d\s*rem\b/)
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
    declared = app({ pages: [{ id: 'pageA', title: 'Page A', panels: ['panelA'], scenarios: [] }] })
    const element = await shell()
    expect(element.shadowRoot.querySelector('.reserve-head')).not.toBeNull()
    // the stub derives the heads from the declarations; an empty head is none
    const answered = {
      ...declared,
      shared: {},
      heads: { pageA: [{ id: 'panelA', title: '', subtitle: '' }] },
      variant: 'variantA',
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
    // the scheme is the one the page declares, or the one `theme` names
    expect(style).not.toMatch(/:host\s*{[^}]*color-scheme/)
    expect(style).not.toContain('prefers-color-scheme')
    expect(style).toMatch(/:host\(\[theme='dark'\]\)\s*{[^}]*color-scheme:\s*dark/)
    // a panel of the app sits on its card, which is its surface
    expect(style).toMatch(/\.cell > ::part\(panel\)\s*{[^}]*background:\s*transparent/)
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

  it('draws the select of the stops of a shared range knob, which moves every panel', async () => {
    const stopped = {
      ...rangeKnob('knobA'),
      choices: [
        { label: 'full', value: 1 },
        { label: 'half', value: 0.5 },
      ],
    }
    knobsOf = { panelB: [stopped], panelC: [stopped] }
    const element = await shell({ page: 'pageB' })
    // the control a panel draws: one label, the select of the stops and the slider
    expect(shellKnobs(element)).toEqual(['knob-knobA-stops', 'knob-knobA'])
    expect(element.shadowRoot.querySelectorAll('.knobs label')).toHaveLength(1)
    const stops = part(element, '#knob-knobA-stops') as HTMLSelectElement
    expect(stops.value).toBe('1')
    stops.value = '0.5'
    stops.dispatchEvent(new Event('change'))
    await settled()
    expect((part(element, '#knob-knobA') as HTMLInputElement).value).toBe('0.5')
    expect(placed(element, 'panelB').getAttribute('values')).toBe('{"knobA":0.5}')
    expect(placed(element, 'panelC').getAttribute('values')).toBe('{"knobA":0.5}')
    const slider = part(element, '#knob-knobA') as HTMLInputElement
    slider.value = '0.7'
    slider.dispatchEvent(new Event('input'))
    await settled()
    expect(stops.value).toBe('custom')
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
      pages: [
        { id: 'pageA', title: 'Page A', panels: ['panelB', 'panelC', 'panelD'], scenarios: [] },
      ],
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
      pages: [
        { id: 'pageA', title: 'Page A', panels: ['panelB', 'panelC', 'panelD'], scenarios: [] },
      ],
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
    expect(calls.filter((one) => pathOf(one).endsWith('/panels/panelB'))).toHaveLength(2)
  })

  it('reads which knobs a page shares from the app and no declaration of a panel', async () => {
    const element = await shell({ page: 'pageB' })
    expect(shellKnobs(element)).toEqual(['knob-knobA'])
    // the only request of the shell is the app; each panel reads itself once
    expect(calls.filter((one) => pathOf(one).endsWith('/panels/panelB'))).toHaveLength(1)
    expect(calls.filter((one) => pathOf(one).endsWith('/panels/panelC'))).toHaveLength(1)
    expect(calls.filter((one) => !one.url.includes('/panels/')).map((one) => one.url)).toEqual([
      '/api-root/api/models/modelA/app',
    ])
  })

  it('draws every panel at the state of the shared controls whatever knob it grids over', async () => {
    declared = app({
      pages: [
        { id: 'pageA', title: 'Page A', panels: ['panelB', 'panelC', 'panelD'], scenarios: [] },
      ],
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
    const description = part(element, `#${described}`)
    expect(description.textContent.trim()).toBe('Sets Title of panelB, Title of panelC')
    // hidden, so the text is heard once as the description of its control and not
    // again in the reading order of the page
    expect(description.hasAttribute('hidden')).toBe(true)
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
      if ((url.split('?')[0] ?? '').endsWith('/panels/panelC') && refused) {
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

describe('the scenarios of a page', () => {
  /** The scenarios of page B: two states of its two shared knobs, and one of one knob. */
  const SCENARIOS = [
    { id: 'one', label: 'Scenario one', values: { knobR: 0.5, knobS: 12.5 } },
    { id: 'two', label: 'Scenario two', values: { knobR: 1, knobS: 25 } },
    { id: 'half', label: 'Half', values: { knobR: 0.5 } },
  ]

  /** The app whose page B lists the scenarios, and whose panels share both knobs. */
  function withScenarios(): void {
    const given = app()
    declared = {
      ...given,
      pages: given.pages.map((page) =>
        page.id === 'pageB' ? { ...page, scenarios: SCENARIOS } : page,
      ),
    }
    knobsOf = {
      panelB: [rangeKnob('knobR'), choiceKnob('knobS')],
      panelC: [rangeKnob('knobR'), choiceKnob('knobS')],
    }
  }

  /** Get the select of the scenarios. */
  function select(element: AppElement): HTMLSelectElement {
    return part(element, '#scenario') as HTMLSelectElement
  }

  /** The simulations one panel asked for. */
  function simulationsOf(id: string): SimulateRequest[] {
    return calls
      .filter((one) => one.url.endsWith(`/panels/${id}/simulate`))
      .map((one) => one.body ?? {})
  }

  /** Let a release of a knob reach its run, past the debounce of the panel. */
  async function released(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 400))
    await settled()
  }

  it('draws a select of them above the shared controls, at the one the knobs are at', async () => {
    withScenarios()
    const element = await shell({ page: 'pageB' })
    const labels = [...element.shadowRoot.querySelectorAll('.knobs label')].map((one) =>
      one.textContent.trim(),
    )
    expect(labels).toEqual(['Example', 'knob knobR [mg]', 'knob knobS'])
    expect(part(element, 'label[for="scenario"]').textContent.trim()).toBe('Example')
    expect([...select(element).options].map((one) => one.textContent.trim())).toEqual([
      'Scenario one',
      'Scenario two',
      'Half',
    ])
    // the defaults are the state of the second scenario
    expect(select(element).value).toBe('two')
    // a page without scenarios draws no select of them
    tabs(element)[0]?.click()
    await settled()
    expect(element.shadowRoot.querySelector('#scenario')).toBeNull()
  })

  it('sets every knob a scenario names in one state, one run per panel', async () => {
    withScenarios()
    const element = await shell({ page: 'pageB' })
    const select = part(element, '#scenario') as HTMLSelectElement
    select.value = 'one'
    select.dispatchEvent(new Event('change'))
    await released()
    for (const id of ['panelB', 'panelC']) {
      expect(part(element, `sbmlsim-panel[panel="${id}"]`).getAttribute('values')).toBe(
        '{"knobR":0.5,"knobS":12.5}',
      )
      // the first run grids over the range knob, which the pick reads out of
      // it, and the choice knob is one run, whatever else moved with it
      expect(simulationsOf(id)).toHaveLength(2)
    }
    expect((part(element, '#knob-knobR') as HTMLInputElement).value).toBe('0.5')
    expect((part(element, '#knob-knobS') as HTMLSelectElement).value).toBe('12.5')
    expect(select.value).toBe('one')
  })

  it('leaves a knob a scenario does not name where it is', async () => {
    withScenarios()
    const element = await shell({ page: 'pageB' })
    const choice = part(element, '#knob-knobS') as HTMLSelectElement
    choice.value = '12.5'
    choice.dispatchEvent(new Event('change'))
    await settled()
    select(element).value = 'half'
    select(element).dispatchEvent(new Event('change'))
    await settled()
    expect(part(element, 'sbmlsim-panel[panel="panelB"]').getAttribute('values')).toBe(
      '{"knobR":0.5,"knobS":12.5}',
    )
    // that state is the one of the first scenario as well, which the select
    // shows, since it lists it first
    expect(select(element).value).toBe('one')
  })

  it('picks a scenario of any id, the id custom among them', async () => {
    withScenarios()
    const given = declared ?? app()
    declared = {
      ...given,
      pages: given.pages.map((page) =>
        page.id === 'pageB'
          ? { ...page, scenarios: [{ id: 'custom', label: 'Custom', values: { knobR: 0.5 } }] }
          : page,
      ),
    }
    const element = await shell({ page: 'pageB' })
    select(element).value = 'custom'
    select(element).dispatchEvent(new Event('change'))
    await settled()
    expect(part(element, 'sbmlsim-panel[panel="panelB"]').getAttribute('values')).toBe(
      '{"knobR":0.5,"knobS":25}',
    )
    expect(select(element).value).toBe('custom')
  })

  it('shows an entry which cannot be picked where the knobs are at no scenario, and follows a reset', async () => {
    withScenarios()
    const element = await shell({ page: 'pageB' })
    const choice = part(element, '#knob-knobS') as HTMLSelectElement
    choice.value = '12.5'
    choice.dispatchEvent(new Event('change'))
    await settled()
    expect(select(element).value).toBe('')
    const custom = [...select(element).options].find((one) => one.value === '')
    expect(custom?.textContent.trim()).toBe('custom')
    expect(custom?.disabled).toBe(true)
    ;(part(element, '.knobs .reset') as HTMLButtonElement).click()
    await settled()
    expect(select(element).value).toBe('two')
    expect([...select(element).options].map((one) => one.value)).toEqual(['one', 'two', 'half'])
  })
})

describe('the variant of the app', () => {
  /** The shared knob of page B in a variant, a range knob of other bounds and another label. */
  function narrowed(max: number, label: string): PanelAxis {
    return { ...rangeKnob('knobA'), label, max, default: max / 2 }
  }

  /** Switch the variant with the switcher, as a reader does. */
  async function choose(element: AppElement, variant: string): Promise<void> {
    const select = part(element, '.variant-select') as HTMLSelectElement
    select.value = variant
    select.dispatchEvent(new Event('change'))
    await settled()
  }

  /** Get the attribute of a placed panel. */
  function attributeOf(element: AppElement, id: string, name: string): string | null {
    return part(element, `sbmlsim-panel[panel="${id}"]`).getAttribute(name)
  }

  it('draws the controls of the variant it is switched to, read in that variant', async () => {
    variantKnobs = {
      variantB: { panelB: [narrowed(2, 'knob of B')], panelC: [narrowed(2, 'knob of B')] },
    }
    const element = await shell({ page: 'pageB' })
    expect(part(element, '.knobs .knob-label').textContent.trim()).toBe('knob A [mg]')
    await choose(element, 'variantB')
    expect(appCalls().map((one) => one.url)).toEqual([
      '/api-root/api/models/modelA/app',
      '/api-root/api/models/modelA/app?variant=variantB',
    ])
    expect(part(element, '.knobs .knob-label').textContent.trim()).toBe('knob of B [mg]')
    expect((part(element, '#knob-knobA') as HTMLInputElement).max).toBe('2')
    expect(attributeOf(element, 'panelB', 'variant')).toBe('variantB')
    // and back, and to B again: the app of each variant was read and is drawn
    // without a request, the first one too, since it names its variant
    await choose(element, 'variantA')
    expect(part(element, '.knobs .knob-label').textContent.trim()).toBe('knob A [mg]')
    expect(appCalls()).toHaveLength(2)
    await choose(element, 'variantB')
    expect(part(element, '.knobs .knob-label').textContent.trim()).toBe('knob of B [mg]')
    expect(appCalls()).toHaveLength(2)
  })

  it('keeps the value of a shared knob the variant takes, and starts any other at its default', async () => {
    variantKnobs = {
      variantB: { panelB: [narrowed(2, 'knob of B')], panelC: [narrowed(2, 'knob of B')] },
      variantC: { panelB: [narrowed(0.4, 'knob of C')], panelC: [narrowed(0.4, 'knob of C')] },
    }
    declared = {
      ...app(),
      variants: [
        { id: 'variantA', label: 'Variant A' },
        { id: 'variantB', label: 'Variant B' },
        { id: 'variantC', label: 'Variant C' },
      ],
    }
    const element = await shell({ page: 'pageB' })
    const slider = part(element, '#knob-knobA') as HTMLInputElement
    slider.value = '0.6'
    slider.dispatchEvent(new Event('change'))
    await settled()
    // 0.6 is a value of the knob of B, from 0 to 2
    await choose(element, 'variantB')
    expect(attributeOf(element, 'panelB', 'values')).toBe('{"knobA":0.6}')
    expect(attributeOf(element, 'panelC', 'values')).toBe('{"knobA":0.6}')
    // and none of the knob of C, from 0 to 0.4, which starts at its default
    await choose(element, 'variantC')
    expect(attributeOf(element, 'panelB', 'values')).toBe('{"knobA":0.2}')
    expect((part(element, '#knob-knobA') as HTMLInputElement).value).toBe('0.2')
  })

  it('holds the panels inert under a caption while it reads the app of a variant, and gives every panel the variant with its values at once', async () => {
    let open: (() => void) | null = null
    appGate = new Promise((resolve) => {
      open = () => {
        resolve()
      }
    })
    const element = await shell({ page: 'pageB' })
    const before = calls.length
    await choose(element, 'variantB')
    const grid = part(element, '.grid')
    expect(grid.classList.contains('switching')).toBe(true)
    expect(grid.getAttribute('aria-busy')).toBe('true')
    // the panels keep the variant they draw, inert and hidden from a reader,
    // under a caption which names the variant, and the controls and the tabs
    // take no movement
    expect(part(element, '.variant .caption').textContent.trim()).toBe('Switching to Variant B …')
    // the caption keeps the room of the longest caption of every variant, laid out and not drawn
    expect(
      [...element.shadowRoot.querySelectorAll('.variant .switching-copy')].map((one) =>
        one.textContent.trim(),
      ),
    ).toEqual(['Switching to Variant A …', 'Switching to Variant B …'])
    // the provenance line of the answers of the variant before stays, dimmed and hidden from a reader
    const line = part(element, '.simulated')
    expect(line.textContent).toContain(`model ${'c'.repeat(8)}`)
    expect(line.classList.contains('held')).toBe(true)
    expect(line.getAttribute('aria-hidden')).toBe('true')
    for (const id of ['panelB', 'panelC']) {
      const placed = part(element, `sbmlsim-panel[panel="${id}"]`) as HTMLElement
      expect(placed.inert).toBe(true)
      expect(placed.getAttribute('aria-hidden')).toBe('true')
    }
    expect(attributeOf(element, 'panelB', 'variant')).toBe('variantA')
    expect((part(element, '#knob-knobA') as HTMLInputElement).disabled).toBe(true)
    expect(tabs(element).every((one) => one.disabled)).toBe(true)
    expect(calls.slice(before).filter((one) => pathOf(one).includes('/panels/'))).toEqual([])
    ;(open as unknown as () => void)()
    await new Promise((resolve) => setTimeout(resolve, 400))
    await settled()
    expect(grid.classList.contains('switching')).toBe(false)
    expect(attributeOf(element, 'panelB', 'variant')).toBe('variantB')
    expect((part(element, '#knob-knobA') as HTMLInputElement).disabled).toBe(false)
    expect(tabs(element).some((one) => one.disabled)).toBe(false)
    expect((part(element, 'sbmlsim-panel[panel="panelB"]') as HTMLElement).inert).toBe(false)
    // every panel drew its figure of the variant, so the caption is gone, and
    // the provenance line names the answers of the variant, no longer dimmed
    expect(part(element, '.variant .caption').textContent.trim()).toBe('')
    expect(part(element, '.simulated').classList.contains('held')).toBe(false)
    expect(part(element, '.simulated').textContent).toContain(`model ${'b'.repeat(8)}`)
    expect(part(element, '.simulated').textContent).not.toContain(`model ${'c'.repeat(8)}`)
    expect(grid.getAttribute('aria-busy')).toBe('false')
    // one declaration and one run per panel, both of the variant
    for (const id of ['panelB', 'panelC']) {
      const asked = calls.slice(before).filter((one) => pathOf(one).includes(`/panels/${id}`))
      expect(asked.map((one) => one.url.split('?')[1] ?? 'none')).toEqual([
        'variant=variantB',
        'none',
      ])
      expect(asked[1]?.body?.variant).toBe('variantB')
    }
  })

  it('keeps the provenance line of the variant before, dimmed, while the runs of the new one are pending', async () => {
    const element = await shell({ page: 'pageB' })
    // the runs of the variant switched to do not answer while the test looks
    hang = []
    await choose(element, 'variantB')
    await new Promise((resolve) => setTimeout(resolve, 400))
    await settled()
    expect(attributeOf(element, 'panelB', 'variant')).toBe('variantB')
    const line = part(element, '.simulated')
    expect(line.textContent).toContain(`model ${'c'.repeat(8)}`)
    expect(line.classList.contains('held')).toBe(true)
  })

  it('drops the answer of a panel whose run of the variant fails from the provenance line', async () => {
    const element = await shell({ page: 'pageB' })
    const fetched = globalThis.fetch
    // the runs of variant B answer for panel C and fail for panel B, whose
    // answers name their model by the panel, so the line tells them apart
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const body =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as SimulateRequest) : null
      if (url.endsWith('/simulate') && body?.variant === 'variantB') {
        if (url.includes('/panels/panelB/')) {
          return Promise.reject(new TypeError('Failed to fetch'))
        }
        const answer = run(body)
        return json({
          ...answer,
          provenance: { ...answer.provenance, panel: 'panelC', model_sha256: 'd'.repeat(64) },
        })
      }
      return fetched(url, init)
    })
    await choose(element, 'variantB')
    await new Promise((resolve) => setTimeout(resolve, 400))
    await settled()
    // the switch is done: panel C answered, panel B failed and holds no answer
    expect(part(element, '.variant .caption').textContent.trim()).toBe('')
    const line = part(element, '.simulated')
    expect(line.classList.contains('held')).toBe(false)
    expect(line.textContent).toContain(`model ${'d'.repeat(8)}`)
    expect(line.textContent).not.toContain(`model ${'c'.repeat(8)}`)
  })

  it('draws no panel of the variant before when the app of a variant cannot be read', async () => {
    variantApps = { variantB: null }
    const element = await shell({ page: 'pageB' })
    await choose(element, 'variantB')
    const line = part(element, '.error[role="alert"]')
    expect(line.textContent.trim()).toBe(
      `${FAILURE_MESSAGES.http} The panels of the variant shown cannot be drawn.`,
    )
    expect(part(element, '.grid').classList.contains('switching')).toBe(true)
    expect(attributeOf(element, 'panelB', 'variant')).toBe('variantA')
    // the figures of the variant before are cleared, and so is their provenance
    expect(element.shadowRoot.querySelector('.simulated')).toBeNull()
    // back on the variant which is drawn, it is drawn again as it was
    const before = calls.length
    await choose(element, 'variantA')
    expect(element.shadowRoot.querySelector('.error')).toBeNull()
    expect(part(element, '.grid').classList.contains('switching')).toBe(false)
    expect(calls.slice(before)).toEqual([])
  })
})

describe('the variant an app answers', () => {
  it('keeps the first app it read and asks for no app of the variant it is of', async () => {
    const element = await shell({ page: 'pageB' })
    const select = part(element, '.variant-select') as HTMLSelectElement
    select.value = 'variantB'
    select.dispatchEvent(new Event('change'))
    await settled()
    select.value = 'variantA'
    select.dispatchEvent(new Event('change'))
    await settled()
    // the app read without a variant said it is of variant A
    expect(appCalls().map((one) => one.url.split('?')[1])).toEqual([undefined, 'variant=variantB'])
  })

  it('refuses an app of another variant than the one it asked for', async () => {
    variantApps = { variantB: { ...app(), title: 'Model A of B' } }
    const element = await shell({ page: 'pageB' })
    // the stub answers every app of a variant as of the variant asked for, so
    // the answer is changed to say another one
    const fetched = globalThis.fetch
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const answer = await fetched(url, init)
      if (!url.includes('/app?variant=')) {
        return answer
      }
      const body = (await answer.json()) as Record<string, unknown>
      return json({ ...body, variant: 'variantA' })
    })
    const select = part(element, '.variant-select') as HTMLSelectElement
    select.value = 'variantB'
    select.dispatchEvent(new Event('change'))
    await settled()
    expect(part(element, '.error[role="alert"]').textContent.trim()).toBe(
      `${FAILURE_MESSAGES.body} The panels of the variant shown cannot be drawn.`,
    )
    expect(part(element, 'h1').textContent.trim()).toBe('Model A')
    expect(part(element, 'sbmlsim-panel[panel="panelB"]').getAttribute('variant')).toBe('variantA')
  })

  it('refuses an app of several variants which does not say which it is of', async () => {
    const fetched = globalThis.fetch
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const answer = await fetched(url, init)
      if (!url.endsWith('/app')) {
        return answer
      }
      const body = (await answer.json()) as Record<string, unknown>
      body.variant = ''
      return json(body)
    })
    const element = await shell()
    expect(part(element, '[role="alert"]').textContent.trim()).toBe(FAILURE_MESSAGES.body)
    // an app of one variant needs no switcher, so it may say nothing of its variant
    document.body.innerHTML = ''
    declared = app({ variants: [{ id: 'variantA', label: 'Variant A' }] })
    const one = await shell()
    expect(one.shadowRoot.querySelector('[role="alert"]')).toBeNull()
  })

  it('leaves out a shared knob whose control cannot be built, as a panel leaves it out', async () => {
    const broken = { ...choiceKnob('knobS'), choices: [{ label: 'low', value: 'x' }] }
    knobsOf = {
      panelB: [rangeKnob('knobA'), broken as unknown as PanelAxis],
      panelC: [rangeKnob('knobA'), broken as unknown as PanelAxis],
    }
    const element = await shell({ page: 'pageB' })
    expect(element.shadowRoot.querySelector('[role="alert"]')).toBeNull()
    expect(
      [...element.shadowRoot.querySelectorAll('.knobs .knob select, .knobs .knob input')].map(
        (one) => one.id,
      ),
    ).toEqual(['knob-knobA'])
  })
})

describe('the return paths of a switch of the variant', () => {
  /** Switch the variant with the switcher, as a reader does. */
  async function choose(element: AppElement, variant: string): Promise<void> {
    const select = part(element, '.variant-select') as HTMLSelectElement
    select.value = variant
    select.dispatchEvent(new Event('change'))
    await settled()
  }

  it('gives every panel the head the app names for it', async () => {
    subtitlesOf = { panelC: 'what panel C answers' }
    const element = await shell({ page: 'pageB' })
    expect(part(element, 'sbmlsim-panel[panel="panelC"]').getAttribute('head')).toBe(
      JSON.stringify({ title: 'Title of panelC', subtitle: 'what panel C answers' }),
    )
  })

  it('shows the provenance of the variant shown again after a failed switch and a return', async () => {
    variantApps = { variantB: null }
    const element = await shell({ page: 'pageB' })
    const before = part(element, '.simulated').textContent
    await choose(element, 'variantB')
    expect(element.shadowRoot.querySelector('.simulated')).toBeNull()
    await choose(element, 'variantA')
    expect(part(element, '.simulated').textContent).toBe(before)
    expect(part(element, '.simulated').classList.contains('held')).toBe(false)
  })

  it('keeps the caption of a switch whose runs are pending when the reader returns to it from a third variant', async () => {
    declared = {
      ...app(),
      variants: [
        { id: 'variantA', label: 'Variant A' },
        { id: 'variantB', label: 'Variant B' },
        { id: 'variantC', label: 'Variant C' },
      ],
    }
    const element = await shell({ page: 'pageB' })
    // the runs of B do not answer while the test looks
    hang = []
    await choose(element, 'variantB')
    await new Promise((resolve) => setTimeout(resolve, 400))
    await settled()
    expect(part(element, '.variant .caption').textContent.trim()).toBe('Switching to Variant B …')
    // on to C, whose app is still read, and back to B
    appGate = new Promise<void>(() => undefined)
    await choose(element, 'variantC')
    expect(part(element, '.variant .caption').textContent.trim()).toBe('Switching to Variant C …')
    await choose(element, 'variantB')
    // B is still not drawn: the caption names it and the provenance stays dimmed
    expect(part(element, '.variant .caption').textContent.trim()).toBe('Switching to Variant B …')
    expect(part(element, '.simulated').classList.contains('held')).toBe(true)
  })

  it('keeps a shared value of the variant before as the number the new variant declares', async () => {
    const slightly = {
      ...choiceKnob('knobS'),
      choices: [
        { label: 'low', value: 12.500000000000002 },
        { label: 'high', value: 25 },
      ],
    }
    knobsOf = { panelB: [choiceKnob('knobS')], panelC: [choiceKnob('knobS')] }
    variantKnobs = { variantB: { panelB: [slightly], panelC: [slightly] } }
    const element = await shell({ page: 'pageB' })
    const select = part(element, '#knob-knobS') as HTMLSelectElement
    select.value = '12.5'
    select.dispatchEvent(new Event('change'))
    await settled()
    await choose(element, 'variantB')
    expect(part(element, 'sbmlsim-panel[panel="panelB"]').getAttribute('values')).toBe(
      '{"knobS":12.500000000000002}',
    )
  })
})

describe('a page of small panels', () => {
  it('lays out small panels and gives each panel the size of its page', async () => {
    declared = app({
      pages: [
        {
          id: 'pageA',
          title: 'Page A',
          panels: ['panelA', 'panelB'],
          scenarios: [],
          size: 'small',
        },
        { id: 'pageB', title: 'Page B', panels: ['panelB'], scenarios: [] },
      ],
    })
    const element = await shell()
    const grid = part(element, '.grid')
    expect(grid.classList.contains('small')).toBe(true)
    for (const placed of element.shadowRoot.querySelectorAll('sbmlsim-panel')) {
      expect(placed.getAttribute('size')).toBe('small')
    }
    // a page without a size, as a service before sbmlsim 0.28 answers it, is regular
    ;(tabs(element)[1] as HTMLElement).click()
    await settled()
    expect(part(element, '.grid').classList.contains('small')).toBe(false)
    expect(part(element, 'sbmlsim-panel').getAttribute('size')).toBe('regular')
  })
})

describe('the draws of the uncertainty of a page', () => {
  it('gives every panel of the page the number the app is given', async () => {
    const element = await shell({ draws: '16' })
    const placed = element.shadowRoot.querySelectorAll('sbmlsim-panel')
    expect(placed.length).toBeGreaterThan(0)
    for (const panel of placed) {
      expect(panel.getAttribute('draws')).toBe('16')
    }
  })

  it('writes no attribute at all without one, so every panel keeps what it declares', async () => {
    const element = await shell()
    for (const panel of element.shadowRoot.querySelectorAll('sbmlsim-panel')) {
      expect(panel.hasAttribute('draws')).toBe(false)
    }
  })
})

describe('the figure of an app', () => {
  /** An app whose page shows the figure, with a panel for the liver and one for the kidney. */
  function appWithFigure(more: Partial<AppDeclaration> = {}): Given {
    return app({
      variants: [],
      pages: [
        {
          id: 'pageA',
          title: 'Page A',
          panels: ['glimepiride', 'm1', 'li_gli', 'ki_gli', 'ki_m1'],
          scenarios: [],
          figure: true,
          shown: ['glimepiride', 'm1'],
        },
      ],
      figure: {
        svg: '<svg viewBox="0 0 10 10"><g data-k="li"></g></svg>',
        title: 'The body',
        credit: '',
        panels: {
          'li/sub:gli': ['li_gli'],
          ki: ['ki_gli', 'ki_m1'],
          'ki/sub:gli': ['ki_gli'],
          frame: [],
        },
      },
      ...more,
    })
  }

  /** The ids of the panels the shell placed, in the order of the grid. */
  function placedPanels(element: AppElement): string[] {
    return panels(element)
  }

  /** The figure element of the shell. */
  function figureOf(element: AppElement): HTMLElement & {
    marked: string[]
    labels: Record<string, string>
  } {
    return part(element, 'sbmlsim-figure') as never
  }

  /** Click a key path of the figure, as the element reports it. */
  async function clickKey(element: AppElement, key: string): Promise<void> {
    figureOf(element).dispatchEvent(
      new CustomEvent('sbmlsim-figure-select', { detail: { key }, bubbles: true, composed: true }),
    )
    await settled()
  }

  it('places the panels the page shows before anything is clicked', async () => {
    declared = appWithFigure()
    const element = await shell()
    expect(placedPanels(element)).toEqual(['glimepiride', 'm1'])
  })

  it('adds the panels of a clicked key and removes them when it is clicked again', async () => {
    declared = appWithFigure()
    const element = await shell()
    await clickKey(element, 'li/sub:gli')
    expect(placedPanels(element)).toEqual(['glimepiride', 'm1', 'li_gli'])
    expect(element.getAttribute('selection')).toBe('glimepiride,m1,li_gli')
    await clickKey(element, 'li/sub:gli')
    expect(placedPanels(element)).toEqual(['glimepiride', 'm1'])
  })

  it('places the panels in the order the page declares them, whatever order they were clicked in', async () => {
    declared = appWithFigure()
    const element = await shell()
    await clickKey(element, 'ki')
    await clickKey(element, 'li/sub:gli')
    expect(placedPanels(element)).toEqual(['glimepiride', 'm1', 'li_gli', 'ki_gli', 'ki_m1'])
  })

  it('tells the page the selection with the panels in page order', async () => {
    declared = appWithFigure()
    const element = await shell()
    const heard: string[][] = []
    element.addEventListener('sbmlsim-selection', (event) => {
      heard.push((event as CustomEvent<{ panels: string[] }>).detail.panels)
    })
    await clickKey(element, 'ki')
    expect(heard).toEqual([['glimepiride', 'm1', 'ki_gli', 'ki_m1']])
  })

  it('reads the attribute selection, which the page may set', async () => {
    declared = appWithFigure()
    const element = await shell({ selection: 'li_gli' })
    expect(placedPanels(element)).toEqual(['li_gli'])
    element.setAttribute('selection', '')
    await settled()
    expect(placedPanels(element)).toEqual([])
  })

  it('marks the keys every panel of which is shown and names them by their panels', async () => {
    declared = appWithFigure()
    const element = await shell()
    expect(figureOf(element).marked).toEqual([])
    await clickKey(element, 'ki')
    expect(figureOf(element).marked).toEqual(['ki', 'ki/sub:gli'])
    expect(figureOf(element).labels.ki).toBe('Title of ki_gli')
    expect(figureOf(element).labels.frame).toBeUndefined()
  })

  it('removes exactly the panels of the key clicked when another shown key shares one', async () => {
    declared = appWithFigure()
    const element = await shell()
    await clickKey(element, 'ki')
    await clickKey(element, 'ki/sub:gli')
    expect(placedPanels(element)).toEqual(['glimepiride', 'm1', 'ki_m1'])
    expect(figureOf(element).marked).toEqual([])
  })

  it('ignores a decoration and a key whose panels the page does not list', async () => {
    declared = appWithFigure()
    const element = await shell()
    await clickKey(element, 'frame')
    await clickKey(element, 'nowhere')
    expect(placedPanels(element)).toEqual(['glimepiride', 'm1'])
    expect(element.getAttribute('selection')).toBeNull()
  })

  it('renders a page without a figure as it did', async () => {
    const element = await shell()
    expect(placedPanels(element)).toEqual(['panelA'])
    expect(element.shadowRoot.querySelector('sbmlsim-figure')).toBeNull()
  })
})
