/**
 * The figure of a panel: a plot specification in, one inline SVG string out.
 *
 * The renderer is pure. It touches no dom, no canvas and no plotting library,
 * it measures no glyph, and it draws the same bytes for the same spec, so the
 * same figure is built in a page, in a slide deck, in a test and in a worker.
 * Inline SVG keeps it crisp under the transform of a slide and lets a host
 * restyle it: every colour, font and stroke width of the output is a
 * `var(--sbmlsim-*, <fallback>)` whose fallback is the value of the sbmlsim
 * report style, so a page which never loaded `theme.css` still gets the figure
 * of the report, and a page which sets one token gets the figure in its own
 * colours.
 *
 * What it draws follows sbmlsim, so a web figure and a matplotlib figure of the
 * same data are the same figure:
 *
 * - a logarithmic axis spans at most `LOG_DECADES` below the largest value with
 *   the margin `AXIS_MARGIN` of its decades, the rule of
 *   `sbmlsim.plot.plotting.log_limits`; data within the decades keeps its own
 *   limits, which is the automatic limit of matplotlib with the same margin,
 * - the lines of a dimension get a legend up to `LEGEND_LIMIT` of them and a
 *   colour bar above it (`COLORBAR_FROM = 11` of `sbmlsim.plot.points`), whose
 *   tick labels are every point up to `MAX_TICKS` and every k-th above it,
 * - a line takes its colour from the colour map at its position, viridis over
 *   its first 85 % (`COLORMAP` and `_COLORMAP_END` of `sbmlsim.plot.points`),
 *   which `RAMP` carries as six anchors a `color-mix` reads between, so the
 *   curves, the legend swatches and the colour bar are one ramp of six tokens,
 * - the label of an axis is `<label> [<unit>]`, the `name` of an `Axis`.
 *
 * Numbers are short and stable: a coordinate is rounded to `COORD_DECIMALS`
 * decimals and written without trailing zeros (`-0` is `0`), a tick label to at
 * most six decimals, or to three significant digits in the exponential form
 * outside of `[1e-3, 1e5)`. Nothing of the output is ever `NaN`: a value which
 * is no finite number, and a value which is not positive on a logarithmic axis,
 * is no point of its path, which starts again with an `M` after the gap.
 */

/** One curve of a figure: the values of a selection over the x of its spec. */
export interface Series {
  /** The id of the curve, which the study data of a panel names to sit under it. */
  id: string
  /** Its entry in the legend. */
  label: string
  /** The unit of its values, absent for values which carry none. */
  unit?: string
  /** The scale its values are declared on; `PlotSpec.logY` is the axis which is drawn. */
  scale: 'linear' | 'log'
  /** Its values over `PlotSpec.x`, `NaN` where it has none. */
  values: number[]
}

/** One series of study data, drawn as markers under the curve of its id. */
export interface Points {
  /** The id of the series; the curve of the same id gives it its colour. */
  id: string
  /** Its entry in the legend. */
  label: string
  /** The x of its points, in the x of the figure. */
  x: number[]
  /** The value of its points, on the y of the figure. */
  y: number[]
  /** The error of every value, drawn as a bar; a point without one is `NaN`. */
  yerr?: number[]
}

/** Everything one figure draws. */
export interface PlotSpec {
  /** The x of every value of every series, the output times of a run. */
  x: number[]
  /** The label of the x axis, with its unit as the caller composed it. */
  xLabel: string
  /** The label of the y axis; the unit the series share is appended to it. */
  yLabel: string
  /** The curves in the order they are drawn, which is the order of their colours. */
  series: Series[]
  /** The study data drawn under the curves, none without. */
  points?: Points[]
  /** The width of the figure in pixels. */
  width: number
  /** The height of the figure in pixels. */
  height: number
  /** Whether the y axis is logarithmic. */
  logY: boolean
}

/** The decades of data a logarithmic axis shows, `LOG_DECADES` of sbmlsim. */
const LOG_DECADES = 6

/**
 * The margin of the limits of an axis, a share of its span on both sides, which
 * is the default margin of matplotlib and `AXIS_MARGIN` of sbmlsim.
 */
const AXIS_MARGIN = 0.05

/** The series which still get a legend; above them they get a colour bar. */
const LEGEND_LIMIT = 10

/** The most tick labels of a colour bar, `MAX_TICKS` of sbmlsim. */
const MAX_TICKS = 12

/** The decimals a coordinate of the output carries. */
const COORD_DECIMALS = 2

/** The anchors of the colour ramp: viridis over its first 85 %, as rgb. */
const RAMP = [
  'rgb(68 1 84)',
  'rgb(68 58 131)',
  'rgb(48 106 142)',
  'rgb(32 146 140)',
  'rgb(59 187 117)',
  'rgb(155 217 60)',
] as const

/** The fallback of every other token, the value of the sbmlsim report style. */
const TOKENS = {
  bg: 'rgb(255 255 255)',
  fg: 'rgb(27 31 36)',
  'fg-soft': 'rgb(91 100 114)',
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  'font-size': '12px',
  'font-size-small': '11px',
  'axis-width': '1px',
  'curve-width': '1.8px',
  'data-width': '1px',
} as const

/** The padding between the figure and what it draws, in pixels. */
const PAD = 8
/** The length of a tick, in pixels. */
const TICK = 4
/** The room left of the plot for the y label and its tick labels, in pixels. */
const LEFT = 64
/** The room above the plot, in pixels. */
const TOP = 14
/** The room below the plot for the x label and its tick labels, in pixels. */
const BOTTOM = 42
/** The room right of the plot for a legend, in pixels. */
const LEGEND_WIDTH = 132
/** The room right of the plot for a colour bar without a legend, in pixels. */
const COLOURBAR_WIDTH = 58
/** The width of the bar of a colour bar, in pixels. */
const COLOURBAR_BAR = 12
/** The gap between the plot and the column right of it, in pixels. */
const COLUMN_GAP = 12
/** The length of the line of a legend entry, in pixels. */
const SWATCH = 18
/** The height of a row of a legend, in pixels. */
const ROW = 18
/** The radius of the marker of a study point, in pixels. */
const MARKER = 3
/** The half width of the cap of an error bar, in pixels. */
const CAP = 3
/** The pixels a tick of the x axis is given, which is how many ticks it gets. */
const X_TICK_ROOM = 70
/** The pixels a tick of the y axis is given, which is how many ticks it gets. */
const Y_TICK_ROOM = 50
/** The fewest ticks an axis gets whatever its length. */
const LEAST_TICKS = 3
/** The most ticks an axis gets whatever its length. */
const MOST_TICKS = 8
/** The smallest plot box a figure keeps whatever its size, in pixels. */
const MIN_PLOT = 24
/** The size a figure falls back to for a width or a height which is no size. */
const DEFAULT_SIZE = 240
/** The gap between a tick and its label, in pixels. */
const LABEL_GAP = 3

/** The id of the gradient of the colour bar, the same ramp in every figure. */
const RAMP_ID = 'sbmlsim-plot-ramp'

/** The lower and the upper limit of an axis. */
interface Limits {
  /** The lower limit. */
  low: number
  /** The upper limit, greater than the lower one. */
  high: number
}

/** One axis of a figure: its limits, its ticks and the pixel of a value. */
interface Axis {
  /** Whether it is logarithmic. */
  log: boolean
  /** Its limits. */
  limits: Limits
  /** Its ticks, in their order. */
  ticks: number[]
  /** Whether a value can be drawn on it at all. */
  drawable(value: number): boolean
  /** The pixel of a value, clamped to one length beyond the plot box. */
  position(value: number): number
}

/** One entry of a legend: a curve or a series of study data. */
interface Entry {
  /** The id of the curve or the series. */
  id: string
  /** The text of the entry. */
  label: string
  /** Its colour, a token or a mix of two of them. */
  colour: string
  /** Whether it is drawn as a line or as a marker. */
  marker: boolean
}

/**
 * Get a token of the design system with its fallback.
 *
 * @param name the name of the token without its `--sbmlsim-` prefix
 * @returns the `var()` a style of the output carries
 */
function token(name: keyof typeof TOKENS): string {
  return `var(--sbmlsim-${name}, ${TOKENS[name]})`
}

/**
 * Get an anchor of the colour ramp with its fallback.
 *
 * @param index the anchor, from 0; an index outside the ramp is its first
 * @returns the `var()` a style of the output carries
 */
function anchor(index: number): string {
  return `var(--sbmlsim-ramp-${String(index + 1)}, ${RAMP[index] ?? RAMP[0]})`
}

/**
 * Get the colour of the ramp at a position.
 *
 * The colour is the anchor at the position, or the `color-mix` of the two
 * anchors around it, so every colour of a figure follows the six tokens of the
 * ramp and a host which overrides one of them moves the curves and the colour
 * bar together.
 *
 * @param share the position in the ramp, from 0 to 1; one which is no number is
 *   its start
 * @returns the colour for a `fill` or a `stroke`
 */
function rampColour(share: number): string {
  const at = clamp(Number.isFinite(share) ? share : 0, 0, 1) * (RAMP.length - 1)
  const first = Math.min(RAMP.length - 2, Math.floor(at))
  const part = at - first
  if (part <= 0) {
    return anchor(first)
  }
  if (part >= 1) {
    return anchor(first + 1)
  }
  const percent = formatNumber((1 - part) * 100, 2)
  return `color-mix(in srgb, ${anchor(first)} ${percent}%, ${anchor(first + 1)})`
}

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
 * Get a width or a height of a figure.
 *
 * @param value the size the caller asked for
 * @returns the size in whole pixels, `DEFAULT_SIZE` for one which is no size
 */
function size(value: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.round(value) : DEFAULT_SIZE
}

/**
 * Write a coordinate of the output.
 *
 * @param value the coordinate in pixels
 * @returns it rounded to `COORD_DECIMALS` decimals, without trailing zeros and
 *   never `-0`; `0` for a value which is no finite number, which the callers
 *   never pass
 */
function coord(value: number): string {
  if (!Number.isFinite(value)) {
    return '0'
  }
  const factor = 10 ** COORD_DECIMALS
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/**
 * Write a number of a label.
 *
 * @param value the number
 * @param decimals the decimals it carries, at most six
 * @returns it without trailing zeros, in the exponential form of three
 *   significant digits outside of `[1e-3, 1e5)`
 */
function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) {
    return '0'
  }
  if (value === 0) {
    return '0'
  }
  const magnitude = Math.abs(value)
  const text =
    magnitude >= 1e5 || magnitude < 1e-3
      ? value.toExponential(2)
      : value.toFixed(clamp(Math.round(decimals), 0, 6))
  const short = text.replace(/(\.\d*?)0+(?=$|e)/, '$1').replace(/\.(?=$|e)/, '')
  return short === '-0' ? '0' : short
}

/**
 * Escape what a label carries so it is text of the output and not markup.
 *
 * @param text the label
 * @returns it with `&`, `<`, `>` and `"` as their entities
 */
function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Write one element of the output.
 *
 * @param name the name of the element
 * @param attributes its attributes; one which is `undefined` is left out and
 *   every value is escaped
 * @param children the children of the element, none for an empty element
 * @returns the element
 */
function tag(
  name: string,
  attributes: Record<string, string | number | undefined>,
  children?: string,
): string {
  const written = Object.entries(attributes)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ` ${key}="${escape(String(value))}"`)
    .join('')
  return children === undefined
    ? `<${name}${written}/>`
    : `<${name}${written}>${children}</${name}>`
}

/**
 * Write a text of the output.
 *
 * A text is placed and never measured: its anchor and its baseline put it
 * where it belongs without the width of a glyph.
 *
 * @param label the text, which is escaped
 * @param attributes the attributes of the element
 * @returns the element
 */
function text(label: string, attributes: Record<string, string | number | undefined>): string {
  return tag('text', attributes, escape(label))
}

/**
 * Get how many ticks an axis of a length is given.
 *
 * @param length the length of the axis in pixels
 * @param room the pixels one tick is given
 * @returns the ticks, between `LEAST_TICKS` and `MOST_TICKS`
 */
function tickCount(length: number, room: number): number {
  return clamp(Math.round(length / room), LEAST_TICKS, MOST_TICKS)
}

/**
 * Get the step of the ticks of a linear axis.
 *
 * @param span the span the ticks cover
 * @param count how many ticks are wanted
 * @returns the step, the nearest of 1, 2 and 5 times a power of ten
 */
function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count)
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const share = raw / magnitude
  const step = share <= 1.5 ? 1 : share <= 3 ? 2 : share <= 7 ? 5 : 10
  return step * magnitude
}

/**
 * Get the ticks of a linear axis.
 *
 * @param limits the limits of the axis
 * @param count how many ticks are wanted
 * @returns the ticks inside the limits, in their order
 */
function linearTicks(limits: Limits, count: number): number[] {
  const span = limits.high - limits.low
  if (!(span > 0)) {
    return [limits.low]
  }
  const step = niceStep(span, count)
  const first = Math.ceil(limits.low / step - 1e-9)
  const ticks: number[] = []
  for (let index = 0; index < 1000; index += 1) {
    const value = (first + index) * step
    if (value > limits.high + step * 1e-9) {
      break
    }
    ticks.push(value)
  }
  return ticks
}

/**
 * Get the ticks of a logarithmic axis.
 *
 * The ticks are the 1, 2 and 5 of every decade the limits cover; above `count`
 * of them the decades alone, and above `count` decades every k-th of them.
 *
 * @param limits the limits of the axis, both positive
 * @param count how many ticks are wanted
 * @returns the ticks inside the limits, in their order
 */
function logTicks(limits: Limits, count: number): number[] {
  const ladder: { value: number; decade: boolean }[] = []
  const first = Math.floor(Math.log10(limits.low))
  const last = Math.ceil(Math.log10(limits.high))
  for (let exponent = first; exponent <= last && ladder.length < 1000; exponent += 1) {
    for (const step of [1, 2, 5]) {
      const value = step * 10 ** exponent
      if (value >= limits.low * (1 - 1e-9) && value <= limits.high * (1 + 1e-9)) {
        ladder.push({ value, decade: step === 1 })
      }
    }
  }
  if (ladder.length === 0) {
    return [limits.low, limits.high]
  }
  if (ladder.length <= count) {
    return ladder.map((one) => one.value)
  }
  const decades = ladder.filter((one) => one.decade)
  if (decades.length === 0) {
    return [ladder[0]?.value ?? limits.low]
  }
  const every = Math.max(1, Math.ceil(decades.length / count))
  return decades.filter((_, index) => index % every === 0).map((one) => one.value)
}

/**
 * Get the limits of a linear axis.
 *
 * @param values the values the axis covers
 * @returns the smallest and the largest of them with the margin `AXIS_MARGIN` of
 *   their span on both sides, as matplotlib has it; a span of 0 is opened to
 *   one of 5 % of the value, or to one of 2 at 0, and no value at all gives
 *   `[0, 1]`
 */
function linearLimits(values: number[]): Limits {
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (Number.isFinite(value)) {
      low = Math.min(low, value)
      high = Math.max(high, value)
    }
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return { low: 0, high: 1 }
  }
  const margin = high > low ? (high - low) * AXIS_MARGIN : Math.abs(low) * AXIS_MARGIN || 1
  return { low: low - margin, high: high + margin }
}

/**
 * Get the limits of a logarithmic axis, the rule of sbmlsim's `log_limits`.
 *
 * The steps of an integrator start tiny, and with them the values of a curve
 * which starts at zero; data which spans more than `LOG_DECADES` below its
 * largest value is cut to these decades, so the figure shows the data and not
 * the approach of the first steps to zero. Data within the decades keeps its
 * own limits. Both carry the margin `AXIS_MARGIN` of the decades they span.
 *
 * @param values the values the axis covers
 * @returns the limits, both positive; `[0.1, 1]` for data without a positive
 *   value, which the axis cannot show at all
 */
function logLimits(values: number[]): Limits {
  let smallest = Number.POSITIVE_INFINITY
  let largest = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (Number.isFinite(value) && value > 0) {
      smallest = Math.min(smallest, value)
      largest = Math.max(largest, value)
    }
  }
  if (!Number.isFinite(smallest) || !Number.isFinite(largest)) {
    return { low: 0.1, high: 1 }
  }
  const bottom = Math.max(smallest, largest / 10 ** LOG_DECADES)
  if (!(largest > bottom)) {
    return { low: bottom / Math.sqrt(10), high: largest * Math.sqrt(10) }
  }
  const margin = 10 ** (AXIS_MARGIN * Math.log10(largest / bottom))
  return { low: bottom / margin, high: largest * margin }
}

/**
 * Build an axis of a figure.
 *
 * @param values the values the axis covers
 * @param log whether it is logarithmic
 * @param from the pixel of its lower limit
 * @param to the pixel of its upper limit
 * @param count how many ticks are wanted
 * @returns the axis
 */
function axisOf(values: number[], log: boolean, from: number, to: number, count: number): Axis {
  const limits = log ? logLimits(values) : linearLimits(values)
  const low = log ? Math.log10(limits.low) : limits.low
  const high = log ? Math.log10(limits.high) : limits.high
  const span = high - low
  const overshoot = Math.abs(to - from)
  return {
    log,
    limits,
    ticks: log ? logTicks(limits, count) : linearTicks(limits, count),
    drawable: (value: number) => Number.isFinite(value) && (!log || value > 0),
    position: (value: number) => {
      const at = log ? Math.log10(value) : value
      const share = span > 0 ? (at - low) / span : 0.5
      const pixel = from + share * (to - from)
      return clamp(pixel, Math.min(from, to) - overshoot, Math.max(from, to) + overshoot)
    },
  }
}

/**
 * Get the decimals the tick labels of an axis carry.
 *
 * @param ticks the ticks of the axis
 * @returns the decimals of the smallest step between two of them, at most six
 */
function tickDecimals(ticks: number[]): number {
  let step = Number.POSITIVE_INFINITY
  for (let index = 1; index < ticks.length; index += 1) {
    const before = ticks[index - 1]
    const value = ticks[index]
    if (before !== undefined && value !== undefined) {
      step = Math.min(step, Math.abs(value - before))
    }
  }
  const only = ticks[0]
  if (!Number.isFinite(step)) {
    step = only === undefined || only === 0 ? 1 : Math.abs(only)
  }
  return clamp(Math.ceil(-Math.log10(step)), 0, 6)
}

/**
 * Get the positions of a colour bar which carry a tick label.
 *
 * Every point up to `MAX_TICKS` points, every k-th from the first above them,
 * which is `tick_positions` of sbmlsim.
 *
 * @param count the points of the bar
 * @returns their positions, from 0
 */
function tickPositions(count: number): number[] {
  const every = Math.max(1, Math.ceil(count / MAX_TICKS))
  const positions: number[] = []
  for (let index = 0; index < count; index += every) {
    positions.push(index)
  }
  return positions
}

/**
 * Get the label of an axis, `<label> [<unit>]` as sbmlsim composes it.
 *
 * @param label the label of the axis
 * @param unit the unit of its values, `undefined` for values which carry none
 * @returns the label with its unit
 */
function axisLabel(label: string, unit: string | undefined): string {
  return unit === undefined || unit === '' ? label : `${label} [${unit}]`
}

/**
 * Get the unit every series of a figure carries, if it is one.
 *
 * @param series the series of the figure
 * @returns the unit they share, `undefined` for series which carry none or
 *   which carry more than one, whose units go into their legend entries
 */
function sharedUnit(series: Series[]): string | undefined {
  const units = new Set(series.map((one) => one.unit ?? ''))
  if (units.size !== 1) {
    return undefined
  }
  const [only] = [...units]
  return only === undefined || only === '' ? undefined : only
}

/**
 * Write the path of a curve.
 *
 * A value which is no finite number, and one which is not positive on a
 * logarithmic axis, is no point of the path: the path starts again with an `M`
 * after the gap instead of drawing through it.
 *
 * @param xs the x of the values
 * @param values the values
 * @param x the x axis
 * @param y the y axis
 * @returns the `d` of the path, empty for a curve without a point
 */
function pathOf(xs: number[], values: number[], x: Axis, y: Axis): string {
  const count = Math.min(xs.length, values.length)
  const parts: string[] = []
  let broken = true
  for (let index = 0; index < count; index += 1) {
    const at = xs[index]
    const value = values[index]
    if (at === undefined || value === undefined || !x.drawable(at) || !y.drawable(value)) {
      broken = true
      continue
    }
    parts.push(`${broken ? 'M' : 'L'}${coord(x.position(at))} ${coord(y.position(value))}`)
    broken = false
  }
  return parts.join(' ')
}

/**
 * Write the error bars of a series of study data.
 *
 * @param points the series
 * @param x the x axis
 * @param y the y axis
 * @returns the `d` of one path of every bar with its caps, empty for a series
 *   without an error
 */
function errorsOf(points: Points, x: Axis, y: Axis): string {
  const errors = points.yerr
  if (errors === undefined) {
    return ''
  }
  const count = Math.min(points.x.length, points.y.length, errors.length)
  const parts: string[] = []
  for (let index = 0; index < count; index += 1) {
    const at = points.x[index]
    const value = points.y[index]
    const error = errors[index]
    if (at === undefined || value === undefined || error === undefined) {
      continue
    }
    if (!x.drawable(at) || !y.drawable(value) || !Number.isFinite(error) || error === 0) {
      continue
    }
    const low = value - Math.abs(error)
    const high = value + Math.abs(error)
    if (!y.drawable(high)) {
      continue
    }
    const px = coord(x.position(at))
    const top = coord(y.position(high))
    const bottom = coord(y.position(y.drawable(low) ? low : y.limits.low))
    parts.push(`M${px} ${top} L${px} ${bottom}`)
    parts.push(`M${coord(x.position(at) - CAP)} ${top} L${coord(x.position(at) + CAP)} ${top}`)
    parts.push(
      `M${coord(x.position(at) - CAP)} ${bottom} L${coord(x.position(at) + CAP)} ${bottom}`,
    )
  }
  return parts.join(' ')
}

/**
 * Write the markers of a series of study data.
 *
 * @param points the series
 * @param colour the colour of the series
 * @param x the x axis
 * @param y the y axis
 * @returns the circles of the points which can be drawn
 */
function markersOf(points: Points, colour: string, x: Axis, y: Axis): string {
  const count = Math.min(points.x.length, points.y.length)
  const drawn: string[] = []
  for (let index = 0; index < count; index += 1) {
    const at = points.x[index]
    const value = points.y[index]
    if (at === undefined || value === undefined || !x.drawable(at) || !y.drawable(value)) {
      continue
    }
    drawn.push(
      tag('circle', {
        class: 'marker',
        style: `fill:${colour}`,
        cx: coord(x.position(at)),
        cy: coord(y.position(value)),
        r: MARKER,
      }),
    )
  }
  return drawn.join('')
}

/**
 * Write one axis of the figure with its ticks and its label.
 *
 * @param axis the axis
 * @param horizontal whether it is the x axis
 * @param box the plot box
 * @param label the label of the axis, with its unit
 * @returns the group of the axis
 */
function axisGroup(
  axis: Axis,
  horizontal: boolean,
  box: { x0: number; y0: number; x1: number; y1: number },
  label: string,
): string {
  const decimals = tickDecimals(axis.ticks)
  const line = horizontal
    ? tag('line', {
        class: 'axis-line',
        x1: coord(box.x0),
        y1: coord(box.y1),
        x2: coord(box.x1),
        y2: coord(box.y1),
      })
    : tag('line', {
        class: 'axis-line',
        x1: coord(box.x0),
        y1: coord(box.y0),
        x2: coord(box.x0),
        y2: coord(box.y1),
      })
  const ticks = axis.ticks
    .filter((value) => axis.drawable(value))
    .map((value) => {
      const at = axis.position(value)
      const mark = horizontal
        ? tag('line', {
            x1: coord(at),
            y1: coord(box.y1),
            x2: coord(at),
            y2: coord(box.y1 + TICK),
          })
        : tag('line', {
            x1: coord(box.x0 - TICK),
            y1: coord(at),
            x2: coord(box.x0),
            y2: coord(at),
          })
      const written = horizontal
        ? text(formatNumber(value, decimals), {
            style: `fill:${token('fg-soft')};stroke:none`,
            x: coord(at),
            y: coord(box.y1 + TICK + LABEL_GAP),
            'text-anchor': 'middle',
            'dominant-baseline': 'hanging',
          })
        : text(formatNumber(value, decimals), {
            style: `fill:${token('fg-soft')};stroke:none`,
            x: coord(box.x0 - TICK - LABEL_GAP),
            y: coord(at),
            'text-anchor': 'end',
            'dominant-baseline': 'central',
          })
      return tag('g', { class: 'tick' }, `${mark}${written}`)
    })
    .join('')
  const middle = horizontal ? (box.x0 + box.x1) / 2 : (box.y0 + box.y1) / 2
  const title = horizontal
    ? text(label, {
        class: 'axis-label',
        style: `fill:${token('fg')};stroke:none;font-size:${token('font-size')}`,
        x: coord(middle),
        y: coord(box.y1 + BOTTOM - PAD - LABEL_GAP),
        'text-anchor': 'middle',
      })
    : text(label, {
        class: 'axis-label',
        style: `fill:${token('fg')};stroke:none;font-size:${token('font-size')}`,
        x: coord(PAD),
        y: coord(middle),
        transform: `rotate(-90 ${coord(PAD)} ${coord(middle)})`,
        'text-anchor': 'middle',
        'dominant-baseline': 'hanging',
      })
  return tag(
    'g',
    {
      class: horizontal ? 'axis x' : 'axis y',
      style:
        `stroke:${token('fg-soft')};stroke-width:${token('axis-width')};` +
        `fill:none;font-size:${token('font-size-small')}`,
    },
    `${line}${ticks}${title}`,
  )
}

/**
 * Write the legend of a figure.
 *
 * @param entries the entries, in their order
 * @param x the pixel the column of the legend starts at
 * @param y the pixel its first row is centred on
 * @returns the group of the legend, empty for no entry at all
 */
function legendGroup(entries: Entry[], x: number, y: number): string {
  if (entries.length === 0) {
    return ''
  }
  const rows = entries
    .map((entry, index) => {
      const at = y + index * ROW
      const swatch = entry.marker
        ? tag('circle', {
            class: 'swatch',
            style: `fill:${entry.colour}`,
            cx: coord(x + SWATCH / 2),
            cy: coord(at),
            r: MARKER,
          })
        : tag('line', {
            class: 'swatch',
            style: `stroke:${entry.colour};stroke-width:${token('curve-width')}`,
            x1: coord(x),
            y1: coord(at),
            x2: coord(x + SWATCH),
            y2: coord(at),
          })
      const written = text(entry.label, {
        x: coord(x + SWATCH + LABEL_GAP * 2),
        y: coord(at),
        'dominant-baseline': 'central',
      })
      return tag('g', { class: 'legend-entry', 'data-series': entry.id }, `${swatch}${written}`)
    })
    .join('')
  return tag(
    'g',
    {
      class: 'legend',
      style: `fill:${token('fg')};font-size:${token('font-size-small')}`,
    },
    rows,
  )
}

/**
 * Write the colour bar of a figure of more series than get a legend.
 *
 * @param series the series the bar stands for
 * @param x the pixel the column of the bar starts at
 * @param top the pixel its top is at
 * @param bottom the pixel its bottom is at
 * @returns the group of the colour bar, the first series at its bottom
 */
function colourbarGroup(series: Series[], x: number, top: number, bottom: number): string {
  const height = Math.max(1, bottom - top)
  const bar = tag('rect', {
    class: 'bar',
    x: coord(x),
    y: coord(top),
    width: COLOURBAR_BAR,
    height: coord(height),
    fill: `url(#${RAMP_ID})`,
  })
  const labels = tickPositions(series.length)
    .map((position) => {
      const one = series[position]
      if (one === undefined) {
        return ''
      }
      const share = series.length > 1 ? position / (series.length - 1) : 0
      const at = bottom - share * height
      const mark = tag('line', {
        style: `stroke:${token('fg-soft')};stroke-width:${token('axis-width')}`,
        x1: coord(x + COLOURBAR_BAR),
        y1: coord(at),
        x2: coord(x + COLOURBAR_BAR + TICK),
        y2: coord(at),
      })
      const written = text(one.label, {
        style: `fill:${token('fg-soft')}`,
        x: coord(x + COLOURBAR_BAR + TICK + LABEL_GAP),
        y: coord(at),
        'dominant-baseline': 'central',
      })
      return tag('g', { class: 'tick' }, `${mark}${written}`)
    })
    .join('')
  return tag(
    'g',
    { class: 'colourbar', style: `font-size:${token('font-size-small')}` },
    `${bar}${labels}`,
  )
}

/**
 * Write the gradient of the colour bar, the anchors of the ramp.
 *
 * @returns the `defs` of the figure
 */
function rampDefs(): string {
  const stops = RAMP.map((_, index) =>
    tag('stop', {
      offset: formatNumber(index / (RAMP.length - 1), 4),
      style: `stop-color:${anchor(index)}`,
    }),
  ).join('')
  return tag('defs', {}, tag('linearGradient', { id: RAMP_ID, x1: 0, y1: 1, x2: 0, y2: 0 }, stops))
}

/**
 * Draw a figure as one inline SVG element.
 *
 * The element carries its `viewBox` next to its `width` and its `height`, so it
 * scales with the box a host gives it, `role="img"` and a `<title>` as its
 * first child, so a reader which does not see it is told what it shows. Every
 * part of it carries a class - `background`, `axis`, `tick`, `axis-label`,
 * `points`, `errorbar`, `marker`, `curve`, `legend`, `legend-entry`,
 * `colourbar`, `swatch`, `bar` - and every colour, font and stroke width is a
 * token of the design system with the value of the sbmlsim report as its
 * fallback.
 *
 * The plot box is clipped, so a value outside of the limits of an axis - the
 * decades a logarithmic axis cuts away - leaves the box instead of drawing over
 * the axes; the clip is named after that box, so two figures of one size share
 * one name and one definition of it.
 *
 * @param spec the figure: its size, its axes, its curves and the study data
 *   under them
 * @returns the `<svg>` element as a string, drawn in one line; the same spec
 *   gives the same bytes
 */
export function plotSvg(spec: PlotSpec): string {
  const width = size(spec.width)
  const height = size(spec.height)
  const series = spec.series
  const points = spec.points ?? []
  const hasColourbar = series.length > LEGEND_LIMIT

  const colours = series.map((_, index) =>
    rampColour(series.length > 1 ? index / (series.length - 1) : 0),
  )
  const colourOf = (id: string): string => {
    const index = series.findIndex((one) => one.id === id)
    return colours[index] ?? token('fg-soft')
  }

  const entries: Entry[] = []
  if (!hasColourbar) {
    const unit = sharedUnit(series)
    for (const [index, one] of series.entries()) {
      entries.push({
        id: one.id,
        label: unit === undefined ? axisLabel(one.label, one.unit) : one.label,
        colour: colours[index] ?? token('fg-soft'),
        marker: false,
      })
    }
  }
  for (const one of points) {
    entries.push({ id: one.id, label: one.label, colour: colourOf(one.id), marker: true })
  }

  const column = entries.length > 0 ? LEGEND_WIDTH : hasColourbar ? COLOURBAR_WIDTH : 0
  const box = {
    x0: LEFT,
    y0: TOP,
    x1: Math.max(LEFT + MIN_PLOT, width - PAD - column),
    y1: Math.max(TOP + MIN_PLOT, height - BOTTOM),
  }

  const xs: number[] = [...spec.x]
  const ys: number[] = []
  for (const one of series) {
    for (let index = 0; index < Math.min(spec.x.length, one.values.length); index += 1) {
      const value = one.values[index]
      if (value !== undefined) {
        ys.push(value)
      }
    }
  }
  for (const one of points) {
    for (const at of one.x) {
      xs.push(at)
    }
    for (const [index, value] of one.y.entries()) {
      const error = one.yerr?.[index]
      ys.push(value)
      if (error !== undefined && Number.isFinite(error)) {
        ys.push(value - Math.abs(error), value + Math.abs(error))
      }
    }
  }

  const x = axisOf(xs, false, box.x0, box.x1, tickCount(box.x1 - box.x0, X_TICK_ROOM))
  const y = axisOf(ys, spec.logY, box.y1, box.y0, tickCount(box.y1 - box.y0, Y_TICK_ROOM))

  const clip =
    `sbmlsim-plot-clip-${coord(box.x0)}-${coord(box.y0)}-${coord(box.x1)}-${coord(box.y1)}`.replace(
      /\./g,
      '_',
    )
  const defs = tag(
    'defs',
    {},
    tag(
      'clipPath',
      { id: clip },
      tag('rect', {
        x: coord(box.x0),
        y: coord(box.y0),
        width: coord(box.x1 - box.x0),
        height: coord(box.y1 - box.y0),
      }),
    ),
  )

  const drawnPoints = points
    .map((one) => {
      const colour = colourOf(one.id)
      const bars = errorsOf(one, x, y)
      const path =
        bars === ''
          ? ''
          : tag('path', {
              class: 'errorbar',
              style: `stroke:${colour};stroke-width:${token('data-width')};fill:none`,
              d: bars,
            })
      return tag(
        'g',
        { class: 'points', 'data-series': one.id },
        `${path}${markersOf(one, colour, x, y)}`,
      )
    })
    .join('')

  const drawnSeries = series
    .map((one, index) =>
      tag('path', {
        class: 'curve',
        'data-series': one.id,
        style:
          `stroke:${colours[index] ?? token('fg-soft')};` +
          `stroke-width:${token('curve-width')};fill:none`,
        d: pathOf(spec.x, one.values, x, y),
      }),
    )
    .join('')

  const columnX = box.x1 + COLUMN_GAP
  const barBottom = box.y1 - (entries.length > 0 ? entries.length * ROW + ROW : 0)
  const side = hasColourbar
    ? colourbarGroup(series, columnX, box.y0 + MARKER, Math.max(box.y0 + MIN_PLOT, barBottom)) +
      legendGroup(entries, columnX, Math.max(box.y0 + MIN_PLOT, barBottom) + ROW)
    : legendGroup(entries, columnX, box.y0 + ROW / 2)

  const label = axisLabel(spec.yLabel, sharedUnit(series))
  const title = tag('title', {}, escape(`${label} over ${spec.xLabel}`))
  const background = tag('rect', {
    class: 'background',
    x: 0,
    y: 0,
    width,
    height,
    style: `fill:${token('bg')}`,
  })
  const body =
    `${title}${hasColourbar ? rampDefs() : ''}${defs}${background}` +
    `${axisGroup(x, true, box, spec.xLabel)}${axisGroup(y, false, box, label)}` +
    tag('g', { class: 'data', 'clip-path': `url(#${clip})` }, drawnPoints + drawnSeries) +
    side

  return tag(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      class: 'sbmlsim-plot',
      width,
      height,
      viewBox: `0 0 ${String(width)} ${String(height)}`,
      role: 'img',
      style: `font-family:${token('font')};font-size:${token('font-size')}`,
    },
    body,
  )
}
