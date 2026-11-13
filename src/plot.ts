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
 *   curves, the legend swatches and the colour bar are one ramp of six tokens;
 *   reading between six anchors is up to 12 of 255 per channel away from
 *   `viridis(linspace(0, 0.85, n))`, which is the price of a ramp a host moves
 *   with six values and not of a table of colours nobody can move,
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

/** One series of study data, drawn as markers under the curve it belongs to. */
export interface Points {
  /** The id of the series, which it carries into the output as `data-series`. */
  id: string
  /** Its entry in the legend. */
  label: string
  /** The id of the curve which lends it its colour, its own id without one. */
  curve?: string
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
  'figure-bg': 'transparent',
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
/**
 * The share of the width of a figure the column of a legend or of a colour bar
 * may take. A label is given the room its characters need and no more, and this
 * is where that stops: past about a third of the figure the plot is the thing
 * which suffers, so the labels are cut with an ellipsis instead.
 */
const COLUMN_SHARE = 0.35
/**
 * The width of a character of a label, a share of its font size. It is an
 * estimate of the mean character of the font of the design system and no
 * measurement, so a label is placed and the column is sized without a dom; a
 * host which sets `--sbmlsim-font-size-small` or `--sbmlsim-font` well away
 * from their values gets the ellipsis a little early or a little late.
 */
const EM = 0.55
/** The width of the bar of a colour bar, in pixels. */
const COLOURBAR_BAR = 12
/** The gap between the plot and the column right of it, in pixels. */
const COLUMN_GAP = 12
/** The length of the line of a legend entry, in pixels. */
const SWATCH = 18
/** The height of a row of a legend, in pixels. */
const ROW = 18
/** The height of a further line of a legend entry which wraps, in pixels. */
const LEGEND_LINE = 13
/** The most lines a legend entry is given before its last line is cut. */
const LEGEND_LINES = 2
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
/** The bands the colour bar is painted as, one colour of the ramp each. */
const BAR_BANDS = 32
/** The overlap of two bands of a colour bar, which closes their seam, in pixels. */
const BAND_SEAM = 0.5
/** The size of the font of a tick, a legend entry and a label of a colour bar. */
const SMALL_FONT = 11
/** What a sum of pixels may be off by and still count as the same room. */
const ROUNDING = 1e-9
/** What a label which does not fit its room ends with. */
const ELLIPSIS = '\u2026'

/**
 * The plot box of a figure, in the coordinates of its `viewBox`.
 *
 * It is what a caller which draws over a figure - a crosshair, a readout, a
 * marker of its own - needs: the area the curves are drawn in, which nothing
 * of the figure leaves.
 */
export interface PlotBox {
  /** The pixel of its left edge. */
  x0: number
  /** The pixel of its top edge. */
  y0: number
  /** The pixel of its right edge. */
  x1: number
  /** The pixel of its bottom edge. */
  y1: number
}

/**
 * The geometry of a figure: where its plot box is and where a value lands in it.
 *
 * It is the same layout `plotSvg` draws from, so a caller which places anything
 * over a figure places it on the figure which is there and not on one it had to
 * guess at.
 */
export interface PlotGeometry {
  /** The width of the figure in pixels, as `plotSvg` draws it. */
  width: number
  /** The height of the figure in pixels. */
  height: number
  /** The plot box, the area the curves are drawn in. */
  box: PlotBox
  /** The pixel of an x, clamped to one length of the box beyond it. */
  xAt: (value: number) => number
  /** The pixel of a value on the y axis, clamped the same way. */
  yAt: (value: number) => number
  /** Whether a value can be drawn on the y axis at all. */
  drawable: (value: number) => boolean
}

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
  drawable: (value: number) => boolean
  /** The pixel of a value, clamped to one length beyond the plot box. */
  position: (value: number) => number
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
  const percent = formatNumber((1 - part) * 100, 2, false)
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
 * @param exponential whether it is written in the exponential form, which is
 *   decided for a whole axis and not for one of its ticks
 * @returns it without trailing zeros, in the exponential form of three
 *   significant digits where that is asked for; 0 is `0` in either form
 */
function formatNumber(value: number, decimals: number, exponential: boolean): string {
  if (!Number.isFinite(value)) {
    return '0'
  }
  if (value === 0) {
    return '0'
  }
  const text = exponential
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
 * Get the room a label needs, an estimate and no measurement.
 *
 * @param label the label
 * @param fontSize the size of its font in pixels
 * @returns the pixels its characters are given
 */
function labelRoom(label: string, fontSize: number): number {
  return label.length * fontSize * EM
}

/**
 * Cut a label to the room it has.
 *
 * @param label the label
 * @param room the pixels it has
 * @param fontSize the size of its font in pixels
 * @returns the label where it fits, else as many of its characters as fit with
 *   an ellipsis in the place of the last of them, so a cut label says that it
 *   was cut; nothing at all where not even the ellipsis fits
 */
function fittingLabel(label: string, room: number, fontSize: number): string {
  if (labelRoom(label, fontSize) <= room + ROUNDING) {
    return label
  }
  const characters = Math.floor(room / (fontSize * EM))
  if (label.length <= characters) {
    return label
  }
  if (characters < 1) {
    return ''
  }
  return label.slice(0, characters - 1) + ELLIPSIS
}

/**
 * Lay a label out on the lines of the room it has.
 *
 * A label which does not fit one line wraps at its words, so a legend in a
 * narrow column still tells its curves apart: a cut at the end of the line
 * would leave only the prefix the labels of a panel share. A word which is
 * longer than a line breaks where the line ends, as there is no other place to
 * break it. Past `LEGEND_LINES` lines the last one is cut with an ellipsis,
 * which is how a reader sees that there was more.
 *
 * @param label the label
 * @param room the pixels a line has
 * @param fontSize the size of its font in pixels
 * @returns the lines, at least one; a single empty line where not even one
 *   character fits
 */
function wrapLabel(label: string, room: number, fontSize: number): string[] {
  if (labelRoom(label, fontSize) <= room + ROUNDING) {
    return [label]
  }
  const width = Math.floor(room / (fontSize * EM))
  if (width < 1) {
    return ['']
  }
  const lines: string[] = []
  let line = ''
  for (const word of label.split(' ')) {
    const pieces: string[] = []
    for (let at = 0; at < word.length || at === 0; at += width) {
      pieces.push(word.slice(at, at + width))
    }
    for (const piece of pieces) {
      const joined = line === '' ? piece : `${line} ${piece}`
      if (joined.length <= width) {
        line = joined
      } else {
        lines.push(line)
        line = piece
      }
    }
  }
  lines.push(line)
  if (lines.length <= LEGEND_LINES) {
    return lines
  }
  const kept = lines.slice(0, LEGEND_LINES - 1)
  const rest = lines.slice(LEGEND_LINES - 1).join(' ')
  return [...kept, rest.length <= width ? rest : rest.slice(0, width - 1) + ELLIPSIS]
}

/**
 * Get how tall a legend is, which the lines its entries wrap to decide.
 *
 * @param entries the entries
 * @param room the pixels a label has
 * @returns the pixels from the first row of the legend to the end of its last
 */
function legendHeight(entries: Entry[], room: number): number {
  return entries.reduce(
    (sum, entry) => sum + ROW + (wrapLabel(entry.label, room, SMALL_FONT).length - 1) * LEGEND_LINE,
    0,
  )
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
 * Get the values of a ladder of steps per decade inside limits.
 *
 * @param limits the limits of the axis, both positive
 * @param steps the steps of one decade, e.g. 1, 2 and 5
 * @returns the values of the ladder inside the limits, in their order
 */
function decadeLadder(limits: Limits, steps: number[]): number[] {
  const values: number[] = []
  const first = Math.floor(Math.log10(limits.low))
  const last = Math.ceil(Math.log10(limits.high))
  for (let exponent = first; exponent <= last && values.length < 1000; exponent += 1) {
    for (const step of steps) {
      const value = step * 10 ** exponent
      if (value >= limits.low * (1 - 1e-9) && value <= limits.high * (1 + 1e-9)) {
        values.push(value)
      }
    }
  }
  return values
}

/**
 * Get the ticks of a logarithmic axis.
 *
 * The ticks are the finest of three ladders which is no longer than the axis
 * asked for: the 1, 2 and 5 of every decade, the 1 and the 3 of every decade,
 * and the decades alone, of which every k-th is taken when even those are too
 * many. The rung of the 1 and the 3 is what an axis of two to three decades
 * needs: its full ladder is seven or eight values and its decades are two or
 * three, so an axis as tall as a figure would otherwise carry two labels. For
 * the same reason a ladder of fewer than `LEAST_TICKS` values gives way to the
 * next finer one, which carries more labels than were asked for and is the
 * better of the two.
 *
 * @param limits the limits of the axis, both positive
 * @param count how many ticks are wanted
 * @returns the ticks inside the limits, in their order
 */
function logTicks(limits: Limits, count: number): number[] {
  const ladders = [
    decadeLadder(limits, [1, 2, 5]),
    decadeLadder(limits, [1, 3]),
    decadeLadder(limits, [1]),
  ].filter((one) => one.length > 0)
  let index = 0
  while (index < ladders.length - 1 && (ladders[index]?.length ?? 0) > count) {
    index += 1
  }
  const fitted = ladders[index]
  if (fitted === undefined) {
    return [limits.low, limits.high]
  }
  if (fitted.length < LEAST_TICKS) {
    const finer = ladders[index - 1]
    if (finer !== undefined) {
      return finer
    }
  }
  if (fitted.length <= count) {
    return fitted
  }
  const every = Math.max(1, Math.ceil(fitted.length / count))
  return fitted.filter((_, at) => at % every === 0)
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
 * Get the decade below and the decade above a value.
 *
 * @param value the value, which is positive
 * @returns the powers of ten around it; a value which is a power of ten itself
 *   gets the one below and the one above it, as `_decade_less` and
 *   `_decade_greater` of matplotlib give them
 */
function decadeAround(value: number): Limits {
  const exponent = Math.log10(value)
  const below = 10 ** Math.floor(exponent)
  const above = 10 ** Math.ceil(exponent)
  return { low: below < value ? below : below / 10, high: above > value ? above : above * 10 }
}

/**
 * Get the limits of a logarithmic axis, the rule of sbmlsim's `log_limits`.
 *
 * The steps of an integrator start tiny, and with them the values of a curve
 * which starts at zero; data which spans more than `LOG_DECADES` below its
 * largest value is cut to these decades, so the figure shows the data and not
 * the approach of the first steps to zero. Data within the decades keeps its
 * own limits. Data of one value alone takes the decade below it and the decade
 * above it, which is `LogLocator.nonsingular` of matplotlib, so a flat curve
 * sits in the middle of its decade and not at the edge of a made up span. All
 * of them carry the margin `AXIS_MARGIN` of the decades they span.
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
  const span = largest > bottom ? { low: bottom, high: largest } : decadeAround(largest)
  const margin = 10 ** (AXIS_MARGIN * Math.log10(span.high / span.low))
  return { low: span.low / margin, high: span.high * margin }
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
 * Get whether the ticks of an axis are written in the exponential form.
 *
 * The notation belongs to the axis and not to one of its ticks: an axis over 0
 * to -1.7e5 writes `0`, `-5e+4`, `-1e+5` and `-1.5e+5`, and never mixes
 * `-50000` into them, as matplotlib does not either.
 *
 * @param ticks the ticks of the axis
 * @returns whether one of them is large or small enough that the whole axis
 *   leaves the plain form, i.e. is outside of `[1e-3, 1e5)`
 */
function exponentialTicks(ticks: number[]): boolean {
  return ticks.some((value) => {
    const magnitude = Math.abs(value)
    return value !== 0 && Number.isFinite(value) && (magnitude >= 1e5 || magnitude < 1e-3)
  })
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
 * Get the room the longest of a set of labels needs.
 *
 * @param labels the labels
 * @returns the pixels of the longest of them, 0 without a label
 */
function widest(labels: string[]): number {
  return labels.reduce((most, one) => Math.max(most, labelRoom(one, SMALL_FONT)), 0)
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
 * Get the x the curves of a figure cover.
 *
 * @param xs the x of the figure, the output times of a run
 * @returns the smallest and the largest of them, `null` for a figure whose x
 *   carries no finite number, which covers nothing
 */
function curveRange(xs: number[]): Limits | null {
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (const at of xs) {
    if (Number.isFinite(at)) {
      low = Math.min(low, at)
      high = Math.max(high, at)
    }
  }
  return Number.isFinite(low) && Number.isFinite(high) ? { low, high } : null
}

/**
 * Cut a series of study data to the x the curves cover.
 *
 * A study measures what it measured and a panel simulates the horizon it
 * declares, so a series reaches past the curves whenever the two disagree. Such
 * a point is no point of the figure: it would stretch both axes to cover
 * something which is drawn nowhere, and the figure would be the one of the
 * study and not the one of the simulation. Its series keeps its legend entry,
 * because the panel carries the series whatever the horizon is and a legend
 * which comes and goes with the end of a simulation is worse than one which
 * names a series the plot box does not reach.
 *
 * @param points the series
 * @param range the x the curves cover, `null` for a figure which covers none
 * @returns the points inside the range, in their order, with their errors; the
 *   series as it is where there is no range to cut to
 */
function clipPoints(points: Points, range: Limits | null): Points {
  if (range === null) {
    return points
  }
  const count = Math.min(points.x.length, points.y.length)
  const xs: number[] = []
  const values: number[] = []
  const errors: number[] = []
  for (let index = 0; index < count; index += 1) {
    const at = points.x[index]
    const value = points.y[index]
    if (at === undefined || value === undefined || !Number.isFinite(at)) {
      continue
    }
    if (at < range.low || at > range.high) {
      continue
    }
    xs.push(at)
    values.push(value)
    errors.push(points.yerr?.[index] ?? Number.NaN)
  }
  const kept: Points = { id: points.id, label: points.label, x: xs, y: values }
  if (points.curve !== undefined) {
    kept.curve = points.curve
  }
  if (points.yerr !== undefined) {
    kept.yerr = errors
  }
  return kept
}

/**
 * Write the error bars of a series of study data.
 *
 * @param points the series
 * @param x the x axis
 * @param y the y axis
 * @returns the `d` of one path of every bar with its caps, empty for a series
 *   without an error; a bar whose lower end is outside of the axis - a
 *   logarithmic axis cuts the decades below its limits away - ends at the limit
 *   and gets no cap there, so it is not read as a measured bound
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
    const reaches = y.drawable(low) && low >= y.limits.low
    const px = coord(x.position(at))
    const left = coord(x.position(at) - CAP)
    const right = coord(x.position(at) + CAP)
    const top = coord(y.position(high))
    const bottom = coord(y.position(reaches ? low : y.limits.low))
    parts.push(`M${px} ${top} L${px} ${bottom}`)
    parts.push(`M${left} ${top} L${right} ${top}`)
    if (reaches) {
      parts.push(`M${left} ${bottom} L${right} ${bottom}`)
    }
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
  const exponential = exponentialTicks(axis.ticks)
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
        ? text(formatNumber(value, decimals, exponential), {
            style: `fill:${token('fg-soft')};stroke:none`,
            x: coord(at),
            y: coord(box.y1 + TICK + LABEL_GAP),
            'text-anchor': 'middle',
            'dominant-baseline': 'hanging',
          })
        : text(formatNumber(value, decimals, exponential), {
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
 * @param room the pixels a label has, which wraps one which is longer
 * @returns the group of the legend, empty for no entry at all
 */
function legendGroup(entries: Entry[], x: number, y: number, room: number): string {
  if (entries.length === 0) {
    return ''
  }
  let at = y
  const rows = entries
    .map((entry) => {
      const lines = wrapLabel(entry.label, room, SMALL_FONT)
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
      const written = lines
        .map((line, index) =>
          text(line, {
            x: coord(x + SWATCH + LABEL_GAP * 2),
            y: coord(at + index * LEGEND_LINE),
            'dominant-baseline': 'central',
          }),
        )
        .join('')
      at += ROW + (lines.length - 1) * LEGEND_LINE
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
 * The bar is painted as `BAR_BANDS` bands of the ramp and not as a gradient of
 * a `<linearGradient>`: a gradient is referenced by an id, two figures of one
 * document share it, and a host which overrides the ramp for one of them would
 * move its curves (whose `color-mix` resolves on their own elements) while its
 * bar kept the colours of the other figure. A band resolves its own tokens, so
 * a bar always shows the ramp of the curves next to it.
 *
 * @param series the series the bar stands for
 * @param x the pixel the column of the bar starts at
 * @param top the pixel its top is at
 * @param bottom the pixel its bottom is at
 * @param room the pixels a label has, which cuts one which is longer
 * @returns the group of the colour bar, the first series at its bottom
 */
function colourbarGroup(
  series: Series[],
  x: number,
  top: number,
  bottom: number,
  room: number,
): string {
  const height = Math.max(1, bottom - top)
  const slice = height / BAR_BANDS
  const bands: string[] = []
  for (let index = 0; index < BAR_BANDS; index += 1) {
    bands.push(
      tag('rect', {
        x: coord(x),
        y: coord(top + index * slice),
        width: COLOURBAR_BAR,
        height: coord(slice + (index < BAR_BANDS - 1 ? BAND_SEAM : 0)),
        style: `fill:${rampColour(1 - (index + 0.5) / BAR_BANDS)}`,
      }),
    )
  }
  const bar = tag('g', { class: 'bar' }, bands.join(''))
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
      const written = text(fittingLabel(one.label, room, SMALL_FONT), {
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

/** Everything the layout of a figure settles before anything is written. */
interface Layout {
  /** The width of the figure in whole pixels. */
  width: number
  /** The height of the figure in whole pixels. */
  height: number
  /** The plot box. */
  box: PlotBox
  /** The x axis. */
  x: Axis
  /** The y axis. */
  y: Axis
  /** The study data as it is drawn, cut to the x the curves cover. */
  points: Points[]
  /** The colour of every series, in its order. */
  colours: string[]
  /** The entries of the legend, the curves first and the study data after them. */
  entries: Entry[]
  /** Whether the column right of the plot is a colour bar and not a legend. */
  hasColourbar: boolean
  /** The pixels a label of the legend has. */
  legendLabels: number
  /** The pixels a label of the colour bar has. */
  barLabelRoom: number
  /** The colour of the curve of an id, the soft foreground for an unknown one. */
  colourOf: (id: string) => string
}

/**
 * Get the colour of one of the series of a figure.
 *
 * @param index the position of the series, from 0
 * @param count how many series the figure draws
 * @returns the colour of the ramp at that position, the `var()` of a style
 */
export function seriesColour(index: number, count: number): string {
  return rampColour(count > 1 ? index / (count - 1) : 0)
}

/** The figure which was laid out last, whose layout is kept. */
let laidOut: PlotSpec | null = null
/** The layout of that figure. */
let lastLayout: Layout | null = null

/**
 * Lay a figure out: its box, its axes and the room of its column.
 *
 * The layout of the figure which was laid out last is kept, keyed on the
 * identity of its spec, so a figure which is drawn and then measured -
 * `plotSvg` and `plotGeometry` of the same spec, which is what a panel with a
 * readout does on every movement of a knob - is laid out once. A spec is read
 * and never written here, so a caller builds a new spec rather than changing
 * one it has passed already: a changed spec is the same object and would get
 * the layout of what it held before.
 *
 * @param spec the figure
 * @returns the layout `plotSvg` writes and `plotGeometry` hands out
 */
function layoutOf(spec: PlotSpec): Layout {
  if (spec === laidOut && lastLayout !== null) {
    return lastLayout
  }
  const layout = layoutFor(spec)
  laidOut = spec
  lastLayout = layout
  return layout
}

/**
 * Lay a figure out, whatever was laid out before it.
 *
 * @param spec the figure
 * @returns its layout
 */
function layoutFor(spec: PlotSpec): Layout {
  const width = size(spec.width)
  const height = size(spec.height)
  const series = spec.series
  const declared = spec.points ?? []
  const range = curveRange(spec.x)
  const points = declared.map((one) => clipPoints(one, range))
  const hasColourbar = series.length > LEGEND_LIMIT

  const colours = series.map((_, index) => seriesColour(index, series.length))
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
  for (const one of declared) {
    entries.push({
      id: one.id,
      label: one.label,
      colour: colourOf(one.curve ?? one.id),
      marker: true,
    })
  }

  const barLabels = hasColourbar
    ? tickPositions(series.length).map((position) => series[position]?.label ?? '')
    : []
  const legendRoom =
    entries.length > 0 ? SWATCH + LABEL_GAP * 2 + widest(entries.map((one) => one.label)) : 0
  const barRoom = hasColourbar ? COLOURBAR_BAR + TICK + LABEL_GAP + widest(barLabels) : 0
  const wanted = Math.max(legendRoom, barRoom)
  const column = wanted > 0 ? Math.min(COLUMN_GAP + wanted, Math.round(width * COLUMN_SHARE)) : 0
  const box: PlotBox = {
    x0: LEFT,
    y0: TOP,
    x1: Math.max(LEFT + MIN_PLOT, width - PAD - column),
    y1: Math.max(TOP + MIN_PLOT, height - BOTTOM),
  }

  const xs: number[] = spec.x.length > 0 ? [...spec.x] : points.flatMap((one) => one.x)
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
    for (const [index, value] of one.y.entries()) {
      const error = one.yerr?.[index]
      ys.push(value)
      if (error !== undefined && Number.isFinite(error)) {
        ys.push(value - Math.abs(error), value + Math.abs(error))
      }
    }
  }

  return {
    width,
    height,
    box,
    x: axisOf(xs, false, box.x0, box.x1, tickCount(box.x1 - box.x0, X_TICK_ROOM)),
    y: axisOf(ys, spec.logY, box.y1, box.y0, tickCount(box.y1 - box.y0, Y_TICK_ROOM)),
    points,
    colours,
    entries,
    hasColourbar,
    legendLabels: column - COLUMN_GAP - SWATCH - LABEL_GAP * 2,
    barLabelRoom: column - COLUMN_GAP - COLOURBAR_BAR - TICK - LABEL_GAP,
    colourOf,
  }
}

/**
 * Get where a figure puts its plot box and what lands where inside it.
 *
 * It is the layout `plotSvg` draws from, so a caller which places a crosshair,
 * a readout or a marker of its own over a figure places it on the figure which
 * is drawn. The coordinates are the ones of the `viewBox`; a figure which is
 * scaled by the box its host gives it scales them with it.
 *
 * @param spec the figure, the same one `plotSvg` is given
 * @returns its geometry
 */
export function plotGeometry(spec: PlotSpec): PlotGeometry {
  const layout = layoutOf(spec)
  return {
    width: layout.width,
    height: layout.height,
    box: layout.box,
    xAt: layout.x.position,
    yAt: layout.y.position,
    drawable: layout.y.drawable,
  }
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
 * fallback; the figure paints `--sbmlsim-figure-bg` behind itself, which is
 * `transparent` until a host asks for a surface, so a figure is part of its
 * page and not a white box on a slide.
 *
 * The column right of the plot, the legend or the colour bar, is as wide as the
 * characters of its longest label need (`EM`, an estimate of the font and no
 * measurement) and at most `COLUMN_SHARE` of the figure; a label which does not
 * fit that is cut with an ellipsis, since a cut label is worse than a narrower
 * plot and an ellipsis is better than either.
 *
 * The plot box is clipped, so a value outside of the limits of an axis - the
 * decades a logarithmic axis cuts away - leaves the box instead of drawing over
 * the axes; the clip is named after that box, so two figures of one size share
 * one name and one definition of it. The study data is cut to the x the curves
 * cover before anything is measured, so a study which reaches past the horizon
 * of the simulation stretches neither axis and draws nothing outside the box.
 *
 * @param spec the figure: its size, its axes, its curves and the study data
 *   under them
 * @returns the `<svg>` element as a string, drawn in one line; the same spec
 *   gives the same bytes
 */
export function plotSvg(spec: PlotSpec): string {
  const series = spec.series
  const {
    width,
    height,
    box,
    x,
    y,
    points,
    colours,
    entries,
    hasColourbar,
    legendLabels,
    barLabelRoom,
    colourOf,
  } = layoutOf(spec)

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
      const colour = colourOf(one.curve ?? one.id)
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
  const barBottom = box.y1 - (entries.length > 0 ? legendHeight(entries, legendLabels) + ROW : 0)
  const side = hasColourbar
    ? colourbarGroup(
        series,
        columnX,
        box.y0 + MARKER,
        Math.max(box.y0 + MIN_PLOT, barBottom),
        barLabelRoom,
      ) + legendGroup(entries, columnX, Math.max(box.y0 + MIN_PLOT, barBottom) + ROW, legendLabels)
    : legendGroup(entries, columnX, box.y0 + ROW / 2, legendLabels)

  const label = axisLabel(spec.yLabel, sharedUnit(series))
  const title = tag('title', {}, escape(`${label} over ${spec.xLabel}`))
  const background = tag('rect', {
    class: 'background',
    x: 0,
    y: 0,
    width,
    height,
    style: `fill:${token('figure-bg')}`,
  })
  const body =
    `${title}${defs}${background}` +
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
