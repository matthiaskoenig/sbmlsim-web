<script setup lang="ts">
/*
 * `<sbmlsim-panel>`: one interactive panel of a model in any HTML page.
 *
 * The element is a custom element with a shadow root, so the styles of the
 * page it sits in - a documentation theme, a slide deck, a course - cannot
 * reach the panel and the panel cannot leak into the page. The `--sbmlsim-*`
 * tokens are the one hook from outside: `theme.css` reads every one of them
 * into a private token of the panel, which `.panel` re-exports under its
 * public name inside the shadow root, so a token set on the element or on
 * anything above it wins over the table of the design (the head of
 * `theme.css` has the order). Nothing of the typography and nothing of the
 * colour is declared on `:host` for the same reason the tokens are not: a
 * declaration of the page which matches the element itself, `* { color: red }`
 * among them, beats a declaration of the shadow tree on the host, and
 * everything in the panel would inherit it.
 *
 * ## One request per release, never one per movement
 *
 * This is the whole performance story of the element and the reason the
 * endpoint answers a grid instead of a point.
 *
 * A request grids over at most one knob. On `activate()` the element asks for
 * a grid over the first `range` knob of the declaration at its declared
 * `steps` (the first knob of any kind for a panel without a range knob), with
 * every other knob at its default. While that gridded knob moves, every
 * movement is read out of the grid locally (`interpolate`) and nothing is
 * fetched: five moves of it are no request at all. Moving any other knob
 * schedules one simulation on release, which grids over **that** knob instead
 * and holds the one which was gridded before at the value it now has, so the
 * knob a reader is working with is always the one which costs nothing. The
 * knob which counts as the gridded one is the one the simulation which is
 * scheduled or in flight grids over and not the one the last answer gridded
 * over: a knob released while a simulation is on its way is a knob no grid
 * covers yet, and dropping its release would leave the figure contradicting
 * the control.
 *
 * An `input` event - a knob being dragged - interpolates and redraws and never
 * fetches. A `change` event - the knob released, a choice picked - schedules a
 * simulation after `DEBOUNCE`, and a scheduled simulation which is superseded
 * is cancelled rather than raced: the timer is cleared, the request in flight
 * is aborted, and the answer of a request which is no longer the latest one is
 * dropped.
 *
 * ## Nothing rejects into the page
 *
 * Every failure - a dead network, a slow endpoint, a refused request, a
 * payload of another contract version, a body which cannot be read - is caught
 * inside the element. It is retried once where retrying can help, and then the
 * element shows the stored result if it has one, freezes the knobs, writes one
 * line a reader can act on and dispatches `sbmlsim-error` so that the page can
 * react. `activate()` resolves either way and never rejects.
 *
 * The stored result (`fallback`) is a file next to the page and is therefore
 * fetched on `activate()` alongside the declaration and not when a request
 * fails: an endpoint which cannot be reached cannot serve the fallback either.
 */

import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  useHost,
  useTemplateRef,
  watch,
} from 'vue'
import type { PropType } from 'vue'

import {
  DEFAULT_TIMEOUT,
  FAILURE_MESSAGES,
  PanelClient,
  PanelRequestError,
  failureKind,
} from './client'
import type { FailureKind } from './client'
import type {
  CurveScale,
  PanelAxis,
  PanelCurve,
  PanelDeclaration,
  SimulateRequest,
  SimulateResponse,
} from './contract'
import { interpolate } from './interpolate'
import { plotSvg } from './plot'
import type { PlotSpec, Series } from './plot'

/** How the controls are placed next to the figure. */
type LayoutName = 'auto' | 'sidebar' | 'stacked' | 'toolbar'

/** The layout which is drawn, which `auto` resolves to by the room it has. */
type DrawnLayout = Exclude<LayoutName, 'auto'>

/** Which values of the design tokens the element asks for. */
type ThemeName = 'auto' | 'light' | 'dark'

/** One curve as it is drawn: the declaration of a curve, resolved against a run. */
interface DrawnCurve {
  /** The id of the curve, the key of its values in the grid. */
  id: string
  /** Its entry in the legend. */
  label: string
  /** The unit its values are delivered in, `null` for values which carry none. */
  unit: string | null
  /** The scale it declares. */
  scale: CurveScale
}

/** The pixels of available width from which the controls go beside the figure. */
const SIDEBAR_FROM = 560
/** The width of the column of the controls of the `sidebar` layout, in pixels. */
const CONTROLS_WIDTH = 200
/** The gap between the controls and the figure, in pixels. */
const COLUMN_GAP = 16
/** The width a figure falls back to before anything has been measured. */
const DEFAULT_WIDTH = 480
/** The smallest figure which is drawn whatever the room, in pixels. */
const MIN_FIGURE_WIDTH = 220
/** The height of a figure as a share of its width. */
const ASPECT = 0.6
/** The smallest height of a figure, in pixels. */
const MIN_HEIGHT = 200
/** The largest height of a figure, in pixels. */
const MAX_HEIGHT = 420
/** The milliseconds a released knob waits before its simulation is sent. */
const DEBOUNCE = 120
/** How often one request is tried: the first try and one retry. */
const ATTEMPTS = 2
/** The kinds of failure a retry can help with; the others are retried never. */
const RETRIED: ReadonlySet<FailureKind> = new Set<FailureKind>(['network', 'timeout'])
/** The characters of the spec hash the provenance footer shows. */
const HASH_SHOWN = 8
/** The significant digits the value of a knob is shown with. */
const KNOB_DIGITS = 4
/** The significant digits the seconds of the provenance footer are shown with. */
const SECOND_DIGITS = 2
/** The steps a range knob moves in, which is finer than the grid it reads. */
const RANGE_STEPS = 100
/** How far from a whole number of steps a value may lie and still be on a ladder. */
const ON_LADDER = 1e-6
/**
 * The level the title of a panel is drawn at unless a page asks for another.
 *
 * `defineProps` is hoisted above the body of the script and may not read a
 * constant of it, which is why the prop writes the number once more.
 */
const DEFAULT_HEADING = 2
/** The smallest level a heading of HTML has. */
const LEAST_HEADING = 1
/** The largest level a heading of HTML has. */
const MOST_HEADING = 6
/**
 * The label of the y axis of a figure of more than one curve, which names none.
 *
 * It is the name a reader who does not see the figure is given for the axis,
 * so it has to be a word; should `panel/1` ever carry a label for the y axis,
 * that label is the one to use and this is its fallback.
 */
const GENERIC_Y = 'value'
/** The separator of the parts of the provenance footer. */
const FOOTER_SEPARATOR = ' · '

const props = defineProps({
  /** The endpoint of the service, e.g. `https://models.example.org`; empty is the origin of the page. */
  endpoint: { type: String, default: '' },
  /** The id of the model, as the endpoint serves it. */
  model: { type: String, default: '' },
  /** The id of the panel of that model. */
  panel: { type: String, default: '' },
  /** Where the controls go: `auto` (the default), `sidebar`, `stacked` or `toolbar`. */
  layout: { type: String as PropType<LayoutName>, default: 'auto' },
  /**
   * Which values of the tokens are used: `auto` (the default), `light` or
   * `dark`. It is read by the style of the element and not by its script: the
   * attribute stays on the host, where `theme.css` matches it.
   */
  theme: { type: String as PropType<ThemeName>, default: 'auto' },
  /** The url of a stored answer of a run, drawn when the endpoint does not answer. */
  fallback: { type: String, default: '' },
  /** The milliseconds one request is given before it is stopped. */
  timeout: { type: Number, default: DEFAULT_TIMEOUT },
  /**
   * The level the title of the panel is drawn at, 2 by default. A page which
   * puts a panel under a heading of its own writes the level below it, so the
   * outline of the document does not step.
   */
  headingLevel: { type: Number, default: 2 },
})

const host = useHost()
const root = useTemplateRef<HTMLElement>('root')

/** Whether `activate()` has run, which is what makes the element draw anything. */
const active = ref(false)
/** Whether a request is in flight, which the figure says with `aria-busy`. */
const pending = ref(false)
/** Whether the knobs are frozen, after a failure or after `freeze()`. */
const frozen = ref(false)
/** What failed, `null` while nothing has. */
const failure = ref<FailureKind | null>(null)
/**
 * The declaration of the panel, `null` until it was read.
 *
 * The payloads are held in shallow refs: they carry the arrays of a run, which
 * are read and never written, so a deep reactive proxy over every row of every
 * curve would be paid for nothing.
 */
const declaration = shallowRef<PanelDeclaration | null>(null)
/** The grid which is drawn, `null` until a run or the stored answer arrived. */
const grid = shallowRef<SimulateResponse | null>(null)
/** The stored answer of the `fallback`, `null` without one or until it arrived. */
const stored = shallowRef<SimulateResponse | null>(null)
/** Whether what is drawn is the stored answer and not a run of the endpoint. */
const fromStore = ref(false)
/** The value of every knob by its id, in the unit of the knob. */
const values = shallowRef<Record<string, number>>({})
/**
 * The id of the knob the latest run grids over, `null` for a run of one point.
 *
 * It is set when a run is scheduled or issued and not when its answer arrives:
 * a knob released while a run is in flight would otherwise be taken for one
 * the grid already covers, no run would be made for it, and the figure would
 * keep contradicting the control a reader just moved.
 */
const gridded = ref<string | null>(null)
/** Whether the y axis is drawn logarithmically. */
const logY = ref(false)
/** The width of the element as it was last measured, 0 before any measurement. */
const measured = ref(0)

/** The client of the endpoint, built once per `activate()`. */
let client: PanelClient | null = null
/** Whether `activate()` has already started the panel; a second call only lifts a freeze. */
let started = false
/** The sequence of the latest request; an answer of another one is dropped. */
let sequence = 0
/** The request in flight, aborted when it is superseded or when the panel is frozen. */
let flight: AbortController | null = null
/** The scheduled simulation, cleared when it is superseded. */
let timer: ReturnType<typeof setTimeout> | null = null
/** The observer of the width of the element, `null` where there is none. */
let observer: ResizeObserver | null = null
/** Whether the element listens to the resizes of the window instead. */
let listening = false

/**
 * Keep a value between two bounds.
 *
 * @param value the value
 * @param low the lower bound
 * @param high the upper bound
 * @returns the value, or the bound it passed
 */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * Write a number of a label without the digits nobody reads.
 *
 * @param value the number
 * @param digits the significant digits it keeps
 * @returns it as short text, empty for a value which is no finite number
 */
function shortNumber(value: number, digits: number): string {
  return Number.isFinite(value) ? String(Number(value.toPrecision(digits))) : ''
}

/**
 * Get whether a value of a payload carries the fields a field names.
 *
 * @param value the value
 * @param strings the fields which have to be text
 * @returns whether it is an object carrying every one of them
 */
function carries(value: unknown, strings: string[]): boolean {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const fields = value as Record<string, unknown>
  return strings.every((name) => typeof fields[name] === 'string')
}

/**
 * Get the knobs of a declaration which can be drawn as a control.
 *
 * The guard of the client refuses a declaration whose knobs are not objects
 * with an id, so this is the second lock of that door: a panel draws no
 * control it cannot build, and a hole in the guard therefore costs a knob and
 * never the element, which has an error line to show.
 *
 * @param declared the declaration, `null` until it was read
 * @returns the knobs which can be drawn, in the order of the declaration
 */
function knobsOf(declared: PanelDeclaration | null): PanelAxis[] {
  const given: unknown[] = declared?.axes ?? []
  return given.filter(
    (one): one is PanelAxis =>
      carries(one, ['id', 'label', 'kind']) &&
      Array.isArray((one as PanelAxis).choices) &&
      typeof (one as PanelAxis).default === 'number',
  )
}

/**
 * Get the curves of a declaration which can be drawn.
 *
 * @param declared the declaration, `null` until it was read
 * @returns the curves which can be drawn, in the order of the declaration
 */
function curvesOf(declared: PanelDeclaration | null): PanelCurve[] {
  const given: unknown[] = declared?.curves ?? []
  return given.filter((one): one is PanelCurve => carries(one, ['id', 'label']))
}

/** The knobs of the panel in the order the declaration states them. */
const axes = computed<PanelAxis[]>(() => knobsOf(declaration.value))

/** The title of the panel, empty until the declaration was read. */
const title = computed<string>(() => declaration.value?.panel.title ?? '')

/** The question the panel answers, empty for a panel without one. */
const subtitle = computed<string>(() => declaration.value?.panel.subtitle ?? '')

/** The heading the title is drawn as, `h2` unless the page asks for another. */
const headingTag = computed<string>(() => {
  const asked = Math.round(props.headingLevel)
  const level = Number.isFinite(asked) ? clamp(asked, LEAST_HEADING, MOST_HEADING) : DEFAULT_HEADING
  return `h${String(level)}`
})

/** The width the element has, the default before anything was measured. */
const available = computed<number>(() => (measured.value > 0 ? measured.value : DEFAULT_WIDTH))

/**
 * The layout which is drawn: the one the attribute asks for, or the one the
 * room allows.
 *
 * A panel without a knob - a panel which declares none, and the stored answer
 * of one whose declaration never arrived - has nothing to put beside its
 * figure, so it takes the toolbar whatever was asked for.
 */
const drawnLayout = computed<DrawnLayout>(() => {
  if (axes.value.length === 0) {
    return 'toolbar'
  }
  const asked = props.layout
  if (asked === 'sidebar' || asked === 'stacked' || asked === 'toolbar') {
    return asked
  }
  return available.value >= SIDEBAR_FROM ? 'sidebar' : 'stacked'
})

/** The width of the figure in pixels, the room which is left next to the controls. */
const figureWidth = computed<number>(() => {
  const room =
    drawnLayout.value === 'sidebar'
      ? available.value - CONTROLS_WIDTH - COLUMN_GAP
      : available.value
  return Math.max(MIN_FIGURE_WIDTH, Math.round(room))
})

/** The height of the figure in pixels, its width in the aspect of the design. */
const figureHeight = computed<number>(() =>
  Math.round(clamp(figureWidth.value * ASPECT, MIN_HEIGHT, MAX_HEIGHT)),
)

/**
 * Get the unit a curve is delivered in.
 *
 * The `units` of the run win over the declaration: they are what the endpoint
 * resolved and therefore what the numbers actually are.
 *
 * @param id the id of the curve
 * @param declared the unit the declaration states, `null` for none
 * @returns the unit, `null` for values which carry none
 */
function unitOf(id: string, declared: string | null): string | null {
  return grid.value?.units[id] ?? declared
}

/** The curves which are drawn: the declared ones, or the ones a stored answer carries. */
const drawnCurves = computed<DrawnCurve[]>(() => {
  const declared = curvesOf(declaration.value)
  if (declared.length > 0) {
    return declared.map((one) => ({
      id: one.id,
      label: one.label,
      unit: unitOf(one.id, one.unit),
      scale: one.scale,
    }))
  }
  const answer = grid.value
  if (answer === null) {
    return []
  }
  return Object.keys(answer.curves).map((id): DrawnCurve => ({
    id,
    label: id,
    unit: unitOf(id, null),
    scale: 'linear',
  }))
})

/** The label of the time axis, the one the panel declares or the unit of the run. */
const xLabel = computed<string>(() => {
  const declared = declaration.value?.panel.x_label
  if (declared !== undefined && declared !== '') {
    return declared
  }
  const unit = grid.value?.units.x
  return unit === undefined || unit === null || unit === '' ? 'time' : `time [${unit}]`
})

/**
 * The label of the y axis.
 *
 * A panel declares no label for it, so one curve lends the axis its own and
 * several curves, whose names are in the legend, take `GENERIC_Y`; the
 * renderer appends the unit the curves share in either case, and the label is
 * the name a reader who does not see the figure is given for it, so an empty
 * one is no option.
 */
const yLabel = computed<string>(() => {
  const drawn = drawnCurves.value
  const only = drawn.length === 1 ? drawn[0]?.label : undefined
  return only === undefined || only === '' ? GENERIC_Y : only
})

/** The figure as it is drawn now, `null` while there is nothing to draw. */
const plot = computed<PlotSpec | null>(() => {
  const answer = grid.value
  if (answer === null) {
    return null
  }
  const columns = interpolate(answer, values.value)
  const series = drawnCurves.value.map((one): Series => {
    const drawn = {
      id: one.id,
      label: one.label,
      scale: one.scale,
      values: columns[one.id] ?? [],
    }
    return one.unit === null || one.unit === '' ? drawn : { ...drawn, unit: one.unit }
  })
  return {
    x: answer.x,
    xLabel: xLabel.value,
    yLabel: yLabel.value,
    series,
    width: figureWidth.value,
    height: figureHeight.value,
    logY: logY.value,
  }
})

/**
 * The figure as one inline SVG element, empty while there is nothing to draw.
 *
 * A figure which cannot be built is empty and not an exception: the render of
 * the element must not depend on a payload being well formed, or a hole in a
 * guard would take the whole panel down and with it the error line which is
 * the one thing a reader could still be told.
 */
const svg = computed<string>(() => {
  try {
    const spec = plot.value
    return spec === null ? '' : plotSvg(spec)
  } catch {
    return ''
  }
})

/** Whether there is an answer to draw whose figure could not be built. */
const drawFailed = computed<boolean>(() => grid.value !== null && svg.value === '')

/** The line a reader is shown about a failure, empty while nothing failed. */
const errorMessage = computed<string>(() => {
  if (failure.value !== null) {
    return FAILURE_MESSAGES[failure.value]
  }
  return drawFailed.value ? FAILURE_MESSAGES.internal : ''
})

/** The provenance footer: the engine, the short hash of the run and its seconds. */
const footer = computed<string>(() => {
  const answer = grid.value
  if (answer === null) {
    return ''
  }
  const parts = [
    answer.provenance.engine,
    answer.spec_hash.slice(0, HASH_SHOWN),
    `${shortNumber(answer.provenance.seconds, SECOND_DIGITS)} s`,
  ].filter((one) => one !== '' && one !== ' s')
  if (fromStore.value) {
    parts.push('stored')
  }
  return parts.join(FOOTER_SEPARATOR)
})

/**
 * Get the id of a control of a knob, which its label points at.
 *
 * @param axis the knob
 * @returns an id which is unique inside the shadow root of this element
 */
function controlId(axis: PanelAxis): string {
  return `knob-${axis.id}`
}

/**
 * Get the label of a knob.
 *
 * @param axis the knob
 * @returns `<label> [<unit>]` for a range knob, whose readout is a bare
 *   number, as sbmlsim labels the axis of a figure; the label alone for a
 *   choice knob, whose choices carry their units themselves
 */
function knobLabel(axis: PanelAxis): string {
  return axis.kind === 'range' && axis.unit !== null && axis.unit !== ''
    ? `${axis.label} [${axis.unit}]`
    : axis.label
}

/**
 * Get the value of a knob as it is shown next to its control.
 *
 * @param axis the knob
 * @returns the value as short text, its unit being part of the label
 */
function shownValue(axis: PanelAxis): string {
  const value = values.value[axis.id]
  return value === undefined ? '' : shortNumber(value, KNOB_DIGITS)
}

/**
 * Get a step of the ladder 1, 2, 5 near a wanted one.
 *
 * @param wanted the step which is wanted, a positive number
 * @returns the step of the ladder closest above it
 */
function niceStep(wanted: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(wanted))
  const share = wanted / magnitude
  return (share <= 1.5 ? 1 : share <= 3 ? 2 : share <= 7 ? 5 : 10) * magnitude
}

/**
 * Get the step a range knob moves in.
 *
 * It is finer than the grid the knob is read from on purpose: the grid is
 * where the simulations are, the knob is where the reader is, and the
 * interpolation between them is what makes a movement cost nothing.
 *
 * The value a knob starts at has to lie on the ladder the step builds, or the
 * browser snaps the control to the nearest value which does and the reader is
 * shown, and told by a screen reader, a number the panel is not simulating. A
 * nice step near a hundredth of the span usually lands on it; where it does
 * not, the distance from the smallest value to the declared one is divided
 * into a whole number of steps of about that size instead.
 *
 * @param axis the knob, of the kind `range`
 * @returns the step, 1 for a knob whose bounds are no span
 */
function rangeStep(axis: PanelAxis): number {
  const low = axis.min ?? 0
  const high = axis.max ?? 0
  const span = high - low
  if (!(span > 0)) {
    return 1
  }
  const nice = niceStep(span / RANGE_STEPS)
  const offset = axis.default - low
  if (!(offset > 0)) {
    return nice
  }
  const steps = offset / nice
  if (Math.abs(steps - Math.round(steps)) <= ON_LADDER) {
    return nice
  }
  return offset / Math.max(1, Math.round(steps))
}

/**
 * Get the points a grid over a knob runs.
 *
 * @param axis the knob
 * @returns the choices of a choice knob and the declared steps of a range
 *   knob, each bounded by the `grid` limit the endpoint states
 */
function gridPoints(axis: PanelAxis): number {
  const limit = declaration.value?.limits.grid ?? 1
  const wanted = axis.kind === 'choice' ? axis.choices.length : axis.steps
  return Math.round(clamp(Number.isFinite(wanted) ? wanted : 1, 1, Math.max(1, limit)))
}

/**
 * Get the knob a run grids over.
 *
 * @param declared the declaration of the panel
 * @returns the id of its first range knob, else of its first knob of any kind,
 *   `null` for a panel without a knob at all
 */
function firstGridded(declared: PanelDeclaration): string | null {
  const knobs = knobsOf(declared)
  const ranged = knobs.find((one) => one.kind === 'range')
  return (ranged ?? knobs[0])?.id ?? null
}

/**
 * Get whether the y axis of a panel starts logarithmic.
 *
 * The axis is one, so it follows the curves only when every one of them asks
 * for it; the toggle is there for every other case.
 *
 * @param declared the declaration of the panel
 * @returns whether the axis starts logarithmic
 */
function initialLog(declared: PanelDeclaration): boolean {
  const curves = curvesOf(declared)
  return curves.length > 0 && curves.every((one) => one.scale === 'log')
}

/**
 * Get the body of a simulation at the values the knobs have now.
 *
 * @param gridId the knob the run grids over, `null` for a run of one point
 * @returns the values of every other knob and the points of that one
 */
function bodyFor(gridId: string | null): SimulateRequest {
  const sent: Record<string, number> = {}
  const over: Record<string, number> = {}
  for (const axis of axes.value) {
    if (axis.id === gridId) {
      over[axis.id] = gridPoints(axis)
      continue
    }
    const value = values.value[axis.id]
    sent[axis.id] = value === undefined || !Number.isFinite(value) ? axis.default : value
  }
  return { values: sent, grid: over }
}

/**
 * Tell the page that something failed.
 *
 * @param kind what failed, a short machine string
 */
function announce(kind: FailureKind): void {
  host?.dispatchEvent(
    new CustomEvent('sbmlsim-error', {
      detail: { kind, message: FAILURE_MESSAGES[kind] },
      bubbles: true,
      composed: true,
    }),
  )
}

/**
 * Resolve a failure into the state a reader sees.
 *
 * @param error the error which was caught anywhere in the element
 */
function fail(error: unknown): void {
  const kind = failureKind(error)
  if (kind === 'aborted') {
    return
  }
  failure.value = kind
  frozen.value = true
  const keep = stored.value
  if (grid.value === null && keep !== null) {
    grid.value = keep
    fromStore.value = true
  }
  announce(kind)
}

/**
 * Run a request once more where that can help.
 *
 * @param run the request
 * @returns its answer
 * @throws PanelRequestError of the last try
 */
async function attempt<T>(run: () => Promise<T>): Promise<T> {
  let last: unknown
  for (let index = 0; index < ATTEMPTS; index += 1) {
    try {
      return await run()
    } catch (error) {
      last = error
      if (!RETRIED.has(failureKind(error))) {
        break
      }
    }
  }
  throw last instanceof Error ? last : new PanelRequestError('internal', last)
}

/** Stop the request in flight and the one which is scheduled. */
function stopWork(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  flight?.abort()
  flight = null
}

/**
 * Run a simulation and draw its answer.
 *
 * @param gridId the knob the run grids over, `null` for a run of one point
 */
async function simulate(gridId: string | null): Promise<void> {
  const talking = client
  if (talking === null || frozen.value) {
    return
  }
  stopWork()
  const controller = new AbortController()
  flight = controller
  const own = (sequence += 1)
  gridded.value = gridId
  pending.value = true
  try {
    const answer = await attempt(() =>
      talking.simulate(props.model, props.panel, bodyFor(gridId), controller.signal),
    )
    if (own !== sequence) {
      return
    }
    grid.value = answer
    fromStore.value = false
    failure.value = null
    frozen.value = false
  } catch (error) {
    if (own === sequence) {
      fail(error)
    }
  } finally {
    if (own === sequence) {
      pending.value = false
      flight = null
    }
  }
}

/**
 * Schedule a simulation of a released knob.
 *
 * A scheduled simulation which is superseded is cancelled and not raced, so a
 * reader who moves three knobs in a row pays one run and not three.
 *
 * @param gridId the knob the run grids over
 */
function schedule(gridId: string | null): void {
  if (timer !== null) {
    clearTimeout(timer)
  }
  gridded.value = gridId
  timer = setTimeout(() => {
    timer = null
    void simulate(gridId)
  }, DEBOUNCE)
}

/**
 * Read the declaration of the panel and run its first simulation.
 *
 * @returns when the first figure was drawn or the failure was resolved
 */
async function load(): Promise<void> {
  const talking = client
  if (talking === null) {
    return
  }
  try {
    const controller = new AbortController()
    flight = controller
    const declared = await attempt(() => talking.panel(props.model, props.panel, controller.signal))
    flight = null
    declaration.value = declared
    values.value = Object.fromEntries(knobsOf(declared).map((one) => [one.id, one.default]))
    logY.value = initialLog(declared)
    await simulate(firstGridded(declared))
  } catch (error) {
    fail(error)
  }
}

/**
 * Read the stored answer of the `fallback` and draw it while nothing else is.
 *
 * Its failure is not shown: a stored answer is a convenience of the page, and
 * a panel whose endpoint answers never needed it.
 *
 * @returns when the stored answer arrived or failed to
 */
async function loadStored(): Promise<void> {
  const talking = client
  if (talking === null || props.fallback === '') {
    return
  }
  try {
    const answer = await talking.stored(props.fallback)
    stored.value = answer
    if (grid.value === null) {
      grid.value = answer
      fromStore.value = true
    }
  } catch {
    // a page without a usable fallback is a page which shows the live answer
  }
}

/**
 * Measure the element.
 *
 * @param width the width an observer reported, `null` to read it off the element
 */
function setWidth(width: number | null): void {
  const found = width ?? root.value?.clientWidth ?? 0
  measured.value = Number.isFinite(found) && found > 0 ? found : 0
}

/** Read the width of the element off the element itself. */
function remeasure(): void {
  setWidth(null)
}

/**
 * Start following the width of the element.
 *
 * `ResizeObserver` is absent in some test environments and in old hosts, where
 * the element follows the window instead and never throws.
 */
function observe(): void {
  remeasure()
  if (observer !== null || listening) {
    return
  }
  const box = root.value
  if ('ResizeObserver' in globalThis) {
    observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      setWidth(typeof width === 'number' && width > 0 ? width : null)
    })
    if (box !== null) {
      observer.observe(box)
    }
    return
  }
  window.addEventListener('resize', remeasure)
  listening = true
}

/** Stop following the width of the element. */
function unobserve(): void {
  observer?.disconnect()
  observer = null
  if (listening) {
    window.removeEventListener('resize', remeasure)
  }
  listening = false
}

/**
 * Read the value a control carries.
 *
 * @param event the `input` or `change` event of the control
 * @returns the value, `null` for a target which is no control or a value which
 *   is no number
 */
function controlValue(event: Event): number | null {
  const target = event.target
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) {
    return null
  }
  const value = Number(target.value)
  return Number.isFinite(value) ? value : null
}

/**
 * Take the movement of a knob: interpolate and redraw, never fetch.
 *
 * @param axis the knob
 * @param event the `input` event of its control
 */
function onInput(axis: PanelAxis, event: Event): void {
  const value = controlValue(event)
  if (value === null) {
    return
  }
  values.value = { ...values.value, [axis.id]: value }
}

/**
 * Take the release of a knob: schedule a simulation unless the grid covers it.
 *
 * @param axis the knob
 * @param event the `change` event of its control
 */
function onChange(axis: PanelAxis, event: Event): void {
  const value = controlValue(event)
  if (value === null) {
    return
  }
  values.value = { ...values.value, [axis.id]: value }
  if (frozen.value || axis.id === gridded.value) {
    return
  }
  schedule(axis.id)
}

/**
 * Take the toggle of the scale of the y axis, which is drawn and never run.
 *
 * @param event the `change` event of the toggle
 */
function onLog(event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement) {
    logY.value = target.checked
  }
}

/**
 * Start the panel: read its declaration, its stored answer and its first grid.
 *
 * A second call only lifts a freeze and starts following the width again, so
 * a deck which mounts a slide lazily calls it whenever the slide is shown.
 *
 * @returns when the first figure was drawn or the failure was resolved; it
 *   never rejects
 */
async function activate(): Promise<void> {
  frozen.value = false
  if (started) {
    await nextTick()
    observe()
    return
  }
  started = true
  active.value = true
  client = new PanelClient(props.endpoint, props.timeout)
  await nextTick()
  observe()
  await Promise.all([loadStored(), load()])
}

/**
 * Stop every pending request and freeze the knobs.
 *
 * What is drawn stays drawn; `activate()` lifts the freeze.
 */
function freeze(): void {
  stopWork()
  sequence += 1
  pending.value = false
  frozen.value = true
  unobserve()
}

/**
 * Put every knob back to the value its declaration states.
 *
 * The scale of the y axis goes back to the one the curves declare as well. A
 * simulation is only run when the grid is no longer the one the panel started
 * with, since every other case is read out of the grid which is already here.
 */
function reset(): void {
  const declared = declaration.value
  if (declared === null) {
    return
  }
  values.value = Object.fromEntries(knobsOf(declared).map((one) => [one.id, one.default]))
  logY.value = initialLog(declared)
  const first = firstGridded(declared)
  if (!frozen.value && first !== gridded.value) {
    schedule(first)
  }
}

watch(drawFailed, (failed) => {
  if (failed) {
    fail(new PanelRequestError('internal'))
  }
})

onBeforeUnmount(() => {
  stopWork()
  unobserve()
})

defineExpose({ activate, freeze, reset })
</script>

<template>
  <div
    v-if="active"
    ref="root"
    class="panel"
    :class="[`layout-${drawnLayout}`, { frozen: frozen }]"
  >
    <header v-if="title !== '' || subtitle !== ''" class="head">
      <component :is="headingTag" v-if="title !== ''" class="title">{{ title }}</component>
      <p v-if="subtitle !== ''" class="subtitle">{{ subtitle }}</p>
    </header>
    <div class="body">
      <div class="controls" role="group" aria-label="Simulation settings">
        <div v-for="axis of axes" :key="axis.id" class="knob">
          <label class="knob-label" :for="controlId(axis)">{{ knobLabel(axis) }}</label>
          <div v-if="axis.kind === 'range'" class="knob-row">
            <input
              :id="controlId(axis)"
              type="range"
              :min="axis.min ?? 0"
              :max="axis.max ?? 1"
              :step="rangeStep(axis)"
              :value="values[axis.id] ?? axis.default"
              :disabled="frozen"
              @input="onInput(axis, $event)"
              @change="onChange(axis, $event)"
            />
            <output class="knob-value" :for="controlId(axis)" aria-live="off">{{
              shownValue(axis)
            }}</output>
          </div>
          <select
            v-else
            :id="controlId(axis)"
            class="knob-select"
            :value="values[axis.id] ?? axis.default"
            :disabled="frozen"
            @change="onChange(axis, $event)"
          >
            <option v-for="choice of axis.choices" :key="choice.label" :value="choice.value">
              {{ choice.label }}
            </option>
          </select>
        </div>
        <div class="options">
          <label class="toggle">
            <input type="checkbox" :checked="logY" :disabled="frozen" @change="onLog($event)" />
            <span>logarithmic y</span>
          </label>
          <button type="button" class="reset" :disabled="frozen" @click="reset()">Reset</button>
        </div>
      </div>
      <div
        class="figure"
        :style="{ minHeight: `${figureHeight}px` }"
        :aria-busy="pending ? 'true' : 'false'"
      >
        <!-- eslint-disable-next-line vue/no-v-html -- the renderer builds this string itself and escapes every text of it -->
        <div v-if="svg !== ''" class="figure-svg" v-html="svg"></div>
        <p v-else class="pending">Loading the panel</p>
      </div>
    </div>
    <p v-if="errorMessage !== ''" class="error" role="alert">{{ errorMessage }}</p>
    <p v-if="footer !== ''" class="provenance">{{ footer }}</p>
  </div>
</template>

<style src="./theme.css"></style>

<style>
/*
 * The host carries the box of the element and nothing else. Every colour and
 * every piece of typography is declared on `.panel` below, because a rule of
 * the page which matches the element - `* { color: red }`, `section * { }`,
 * `sbmlsim-panel { }` - beats a declaration of this tree on the host, and
 * everything in the panel would inherit the value of the page.
 *
 * `color-scheme` is what the browser draws the native widgets of the controls
 * with - the arrow of a select, the box of a checkbox, the face of a button -
 * and it follows the `theme` attribute as the tokens do, so a dark panel has
 * no white checkbox in it.
 */
:host {
  display: block;
  color-scheme: light dark;
}

:host([theme='light']) {
  color-scheme: light;
}

:host([theme='dark']) {
  color-scheme: dark;
}

/*
 * The panel reads the private tokens of `theme.css`, which carry what a page
 * set anywhere above the element and the table of the design as their
 * fallback. Its typography and its colour are declared here and not on
 * `:host`, so a rule of the page which matches the element cannot hand them
 * to everything in the panel by inheritance.
 */
.panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--_fg);
  font-family: var(--_font);
  font-size: var(--_font-size);
  font-style: normal;
  font-weight: 400;
  line-height: 1.45;
  text-align: left;
  text-transform: none;
  letter-spacing: normal;
}

.head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.title {
  margin: 0;
  color: var(--_fg);
  font-size: 15px;
  font-weight: 600;
}

.subtitle {
  margin: 0;
  color: var(--_fg-soft);
  font-size: var(--_font-size);
}

.body {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.controls {
  display: flex;
  gap: 10px 16px;
}

.layout-sidebar .body {
  flex-direction: row;
}

.layout-sidebar .controls {
  flex: 0 0 200px;
  flex-direction: column;
  width: 200px;
}

.layout-sidebar .knob {
  flex: 0 0 auto;
  width: 100%;
}

.layout-stacked .body,
.layout-toolbar .body {
  flex-direction: column;
}

.layout-stacked .controls,
.layout-toolbar .controls {
  flex-flow: row wrap;
  align-items: flex-end;
  width: 100%;
}

.layout-stacked .figure {
  order: -1;
}

.knob {
  display: flex;
  flex: 1 1 160px;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.knob-label {
  color: var(--_fg-soft);
  font-size: var(--_font-size-small);
}

.knob-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.knob-row input {
  flex: 1 1 auto;
  min-width: 0;
  accent-color: var(--_accent);
}

.knob-value {
  min-width: 4ch;
  color: var(--_fg);
  font-family: var(--_font-mono);
  font-size: var(--_font-size-small);
  text-align: right;
}

.knob-select {
  width: 100%;
  padding: 3px 6px;
  border: 1px solid var(--_line);
  border-radius: 6px;
  background: var(--_bg-card);
  color: var(--_fg);
  font-family: inherit;
  font-size: var(--_font-size);
}

.options {
  display: flex;
  flex: 0 0 auto;
  gap: 12px;
  align-items: center;
}

.toggle {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  color: var(--_fg-soft);
  font-size: var(--_font-size-small);
}

.toggle input {
  margin: 0;
  accent-color: var(--_accent);
}

.reset {
  padding: 3px 10px;
  border: 1px solid var(--_line);
  border-radius: 6px;
  background: var(--_bg-card);
  color: var(--_fg);
  font-family: inherit;
  font-size: var(--_font-size-small);
  cursor: pointer;
}

.reset:hover:not(:disabled) {
  border-color: var(--_accent);
  color: var(--_accent);
}

.figure {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  min-width: 0;
}

/*
 * The figure writes `var(--sbmlsim-fg, ...)` and `var(--sbmlsim-ramp-1, ...)`
 * itself, because its tokens are the ones of a report and a page which copies
 * the SVG out of here keeps them. This is the one place inside the shadow root
 * where a public name is declared, and it reads the private token of each, so
 * a value a page set above the element reaches the figure as well.
 */
.figure-svg {
  --sbmlsim-figure-bg: var(--_figure-bg);
  --sbmlsim-fg: var(--_fg);
  --sbmlsim-fg-soft: var(--_fg-soft);
  --sbmlsim-font: var(--_font);
  --sbmlsim-font-size: var(--_font-size);
  --sbmlsim-font-size-small: var(--_font-size-small);
  --sbmlsim-axis-width: var(--_axis-width);
  --sbmlsim-curve-width: var(--_curve-width);
  --sbmlsim-data-width: var(--_data-width);
  --sbmlsim-ramp-1: var(--_ramp-1);
  --sbmlsim-ramp-2: var(--_ramp-2);
  --sbmlsim-ramp-3: var(--_ramp-3);
  --sbmlsim-ramp-4: var(--_ramp-4);
  --sbmlsim-ramp-5: var(--_ramp-5);
  --sbmlsim-ramp-6: var(--_ramp-6);

  width: 100%;
}

.figure-svg svg {
  display: block;
  max-width: 100%;
  height: auto;
}

.pending {
  margin: 0;
  color: var(--_fg-soft);
  font-size: var(--_font-size-small);
}

.error {
  margin: 0;
  color: var(--_outlier);
  font-size: var(--_font-size);
}

.provenance {
  margin: 0;
  color: var(--_fg-soft);
  font-family: var(--_font-mono);
  font-size: var(--_font-size-small);
}

.frozen .controls {
  opacity: 0.6;
}

:focus-visible {
  outline: 2px solid var(--_accent);
  outline-offset: 2px;
}
</style>
