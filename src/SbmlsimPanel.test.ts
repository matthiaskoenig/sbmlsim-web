// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type {
  PanelAxis,
  PanelDataDeclaration,
  PanelDataResponse,
  PanelDeclaration,
  SimulateRequest,
  SimulateResponse,
} from './contract'
import { PANEL_TAG, register } from './index'
import type { SbmlsimPanelHTMLElement } from './index'
import { plotSvg, tableMeasure } from './plot'

// the renderer as it is, with `plotSvg` counted: a figure which is laid out
// again is one more call of it, which is how a test sees that a font which
// arrives late lays the figure out once and not once per event of the page
vi.mock('./plot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./plot')>()
  return { ...actual, plotSvg: vi.fn(actual.plotSvg) }
})

// The element runs in a dom, which is `happy-dom` for this file alone: every
// other test file of this library is pure and keeps running in node. Nothing
// here reaches the network, `fetch` and `ResizeObserver` are stubs, and every
// id below is a neutral one: a model, a panel, a knob and a curve are data of
// a payload and never of this library.

/** The element as a page uses it, the type the package gives its tag. */
type PanelElement = SbmlsimPanelHTMLElement

/** One request the element made. */
interface Call {
  /** The url it asked for. */
  url: string
  /** The body of a POST, `null` for a GET. */
  body: SimulateRequest | null
}

/** The range knob of the declaration, the one a grid runs over by default. */
function knob(): PanelAxis {
  return {
    id: 'knobB',
    label: 'knob B',
    target: 'targetB',
    unit: 'dimensionless',
    kind: 'range',
    min: 0.2,
    max: 1,
    steps: 3,
    choices: [],
    default: 1,
  }
}

/** The declaration every test starts from: a choice knob and a range knob. */
function declaration(): PanelDeclaration {
  return {
    contract: 'panel/1',
    panel: {
      id: 'panelA',
      title: 'Panel A',
      subtitle: 'the question the panel answers',
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
        kind: 'choice',
        min: null,
        max: null,
        steps: 5,
        choices: [
          { label: 'low', value: 12.5 },
          { label: 'high', value: 25 },
        ],
        default: 25,
      },
      knob(),
    ],
    curves: [
      { id: 'curveA', label: 'curve A', unit: 'uM', scale: 'linear' },
      { id: 'curveB', label: 'curve B', unit: 'umol', scale: 'linear' },
    ],
    data: [],
    simulation: { variant: null, end: 120, points: 2, x_unit: 'h', preinit: {}, derived: {} },
    limits: { end: 10000, points: 2000, knobs: 8, grid: 64, curves: 16 },
  }
}

/** The study data the panel declares, drawn under `curveA`. */
function declaredData(more: Partial<PanelDataDeclaration> = {}): PanelDataDeclaration {
  return {
    id: 'seriesA',
    label: 'Series A',
    curve: 'curveA',
    dataset: 'figureA',
    x: 'time',
    y: 'value',
    yerr: 'value_sd',
    sel: null,
    at: null,
    conversion: null,
    unit: null,
    ...more,
  }
}

/** A declaration which carries study data under its first curve. */
function withData(more: Partial<PanelDataDeclaration> = {}): PanelDeclaration {
  return { ...declaration(), data: [declaredData(more)] }
}

/** The choices of the choice knob, which a grid over it runs. */
const CHOICES = [12.5, 25]

/** A declaration of the choice knob alone, which a run therefore grids over. */
function gridsOverChoices(more: Partial<PanelDataDeclaration> = {}): PanelDeclaration {
  const declared = withData(more)
  return { ...declared, axes: declared.axes.slice(0, 1) }
}

/** The answer of a run over the choices of that knob, one row per choice. */
function choiceRun(): SimulateResponse {
  const rows = CHOICES.map((value) => [0, value, 2 * value])
  return {
    ...run(),
    dims: [{ id: 'knobA', label: 'knob A', unit: 'mg', values: CHOICES }],
    curves: { curveA: rows, curveB: rows.map((one) => one.map((value) => 10 * value)) },
    status: { ok: true, points: CHOICES.length, failed: [] },
  }
}

/** The study data the endpoint answers, delivered on the scale of its curve. */
function studyData(more: Partial<PanelDataResponse['series'][0]> = {}): PanelDataResponse {
  return {
    contract: 'paneldata/1',
    series: [
      {
        id: 'seriesA',
        label: 'Series A',
        x: [0, 1, 2],
        y: [0.1, 0.9, 1.9],
        yerr: [0.05, 0.1, null],
        x_unit: 'h',
        unit: 'uM',
        count: null,
        ...more,
      },
    ],
  }
}

/** The values of the axis of every grid the stub answers. */
const AXIS_VALUES = [0.2, 0.6, 1]

/** The spec hash of the answer of a run, which the provenance footer shortens. */
const HASH = '31f8db7d3d6d14a46ad2a5d1642c36999a6ce89ea1ff9863bb2a97d553642e6d'

/**
 * Build the answer of a run over one axis.
 *
 * @param axisId the knob the run gridded over
 * @param rows the rows of `curveA`, one per point of the axis; `curveB` is ten
 *   times them, so the two curves are told apart in the figure
 * @param hash the spec hash of the answer
 * @returns the answer
 */
function run(
  axisId = 'knobB',
  rows: number[][] = AXIS_VALUES.map((value) => [0, value, 2 * value]),
  hash = HASH,
): SimulateResponse {
  return {
    contract: 'panel/1',
    spec_hash: hash,
    x: [0, 1, 2],
    dims: [{ id: axisId, label: axisId, unit: null, values: AXIS_VALUES }],
    curves: { curveA: rows, curveB: rows.map((one) => one.map((value) => 10 * value)) },
    units: { x: 'h', curveA: 'uM', curveB: 'umol' },
    provenance: {
      model: 'modelA',
      panel: 'panelA',
      model_sha256: 'c'.repeat(64),
      variant: null,
      engine: 'engineA',
      sbmlsim: '0.0.0',
      seconds: 0.079,
      created: '2026-11-12T22:41:35.090689+00:00',
    },
    status: { ok: true, points: AXIS_VALUES.length, failed: [] },
  }
}

/** The ids of a panel of as many curves as the contract lets one carry. */
const MANY = Array.from({ length: 16 }, (_, index) => `curve${String(index)}`)

/** A declaration of sixteen curves, the most the contract carries. */
function manyCurves(): PanelDeclaration {
  return {
    ...declaration(),
    curves: MANY.map((id) => ({ id, label: `curve ${id}`, unit: 'uM', scale: 'linear' as const })),
  }
}

/** The answer of a run of those sixteen curves, each on a line of its own. */
function manyRuns(): SimulateResponse {
  const answer = run()
  const rows = (factor: number): number[][] =>
    AXIS_VALUES.map((value) => [0, factor * value, 2 * factor * value])
  return {
    ...answer,
    curves: Object.fromEntries(MANY.map((id, index) => [id, rows(index + 1)])),
    units: { x: 'h', ...Object.fromEntries(MANY.map((id) => [id, 'uM'])) },
  }
}

/** The answer of a run whose two curves span the same eight decades. */
function decades(): SimulateResponse {
  const rows = AXIS_VALUES.map(() => [1e-8, 1e-4, 1])
  return { ...run(), curves: { curveA: rows, curveB: rows } }
}

/** What a route answers: a body, a failure, or a request which never answers. */
type Route = () => Promise<unknown>

/** The routes the stub serves and the calls it took. */
const served: {
  panel: (variant: string | null) => Promise<unknown>
  simulate: (body: SimulateRequest) => Promise<unknown>
  data: (variant: string | null) => Promise<unknown>
  stored: Route
} = {
  panel: () => Promise.resolve(declaration()),
  simulate: () => Promise.resolve(run()),
  data: () => Promise.resolve(studyData()),
  stored: () => Promise.resolve(run('knobB', undefined, 'stored00stored00')),
}

/** The calls the element made since the test started. */
let calls: Call[] = []

/** The stub of `console.warn`, which collects what the element says on it. */
let warned = vi.spyOn(console, 'warn')

/** The observers the element created, so a test can report a width to them. */
let observers: { callback: ResizeObserverCallback }[] = []

/** Build the answer of a route which carries a body. */
function json(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response
}

/** A request which never answers until it is stopped, which a timeout is. */
function hangs(init: RequestInit | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const error = new Error('stopped')
      error.name = 'AbortError'
      reject(error)
    })
  })
}

/** A request which never reaches the endpoint, which a dead network is. */
function unreachable(): Promise<never> {
  return Promise.reject(new TypeError('Failed to fetch'))
}

/** The simulations the element asked for, in their order. */
function simulations(): SimulateRequest[] {
  return calls.filter((one) => one.url.endsWith('/simulate')).map((one) => one.body ?? {})
}

/** The declarations the element asked for; the route of a run ends in `/simulate`. */
function declarations(): Call[] {
  return calls.filter((one) => (one.url.split('?')[0] ?? '').endsWith('/panels/panelA'))
}

/** The requests of the study data the element made. */
function dataCalls(): Call[] {
  return calls.filter((one) => (one.url.split('?')[0] ?? '').endsWith('/data'))
}

/** Get the shadow root of an element, which every test reads the panel out of. */
function shadow(element: PanelElement): ShadowRoot {
  const root = element.shadowRoot
  if (root === null) {
    throw new Error('the element has no shadow root')
  }
  return root
}

/** Get the text of one part of the panel, empty where it is not drawn. */
function textOf(element: PanelElement, selector: string): string {
  const found = shadow(element).querySelector(selector)
  return found === null ? '' : found.textContent.trim()
}

/** Get the figure of the panel as it is drawn now, empty while there is none. */
function figure(element: PanelElement): string {
  return shadow(element).querySelector('.plot .figure-svg')?.innerHTML ?? ''
}

/** Get the figure of the variant before a switch the panel holds, empty while it holds none. */
function heldFigure(element: PanelElement): Element | null {
  return shadow(element).querySelector('.held')
}

/** Get a control of a knob by its id. */
function control(element: PanelElement, id: string): HTMLInputElement | HTMLSelectElement {
  const found = shadow(element).querySelector(`#knob-${id}`)
  if (!(found instanceof HTMLInputElement) && !(found instanceof HTMLSelectElement)) {
    throw new Error(`the panel has no control of the knob '${id}'`)
  }
  return found
}

/**
 * Move a control and tell the element about it.
 *
 * @param target the control
 * @param value the value it is moved to
 * @param kind `input` for a knob which is being dragged, `change` for one
 *   which was released
 */
function move(target: HTMLInputElement | HTMLSelectElement, value: string, kind: string): void {
  target.value = value
  target.dispatchEvent(new Event(kind))
}

/** Put an element of the library in the page, with the attributes a host writes. */
async function mount(
  attributes: Record<string, string> = {},
  parent: HTMLElement = document.body,
): Promise<PanelElement> {
  const element = document.createElement(PANEL_TAG)
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value)
  }
  parent.append(element)
  await nextTick()
  return element
}

/** Put an element in the page and start it. */
async function started(
  attributes: Record<string, string> = {},
  parent: HTMLElement = document.body,
): Promise<PanelElement> {
  const element = await mount(
    { endpoint: '/api-root', model: 'modelA', panel: 'panelA', ...attributes },
    parent,
  )
  await element.activate()
  await nextTick()
  return element
}

/**
 * Get the shape of the marker of a series of the study data.
 *
 * @param element the panel
 * @param id the id of the series
 * @returns the tag of its first marker, `circle` for the first shape and
 *   `path` for a polygon of the same area
 */
function shapeOf(element: PanelElement, id: string): string {
  const group = new RegExp(`<g class="points" data-series="${id}">(.*?)</g>`).exec(figure(element))
  return /<(circle|path) class="marker"/.exec(group?.[1] ?? '')?.[1] ?? ''
}

/** Get one part of the panel, which has to be there. */
function part(element: PanelElement, selector: string): Element {
  const found = shadow(element).querySelector(selector)
  if (found === null) {
    throw new Error(`the panel has no '${selector}'`)
  }
  return found
}

/** Put a container in the page which carries tokens of its own. */
function branded(tokens: Record<string, string>): HTMLElement {
  const container = document.createElement('div')
  for (const [name, value] of Object.entries(tokens)) {
    container.style.setProperty(name, value)
  }
  document.body.append(container)
  return container
}

/** The plot box of a figure, read off the axes the renderer drew. */
interface Box {
  /** The pixel of its left edge. */
  x0: number
  /** The pixel of its top edge. */
  y0: number
  /** The pixel of its right edge. */
  x1: number
  /** The pixel of its bottom edge. */
  y1: number
}

/** Give an element the box a browser would measure for it; happy-dom measures none. */
function measures(element: Element, width: number, height: number): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
    }),
  })
}

/**
 * Measure the figure of the panel and read the plot box out of its axes.
 *
 * The axis lines of the renderer are the box: the x axis runs along its bottom
 * from its left edge to its right one, the y axis along its left edge. Reading
 * it off the figure instead of recomputing it is what makes the assertions
 * about the readout assertions about the figure which is drawn.
 */
function laidOut(element: PanelElement): Box {
  const drawn = figure(element)
  const svg = shadow(element).querySelector('svg')
  if (svg === null) {
    throw new Error('the panel has drawn no figure')
  }
  const size = {
    width: Number(svg.getAttribute('width')),
    height: Number(svg.getAttribute('height')),
  }
  measures(part(element, '.plot'), size.width, size.height)
  measures(svg, size.width, size.height)
  const lines = [
    ...drawn.matchAll(
      /<line class="axis-line" x1="([^"]*)" y1="([^"]*)" x2="([^"]*)" y2="([^"]*)"/g,
    ),
  ].map((one) => one.slice(1).map(Number))
  const [x0 = 0, y1 = 0, x1 = 0] = lines[0] ?? []
  const [, y0 = 0] = lines[1] ?? []
  return { x0, y0, x1, y1 }
}

/** Move a pointer over the figure, as a mouse, a pen and a finger all do. */
async function hover(element: PanelElement, at: { x: number; y: number } | null): Promise<void> {
  const event = new Event('pointermove', { bubbles: true })
  if (at !== null) {
    Object.assign(event, { clientX: at.x, clientY: at.y })
  }
  part(element, '.plot').dispatchEvent(event)
  await nextTick()
}

/** Take the pointer off the figure. */
async function leave(element: PanelElement): Promise<void> {
  part(element, '.plot').dispatchEvent(new Event('pointerleave', { bubbles: true }))
  await nextTick()
}

/** Get the rows of the readout as the pairs of a label and a value. */
function readoutRows(element: PanelElement): string[][] {
  return [...shadow(element).querySelectorAll('.readout-row')].map((row) => [
    row.querySelector('.readout-label')?.textContent.trim() ?? '',
    row.querySelector('.readout-value')?.textContent.trim() ?? '',
  ])
}

/** Get a number of the inline style of an element of the overlay. */
function styleOf(
  element: PanelElement,
  selector: string,
  name: 'left' | 'top' | 'width' | 'height',
): number {
  const found = part(element, selector)
  const style = found instanceof HTMLElement ? found.style.getPropertyValue(name) : ''
  return Number.parseFloat(style)
}

/** Get the box of the readout in the pixels of the figure. */
function readoutBox(element: PanelElement): {
  left: number
  top: number
  width: number
  height: number
} {
  return {
    left: styleOf(element, '.readout', 'left'),
    top: styleOf(element, '.readout', 'top'),
    width: styleOf(element, '.readout', 'width'),
    height: styleOf(element, '.readout', 'height'),
  }
}

/** Let every request the element has in flight answer and the dom catch up. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

/** Take the lines the element wrote to the console, which the stub collects. */
function warnings(): string[] {
  return warned.mock.calls.map((one) => String(one[0]))
}

/** Report a width to every observer the element created. */
async function resizeTo(width: number): Promise<void> {
  for (const one of observers) {
    one.callback(
      [{ contentRect: { width } } as unknown as ResizeObserverEntry],
      one as unknown as ResizeObserver,
    )
  }
  await nextTick()
}

beforeEach(() => {
  calls = []
  observers = []
  // a series the figure leaves out is said once on the console, which no test
  // of this file wants printed: the stub collects the lines instead
  warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  served.panel = () => Promise.resolve(declaration())
  served.simulate = () => Promise.resolve(run())
  served.data = () => Promise.resolve(studyData())
  served.stored = () => Promise.resolve(run('knobB', undefined, 'stored00stored00'))
  globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input)
    const sent = typeof init?.body === 'string' ? init.body : ''
    const body = sent === '' ? null : (JSON.parse(sent) as SimulateRequest)
    calls.push({ url, body })
    // a route is read in a variant with the query `variant`
    const [path = '', query = ''] = url.split('?')
    const variant = new URLSearchParams(query).get('variant')
    // a request which is stopped rejects as the fetch of a browser does, whenever
    // the route it asked would answer
    const answer = path.endsWith('/simulate')
      ? served.simulate(body ?? {})
      : path.endsWith('/data')
        ? served.data(variant)
        : path.includes('/panels/')
          ? served.panel(variant)
          : served.stored()
    return Promise.race([answer.then(json), hangs(init)])
  })
  class Observing {
    readonly callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
      observers.push(this)
    }
    observe(): void {
      // the tests report a width through `resizeTo` instead of measuring
    }
    unobserve(): void {
      // nothing is measured, so nothing has to stop
    }
    disconnect(): void {
      observers = observers.filter((one) => one !== this)
    }
  }
  vi.stubGlobal('ResizeObserver', Observing)
})

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the element before it is started', () => {
  it('renders nothing and makes no request before activate()', async () => {
    const element = await mount({ endpoint: '/api-root', model: 'modelA', panel: 'panelA' })
    expect(shadow(element).querySelector('.panel')).toBeNull()
    expect(shadow(element).querySelectorAll('input, select')).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })

  it('starts itself when it is connected with the attribute auto and not without it', async () => {
    await mount({ endpoint: '/api-root', model: 'modelA', panel: 'panelA' })
    await settled()
    expect(declarations()).toHaveLength(0)

    const element = await mount({
      endpoint: '/api-root',
      model: 'modelA',
      panel: 'panelA',
      auto: '',
    })
    await settled()
    expect(declarations()).toHaveLength(1)
    expect(shadow(element).querySelector('.panel')).not.toBeNull()
    // the methods keep working after it: a second call only lifts a freeze
    element.freeze()
    await element.activate()
    expect(declarations()).toHaveLength(1)
  })

  it('is registered once and takes another tag name on request', async () => {
    expect(customElements.get(PANEL_TAG)).toBeDefined()
    expect(register()).toBe(false)
    expect(register('sbmlsim-panel-other')).toBe(true)
    expect(register('sbmlsim-panel-other')).toBe(false)
    const element = document.createElement('sbmlsim-panel-other') as PanelElement
    document.body.append(element)
    await nextTick()
    expect(element.shadowRoot).not.toBeNull()
  })
})

describe('the declaration and the controls', () => {
  it('fetches the declaration and renders one control per knob', async () => {
    const element = await started()
    expect(shadow(element).querySelectorAll('.knob')).toHaveLength(2)
    expect(control(element, 'knobA').tagName.toLowerCase()).toBe('select')
    expect(control(element, 'knobB').getAttribute('type')).toBe('range')
    expect(textOf(element, '.title')).toBe('Panel A')
    expect(textOf(element, '.subtitle')).toBe('the question the panel answers')
    for (const label of shadow(element).querySelectorAll('label.knob-label')) {
      const target = label.getAttribute('for') ?? ''
      expect(shadow(element).querySelector(`#${target}`)).not.toBeNull()
    }
    // the unit of a range knob is part of its label, as sbmlsim labels an
    // axis, so its readout stays a bare number next to a narrow slider; a
    // dimensionless unit is no unit to a reader and is left out
    expect(textOf(element, 'label[for="knob-knobB"]')).toBe('knob B')
    expect(textOf(element, 'label[for="knob-knobA"]')).toBe('knob A')
  })

  it('shows the provenance footer with the engine, the hash and the seconds', async () => {
    const element = await started()
    const footer = textOf(element, '.provenance')
    expect(footer).toContain('engineA')
    // the short hash is labelled as the run it names
    expect(footer).toContain(`run ${HASH.slice(0, 8)}`)
    expect(footer).not.toContain(HASH.slice(0, 9))
    expect(footer).toContain('0.079 s')
  })

  it('draws the title at the level of heading the page asks for', async () => {
    expect(shadow(await started()).querySelector('h2.title')).not.toBeNull()
    expect(shadow(await started({ 'heading-level': '3' })).querySelector('h3.title')).not.toBeNull()
  })

  it('leaves the value of a knob to its slider to announce', async () => {
    // an `output` is a live region of its own, which would announce every
    // step of a drag next to what the slider announces itself
    const element = await started()
    expect(part(element, '.knob-value').getAttribute('aria-live')).toBe('off')
  })

  it('keeps the keys a knob uses from the page and lets every other key through', async () => {
    // a deck which turns its slide on an arrow key reads the element and not
    // the knob as the target of the key, so the knob has to keep its keys
    const element = await started()
    const knob = part(element, 'input[type=range]')
    const seen: string[] = []
    document.addEventListener('keydown', (event) => seen.push(event.key))
    for (const key of ['ArrowLeft', 'Home', 'n']) {
      knob.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true }))
    }
    expect(seen).toEqual(['n'])
  })

  it('puts the value a knob starts at on the ladder of its step', async () => {
    // a browser snaps a control to the nearest value of the ladder its step
    // builds, so a default which is not on it is a figure of one value next
    // to a control and a screen reader of another
    for (const bounds of [
      { min: 0.2, max: 2, default: 1 },
      { min: 0, max: 1, default: 1 / 3 },
    ]) {
      served.panel = () => {
        const declared = declaration()
        return Promise.resolve({
          ...declared,
          axes: [{ ...knob(), ...bounds }],
        })
      }
      const slider = control(await started(), 'knobB')
      const step = Number(slider.getAttribute('step'))
      const steps = (bounds.default - bounds.min) / step
      expect(step).toBeGreaterThan(0)
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6)
    }
  })

  it('resets the knobs to the declared defaults', async () => {
    const element = await started()
    move(control(element, 'knobB'), '0.4', 'input')
    await nextTick()
    expect(textOf(element, '.knob-value')).toBe('0.4')
    element.reset()
    await nextTick()
    expect(control(element, 'knobB').value).toBe('1')
    expect(textOf(element, '.knob-value')).toBe('1')
  })
})

describe('one request per release, never one per movement', () => {
  it('fetches the grid once and interpolates on knob movement', async () => {
    const element = await started()
    expect(simulations()).toEqual([{ values: { knobA: 25 }, grid: { knobB: 3 } }])
    const before = figure(element)
    for (const value of ['0.4', '0.6', '0.8', '0.6', '0.4']) {
      move(control(element, 'knobB'), value, 'input')
      await nextTick()
    }
    expect(simulations()).toHaveLength(1)
    expect(figure(element)).not.toBe(before)
    expect(figure(element)).not.toContain('NaN')
  })

  it('simulates on release and not on every input event', async () => {
    vi.useFakeTimers()
    const element = await started()
    move(control(element, 'knobB'), '0.4', 'input')
    move(control(element, 'knobB'), '0.4', 'change')
    await vi.advanceTimersByTimeAsync(500)
    expect(simulations()).toHaveLength(1)

    move(control(element, 'knobA'), '12.5', 'change')
    expect(simulations()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    expect(simulations()).toEqual([
      { values: { knobA: 25 }, grid: { knobB: 3 } },
      { values: { knobB: 0.4 }, grid: { knobA: 2 } },
    ])
  })

  it('cancels a scheduled simulation which was superseded instead of racing it', async () => {
    vi.useFakeTimers()
    const element = await started()
    move(control(element, 'knobA'), '12.5', 'change')
    move(control(element, 'knobA'), '25', 'change')
    await vi.advanceTimersByTimeAsync(500)
    expect(simulations()).toHaveLength(2)
  })

  it('drops the answer of a request which is no longer the latest one', async () => {
    vi.useFakeTimers()
    let release = (): void => {
      // replaced by the run over the choice knob, which answers last on purpose
    }
    let runs = 0
    served.simulate = (body) => {
      runs += 1
      if (body.grid?.knobA !== undefined) {
        // the run over the choice knob ignores the stop which supersedes it,
        // so its answer arrives after the answer of the run which did
        return new Promise((resolve) => {
          release = () => {
            resolve(run('knobA', undefined, 'stale000stale000'))
          }
        })
      }
      return Promise.resolve(run('knobB', undefined, runs === 1 ? HASH : 'fresh000fresh000'))
    }
    const element = await started()
    move(control(element, 'knobA'), '12.5', 'change')
    await vi.advanceTimersByTimeAsync(500)
    move(control(element, 'knobB'), '0.4', 'change')
    await vi.advanceTimersByTimeAsync(500)
    release()
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    expect(textOf(element, '.provenance')).toContain('fresh000')
    expect(textOf(element, '.provenance')).not.toContain('stale000')
  })

  it('simulates a knob which is released while a run is in flight', async () => {
    vi.useFakeTimers()
    let release = (): void => {
      // replaced by the run over the choice knob, which is held in flight
    }
    served.simulate = (body) => {
      if (body.grid?.knobA === undefined) {
        return Promise.resolve(run())
      }
      return new Promise((resolve) => {
        release = () => {
          resolve(run('knobA'))
        }
      })
    }
    const element = await started()
    move(control(element, 'knobA'), '12.5', 'change')
    await vi.advanceTimersByTimeAsync(500)
    // the grid of the run in flight covers the choice knob and not the range
    // knob, so releasing the range knob now has to run again over it; the knob
    // the last answer gridded over is not the one to compare against
    move(control(element, 'knobB'), '0.4', 'change')
    await vi.advanceTimersByTimeAsync(500)
    release()
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    expect(simulations()).toEqual([
      { values: { knobA: 25 }, grid: { knobB: 3 } },
      { values: { knobB: 1 }, grid: { knobA: 2 } },
      { values: { knobA: 12.5 }, grid: { knobB: 3 } },
    ])
    expect(control(element, 'knobB').value).toBe('0.4')
  })
})

describe('the layout and the theme', () => {
  it('lays the controls beside the plot above 560px and under it below', async () => {
    const element = await started()
    await resizeTo(800)
    expect(shadow(element).querySelector('.panel')?.className).toContain('layout-sidebar')
    await resizeTo(400)
    expect(shadow(element).querySelector('.panel')?.className).toContain('layout-stacked')
  })

  it('uses the toolbar layout when the attribute asks for it', async () => {
    const element = await started({ layout: 'toolbar' })
    await resizeTo(900)
    expect(shadow(element).querySelector('.panel')?.className).toContain('layout-toolbar')
  })

  it('follows the scheme of the page and lets a host override one token', async () => {
    const element = await started({ theme: 'dark' })
    // the quotes of an attribute selector are optional and a minifier drops
    // them, so the assertions below read the selectors without them
    const styles = [...shadow(element).querySelectorAll('style')]
      .map((one) => one.textContent)
      .join('\n')
      .replace(/'/g, '')
    expect(styles).toContain(':host')
    // the colours resolve against the scheme the host inherits from the page,
    // and never against the system of the reader, which a page may not follow
    expect(styles).toContain('light-dark(rgb(27 31 36), rgb(230 233 238))')
    expect(styles).not.toContain('prefers-color-scheme')
    expect(styles).not.toMatch(/:host\s*{[^}]*color-scheme/)
    expect(styles).toMatch(/:host\(\[theme=dark\]\)\s*{[^}]*color-scheme:\s*dark/)
    expect(styles).toMatch(/:host\(\[theme=light\]\)\s*{[^}]*color-scheme:\s*light/)
    // the panel paints the surface of its scheme
    expect(styles).toMatch(/\.panel\s*{[^}]*background:\s*var\(--_bg\)/)
    expect(element.getAttribute('theme')).toBe('dark')
    element.style.setProperty('--sbmlsim-ramp-1', 'rgb(1 2 3)')
    expect(getComputedStyle(element).getPropertyValue('--sbmlsim-ramp-1')).toBe('rgb(1 2 3)')
    expect(figure(element)).toContain('var(--sbmlsim-ramp-1')
  })

  it('takes a token from a container of the page and not only from the element', async () => {
    const container = branded({ '--sbmlsim-fg': 'rgb(1 2 3)' })
    // a panel which declared the public tokens on its host would mask the
    // container, because a declaration beats what an element inherits
    const inside = await started({}, container)
    expect(getComputedStyle(part(inside, '.panel')).color).toBe('rgb(1 2 3)')
    // the browser resolves the pair of the table against the scheme of the
    // page, which happy-dom does not, so the token is read before it is resolved
    const outside = await started()
    expect(getComputedStyle(outside).getPropertyValue('--_fg')).toContain(
      'light-dark(rgb(27 31 36), rgb(230 233 238))',
    )
  })

  it('keeps a rule of the page which matches the element out of the panel', async () => {
    // a declaration of the page beats one of the shadow tree on the host, so
    // a panel which carried its typography there would hand the page every
    // element in it by inheritance
    document.head.innerHTML = '<style>* { font-family: cursive; color: rgb(255 0 0); }</style>'
    // a named theme, whose colours happy-dom resolves without a scheme
    const element = await started({ theme: 'light' })
    expect(getComputedStyle(part(element, '.panel')).color).not.toBe('rgb(255 0 0)')
    expect(getComputedStyle(part(element, '.knob-label')).fontFamily).not.toContain('cursive')
  })

  it('draws without a ResizeObserver and never throws where there is none', async () => {
    vi.unstubAllGlobals()
    const had = Reflect.deleteProperty(globalThis, 'ResizeObserver')
    expect(had).toBe(true)
    const element = await started()
    expect(figure(element)).toContain('<svg')
    expect(shadow(element).querySelector('.panel')?.className).toContain('layout-')
  })
})

describe('the figure', () => {
  it('toggles the y axis to log over six decades', async () => {
    served.simulate = () => Promise.resolve(decades())
    const element = await started()
    expect(figure(element)).not.toContain('>1e-6<')
    const toggle = shadow(element).querySelector('.toggle input')
    if (!(toggle instanceof HTMLInputElement)) {
      throw new Error('the panel has no toggle of the scale of its y axis')
    }
    toggle.checked = true
    toggle.dispatchEvent(new Event('change'))
    await nextTick()
    expect(figure(element)).toContain('>1e-6<')
    expect(figure(element)).not.toContain('1e-8')
  })

  it('opens on the scale its curves declare and leaves the toggle to the reader', async () => {
    // a quantity of four decades is declared on a logarithmic axis, and the
    // panel opens on it; the toggle is the reader's from then on, and the reset
    // puts the declared scale back
    served.panel = () =>
      Promise.resolve({
        ...declaration(),
        curves: declaration().curves.map((one) => ({ ...one, scale: 'log' as const })),
      })
    served.simulate = () => Promise.resolve(decades())
    const element = await started()
    const toggle = shadow(element).querySelector('.toggle input')
    if (!(toggle instanceof HTMLInputElement)) {
      throw new Error('the panel has no toggle of the scale of its y axis')
    }
    expect(toggle.checked).toBe(true)
    expect(figure(element)).toContain('>1e-6<')
    toggle.checked = false
    toggle.dispatchEvent(new Event('change'))
    await nextTick()
    expect(figure(element)).not.toContain('>1e-6<')
    element.reset()
    await nextTick()
    expect(figure(element)).toContain('>1e-6<')
    // and a panel of linear curves opens linear
    served.panel = () => Promise.resolve(declaration())
    expect(figure(await started())).not.toContain('>1e-6<')
  })

  it('keeps the title and the role of the figure and names its axes', async () => {
    const element = await started()
    expect(figure(element)).toContain('role="img"')
    // the title is the name of the figure for a reader who does not see it,
    // so it never starts with the unit of a y axis which has no label
    // the two curves of the declaration carry different units, so the axis
    // keeps the generic label alone and the units go into the legend
    expect(figure(element)).toContain('<title>value over time [h]</title>')
  })

  it('lends the y axis the label of a single curve', async () => {
    served.panel = () => {
      const declared = declaration()
      return Promise.resolve({ ...declared, curves: declared.curves.slice(0, 1) })
    }
    const element = await started()
    expect(figure(element)).toContain('<title>curve A [uM] over time [h]</title>')
  })

  it('names the y axis as the panel declares it, and after its curves without', async () => {
    const declared = declaration()
    served.panel = () =>
      Promise.resolve({
        ...declared,
        panel: { ...declared.panel, y_label: 'plasma concentration' },
      })
    const element = await started()
    expect(figure(element)).toContain('>plasma concentration</text>')
    expect(figure(element)).toContain('<title>plasma concentration over time [h]</title>')
    // a panel which declares none keeps the label its curves give the axis
    served.panel = () => Promise.resolve(declared)
    expect(figure(await started())).toContain('<title>value over time [h]</title>')
  })
})

describe('the frame of the value axis', () => {
  /**
   * Get the y axis of the figure: its line, its ticks and its label.
   *
   * The figure writes the x axis, the y axis and then the curves, so the y axis
   * is what stands between the second axis and the data.
   */
  function valueAxis(element: PanelElement): string {
    const after = figure(element).split('<g class="axis ')[2] ?? ''
    return after.split('<g class="data"')[0] ?? ''
  }

  /** Get the path of the first curve of the figure. */
  function curve(element: PanelElement): string {
    return /<path class="curve"[^>]*\sd="([^"]*)"/.exec(figure(element))?.[1] ?? ''
  }

  it('holds still while the knob the answer grids over moves', async () => {
    // the defect this frame answers: the limits of a line which is scaled by a
    // knob are scaled with it, so the figure redraws the same picture with
    // other numbers on its axis and the knob appears to do nothing
    const element = await started()
    const axis = valueAxis(element)
    const line = curve(element)
    move(control(element, 'knobB'), '0.2', 'input')
    await nextTick()
    expect(curve(element)).not.toBe(line)
    expect(valueAxis(element)).toBe(axis)
    // and the line of the whole answer is inside the frame it is drawn in
    expect(figure(element)).not.toContain('NaN')
  })

  it('is held open by a series the knobs are not at, and does not move when they are', async () => {
    // the study data of a panel is conditioned: a series is drawn only at the
    // state it was measured under, so the frame is taken over every series the
    // panel can draw and a series which appears never moves the axis
    served.panel = () => Promise.resolve(gridsOverChoices({ at: { knobA: 12.5 } }))
    served.simulate = () => Promise.resolve(choiceRun())
    served.data = () => Promise.resolve(studyData({ y: [0, 400, 900] }))
    const element = await started()
    expect(figure(element)).not.toContain('class="points"')
    const axis = valueAxis(element)
    // the axis already reaches the series, which is above every curve
    expect(axis).toContain('>800<')
    // the knob of the choices is the one the answer grids over, so its release
    // moves the figure out of the grid and asks for no simulation
    move(control(element, 'knobA'), '12.5', 'change')
    await nextTick()
    expect(simulations()).toHaveLength(1)
    expect(figure(element)).toContain('class="points" data-series="seriesA"')
    expect(valueAxis(element)).toBe(axis)
  })

  it('is held open by a series the knobs it does not grid over are at, and by no other', async () => {
    // the run grids over the range knob and the series was measured at the
    // other choice of the choice knob: it is data of another quantity, e.g. of
    // another dose, and the frame of this one does not reach for it. Moving
    // that knob is a new answer, which grids over it, and its frame holds the
    // series of every choice of it, wherever the knob then moves inside it
    vi.useFakeTimers()
    served.panel = () => Promise.resolve(withData({ at: { knobA: 12.5 } }))
    served.simulate = (body) =>
      Promise.resolve(body.grid?.knobA === undefined ? run() : choiceRun())
    served.data = () => Promise.resolve(studyData({ y: [0, 400, 900] }))
    const element = await started()
    expect(figure(element)).not.toContain('class="points"')
    const axis = valueAxis(element)
    // the curves reach 20 and the axis stops there
    expect(axis).toContain('>20<')
    expect(axis).not.toContain('>800<')
    move(control(element, 'knobA'), '12.5', 'change')
    await vi.advanceTimersByTimeAsync(500)
    expect(simulations().at(-1)?.grid).toHaveProperty('knobA')
    expect(figure(element)).toContain('class="points" data-series="seriesA"')
    const held = valueAxis(element)
    expect(held).toContain('>800<')
    // the choice knob is the gridded one now: its move is read out of the
    // answer, hides the series and leaves the frame where it is
    move(control(element, 'knobA'), '25', 'change')
    await vi.advanceTimersByTimeAsync(500)
    expect(simulations()).toHaveLength(2)
    expect(figure(element)).not.toContain('class="points"')
    expect(valueAxis(element)).toBe(held)
  })

  it('reads a state without the knob the run grids over, on both sides of the rule', async () => {
    // the part of a state which names the gridded knob decides where a series
    // is drawn and nothing of the frame: a series of the other knob's choice
    // the reader is at holds the axis open wherever the gridded knob is, and a
    // series of a choice the reader is not at holds nothing open even where
    // the gridded knob is at its value
    vi.useFakeTimers()
    served.data = () => Promise.resolve(studyData({ y: [0, 400, 900] }))
    served.panel = () => Promise.resolve(withData({ at: { knobA: 25, knobB: 0.2 } }))
    const counted = await started()
    expect(figure(counted)).not.toContain('class="points"')
    const axis = valueAxis(counted)
    expect(axis).toContain('>800<')
    move(control(counted, 'knobB'), '0.2', 'input')
    await nextTick()
    expect(figure(counted)).toContain('class="points" data-series="seriesA"')
    expect(valueAxis(counted)).toBe(axis)
    served.panel = () => Promise.resolve(withData({ at: { knobA: 12.5, knobB: 1 } }))
    const hidden = await started()
    expect(valueAxis(hidden)).not.toContain('>800<')
  })

  /** Get the plot box of the figure, which is where its two axis lines run. */
  function plotBox(element: PanelElement): string[] {
    return [...figure(element).matchAll(/<line class="axis-line"[^>]*>/g)].map((one) => one[0])
  }

  it('leaves the zero a curve starts at out of a logarithmic frame', async () => {
    // every curve of a dose starts at zero and every panel has the toggle of
    // the scale, so this is the figure of a panel and not an edge of one: a
    // zero is no value of a logarithmic axis, and a frame which holds it holds
    // nothing, which puts the curve below the box the figure draws
    served.simulate = () =>
      Promise.resolve(
        run('knobB', [
          [0, 1e-3, 1e-2],
          [0, 1e-2, 1e-1],
          [0, 0.1, 1],
        ]),
      )
    const element = await started()
    const toggle = shadow(element).querySelector('.toggle input')
    if (!(toggle instanceof HTMLInputElement)) {
      throw new Error('the panel has no toggle of the scale of its y axis')
    }
    toggle.checked = true
    toggle.dispatchEvent(new Event('change'))
    await nextTick()
    // the frame is the positive values of the answer, 0.001 to 10 of the second
    // curve, and the curve which is drawn is inside it
    const axis = valueAxis(element)
    expect(axis).toContain('>0.001<')
    expect(figure(element)).not.toContain('NaN')
    expect(curve(element)).not.toBe('')
  })

  it('holds the frame open for the error of a series, not only for its value', async () => {
    served.panel = () => Promise.resolve(withData())
    served.data = () => Promise.resolve(studyData({ y: [1, 2, 3], yerr: [0, 0, 50] }))
    const element = await started()
    // the bar of the last point runs from -47 to 53, past every curve of the
    // answer at both ends, and the axis holds both of them
    const axis = valueAxis(element)
    expect(axis).toContain('>40<')
    expect(axis).toContain('>-40<')
  })

  it('keeps the plot box where it is when a series the knobs reach appears', async () => {
    // the geometry of a figure is a function of what the panel declares and not
    // of what is drawn right now: a legend which has to hold a long label holds
    // it before the series of that label arrives
    const label = 'Beermann 1976, 5 mg oral, healthy volunteers (n = 4)'
    served.panel = () => Promise.resolve(gridsOverChoices({ at: { knobA: 12.5 }, label }))
    served.simulate = () => Promise.resolve(choiceRun())
    served.data = () => Promise.resolve(studyData({ label }))
    const element = await started()
    expect(figure(element)).not.toContain('class="points"')
    const box = plotBox(element)
    move(control(element, 'knobA'), '12.5', 'change')
    await nextTick()
    expect(figure(element)).toContain('class="points" data-series="seriesA"')
    expect(plotBox(element)).toEqual(box)
  })

  /**
   * A declaration of one curve with study data under it, its value axis fixed
   * at both ends or not, and study data which the test releases.
   */
  function heldData(fixed: boolean): { declared: PanelDeclaration; release: () => void } {
    const base = withData()
    const declared: PanelDeclaration = {
      ...base,
      panel: { ...base.panel, ...(fixed ? { y_min: 0, y_max: 50 } : {}) },
      curves: base.curves.slice(0, 1),
    }
    let release: () => void = () => undefined
    served.panel = () => Promise.resolve(declared)
    served.data = () =>
      new Promise((resolve) => {
        release = () => {
          resolve(studyData({ y: [1, 2, 300] }))
        }
      })
    return {
      declared,
      release: () => {
        release()
      },
    }
  }

  it('lays itself out in px and never in rem, which the root font of a host changes', async () => {
    const element = await started()
    const style = [...shadow(element).querySelectorAll('style')]
      .map((one) => one.textContent)
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(style).toContain('grid')
    expect(style).not.toMatch(/\d\s*rem\b/)
  })

  it('reserves the legend of its declared study data from its first figure, before the data arrives', async () => {
    // the legend a panel may draw is the one it declares: a panel of one curve
    // with study data keeps the entry of its curve and the room of its series
    // whether the run or the data answers first, so its box does not move
    const held = heldData(true)
    const element = await mount({ endpoint: '/api-root', model: 'modelA', panel: 'panelA' })
    void element.activate()
    await settled()
    await settled()
    expect(figure(element)).toContain('data-series="curveA"')
    expect(figure(element)).toContain('class="legend')
    expect(figure(element)).not.toContain('class="points"')
    const box = plotBox(element)
    held.release()
    await settled()
    await settled()
    expect(figure(element)).toContain('class="points" data-series="seriesA"')
    expect(plotBox(element)).toEqual(box)
  })

  it('draws its first figure once the study data which holds its value axis has arrived', async () => {
    // the value axis of a panel which fixes no ends holds its study data, so
    // its first figure waits for the data and is laid out once over both
    const held = heldData(false)
    const element = await mount({ endpoint: '/api-root', model: 'modelA', panel: 'panelA' })
    void element.activate()
    await settled()
    await settled()
    expect(simulations()).toHaveLength(1)
    expect(figure(element)).toBe('')
    held.release()
    await settled()
    await settled()
    expect(figure(element)).toContain('class="points" data-series="seriesA"')
    expect(
      (figure(element).split('<g class="axis y"')[1] ?? '').split('<g class="data"')[0],
    ).toContain('>300<')
  })

  it('clips a series to the x of an answer which has one, and to nothing without', async () => {
    // the renderer clips a series to the x the curves cover and clips nothing
    // where they cover none (`curveRange`), and the frame is taken over what
    // the figure draws, so the two agree on an answer which carries no x
    served.panel = () => Promise.resolve(withData())
    served.simulate = () => Promise.resolve({ ...run(), x: [] })
    served.data = () => Promise.resolve(studyData({ x: [0, 1, 2], y: [1, 2, 300] }))
    const element = await started()
    expect(valueAxis(element)).toContain('>300<')
  })

  it('keeps the plot box of a panel of two conditions, whichever of them is drawn', async () => {
    // two series under one curve, one per choice of the knob the run grids
    // over, their labels of different lengths: the legend is laid out over the
    // labels the panel declares in their order, so the rows it needs, and with
    // them the plot box, are the same at both choices
    const long = 'renal impairment, creatinine clearance 10 ml per minute'
    const declared = gridsOverChoices()
    served.panel = () =>
      Promise.resolve({
        ...declared,
        data: [
          declaredData({ id: 'seriesA', label: long, at: { knobA: 12.5 } }),
          declaredData({ id: 'seriesB', label: 'healthy', at: { knobA: 25 } }),
        ],
      })
    served.simulate = () => Promise.resolve(choiceRun())
    served.data = () =>
      Promise.resolve({
        contract: 'paneldata/1' as const,
        series: [
          { ...studyData().series[0], id: 'seriesA', label: long },
          { ...studyData().series[0], id: 'seriesB', label: 'healthy' },
        ],
      })
    const element = await started()
    // the knob starts at 25, where the short series is the one which is drawn
    expect(figure(element)).toContain('data-series="seriesB"')
    const box = plotBox(element)
    move(control(element, 'knobA'), '12.5', 'change')
    await nextTick()
    expect(figure(element)).toContain('data-series="seriesA"')
    expect(plotBox(element)).toEqual(box)
  })

  it('keeps the decades of a logarithmic axis over the whole answer', async () => {
    served.simulate = () =>
      Promise.resolve(
        run('knobB', [
          [1e-6, 1e-5, 1e-4],
          [1e-3, 1e-2, 1e-1],
          [1, 10, 100],
        ]),
      )
    const element = await started()
    const toggle = shadow(element).querySelector('.toggle input')
    if (!(toggle instanceof HTMLInputElement)) {
      throw new Error('the panel has no toggle of the scale of its y axis')
    }
    toggle.checked = true
    toggle.dispatchEvent(new Event('change'))
    await nextTick()
    // six decades below the largest value of the answer, which is 1000 of the
    // second curve, and not six below the line which is drawn
    const axis = valueAxis(element)
    expect(axis).toContain('>0.001<')
    expect(axis).not.toContain('1e-6')
    move(control(element, 'knobB'), '0.2', 'input')
    await nextTick()
    expect(valueAxis(element)).toBe(axis)
  })
})

describe('a payload which cannot be read', () => {
  it('shows the error line and never a blank element for a knob it cannot read', async () => {
    served.panel = () => Promise.resolve({ ...declaration(), axes: [null] })
    const element = await started({ fallback: './stored.json' })
    expect(shadow(element).querySelector('.panel')).not.toBeNull()
    expect(textOf(element, '.error')).not.toBe('')
    expect(figure(element)).toContain('<svg')
    expect(textOf(element, '.provenance')).toContain('stored')
  })

  it('draws the rows it can read of an answer which carries a row that is none', async () => {
    // the payload types a row as a list of numbers and nulls and a failed point
    // as a row of nulls, so a row which is `null` is off contract. A stored
    // answer is written by hand, which is where such a row comes from, and a
    // figure which draws what it can is worth more there than one which blanks
    served.simulate = () => {
      const answer = run()
      const rows = answer.curves.curveA ?? []
      return Promise.resolve({
        ...answer,
        curves: { ...answer.curves, curveA: [null, ...rows.slice(1)] },
      })
    }
    const element = await started()
    expect(figure(element)).toContain('<path class="curve"')
    expect(figure(element)).not.toContain('NaN')
    expect(textOf(element, '.error')).toBe('')
    // the knob of the row which is none is read like any other: the line of
    // that point is the one the renderer breaks, and the figure stays a figure
    move(control(element, 'knobB'), '0.2', 'input')
    await nextTick()
    expect(figure(element)).toContain('<path class="curve"')
    expect(textOf(element, '.error')).toBe('')
  })

  it('leaves out a knob it cannot draw and keeps the rest of the panel', async () => {
    served.panel = () => {
      const declared = declaration()
      // the guard of the client takes an object with an id for a knob, so
      // this one reaches the element and is no control it can build
      return Promise.resolve({ ...declared, axes: [...declared.axes, { id: 'knobC' }] })
    }
    const element = await started()
    expect(shadow(element).querySelectorAll('.knob')).toHaveLength(2)
    expect(textOf(element, '.error')).toBe('')
    expect(figure(element)).toContain('<svg')
  })
})

describe('a failure never reaches the page', () => {
  it('shows the stored result and an error when the endpoint is unreachable', async () => {
    served.panel = unreachable
    served.simulate = unreachable
    const seen: { kind: string; message: string }[] = []
    const element = await mount({
      endpoint: 'https://endpoint.example.org',
      model: 'modelA',
      panel: 'panelA',
      fallback: './stored.json',
    })
    element.addEventListener('sbmlsim-error', (event) => {
      seen.push((event as CustomEvent<{ kind: string; message: string }>).detail)
    })
    await element.activate()
    await nextTick()
    expect(figure(element)).toContain('<svg')
    expect(textOf(element, '.provenance')).toContain('stored')
    expect(textOf(element, '.error')).not.toBe('')
    expect(textOf(element, '.error')).not.toContain('endpoint.example.org')
    // the stored answer is of the declared state, which is no state the panel
    // could have been moved away from, so nothing says it cannot be drawn
    expect(textOf(element, '.error')).toBe('The simulation endpoint could not be reached.')
    expect(seen.map((one) => one.kind)).toEqual(['network'])
  })

  it('keeps its controls when a simulation fails, and runs again on the next release', async () => {
    // a failure is no freeze: the panel says what failed and the next move of
    // a knob is the retry, the knob its grid covered among them, since the run
    // which failed covered nothing
    vi.useFakeTimers()
    served.simulate = unreachable
    const element = await started()
    expect(textOf(element, '.error')).not.toBe('')
    expect(control(element, 'knobA').disabled).toBe(false)
    expect(control(element, 'knobB').disabled).toBe(false)
    expect(shadow(element).querySelector('.panel')?.className).not.toContain('frozen')
    served.simulate = () => Promise.resolve(run())
    move(control(element, 'knobB'), '0.6', 'change')
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    expect(simulations()).toHaveLength(3)
    expect(simulations().at(-1)).toEqual({ values: { knobA: 25 }, grid: { knobB: 3 } })
    expect(textOf(element, '.error')).toBe('')
    expect(figure(element)).toContain('class="curve"')
  })

  it('shows the stored result when the request exceeds the timeout', async () => {
    vi.useFakeTimers()
    globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, body: null })
      return url.includes('/panels/') ? hangs(init) : served.stored().then(json)
    })
    const element = await mount({
      endpoint: '/api-root',
      model: 'modelA',
      panel: 'panelA',
      fallback: './stored.json',
      timeout: '30',
    })
    const done = element.activate()
    await vi.advanceTimersByTimeAsync(500)
    await done
    await nextTick()
    expect(figure(element)).toContain('<svg')
    expect(textOf(element, '.provenance')).toContain('stored')
    expect(textOf(element, '.error')).toContain('in time')
  })

  it('does not throw into the host page on a failed request', async () => {
    vi.useFakeTimers()
    served.simulate = unreachable
    const element = await started()
    move(control(element, 'knobA'), '12.5', 'change')
    await vi.advanceTimersByTimeAsync(500)
    await expect(element.activate()).resolves.toBeUndefined()
    expect(textOf(element, '.error')).not.toBe('')
  })

  it('shows the error in the place of the loading text when nothing can be drawn', async () => {
    // a panel which failed without a stored answer has nothing to draw and is
    // not loading either, so the line of the failure is the only line
    served.panel = unreachable
    served.simulate = unreachable
    const element = await started()
    expect(textOf(element, '.error')).not.toBe('')
    expect(shadow(element).querySelector('.pending')).toBeNull()
    expect(figure(element)).toBe('')
  })

  it('retries a request which failed on the network once and no more', async () => {
    served.panel = unreachable
    await started()
    expect(declarations()).toHaveLength(2)
  })
})

describe('freeze and activate', () => {
  it('stops the work which is pending and freezes the knobs', async () => {
    vi.useFakeTimers()
    const element = await started()
    move(control(element, 'knobA'), '12.5', 'change')
    element.freeze()
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    expect(simulations()).toHaveLength(1)
    expect(control(element, 'knobA').disabled).toBe(true)
  })

  it('lifts a freeze and fetches nothing again when it is started twice', async () => {
    const element = await started()
    element.freeze()
    await element.activate()
    await nextTick()
    expect(control(element, 'knobA').disabled).toBe(false)
    expect(declarations()).toHaveLength(1)
  })

  /** A route which answers once it is let go, and the function which lets it go. */
  function held<T>(answer: () => T): { route: () => Promise<T>; release: () => void } {
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    return { route: () => gate.then(answer), release }
  }

  it('reads the declaration a freeze stopped again when it is activated', async () => {
    // a deck which passes over the slide of a panel freezes it while its
    // declaration is read: the stopped read is no failure, and the panel reads
    // it again and draws its figure when the slide is shown again
    const first = held(() => declaration())
    served.panel = first.route
    const element = await mount({ endpoint: '/api-root', model: 'modelA', panel: 'panelA' })
    const activated = element.activate()
    await settled()
    expect(declarations()).toHaveLength(1)
    element.freeze()
    await activated
    await settled()
    expect(textOf(element, '.pending')).toBe('Loading the panel')
    expect(textOf(element, '.error')).toBe('')
    served.panel = () => Promise.resolve(declaration())
    await element.activate()
    await settled()
    first.release()
    await settled()
    expect(declarations()).toHaveLength(2)
    expect(simulations()).toHaveLength(1)
    expect(figure(element)).toContain('<svg')
    expect(control(element, 'knobA').disabled).toBe(false)
  })

  it('runs the first simulation of a panel frozen before its read began', async () => {
    // a deck which turns two slides at once activates the panel and freezes it
    // in the same task, before the panel sent a request
    const element = await mount({ endpoint: '/api-root', model: 'modelA', panel: 'panelA' })
    const activated = element.activate()
    element.freeze()
    await activated
    await settled()
    expect(simulations()).toHaveLength(0)
    expect(figure(element)).toBe('')
    await element.activate()
    await settled()
    expect(declarations()).toHaveLength(1)
    expect(simulations()).toHaveLength(1)
    expect(figure(element)).toContain('<svg')
  })

  it('runs the first simulation a freeze stopped when it is activated', async () => {
    const first = held(() => run())
    served.simulate = first.route
    const element = await mount({ endpoint: '/api-root', model: 'modelA', panel: 'panelA' })
    const activated = element.activate()
    await settled()
    expect(simulations()).toHaveLength(1)
    element.freeze()
    await activated
    await settled()
    expect(figure(element)).toBe('')
    served.simulate = () => Promise.resolve(run())
    await element.activate()
    await settled()
    first.release()
    await settled()
    expect(declarations()).toHaveLength(1)
    expect(simulations()).toHaveLength(2)
    expect(simulations()[1]).toEqual(simulations()[0])
    expect(figure(element)).toContain('<svg')
    expect(textOf(element, '.error')).toBe('')
  })

  it('draws the first figure a freeze stopped while it waited for its study data', async () => {
    // the first figure of a panel whose value axis holds its study data waits
    // for the data: a freeze then drops the run which answered, and the
    // panel runs it again and draws it over the data once it is activated
    served.panel = () => Promise.resolve(withData())
    const data = held(() => studyData())
    served.data = data.route
    const element = await mount({ endpoint: '/api-root', model: 'modelA', panel: 'panelA' })
    const activated = element.activate()
    await settled()
    expect(dataCalls()).toHaveLength(1)
    expect(simulations()).toHaveLength(1)
    element.freeze()
    data.release()
    await activated
    await settled()
    expect(figure(element)).toBe('')
    await element.activate()
    await settled()
    expect(dataCalls()).toHaveLength(1)
    expect(simulations()).toHaveLength(2)
    expect(figure(element)).toContain('class="points" data-series="seriesA"')
  })

  it('runs the release a freeze dropped and the values a host set while it was frozen', async () => {
    vi.useFakeTimers()
    const element = await started()
    move(control(element, 'knobA'), '12.5', 'change')
    element.freeze()
    await vi.advanceTimersByTimeAsync(500)
    expect(simulations()).toHaveLength(1)
    await element.activate()
    await vi.advanceTimersByTimeAsync(0)
    expect(simulations()).toHaveLength(2)
    expect(Object.keys(simulations()[1]?.grid ?? {})).toEqual(['knobA'])
    // a host which moves a knob of a frozen panel which the drawn grid does not
    // cover moves the knob, and the run of it waits for the panel to be activated
    element.freeze()
    element.setAttribute('values', '{"knobB": 0.6}')
    await vi.advanceTimersByTimeAsync(500)
    expect(simulations()).toHaveLength(2)
    await element.activate()
    await vi.advanceTimersByTimeAsync(0)
    expect(simulations()).toHaveLength(3)
    expect(simulations()[2]).toEqual({ values: { knobA: 12.5 }, grid: { knobB: 3 } })
  })
})

describe('the readout at the cursor', () => {
  it('shows the value of every curve at the cursor time', async () => {
    const element = await started()
    const box = laidOut(element)
    // the limits of an axis carry the same margin on both sides, so the middle
    // of the plot box is the middle time of the run, which is 1 of its 0, 1, 2
    await hover(element, { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 })
    expect(readoutRows(element)).toEqual([
      ['curve A', '1 uM'],
      ['curve B', '10 umol'],
    ])
    expect(textOf(element, '.readout-time')).toBe('1 h')
    expect(dataCalls()).toHaveLength(0)
    expect(simulations()).toHaveLength(1)
  })

  it('places the readout inside the plot near the cursor and never outside it', async () => {
    const element = await started()
    const box = laidOut(element)
    const middle = (box.y0 + box.y1) / 2
    for (const share of [0, 0.2, 0.5, 0.8, 1]) {
      laidOut(element)
      await hover(element, { x: box.x0 + share * (box.x1 - box.x0), y: middle })
      const one = readoutBox(element)
      const line = styleOf(element, '.crosshair', 'left')
      expect(one.width).toBeGreaterThan(0)
      expect(one.left).toBeGreaterThanOrEqual(box.x0)
      expect(one.left + one.width).toBeLessThanOrEqual(box.x1 + 1e-6)
      expect(line).toBeGreaterThanOrEqual(box.x0)
      expect(line).toBeLessThanOrEqual(box.x1)
    }
    for (const y of [box.y0, middle, box.y1]) {
      laidOut(element)
      await hover(element, { x: (box.x0 + box.x1) / 2, y })
      const one = readoutBox(element)
      expect(one.height).toBeGreaterThan(0)
      expect(one.top).toBeGreaterThanOrEqual(box.y0)
      expect(one.top + one.height).toBeLessThanOrEqual(box.y1 + 1e-6)
    }
    // at the right edge the box flipped to the other side of the crosshair,
    // and at the left edge it stayed on its right
    laidOut(element)
    await hover(element, { x: box.x1, y: middle })
    const flipped = readoutBox(element)
    expect(flipped.left + flipped.width).toBeLessThanOrEqual(styleOf(element, '.crosshair', 'left'))
    laidOut(element)
    await hover(element, { x: box.x0, y: middle })
    expect(readoutBox(element).left).toBeGreaterThan(styleOf(element, '.crosshair', 'left'))
  })

  it('clears the readout when the cursor leaves the plot', async () => {
    const element = await started()
    const box = laidOut(element)
    const centre = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }
    await hover(element, centre)
    expect(shadow(element).querySelector('.readout')).not.toBeNull()
    await leave(element)
    expect(shadow(element).querySelector('.readout')).toBeNull()
    // the tick labels under the x axis are outside the plot box
    laidOut(element)
    await hover(element, { x: centre.x, y: box.y1 + 10 })
    expect(shadow(element).querySelector('.readout')).toBeNull()
    laidOut(element)
    await hover(element, centre)
    expect(shadow(element).querySelector('.readout')).not.toBeNull()
    element.freeze()
    await nextTick()
    expect(shadow(element).querySelector('.readout')).toBeNull()
  })

  it('does not fail on a touch device without a pointer', async () => {
    const element = await started()
    laidOut(element)
    // a pointer event without coordinates, and a figure nothing measured, are
    // both a figure without a cursor and never an exception
    await expect(hover(element, null)).resolves.toBeUndefined()
    expect(shadow(element).querySelector('.readout')).toBeNull()
    await expect(leave(element)).resolves.toBeUndefined()
    const unmeasured = await started()
    await hover(unmeasured, { x: 10, y: 10 })
    expect(shadow(unmeasured).querySelector('.readout')).toBeNull()
    expect(figure(unmeasured)).toContain('<svg')
  })

  it('draws no readout when hover is off', async () => {
    const element = await started({ hover: 'off' })
    const box = laidOut(element)
    await hover(element, { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 })
    expect(shadow(element).querySelector('.readout')).toBeNull()
    expect(shadow(element).querySelector('.crosshair')).toBeNull()
  })

  it('counts the rows a short plot box has no room for and loses no marker', async () => {
    served.panel = () => Promise.resolve(manyCurves())
    served.simulate = () => Promise.resolve(manyRuns())
    const element = await started()
    await resizeTo(400)
    const box = laidOut(element)
    await hover(element, { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 })
    const rows = readoutRows(element)
    const more = shadow(element).querySelector('.readout-more')
    const shown = more === null ? rows.length : rows.length - 1
    const left = more === null ? 0 : Number(/\+(\d+) more/.exec(more.textContent)?.[1] ?? 0)
    // the box shows the rows it has room for and counts the rest: nothing is
    // cut in half and nothing goes missing without being said
    expect(shown + left).toBe(MANY.length)
    expect(left).toBeGreaterThan(0)
    expect(more?.textContent.trim()).toBe(`+${String(left)} more`)
    // the markers on the crosshair are drawn for every curve whatever the box
    // shows, so the figure itself loses no value
    expect(shadow(element).querySelectorAll('.dot')).toHaveLength(MANY.length)
    const card = readoutBox(element)
    expect(card.top).toBeGreaterThanOrEqual(box.y0)
    expect(card.top + card.height).toBeLessThanOrEqual(box.y1 + 1e-6)
  })

  it('keeps the crosshair and the readout out of the accessibility tree', async () => {
    const element = await started()
    const box = laidOut(element)
    await hover(element, { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 })
    expect(part(element, '.cursor').getAttribute('aria-hidden')).toBe('true')
    expect(figure(element)).toContain('role="img"')
    expect(figure(element)).toContain('<title>')
    // the one stop of the figure in the order of the keys is the readout of the
    // keyboard, which says in words what the box shows
    const stops = [...shadow(element).querySelectorAll('[tabindex]')]
    expect(stops).toEqual([part(element, '.plot')])
  })

  /** Press a key on the figure, which bubbles out of the panel unless it is stopped. */
  async function press(element: PanelElement, key: string): Promise<boolean> {
    let reached = false
    const listen = (): void => {
      reached = true
    }
    document.addEventListener('keydown', listen)
    part(element, '.plot').dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }),
    )
    document.removeEventListener('keydown', listen)
    await nextTick()
    return reached
  }

  it('reads every value of every curve with the keys, as words, and keeps the keys from a deck', async () => {
    const element = await started()
    const box = laidOut(element)
    const plotted = part(element, '.plot')
    expect(plotted.getAttribute('role')).toBe('slider')
    expect(plotted.getAttribute('tabindex')).toBe('0')
    expect(plotted.getAttribute('aria-label')).toBe('Values of value over time [h]')
    expect(plotted.getAttribute('aria-valuemax')).toBe('2')
    plotted.dispatchEvent(new FocusEvent('focus'))
    await nextTick()
    // the first point, with every curve, its value and its unit
    expect(plotted.getAttribute('aria-valuenow')).toBe('0')
    expect(plotted.getAttribute('aria-valuetext')).toBe('0 h: curve A 0 uM, curve B 0 umol')
    // the arrow keys step along the grid and stop at the figure, so a deck
    // does not turn the slide under them; another key reaches the page
    expect(await press(element, 'ArrowRight')).toBe(false)
    expect(plotted.getAttribute('aria-valuenow')).toBe('1')
    expect(plotted.getAttribute('aria-valuetext')).toMatch(
      /^1 h: curve A [\d.]+ uM, curve B [\d.]+ umol$/,
    )
    expect(await press(element, 'End')).toBe(false)
    expect(plotted.getAttribute('aria-valuenow')).toBe('2')
    expect(await press(element, 'ArrowRight')).toBe(false)
    expect(plotted.getAttribute('aria-valuenow')).toBe('2')
    expect(await press(element, 'Home')).toBe(false)
    expect(plotted.getAttribute('aria-valuenow')).toBe('0')
    expect(await press(element, 'n')).toBe(true)
    // a sighted reader of the keyboard sees the readout where the keys put it
    expect(readoutRows(element).map((row) => row[0])).toEqual(['curve A', 'curve B'])
    const left = (): number =>
      Number.parseFloat(
        /left: ([\d.]+)px/.exec(part(element, '.crosshair').getAttribute('style') ?? '')?.[1] ?? '',
      )
    const first = left()
    expect(first).toBeGreaterThanOrEqual(box.x0)
    await press(element, 'End')
    expect(left()).toBeGreaterThan(first)
    expect(left()).toBeLessThanOrEqual(box.x1)
    // the summary of every curve, which the figure names as its description
    const summary = part(element, `#${plotted.getAttribute('aria-describedby') ?? ''}`)
    expect(summary.textContent).toMatch(/curve A: highest [\d.]+ uM at 2 h, [\d.]+ uM at 2 h\./)
    expect(summary.textContent).toContain('arrow keys')
    plotted.dispatchEvent(new FocusEvent('blur'))
    await nextTick()
    expect(shadow(element).querySelector('.readout')).toBeNull()
  })
})

describe('the study data under the curves', () => {
  it('fetches the study data once and draws it under the curves', async () => {
    served.panel = () => Promise.resolve(withData())
    const element = await started()
    expect(dataCalls()).toHaveLength(1)
    const drawn = figure(element)
    expect(drawn).toContain('class="points" data-series="seriesA"')
    expect(drawn).toContain('class="marker"')
    expect(drawn).toContain('class="errorbar"')
    expect(drawn.indexOf('class="points"')).toBeLessThan(drawn.indexOf('class="curve"'))
    // the data is read once and the movement of a knob redraws from it
    move(control(element, 'knobB'), '0.4', 'input')
    await nextTick()
    expect(dataCalls()).toHaveLength(1)
    expect(figure(element)).toContain('class="marker"')
  })

  it('draws no data and makes no data request when the panel declares none', async () => {
    const element = await started()
    expect(dataCalls()).toHaveLength(0)
    expect(figure(element)).not.toContain('class="points"')
  })

  it('omits the overlay when data="off"', async () => {
    served.panel = () => Promise.resolve(withData())
    const element = await started({ data: 'off' })
    expect(dataCalls()).toHaveLength(0)
    expect(figure(element)).not.toContain('class="points"')
  })

  it('keeps the curves and says nothing when the study data cannot be read', async () => {
    served.panel = () => Promise.resolve(withData())
    served.data = unreachable
    const seen: string[] = []
    const element = await mount({ endpoint: '/api-root', model: 'modelA', panel: 'panelA' })
    element.addEventListener('sbmlsim-error', (event) => {
      seen.push((event as CustomEvent<{ kind: string }>).detail.kind)
    })
    await element.activate()
    await nextTick()
    // nothing the reader asked for failed: the curves stay, the overlay is
    // absent, no line is written and the page is told nothing
    expect(figure(element)).toContain('<svg')
    expect(figure(element)).not.toContain('class="points"')
    expect(textOf(element, '.error')).toBe('')
    expect(seen).toEqual([])
    expect(control(element, 'knobA').disabled).toBe(false)
  })

  it('leaves out a series which is delivered on a scale of its own and says so once', async () => {
    // a figure has one y axis: a series in another unit than its curve would
    // be drawn on a scale which is not the one of the axis it sits on
    served.panel = () => Promise.resolve(withData({ unit: 'nM' }))
    served.data = () => Promise.resolve(studyData({ unit: 'nM' }))
    const seen: string[] = []
    const element = await mount({ endpoint: '/api-root', model: 'modelA', panel: 'panelA' })
    element.addEventListener('sbmlsim-error', (event) => {
      seen.push((event as CustomEvent<{ kind: string }>).detail.kind)
    })
    await element.activate()
    await nextTick()
    expect(figure(element)).not.toContain('class="points"')
    expect(textOf(element, '.error')).toBe('')
    expect(seen).toEqual([])
    // the line names the series, the curve it sits under and the two units
    expect(warnings()).toHaveLength(1)
    expect(warnings()[0]).toContain('"seriesA"')
    expect(warnings()[0]).toContain('"curveA"')
    expect(warnings()[0]).toContain('nM')
    expect(warnings()[0]).toContain('uM')
    // a redraw says it again for no series: it is said once per element
    move(control(element, 'knobB'), '0.4', 'input')
    await nextTick()
    expect(warnings()).toHaveLength(1)
  })

  it('leaves out a series whose curve the panel does not draw and says so once', async () => {
    served.panel = () => Promise.resolve(withData({ curve: 'curveTypo' }))
    const element = await started()
    expect(figure(element)).not.toContain('class="points"')
    expect(textOf(element, '.error')).toBe('')
    expect(warnings()).toHaveLength(1)
    expect(warnings()[0]).toContain('"seriesA"')
    expect(warnings()[0]).toContain('"curveTypo"')
  })

  it('leaves out a series whose x is in another unit than the run and says so once', async () => {
    served.panel = () => Promise.resolve(withData())
    served.data = () => Promise.resolve(studyData({ x_unit: 'min' }))
    const element = await started()
    expect(figure(element)).not.toContain('class="points"')
    expect(textOf(element, '.error')).toBe('')
    expect(warnings()).toHaveLength(1)
    expect(warnings()[0]).toContain('"seriesA"')
    expect(warnings()[0]).toContain('min')
    expect(warnings()[0]).toContain(' h')
  })

  it('keeps the study data when data is switched off after it arrived', async () => {
    served.panel = () => Promise.resolve(withData())
    const element = await started()
    expect(figure(element)).toContain('class="points"')
    element.setAttribute('data', 'off')
    await nextTick()
    // the overlay goes, the curves stay, and nothing is asked for again
    expect(figure(element)).not.toContain('class="points"')
    expect(figure(element)).toContain('class="curve"')
    expect(dataCalls()).toHaveLength(1)
    element.setAttribute('data', 'on')
    await nextTick()
    expect(figure(element)).toContain('class="points"')
    expect(dataCalls()).toHaveLength(1)
  })

  it('reads the study data when data is switched on after the panel started', async () => {
    served.panel = () => Promise.resolve(withData())
    const element = await started({ data: 'off' })
    expect(dataCalls()).toHaveLength(0)
    element.setAttribute('data', 'on')
    await settled()
    // a panel which is asked for its study data later asks for it, once, as a
    // panel which carried the attribute from the start does
    expect(dataCalls()).toHaveLength(1)
    expect(figure(element)).toContain('class="points"')
  })

  it('keeps a study point beyond the simulated time out of the figure', async () => {
    served.panel = () => Promise.resolve(withData())
    const beyond = { x: [0, 1, 2, 96], y: [0.1, 0.9, 1.9, 40], yerr: [0.05, 0.1, null, null] }
    served.data = () => Promise.resolve(studyData(beyond))
    const outside = await started()
    served.data = () => Promise.resolve(studyData())
    const inside = await started()
    // the run answers the times 0, 1 and 2: a point at 96 would stretch both
    // axes to cover what is drawn nowhere
    expect(figure(outside)).toContain('class="marker"')
    expect(figure(outside)).toBe(figure(inside))
  })

  it('draws a series only once the figure is the state it was measured at', async () => {
    // the choice knob starts at 25 and the series was measured at 12.5, and
    // the run grids over the range knob, so the figure follows a move of the
    // choice knob only when the answer of it arrives. The condition of a
    // series is a statement about the curve it sits on, so it is compared
    // against the state the figure is drawn at and never against the controls,
    // which run ahead of it by the debounce and a round trip: data of one
    // condition is never drawn under a curve of another, not even for the
    // frame between the move and the answer
    vi.useFakeTimers()
    served.panel = () => Promise.resolve(withData({ at: { knobA: 12.5 } }))
    const element = await started()
    expect(figure(element)).not.toContain('class="points"')
    // and it is nothing a reader is told about, it is simply not that condition
    expect(warnings()).toHaveLength(0)
    move(control(element, 'knobA'), '12.5', 'change')
    await nextTick()
    // the control is at the state of the series, the drawn curve is not: the
    // run of it has not even started
    expect(simulations()).toHaveLength(1)
    expect(figure(element)).not.toContain('class="points"')
    await vi.advanceTimersByTimeAsync(500)
    // the curve of that state and the series on it arrive together
    expect(simulations()).toHaveLength(2)
    expect(figure(element)).toContain('class="points" data-series="seriesA"')
  })

  it('keeps a series on the figure it belongs to until the next one arrives', async () => {
    // the other half of the same rule: a knob moved away from the state of the
    // series leaves the series where it is, on the curve it was measured
    // under, until the curve of the new state is drawn
    vi.useFakeTimers()
    served.panel = () => Promise.resolve(withData({ at: { knobA: 12.5 } }))
    const element = await started()
    move(control(element, 'knobA'), '12.5', 'change')
    await vi.advanceTimersByTimeAsync(500)
    expect(figure(element)).toContain('class="points" data-series="seriesA"')
    move(control(element, 'knobB'), '0.6', 'change')
    await nextTick()
    expect(figure(element)).toContain('class="points" data-series="seriesA"')
    await vi.advanceTimersByTimeAsync(500)
    expect(figure(element)).toContain('class="points" data-series="seriesA"')
  })

  it('leaves a series off when the run of the state it was measured at fails', async () => {
    // a failed run keeps the answer it had, which is of the state before the
    // move; drawn under the moved control it would pair a curve of one
    // condition with the data of another
    vi.useFakeTimers()
    served.panel = () => Promise.resolve(withData({ at: { knobA: 12.5 } }))
    const element = await started()
    expect(figure(element)).not.toContain('class="points"')
    served.simulate = unreachable
    move(control(element, 'knobA'), '12.5', 'change')
    await vi.advanceTimersByTimeAsync(500)
    // the figure of the first run is of another state than the one the
    // control shows, so it is not drawn, and the line says so
    expect(textOf(element, '.error')).toContain('cannot be drawn')
    expect(figure(element)).toBe('')
    // the control moved back to the state of the figure draws it again
    move(control(element, 'knobA'), '25', 'change')
    expect(figure(element)).toBe('')
    await nextTick()
    expect(figure(element)).toContain('class="curve"')
    expect(figure(element)).not.toContain('class="points"')
  })

  it('draws the answer of a run at the state the run was issued at', async () => {
    // a control which moves while a run is in flight does not change what that
    // run answered: the series of the moved value belongs on the curve of the
    // run which is still to come and not on the one which is drawn
    vi.useFakeTimers()
    served.panel = () => Promise.resolve(withData({ at: { knobA: 12.5 } }))
    let answer = (): void => {
      // replaced by the run of the defaults, which is held open
    }
    let issued = 0
    served.simulate = () => {
      issued += 1
      return new Promise((resolve) => {
        answer = () => {
          resolve(run())
        }
      })
    }
    const element = await mount({ endpoint: '/api-root', model: 'modelA', panel: 'panelA' })
    void element.activate()
    await vi.advanceTimersByTimeAsync(10)
    // the run of the defaults is in flight and the reader moves the choice
    // knob to the state of the series, which schedules a run of its own
    expect(issued).toBe(1)
    move(control(element, 'knobA'), '12.5', 'change')
    answer()
    // the answer lands well inside the debounce of the run which was just
    // scheduled, so it is drawn and the run of the move is still to come
    await vi.advanceTimersByTimeAsync(1)
    await nextTick()
    // the answer which lands is the figure of 25, so the series is not on it
    expect(simulations()).toHaveLength(1)
    expect(figure(element)).toContain('class="curve"')
    expect(figure(element)).not.toContain('class="points"')
    served.simulate = () => Promise.resolve(run())
    await vi.advanceTimersByTimeAsync(300)
    expect(simulations()).toHaveLength(2)
    expect(figure(element)).toContain('class="points" data-series="seriesA"')
  })

  it('sends the state of the run again when a request is retried', async () => {
    // the retry is the same request, not the request of whatever the controls
    // hold when it is made: a body of the new state would be drawn as the
    // answer of the old one
    vi.useFakeTimers()
    const element = await started()
    let refuse = (): void => {
      // replaced by the first attempt, which is held open
    }
    let attempts = 0
    served.simulate = () => {
      attempts += 1
      if (attempts > 1) {
        return Promise.resolve(run())
      }
      return new Promise((_resolve, reject) => {
        refuse = () => {
          reject(new TypeError('Failed to fetch'))
        }
      })
    }
    move(control(element, 'knobA'), '12.5', 'change')
    await vi.advanceTimersByTimeAsync(300)
    expect(attempts).toBe(1)
    // a knob moves while the first attempt is in flight, and the network
    // failure of that attempt is retried
    move(control(element, 'knobB'), '0.6', 'input')
    refuse()
    await vi.advanceTimersByTimeAsync(300)
    const bodies = simulations()
    expect(attempts).toBe(2)
    expect(bodies).toHaveLength(3)
    expect(bodies[2]).toEqual(bodies[1])
    expect(bodies[2]?.values).toEqual({ knobB: 1 })
  })

  it('reads the stored answer at the values the panel declares', async () => {
    // a fallback is an answer which was computed before the page was opened
    // and carries no knob values, so it is the state the panel is declared
    // with: a control a reader moved before it arrives says nothing about it
    vi.useFakeTimers()
    const atDefault = declaredData({ id: 'seriesA', at: { knobA: 25 } })
    const atOther = declaredData({ id: 'seriesB', label: 'Series B', at: { knobA: 12.5 } })
    served.panel = () => Promise.resolve({ ...declaration(), data: [atDefault, atOther] })
    served.data = () =>
      Promise.resolve({
        contract: 'paneldata/1',
        series: [...studyData().series, { ...studyData().series[0], id: 'seriesB' }],
      } as PanelDataResponse)
    served.simulate = () =>
      new Promise(() => {
        // the run is never answered, so the stored answer is what is drawn
      })
    let deliver = (): void => {
      // replaced by the request of the stored answer, which is held open
    }
    served.stored = () =>
      new Promise((resolve) => {
        deliver = () => {
          resolve(run('knobB', undefined, 'stored00stored00'))
        }
      })
    const element = await mount({
      endpoint: '/api-root',
      model: 'modelA',
      panel: 'panelA',
      fallback: './stored.json',
    })
    void element.activate()
    await vi.advanceTimersByTimeAsync(10)
    // a reader moves the choice knob before the stored answer is drawn
    move(control(element, 'knobA'), '12.5', 'change')
    deliver()
    await vi.advanceTimersByTimeAsync(10)
    expect(textOf(element, '.provenance')).toContain('stored')
    // the stored answer is the figure of the declared 25, whatever the control
    // was moved to while it was on its way
    expect(figure(element)).toContain('data-series="seriesA"')
    expect(figure(element)).not.toContain('data-series="seriesB"')
  })

  it('keeps the shape of a series whose sibling under its curve is left out', async () => {
    // two series under one curve share its colour and are told apart by their
    // shape, so a shape which depends on which of them is drawn is a series
    // changing shape as a knob moves
    vi.useFakeTimers()
    const second = declaredData({ id: 'seriesB', label: 'Series B' })
    served.panel = () =>
      Promise.resolve({
        ...declaration(),
        data: [declaredData({ at: { knobA: 12.5 } }), second],
      })
    served.data = () =>
      Promise.resolve({
        contract: 'paneldata/1',
        series: [...studyData().series, { ...studyData().series[0], id: 'seriesB' }],
      } as PanelDataResponse)
    const element = await started()
    // the first series is of another condition, the second is drawn alone and
    // keeps the shape of its place among the two
    expect(figure(element)).not.toContain('data-series="seriesA"')
    // the first shape is the circle, the second a polygon of the same area
    const alone = shapeOf(element, 'seriesB')
    expect(alone).toBe('path')
    move(control(element, 'knobA'), '12.5', 'change')
    await vi.advanceTimersByTimeAsync(500)
    expect(shapeOf(element, 'seriesA')).toBe('circle')
    expect(shapeOf(element, 'seriesB')).toBe(alone)
  })

  it('draws a series of a state of the knob the run grids over only at that choice', async () => {
    // a grid is the points a movement is read between and not a family of
    // curves: the figure draws the one line of the choice the knob is at, so
    // the data of another choice is drawn only once the reader picks it
    vi.useFakeTimers()
    served.panel = () => Promise.resolve(gridsOverChoices({ at: { knobA: 12.5 } }))
    served.simulate = () => Promise.resolve(choiceRun())
    const element = await started()
    expect(figure(element)).not.toContain('class="points"')
    move(control(element, 'knobA'), '12.5', 'change')
    await nextTick()
    expect(figure(element)).toContain('class="points" data-series="seriesA"')
    // the move was read out of the grid, so the figure it is drawn on is the
    // one the first run answered
    expect(simulations()).toHaveLength(1)
    // a value which is no choice of that knob is drawn nowhere
    served.panel = () => Promise.resolve(gridsOverChoices({ at: { knobA: 50 } }))
    expect(figure(await started())).not.toContain('class="points"')
  })

  it('draws a series which was measured at no state whatever the knobs are', async () => {
    vi.useFakeTimers()
    served.panel = () => Promise.resolve(withData())
    const element = await started()
    expect(figure(element)).toContain('class="points"')
    move(control(element, 'knobA'), '12.5', 'change')
    await nextTick()
    expect(figure(element)).toContain('class="points"')
  })

  it('draws a series of a state of a knob the panel does not declare nowhere', async () => {
    served.panel = () => Promise.resolve(withData({ at: { knobC: 1 } }))
    expect(figure(await started())).not.toContain('class="points"')
  })
})

describe('the variant of the model', () => {
  it('is left out of the request without the attribute and sent with it', async () => {
    await started()
    expect(simulations()[0]).not.toHaveProperty('variant')
    await started({ variant: 'variantA' })
    expect(simulations()[1]?.variant).toBe('variantA')
  })

  it('reads its declaration and its study data in the variant it is given', async () => {
    served.panel = () => Promise.resolve(withData())
    await started({ variant: 'variant A' })
    expect(declarations().map((one) => one.url)).toEqual([
      '/api-root/api/models/modelA/panels/panelA?variant=variant%20A',
    ])
    expect(dataCalls().map((one) => one.url)).toEqual([
      '/api-root/api/models/modelA/panels/panelA/data?variant=variant%20A',
    ])
  })

  it('keeps its head, its controls and its provenance line while it reads the variant it is switched to', async () => {
    let release: (() => void) | null = null
    served.panel = (variant) =>
      variant === 'variantB'
        ? new Promise((resolve) => {
            release = () => {
              resolve(declaration())
            }
          })
        : Promise.resolve(declaration())
    const element = await started({ variant: 'variantA' })
    const foot = textOf(element, '.provenance')
    expect(foot).not.toBe('')
    element.setAttribute('variant', 'variantB')
    await settled()
    // the head, the controls and the provenance of variant A stay, the
    // controls taking no movement and the provenance dimmed with the figure
    expect(textOf(element, '.title')).toBe('Panel A')
    expect(shadow(element).querySelectorAll('.knob')).toHaveLength(2)
    const held = part(element, '.provenance.held')
    expect(held.textContent.trim()).toBe(foot)
    expect(held.getAttribute('aria-hidden')).toBe('true')
    // the options are disabled with the knobs: a toggle of the axis made now
    // would be undone by the declaration the panel reads
    const disabled = (): boolean[] =>
      [
        ...shadow(element).querySelectorAll<HTMLInputElement | HTMLButtonElement>(
          '.knob select, .knob input, .options input, .options button',
        ),
      ].map((one) => one.disabled)
    expect(shadow(element).querySelectorAll('.options input, .options button')).toHaveLength(2)
    expect(disabled().every(Boolean)).toBe(true)
    ;(release as unknown as () => void)()
    await settled()
    expect(shadow(element).querySelector('.provenance.held')).toBeNull()
    expect(textOf(element, '.provenance')).not.toBe('')
    const options = shadow(element).querySelector<HTMLInputElement>('.options input')
    expect(options?.disabled).toBe(false)
  })

  it('shows the head it is given until it has read its declaration', async () => {
    let release: (() => void) | null = null
    served.panel = () =>
      new Promise((resolve) => {
        release = () => {
          resolve(declaration())
        }
      })
    const element = await mount({
      endpoint: '/api-root',
      model: 'modelA',
      panel: 'panelA',
      head: JSON.stringify({ title: 'Panel A of the app', subtitle: 'what the app says' }),
    })
    void element.activate()
    await settled()
    expect(textOf(element, '.title')).toBe('Panel A of the app')
    expect(textOf(element, '.subtitle')).toBe('what the app says')
    ;(release as unknown as () => void)()
    await settled()
    expect(textOf(element, '.title')).toBe('Panel A')
    // a head which cannot be read is as if it were absent: nothing is shown
    // until the declaration arrives
    served.panel = () => new Promise<never>(() => undefined)
    const other = await mount({
      endpoint: '/api-root',
      model: 'modelA',
      panel: 'panelA',
      head: '{',
    })
    void other.activate()
    await settled()
    expect(textOf(other, '.title')).toBe('')
  })

  it('sends a value of its host which is a choice to the last bits as that choice', async () => {
    const element = await started({ values: JSON.stringify({ knobA: 12.500000000000002 }) })
    expect(element).toBeDefined()
    expect(simulations()[0]?.values).toEqual({ knobA: 12.5 })
  })

  it('reads its declaration and its study data again when it changes, and runs that', async () => {
    vi.useFakeTimers()
    served.panel = () => Promise.resolve(withData())
    const element = await started({ variant: 'variantA' })
    expect(simulations()).toHaveLength(1)
    element.setAttribute('variant', 'variantB')
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    expect(simulations().map((one) => one.variant)).toEqual(['variantA', 'variantB'])
    expect(declarations().map((one) => one.url.split('?')[1])).toEqual([
      'variant=variantA',
      'variant=variantB',
    ])
    expect(dataCalls().map((one) => one.url.split('?')[1])).toEqual([
      'variant=variantA',
      'variant=variantB',
    ])
    expect(figure(element)).toContain('class="curve"')
  })

  it('draws the declaration of the variant it is switched to, and nothing while it reads it', async () => {
    // the declaration of variant B is another title and another label of a
    // curve, as two builds of a model have them
    let release: (() => void) | null = null
    served.panel = (variant) => {
      const declared = declaration()
      if (variant !== 'variantB') {
        return Promise.resolve(declared)
      }
      const other = {
        ...declared,
        panel: { ...declared.panel, title: 'Panel A of B' },
        curves: declared.curves.map((one) => ({ ...one, label: `${one.label} of B` })),
      }
      return new Promise((resolve) => {
        release = () => {
          resolve(other)
        }
      })
    }
    const element = await started({ variant: 'variantA' })
    expect(textOf(element, '.title')).toBe('Panel A')
    const before = figure(element)
    element.setAttribute('variant', 'variantB')
    await settled()
    // while the declaration of variant B is read no figure of either is drawn
    // as current: the figure of variant A is held, dimmed, inert and hidden
    // from a reader, and the head and the controls of variant A are kept, the
    // controls taking no movement, so the panel keeps its height
    expect(figure(element)).toBe('')
    expect(textOf(element, '.title')).toBe('Panel A')
    const held = [
      ...shadow(element).querySelectorAll<HTMLSelectElement | HTMLInputElement>(
        '.knob select, .knob input',
      ),
    ]
    expect(held).toHaveLength(2)
    expect(held.every((one) => one.disabled)).toBe(true)
    const holding = heldFigure(element)
    expect(holding?.innerHTML).toBe(before)
    expect(holding?.hasAttribute('inert')).toBe(true)
    expect(holding?.getAttribute('aria-hidden')).toBe('true')
    expect(textOf(element, '.pending')).toBe('')
    expect(release).not.toBeNull()
    ;(release as unknown as () => void)()
    await settled()
    expect(textOf(element, '.title')).toBe('Panel A of B')
    expect(figure(element)).toContain('curve A of B')
    // the figure of the new variant takes the place of the one it held
    expect(heldFigure(element)).toBeNull()
  })

  it('keeps the value of a knob of its own which the variant declares as well', async () => {
    vi.useFakeTimers()
    const element = await started({ variant: 'variantA' })
    move(control(element, 'knobA'), '12.5', 'change')
    await vi.advanceTimersByTimeAsync(500)
    element.setAttribute('variant', 'variantB')
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    expect((control(element, 'knobA') as HTMLSelectElement).value).toBe('12.5')
    expect(simulations().at(-1)).toEqual({
      values: { knobA: 12.5 },
      grid: { knobB: 3 },
      variant: 'variantB',
    })
    // a value the declaration of the variant does not take is its default there
    served.panel = (variant) => {
      const declared = declaration()
      return Promise.resolve(
        variant === 'variantC'
          ? {
              ...declared,
              axes: declared.axes.map((one) =>
                one.id === 'knobA' ? { ...one, choices: [{ label: 'only', value: 25 }] } : one,
              ),
            }
          : declared,
      )
    }
    element.setAttribute('variant', 'variantC')
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    expect(simulations().at(-1)?.values).toEqual({ knobA: 25 })
  })

  it('drops a declaration and study data of the variant before which arrive late', async () => {
    const late: (() => void)[] = []
    served.panel = (variant) => {
      const declared = withData()
      const answer =
        variant === 'variantA'
          ? declared
          : { ...declared, panel: { ...declared.panel, title: 'Panel A of B' } }
      return Promise.resolve(answer)
    }
    // the series of variant A is of values far above the curves, which would
    // stretch the value axis; the one of variant B is among them. A series is
    // drawn with the label of its declaration, so its values tell them apart
    served.data = (variant) =>
      new Promise((resolve) => {
        late.push(() => {
          resolve(studyData({ y: variant === 'variantA' ? [100, 200, 300] : [1, 2, 3] }))
        })
      })
    // the start waits for the study data, which arrives late, so it is not awaited
    const element = await mount({
      endpoint: '/api-root',
      model: 'modelA',
      panel: 'panelA',
      variant: 'variantA',
    })
    void element.activate()
    await settled()
    element.setAttribute('variant', 'variantB')
    await settled()
    // the data of variant B arrives first, the one of variant A after it
    late[1]?.()
    await settled()
    late[0]?.()
    await settled()
    expect(textOf(element, '.title')).toBe('Panel A of B')
    expect(figure(element)).toContain('class="points" data-series="seriesA"')
    const axis = (figure(element).split('<g class="axis y"')[1] ?? '').split('<g class="data"')[0]
    expect(axis).toContain('>20<')
    expect(axis).not.toContain('>300<')
  })

  it('drops a declaration of the variant before which arrives after the one of the variant after', async () => {
    let late: (() => void) | null = null
    served.panel = (variant) => {
      const declared = declaration()
      if (variant === 'variantA') {
        // the stub answers whatever the signal says, as a response already on its way does
        return new Promise((resolve) => {
          late = () => {
            resolve(declared)
          }
        })
      }
      return Promise.resolve({ ...declared, panel: { ...declared.panel, title: 'Panel A of B' } })
    }
    const element = await mount({
      endpoint: '/api-root',
      model: 'modelA',
      panel: 'panelA',
      variant: 'variantA',
    })
    void element.activate()
    await settled()
    element.setAttribute('variant', 'variantB')
    await settled()
    expect(textOf(element, '.title')).toBe('Panel A of B')
    ;(late as unknown as () => void)()
    await settled()
    expect(textOf(element, '.title')).toBe('Panel A of B')
    expect(simulations().map((one) => one.variant)).toEqual(['variantB'])
  })

  it('draws no figure of the variant before when the run of a switch fails', async () => {
    vi.useFakeTimers()
    const element = await started({ variant: 'variantA' })
    expect(figure(element)).toContain('class="curve"')
    served.simulate = unreachable
    element.setAttribute('variant', 'variantB')
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    // the answer of variant A is gone with its declaration, the figure it held
    // is dropped by the failure, and the line says that the figure of the
    // settings shown cannot be drawn
    expect(figure(element)).toBe('')
    expect(heldFigure(element)).toBeNull()
    expect(textOf(element, '.error')).toContain('cannot be drawn')
    expect(textOf(element, '.provenance')).toBe('')
    // back on variant A, it is read and run again
    served.simulate = () => Promise.resolve(run())
    element.setAttribute('variant', 'variantA')
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    expect(figure(element)).toContain('class="curve"')
    expect(textOf(element, '.error')).toBe('')
    element.setAttribute('variant', 'variantB')
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    expect(simulations().at(-1)?.variant).toBe('variantB')
    expect(textOf(element, '.error')).toBe('')
    expect(figure(element)).toContain('class="curve"')
  })

  it('starts again for another model, endpoint or panel', async () => {
    const element = await started()
    for (const [name, value] of [
      ['panel', 'panelB'],
      ['model', 'modelB'],
      ['endpoint', '/other-root'],
    ] as const) {
      const before = calls.length
      element.setAttribute(name, value)
      await settled()
      await settled()
      const asked = calls.slice(before).map((one) => one.url)
      // the declaration and the run of what the attributes name now, read afresh
      expect(
        asked.some((url) => url.endsWith(`/panels/${element.getAttribute('panel') ?? ''}`)),
        name,
      ).toBe(true)
      expect(
        asked.some((url) => url.endsWith('/simulate')),
        name,
      ).toBe(true)
      expect(
        asked.every((url) => url.startsWith(element.getAttribute('endpoint') ?? '')),
        name,
      ).toBe(true)
      expect(
        asked.every((url) => url.includes(`/models/${element.getAttribute('model') ?? ''}/`)),
        name,
      ).toBe(true)
    }
    expect(figure(element)).toContain('class="curve"')
  })

  it('announces every answer with its provenance', async () => {
    const heard: unknown[] = []
    document.addEventListener('sbmlsim-result', (event) =>
      heard.push(
        (event as CustomEvent<{ provenance: { engine: string } }>).detail.provenance.engine,
      ),
    )
    await started()
    expect(heard).toEqual(['engineA'])
  })
})

describe('the knobs the host owns', () => {
  /** The ids of the knobs the panel draws a control of, in their order. */
  function shownKnobs(element: PanelElement): string[] {
    return [...shadow(element).querySelectorAll('.knob select, .knob input')].map((one) =>
      one.id.replace(/^knob-/, ''),
    )
  }

  it('carries no attribute values where the page gives none', async () => {
    // the element writes the default of a prop onto itself, and a default
    // text would be an attribute `values` on every panel of every page
    const element = await started()
    expect(element.hasAttribute('values')).toBe(false)
    expect(shownKnobs(element)).toEqual(['knobA', 'knobB'])
  })

  it('sets the knobs it is given and draws no control of exactly those', async () => {
    const element = await started({ values: '{"knobA": 12.5}' })
    expect(shownKnobs(element)).toEqual(['knobB'])
    expect(simulations()).toEqual([{ values: { knobA: 12.5 }, grid: { knobB: 3 } }])
    // a panel whose host owns every knob it declares has no control to put
    // beside its figure, as a panel without a knob has none
    const owned = await started({ values: '{"knobA": 12.5, "knobB": 0.6}' })
    await resizeTo(800)
    expect(shownKnobs(owned)).toEqual([])
    expect(part(owned, '.panel').className).toContain('layout-toolbar')
    expect(simulations()[1]).toEqual({ values: { knobA: 12.5 }, grid: { knobB: 3 } })
    // the gridded knob is read out of the grid at the value of the host
    expect(figure(owned)).not.toBe(figure(element))
  })

  it('runs again when a knob of the host moves which the grid does not cover', async () => {
    vi.useFakeTimers()
    const element = await started({ values: '{"knobA": 25}' })
    element.setAttribute('values', '{"knobA": 12.5}')
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    expect(simulations()).toEqual([
      { values: { knobA: 25 }, grid: { knobB: 3 } },
      { values: { knobB: 1 }, grid: { knobA: 2 } },
    ])
    expect(shownKnobs(element)).toEqual(['knobB'])
  })

  it('reads a movement of the host of the gridded knob out of the grid', async () => {
    vi.useFakeTimers()
    const element = await started({ values: '{"knobB": 1}' })
    const before = figure(element)
    element.setAttribute('values', '{"knobB": 0.4}')
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    expect(simulations()).toHaveLength(1)
    expect(figure(element)).not.toBe(before)
    // and the attribute written again with the same values moves nothing
    const moved = figure(element)
    element.setAttribute('values', '{ "knobB": 0.4 }')
    await vi.advanceTimersByTimeAsync(500)
    expect(simulations()).toHaveLength(1)
    expect(figure(element)).toBe(moved)
  })

  it('ignores an id it does not declare', async () => {
    vi.useFakeTimers()
    const element = await started({ values: '{"knobZ": 3}' })
    expect(shownKnobs(element)).toEqual(['knobA', 'knobB'])
    element.setAttribute('values', '{"knobZ": 4}')
    await vi.advanceTimersByTimeAsync(500)
    expect(simulations()).toEqual([{ values: { knobA: 25 }, grid: { knobB: 3 } }])
    expect(warnings()).toEqual([])
  })

  it('is as if it were absent when it cannot be read, and says so once', async () => {
    for (const text of [
      'knobA=12.5',
      '[12.5]',
      'null',
      '{"knobA": "12.5"}',
      '{"knobA": 1e999}',
      '{"knobA": 12.5, "knobB": null}',
    ]) {
      calls = []
      warned.mockClear()
      const element = await started({ values: text })
      expect(shownKnobs(element), text).toEqual(['knobA', 'knobB'])
      expect(simulations(), text).toEqual([{ values: { knobA: 25 }, grid: { knobB: 3 } }])
      expect(warnings(), text).toHaveLength(1)
      expect(warnings()[0], text).toContain('"values"')
      expect(textOf(element, '.error'), text).toBe('')
    }
  })

  it('keeps the knobs of the host on a reset and gives the others their defaults back', async () => {
    vi.useFakeTimers()
    const element = await started({ values: '{"knobB": 0.6}' })
    move(control(element, 'knobA'), '12.5', 'change')
    await vi.advanceTimersByTimeAsync(500)
    element.reset()
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    expect(control(element, 'knobA').value).toBe('25')
    move(control(element, 'knobA'), '12.5', 'change')
    await vi.advanceTimersByTimeAsync(500)
    expect(simulations()).toEqual([
      { values: { knobA: 25 }, grid: { knobB: 3 } },
      { values: { knobB: 0.6 }, grid: { knobA: 2 } },
      { values: { knobA: 25 }, grid: { knobB: 3 } },
      { values: { knobB: 0.6 }, grid: { knobA: 2 } },
    ])
  })

  it('follows a move of the host after a failed run, or says it cannot draw it', async () => {
    vi.useFakeTimers()
    const element = await started({ values: '{"knobA": 25, "knobB": 1}' })
    served.simulate = unreachable
    element.setAttribute('values', '{"knobA": 12.5, "knobB": 1}')
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    // the answer which is drawn is of the dose before, which no control shows
    expect(textOf(element, '.error')).toContain('could not be reached')
    expect(textOf(element, '.error')).toContain('cannot be drawn')
    expect(figure(element)).toBe('')
    // and no footer names the run of a figure which is not drawn
    expect(textOf(element, '.provenance')).toBe('')
    // a move of the knob the drawn grid covers is no reading of that grid now:
    // it runs again, and while it cannot answer nothing is drawn
    const runs = simulations().length
    element.setAttribute('values', '{"knobA": 12.5, "knobB": 0.6}')
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    expect(simulations().length).toBeGreaterThan(runs)
    expect(figure(element)).toBe('')
    // with the endpoint back, the next move draws the state of the host
    served.simulate = () => Promise.resolve(run('knobB'))
    element.setAttribute('values', '{"knobA": 12.5, "knobB": 0.4}')
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    expect(simulations().at(-1)).toEqual({ values: { knobA: 12.5 }, grid: { knobB: 3 } })
    expect(textOf(element, '.error')).toBe('')
    expect(figure(element)).toContain('class="curve"')
  })

  it('reads a knob whose id is a name every object has', async () => {
    served.panel = () => {
      const declared = declaration()
      const [choice, range] = declared.axes
      if (choice === undefined || range === undefined) {
        throw new Error('the declaration has two knobs')
      }
      return Promise.resolve({
        ...declared,
        axes: [
          { ...choice, id: 'constructor' },
          { ...range, id: 'toString' },
          { ...choice, id: '__proto__' },
        ],
      })
    }
    /** The values of the last run as JSON, which names a property `__proto__` as it is. */
    const sent = (): string => JSON.stringify(simulations().at(-1)?.values)
    const alone = await started()
    expect(shownKnobs(alone)).toEqual(['constructor', 'toString', '__proto__'])
    expect(sent()).toBe('{"constructor":25,"__proto__":25}')
    const hosted = await started({ values: '{"constructor": 12.5, "__proto__": 12.5}' })
    expect(shownKnobs(hosted)).toEqual(['toString'])
    expect(sent()).toBe('{"constructor":12.5,"__proto__":12.5}')
    // a move of the host of such a knob is a move as any other
    vi.useFakeTimers()
    hosted.setAttribute('values', '{"constructor": 12.5, "__proto__": 25}')
    await vi.advanceTimersByTimeAsync(500)
    expect(sent()).toBe('{"constructor":12.5,"toString":1}')
    expect(simulations().at(-1)?.grid).toEqual(JSON.parse('{"__proto__": 2}'))
  })

  it('gives a knob the host lets go of its default back', async () => {
    vi.useFakeTimers()
    const element = await started({ values: '{"knobA": 12.5}' })
    for (const [text, warned] of [
      ['', false],
      ['{"knobA": 12.5}', false],
      ['{"knobA": "12.5"}', true],
    ] as const) {
      element.setAttribute('values', text)
      await vi.advanceTimersByTimeAsync(500)
      await nextTick()
      const without = text === '' || warned
      expect(shownKnobs(element), text).toEqual(without ? ['knobA', 'knobB'] : ['knobB'])
      if (without) {
        // as a panel which was never given the attribute
        expect(control(element, 'knobA').value, text).toBe('25')
        expect(simulations().at(-1), text).toEqual({ values: { knobB: 1 }, grid: { knobA: 2 } })
      }
    }
    element.removeAttribute('values')
    await vi.advanceTimersByTimeAsync(500)
    expect(shownKnobs(element)).toEqual(['knobA', 'knobB'])
  })

  it('offers a reset only where it changes something, and keeps it focusable', async () => {
    /** Whether the reset says it has nothing to do; it is never disabled for it. */
    const idle = (button: HTMLButtonElement): boolean => {
      expect(button.disabled).toBe(false)
      return button.getAttribute('aria-disabled') === 'true'
    }
    const element = await started({ values: '{"knobA": 12.5}' })
    const button = part(element, 'button.reset') as HTMLButtonElement
    expect(idle(button)).toBe(true)
    move(control(element, 'knobB'), '0.4', 'input')
    await nextTick()
    expect(idle(button)).toBe(false)
    button.click()
    await nextTick()
    expect(control(element, 'knobB').value).toBe('1')
    expect(idle(button)).toBe(true)
    // a press with nothing to reset does nothing, also where the run the panel
    // holds grids over another knob than the one a reset would grid over
    vi.useFakeTimers()
    element.setAttribute('values', '{"knobA": 25}')
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    expect(simulations().at(-1)?.grid).toEqual({ knobA: 2 })
    expect(idle(button)).toBe(true)
    const runs = simulations().length
    button.click()
    await vi.advanceTimersByTimeAsync(500)
    expect(simulations()).toHaveLength(runs)
    vi.useRealTimers()
    // a panel whose host owns every knob resets its scale and nothing else
    const owned = await started({ values: '{"knobA": 12.5, "knobB": 1}' })
    const scale = part(owned, '.toggle input') as HTMLInputElement
    const ownButton = part(owned, 'button.reset') as HTMLButtonElement
    expect(idle(ownButton)).toBe(true)
    scale.checked = true
    scale.dispatchEvent(new Event('change'))
    await nextTick()
    expect(idle(ownButton)).toBe(false)
    ownButton.click()
    await nextTick()
    expect(scale.checked).toBe(false)
    expect(idle(ownButton)).toBe(true)
    // a frozen panel is the one where the reset is dead
    owned.freeze()
    await nextTick()
    expect(ownButton.disabled).toBe(true)
  })
})

describe('the measure of the text', () => {
  /** What the stub of canvas was asked: the fonts it was set to and the texts it measured. */
  interface Canvas {
    /** The shorthands its font was set to, in their order. */
    fonts: string[]
    /** How much wider than the table its text is, which a test changes. */
    factor: number
  }

  /**
   * Give the page a canvas whose texts are `factor` times as wide as the table.
   *
   * happy-dom has no canvas, so this is the one a browser would have; its font
   * is the shorthand it was last set to, as a browser keeps it.
   */
  function canvas(): Canvas {
    const state: Canvas = { fonts: [], factor: 1.5 }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => {
      let font = '10px sans-serif'
      return {
        get font(): string {
          return font
        },
        set font(value: string) {
          font = value
          state.fonts.push(value)
        },
        measureText: (text: string) => ({
          width: tableMeasure(text, Number(/(\d+)px/.exec(font)?.[1] ?? 10)) * state.factor,
        }),
      }
    }) as never)
    return state
  }

  /** A font set of the page whose font of the figure arrives when a test says so. */
  interface Fonts {
    /** Let the font arrive. */
    arrive: () => void
    /** The font set, which also dispatches the events a page does. */
    set: EventTarget
  }

  /** Give the document a font set whose font is still loading. */
  function loading(): Fonts {
    let arrive: () => void = () => undefined
    const set = new EventTarget()
    const loaded = new Promise<unknown[]>((resolve) => {
      arrive = () => {
        resolve([{ family: 'Inter' }])
      }
    })
    Object.assign(set, { check: () => false, load: () => loaded })
    Object.defineProperty(document, 'fonts', { configurable: true, value: set })
    return {
      arrive: () => {
        arrive()
      },
      set,
    }
  }

  afterEach(() => {
    Reflect.deleteProperty(document, 'fonts')
  })

  it('lays the figure out with canvas in the font of the panel', async () => {
    const plain = figure(await started())
    document.body.innerHTML = ''
    const state = canvas()
    const element = await started()
    await settled()
    // the figure is laid out with the widths canvas gives in the font the
    // panel resolved, which is not the figure of the table
    expect(figure(element)).not.toBe(plain)
    expect(state.fonts.length).toBeGreaterThan(0)
    const family = getComputedStyle(part(element, '.panel')).fontFamily
    expect(family).not.toBe('')
    for (const font of state.fonts) {
      expect(font.endsWith(`px ${family.replace(/\s+/g, ' ').trim()}`)).toBe(true)
    }
  })

  it('lays the figure out again once when its font arrives and not on a font event', async () => {
    const state = canvas()
    const fonts = loading()
    const element = await started()
    await settled()
    const drawn = vi.mocked(plotSvg).mock.calls.length
    const before = figure(element)
    // the font arrives, and it is wider than the one the browser drew meanwhile
    state.factor = 2
    fonts.arrive()
    await settled()
    expect(vi.mocked(plotSvg).mock.calls.length).toBe(drawn + 1)
    expect(figure(element)).not.toBe(before)
    // the page loads other fonts, and the figure is not laid out for them
    fonts.set.dispatchEvent(new Event('loadingdone'))
    fonts.set.dispatchEvent(new Event('loading'))
    await settled()
    expect(vi.mocked(plotSvg).mock.calls.length).toBe(drawn + 1)
  })

  it('lays the figure out in the sizes a host sets the font of the figure to', async () => {
    // a host which sets the size tokens gets a figure laid out in them and
    // carrying them as the fallbacks of its tokens, so a copy of it keeps them
    const container = branded({
      '--sbmlsim-font-size': '16px',
      '--sbmlsim-font-size-small': '14px',
    })
    const element = await started({}, container)
    await settled()
    expect(figure(element)).toContain('font-size:var(--sbmlsim-font-size, 16px)')
    expect(figure(element)).toContain('font-size:var(--sbmlsim-font-size-small, 14px)')
    const plain = await started()
    await settled()
    expect(figure(plain)).toContain('font-size:var(--sbmlsim-font-size, 12px)')
    expect(figure(plain)).toContain('font-size:var(--sbmlsim-font-size-small, 11px)')
  })

  it('sizes the box of the readout by its rows as they are measured', async () => {
    // the labels of the readout are measured in the font of the panel and its
    // values in the mono font, so a wide font gets a box as wide as its rows
    // and a label which is not cut
    const widths: number[] = []
    for (const factor of [1, 1.6]) {
      document.body.innerHTML = ''
      vi.restoreAllMocks()
      const state = canvas()
      state.factor = factor
      const element = await started()
      await settled()
      const box = laidOut(element)
      await hover(element, { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 })
      const wide = (text: string): number => tableMeasure(text, 11) * factor
      const rows = readoutRows(element).map(
        ([label = '', value = '']) => 8 + 6 + wide(label) + wide(value) + 8,
      )
      const wanted = (6 + 1) * 2 + Math.max(wide(textOf(element, '.readout-time')), ...rows)
      expect(readoutBox(element).width).toBeCloseTo(Math.min(wanted, box.x1 - box.x0), 6)
      widths.push(readoutBox(element).width)
    }
    expect(widths[1] ?? 0).toBeGreaterThan(widths[0] ?? 0)
  })

  it('leaves a font which is there already to the first layout', async () => {
    canvas()
    const load = vi.fn(() => Promise.resolve([]))
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { check: () => true, load },
    })
    await started()
    await settled()
    expect(load).not.toHaveBeenCalled()
  })
})

describe('the legend of the study data', () => {
  /** A label two of which do not fit one row of the band of the figure. */
  const LONG = 'Study A 2013, a single oral dose of the drug in healthy volunteers'

  /** Serve a declaration of the series given and study data for every one of them. */
  function serve(series: Partial<PanelDataDeclaration>[]): void {
    const declared = series.map((more) => declaredData(more))
    served.panel = () => Promise.resolve({ ...declaration(), data: declared })
    served.data = () =>
      Promise.resolve({
        contract: 'paneldata/1',
        series: declared.map((one) => ({
          id: one.id,
          label: one.label,
          x: [0, 1, 2],
          y: [0.1, 0.9, 1.9],
          yerr: [null, null, null],
          x_unit: 'h',
          unit: 'uM',
          count: null,
        })),
      } satisfies PanelDataResponse)
  }

  /** Start a panel of the series given and read its plot box. */
  async function boxOf(series: Partial<PanelDataDeclaration>[]): Promise<Box> {
    document.body.innerHTML = ''
    serve(series)
    const element = await started()
    await settled()
    return laidOut(element)
  }

  it('reserves the room of the largest legend one state of the knobs draws', async () => {
    // two arms of one study, each measured at a dose of its own: a state of
    // the knobs draws one of them, so the panel keeps the room of one and not
    // of both, which no state draws
    const arms = await boxOf([
      { id: 'armA', label: LONG, at: { knobA: 12.5 } },
      { id: 'armB', label: LONG, at: { knobA: 25 } },
    ])
    const one = await boxOf([{ id: 'armB', label: LONG, at: { knobA: 25 } }])
    expect(arms).toEqual(one)
    // and both arms at once is a figure of less plot
    const both = await boxOf([
      { id: 'armA', label: LONG, at: null },
      { id: 'armB', label: LONG, at: null },
    ])
    expect(both.y1).toBeLessThan(arms.y1)
  })

  it('reserves the series of two knobs which a state draws together', async () => {
    // the series of two knobs are drawn together where both knobs are at their
    // values, so that state keeps the room of both
    const apart = await boxOf([
      { id: 'seriesA', label: LONG, at: { knobA: 12.5 } },
      { id: 'seriesB', label: LONG, at: { knobB: 0.2 } },
    ])
    const together = await boxOf([
      { id: 'seriesA', label: LONG, at: null },
      { id: 'seriesB', label: LONG, at: null },
    ])
    expect(apart).toEqual(together)
  })
})

describe('the named stops of a range knob', () => {
  /** The stops of the range knob, the values of the grid it runs over. */
  const STOPS = [
    { label: 'full', value: 1 },
    { label: 'middle', value: 0.6 },
    { label: 'low', value: 0.2 },
  ]

  /** The declaration with the stops on its range knob. */
  function stopped(): PanelDeclaration {
    const declared = declaration()
    return {
      ...declared,
      axes: declared.axes.map((one) => (one.id === 'knobB' ? { ...one, choices: STOPS } : one)),
    }
  }

  /** Get the select of the stops of the range knob. */
  function stops(element: PanelElement): HTMLSelectElement {
    const found = shadow(element).querySelector('#knob-knobB-stops')
    if (!(found instanceof HTMLSelectElement)) {
      throw new Error('the range knob has no select of its stops')
    }
    return found
  }

  it('draws a select of its stops above its slider, under one label which names both', async () => {
    served.panel = () => Promise.resolve(stopped())
    const element = await started()
    const knob = control(element, 'knobB').closest('.knob')
    expect(knob?.querySelectorAll('label')).toHaveLength(1)
    const label = knob?.querySelector('label')
    // the visible label names the slider, and the select by the label and the
    // words after it, so a screen reader names both and tells them apart
    expect(label?.getAttribute('for')).toBe('knob-knobB')
    const named = stops(element).getAttribute('aria-labelledby')?.split(' ') ?? []
    expect(named[0]).toBe(label?.id)
    expect(shadow(element).getElementById(named[1] ?? '')?.textContent).toBe('named value')
    // the select comes before the slider, which is above it in the column of the knob
    const order = [...(knob?.querySelectorAll('select, input') ?? [])].map((one) => one.id)
    expect(order).toEqual(['knob-knobB-stops', 'knob-knobB'])
    expect([...stops(element).options].map((one) => one.textContent.trim())).toEqual([
      'full',
      'middle',
      'low',
    ])
    expect(stops(element).value).toBe('1')
  })

  it('moves the slider to a stop a reader picks and draws the panel there', async () => {
    served.panel = () => Promise.resolve(stopped())
    const element = await started()
    const before = figure(element)
    move(stops(element), '0.6', 'change')
    await nextTick()
    expect(control(element, 'knobB').value).toBe('0.6')
    expect(textOf(element, '.knob-value')).toBe('0.6')
    expect(stops(element).value).toBe('0.6')
    expect(figure(element)).not.toBe(before)
    // the grid of the run covers the knob, so the stop is read out of it
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(simulations()).toHaveLength(1)
  })

  it('shows the stop a slider is moved onto, and an entry which cannot be picked off them', async () => {
    served.panel = () => Promise.resolve(stopped())
    const element = await started()
    move(control(element, 'knobB'), '0.4', 'input')
    await nextTick()
    expect(stops(element).value).toBe('custom')
    expect(control(element, 'knobB').getAttribute('aria-valuetext')).toBeNull()
    const custom = [...stops(element).options].find((one) => one.value === 'custom')
    expect(custom?.textContent.trim()).toBe('custom')
    expect(custom?.disabled).toBe(true)
    move(control(element, 'knobB'), '0.2', 'input')
    await nextTick()
    expect(stops(element).value).toBe('0.2')
    // the slider says the stop it is at to a screen reader, and nothing more off one
    expect(control(element, 'knobB').getAttribute('aria-valuetext')).toBe('0.2, low')
    // the entry is there only while the value is no stop
    expect([...stops(element).options].map((one) => one.value)).toEqual(['1', '0.6', '0.2'])
  })

  it('draws a range knob without stops as it always did', async () => {
    const element = await started()
    const knob = control(element, 'knobB').closest('.knob')
    expect(knob?.querySelector('select')).toBeNull()
    expect(knob?.classList.contains('stopped')).toBe(false)
    expect(control(element, 'knobB').getAttribute('aria-labelledby')).toBeNull()
  })
})

describe('the declared ends of the axes', () => {
  /** The declaration with the ends of its axes. */
  function ended(ends: { y_min?: number; y_max?: number; x_max?: number }): PanelDeclaration {
    const declared = declaration()
    return { ...declared, panel: { ...declared.panel, ...ends } }
  }

  /** Get the axes of the figure: both axis lines and every tick, which are where it is laid out. */
  function axes(element: PanelElement): string {
    const drawn = figure(element)
    return drawn.split('<g class="data"')[0] ?? ''
  }

  it('draws the value axis between the ends a panel declares, whatever its knobs are at', async () => {
    served.panel = () => Promise.resolve(ended({ y_min: 0, y_max: 100 }))
    // a run over the choice knob answers ten times the curves of a run over
    // the range knob, which the frame of either answer follows
    served.simulate = (body) =>
      Promise.resolve(
        Object.keys(body.grid ?? {})[0] === 'knobA'
          ? run(
              'knobA',
              CHOICES.map((value) => [0, value, 2 * value]),
            )
          : run(),
      )
    const element = await started()
    const drawn = axes(element)
    expect(drawn).toContain('>100<')
    expect(drawn).toContain('>0<')
    // the gridded knob moves the curve inside the axis
    const before = figure(element)
    move(control(element, 'knobB'), '0.2', 'input')
    await nextTick()
    expect(figure(element)).not.toBe(before)
    expect(axes(element)).toBe(drawn)
    // a knob the grid does not cover runs again, an answer of another frame
    move(control(element, 'knobA'), '12.5', 'change')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await nextTick()
    expect(simulations()).toHaveLength(2)
    expect(axes(element)).toBe(drawn)
  })

  it('frames the value axis of its answer where it declares no end', async () => {
    served.simulate = (body) =>
      Promise.resolve(
        Object.keys(body.grid ?? {})[0] === 'knobA'
          ? run(
              'knobA',
              CHOICES.map((value) => [0, value, 2 * value]),
            )
          : run(),
      )
    const element = await started()
    const drawn = axes(element)
    move(control(element, 'knobA'), '12.5', 'change')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await nextTick()
    expect(axes(element)).not.toBe(drawn)
  })

  it('ends the time axis at the end a panel declares', async () => {
    served.panel = () => Promise.resolve(ended({ x_max: 1.5 }))
    const element = await started()
    const xAxis = (figure(element).split('<g class="axis x"')[1] ?? '').split(
      '<g class="axis y"',
    )[0]
    const labels = [
      ...(xAxis ?? '').matchAll(/<g class="tick">.*?<text[^>]*>([^<]*)<\/text>/g),
    ].map((one) => one[1])
    // the answer runs to 2 and the axis ends at 1.5, its ticks inside
    const ticks = labels.map(Number)
    expect(Math.max(...ticks)).toBeLessThanOrEqual(1.5)
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(1.4)
  })
})

describe('the knobs of a panel', () => {
  /** A declaration of eight knobs, the most the endpoint states, the first of which sets no entity. */
  function eight(): PanelDeclaration {
    const declared = declaration()
    const choice = declared.axes[0]
    if (choice === undefined) {
      throw new Error('the declaration has no choice knob')
    }
    return {
      ...declared,
      axes: [
        // a knob the derived values of the simulation read, which sets no entity
        { ...knob(), target: null },
        ...Array.from({ length: 7 }, (_, index) => ({
          ...choice,
          id: `knob${String(index)}`,
          label: `knob ${String(index)}`,
          target: `target${String(index)}`,
        })),
      ],
    }
  }

  it('draws and sends the eight knobs the endpoint takes, one without a target among them', async () => {
    vi.useFakeTimers()
    served.panel = () => Promise.resolve(eight())
    const element = await started()
    expect(shadow(element).querySelectorAll('.knob')).toHaveLength(8)
    expect(simulations()[0]).toEqual({
      values: Object.fromEntries(
        Array.from({ length: 7 }, (_, index) => [`knob${String(index)}`, 25]),
      ),
      grid: { knobB: 3 },
    })
    // the knob without a target is moved and read as any other
    move(control(element, 'knobB'), '0.2', 'change')
    move(control(element, 'knob6'), '12.5', 'change')
    await vi.advanceTimersByTimeAsync(500)
    // the release of the choice knob is one run over it, at the value of the other
    expect(simulations().at(-1)?.values).toMatchObject({ knobB: 0.2 })
    expect(simulations().at(-1)?.grid).toEqual({ knob6: 2 })
  })
})

describe('the names a reader of the panel is given', () => {
  it('names the group of the controls after the panel, so the panels of an app are told apart', async () => {
    const element = await started()
    const group = part(element, '[role="group"]')
    const named = group.getAttribute('aria-labelledby') ?? ''
    expect(named).not.toBe('')
    expect(group.hasAttribute('aria-label')).toBe(false)
    expect(textOf(element, `#${named}`)).toBe('Panel A')
  })

  it('appends the unit of the run to the label of the time axis, as to the one of the value axis', async () => {
    served.panel = () => {
      const declared = declaration()
      return Promise.resolve({ ...declared, panel: { ...declared.panel, x_label: 'elapsed' } })
    }
    const element = await started()
    expect(figure(element)).toContain('>elapsed [h]</text>')
  })
})
