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
 * ## Knobs the host owns
 *
 * The attribute `values` hands knobs to the page: a JSON object of knob id to
 * number, whose knobs the panel sets to those values and draws no control of.
 * The shell of an app writes it for a knob more than one panel of its page
 * declares, which it draws one control of above its grid, so the panels of a
 * page are of one state; a slide writes it to pin a panel at one dose with no
 * control at all. A change of it is taken as a release of each knob which
 * moved, by the rule above: the gridded knob is read out of the grid, any other
 * one schedules one run which grids over it, and after a failed run every move
 * runs again. Without the attribute, and with one which cannot be read, the
 * panel is the panel which was never given one: it draws every control it
 * declares, and a knob the host owned and owns no more is back at its default.
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
 * element shows the stored result if it has one, writes one line a reader can
 * act on and dispatches `sbmlsim-error` so that the page can react.
 * `activate()` resolves either way and never rejects.
 *
 * A failure is no freeze: the knobs stay where they are and keep working, and
 * the next move of any knob, of a control of the panel or of its host, runs
 * again, the knob the drawn grid covers among them, since the run which failed
 * covered nothing; so does a switch of the variant. Until a run answers, the
 * figure is drawn only while the answer it holds is of the state the knobs and
 * the attribute `variant` show (`stale`); where a knob or the variant stands
 * elsewhere, the panel draws no figure and its line says that the figure of the
 * settings shown cannot be drawn, so it never shows a state no control shows.
 * A change of `endpoint`, `model`, `panel` or `variant` after the panel started
 * starts it again (`restart`), so it never draws an answer of another one
 * either, nor a figure of the declaration of one variant and the study data of
 * another.
 * `freeze()` is the one stop of a panel, the one a shell makes of the panels of
 * a page it leaves.
 *
 * Every successful simulation is announced with `sbmlsim-result`, never a
 * failure and never the stored fallback, which is no simulation. Its
 * `detail` carries its `provenance` and its `spec_hash`, so a page, and the
 * shell of an app (`SbmlsimApp.ce.vue`), can say which versions simulated what
 * it shows without reading into the panel.
 *
 * A page which cannot run a script of its own writes the boolean attribute
 * `auto`, which calls `activate()` when the element is connected; without it
 * the element does nothing until the page asks, which is what a deck needs.
 * What `auto` does is decided by its presence when the element is mounted and
 * by nothing after it: `auto="false"` still starts the element, since the
 * attribute is there; `auto` added by a script to an element which is
 * connected already does nothing; and an element which is disconnected and
 * connected again, not within one task, is mounted again and so starts again,
 * with a fresh set of requests. A page which wants any other moment calls
 * `activate()` itself.
 *
 * The stored result (`fallback`) is a file next to the page and is therefore
 * fetched on `activate()` alongside the declaration and not when a request
 * fails: an endpoint which cannot be reached cannot serve the fallback either.
 * It must be an answer of the panel at the values its declaration states for
 * its knobs, since the payload of an answer carries no knob state and is
 * therefore read at those defaults, see the prop `fallback`.
 */

import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
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
import KnobControl from './KnobControl.ce.vue'
import ResetButton from './ResetButton.ce.vue'
import {
  carries,
  hostValues,
  keepControlKeys,
  knobsOf,
  ownValue,
  shortNumber,
  snapValue,
  validValue,
} from './knob'
import { canvasMeasure, fontOf, probeFont, whenFontArrives } from './measure'
import { plotGeometry, plotSvg, seriesColour, tableMeasure } from './plot'
import type {
  AxisEnds,
  FontSizes,
  Limits,
  PlotGeometry,
  PlotSpec,
  Points,
  Series,
  TextMeasure,
} from './plot'

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

/** The study data of the panel, resolved against the answer and the curves. */
interface ResolvedData {
  /**
   * The series the panel can draw, whatever the knobs are at, in the order of
   * the answer.
   *
   * It is what the frame of the value axis and the room of the legend are held
   * open by: a series which appears when a reader reaches the state it was
   * measured under must not move the axis or the plot box when it appears, and
   * must not be outside of the axis before it does.
   */
  resolved: Points[]
  /** The ones which are drawn under no state, with the reason. */
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
/** The significant digits the seconds of the provenance footer are shown with. */
const SECOND_DIGITS = 2
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
 * The box is sized by its rows as they are drawn: the labels measured in the
 * font of the panel and the values and the time in the mono font, both at the
 * size its box carries (`measure`, `monoMeasure`), so a host whose font is wide
 * gets a box as wide as its rows. The size itself is read off the element
 * (`fontSizeOf`), so a host which sets `--sbmlsim-font-size-small` gets a box
 * and rows of that size, and this is the value of the design for an
 * environment which computes no style.
 */
const READOUT_FONT = 11
/** The pixels between the label of a row and its value. */
const READOUT_COLUMN = 8
/** The smallest box the readout is drawn in, in pixels. */
const READOUT_MIN = 56
/** The significant digits a value of the readout is shown with. */
const READOUT_DIGITS = 4
/** What the error line adds where the figure of the state of the knobs cannot be drawn, see `stale`. */
const STALE_MESSAGE = 'The figure of the settings shown cannot be drawn.'
/** What a value which is no number is shown as, e.g. a point which did not integrate. */
const NO_VALUE = '-'

const props = defineProps({
  /** The endpoint of the service, e.g. `https://models.example.org`; empty is the origin of the page. */
  endpoint: { type: String, default: '' },
  /** The id of the model, as the endpoint serves it. */
  model: { type: String, default: '' },
  /** The id of the panel of that model. */
  panel: { type: String, default: '' },
  /**
   * The variant of the model to simulate, which an app switches between; empty
   * is the one the panel declares. The declaration and the study data are read
   * in it, since they may differ by the variant, and a change of it starts the
   * panel again in the new variant (`restart`).
   */
  variant: { type: String, default: '' },
  /**
   * The knobs the host of the panel owns, a JSON object of knob id to number,
   * e.g. `{"dose": 25}`; absent or empty is none.
   *
   * The panel sets those knobs to those values, draws no control for them, and
   * follows when the attribute changes, as it follows a release of its own
   * control of the knob (`takeHostValues`). An id the panel does not declare is
   * ignored. Text which is no JSON object, or whose values are not all finite
   * numbers, is said once on the console and leaves the panel as it is without
   * the attribute. A shell of an app writes it for the knobs more than one
   * panel of its page declares, which it draws one control of; a slide can pin
   * a panel at one dose and show no control at all.
   *
   * It has no default text, which the element would write onto itself as an
   * empty attribute: a panel the page gives no `values` carries none.
   */
  values: { type: String, default: undefined },
  /**
   * The head the panel shows until it has read its declaration, a JSON object
   * of its `title` and its `subtitle`: the shell of an app gives every panel
   * the head the app names for it (`heads`), so a card shows the head of the
   * variant it is switched to at once and not a blank one while the panel
   * reads its declaration. A text which cannot be read is as if it were absent.
   */
  head: { type: String, default: undefined },
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
  /**
   * The url of a stored answer of a run, drawn when the endpoint does not
   * answer.
   *
   * It must be an answer of this panel at the values its declaration states for
   * its knobs. The payload of an answer carries no state of the knobs - its
   * provenance names the model, the variant, the engine, the seconds and the
   * moment it was created, and its `dims` name the gridded axis alone - so the
   * element reads a stored answer at those declared defaults and cannot know of
   * one which was computed at another state: such a fallback is drawn as if it
   * were the default state, and nothing here can notice it.
   */
  fallback: { type: String, default: '' },
  /** The milliseconds one request is given before it is stopped. */
  timeout: { type: Number, default: DEFAULT_TIMEOUT },
  /**
   * The level the title of the panel is drawn at, 2 by default. A page which
   * puts a panel under a heading of its own writes the level below it, so the
   * outline of the document does not step.
   */
  headingLevel: { type: Number, default: 2 },
  /**
   * Whether the element starts itself when it is connected, as if the page had
   * called `activate()`. It is off by default, because a deck has every slide
   * in the page at once and an element which started itself would fetch for the
   * slides nobody has shown; a page which has one panel, and cannot run a
   * script of its own, switches it on. `activate()`, `freeze()` and `reset()`
   * work as they do without it.
   */
  auto: { type: Boolean, default: false },
})

const host = useHost()
const root = useTemplateRef<HTMLElement>('root')
const plotted = useTemplateRef<HTMLElement>('plotted')

/**
 * How wide a text of the figure is drawn, `null` where the page cannot measure.
 *
 * It is built on canvas in the font of the panel, which is the font of the
 * figure: the figure writes `var(--sbmlsim-font, ...)`, which `.figure-svg`
 * sets to the font `.panel` resolves, and inherits the weight and the style of
 * `.panel`. Without a canvas the figure is laid out with the table of the
 * renderer. It is built once, when the panel is first drawn, and once more
 * when the font, which may still have been loading then, has arrived; a new
 * measure is a new spec, so that is one layout and not one per font event.
 */
const measure = shallowRef<TextMeasure | null>(null)
/**
 * How wide a text of the mono font of the readout is drawn, `null` where the
 * page cannot measure; built as `measure` is, in the font `--sbmlsim-font-mono`
 * resolves to, and once more when that font arrives.
 */
const monoMeasure = shallowRef<TextMeasure | null>(null)
/**
 * The sizes the text of the figure is drawn in, `null` before they were read.
 *
 * The labels of the axes are drawn in `--sbmlsim-font-size`, the size of
 * `.panel`, and the tick labels, the legend and the colour bar in
 * `--sbmlsim-font-size-small`, which a probe in `.panel` resolves as the
 * figure does, a host's token and an `em` or a `rem` among them. The figure is
 * laid out in them, so a host which sets the tokens gets a figure whose text
 * fits it.
 */
const fontSizes = shallowRef<FontSizes | null>(null)
/** Whether the measures were built, which happens once for the life of the element. */
let measuring = false

watch(root, (box) => {
  if (box === null || measuring) {
    return
  }
  measuring = true
  const small = probeFont(box, { 'font-size': 'var(--_font-size-small)' })
  const label = Number.parseFloat(globalThis.getComputedStyle(box).fontSize)
  if (small !== null && Number.isFinite(label) && label > 0) {
    fontSizes.value = { label, small: small.size }
  }
  const font = fontOf(box)
  if (font !== null) {
    measure.value = canvasMeasure(font)
    whenFontArrives(font, () => {
      measure.value = canvasMeasure(font)
    })
  }
  const mono = probeFont(box, { 'font-family': 'var(--_font-mono)' })?.font ?? null
  if (mono !== null) {
    monoMeasure.value = canvasMeasure(mono)
    whenFontArrives(mono, () => {
      monoMeasure.value = canvasMeasure(mono)
    })
  }
})

/** Whether `activate()` has run, which is what makes the element draw anything. */
const active = ref(false)
/** Whether a request is in flight, which the figure says with `aria-busy`. */
const pending = ref(false)
/** Whether the panel is stopped by `freeze()`, which `activate()` lifts; a failure is none. */
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
const knobValues = shallowRef<Record<string, number>>({})
/**
 * The value of every knob the drawn answer was run at, `{}` until one is.
 *
 * It is the state the figure represents, which a control runs ahead of: a
 * control changes at once, the run of it is debounced and answered a round
 * trip later, and the figure follows a knob in between only where the answer
 * grids over it. Anything which says something about the drawn curves, i.e.
 * the condition of a series of the study data, is read from here and not from
 * the controls.
 *
 * It is `null` while the drawn answer is the stored one: a fallback is an
 * answer of the panel which was computed before the page was opened, its
 * payload carries no knob values and this element cannot know which run it
 * was, so the state it is read at is the one the panel is declared with. That
 * is resolved where it is read and not where it is set, because the stored
 * answer can be drawn before the declaration which carries those defaults has
 * arrived.
 */
const drawnValues = shallowRef<Record<string, number> | null>({})
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
 * Whether the panel dropped a figure it drew when its variant was switched,
 * and has drawn none of the new variant since.
 *
 * A switch of the variant starts the panel again (`restart`), so the figure
 * of the variant before is gone and not held; a run of the new variant which
 * fails then says that the figure of the settings shown cannot be drawn, as a
 * panel which held a figure of another state says it, and not only that the
 * endpoint failed.
 */
const dropped = ref(false)
/**
 * The figure of the variant before a switch, which the panel holds until it
 * draws one of the new variant, empty while it holds none.
 *
 * A reader switches the variant to compare two figures, so the one before
 * stays where it was, dimmed, inert and hidden from a screen reader, and is
 * never presented as a figure of the variant after (the shell names the
 * variant it is switched to above it). It is dropped when the first figure of
 * the new variant is drawn and at once when that fails (`fail`), so no figure
 * of a state no control shows is ever drawn as current.
 */
const held = shallowRef('')
/**
 * The declaration of the variant before a switch, which the panel draws its
 * controls and, without a `head` attribute, its head of until the declaration
 * of the new variant arrives, so its height does not change under the reader;
 * `null` while it holds none.
 */
const heldDeclaration = shallowRef<PanelDeclaration | null>(null)
/** The provenance line of the figure the panel holds, dimmed with it, empty while it holds none. */
const heldFoot = ref('')
/**
 * The study data of the panel, `null` until it arrived.
 *
 * It is read once per declaration: it is the data of a study and depends on
 * no knob, so a panel which has it never asks for it again until it reads its
 * declaration again, for another variant or another panel.
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
/**
 * The start of the panel the reads in flight belong to, counted up by
 * `restart`: a declaration, study data or a stored answer which arrives for a
 * start before is of another variant, model or panel and is dropped.
 */
let generation = 0
/**
 * What a run of the declaration which is read waits for before its answer is
 * drawn: its study data where that data holds the value axis (`framedBy`),
 * settled at once otherwise. Every run waits for it, the first one of `load`
 * and one a knob or a host starts before the data is in alike.
 */
let framing: Promise<void> = Promise.resolve()
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
 * Get the place of every declared series among the series of its curve.
 *
 * The shape of a marker is that place, so a series keeps its shape whatever
 * the state of the knobs leaves out of the figure.
 *
 * @param declared the series the panel declares, in their order
 * @returns the place of every one of them by its id, counted per curve
 */
function declaredRanks(declared: PanelDataDeclaration[]): Map<string, number> {
  const counted = new Map<string, number>()
  const ranks = new Map<string, number>()
  for (const one of declared) {
    const curve = one.curve ?? one.id
    const next = counted.get(curve) ?? 0
    counted.set(curve, next + 1)
    ranks.set(one.id, next)
  }
  return ranks
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

/** What the attribute `values` says, read once per text of it. */
const hosted = computed(() => hostValues(props.values))

/** The value of every knob the host sets, by its id; ids the panel does not declare among them. */
const ownedValues = computed<Record<string, number>>(() =>
  hosted.value.kind === 'given' ? hosted.value.values : {},
)

/** The knobs the panel draws a control of: the ones its host does not own. */
const shownAxes = computed<PanelAxis[]>(() =>
  axes.value.filter((one) => !Object.hasOwn(ownedValues.value, one.id)),
)

/**
 * The knobs whose controls are drawn: the ones of the declaration, and while a
 * switch of the variant reads the declaration of the new one, the ones of the
 * variant before (`heldDeclaration`), which take no movement then, so the
 * panel keeps its controls and its height until the new declaration replaces
 * them.
 */
const drawnAxes = computed<PanelAxis[]>(() =>
  declaration.value !== null
    ? shownAxes.value
    : knobsOf(heldDeclaration.value).filter((one) => !Object.hasOwn(ownedValues.value, one.id)),
)

/** The head the attribute `head` gives, `null` for none or one which cannot be read. */
const givenHead = computed<{ title: string; subtitle: string } | null>(() => {
  const text = props.head
  if (text === undefined || text === '') {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) {
      return null
    }
    const fields = parsed as Record<string, unknown>
    return {
      title: typeof fields.title === 'string' ? fields.title : '',
      subtitle: typeof fields.subtitle === 'string' ? fields.subtitle : '',
    }
  } catch {
    return null
  }
})

/** The title of the panel, empty until the declaration was read. */
/**
 * The panel whose head is shown: the declaration, else the head the attribute
 * gives, else the declaration of the variant before a switch.
 */
const shownHead = computed<{ title: string; subtitle: string }>(() => {
  const declared = declaration.value ?? null
  if (declared !== null) {
    return { title: declared.panel.title, subtitle: declared.panel.subtitle }
  }
  const held = heldDeclaration.value
  return (
    givenHead.value ??
    (held === null
      ? { title: '', subtitle: '' }
      : { title: held.panel.title, subtitle: held.panel.subtitle })
  )
})

const title = computed<string>(() => shownHead.value.title)

/** The question the panel answers, empty for a panel without one. */
const subtitle = computed<string>(() => shownHead.value.subtitle)

/** The heading the title is drawn as, `h2` unless the page asks for another. */
const headingTag = computed<string>(() => {
  const asked = Math.round(props.headingLevel)
  const level = Number.isFinite(asked) ? clamp(asked, LEAST_HEADING, MOST_HEADING) : DEFAULT_HEADING
  return `h${String(level)}`
})

/** The width the element has, the default before anything was measured. */
const available = computed<number>(() => (measured.value > 0 ? measured.value : DEFAULT_WIDTH))

/**
 * Whether `reset()` would change something a reader sees: a knob of the
 * panel's own away from its default, or the scale of the y axis away from the
 * one its curves declare. A knob the host owns is no knob of the panel's to
 * reset, so a panel whose host owns every knob it declares resets its scale.
 */
const resettable = computed<boolean>(() => {
  const declared = declaration.value
  if (declared === null) {
    return false
  }
  return (
    logY.value !== initialLog(declared) ||
    shownAxes.value.some((one) => ownValue(knobValues.value, one.id) !== one.default)
  )
})

/**
 * The layout which is drawn: the one the attribute asks for, or the one the
 * room allows.
 *
 * A panel without a control of a knob - a panel which declares none, one whose
 * host owns every knob it declares, and the stored answer of one whose
 * declaration never arrived - has nothing to put beside its figure, so it
 * takes the toolbar whatever was asked for.
 */
const drawnLayout = computed<DrawnLayout>(() => {
  if (drawnAxes.value.length === 0) {
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
 * The label of the y axis, the one the panel declares or the one of its curves.
 *
 * A panel which declares none leaves the label to the element: one curve lends
 * the axis its own and several curves, whose names are in the legend, take
 * `GENERIC_Y`. The renderer appends the unit the curves share whichever of the
 * three it is, so a declared label carries no unit of its own, and the label is
 * the name a reader who does not see the figure is given for the axis, so an
 * empty one is no option.
 */
const yLabel = computed<string>(() => {
  const declared = declaration.value?.panel.y_label
  if (declared !== undefined && declared !== '') {
    return declared
  }
  const drawn = drawnCurves.value
  const only = drawn.length === 1 ? drawn[0]?.label : undefined
  return only === undefined || only === '' ? GENERIC_Y : only
})

/**
 * Get the value of a knob the figure is drawn at.
 *
 * The answer which is drawn grids over at most one knob, and the figure reads
 * a movement of that knob out of the grid (`interpolate`), so the line is the
 * one of the value its control has now. Every other knob is the one the answer
 * was run at and not the one its control is at: the control runs ahead of the
 * figure by the debounce and a round trip, and a figure which failed keeps the
 * answer it had, so the value of the control says nothing about what is drawn.
 *
 * A stored answer is read at the values the panel declares, see
 * `drawnValues`.
 *
 * @param id the id of the knob
 * @returns its value, its default where the figure is the stored answer or
 *   nothing is drawn yet; `null` for an id which is no knob of the panel and
 *   for a knob the state of the drawn run does not carry, neither of which any
 *   declared state matches
 */
function drawnValue(id: string): number | null {
  const knob = axes.value.find((one) => one.id === id)
  if (knob === undefined) {
    return null
  }
  const answer = grid.value
  if (answer === null || answer.dims.some((dim) => dim.id === id)) {
    const held = ownValue(knobValues.value, id)
    return held === undefined || !Number.isFinite(held) ? knob.default : held
  }
  const at = drawnValues.value
  if (at === null) {
    return knob.default
  }
  const value = at[id]
  return value === undefined || !Number.isFinite(value) ? null : value
}

/**
 * Get whether the knobs are at the state a series of the study data declares.
 *
 * The numbers are compared as they are: the value of the state and the value
 * of the knob are the two sides of one declaration, a choice of that knob, and
 * never a value a reader typed or an arithmetic of this element.
 *
 * @param declared the declaration of the series, `undefined` for a series the
 *   declaration does not carry
 * @returns whether every knob the series names is at the value it names; a
 *   series which names none is at every state
 */
function atState(declared: PanelDataDeclaration | undefined): boolean {
  const state = declared?.at
  if (state === undefined || state === null) {
    return true
  }
  return Object.entries(state).every(([id, value]) => drawnValue(id) === value)
}

/**
 * Get whether the knobs a run does not grid over are at the state a series names.
 *
 * It is the half of `atState` the frame of the value axis reads: the knob a run
 * grids over moves inside one answer and the frame has to hold still across
 * that movement, so the part of a state which names it is left out, while every
 * other knob is a state the reader chose and its answer is a quantity of its
 * own.
 *
 * @param declared the declaration of the series, `undefined` for a series the
 *   declaration does not carry
 * @param swept the ids of the knobs the drawn answer grids over
 * @returns whether every knob the series names, other than those, is at the
 *   value it names; a series which names none is at every state
 */
function admitted(declared: PanelDataDeclaration | undefined, swept: Set<string>): boolean {
  const state = declared?.at
  if (state === undefined || state === null) {
    return true
  }
  return Object.entries(state).every(([id, value]) => swept.has(id) || drawnValue(id) === value)
}

/**
 * The study data of the panel, resolved against the answer.
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
 * A series which was measured under a state of the knobs (`at`) is none of the
 * three: it is data of a condition the figure does not show right now, not a
 * series the panel cannot draw, so nothing is said about it, it stays in
 * `resolved`, which holds the legend open for it, and `drawnData` below is
 * where the state of the knobs decides whether it is drawn (`drawnValue`) and
 * `frame` whether it holds the value axis open (`admitted`).
 *
 * This is a view of the answer and nothing else: it reads no knob, so it runs
 * once per answer and not once per movement of a knob. What a reader is told
 * about a dropped series is said by the watcher below, where a side effect runs
 * once.
 */
const resolvedData = computed<ResolvedData>(() => {
  const answer = grid.value
  if (answer === null || props.data === 'off') {
    return { resolved: [], dropped: [] }
  }
  const given = dataOf(declaration.value)
  const declared = new Map(given.map((one) => [one.id, one]))
  const ranks = declaredRanks(given)
  const units = new Map(drawnCurves.value.map((one) => [one.id, one.unit]))
  const resolved: Points[] = []
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
    // the label the declaration gives it, which its legend was laid out with
    const label = declared.get(one.id)?.label ?? one.label
    const points: Points = { id: one.id, label, curve, x: one.x, y: one.y }
    const rank = ranks.get(one.id)
    if (rank !== undefined) {
      points.rank = rank
    }
    const errors = one.yerr
    if (Array.isArray(errors)) {
      points.yerr = errors.map((value) => (typeof value === 'number' ? value : Number.NaN))
    }
    resolved.push(points)
  }
  return { resolved, dropped }
})

/**
 * The study data as it is drawn, empty while there is none to draw.
 *
 * It is the only part of the study data which depends on where the knobs are,
 * which is why it is a computed of its own: the resolution above it runs once
 * per answer, this one filter runs per movement of a knob.
 */
const drawnData = computed<Points[]>(() => {
  const declared = new Map(dataOf(declaration.value).map((one) => [one.id, one]))
  return resolvedData.value.resolved.filter((one) => atState(declared.get(one.id)))
})

/**
 * The legends of study data the panel can draw, one per state of its knobs.
 *
 * Which series are drawn is a function of the state of the knobs alone: a
 * series is drawn when every knob its `at` names is at the value it names.
 * The states which tell the legends apart are, per knob some `at` names, the
 * values the declarations name and one value none of them names, the state
 * where none of those series is drawn; a knob no `at` names draws the same
 * series at every value. Each state gives the labels of its series in the
 * order the panel declares them, and the legend of the figure is laid out over
 * all of them and drawn with the one of the state the figure is at, so the
 * plot box of a panel is the same box whichever state it is at, and it is the
 * box of the largest legend one state draws and not of every series at once:
 * four arms of one study, of which a state draws one, keep the room of one.
 *
 * The legends are the ones the declaration says the panel may draw: the labels
 * and the states of its declared series, none while the data is switched off,
 * and never the series the endpoint answered. The declaration is read before
 * the first figure, so the legend a panel reserves is there from its first
 * frame whether the study data arrives before the run or after it, and a
 * series the panel then cannot draw, e.g. one of another unit, keeps the room
 * it was declared with. The answer of the data decides which points are drawn
 * and nothing of the frame. It reads no knob, so it runs once per declaration.
 */
const declaredLegends = computed<string[][]>(() => {
  const resolved = props.data === 'off' ? [] : dataOf(declaration.value)
  const conditions = resolved.map((one) => Object.entries(one.at ?? {}))
  const named = new Map<string, number[]>()
  for (const [id, value] of conditions.flat()) {
    const values = named.get(id) ?? []
    if (!values.includes(value)) {
      named.set(id, [...values, value])
    }
  }
  // `null` is the value of a knob which none of the declarations names
  let states = [new Map<string, number | null>()]
  for (const [id, values] of named) {
    states = states.flatMap((state) =>
      [...values, null].map((value) => new Map(state).set(id, value)),
    )
  }
  const legends = new Map<string, string[]>()
  for (const state of states) {
    const labels = resolved
      .filter((_, index) =>
        (conditions[index] ?? []).every(([id, value]) => state.get(id) === value),
      )
      .map((one) => one.label)
    legends.set(JSON.stringify(labels), labels)
  }
  return [...legends.values()]
})

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

/**
 * The ends of the value axis the panel declares, which are the ends of the
 * axis exactly whatever the knobs are at, so two of their states are drawn
 * against one axis; none for a panel which declares none, whose axis is the
 * frame of its answer.
 */
const yEnds = computed<AxisEnds>(() => {
  const texts = declaration.value?.panel
  const ends: AxisEnds = {}
  if (typeof texts?.y_min === 'number' && Number.isFinite(texts.y_min)) {
    ends.low = texts.y_min
  }
  if (typeof texts?.y_max === 'number' && Number.isFinite(texts.y_max)) {
    ends.high = texts.y_max
  }
  return ends
})

/** The end of the time axis the panel declares, `null` for the end of its simulation. */
const xEnd = computed<number | null>(() => {
  const end = declaration.value?.panel.x_max
  return typeof end === 'number' && Number.isFinite(end) ? end : null
})

/**
 * The values the y axis of the figure holds, `null` while there are none.
 *
 * The figure draws one line per curve, interpolated out of the answer at the
 * value the gridded knob has now, and a model which answers a knob
 * proportionally draws the same line inside a frame which follows it: the knob
 * moves and the figure redraws pixel for pixel the same curve with other
 * numbers on its axis. The frame is therefore taken over the whole answer -
 * every point of the grid of every drawn curve - and over every series of the
 * study data the panel can draw whose state the knobs the answer does not grid
 * over are at, whatever its state of the gridded knob (`admitted`), so a line
 * moves inside an axis which holds still and a series which appears as the
 * gridded knob reaches its condition neither moves the axis nor sits outside of
 * it. A series of a state another knob is not at is data of another quantity
 * of the figure, e.g. of another dose, and holds nothing open: the reader moved
 * that knob, the answer is a new one, and so is its frame. A line which is
 * drawn is a weighted mean of the points of the grid which bound it, so it is
 * always inside the frame.
 *
 * A new answer is a new frame, which is right: a grid covers the knob which is
 * being moved, and the axis has to hold still across that movement and not
 * across a simulation of another state.
 *
 * A series beyond the x of the curves is no point of the figure, as the
 * renderer has it, so it holds nothing open either, and the error of a point is
 * part of it, since the bar is drawn and an axis which cuts a bar is an axis
 * which lies. A value which is not positive is no value of a logarithmic frame:
 * a curve of a dose starts at zero, and a frame which held that zero would hold
 * one positive value and fall back to the decade around it, which puts the
 * curve below the box.
 *
 * It is computed once per answer: it reads the answer, the curves of the
 * declaration, the scale of the axis and the state the answer was run at, and
 * no control. Where the gridded knob is decides which series are drawn
 * (`drawnData`) and nothing of the frame, so moving it is one interpolation and
 * not a pass over the whole grid.
 */
const frame = computed<Limits | null>(() => {
  const answer = grid.value
  if (answer === null) {
    return null
  }
  const log = logY.value
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  const hold = (value: number | null | undefined): void => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return
    }
    if (log && value <= 0) {
      return
    }
    low = Math.min(low, value)
    high = Math.max(high, value)
  }
  // the x the figure draws: the x axis of a panel which declares its end
  // ends there, and nothing beyond it is drawn or holds the frame open
  const end = xEnd.value ?? Number.POSITIVE_INFINITY
  const failed = new Set(answer.status.failed)
  for (const one of drawnCurves.value) {
    const rows = answer.curves[one.id] ?? []
    for (let index = 0; index < rows.length; index += 1) {
      if (failed.has(index)) {
        continue
      }
      // the row is read by its index, as `interpolate` reads it: the payload
      // types a row as a list of numbers and nulls, a hand written answer may
      // carry something else where a row belongs, and a figure which draws the
      // rows it can read is worth more there than one which blanks
      for (const [column, value] of (rows[index] ?? []).entries()) {
        if (!((answer.x[column] ?? Number.NEGATIVE_INFINITY) > end)) {
          hold(value)
        }
      }
    }
  }
  // the x the curves cover up to the end of the axis, which is what the
  // renderer clips a series to (`xRange`): a figure whose answer carries no x
  // clips nothing
  let first = Number.POSITIVE_INFINITY
  let last = Number.NEGATIVE_INFINITY
  for (const at of answer.x) {
    if (Number.isFinite(at)) {
      first = Math.min(first, at)
      last = Math.max(last, at)
    }
  }
  last = Math.min(last, end)
  const clipped = Number.isFinite(first) && Number.isFinite(last)
  const swept = new Set(answer.dims.map((dim) => dim.id))
  const declared = new Map(dataOf(declaration.value).map((one) => [one.id, one]))
  for (const one of resolvedData.value.resolved) {
    if (!admitted(declared.get(one.id), swept)) {
      continue
    }
    for (const [index, value] of one.y.entries()) {
      const at = one.x[index]
      if (clipped && (at === undefined || !Number.isFinite(at) || at < first || at > last)) {
        continue
      }
      hold(value)
      const error = one.yerr?.[index]
      if (error !== undefined && Number.isFinite(error)) {
        hold(value - Math.abs(error))
        hold(value + Math.abs(error))
      }
    }
  }
  return Number.isFinite(low) && Number.isFinite(high) ? { low, high } : null
})

/** The figure as it is drawn now, `null` while there is nothing to draw. */
const plot = computed<PlotSpec | null>(() => {
  const answer = grid.value
  if (answer === null) {
    return null
  }
  const columns = interpolate(answer, knobValues.value)
  const series = drawnCurves.value.map((one): Series => {
    const drawn = {
      id: one.id,
      label: one.label,
      scale: one.scale,
      values: columns[one.id] ?? [],
    }
    return one.unit === null || one.unit === '' ? drawn : { ...drawn, unit: one.unit }
  })
  const held = frame.value
  const spec: PlotSpec = {
    x: answer.x,
    xLabel: xLabel.value,
    yLabel: yLabel.value,
    series,
    width: figureWidth.value,
    height: figureHeight.value,
    logY: logY.value,
    ...(held === null ? {} : { yLimits: held }),
    ...(yEnds.value.low === undefined && yEnds.value.high === undefined
      ? {}
      : { yEnds: yEnds.value }),
    ...(xEnd.value === null ? {} : { xEnd: xEnd.value }),
    ...(measure.value === null ? {} : { measure: measure.value }),
    ...(fontSizes.value === null ? {} : { fontSizes: fontSizes.value }),
  }
  const points = drawnData.value
  const legends = declaredLegends.value
  const whole = legends.some((one) => one.length > 0) ? { ...spec, declaredLegends: legends } : spec
  return points.length > 0 ? { ...whole, points } : whole
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

/**
 * Whether the answer which is drawn is of another state than the one the
 * knobs and the attributes show, after a run which failed.
 *
 * While runs answer, the figure runs behind a moved knob by a debounce and a
 * round trip at most. A run which failed leaves the answer before it, which may
 * be of another value of a knob it does not grid over: a knob of the host,
 * which the host keeps moving, or a control which was released into the
 * failure. Such a figure would show a state no control shows, so it is not
 * drawn, and the error line says that the panel cannot show the state it is
 * set to. The next run which answers draws it again; the knob the drawn answer
 * grids over is read out of the grid and never makes a figure stale. The
 * endpoint, the model, the panel and the variant, the other inputs of a run,
 * start the panel again when they change (`restart`), so no answer of another
 * one is held as current: a switch of the variant whose first run fails has
 * dropped its figure (`dropped`) and says the same.
 */
const stale = computed<boolean>(() => {
  const answer = grid.value
  if (failure.value !== null && answer === null && dropped.value) {
    return true
  }
  if (failure.value === null || answer === null) {
    return false
  }
  const swept = new Set(answer.dims.map((dim) => dim.id))
  return axes.value.some(
    (axis) =>
      !swept.has(axis.id) &&
      drawnValue(axis.id) !== (ownValue(knobValues.value, axis.id) ?? axis.default),
  )
})

/** The line a reader is shown about a failure, empty while nothing failed. */
const errorMessage = computed<string>(() => {
  if (failure.value !== null) {
    return stale.value
      ? `${FAILURE_MESSAGES[failure.value]} ${STALE_MESSAGE}`
      : FAILURE_MESSAGES[failure.value]
  }
  return drawFailed.value ? FAILURE_MESSAGES.internal : ''
})

/** The provenance footer: the engine, the short hash of the run and its seconds. */
const footer = computed<string>(() => {
  const answer = grid.value
  // the footer names the run of the figure, and a stale figure is not drawn
  if (answer === null || stale.value) {
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
 * @returns the pixels of its widest row with its padding and its border, its
 *   labels measured in the font of the panel and its values and its time in
 *   the mono font, each by the measure of the page and by the table of the
 *   renderer where the page has none
 */
function readoutRoom(time: string, rows: ReadoutRow[], more: number, font: number): number {
  const label = measure.value ?? tableMeasure
  const value = monoMeasure.value ?? tableMeasure
  const swatch = READOUT_SWATCH + READOUT_ROW_GAP
  let most = value(time, font)
  for (const one of rows) {
    const text = label(one.label, font) + value(one.value, font)
    most = Math.max(most, swatch + text + READOUT_COLUMN)
  }
  if (more > 0) {
    most = Math.max(most, swatch + label(moreText(more), font))
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
  // built of entries, so every knob id is a property of its own, `__proto__` among them
  const fixed: [string, number][] = []
  const over: [string, number][] = []
  for (const axis of axes.value) {
    if (axis.id === gridId) {
      over.push([axis.id, gridPoints(axis)])
      continue
    }
    const value = ownValue(knobValues.value, axis.id)
    fixed.push([axis.id, value === undefined || !Number.isFinite(value) ? axis.default : value])
  }
  return bodyOf(Object.fromEntries(fixed), Object.fromEntries(over))
}

/**
 * Get the body of a simulation of the values and the grid of a run.
 *
 * @param fixed the value of every knob the run does not grid over
 * @param over the points of the knob it grids over
 * @returns the body, with the variant the panel is given
 */
function bodyOf(fixed: Record<string, number>, over: Record<string, number>): SimulateRequest {
  return props.variant === ''
    ? { values: fixed, grid: over }
    : { values: fixed, grid: over, variant: props.variant }
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
 * Draw the stored answer of the `fallback` while nothing else is drawn.
 *
 * This is the one place a stored answer becomes the figure, so it is also the
 * one place which says what state that figure is read at: the values the panel
 * declares (`drawnValues`), since the payload of a stored answer carries the
 * provenance of its run and no knob values.
 *
 * @param answer the stored answer
 */
function drawStored(answer: SimulateResponse): void {
  if (grid.value !== null) {
    return
  }
  grid.value = answer
  drawnValues.value = null
  held.value = ''
  fromStore.value = true
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
  held.value = ''
  heldFoot.value = ''
  heldDeclaration.value = null
  const keep = stored.value
  if (keep !== null) {
    drawStored(keep)
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
  // the state of the run, taken once for the request and for the answer
  // alike: the body is built here and not in the closure below, which is
  // called again for a second attempt and would otherwise send the state of
  // whatever the controls hold by then, and the answer is drawn at the state
  // it was run at however the controls moved while it was in flight
  const sent = { ...knobValues.value }
  const body = bodyFor(gridId)
  try {
    const answer = await attempt(() =>
      talking.simulate(props.model, props.panel, body, controller.signal),
    )
    if (own !== sequence) {
      return
    }
    // a declaration whose value axis holds its study data draws its first
    // figure once the data has arrived or failed to (`framing`), whichever run
    // answers first, so the axis is laid out once over both
    await framing
    if (own !== sequence) {
      return
    }
    grid.value = answer
    drawnValues.value = sent
    fromStore.value = false
    failure.value = null
    dropped.value = false
    held.value = ''
    heldFoot.value = ''
    host?.dispatchEvent(
      new CustomEvent('sbmlsim-result', {
        detail: { provenance: answer.provenance, spec_hash: answer.spec_hash },
        bubbles: true,
        composed: true,
      }),
    )
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
  const own = generation
  try {
    const series = await attempt(() =>
      talking.data(props.model, props.panel, undefined, props.variant),
    )
    // the data of a declaration the panel no longer draws is no data of its figure
    if (own === generation) {
      study.value = series
    }
  } catch {
    // a panel whose study data cannot be read is a panel of its curves alone
  }
}

/**
 * Get whether the study data a declaration states can move the value axis of its figure.
 *
 * The value axis holds the study data the panel may draw (`frame`) unless the
 * declaration fixes both of its ends, on a logarithmic axis two positive ones.
 * The first figure of a declaration whose axis the data can move waits for the
 * data (`framing`), so the figure is laid out once and does not jump when the
 * data arrives after the run; a panel whose axis is fixed, or which reads no
 * data, draws its curves as soon as they run.
 *
 * @param declared the declaration of the panel
 * @returns whether its first figure waits for its study data
 */
function framedBy(declared: PanelDeclaration): boolean {
  if (props.data === 'off' || dataOf(declared).length === 0) {
    return false
  }
  const texts = declared.panel
  const low = texts.y_min
  const high = texts.y_max
  const fixed =
    typeof low === 'number' &&
    Number.isFinite(low) &&
    typeof high === 'number' &&
    Number.isFinite(high) &&
    (!initialLog(declared) || low > 0)
  return !fixed
}

/**
 * Read the declaration of the panel and run its first simulation.
 *
 * @returns when the first figure was drawn or the failure was resolved
 */
async function load(kept: Record<string, number> = {}): Promise<void> {
  const talking = client
  if (talking === null) {
    return
  }
  const own = generation
  try {
    const controller = new AbortController()
    flight = controller
    const declared = await attempt(() =>
      talking.panel(props.model, props.panel, controller.signal, props.variant),
    )
    if (own !== generation) {
      return
    }
    flight = null
    declaration.value = declared
    heldDeclaration.value = null
    knobValues.value = withHost(knobsOf(declared), (one) => {
      const value = ownValue(kept, one.id)
      return value !== undefined && validValue(one, value) ? snapValue(one, value) : one.default
    })
    logY.value = initialLog(declared)
    const data = loadData(declared)
    framing = framedBy(declared) ? data : Promise.resolve()
    await Promise.all([simulate(firstGridded(declared)), data])
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
  const own = generation
  try {
    const answer = await talking.stored(props.fallback)
    if (own !== generation) {
      return
    }
    stored.value = answer
    drawStored(answer)
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
 * Take the movement of a knob: interpolate and redraw, never fetch.
 *
 * @param axis the knob
 * @param value the value its control was moved to
 */
function onInput(axis: PanelAxis, value: number): void {
  knobValues.value = { ...knobValues.value, [axis.id]: value }
}

/**
 * Take the release of a knob: schedule a simulation unless the grid covers it.
 *
 * @param axis the knob
 * @param value the value its control was released at
 */
function onChange(axis: PanelAxis, value: number): void {
  knobValues.value = { ...knobValues.value, [axis.id]: value }
  if (frozen.value || !runsFor(axis.id)) {
    return
  }
  schedule(axis.id)
}

/**
 * Get whether a release of a knob runs a simulation.
 *
 * A knob the drawn grid covers is read out of it, unless the run before
 * failed: the answer which is drawn is then of another state of the other
 * knobs than the one the controls show, and only a run can draw that state.
 *
 * @param id the id of the knob
 * @returns whether a run is scheduled for it
 */
function runsFor(id: string): boolean {
  return failure.value !== null || id !== gridded.value
}

/**
 * Get the value of every knob the panel declares at the values of its host.
 *
 * A knob the host owns takes the value of the host and every other knob the
 * value it is given, which is its default when the panel starts or is reset
 * and the value its control holds when the host lets a knob go again.
 *
 * @param knobs the knobs of the declaration
 * @param own the value of every knob which is no knob of the host
 * @returns the value of every knob by its id
 */
function withHost(knobs: PanelAxis[], own: (axis: PanelAxis) => number): Record<string, number> {
  const given = ownedValues.value
  // a value of the host which is a number of the knob to the last bits is sent as that number
  return Object.fromEntries(
    knobs.map((one) => {
      const value = ownValue(given, one.id)
      return [one.id, value === undefined ? own(one) : snapValue(one, value)]
    }),
  )
}

/**
 * Take a change of the knobs the host owns as a release of each of them.
 *
 * A knob which the host moved is a knob a reader moved somewhere else on the
 * page, so it is taken as the release of the panel's own control would be
 * (`runsFor`): a knob the drawn grid covers is read out of it and costs
 * nothing, and any other knob which moved schedules one run, which grids over
 * it, so its next movement costs nothing either; after a failed run every move
 * runs again. Several knobs which moved at once are one run. A host which
 * writes its values on every movement of a slider pays one run for the first
 * movement of a knob no grid covers and none after it.
 *
 * A knob the host owned and owns no more, because the attribute no longer
 * names it or cannot be read, is the panel's own again and goes back to its
 * declared default, which is the knob of a panel which was never given it.
 *
 * @param given the value of every knob the host owns, by its id
 * @param before the value of every knob the host owned before
 */
function takeHostValues(given: Record<string, number>, before: Record<string, number>): void {
  const declared = declaration.value
  if (declared === null) {
    return
  }
  let changed = false
  let moved: string | null = null
  const next = { ...knobValues.value }
  for (const axis of knobsOf(declared)) {
    const owned = Object.hasOwn(given, axis.id)
    const released = !owned && Object.hasOwn(before, axis.id)
    const hosted = owned ? given[axis.id] : undefined
    const value =
      hosted !== undefined ? snapValue(axis, hosted) : released ? axis.default : undefined
    if (value === undefined || value === next[axis.id]) {
      continue
    }
    Object.defineProperty(next, axis.id, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    })
    changed = true
    if (runsFor(axis.id)) {
      moved = axis.id
    }
  }
  if (changed) {
    knobValues.value = next
  }
  if (moved !== null && !frozen.value) {
    schedule(moved)
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
 * Start the panel again for other attributes of what it runs.
 *
 * The endpoint, the model, the panel and the variant are what a declaration, a
 * run and the study data are of, so an answer of the ones before is no figure
 * of these: everything read of them is dropped and read again, and a read of
 * the start before which arrives late is dropped as well (`generation`). The
 * declaration of a panel may differ by the variant - its titles, its knobs, its
 * study data, its derived values - so a switch of the variant reads it again
 * like a switch of the panel does, and no figure is ever drawn with the
 * declaration of one variant and the data or the knobs of another. Such a
 * switch keeps the value of every knob of the panel's own which the new
 * declaration declares and takes, and says, should its first run fail, that
 * the figure of the settings shown cannot be drawn (`dropped`); the stored
 * answer of the `fallback`, which is of the declared variant, is read again
 * only for that variant. A panel which was not started yet reads them when it
 * is; a frozen panel reads them when it is activated again.
 *
 * @param variant whether it is a switch of the variant alone
 */
function restart(variant = false): void {
  if (!started) {
    return
  }
  const kept = variant ? { ...knobValues.value } : {}
  const current = svg.value !== '' && !stale.value && !fromStore.value
  const shown = current ? svg.value : held.value
  held.value = variant ? shown : ''
  heldFoot.value = variant ? (current ? footer.value : heldFoot.value) : ''
  heldDeclaration.value = variant ? (declaration.value ?? heldDeclaration.value) : null
  dropped.value = variant && (dropped.value || (grid.value !== null && !fromStore.value))
  stopWork()
  sequence += 1
  generation += 1
  pending.value = false
  declaration.value = null
  grid.value = null
  stored.value = null
  study.value = null
  // the controls of a switch of the variant keep the values they show until the
  // declaration of the new one arrives, which keeps the ones it takes
  knobValues.value = kept
  drawnValues.value = {}
  fromStore.value = false
  failure.value = null
  gridded.value = null
  pointer.value = null
  if (frozen.value) {
    started = false
    return
  }
  client = new PanelClient(props.endpoint, props.timeout)
  void Promise.all([variant && props.variant !== '' ? Promise.resolve() : loadStored(), load(kept)])
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
 * A knob the host owns (`values`) is no knob of the panel's to put back and
 * keeps the value of the host. The scale of the y axis goes back to the one
 * the curves declare as well. A
 * simulation is only run when the grid is no longer the one the panel started
 * with, since every other case is read out of the grid which is already here.
 */
function reset(): void {
  const declared = declaration.value
  if (declared === null) {
    return
  }
  knobValues.value = withHost(knobsOf(declared), (one) => one.default)
  logY.value = initialLog(declared)
  const first = firstGridded(declared)
  if (!frozen.value && (failure.value !== null || first !== gridded.value)) {
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

/*
 * The knobs of the host move as the host writes them. A text which says the
 * same values again, and a text which says none, moves nothing, so a host which
 * writes the attribute of every panel whenever one of its knobs moves costs a
 * panel which does not declare that knob nothing.
 */
watch(ownedValues, (given, before) => {
  takeHostValues(given, before)
})

/*
 * An attribute `values` which cannot be read is said once per text, on the
 * console, as a series the figure leaves out is: it is a mistake of the page
 * which wrote it and no failure of the panel, which is drawn as it is without
 * the attribute, so it is no `sbmlsim-error` and no line of the panel.
 */
watch(
  hosted,
  (read) => {
    if (read.kind === 'malformed') {
      console.warn(
        `sbmlsim-panel ${props.panel}: the attribute "values" ${read.reason}, so it is ` +
          'ignored; it is a JSON object of knob id to number.',
      )
    }
  },
  { immediate: true },
)

watch(
  () => [props.endpoint, props.model, props.panel],
  () => {
    restart()
  },
)

/*
 * The declaration of a panel may differ by the variant, so another variant
 * starts the panel again: its declaration and its study data are read for
 * that variant and its first run is of them (`restart`).
 */
watch(
  () => props.variant,
  () => {
    restart(true)
  },
)

onMounted(() => {
  if (props.auto) {
    void activate()
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
    part="panel"
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
        :class="{ 'control-row': drawnLayout !== 'sidebar' }"
        role="group"
        aria-label="Simulation settings"
        @keydown="keepControlKeys($event)"
      >
        <KnobControl
          v-for="axis of drawnAxes"
          :key="axis.id"
          :axis="axis"
          :value="ownValue(knobValues, axis.id) ?? axis.default"
          :disabled="frozen || declaration === null"
          @input="onInput(axis, $event)"
          @change="onChange(axis, $event)"
        />
        <!-- disabled with the knobs while no declaration is read, the first one or
             the one of a variant a reader switched to: a toggle made then would be
             undone by the declaration, which sets the axis it declares -->
        <div class="options">
          <div class="control-line">
            <label class="toggle">
              <input
                type="checkbox"
                :checked="logY"
                :disabled="frozen || declaration === null"
                @change="onLog($event)"
              />
              <span>logarithmic y</span>
            </label>
            <ResetButton
              :disabled="frozen || declaration === null"
              :idle="!resettable"
              @reset="reset()"
            />
          </div>
        </div>
      </div>
      <div
        part="figure"
        class="figure"
        :style="{ minHeight: `${figureHeight}px` }"
        :aria-busy="pending ? 'true' : 'false'"
      >
        <div
          v-if="svg !== '' && !stale"
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
        <!-- the figure of the variant before a switch, held until the new one is drawn;
             the renderer built the string and escaped every text of it -->
        <!-- eslint-disable vue/no-v-html -->
        <div
          v-else-if="held !== ''"
          class="figure-svg held"
          inert
          aria-hidden="true"
          v-html="held"
        ></div>
        <!-- eslint-enable vue/no-v-html -->
        <p v-else-if="errorMessage === ''" class="pending">Loading the panel</p>
      </div>
    </div>
    <div v-if="errorMessage !== '' || footer !== '' || heldFoot !== ''" part="foot" class="foot">
      <p v-if="errorMessage !== ''" class="error" role="alert">{{ errorMessage }}</p>
      <p v-if="footer !== ''" class="provenance">{{ footer }}</p>
      <!-- the provenance of the figure of the variant before a switch, which the
           panel holds, dimmed and hidden from a reader as that figure is -->
      <p v-else-if="heldFoot !== ''" class="provenance held" aria-hidden="true">{{ heldFoot }}</p>
    </div>
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
/*
 * The panel is a column of three parts, its head, its body and its foot (the
 * error line and the provenance), and each names the row it is (`grid-row`),
 * which does nothing in the column it is drawn in alone. The shell of an app
 * lays the panel out as a subgrid of the rows of its grid (`::part(panel)`), so
 * the heads of the panels of a row of the app share one row, the bodies the
 * next and the feet the last one, and the plots of a row line up whatever the
 * lines of the titles above them and whatever sits below them.
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
  grid-row: 1;
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
  grid-row: 2;
  gap: 16px;
  align-items: flex-start;
}

.foot {
  display: flex;
  grid-row: 3;
  flex-direction: column;
  gap: 8px;
}

.layout-sidebar .body {
  flex-direction: row;
}

.layout-sidebar .controls {
  display: flex;
  flex: 0 0 200px;
  flex-direction: column;
  gap: 10px;
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

/* the controls above or below the figure are a row of controls (`control.css`),
 * which places the options on the line of the selects beside knobs and at the
 * top of a line of their own by the layout alone */
.layout-stacked .controls,
.layout-toolbar .controls {
  width: 100%;
  /* the gap under the last line of the row is the gap of the body */
  margin-bottom: calc(-1 * var(--_line-gap));
}

.layout-stacked .figure {
  order: -1;
}

.options .control-line {
  display: flex;
  gap: 12px;
  align-items: center;
  height: var(--_control-height);
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

/* the figure of the variant before a switch, which is no figure of the state
 * the controls show: dimmed and taking no pointer */
.held {
  opacity: 0.35;
  pointer-events: none;
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
