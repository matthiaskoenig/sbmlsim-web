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

// The element runs in a dom, which is `happy-dom` for this file alone: every
// other test file of this library is pure and keeps running in node. Nothing
// here reaches the network, `fetch` and `ResizeObserver` are stubs, and every
// id below is a neutral one: a model, a panel, a knob and a curve are data of
// a payload and never of this library.

/** The element as a page uses it: its three methods on an `HTMLElement`. */
interface PanelElement extends HTMLElement {
  /** Read the declaration and draw the first figure. */
  activate(): Promise<void>
  /** Stop every pending request and freeze the knobs. */
  freeze(): void
  /** Put every knob back to the value its declaration states. */
  reset(): void
}

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
      x_label: 'time [h]',
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
    simulation: { variant: null, end: 120, points: 2, x_unit: 'h', preinit: {} },
    limits: { end: 10000, points: 2000, knobs: 4, grid: 64, curves: 16 },
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
    conversion: null,
    unit: null,
    ...more,
  }
}

/** A declaration which carries study data under its first curve. */
function withData(more: Partial<PanelDataDeclaration> = {}): PanelDeclaration {
  return { ...declaration(), data: [declaredData(more)] }
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
  panel: Route
  simulate: (body: SimulateRequest) => Promise<unknown>
  data: Route
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
  return calls.filter((one) => one.url.endsWith('/panels/panelA'))
}

/** The requests of the study data the element made. */
function dataCalls(): Call[] {
  return calls.filter((one) => one.url.endsWith('/data'))
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
  return shadow(element).querySelector('.figure-svg')?.innerHTML ?? ''
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
  const element = document.createElement(PANEL_TAG) as PanelElement
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
    if (url.endsWith('/simulate')) {
      return served.simulate(body ?? {}).then(json)
    }
    if (url.endsWith('/data')) {
      return served.data().then(json)
    }
    if (url.includes('/panels/')) {
      return served.panel().then(json)
    }
    return served.stored().then(json)
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
    // axis, so its readout stays a bare number next to a narrow slider
    expect(textOf(element, 'label[for="knob-knobB"]')).toBe('knob B [dimensionless]')
    expect(textOf(element, 'label[for="knob-knobA"]')).toBe('knob A')
  })

  it('shows the provenance footer with the engine, the hash and the seconds', async () => {
    const element = await started()
    const footer = textOf(element, '.provenance')
    expect(footer).toContain('engineA')
    expect(footer).toContain(HASH.slice(0, 8))
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

  it('follows prefers-color-scheme and lets a host override one token', async () => {
    const element = await started({ theme: 'dark' })
    // the quotes of an attribute selector are optional and a minifier drops
    // them, so the assertions below read the selectors without them
    const styles = [...shadow(element).querySelectorAll('style')]
      .map((one) => one.textContent)
      .join('\n')
      .replace(/'/g, '')
    expect(styles).toContain(':host')
    expect(styles).toContain('@media (prefers-color-scheme: dark)')
    expect(styles).toContain(':host(:not([theme=light]))')
    expect(styles).toContain(':host([theme=dark])')
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
    const outside = await started()
    expect(getComputedStyle(part(outside, '.panel')).color).toBe('rgb(27 31 36)')
  })

  it('keeps a rule of the page which matches the element out of the panel', async () => {
    // a declaration of the page beats one of the shadow tree on the host, so
    // a panel which carried its typography there would hand the page every
    // element in it by inheritance
    document.head.innerHTML = '<style>* { font-family: cursive; color: rgb(255 0 0); }</style>'
    const element = await started()
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
  it('shows the stored result, an error and frozen controls when the endpoint is unreachable', async () => {
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
    expect(shadow(element).querySelector('.panel')?.className).toContain('frozen')
    expect(seen.map((one) => one.kind)).toEqual(['network'])
  })

  it('freezes every control when a simulation fails', async () => {
    served.simulate = unreachable
    const element = await started()
    expect(control(element, 'knobA').disabled).toBe(true)
    expect(control(element, 'knobB').disabled).toBe(true)
    // the frozen controls are drawn as dead, so none of them may still work
    for (const one of shadow(element).querySelectorAll('input, select, button')) {
      expect(one.getAttribute('disabled')).not.toBeNull()
    }
    expect(textOf(element, '.error')).not.toBe('')
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
    expect(shadow(element).querySelector('[tabindex]')).toBeNull()
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
})

describe('the variant of the model', () => {
  it('is left out of the request without the attribute and sent with it', async () => {
    await started()
    expect(simulations()[0]).not.toHaveProperty('variant')
    await started({ variant: 'variantA' })
    expect(simulations()[1]?.variant).toBe('variantA')
  })

  it('runs the simulation again when it changes, without reading the declaration again', async () => {
    vi.useFakeTimers()
    const element = await started({ variant: 'variantA' })
    expect(simulations()).toHaveLength(1)
    element.setAttribute('variant', 'variantB')
    await vi.advanceTimersByTimeAsync(500)
    expect(simulations().map((one) => one.variant)).toEqual(['variantA', 'variantB'])
    expect(declarations()).toHaveLength(1)
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
