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
 * ## The readout is a view of the drawn grid and nothing else
 *
 * The crosshair and the readout cost no request and no interpolation of their
 * own: they read the curves which are already drawn, at the index of the grid
 * nearest to the cursor, and they show what the figure shows. They are placed
 * on the layout the renderer drew from (`plotGeometry`), so they sit on the
 * figure which is there and never on one the element had to guess at, and the
 * readout never leaves the plot box: it flips to the other side of the
 * crosshair where it would pass the right edge and is clamped at the top and
 * the bottom.
 *
 * The pointer is a `pointermove`, so a pen and a finger read a panel as a
 * mouse does, every coordinate is guarded, and a device which never moves a
 * pointer and an environment which measures nothing simply have no readout.
 * For a screen reader the whole overlay is decoration (`aria-hidden`): the
 * figure keeps its `role="img"` and its `<title>`, which is what tells a
 * reader who does not see it what it shows, and nothing of the figure takes
 * the focus.
 *
 * ## The study data is one fetch for the life of the element
 *
 * A panel which declares study data fetches it once, when it is activated, and
 * draws it under its curves for as long as it lives: the data does not depend
 * on a knob. The series of `paneldata/1` arrive in the unit the model resolved
 * for the curve they sit under, so nothing is converted here; a series which is
 * delivered on a scale of its own - one which declares a unit of its own, and
 * one whose id is no curve of the panel - is left out, because a figure has one
 * y axis and drawing a series on another scale would be a figure which lies.
 *
 * A failed fetch of the study data is no failure of the panel. The curves are
 * what a reader asked for, they are there, and the overlay is simply absent: no
 * line is written, no `sbmlsim-error` is dispatched and nothing is logged.
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
  PanelDataDeclaration,
  PanelDataSeries,
  PanelDeclaration,
  SimulateRequest,
  SimulateResponse,
} from './contract'
import { interpolate } from './interpolate'
import { plotGeometry, plotSvg, seriesColour } from './plot'
import type { PlotGeometry, PlotSpec, Points, Series } from './plot'

/** How the controls are placed next to the figure. */
type LayoutName = 'auto' | 'sidebar' | 'stacked' | 'toolbar'

/** The layout which is drawn, which `auto` resolves to by the room it has. */
type DrawnLayout = Exclude<LayoutName, 'auto'>

/** Which values of the design tokens the element asks for. */
type ThemeName = 'auto' | 'light' | 'dark'

/** Whether a part of the element a page can switch off is on. */
type Switch = 'on' | 'off'

/** Where the pointer is, in the pixels of the box the overlay is drawn in. */
interface PointerState {
  /** The x of the pointer from the left edge of that box. */
  x: number
  /** Its y from the top edge. */
  y: number
  /** The left edge of the figure inside that box. */
  left: number
  /** Its top edge. */
  top: number
  /** The pixels of the drawn figure per pixel of its `viewBox`. */
  scale: number
  /** The size of the font of the readout, in pixels, as the page resolved it. */
  font: number
}

/** Why a series of the study data is not drawn. */
type DropReason = 'curve' | 'unit' | 'x-unit'

/** One series of the study data which is not drawn, with the reason it is not. */
interface DroppedSeries {
  /** The id of the series. */
  id: string
  /** The curve it resolved to, its own id where its declaration names none. */
  curve: string
  /** Why it is not drawn. */
  reason: DropReason
  /** The unit it was delivered in, `null` for values which carry none. */
  delivered: string | null
  /** The unit it would have to be in, `null` where there is no curve to carry it. */
  wanted: string | null
}

/** The study data of the panel, split into what is drawn and what is not. */
interface ResolvedData {
  /** The series which are drawn, in the order of the answer. */
  drawn: Points[]
  /** The ones which are not, with the reason. */
  dropped: DroppedSeries[]
}

/** One row of the readout: a curve, its colour and its value at the cursor. */
interface ReadoutRow {
  /** The id of the curve. */
  id: string
  /** Its label, the one of the legend. */
  label: string
  /** The colour the figure draws it in. */
  colour: string
  /** Its value at the cursor with its unit, `NO_VALUE` for a point without one. */
  value: string
  /** The pixel its value sits at on the crosshair, `null` for one which is not drawn. */
  dot: number | null
}

/** A marker of the readout where the crosshair crosses a curve. */
interface Dot {
  /** The id of the curve. */
  id: string
  /** Its colour. */
  colour: string
  /** The pixel of its value. */
  at: number
}

/** The readout at the cursor, placed in the pixels of the box of the overlay. */
interface Readout {
  /** The pixel of the crosshair, the x of the grid nearest to the cursor. */
  line: number
  /** The top of the crosshair, the top of the plot box. */
  lineTop: number
  /** Its height, the height of the plot box. */
  lineHeight: number
  /** The left of the box of the readout. */
  left: number
  /** Its top. */
  top: number
  /** Its width. */
  width: number
  /** Its height. */
  height: number
  /** The height of one of its rows. */
  row: number
  /** The x which is read out, with its unit. */
  time: string
  /** One row per curve of the figure, in the order they are drawn. */
  rows: ReadoutRow[]
  /** The rows the box has room for, the first of `rows` or all of them. */
  shown: ReadoutRow[]
  /** How many rows are not shown, 0 for a box which shows them all. */
  more: number
}

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
/*
 * The numbers the box of the readout is built of. The box carries every one of
 * them into its own style as a custom property, so the number which places it
 * and the number which draws it are one number: a test lays nothing out, and a
 * value which drifted apart from a literal of the stylesheet would be caught by
 * nothing.
 */
/** The pixels between the crosshair and the box of the readout. */
const READOUT_GAP = 8
/** The padding inside the box of the readout, in pixels. */
const READOUT_PAD = 6
/** The border of that box, in pixels. */
const READOUT_BORDER = 1
/** The height of one row of the readout, a share of the size of its font. */
const READOUT_LINE = 1.36
/** The size of the swatch of a row, in pixels. */
const READOUT_SWATCH = 8
/** The gap between the swatch, the label and the value of a row, in pixels. */
const READOUT_ROW_GAP = 6
/**
 * The size of the font of the readout where no style can be read off the page.
 *
 * The box is placed and never measured, as the figure places its legend: its
 * room is the characters of its rows at the size its box carries and the widths
 * below, so a host whose font is much wider than them gets a label cut with an
 * ellipsis. The size itself is read off the element (`fontSizeOf`), so a host
 * which sets `--sbmlsim-font-size-small` gets a box and rows of that size, and
 * this is the value of the design for an environment which computes no style.
 */
const READOUT_FONT = 11
/** The width a character of a label is given, a share of its font size. */
const READOUT_EM = 0.5
/** The width a character of a value is given, which is set in the mono font. */
const READOUT_MONO_EM = 0.62
/** The pixels between the label of a row and its value. */
const READOUT_COLUMN = 8
/** The smallest box the readout is drawn in, in pixels. */
const READOUT_MIN = 56
/** The significant digits a value of the readout is shown with. */
const READOUT_DIGITS = 4
/** What a value which is no number is shown as, e.g. a point which did not integrate. */
const NO_VALUE = '-'

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
  /**
   * Whether the pointer reads the curves out: `on` (the default) or `off`. A
   * panel with `hover="off"` draws no crosshair and no readout; it keeps its
   * pointer handlers, which answer such a panel with no readout, so switching
   * the attribute back on needs no rebinding.
   */
  hover: { type: String as PropType<Switch>, default: 'on' },
  /**
   * Whether the study data of the panel is fetched and drawn under its curves:
   * `on` (the default) or `off`. A panel with `data="off"` makes no request for
   * it, and so does one whose declaration carries none.
   */
  data: { type: String as PropType<Switch>, default: 'on' },
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
const plotted = useTemplateRef<HTMLElement>('plotted')

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
/**
 * The study data of the panel, `null` until it arrived.
 *
 * It is read once for the life of the element: it is the data of a study and
 * depends on no knob, so a panel which has it never asks for it again.
 */
const study = shallowRef<PanelDataSeries[] | null>(null)
/** Where the pointer is, `null` while it is not over the plot box. */
const pointer = ref<PointerState | null>(null)
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

/**
 * Get the study data a declaration states, by the series which can be read.
 *
 * @param declared the declaration, `null` until it was read
 * @returns the declared series, in the order of the declaration
 */
function dataOf(declared: PanelDeclaration | null): PanelDataDeclaration[] {
  const given: unknown[] = declared?.data ?? []
  return given.filter((one): one is PanelDataDeclaration => carries(one, ['id', 'label']))
}

/**
 * Get the series of the study data which carry points to draw.
 *
 * @param given what the endpoint answered, `null` until it answered
 * @returns the series which can be drawn, in the order of the answer
 */
function seriesOf(given: PanelDataSeries[] | null): PanelDataSeries[] {
  const items: unknown[] = given ?? []
  return items.filter(
    (one): one is PanelDataSeries =>
      carries(one, ['id', 'label']) &&
      Array.isArray((one as PanelDataSeries).x) &&
      Array.isArray((one as PanelDataSeries).y),
  )
}

/**
 * Get whether two units of a payload are the same unit.
 *
 * @param one the unit, `null` for values which carry none
 * @param other the other one
 * @returns whether they are the same text, "no unit" being one of them
 */
function sameUnit(one: string | null | undefined, other: string | null | undefined): boolean {
  return (one ?? '') === (other ?? '')
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

/**
 * The study data split into what is drawn and what is not.
 *
 * A series sits under the curve its declaration names, its own id without one,
 * and is drawn only where the endpoint delivered it on the scale of that curve
 * and on the scale of its x axis. Three things take a series out of the figure:
 * its curve is none of the drawn ones (`curve`, e.g. a declaration which names
 * a curve by a typo), its values are in another unit than that curve (`unit`)
 * or its x is in another unit than the run (`x-unit`). The contract makes the
 * unit of a series and the unit of its curve the same text unless the series
 * declares one of its own, so a series which does not match is one of another
 * scale, which a figure of one y axis cannot draw without lying about it.
 *
 * This is a view of the answer and nothing else. What a reader is told about a
 * dropped series is said by the watcher below, where a side effect runs once.
 */
const resolvedData = computed<ResolvedData>(() => {
  const answer = grid.value
  if (answer === null || props.data === 'off') {
    return { drawn: [], dropped: [] }
  }
  const declared = new Map(dataOf(declaration.value).map((one) => [one.id, one]))
  const units = new Map(drawnCurves.value.map((one) => [one.id, one.unit]))
  const drawn: Points[] = []
  const dropped: DroppedSeries[] = []
  for (const one of seriesOf(study.value)) {
    const curve = declared.get(one.id)?.curve ?? one.id
    const unit = units.get(curve)
    const delivered = one.unit ?? null
    if (unit === undefined) {
      dropped.push({ id: one.id, curve, reason: 'curve', delivered, wanted: null })
      continue
    }
    if (!sameUnit(one.unit, unit)) {
      dropped.push({ id: one.id, curve, reason: 'unit', delivered, wanted: unit })
      continue
    }
    if (!sameUnit(one.x_unit, answer.units.x)) {
      const wanted = answer.units.x ?? null
      dropped.push({ id: one.id, curve, reason: 'x-unit', delivered: one.x_unit ?? null, wanted })
      continue
    }
    const points: Points = { id: one.id, label: one.label, curve, x: one.x, y: one.y }
    const errors = one.yerr
    if (Array.isArray(errors)) {
      points.yerr = errors.map((value) => (typeof value === 'number' ? value : Number.NaN))
    }
    drawn.push(points)
  }
  return { drawn, dropped }
})

/** The study data as it is drawn, empty while there is none to draw. */
const drawnData = computed<Points[]>(() => resolvedData.value.drawn)

/** The series which were already reported, so each is reported once per element. */
const reported = new Set<string>()

/**
 * Write a unit of a payload for a reader of the console.
 *
 * @param unit the unit, `null` or empty for values which carry none
 * @returns the unit, or what "no unit" is called
 */
function shownUnit(unit: string | null): string {
  return unit === null || unit === '' ? 'no unit' : unit
}

/**
 * Write the line which says that a series of the study data is not drawn.
 *
 * @param one the series and the reason it is not drawn
 * @param panel the id of the panel it belongs to
 * @returns the line, which names the series, its curve and the two units
 */
function droppedMessage(one: DroppedSeries, panel: string): string {
  const head = `sbmlsim-panel ${panel}: the study data "${one.id}" is not drawn`
  if (one.reason === 'curve') {
    return `${head}, it sits under the curve "${one.curve}", which the panel does not draw.`
  }
  const axis = one.reason === 'x-unit' ? 'x' : 'y'
  return (
    `${head}, its ${axis} is delivered in ${shownUnit(one.delivered)} and the curve ` +
    `"${one.curve}" is drawn in ${shownUnit(one.wanted)}.`
  )
}

/*
 * Say once per series what the figure leaves out. A dropped series is no
 * failure of the panel, so it is no `sbmlsim-error` and no error line: the
 * curves are there and the reader asked for them. It is a mistake in a
 * declaration or in a study, which only the console can carry to the one who
 * can fix it.
 */
watch(
  () => resolvedData.value.dropped,
  (dropped) => {
    for (const one of dropped) {
      if (reported.has(one.id)) {
        continue
      }
      reported.add(one.id)
      console.warn(droppedMessage(one, props.panel))
    }
  },
  { immediate: true },
)

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
  const spec: PlotSpec = {
    x: answer.x,
    xLabel: xLabel.value,
    yLabel: yLabel.value,
    series,
    width: figureWidth.value,
    height: figureHeight.value,
    logY: logY.value,
  }
  const points = drawnData.value
  return points.length > 0 ? { ...spec, points } : spec
})

/**
 * The layout of the figure which is drawn, `null` while there is none.
 *
 * It is the layout the renderer draws from, so the crosshair and the readout
 * are placed on the figure which is there; a figure which cannot be laid out is
 * `null` and not an exception, for the reason `svg` is empty rather than
 * throwing.
 */
const geometry = computed<PlotGeometry | null>(() => {
  try {
    const spec = plot.value
    return spec === null ? null : plotGeometry(spec)
  } catch {
    return null
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
 * Get the index of the grid nearest to a pixel of the x axis, by scanning it.
 *
 * @param xs the x of the figure, the output times of the run
 * @param drawn the layout of the figure
 * @param at the pixel, in the coordinates of the figure
 * @returns the index of the nearest x, `null` for a figure without one
 */
function scanNearest(xs: number[], drawn: PlotGeometry, at: number): number | null {
  let found: number | null = null
  let best = Number.POSITIVE_INFINITY
  for (const [index, value] of xs.entries()) {
    if (!Number.isFinite(value)) {
      continue
    }
    const distance = Math.abs(drawn.xAt(value) - at)
    if (distance < best) {
      best = distance
      found = index
    }
  }
  return found
}

/**
 * Get the index of the grid nearest to a pixel of the x axis.
 *
 * The x of a run is sorted and its axis is linear in the pixels, so the pixel
 * is turned back into an x by the two ends of the grid and the x is found by
 * halving: eleven comparisons on a grid of two thousand points instead of two
 * thousand, on every movement of the pointer. A grid which is not sorted, not
 * finite at its ends or drawn on an axis of no width is scanned instead, so a
 * payload which breaks the assumption is answered by the slow way and never by
 * a wrong index. Ties keep the lower index, as the scan does; a grid which
 * holds one x twice, which the output of a run does not, may answer with the
 * later of the two.
 *
 * @param xs the x of the figure, the output times of the run
 * @param drawn the layout of the figure
 * @param at the pixel, in the coordinates of the figure
 * @returns the index of the nearest x, `null` for a figure without one
 */
function nearestIndex(xs: number[], drawn: PlotGeometry, at: number): number | null {
  const last = xs.length - 1
  const first = xs[0]
  const end = xs[last]
  if (first === undefined || end === undefined || !(end > first)) {
    return scanNearest(xs, drawn, at)
  }
  const p0 = drawn.xAt(first)
  const p1 = drawn.xAt(end)
  if (!Number.isFinite(p0) || !Number.isFinite(p1) || !(p1 > p0)) {
    return scanNearest(xs, drawn, at)
  }
  const wanted = first + ((at - p0) * (end - first)) / (p1 - p0)
  let low = 0
  let high = last
  while (high - low > 1) {
    const middle = (low + high) >> 1
    const value = xs[middle]
    if (value === undefined || !Number.isFinite(value)) {
      return scanNearest(xs, drawn, at)
    }
    if (value <= wanted) {
      low = middle
    } else {
      high = middle
    }
  }
  const below = xs[low]
  const above = xs[high]
  if (below === undefined || above === undefined || above < below) {
    return scanNearest(xs, drawn, at)
  }
  return Math.abs(drawn.xAt(above) - at) < Math.abs(drawn.xAt(below) - at) ? high : low
}

/**
 * Write a value of the readout with its unit.
 *
 * @param value the value, `undefined` for a curve which has none here
 * @param unit its unit, `null` or empty for values which carry none
 * @returns the value as short text with its unit, `NO_VALUE` for one which is
 *   no finite number, i.e. a point of the grid which did not integrate
 */
function readoutValue(value: number | undefined, unit: string | null): string {
  if (value === undefined || !Number.isFinite(value)) {
    return NO_VALUE
  }
  const shown = shortNumber(value, READOUT_DIGITS)
  return unit === null || unit === '' ? shown : `${shown} ${unit}`
}

/**
 * Write the row which says how many rows the box has no room for.
 *
 * @param more how many rows are not shown
 * @returns the text of that row
 */
function moreText(more: number): string {
  return `+${String(more)} more`
}

/**
 * Get the room the box of the readout needs.
 *
 * @param time the x which is read out, with its unit
 * @param rows the rows of the readout
 * @param more how many rows the box will not show, 0 for a box which shows all
 * @param font the size of its font in pixels, as the page resolved it
 * @returns the pixels of its widest row with its padding and its border, an
 *   estimate of its characters and no measurement, as the figure estimates the
 *   room of its legend
 */
function readoutRoom(time: string, rows: ReadoutRow[], more: number, font: number): number {
  const label = font * READOUT_EM
  const value = font * READOUT_MONO_EM
  const swatch = READOUT_SWATCH + READOUT_ROW_GAP
  let most = time.length * value
  for (const one of rows) {
    const text = one.label.length * label + one.value.length * value
    most = Math.max(most, swatch + text + READOUT_COLUMN)
  }
  if (more > 0) {
    most = Math.max(most, swatch + moreText(more).length * label)
  }
  return (READOUT_PAD + READOUT_BORDER) * 2 + most
}

/**
 * The readout at the cursor, `null` while the pointer is not over the plot box.
 *
 * It costs no request and no interpolation of its own: the values are the ones
 * of the curves which are drawn, at the index of the grid nearest to the
 * cursor. The box is placed next to the crosshair and never leaves the plot
 * box: it flips to the other side where it would pass the right edge, and it is
 * clamped at the top and at the bottom.
 *
 * A box of a plot box too short for its rows shows the rows it has room for and
 * says how many it does not (`+N more`), as a legend label too long for its
 * column ends in an ellipsis: nothing is cut in half and nothing goes missing
 * without being counted. The markers on the crosshair are drawn for every curve
 * whatever the box shows, so the figure itself never loses a value.
 */
const readout = computed<Readout | null>(() => {
  const at = pointer.value
  const drawn = geometry.value
  const spec = plot.value
  if (at === null || drawn === null || spec === null || props.hover === 'off') {
    return null
  }
  const x0 = at.left + drawn.box.x0 * at.scale
  const x1 = at.left + drawn.box.x1 * at.scale
  const y0 = at.top + drawn.box.y0 * at.scale
  const y1 = at.top + drawn.box.y1 * at.scale
  if (at.x < x0 || at.x > x1 || at.y < y0 || at.y > y1 || !(x1 > x0) || !(y1 > y0)) {
    return null
  }
  const index = nearestIndex(spec.x, drawn, (at.x - at.left) / at.scale)
  const time = index === null ? undefined : spec.x[index]
  if (index === null || time === undefined) {
    return null
  }
  const line = at.left + drawn.xAt(time) * at.scale
  const rows = spec.series.map((one, position): ReadoutRow => {
    const value = one.values[index]
    const pixel =
      value === undefined || !drawn.drawable(value) ? null : at.top + drawn.yAt(value) * at.scale
    return {
      id: one.id,
      label: one.label,
      colour: seriesColour(position, spec.series.length),
      value: readoutValue(value, one.unit ?? null),
      dot: pixel === null || pixel < y0 || pixel > y1 ? null : pixel,
    }
  })
  const shownTime = readoutValue(time, grid.value?.units.x ?? null)
  const row = at.font * READOUT_LINE
  const chrome = (READOUT_PAD + READOUT_BORDER) * 2 + row
  const fits = Math.floor((y1 - y0 - chrome) / row)
  const room = clamp(fits, 0, rows.length)
  const shown = room < rows.length ? rows.slice(0, Math.max(0, room - 1)) : rows
  const more = rows.length - shown.length
  const width = Math.min(
    Math.max(readoutRoom(shownTime, shown, more, at.font), READOUT_MIN),
    Math.max(READOUT_MIN, x1 - x0),
  )
  const wantedHeight = chrome + row * (shown.length + (more > 0 ? 1 : 0))
  const height = Math.min(wantedHeight, y1 - y0)
  const after = line + READOUT_GAP
  const wanted = after + width <= x1 ? after : line - READOUT_GAP - width
  return {
    line,
    lineTop: y0,
    lineHeight: y1 - y0,
    left: clamp(wanted, x0, Math.max(x0, x1 - width)),
    top: clamp(at.y - height / 2, y0, Math.max(y0, y1 - height)),
    width,
    height,
    row,
    time: shownTime,
    rows,
    shown,
    more,
  }
})

/**
 * The numbers of the box of the readout its own style carries.
 *
 * The box is placed by the script and drawn by the stylesheet, and both read
 * these: the style of the box names them as custom properties, so a change of
 * one of the constants moves the measurement and the drawing together.
 */
const readoutStyle = {
  pad: READOUT_PAD,
  border: READOUT_BORDER,
  swatch: READOUT_SWATCH,
  gap: READOUT_ROW_GAP,
}

/** The markers where the crosshair crosses the curves, none without a readout. */
const dots = computed<Dot[]>(() =>
  (readout.value?.rows ?? []).flatMap((one) =>
    one.dot === null ? [] : [{ id: one.id, colour: one.colour, at: one.dot }],
  ),
)

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
 * Read the study data of the panel, once for the life of the element.
 *
 * Its failure is not shown and not announced: the curves are what a reader
 * asked for, the overlay is a help on top of them, and a panel which cannot
 * draw it is a panel which draws its curves.
 *
 * The request carries no signal of its own. It is one request per element and
 * it bounds itself with the timeout of the client, so there is nothing a later
 * movement of a knob could supersede.
 *
 * @param declared the declaration of the panel
 * @returns when the data arrived or failed to
 */
async function loadData(declared: PanelDeclaration): Promise<void> {
  const talking = client
  if (talking === null || props.data === 'off' || dataOf(declared).length === 0) {
    return
  }
  try {
    study.value = await attempt(() => talking.data(props.model, props.panel))
  } catch {
    // a panel whose study data cannot be read is a panel of its curves alone
  }
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
    await Promise.all([simulate(firstGridded(declared)), loadData(declared)])
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

/** The keys a range input and a select act on themselves. */
const CONTROL_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])

/**
 * Keep the keys a knob acts on to the knob.
 *
 * A key event leaves the shadow root retargeted at the element, so a host which
 * decides on the target - reveal.js skips a key whose active element is an
 * `input` - sees the element and not the knob, and a deck would turn the slide
 * under a reader who moves a knob with the arrow keys. The event stops here
 * instead, at the knob, and only for the keys the knob uses: every other key
 * reaches the host as it does without the element.
 *
 * @param event the `keydown` event of the controls
 */
function onControlKey(event: KeyboardEvent): void {
  const target = event.target
  const isControl =
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement && target.type === 'range')
  if (isControl && CONTROL_KEYS.has(event.key)) {
    event.stopPropagation()
  }
}

/**
 * Read the size of the font the readout is drawn in, in pixels.
 *
 * The box of the readout is placed in script and drawn by the stylesheet, and
 * both read the same size: the one the page resolved for the box the figure
 * sits in, which carries the small font of the design. An environment which
 * computes no style, e.g. the one the tests run in, gives the size of the
 * design.
 *
 * @param box the element the figure and the overlay sit in
 * @returns the size in pixels, the one of the design where none can be read
 */
function fontSizeOf(box: HTMLElement): number {
  const size = Number.parseFloat(globalThis.getComputedStyle(box).fontSize)
  return Number.isFinite(size) && size > 0 ? size : READOUT_FONT
}

/**
 * Read where a pointer is, in the pixels of the box the overlay is drawn in.
 *
 * Nothing here assumes that there is a pointer, that it carries coordinates or
 * that anything was measured: a device which only taps, an event without
 * coordinates and an environment which measures no box all give `null`, which
 * is a figure without a readout and never an exception.
 *
 * @param event the pointer event
 * @returns where the pointer is, `null` where that cannot be told
 */
function pointerState(event: Event): PointerState | null {
  // the guards below are what makes this cast safe, and `instanceof PointerEvent` is not an
  // option: a page and a test may send a plain `Event` which carries the coordinates all the same
  const { clientX, clientY } = event as Partial<PointerEvent>
  const drawn = geometry.value
  const box = plotted.value
  const figure = box?.querySelector('svg') ?? null
  if (typeof clientX !== 'number' || typeof clientY !== 'number' || !Number.isFinite(clientX)) {
    return null
  }
  if (!Number.isFinite(clientY) || drawn === null || box === null || figure === null) {
    return null
  }
  const inner = figure.getBoundingClientRect()
  const outer = box.getBoundingClientRect()
  if (!(inner.width > 0) || !(drawn.width > 0)) {
    return null
  }
  return {
    x: clientX - outer.left,
    y: clientY - outer.top,
    left: inner.left - outer.left,
    top: inner.top - outer.top,
    scale: inner.width / drawn.width,
    font: fontSizeOf(box),
  }
}

/**
 * Take the movement of a pointer over the figure.
 *
 * @param event the `pointermove` event
 */
function onPointerMove(event: Event): void {
  pointer.value = props.hover === 'off' ? null : pointerState(event)
}

/** Take the pointer off the figure, which takes the readout with it. */
function onPointerLeave(): void {
  pointer.value = null
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
  pointer.value = null
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

/*
 * A panel which was started with `data="off"` made no request for its study
 * data. A page which switches the attribute on afterwards asks for the same
 * thing a page which carried it from the start asks for, so it gets the one
 * request of the element here, and a panel whose data already arrived keeps it.
 */
watch(
  () => props.data,
  (wanted) => {
    const declared = declaration.value
    if (wanted !== 'off' && declared !== null && study.value === null) {
      void loadData(declared)
    }
  },
)

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
      <div
        class="controls"
        role="group"
        aria-label="Simulation settings"
        @keydown="onControlKey($event)"
      >
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
        <div
          v-if="svg !== ''"
          ref="plotted"
          class="plot"
          @pointermove="onPointerMove($event)"
          @pointerleave="onPointerLeave()"
          @pointercancel="onPointerLeave()"
        >
          <!-- eslint-disable-next-line vue/no-v-html -- the renderer builds this string itself and escapes every text of it -->
          <div class="figure-svg" v-html="svg"></div>
          <div v-if="readout !== null" class="cursor" aria-hidden="true">
            <div
              class="crosshair"
              :style="{
                left: `${readout.line}px`,
                top: `${readout.lineTop}px`,
                height: `${readout.lineHeight}px`,
              }"
            ></div>
            <div
              v-for="dot of dots"
              :key="dot.id"
              class="dot"
              :style="{ left: `${readout.line}px`, top: `${dot.at}px`, background: dot.colour }"
            ></div>
            <div
              class="readout"
              :style="{
                left: `${readout.left}px`,
                top: `${readout.top}px`,
                width: `${readout.width}px`,
                height: `${readout.height}px`,
                '--readout-pad': `${readoutStyle.pad}px`,
                '--readout-border': `${readoutStyle.border}px`,
                '--readout-line': `${readout.row}px`,
                '--readout-swatch': `${readoutStyle.swatch}px`,
                '--readout-gap': `${readoutStyle.gap}px`,
              }"
            >
              <p class="readout-time">{{ readout.time }}</p>
              <p v-for="row of readout.shown" :key="row.id" class="readout-row">
                <span class="readout-swatch" :style="{ background: row.colour }"></span>
                <span class="readout-label">{{ row.label }}</span>
                <span class="readout-value">{{ row.value }}</span>
              </p>
              <p v-if="readout.more > 0" class="readout-row readout-more">
                {{ moreText(readout.more) }}
              </p>
            </div>
          </div>
        </div>
        <p v-else-if="errorMessage === ''" class="pending">Loading the panel</p>
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

/*
 * The box the figure and the overlay of the cursor share. The overlay is laid
 * out in its pixels and takes no pointer event of its own, so the readout
 * never stands between the pointer and the figure it reads out. It carries the
 * font of the readout, which the script reads off it, so the size which places
 * the box and the size which draws it are the same size.
 */
.plot {
  position: relative;
  width: 100%;
  min-width: 0;
  font-size: var(--_font-size-small);
}

.cursor {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.crosshair {
  position: absolute;
  width: 0;
  border-left: 1px dashed var(--_fg-soft);
}

.dot {
  position: absolute;
  width: 7px;
  height: 7px;
  margin: -4px 0 0 -4px;
  border: 1px solid var(--_bg-card);
  border-radius: 50%;
}

/*
 * The box of the readout. Every number which places it the script hands to it
 * as a custom property, so the box which was measured and the box which is
 * drawn are built of one set of numbers, which no stylesheet can drift from.
 */
.readout {
  position: absolute;
  box-sizing: border-box;
  padding: var(--readout-pad);
  overflow: hidden;
  border: var(--readout-border) solid var(--_line);
  border-radius: 6px;
  background: var(--_bg-card);
  box-shadow: var(--_shadow);
  color: var(--_fg);
  line-height: var(--readout-line);
}

.readout-time {
  margin: 0;
  color: var(--_fg-soft);
  font-family: var(--_font-mono);
  white-space: nowrap;
}

.readout-row {
  display: flex;
  gap: var(--readout-gap);
  align-items: center;
  margin: 0;
}

/* the row is counted with the room of a swatch, so it starts where a label does */
.readout-more {
  padding-left: calc(var(--readout-swatch) + var(--readout-gap));
  color: var(--_fg-soft);
  /* the row is one line of the box: a card too narrow to hold it must not
     wrap it onto a second line, which the box has no room for, so it is
     cut with an ellipsis as a label of the rows above it is */
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.readout-swatch {
  flex: 0 0 auto;
  width: var(--readout-swatch);
  height: var(--readout-swatch);
  border-radius: 50%;
}

.readout-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.readout-value {
  margin-left: auto;
  font-family: var(--_font-mono);
  white-space: nowrap;
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
