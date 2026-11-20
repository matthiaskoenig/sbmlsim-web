/**
 * The figure of a panel: a plot specification in, one inline SVG string out.
 *
 * The renderer is pure. It touches no dom, no canvas and no plotting library,
 * and it draws the same bytes for the same spec, so the same figure is built
 * in a page, in a slide deck, in a test and in a worker. The one thing it
 * cannot know is how wide a text is drawn, since that is the font the host
 * resolves: every width it lays out with is asked of the measure of the spec
 * (`PlotSpec.measure`), which the element builds on the font it draws in, and
 * a spec without one is measured with the advance widths of Arial
 * (`tableMeasure`), so a figure without a dom is still one exact figure.
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
 * - a figure of one curve and no study data draws no legend, since its one
 *   entry is the quantity its y label names already (`loneCurve`); a figure of
 *   two or more curves, or with study data it draws or may draw, keeps it,
 * - a legend sits beside the plot or below it, packed into rows, whichever of
 *   the two leaves the larger plot box, so a figure which grows never loses
 *   plot at a width where the two trade places; it is laid out over the
 *   legends it may show (`declaredLegends`) and drawn with the one it has, so
 *   an entry which comes and goes does not move the box either,
 * - the label of an axis wraps at its words onto at most `AXIS_LINES` lines of
 *   the length of that axis, which is `_fit_margins` and `_wrap_label` of
 *   `sbmlsim.plot.serialization_matplotlib`; the margin of the figure grows by
 *   the lines it takes and by what the tick labels of either axis need beyond
 *   it,
 * - a line takes its colour from the colour map at its position, viridis over
 *   its first 85 % (`COLORMAP` and `_COLORMAP_END` of `sbmlsim.plot.points`),
 *   which `RAMP` carries as six anchors a `color-mix` reads between, so the
 *   curves, the legend swatches and the colour bar are one ramp of six tokens;
 *   reading between six anchors is up to 12 of 255 per channel away from
 *   `viridis(linspace(0, 0.85, n))`, which is the price of a ramp a host moves
 *   with six values and not of a table of colours nobody can move,
 * - a series of study data takes the colour of the curve it sits under and the
 *   shape of its position among the series of that curve (`MARKER_SHAPES`), so
 *   two studies under one curve share its colour and are told apart by their
 *   markers, while a curve of one series keeps the circle,
 * - the label of an axis is `<label> [<unit>]`, the `name` of an `Axis`.
 *
 * Numbers are short and stable: a coordinate is rounded to `COORD_DECIMALS`
 * decimals and written without trailing zeros (`-0` is `0`), a tick label to at
 * most six decimals, or to three significant digits in the exponential form
 * outside of `[1e-3, 1e5)`. Nothing of the output is ever `NaN`: a value which
 * is no finite number, and a value which is not positive on a logarithmic axis,
 * is no point of its path, which starts again with an `M` after the gap.
 */

/**
 * The band of a curve: a range drawn under it, point for point of the x of its
 * spec.
 *
 * It is what the figure draws and says nothing about where the range comes
 * from - the percentiles of a Monte Carlo, the interval of a fit, the spread
 * of a group. A value which is `NaN`, and one which is not positive on a
 * logarithmic axis, is no point of the band: a gap splits it into one filled
 * polygon per run of points, as a gap splits a curve into one path per run.
 */
export interface SeriesBand {
  /** The low end of the range over `PlotSpec.x`, `NaN` where it has none. */
  low: number[]
  /** The high end of the range over `PlotSpec.x`, `NaN` where it has none. */
  high: number[]
}

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
  /**
   * The range drawn under the curve in its colour, absent for a curve without
   * one; the axis of the figure holds it as it holds the values.
   */
  band?: SeriesBand
}

/**
 * One run a reader froze, drawn under the curves in their colours and dashed.
 *
 * It is the figure as it was at a state of the knobs, kept while the knobs move on, so two
 * states are read against each other in one plot. It carries the values alone: the colour of a
 * frozen curve is the colour of the series it was frozen from, which is what makes the pair of a
 * curve and its frozen self readable, and the dash says which run it is. A series of the run
 * which the spec no longer draws is not drawn either, and a series the spec draws and the run
 * has not simply has no frozen curve.
 */
export interface FrozenRun {
  /** Its place in the order the runs were frozen in, from 1, which picks its dash. */
  rank: number
  /** Its entry in the legend, e.g. the state of the knobs it was frozen at. */
  label: string
  /** The values of the series it was frozen from, by series id, over `PlotSpec.x`. */
  values: Record<string, number[]>
}

/** One series of study data, drawn as markers under the curve it belongs to. */
export interface Points {
  /** The id of the series, which it carries into the output as `data-series`. */
  id: string
  /** Its entry in the legend. */
  label: string
  /** The id of the curve which lends it its colour, its own id without one. */
  curve?: string
  /**
   * Its place among the series declared under that curve, which decides its
   * shape; its place among the drawn ones without, for a caller which has no
   * declaration to count.
   */
  rank?: number
  /** The x of its points, in the x of the figure. */
  x: number[]
  /** The value of its points, on the y of the figure. */
  y: number[]
  /** The error of every value, drawn as a bar; a point without one is `NaN`. */
  yerr?: number[]
}

/** The lower and the upper limit of an axis. */
export interface Limits {
  /** The lower limit. */
  low: number
  /** The upper limit, greater than the lower one. */
  high: number
}

/** The ends an axis is given, which are its limits exactly; an end which is absent is not given. */
export interface AxisEnds {
  /** The lower end. */
  low?: number
  /** The upper end. */
  high?: number
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
  /** The runs a reader froze, drawn under the curves, absent for none. */
  frozen?: FrozenRun[]
  /** The study data drawn under the curves, none without. */
  points?: Points[]
  /**
   * The values the y axis holds, instead of the ones which are drawn.
   *
   * It is what a caller passes which draws one of several lines of one answer
   * at a time: the limits are taken over all of them, so a line moves inside a
   * frame which holds still rather than redrawing itself inside a frame which
   * follows it. The limits of the axis are derived from it exactly as they are
   * derived from the drawn values, so the margin of the axis and, on a
   * logarithmic axis, the rule of the decades apply to the frame and not to the
   * line. A figure which does not carry it takes its limits from what it draws.
   */
  yLimits?: Limits
  /**
   * The ends of the y axis a caller declares, which are its limits exactly.
   *
   * A frame (`yLimits`) is what the axis is derived from, with its margin and
   * its rules; an end is no such frame, it is where the axis ends: the axis
   * runs from the one to the other, its ticks inside, and a curve or a point
   * beyond them is cut at the plot box and drawn over none of the margins, the
   * legend or the labels. Where one end is given, the other is derived as
   * without, from the frame or from what is drawn cut at the given end. On a
   * logarithmic axis the ends are the ends of the decades it shows, and an end
   * which is not positive is not taken there.
   */
  yEnds?: AxisEnds
  /**
   * The end of the x axis a caller declares, which is its limit exactly;
   * nothing beyond it is drawn, and study data beyond it is no point of the
   * figure, as data beyond the x of the curves is not.
   */
  xEnd?: number
  /**
   * Every legend of study data the figure may draw, each the labels of the
   * series drawn together, in the order the caller declares them.
   *
   * It is what a caller passes whose entries come and go while the figure stays
   * the same figure: the series of a panel are drawn under conditions of its
   * knobs, and each state of the knobs draws one list of them. The lists are
   * the ones the caller declares it may draw and not the series it happens to
   * have received, so a figure is laid out alike before and after its data
   * arrives (the panel derives them from its declaration). The legend
   * takes the width of its column over the widest label of any of these lists
   * and the rows of a legend below the plot over the list which needs the most
   * rows, and nothing is drawn for a label which has no series. A list is a
   * whole list in its order and not the labels which are missing, because the
   * rows are packed in the order they are given. The plot box is then a
   * function of what the caller may show and not of what it happens to show,
   * which is the rule the frame of the value axis follows as well, and it is
   * the box of the largest legend one state shows and not of every series at
   * once, which no state shows. Without it the figure lays its legend out
   * over the series it draws; the list it draws is always laid out with the
   * others, so the band never holds fewer rows than it draws.
   */
  declaredLegends?: string[][]
  /** The width of the figure in pixels. */
  width: number
  /** The height of the figure in pixels. */
  height: number
  /** Whether the y axis is logarithmic. */
  logY: boolean
  /**
   * How wide a text is drawn, `tableMeasure` without.
   *
   * Every width the layout takes - a tick label, the lines an axis label wraps
   * to, a legend entry and the rows they are packed into, the centring of a
   * row, the column beside the plot - is asked of it and of nothing else, so a
   * caller which measures the font the figure is drawn in gets a figure laid
   * out for the text a reader sees. It is read as a function of its two
   * arguments: the same text at the same size is the same width for as long as
   * the spec is drawn, and a caller whose font changes passes a new spec with
   * a new measure. A width which is no finite number of at least 0 is taken
   * from the table instead.
   */
  measure?: TextMeasure
  /**
   * The sizes the text of the figure is drawn in, the sizes of the design
   * without.
   *
   * The layout measures every text at the size it is drawn in and gives every
   * line, row and margin the height of its font, so a caller whose page sets
   * the size tokens (`--sbmlsim-font-size`, `--sbmlsim-font-size-small`)
   * passes the sizes they resolve to; the figure then writes them as the
   * fallbacks of those tokens, so a copy of it out of the page keeps them.
   */
  fontSizes?: FontSizes
}

/** The sizes the text of a figure is drawn in, in pixels. */
export interface FontSizes {
  /** The size of the labels of the axes, `--sbmlsim-font-size`. */
  label: number
  /** The size of the tick labels, the legend and the colour bar, `--sbmlsim-font-size-small`. */
  small: number
}

/**
 * Get how wide a text is drawn.
 *
 * @param text the text, as it is written into the figure
 * @param size the size of its font in pixels
 * @returns its width in pixels
 */
export type TextMeasure = (text: string, size: number) => number

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

/** The most decimals of a plain tick label; an axis which needs more is exponential. */
const PLAIN_DECIMALS = 6

/** The digits after the point of the mantissa of an exponential tick label at least. */
const EXPONENTIAL_DIGITS = 2

/** The most digits a tick label grows to, past which a double has none to tell apart. */
const MOST_DIGITS = 16

/**
 * The anchors of the colour ramp, as rgb: viridis over its first 55 %, the part
 * which keeps 3:1 on a light surface, the light ramp of `theme.css`.
 */
const RAMP = [
  'rgb(68 1 84)',
  'rgb(72 40 120)',
  'rgb(62 73 137)',
  'rgb(49 103 142)',
  'rgb(38 130 142)',
  'rgb(30 156 137)',
] as const

/** The fallback of every other token, the value of the sbmlsim report style. */
const TOKENS = {
  'figure-bg': 'transparent',
  fg: 'rgb(27 31 36)',
  'fg-soft': 'rgb(91 100 114)',
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  'axis-width': '1px',
  'curve-width': '1.8px',
  'data-width': '1px',
  'band-opacity': '0.18',
} as const

/** The padding between the figure and what it draws, in pixels. */
const PAD = 8
/** The length of a tick, in pixels. */
const TICK = 4
/**
 * The room left of the plot for one line of the y label and its tick labels,
 * in pixels, at the sizes of the design; it grows by what a larger font of the
 * label adds to its line (`letteringOf`).
 */
const LEFT = 64
/**
 * The room below the plot for the x tick labels and one line of the x label,
 * in pixels, at the sizes of the design; it grows by what larger fonts add to
 * the two.
 */
const BOTTOM = 42
/**
 * The share of the width of a figure the column of a legend or of a colour bar
 * may take. A label is given the room its characters need and no more, and this
 * is where that stops: past about a third of the figure the plot is the thing
 * which suffers, and a label which wants more is cut there. Whether the legend
 * is beside the plot at all is decided by the box the two layouts leave and not
 * by this cap; a colour bar, which is an axis of the figure and is read against
 * the height of the plot, keeps its column either way.
 */
const COLUMN_SHARE = 0.35
/** The units of an em of the advance widths of `ADVANCES`. */
const UNITS_PER_EM = 2048
/**
 * The advance width of a character of Arial, in units of `UNITS_PER_EM`.
 *
 * They are the `hmtx` advances of Liberation Sans Regular 2.1, which is
 * metrically compatible with Arial by design, and Arial with Helvetica, so the
 * table is the width of the fallback of the font token on windows, of the
 * Helvetica of a mac and of the Liberation Sans or Arimo of linux; read with
 * fontTools from `LiberationSans-Regular.ttf`. It covers printable ASCII and
 * the characters of units and of a cut label; kerning is left out, as it is
 * of a width of the table.
 */
const ADVANCES: Readonly<Record<string, number>> = {
  ' ': 569,
  '!': 569,
  '"': 727,
  '#': 1139,
  $: 1139,
  '%': 1821,
  '&': 1366,
  "'": 391,
  '(': 682,
  ')': 682,
  '*': 797,
  '+': 1196,
  ',': 569,
  '-': 682,
  '.': 569,
  '/': 569,
  '0': 1139,
  '1': 1139,
  '2': 1139,
  '3': 1139,
  '4': 1139,
  '5': 1139,
  '6': 1139,
  '7': 1139,
  '8': 1139,
  '9': 1139,
  ':': 569,
  ';': 569,
  '<': 1196,
  '=': 1196,
  '>': 1196,
  '?': 1139,
  '@': 2079,
  A: 1366,
  B: 1366,
  C: 1479,
  D: 1479,
  E: 1366,
  F: 1251,
  G: 1593,
  H: 1479,
  I: 569,
  J: 1024,
  K: 1366,
  L: 1139,
  M: 1706,
  N: 1479,
  O: 1593,
  P: 1366,
  Q: 1593,
  R: 1479,
  S: 1366,
  T: 1251,
  U: 1479,
  V: 1366,
  W: 1933,
  X: 1366,
  Y: 1366,
  Z: 1251,
  '[': 569,
  '\\': 569,
  ']': 569,
  '^': 961,
  _: 1139,
  '`': 682,
  a: 1139,
  b: 1139,
  c: 1024,
  d: 1139,
  e: 1139,
  f: 569,
  g: 1139,
  h: 1139,
  i: 455,
  j: 455,
  k: 1024,
  l: 455,
  m: 1706,
  n: 1139,
  o: 1139,
  p: 1139,
  q: 1139,
  r: 682,
  s: 1024,
  t: 569,
  u: 1139,
  v: 1024,
  w: 1479,
  x: 1024,
  y: 1024,
  z: 1024,
  '{': 684,
  '|': 532,
  '}': 684,
  '~': 1196,
  '°': 819,
  '±': 1124,
  '²': 682,
  '³': 682,
  µ: 1180,
  '·': 682,
  '×': 1196,
  α: 1184,
  β: 1178,
  μ: 1180,
  '–': 1139,
  '…': 2048,
  '−': 1196,
}
/** The advance of a character the table does not carry, the one of a digit and of `n`. */
const UNKNOWN_ADVANCE = 1139
/** The width of the bar of a colour bar, in pixels. */
const COLOURBAR_BAR = 12
/** The gap between the plot and the column right of it, in pixels. */
const COLUMN_GAP = 12
/** The length of the line of a legend entry, in pixels. */
const SWATCH = 18
/** The pixels a row of a legend is taller than the size of its font. */
const ROW_LEADING = 7
/** The pixels a further line of a legend entry is taller than the size of its font. */
const LEGEND_LEADING = 2
/** The most lines a legend entry is given before its last line is cut. */
const LEGEND_LINES = 2
/** The most lines the label of an axis is given before its last line is cut. */
const AXIS_LINES = 2
/** The pixels a further line of the label of an axis is taller than its font. */
const AXIS_LEADING = 2
/** The radius of the marker of a study point, in pixels. */
const MARKER = 3
/**
 * The shapes the series under one curve are drawn with, in their order.
 *
 * Two series under one curve carry the colour of that curve, so the shape is
 * what tells them apart; the first of them is the circle every series was
 * drawn as before there were shapes.
 */
const MARKER_SHAPES = ['circle', 'square', 'triangle', 'diamond'] as const
/** The half side of the square marker, which carries the area of the circle. */
const SQUARE = (MARKER * Math.sqrt(Math.PI)) / 2
/** The half diagonal of the diamond marker, which carries that area as well. */
const DIAMOND = MARKER * Math.sqrt(Math.PI / 2)
/** The circumradius of the triangle marker, which carries it too. */
const TRIANGLE = MARKER * Math.sqrt((4 * Math.PI) / (3 * Math.sqrt(3)))
/** The half width of the cap of an error bar, in pixels. */
const CAP = 3
/** The pixels a tick of the x axis is given, which is how many ticks it gets. */
const X_TICK_ROOM = 70
/** The pixels a tick of the y axis is given, which is how many ticks it gets. */
const Y_TICK_ROOM = 50
/**
 * The fewest ticks an axis asks for whatever its length; an x axis whose
 * labels do not fit that many asks for fewer (`xAxisOf`).
 */
const LEAST_TICKS = 3
/** The gap two labels of neighbouring ticks of the x axis keep, in pixels. */
const TICK_GAP = 6
/** The most ticks an axis gets whatever its length. */
const MOST_TICKS = 8
/** The counts of ticks an axis can get, which are the tick sets of its limits. */
const TICK_COUNTS = MOST_TICKS - LEAST_TICKS + 1
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
/**
 * The size of the font of a tick, a legend entry and a label of a colour bar in
 * pixels, the default of `--sbmlsim-font-size-small`.
 */
const SMALL_FONT = 11
/** The size of the font of an axis label in pixels, the default of `--sbmlsim-font-size`. */
const LABEL_FONT = 12
/** What a sum of pixels may be off by and still count as the same room. */
const ROUNDING = 1e-9
/**
 * How far a tick label may lie from where its tick centres it, in pixels:
 * every tick label starts on a whole pixel (`labelStart`), so it moves by at
 * most half a pixel, and the room of the labels is solved with that half
 * pixel more, so a snapped label still keeps inside the figure.
 */
const SNAP = 0.5
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

/** One of the shapes a series of study data is drawn with. */
type MarkerShape = (typeof MARKER_SHAPES)[number]

/**
 * The dashes of the frozen runs, by their rank, which repeat past the last one.
 *
 * They are read apart at the width of a curve and at the size of a small panel, and no run is
 * drawn solid, which is the live curve alone.
 */
const FROZEN_DASHES = ['5 3', '1.5 2.5', '9 3 1.5 3', '4 2 1 2'] as const

/** How opaque a frozen curve is drawn against the live one over it. */
const FROZEN_OPACITY = '0.85'

/** How many frozen runs are drawn apart before the dashes repeat. */
export const FROZEN_RUNS = FROZEN_DASHES.length

/**
 * Get the dash of a frozen run.
 *
 * @param rank its place in the order the runs were frozen in, from 1
 * @returns the dash array of its curves
 */
export function frozenDash(rank: number): string {
  const index = (Math.max(1, Math.trunc(rank)) - 1) % FROZEN_DASHES.length
  return FROZEN_DASHES[index] ?? FROZEN_DASHES[0]
}

/** One entry of a legend: a curve or a series of study data. */
interface Entry {
  /** The id of the curve or the series. */
  id: string
  /** The text of the entry. */
  label: string
  /** Its colour, a token or a mix of two of them. */
  colour: string
  /** The shape of its marker, `null` for a curve, which is drawn as a line. */
  shape: MarkerShape | null
  /** The dash of its line, absent for a solid one; a frozen run is drawn with it. */
  dash?: string
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
 * @param digits the decimals it carries in the plain form, or the digits after
 *   the point of its mantissa in the exponential form
 * @param exponential whether it is written in the exponential form, which is
 *   decided for a whole axis and not for one of its ticks
 * @returns it without trailing zeros; 0 is `0` in either form
 */
function formatNumber(value: number, digits: number, exponential: boolean): string {
  if (!Number.isFinite(value)) {
    return '0'
  }
  if (value === 0) {
    return '0'
  }
  const kept = clamp(Math.round(digits), 0, MOST_DIGITS)
  const text = exponential ? value.toExponential(kept) : value.toFixed(kept)
  const short = text.replace(/(\.\d*?)0+(?=$|e)/, '$1').replace(/\.(?=$|e)/, '')
  return short === '-0' ? '0' : short
}

/**
 * Write the tick labels of an axis.
 *
 * The labels carry the precision the axis needs and no more: the decimals of
 * its step in the plain form (`tickDecimals`) and two digits after the point of
 * the mantissa in the exponential form, each grown by one digit at a time
 * until no two neighbouring ticks of different values read the same. An axis
 * over 123456 to 123466 is no six labels `1.23e+5` but `1.23456e+5` to
 * `1.23466e+5`, and one over 0.001 to 0.001001 no three `0.001` and three
 * `0.001001` but its ticks in the exponential form, which a plain label would
 * need more than `PLAIN_DECIMALS` decimals for. The notation still belongs to
 * the axis (`exponentialTicks`), so its labels never mix the two forms.
 *
 * @param ticks the ticks of the axis, in their order
 * @returns the label of each tick, in the same order
 */
function tickLabels(ticks: number[]): string[] {
  const decimals = tickDecimals(ticks)
  const exponential = exponentialTicks(ticks) || decimals > PLAIN_DECIMALS
  let digits = exponential ? EXPONENTIAL_DIGITS : decimals
  let labels = ticks.map((value) => formatNumber(value, digits, exponential))
  while (digits < MOST_DIGITS && !distinctLabels(ticks, labels)) {
    digits += 1
    labels = ticks.map((value) => formatNumber(value, digits, exponential))
  }
  return labels
}

/**
 * Get whether neighbouring ticks of different values have different labels.
 *
 * @param ticks the ticks of an axis, in their order
 * @param labels their labels
 * @returns whether no two neighbours of different values read the same
 */
function distinctLabels(ticks: number[], labels: string[]): boolean {
  for (let index = 1; index < ticks.length; index += 1) {
    if (ticks[index] !== ticks[index - 1] && labels[index] === labels[index - 1]) {
      return false
    }
  }
  return true
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
 * Measure a text with the advance widths of Arial, `ADVANCES`.
 *
 * It is the measure of a spec which carries none: the tests, the pinned
 * figure and a host which has no canvas to measure with. It reads a table and
 * nothing else, so the same text at the same size is the same width on every
 * machine.
 *
 * @param text the text
 * @param size the size of its font in pixels
 * @returns the sum of the advances of its characters at that size, a
 *   character the table does not carry counted as a digit
 */
export function tableMeasure(text: string, size: number): number {
  let units = 0
  for (const character of text) {
    units += ADVANCES[character] ?? UNKNOWN_ADVANCE
  }
  return (units / UNITS_PER_EM) * size
}

/**
 * Get the measure a figure is laid out with.
 *
 * @param spec the figure
 * @returns its measure, which falls back to the table for a width which is no
 *   finite number of at least 0, so a measure which fails on one text cannot
 *   put a `NaN` into the layout
 */
function measureOf(spec: PlotSpec): TextMeasure {
  const given = spec.measure
  if (given === undefined) {
    return tableMeasure
  }
  return (text, size) => {
    const width = given(text, size)
    return Number.isFinite(width) && width >= 0 ? width : tableMeasure(text, size)
  }
}

/** The segmenter a label is cut with, by its graphemes where the runtime has one. */
const GRAPHEMES =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('en', { granularity: 'grapheme' })
    : null

/**
 * Split a text into the characters a cut may fall between.
 *
 * @param text the text
 * @returns its graphemes, so a cut never separates a letter from its accent or
 *   the halves of a pair of surrogates; its code points where the runtime has
 *   no segmenter
 */
function charactersOf(text: string): string[] {
  return GRAPHEMES === null
    ? Array.from(text)
    : Array.from(GRAPHEMES.segment(text), (one) => one.segment)
}

/** The measure and the sizes a figure lays its text out with. */
interface Lettering {
  /** How wide a text is drawn. */
  measure: TextMeasure
  /** The size of the labels of the axes, in pixels. */
  label: number
  /** The size of the tick labels, the legend and the colour bar, in pixels. */
  small: number
  /** The height of a further line of the label of an axis. */
  axisLine: number
  /** The height of a row of a legend. */
  row: number
  /** The height of a further line of a legend entry which wraps. */
  legendLine: number
  /** The room above the plot, which holds half of the top y tick label. */
  top: number
  /** The room below the plot for the x tick labels and one line of the x label. */
  bottom: number
  /** The room left of the plot for one line of the y label and its tick labels. */
  left: number
}

/**
 * Get one size of the font of a figure.
 *
 * @param given the size a caller passed
 * @param fallback the size of the design
 * @returns the size, the one of the design for one which is no size
 */
function fontSize(given: number | undefined, fallback: number): number {
  return given !== undefined && Number.isFinite(given) && given >= 1 ? given : fallback
}

/**
 * Get the measure and the sizes a figure lays its text out with.
 *
 * Every height of a line follows the size of its font, and every room which
 * holds text grows by what the font adds over the size of the design, so a
 * figure of the default sizes is the figure it always was.
 *
 * @param spec the figure
 * @returns its lettering
 */
function letteringOf(spec: PlotSpec): Lettering {
  const label = fontSize(spec.fontSizes?.label, LABEL_FONT)
  const small = fontSize(spec.fontSizes?.small, SMALL_FONT)
  return {
    measure: measureOf(spec),
    label,
    small,
    axisLine: label + AXIS_LEADING,
    row: small + ROW_LEADING,
    legendLine: small + LEGEND_LEADING,
    top: PAD + Math.ceil(small / 2),
    bottom: BOTTOM + (small - SMALL_FONT) + (label - LABEL_FONT),
    left: LEFT + (label - LABEL_FONT),
  }
}

/**
 * Write the size of a font as a token with the size of the figure as its fallback.
 *
 * @param name the token
 * @param size the size the figure was laid out for
 * @returns the `var()` a style of the output carries
 */
function sizeToken(name: 'font-size' | 'font-size-small', size: number): string {
  return `var(--sbmlsim-${name}, ${coord(size)}px)`
}

/**
 * Get whether a text fits the room it has.
 *
 * @param text the text
 * @param room the pixels it has
 * @param fontSize the size of its font in pixels
 * @param measure the measure of the figure
 * @returns whether its width is within the room
 */
function fits(text: string, room: number, fontSize: number, measure: TextMeasure): boolean {
  return measure(text, fontSize) <= room + ROUNDING
}

/**
 * Get the longest start of a text which fits a room.
 *
 * @param characters the characters of the text
 * @param room the pixels the start has
 * @param fontSize the size of its font in pixels
 * @param measure the measure of the figure
 * @param after what is written after the start, which is measured with it
 * @returns how many characters the start keeps, 0 where not even one fits
 */
function fittingStart(
  characters: string[],
  room: number,
  fontSize: number,
  measure: TextMeasure,
  after = '',
): number {
  let kept = 0
  while (
    kept < characters.length &&
    fits(characters.slice(0, kept + 1).join('') + after, room, fontSize, measure)
  ) {
    kept += 1
  }
  return kept
}

/**
 * Cut a label to the room it has.
 *
 * @param label the label
 * @param room the pixels it has
 * @param fontSize the size of its font in pixels
 * @param measure the measure of the figure
 * @returns the label where it fits, else as many of its first characters as
 *   fit together with an ellipsis after them, so a cut label says that it was
 *   cut; nothing at all where not even the ellipsis fits
 */
function fittingLabel(label: string, room: number, fontSize: number, measure: TextMeasure): string {
  if (fits(label, room, fontSize, measure)) {
    return label
  }
  if (!fits(ELLIPSIS, room, fontSize, measure)) {
    return ''
  }
  const characters = charactersOf(label)
  const kept = fittingStart(characters, room, fontSize, measure, ELLIPSIS)
  return characters.slice(0, kept).join('') + ELLIPSIS
}

/**
 * Lay a label out on the lines of the room it has.
 *
 * A label which does not fit one line wraps at its words, so a legend in a
 * narrow column still tells its curves apart: a cut at the end of the line
 * would leave only the prefix the labels of a panel share. A word which is
 * longer than a line breaks where the line ends, as there is no other place to
 * break it. Past `most` lines the last one keeps the end of the label and not
 * its start, with the ellipsis in front of it: the words which tell two labels
 * apart are the last ones, and the first line already shows the head of the
 * label, so the reader sees both ends and loses the middle. That end starts at
 * a word wherever the room it has holds one, so the reader is given words and
 * not the tail of a word which reads as another one. The unit of an axis label
 * is its last word and therefore the one thing a cut label always keeps, which
 * is what a reader cannot guess. Every line is measured as it is written, its
 * spaces included.
 *
 * @param label the label
 * @param room the pixels a line has
 * @param fontSize the size of its font in pixels
 * @param most the lines it is given before its last one is cut
 * @param measure the measure of the figure
 * @returns the lines, at least one; a single empty line where not even its
 *   first character fits
 */
function wrapLabel(
  label: string,
  room: number,
  fontSize: number,
  most: number,
  measure: TextMeasure,
): string[] {
  if (fits(label, room, fontSize, measure)) {
    return [label]
  }
  if (fittingStart(charactersOf(label), room, fontSize, measure) < 1) {
    return ['']
  }
  const lines: string[] = []
  let line = ''
  for (const word of label.split(' ')) {
    // a word breaks into the longest pieces a line holds, at least one
    // character each, so a word which no line holds still makes progress
    const pieces: string[] = []
    let left = charactersOf(word)
    do {
      const kept = Math.max(1, fittingStart(left, room, fontSize, measure))
      pieces.push(left.slice(0, kept).join(''))
      left = left.slice(kept)
    } while (left.length > 0)
    for (const piece of pieces) {
      const joined = line === '' ? piece : `${line} ${piece}`
      if (fits(joined, room, fontSize, measure)) {
        line = joined
      } else {
        lines.push(line)
        line = piece
      }
    }
  }
  lines.push(line)
  if (lines.length <= most) {
    return lines
  }
  const kept = lines.slice(0, most - 1)
  const rest = lines.slice(most - 1).join(' ')
  if (fits(rest, room, fontSize, measure)) {
    return [...kept, rest]
  }
  // the kept end of the last line is the longest end which fits after the
  // ellipsis, and it starts at a word where it can: a cut inside a word reads
  // as another word and the reader cannot tell which it is, and a word longer
  // than the room there is has nowhere else to break
  const characters = charactersOf(rest)
  let start = characters.length
  while (
    start > 0 &&
    fits(ELLIPSIS + characters.slice(start - 1).join(''), room, fontSize, measure)
  ) {
    start -= 1
  }
  const tail = characters.slice(start).join('')
  const space = tail.indexOf(' ')
  const end = space >= 0 && space < tail.length - 1 ? tail.slice(space + 1) : tail
  return [...kept, ELLIPSIS + end]
}

/**
 * Get the lines a legend entry is written on.
 *
 * @param label the label of the entry
 * @param room the pixels a line has
 * @param wrap whether the legend wraps its labels or cuts them on one line
 * @param type the lettering of the figure
 * @returns the lines
 */
function legendLines(label: string, room: number, wrap: boolean, type: Lettering): string[] {
  return wrap
    ? wrapLabel(label, room, type.small, LEGEND_LINES, type.measure)
    : [fittingLabel(label, room, type.small, type.measure)]
}

/**
 * Get how tall a legend is, which the lines its entries are written on decide.
 *
 * @param entries the entries
 * @param room the pixels a label has
 * @param wrap whether the legend wraps its labels
 * @param type the lettering of the figure
 * @returns the pixels from the top of the first row of the legend to the end of
 *   its last
 */
function legendHeight(entries: Entry[], room: number, wrap: boolean, type: Lettering): number {
  return entries.reduce(
    (sum, entry) =>
      sum + type.row + (legendLines(entry.label, room, wrap, type).length - 1) * type.legendLine,
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
 * Get the limits of an axis of the values it covers and the ends it is given.
 *
 * Without an end, the limits are the ones the values give, with the margin of
 * the axis and on a logarithmic axis the rule of the decades. An end which is
 * given is the end of the axis exactly: a figure which declares where its axis
 * ends is drawn against that axis whatever its values reach, so two states of
 * it can be compared, and a value beyond the end is cut at the plot box. Where
 * one end is given the other is the one the values give, taken over the values
 * cut at the given end and the end itself, so its margin is the one of the span
 * the axis shows. On a logarithmic axis an end which is not positive is no end
 * of it and is not taken: a panel which declares its linear axis to start at
 * 0 and is drawn logarithmic has the decades of its values there.
 *
 * @param values the values the axis covers
 * @param log whether it is logarithmic
 * @param ends the ends it is given, none of them without; a pair which is no
 *   span, a lower end at or above the upper one, is not taken
 * @returns the limits, the lower one below the upper one
 */
function limitsOf(values: number[], log: boolean, ends: AxisEnds = {}): Limits {
  const usable = (end: number | undefined): end is number =>
    end !== undefined && Number.isFinite(end) && (!log || end > 0)
  let low = usable(ends.low) ? ends.low : undefined
  let high = usable(ends.high) ? ends.high : undefined
  if (low !== undefined && high !== undefined && !(low < high)) {
    low = undefined
    high = undefined
  }
  if (low !== undefined && high !== undefined) {
    return { low, high }
  }
  const derive = log ? logLimits : linearLimits
  if (low === undefined && high === undefined) {
    return derive(values)
  }
  const kept = values.filter((value) => Number.isFinite(value) && (!log || value > 0))
  if (high !== undefined) {
    const top = high
    return { low: derive([...kept.map((value) => Math.min(value, top)), top]).low, high: top }
  }
  const bottom = low ?? 0
  return {
    low: bottom,
    high: derive([...kept.map((value) => Math.max(value, bottom)), bottom]).high,
  }
}

/**
 * Build an axis of a figure.
 *
 * @param limits the limits of the axis (`limitsOf`)
 * @param log whether it is logarithmic
 * @param from the pixel of its lower limit
 * @param to the pixel of its upper limit
 * @param count how many ticks are wanted
 * @returns the axis
 */
function axisOf(limits: Limits, log: boolean, from: number, to: number, count: number): Axis {
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
 * The ticks of a linear axis are multiples of the step between two of them, so
 * the step is what they are written with. The ladder of a logarithmic axis is
 * thinned where it carries more labels than the axis asked for, and its
 * smallest tick then needs more decimals than that step: `0.001` of a ladder
 * thinned to every second decade would be written with the two decimals of the
 * step below it, which is `0`. Trailing zeros are dropped, so the decimals the
 * smallest tick needs cost the larger ones nothing.
 *
 * @param ticks the ticks of the axis
 * @returns the decimals of the smallest step between two of them and of the
 *   smallest of them, which `tickLabels` writes in the exponential form where
 *   they are more than `PLAIN_DECIMALS`
 */
function tickDecimals(ticks: number[]): number {
  let step = Number.POSITIVE_INFINITY
  let smallest = Number.POSITIVE_INFINITY
  for (const value of ticks) {
    if (value !== 0 && Number.isFinite(value)) {
      smallest = Math.min(smallest, Math.abs(value))
    }
  }
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
  const needed = Math.max(
    Math.ceil(-Math.log10(step)),
    Number.isFinite(smallest) ? Math.ceil(-Math.log10(smallest)) : 0,
  )
  return clamp(needed, 0, MOST_DIGITS)
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
 * Get the room the widest of a set of labels needs.
 *
 * @param labels the labels
 * @param type the lettering of the figure
 * @returns the pixels of the widest of them, 0 without a label
 */
function widest(labels: string[], type: Lettering): number {
  return labels.reduce((most, one) => Math.max(most, type.measure(one, type.small)), 0)
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
 * Get the title of a figure, the name a reader who does not see it is given.
 *
 * @param spec the figure
 * @returns `<y label> [<unit>] over <x label>`, the `<title>` of its SVG
 */
export function figureTitle(spec: PlotSpec): string {
  return `${axisLabel(spec.yLabel, sharedUnit(spec.series))} over ${spec.xLabel}`
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
 * Write the path of the band of a curve.
 *
 * The band of a run of points is the closed polygon of its low end and its
 * high end read back, filled and not stroked. A point whose two ends are not
 * both drawable is no point of it, so a gap splits the band into one polygon
 * per run, exactly as it splits a curve into one path per run (`pathOf`); a run
 * of one point is a polygon of no area and is left out.
 *
 * @param xs the x of the values
 * @param band the band
 * @param x the x axis
 * @param y the y axis
 * @returns the `d` of the path, empty for a band without a run of two points
 */
function bandOf(xs: number[], band: SeriesBand, x: Axis, y: Axis): string {
  const count = Math.min(xs.length, band.low.length, band.high.length)
  const parts: string[] = []
  let run: { at: number; low: number; high: number }[] = []
  const close = (): void => {
    if (run.length > 1) {
      const low = run.map(
        (one, index) =>
          `${index === 0 ? 'M' : 'L'}${coord(x.position(one.at))} ${coord(y.position(one.low))}`,
      )
      const high = [...run]
        .reverse()
        .map((one) => `L${coord(x.position(one.at))} ${coord(y.position(one.high))}`)
      parts.push(`${low.join(' ')} ${high.join(' ')} Z`)
    }
    run = []
  }
  for (let index = 0; index < count; index += 1) {
    const at = xs[index]
    const low = band.low[index]
    const high = band.high[index]
    const drawable =
      at !== undefined &&
      low !== undefined &&
      high !== undefined &&
      x.drawable(at) &&
      y.drawable(low) &&
      y.drawable(high)
    if (drawable) {
      run.push({ at, low, high })
    } else {
      close()
    }
  }
  close()
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
 * Get the x a figure draws: the x its curves cover, up to the end of its x axis.
 *
 * @param spec the figure
 * @returns the smallest x of the curves and the largest one or the declared
 *   end of the x axis, whichever is smaller; `null` for a figure whose curves
 *   cover no x, which cuts nothing
 */
function xRange(spec: PlotSpec): Limits | null {
  const range = curveRange(spec.x)
  const end = spec.xEnd
  if (range === null || end === undefined || !Number.isFinite(end) || end >= range.high) {
    return range
  }
  return { low: range.low, high: Math.max(range.low, end) }
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
    // the upper end alike: an axis which ends below the bar, where a caller
    // declared its end, cuts the bar there and draws no cap of a bound which
    // was not measured
    const tops = high <= y.limits.high
    const px = coord(x.position(at))
    const left = coord(x.position(at) - CAP)
    const right = coord(x.position(at) + CAP)
    const top = coord(y.position(tops ? high : y.limits.high))
    const bottom = coord(y.position(reaches ? low : y.limits.low))
    parts.push(`M${px} ${top} L${px} ${bottom}`)
    if (tops) {
      parts.push(`M${left} ${top} L${right} ${top}`)
    }
    if (reaches) {
      parts.push(`M${left} ${bottom} L${right} ${bottom}`)
    }
  }
  return parts.join(' ')
}

/**
 * Get the shape of every series of study data.
 *
 * The series under one curve take the shapes of `MARKER_SHAPES` by their
 * `rank`, their place among the series declared under that curve, and start
 * again at the first of them past the last shape, so two series of one curve,
 * which share its colour, are told apart by their shape and neither changes
 * shape when the other is left out of the figure. A series without a rank
 * takes its place among the drawn ones, and a curve of one series therefore
 * keeps the circle it always had.
 *
 * @param points the series which are drawn
 * @returns the shape of every one of them, in that order
 */
function markerShapes(points: Points[]): MarkerShape[] {
  const drawn = new Map<string, number>()
  return points.map((one) => {
    const curve = one.curve ?? one.id
    const next = drawn.get(curve) ?? 0
    drawn.set(curve, next + 1)
    const index = one.rank ?? next
    return MARKER_SHAPES[index % MARKER_SHAPES.length] ?? 'circle'
  })
}

/**
 * Write one marker of a series of study data.
 *
 * @param shape the shape of the marker
 * @param colour its colour
 * @param cx the pixel of its centre on the x axis
 * @param cy the pixel of its centre on the y axis
 * @param className the class the element carries
 * @returns the element: a circle, or the closed path of a polygon of the same
 *   area, so no shape weighs more than another
 */
function markerTag(
  shape: MarkerShape,
  colour: string,
  cx: number,
  cy: number,
  className: string,
): string {
  const style = `fill:${colour}`
  if (shape === 'circle') {
    return tag('circle', { class: className, style, cx: coord(cx), cy: coord(cy), r: MARKER })
  }
  const corners: [number, number][] =
    shape === 'square'
      ? [
          [-SQUARE, -SQUARE],
          [SQUARE, -SQUARE],
          [SQUARE, SQUARE],
          [-SQUARE, SQUARE],
        ]
      : shape === 'diamond'
        ? [
            [0, -DIAMOND],
            [DIAMOND, 0],
            [0, DIAMOND],
            [-DIAMOND, 0],
          ]
        : [
            [0, -TRIANGLE],
            [(TRIANGLE * Math.sqrt(3)) / 2, TRIANGLE / 2],
            [(-TRIANGLE * Math.sqrt(3)) / 2, TRIANGLE / 2],
          ]
  const d = corners
    .map(([dx, dy], index) => `${index === 0 ? 'M' : 'L'}${coord(cx + dx)} ${coord(cy + dy)}`)
    .join(' ')
  return tag('path', { class: className, style, d: `${d} Z` })
}

/**
 * Write the markers of a series of study data.
 *
 * @param points the series
 * @param colour the colour of the series
 * @param shape the shape of its markers
 * @param x the x axis
 * @param y the y axis
 * @returns the markers of the points which can be drawn
 */
function markersOf(points: Points, colour: string, shape: MarkerShape, x: Axis, y: Axis): string {
  const count = Math.min(points.x.length, points.y.length)
  const drawn: string[] = []
  for (let index = 0; index < count; index += 1) {
    const at = points.x[index]
    const value = points.y[index]
    if (at === undefined || value === undefined || !x.drawable(at) || !y.drawable(value)) {
      continue
    }
    drawn.push(markerTag(shape, colour, x.position(at), y.position(value), 'marker'))
  }
  return drawn.join('')
}

/**
 * Write one axis of the figure with its ticks and its label.
 *
 * @param axis the axis
 * @param horizontal whether it is the x axis
 * @param box the plot box
 * @param lines the label of the axis, with its unit, on the lines it wraps to
 * @param room the pixels the margin of the axis has, which is where its label
 *   and its tick labels are written
 * @param type the lettering of the figure
 * @returns the group of the axis
 */
function axisGroup(
  axis: Axis,
  horizontal: boolean,
  box: { x0: number; y0: number; x1: number; y1: number },
  lines: string[],
  room: number,
  type: Lettering,
): string {
  const labels = tickLabels(axis.ticks)
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
    .map((value, index) => ({ value, label: labels[index] ?? '' }))
    .filter(({ value }) => axis.drawable(value))
    .map(({ value, label }) => {
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
      // every tick label is anchored on a whole pixel (`labelStart`): an x label
      // at the start it is centred from, a y label at its end and its middle
      const written = horizontal
        ? text(label, {
            style: `fill:${token('fg-soft')};stroke:none`,
            x: coord(labelStart(at, type.measure(label, type.small))),
            y: coord(box.y1 + TICK + LABEL_GAP),
            'text-anchor': 'start',
            'dominant-baseline': 'hanging',
          })
        : text(label, {
            style: `fill:${token('fg-soft')};stroke:none`,
            x: coord(Math.round(box.x0 - TICK - LABEL_GAP)),
            y: coord(Math.round(at)),
            'text-anchor': 'end',
            'dominant-baseline': 'central',
          })
      return tag('g', { class: 'tick' }, `${mark}${written}`)
    })
    .join('')
  const middle = horizontal ? (box.x0 + box.x1) / 2 : (box.y0 + box.y1) / 2
  // a label which is longer than its axis wraps at its words onto the lines the
  // margin was grown for, and the last of them is cut with an ellipsis in front
  // of it, which keeps the unit at its end: the unit is what a reader cannot
  // guess. The x label is written upwards from the bottom of its margin and the
  // y label rightwards from the left edge of the figure, so the line nearest
  // the plot is the last one of the label and the first one of it respectively
  const style = `fill:${token('fg')};stroke:none;font-size:${sizeToken('font-size', type.label)}`
  const title = lines
    .map((line, index) =>
      horizontal
        ? text(line, {
            class: 'axis-label',
            style,
            x: coord(middle),
            y: coord(box.y1 + room - PAD - LABEL_GAP - (lines.length - 1 - index) * type.axisLine),
            'text-anchor': 'middle',
          })
        : text(line, {
            class: 'axis-label',
            style,
            x: coord(PAD + index * type.axisLine),
            y: coord(middle),
            transform: `rotate(-90 ${coord(PAD + index * type.axisLine)} ${coord(middle)})`,
            'text-anchor': 'middle',
            'dominant-baseline': 'hanging',
          }),
    )
    .join('')
  return tag(
    'g',
    {
      class: horizontal ? 'axis x' : 'axis y',
      style:
        `stroke:${token('fg-soft')};stroke-width:${token('axis-width')};` +
        `fill:none;font-size:${sizeToken('font-size-small', type.small)}`,
    },
    `${line}${ticks}${title}`,
  )
}

/**
 * Write one entry of a legend: its swatch and the lines of its label.
 *
 * @param entry the entry
 * @param x the pixel its swatch starts at
 * @param y the pixel its first line is centred on
 * @param lines the lines of its label
 * @param type the lettering of the figure
 * @returns the group of the entry
 */
function legendEntry(entry: Entry, x: number, y: number, lines: string[], type: Lettering): string {
  const swatch = entry.shape
    ? markerTag(entry.shape, entry.colour, x + SWATCH / 2, y, 'swatch')
    : tag('line', {
        class: 'swatch',
        style:
          `stroke:${entry.colour};stroke-width:${token('curve-width')}` +
          (entry.dash === undefined ? '' : `;stroke-dasharray:${entry.dash}`),
        x1: coord(x),
        y1: coord(y),
        x2: coord(x + SWATCH),
        y2: coord(y),
      })
  const written = lines
    .map((line, index) =>
      text(line, {
        x: coord(x + SWATCH + LABEL_GAP * 2),
        y: coord(y + index * type.legendLine),
        'dominant-baseline': 'central',
      }),
    )
    .join('')
  return tag('g', { class: 'legend-entry', 'data-series': entry.id }, `${swatch}${written}`)
}

/**
 * Get the pixels one entry of a legend needs on a line of its own.
 *
 * @param entry the entry
 * @param type the lettering of the figure
 * @returns its swatch, the gap after it and the width of its label
 */
function entryRoom(entry: Entry, type: Lettering): number {
  return SWATCH + LABEL_GAP * 2 + type.measure(entry.label, type.small)
}

/**
 * Pack the entries of a legend into the rows of the width it has.
 *
 * @param entries the entries, in their order
 * @param room the pixels a row has
 * @param type the lettering of the figure
 * @returns the rows, in their order; an entry which is wider than a row on its
 *   own gets a row of its own, where its label is cut when it is written
 */
function legendRows(entries: Entry[], room: number, type: Lettering): Entry[][] {
  const rows: Entry[][] = []
  let row: Entry[] = []
  let used = 0
  for (const entry of entries) {
    const needed = entryRoom(entry, type)
    if (row.length > 0 && used + COLUMN_GAP + needed > room + ROUNDING) {
      rows.push(row)
      row = []
      used = 0
    }
    used += used === 0 ? needed : COLUMN_GAP + needed
    row.push(entry)
  }
  if (row.length > 0) {
    rows.push(row)
  }
  return rows
}

/**
 * Write the legend of a figure, as the column right of its plot.
 *
 * @param entries the entries, in their order
 * @param x the pixel the column of the legend starts at
 * @param y the pixel its first row is centred on
 * @param room the pixels a label has
 * @param wrap whether a label which is longer wraps; otherwise it is cut on one line
 * @param type the lettering of the figure
 * @returns the group of the legend, empty for no entry at all
 */
function legendGroup(
  entries: Entry[],
  x: number,
  y: number,
  room: number,
  wrap: boolean,
  type: Lettering,
): string {
  if (entries.length === 0) {
    return ''
  }
  let at = y
  const rows = entries
    .map((entry) => {
      const lines = legendLines(entry.label, room, wrap, type)
      const written = legendEntry(entry, x, at, lines, type)
      at += type.row + (lines.length - 1) * type.legendLine
      return written
    })
    .join('')
  return tag(
    'g',
    {
      class: 'legend',
      style: `fill:${token('fg')};font-size:${sizeToken('font-size-small', type.small)}`,
    },
    rows,
  )
}

/**
 * Write the legend of a figure, as the rows below its plot.
 *
 * A legend below the plot writes every entry on one line, since the line it has
 * is the width of the plot and not the width of a column: a label which is
 * longer than a whole row is cut with an ellipsis, which is the one case a row
 * cannot hold. Every row is centred on the plot by the width of what it
 * writes, as the label of the x axis above it is, so the plot, its label and
 * its legend are one block; a row which is cut is centred by what is left of
 * it.
 *
 * @param rows the rows of entries, in their order
 * @param x the pixel the plot starts at
 * @param y the pixel the first row is centred on
 * @param room the pixels a row has, the width of the plot
 * @param type the lettering of the figure
 * @returns the group of the legend, empty for no row at all
 */
function belowLegendGroup(
  rows: Entry[][],
  x: number,
  y: number,
  room: number,
  type: Lettering,
): string {
  if (rows.length === 0) {
    return ''
  }
  const written = rows
    .map((row, index) => {
      // the labels are cut to the row as if it started where the plot starts,
      // and the row is centred by what is written of them, so a row which is
      // cut is centred as well as one which is whole
      let end = x
      const labels = row.map((entry) => {
        const label = fittingLabel(
          entry.label,
          x + room - end - SWATCH - LABEL_GAP * 2,
          type.small,
          type.measure,
        )
        end += entryRoom({ ...entry, label }, type) + COLUMN_GAP
        return label
      })
      const wide = end - x - COLUMN_GAP
      let at = x + Math.max(0, (room - wide) / 2)
      return row
        .map((entry, place) => {
          const label = labels[place] ?? ''
          const one = legendEntry(entry, at, y + index * type.row, [label], type)
          at += entryRoom({ ...entry, label }, type) + COLUMN_GAP
          return one
        })
        .join('')
    })
    .join('')
  return tag(
    'g',
    {
      class: 'legend below',
      style: `fill:${token('fg')};font-size:${sizeToken('font-size-small', type.small)}`,
    },
    written,
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
 * @param type the lettering of the figure
 * @returns the group of the colour bar, the first series at its bottom
 */
function colourbarGroup(
  series: Series[],
  x: number,
  top: number,
  bottom: number,
  room: number,
  type: Lettering,
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
      const written = text(fittingLabel(one.label, room, type.small, type.measure), {
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
    { class: 'colourbar', style: `font-size:${sizeToken('font-size-small', type.small)}` },
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
  /** The shape of the markers of every series, in the order of the study data. */
  shapes: MarkerShape[]
  /** The colour of every series, in its order. */
  colours: string[]
  /** The entries of the legend, the curves first and the study data after them. */
  entries: Entry[]
  /** Whether the column right of the plot is a colour bar and not a legend. */
  hasColourbar: boolean
  /** The rows of the legend below the plot, empty for a legend beside it. */
  belowRows: Entry[][]
  /** The pixels below the plot the legend has there, the reserved rows included. */
  belowHeight: number
  /** The label of the x axis on the lines it wraps to. */
  xLines: string[]
  /** The label of the y axis, with the unit of its curves, on its lines. */
  yLines: string[]
  /** The pixels below the plot box, which the x axis writes in. */
  bottomRoom: number
  /** The pixels a label of the legend has. */
  legendLabels: number
  /** The pixels a label of the colour bar has. */
  barLabelRoom: number
  /** The pixel the column of the legend or of the colour bar starts at. */
  columnX: number
  /** The colour of the curve of an id, the soft foreground for an unknown one. */
  colourOf: (id: string) => string
  /** The fits the layout made, the one beside the plot first. */
  fits: Fitted[]
  /** The fits it chose the larger box of, which are those it can draw. */
  candidates: Fitted[]
  /** The measure and the sizes every text of the layout was laid out with. */
  type: Lettering
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

/** A plot box with the margins it was fitted into. */
interface Fitted {
  /** The box. */
  box: PlotBox
  /** The label of the x axis on the lines it wraps to. */
  xLines: string[]
  /** The label of the y axis on the lines it wraps to. */
  yLines: string[]
  /** The pixels below the box, which the x axis writes in. */
  bottomRoom: number
  /** The pixels right of the box, which the legend or the colour bar has. */
  column: number
  /** The pixels below the room of the x axis a legend there takes, its rows. */
  under: number
  /** The ticks the x axis of the box draws, held from the settled fit. */
  xTicks: XTicks
  /** The ticks the y axis of the box asks for, held from the settled fit. */
  yCount: number
  /** The passes the fit took. */
  passes: number
  /** The most passes it may take, `passBound`. */
  bound: number
  /** Whether the solve of its ends left the plot `MIN_PLOT` of width or more. */
  wide: boolean
  /**
   * Whether its x axis draws its first and its last tick apart, and not the
   * last alone, which no scale can be read from.
   */
  apart: boolean
  /** Whether it ended on a pass which asked for nothing. */
  settled: boolean
}

/**
 * Get the area of a plot box in square pixels.
 *
 * @param box the box
 * @returns its area, 0 for a box of no extent
 */
function boxArea(box: PlotBox): number {
  return Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0)
}

/** The ticks an x axis draws: the count it asks for and every how many of them it draws. */
interface XTicks {
  /** The ticks the axis asks for, which give the ticks of its limits. */
  count: number
  /** Every how many of those ticks it draws, from the first; 1 draws all, 0 the last alone. */
  stride: number
}

/**
 * Get the x axis of the ticks it draws.
 *
 * @param xs the limits of the axis
 * @param from the pixel its lower limit is at
 * @param to the pixel of its upper limit
 * @param ticks the ticks it asks for and every how many it draws
 * @returns the axis with the ticks it draws
 */
function xAxisOf(xs: Limits, from: number, to: number, ticks: XTicks): Axis {
  const axis = axisOf(xs, false, from, to, ticks.count)
  if (ticks.stride === 0) {
    return { ...axis, ticks: axis.ticks.slice(-1) }
  }
  return ticks.stride > 1
    ? { ...axis, ticks: axis.ticks.filter((_, index) => index % ticks.stride === 0) }
    : axis
}

/**
 * Get the ticks an x axis draws so that its tick labels keep a gap.
 *
 * The ticks an axis asks for are its length over `X_TICK_ROOM`, at least
 * `LEAST_TICKS`, which a narrow plot of wide labels does not hold: two labels
 * of neighbouring ticks centred on them would overlap. The axis then draws
 * every second, third, ... of those ticks, the fewest it has to leave out for
 * every two neighbouring labels, measured, to keep `TICK_GAP` between them,
 * and only a stride which ends on the last tick, so it always draws the first
 * and the last tick of its ticks. Those are the ticks whose labels reach past
 * the ends of the plot, so leaving ticks out never moves where the box ends:
 * a box which draws fewer ticks is not larger than one which draws them all,
 * and a figure which grows into drawing more does not lose plot. Where even
 * the first and the last collide, the last is drawn alone, which keeps the end
 * its label reaches past, while the first never asks for more than the room
 * of the y label (`passBound`).
 *
 * @param xs the limits of the axis
 * @param from the pixel its lower limit is at
 * @param to the pixel of its upper limit
 * @param type the lettering of the figure
 * @returns the count it asks for and the stride it draws them at; the ticks of
 *   a count depend on the limits alone, so an axis of these ticks which is
 *   longer keeps the gap as well
 */
function xTicksOf(xs: Limits, from: number, to: number, type: Lettering): XTicks {
  const count = tickCount(to - from, X_TICK_ROOM)
  const all = axisOf(xs, false, from, to, count).ticks.length
  for (let stride = 1; stride < all; stride += 1) {
    if ((all - 1) % stride !== 0) {
      continue
    }
    if (tickLabelsClear(xAxisOf(xs, from, to, { count, stride }), type)) {
      return { count, stride }
    }
  }
  return { count, stride: all > 1 ? 0 : 1 }
}

/**
 * Get the pixel a tick label of the x axis starts at.
 *
 * A label is centred on its tick and starts on a whole pixel: a text whose
 * glyphs start at a fraction of a pixel is drawn with the colour fringes of
 * subpixel antialiasing at that fraction, so equal glyphs of two labels, the
 * "1" of "100" against the "8" of "80", would read in two tints. The start is
 * rounded, so a label moves by at most `SNAP`, which the room of the labels
 * holds (`tickReach`), and the gap between two labels is measured between the
 * snapped ones (`tickLabelsClear`).
 *
 * @param at the pixel of its tick
 * @param width the width of the label
 * @returns the whole pixel it starts at
 */
function labelStart(at: number, width: number): number {
  return Math.round(at - width / 2)
}

/**
 * Get whether the labels of neighbouring ticks of an x axis keep their gap.
 *
 * @param axis the axis
 * @param type the lettering of the figure
 * @returns whether every two neighbouring labels, each centred on its tick, are
 *   at least `TICK_GAP` apart
 */
function tickLabelsClear(axis: Axis, type: Lettering): boolean {
  const labels = tickLabels(axis.ticks)
  const spans = axis.ticks
    .map((value, index) => ({ value, label: labels[index] ?? '' }))
    .filter(({ value }) => axis.drawable(value))
    .map(({ value, label }) => {
      const width = type.measure(label, type.small)
      const from = labelStart(axis.position(value), width)
      return { from, to: from + width }
    })
  return spans.every((span, index) => {
    const next = spans[index + 1]
    return next === undefined || next.from - span.to >= TICK_GAP - ROUNDING
  })
}

/**
 * Get the box the tick labels of an x axis leave room for.
 *
 * A tick label is centred on its tick, so the label of a tick near either end
 * of the axis reaches half its width past that end. A tick sits at its share of
 * the axis, `from + share * (to - from)`, so the end of the box at which its
 * label just reaches the room of the plot is solved for and not chased: for the
 * ticks of this box, an axis which ends at the returned `to` or before it and
 * starts at the returned `from` or after it writes every label inside.
 *
 * @param xs the limits of the axis
 * @param ticks the ticks the axis draws (`xTicksOf`)
 * @param from the pixel its lower limit is at
 * @param to the pixel of its upper limit
 * @param edge the pixel the room of the plot ends at, which is the figure
 *   without its padding and without the column of a legend or a colour bar
 * @param type the lettering of the figure
 * @returns the smallest pixel the axis may start at and the largest it may end
 *   at, `-Infinity` and `Infinity` on a side no label constrains
 */
function tickReach(
  xs: Limits,
  ticks: XTicks,
  from: number,
  to: number,
  edge: number,
  type: Lettering,
): { from: number; to: number } {
  const axis = xAxisOf(xs, from, to, ticks)
  const labels = tickLabels(axis.ticks)
  const span = axis.limits.high - axis.limits.low
  let least = Number.NEGATIVE_INFINITY
  let most = Number.POSITIVE_INFINITY
  for (const [index, value] of axis.ticks.entries()) {
    if (!axis.drawable(value)) {
      continue
    }
    // half the label and the half pixel a label snapped to a whole pixel moves by
    const half = type.measure(labels[index] ?? '', type.small) / 2 + SNAP
    // the share of `axisOf`, so the solved end puts the tick where it is drawn
    const share = span > 0 ? (value - axis.limits.low) / span : 0.5
    if (share > 0) {
      most = Math.min(most, from + (edge - half - from) / share)
    }
    if (share < 1) {
      least = Math.max(least, (PAD + half - share * to) / (1 - share))
    }
  }
  return { from: least, to: most }
}

/**
 * Get where the plot has to start for the tick labels of its y axis to keep their room.
 *
 * A y tick label is written right-aligned `TICK + LABEL_GAP` left of the plot,
 * and the lines of the y label run from `PAD` rightwards, one line of the label each,
 * so the widest tick label of the axis of a box and a `LABEL_GAP` between it and
 * the last line of the label are what the left margin has to hold. Its ticks
 * are the ones of a count, the count the height of a box asks for, and depend
 * on the limits alone.
 *
 * @param ys the limits of the y axis
 * @param log whether it is logarithmic
 * @param count the ticks the axis asks for
 * @param lines the lines of the y label
 * @param type the lettering of the figure
 * @returns the smallest pixel the plot may start at
 */
function yTickClear(
  ys: Limits,
  log: boolean,
  count: number,
  lines: number,
  type: Lettering,
): number {
  const axis = axisOf(ys, log, 1, 0, count)
  const written = tickLabels(axis.ticks)
  const labels = written.filter((_, index) => axis.drawable(axis.ticks[index] ?? Number.NaN))
  return PAD + lines * type.axisLine + LABEL_GAP + widest(labels, type) + LABEL_GAP + TICK
}

/**
 * Get the passes after which the fit of the margins of a figure has settled.
 *
 * Every pass but the last changes one of the four things a fit holds, and each
 * of them only moves one way. A width is asked of the measure of the figure,
 * which is one function for the whole fit, so the width of a text is a
 * constant of that text: what a pass asks for is the same function of the box
 * whatever the measure and the sizes of the font are, and the counting below
 * holds for every one of them. The left margin takes one of the
 * `AXIS_LINES` margins of the lines of the y label or one of the room the y
 * tick labels need (`yTickClear`), which is a function of the lines and of the
 * ticks of the height of the box, of which there are `TICK_COUNTS` counts; an x
 * tick label never asks the plot to start right of the room of one line of
 * the y label while half of the widest is at most that room less `PAD`, 56 px
 * at the sizes of the design (thirteen characters of `toFixed(6)` are 74 px in
 * the table and 80 px in Roboto, so a font has to be half again as wide as
 * Arial to reach it; a larger label font widens the room), since a tick right
 * of the start of the plot only
 * needs less, and a left margin grown by the y axis is larger still; a measure
 * past that couples the two ends of the plot, and the fit then stops at this
 * bound and says that it did not settle. The room below the plot takes
 * one of the `AXIS_LINES` margins of the x label, the band one of the row
 * counts of its largest legend (the most rows of any legend it holds, each of
 * which only grows as the box narrows, so their maximum only grows as well),
 * and the right end of the plot is solved from the left margin and the ticks
 * of the width of the box alone, which are one of `TICK_COUNTS` counts drawn
 * at one of fewer strides than a count has ticks, which `niceStep` makes at
 * most one and a half times the count and one more, under `2 * MOST_TICKS`,
 * so it takes one of those values per left margin. Their changes and the
 * pass which changes nothing are the bound; the solve of the box for the
 * ticks the settled fit draws comes after it and is no pass of it.
 *
 * @param entries the entries of the longest legend of the band, 0 for a legend
 *   beside the plot
 * @returns the most passes a fit takes
 */
function passBound(entries: number): number {
  const lefts = AXIS_LINES * (1 + TICK_COUNTS)
  const ends = lefts * TICK_COUNTS * 2 * MOST_TICKS
  return lefts - 1 + (AXIS_LINES - 1) + entries + ends + 1
}

/**
 * Fit the plot box of a figure into the room beside and below it.
 *
 * The label of an axis takes the length of that axis, which the margin the
 * other label needs is part of, the tick labels of the x axis reach half their
 * width past either end of it, the tick labels of the y axis take their width
 * between the plot and the lines of its label, and the rows of a legend below
 * the plot are the entries packed into its width, which is the width they are
 * drawn into. Each pass measures all of them on the box the margins leave and
 * grows a margin by what it asks for, never shrinks one: the lines, the rows
 * and the room below only grow as the box narrows, the ends of the plot are
 * solved for the x ticks of the box (`tickReach`) and its start is pushed past
 * the widest y tick of the box (`yTickClear`). The fit ends on the first pass
 * which asks for nothing, so the box it returns is the box that pass measured:
 * its own tick labels lie inside the room of the plot and its own band has the
 * rows it draws. It cannot oscillate, since nothing it holds moves back, and it
 * ends within `passBound`, since everything it holds takes one of a few values.
 * The two sides are counted apart, so the label of the last x tick moves the
 * right edge of the plot and never its left edge, a y tick label moves the left
 * edge and never the room the right one is solved in, and a margin which needs
 * nothing is the margin of the layout.
 *
 * @param spec the figure
 * @param full the label of the y axis with the unit of its curves
 * @param xs the limits of the x axis, which decide its ticks
 * @param ys the limits of the y axis, which decide its ticks
 * @param width the width of the figure in whole pixels
 * @param height its height in whole pixels
 * @param column the pixels right of the plot, 0 for a figure with nothing there
 * @param bands the legends a band below the plot may hold, each its entries in
 *   their order; none for a legend beside the plot
 * @param type the lettering of the figure
 * @returns the box with the lines, the margins and the band it was fitted into
 */
function fitBox(
  spec: PlotSpec,
  full: string,
  xs: Limits,
  ys: Limits,
  width: number,
  height: number,
  column: number,
  bands: Entry[][],
  type: Lettering,
): Fitted {
  const edge = width - PAD - column
  const bound = passBound(Math.max(0, ...bands.map((one) => one.length)))
  let x0 = type.left
  let x1 = edge
  let bottomRoom = type.bottom
  let under = 0
  let box: PlotBox = { x0, y0: type.top, x1, y1: height - bottomRoom }
  let xLines: string[] = [spec.xLabel]
  let yLines: string[] = [full]
  let passes = 0
  let settled = false
  while (!settled && passes < bound) {
    passes += 1
    // a solve which asks for less than `MIN_PLOT` of width is clamped wider, so
    // its tick labels run past the figure while the fit reports it settled:
    // that is a figure of 105 px or less, and the element draws none below 220
    box = {
      x0,
      y0: type.top,
      x1: Math.max(x0 + MIN_PLOT, x1),
      y1: Math.max(type.top + MIN_PLOT, height - bottomRoom - under),
    }
    xLines = wrapLabel(spec.xLabel, box.x1 - box.x0, type.label, AXIS_LINES, type.measure)
    yLines = wrapLabel(full, box.y1 - type.top, type.label, AXIS_LINES, type.measure)
    const xTicks = xTicksOf(xs, box.x0, box.x1, type)
    const reach = tickReach(xs, xTicks, box.x0, box.x1, edge, type)
    const yCount = tickCount(box.y1 - box.y0, Y_TICK_ROOM)
    const clear = yTickClear(ys, spec.logY, yCount, yLines.length, type)
    // the band holds the legend of any state, so it reserves the most rows any
    // of them packs into the width of this box
    const rows = Math.max(0, ...bands.map((band) => legendRows(band, box.x1 - box.x0, type).length))
    const next = {
      x0: Math.max(x0, type.left + (yLines.length - 1) * type.axisLine, reach.from, clear),
      x1: Math.min(x1, reach.to),
      bottomRoom: Math.max(bottomRoom, type.bottom + (xLines.length - 1) * type.axisLine),
      under: Math.max(under, rows * type.row),
    }
    settled =
      next.x0 === x0 && next.x1 === x1 && next.bottomRoom === bottomRoom && next.under === under
    x0 = next.x0
    x1 = next.x1
    bottomRoom = next.bottomRoom
    under = next.under
  }
  // the margins of the loop only grow, which is what makes it end, so a limit
  // which a tick set of an earlier pass set stays when a narrower box draws
  // fewer or narrower ticks. The box is therefore solved once more for the
  // tick sets the settled box draws, held: its left end where its y tick
  // labels and the lines of its y label need it, its right end where its last
  // x tick label meets the room, the band of the rows the width packs and the
  // room below of the lines the x label is drawn on. Each end only moves
  // outwards from the settled box, so its held ticks are further apart than
  // the box found them, its labels still fit their lines and its band holds
  // the rows it draws; it is one pass and no iteration, so the loop above and
  // its bound are what they were
  const xTicks = xTicksOf(xs, box.x0, box.x1, type)
  const yCount = tickCount(box.y1 - box.y0, Y_TICK_ROOM)
  let left = Math.max(
    type.left + (yLines.length - 1) * type.axisLine,
    yTickClear(ys, spec.logY, yCount, yLines.length, type),
  )
  let right = Math.min(edge, tickReach(xs, xTicks, left, box.x1, edge, type).to)
  // a first x tick label never asks the plot to start further right than the
  // room of the y label does (`passBound`), and where a font makes it, the end
  // is solved again from that start
  const first = tickReach(xs, xTicks, left, right, edge, type).from
  if (first > left) {
    left = first
    right = Math.min(edge, tickReach(xs, xTicks, left, right, edge, type).to)
  }
  const wide = Math.max(left + MIN_PLOT, right)
  // a solve which asks for less than `MIN_PLOT` of width is clamped wider, so
  // its tick labels run past the room; the layout says so (`wide`) and is no
  // candidate where another one can be drawn
  const rows = Math.max(0, ...bands.map((band) => legendRows(band, wide - left, type).length))
  const room = type.bottom + (xLines.length - 1) * type.axisLine
  const solved: PlotBox = {
    x0: left,
    y0: type.top,
    x1: wide,
    y1: Math.max(type.top + MIN_PLOT, height - room - rows * type.row),
  }
  return {
    box: solved,
    xLines,
    yLines,
    bottomRoom: room,
    column,
    under: rows * type.row,
    wide: right >= left + MIN_PLOT - ROUNDING,
    apart: xTicks.stride !== 0,
    xTicks,
    yCount,
    passes,
    bound,
    settled,
  }
}

/**
 * Get whether a figure is of one curve and no study data, which draws no legend.
 *
 * Its one entry would name the curve its y label names already, so the label
 * is the whole legend of it. Study data the figure draws, and study data it may
 * draw in another state of its knobs (`PlotSpec.declaredLegends`), keep the
 * legend, so the entry of the curve does not come and go with the series and
 * the plot box of such a figure is the one it has with its legend.
 *
 * @param spec the figure
 * @returns whether the figure draws no legend for its curves
 */
function loneCurve(spec: PlotSpec): boolean {
  return (
    spec.series.length === 1 &&
    (spec.points ?? []).length === 0 &&
    // a frozen run of that one curve is a second line in the plot, so the legend says which of
    // them is the live one and which is the run it is read against
    (spec.frozen ?? []).length === 0 &&
    (spec.declaredLegends ?? []).every((labels) => labels.length === 0)
  )
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
  const type = letteringOf(spec)
  const series = spec.series
  const declared = spec.points ?? []
  const range = xRange(spec)
  const points = declared.map((one) => clipPoints(one, range))
  const hasColourbar = series.length > LEGEND_LIMIT

  const colours = series.map((_, index) => seriesColour(index, series.length))
  const colourOf = (id: string): string => {
    const index = series.findIndex((one) => one.id === id)
    return colours[index] ?? token('fg-soft')
  }

  const shapes = markerShapes(declared)
  const curveEntries: Entry[] = []
  if (!hasColourbar && !loneCurve(spec)) {
    const unit = sharedUnit(series)
    for (const [index, one] of series.entries()) {
      curveEntries.push({
        id: one.id,
        label: unit === undefined ? axisLabel(one.label, one.unit) : one.label,
        colour: colours[index] ?? token('fg-soft'),
        shape: null,
      })
    }
  }
  const pointEntries: Entry[] = declared.map((one, index) => ({
    id: one.id,
    label: one.label,
    colour: colourOf(one.curve ?? one.id),
    shape: shapes[index] ?? 'circle',
  }))
  // one entry per frozen run and not one per curve of it: the colours of the curves are the
  // colours of the live ones, which the legend names already, and the dash is what tells the
  // runs apart
  const frozenEntries: Entry[] = (spec.frozen ?? []).map((run) => ({
    id: `frozen-${String(run.rank)}`,
    label: run.label,
    colour: token('fg-soft'),
    shape: null,
    dash: frozenDash(run.rank),
  }))
  const entries: Entry[] = [...curveEntries, ...pointEntries, ...frozenEntries]

  const barLabels = hasColourbar
    ? tickPositions(series.length).map((position) => series[position]?.label ?? '')
    : []
  // the legend is laid out over every legend it may have to show, each in the
  // order the caller declares it, and drawn with the one it shows now: the
  // rows are packed in order, so a figure keeps its plot box when an entry
  // which is drawn under a condition arrives or leaves, whichever of them it
  // is. The legend drawn now is one of them, so the band never reserves fewer
  // rows than it draws, whatever a caller declares
  const drawnLabels = pointEntries.map((one) => one.label)
  // the frozen runs are entries of every legend the figure may show: they are drawn whatever the
  // study data under them is, so the rows they take are reserved in each of them and a run which
  // is frozen never pushes an entry past the lower edge of the figure
  const held: Entry[][] = [...(spec.declaredLegends ?? []), drawnLabels].map((labels) => [
    ...curveEntries,
    ...labels.map((label) => ({ id: '', label, colour: '', shape: null })),
    ...frozenEntries,
  ])
  const reservedLabels = held.flatMap((legend) => legend.map((one) => one.label))
  const legendRoom =
    reservedLabels.length > 0 ? SWATCH + LABEL_GAP * 2 + widest(reservedLabels, type) : 0
  const barRoom = hasColourbar ? COLOURBAR_BAR + TICK + LABEL_GAP + widest(barLabels, type) : 0
  const cap = Math.round(width * COLUMN_SHARE)
  // a legend sits beside the plot or below it, where a row is as wide as the
  // figure: whichever of the two leaves the larger plot box is the one the
  // figure gets. Comparing the two is what keeps the choice monotone - a wider
  // figure never gets a smaller plot - where a rule on the width alone has a
  // step in it, at which a figure a little wider loses a third of its plot.
  // The comparison is the whole rule, and no share of the height caps the band
  // on top of it: a cap is a step as well, where one row more throws away a
  // band which still left the larger plot and the figure loses half of it,
  // while the larger of two boxes loses no more than the layout which loses
  // more. The column is capped at `COLUMN_SHARE` of the width, so a band wins
  // only while its rows cost the plot less height than that column costs it
  // width, which is what keeps a plot with a band under it a plot and not a
  // strip over a legend
  const columnOf = (wanted: number): number => (wanted > 0 ? Math.min(COLUMN_GAP + wanted, cap) : 0)
  // the y axis holds the frame of the spec or what the figure draws, and its
  // tick labels are fitted into the left margin, so it is known before the box
  const frame = spec.yLimits
  const yValues: number[] = frame === undefined ? [] : [frame.low, frame.high]
  if (frame === undefined) {
    for (const one of series) {
      for (let index = 0; index < Math.min(spec.x.length, one.values.length); index += 1) {
        const value = one.values[index]
        if (value !== undefined) {
          yValues.push(value)
        }
      }
      // a band is drawn, so the axis holds it: a curve whose band reaches past
      // it would be drawn against an axis its own range does not fit in
      for (const ends of one.band === undefined ? [] : [one.band.low, one.band.high]) {
        for (let index = 0; index < Math.min(spec.x.length, ends.length); index += 1) {
          const value = ends[index]
          if (value !== undefined) {
            yValues.push(value)
          }
        }
      }
      // a frozen run is drawn, so the axis holds it as well: the point of freezing a run is to
      // read it against the live one, which an axis of the live one alone would cut off
      for (const run of spec.frozen ?? []) {
        const kept = run.values[one.id] ?? []
        for (let index = 0; index < Math.min(spec.x.length, kept.length); index += 1) {
          const value = kept[index]
          if (value !== undefined) {
            yValues.push(value)
          }
        }
      }
    }
    for (const one of points) {
      for (const [index, value] of one.y.entries()) {
        const error = one.yerr?.[index]
        yValues.push(value)
        if (error !== undefined && Number.isFinite(error)) {
          yValues.push(value - Math.abs(error), value + Math.abs(error))
        }
      }
    }
  }
  // the limits are a function of the spec and not of the box, so they are
  // taken once: the ends a caller declares are the ends of their axis exactly
  const ys = limitsOf(yValues, spec.logY, spec.yEnds)
  const full = axisLabel(spec.yLabel, sharedUnit(series))
  // the ticks of the x axis are the ticks of the values the figure draws over,
  // so the margins of the box are fitted to them and not to the box alone
  const xs = limitsOf(
    spec.x.length > 0 ? spec.x : points.flatMap((one) => one.x),
    false,
    spec.xEnd === undefined ? {} : { high: spec.xEnd },
  )
  const beside = fitBox(
    spec,
    full,
    xs,
    ys,
    width,
    height,
    columnOf(Math.max(legendRoom, barRoom)),
    [],
    type,
  )
  // the band spans the plot box, so its rows are counted in the fit, against
  // the box they are drawn under, and the height it reserves is those rows
  const under =
    reservedLabels.length > 0
      ? fitBox(spec, full, xs, ys, width, height, columnOf(barRoom), held, type)
      : null
  // a band whose rows leave no plot of `MIN_PLOT` cannot be drawn in the
  // figure at all, which is no preference but where its rows would end, and a
  // layout whose tick labels leave its plot less than `MIN_PLOT` of width
  // cannot either, since its box is clamped wider and its labels pass the
  // room; the figure of neither falls back to the column
  const drawable = [beside, ...(under === null ? [] : [under])].filter(
    (one) =>
      one.wide && (one === beside || height - one.bottomRoom - one.under - type.top >= MIN_PLOT),
  )
  // a layout whose x axis draws its last tick alone, a number without a second
  // one to read a scale from, is no candidate where the other one draws its
  // first and its last tick apart, as a layout too narrow for its own tick
  // labels is none: a figure keeps a scale over a few pixels of plot
  const scaled = drawable.filter((one) => one.apart)
  const candidates = scaled.length > 0 ? scaled : drawable.length > 0 ? drawable : [beside]
  const fitted = candidates.reduce((best, one) =>
    boxArea(one.box) > boxArea(best.box) ? one : best,
  )
  const below = fitted !== beside
  const { box, xLines, yLines, bottomRoom, column } = fitted

  return {
    width,
    height,
    box,
    x: xAxisOf(xs, box.x0, box.x1, fitted.xTicks),
    y: axisOf(ys, spec.logY, box.y1, box.y0, fitted.yCount),
    points,
    shapes,
    colours,
    entries,
    hasColourbar,
    belowRows: below ? legendRows(entries, box.x1 - box.x0, type) : [],
    belowHeight: below ? fitted.under : 0,
    fits: under === null ? [beside] : [beside, under],
    candidates,
    xLines,
    yLines,
    bottomRoom,
    legendLabels: column - COLUMN_GAP - SWATCH - LABEL_GAP * 2,
    barLabelRoom: column - COLUMN_GAP - COLOURBAR_BAR - TICK - LABEL_GAP,
    // the column is where the layout gave it its room and not where the plot
    // ends: a plot whose last tick label needed room ends before that, and the
    // label reaches past its end towards the column, which holds still
    columnX: Math.max(box.x1, width - PAD - column) + COLUMN_GAP,
    colourOf,
    type,
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
 * Get how the fits of the margins of a figure ended, for the tests of the renderer.
 *
 * It is no part of the API of the library, which `index.ts` does not export it
 * from: a fit which reaches its bound has ended on a box it did not measure,
 * which `passBound` says cannot happen, and a figure which does not draw the
 * larger box of the fits it can draw has a rule beside the comparison of the
 * areas, which the layout says it has not; this is how the tests check both.
 *
 * @param spec the figure
 * @returns every fit the layout made, the one beside the plot first, with the
 *   passes it took, its bound, whether it ended on a measurement, the area of
 *   its plot box and whether the layout could draw it
 */
export function marginFits(
  spec: PlotSpec,
): { passes: number; bound: number; settled: boolean; area: number; candidate: boolean }[] {
  const layout = layoutOf(spec)
  return layout.fits.map((fit) => ({
    passes: fit.passes,
    bound: fit.bound,
    settled: fit.settled,
    area: boxArea(fit.box),
    candidate: layout.candidates.includes(fit),
  }))
}

/**
 * Draw a figure as one inline SVG element.
 *
 * The element carries its `viewBox` next to its `width` and its `height`, so it
 * scales with the box a host gives it, `role="img"` and a `<title>` as its
 * first child, so a reader which does not see it is told what it shows. Every
 * part of it carries a class - `background`, `axis`, `tick`, `axis-label`,
 * `points`, `errorbar`, `marker`, `curve`, `legend` (`legend below` for one
 * under the plot), `legend-entry`, `colourbar`, `swatch`, `bar` - and every
 * colour, font and stroke width is a
 * token of the design system with the value of the sbmlsim report as its
 * fallback; the figure paints `--sbmlsim-figure-bg` behind itself, which is
 * `transparent` until a host asks for a surface, so a figure is part of its
 * page and not a white box on a slide.
 *
 * The column right of the plot, the legend or the colour bar, is as wide as its
 * widest label is by the measure of the spec and at most `COLUMN_SHARE` of the
 * figure. The legend sits there
 * or below the plot (`class="legend below"`), packed into rows of the width of
 * the figure: the figure is laid out both ways and keeps the one whose plot box
 * is larger, which is a column on a figure which is wide and short and a band
 * of rows on the figure of a panel, where a column of labels costs more plot
 * than a row of them. Comparing the two is what makes the choice monotone: a
 * figure which grows never ends up with a smaller plot than it had, which a
 * rule on the width alone does at the width where it changes its mind, and the
 * larger of the two boxes never loses more plot to a change of the content
 * than the layout which loses more, so one row more never halves a plot. A
 * legend of many long labels, whose rows cost more plot than the column,
 * stays beside the plot and is cut there. A colour
 * bar keeps its column whatever its labels need, since it is an axis of the
 * figure and is read against the height of the plot, and its labels are cut
 * with an ellipsis there; a figure of both keeps the bar beside the plot and
 * puts the legend of its study data below. The legend is laid out over the
 * legends of `declaredLegends`, each in the order it is given, and drawn with
 * the entries it has, so a figure whose entries come and go keeps its plot box
 * where it is. A legend below the plot spans the plot box and centres its rows
 * on it, as the label of the x axis is centred, so the foot of the figure is
 * one block of the plot, its label and its legend.
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
    shapes,
    colours,
    entries,
    hasColourbar,
    belowRows,
    belowHeight,
    xLines,
    yLines,
    bottomRoom,
    legendLabels,
    barLabelRoom,
    columnX,
    colourOf,
    type,
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
    .map((one, index) => {
      const colour = colourOf(one.curve ?? one.id)
      const shape = shapes[index] ?? 'circle'
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
        `${path}${markersOf(one, colour, shape, x, y)}`,
      )
    })
    .join('')

  // every band is drawn before every curve, so a band never covers a line: two
  // curves whose bands overlap are both readable, which is the whole point of
  // drawing them in one figure
  const drawnBands = series
    .map((one, index) => {
      const d = one.band === undefined ? '' : bandOf(spec.x, one.band, x, y)
      return d === ''
        ? ''
        : tag('path', {
            class: 'curve-band',
            'data-series': one.id,
            style:
              `fill:${colours[index] ?? token('fg-soft')};` +
              `fill-opacity:${token('band-opacity')};stroke:none`,
            d,
          })
    })
    .join('')

  // the frozen runs go under the live curves, so the one a reader is moving is never hidden by
  // the ones it is read against; each takes the colour of the series it was frozen from
  const drawnFrozen = (spec.frozen ?? [])
    .flatMap((run) =>
      series.map((one, index) => {
        const kept = run.values[one.id]
        return kept === undefined
          ? ''
          : tag('path', {
              class: 'curve frozen',
              'data-series': one.id,
              'data-frozen': String(run.rank),
              style:
                `stroke:${colours[index] ?? token('fg-soft')};` +
                `stroke-width:${token('curve-width')};fill:none;` +
                `stroke-dasharray:${frozenDash(run.rank)};opacity:${FROZEN_OPACITY}`,
              d: pathOf(spec.x, kept, x, y),
            })
      }),
    )
    .join('')

  const drawnSeries =
    drawnFrozen +
    series
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

  const underneath = belowRows.length > 0
  // a figure gets wrapped labels when the wrapped legend fits the room it has
  // and single-line labels, cut with an ellipsis, when it does not: the
  // renderer never grows the figure behind the host, and never drops an entry
  const sideEntries = underneath ? [] : entries
  const sideRoom = box.y1 - box.y0 - (hasColourbar ? MIN_PLOT + type.row : 0)
  const wrap = legendHeight(sideEntries, legendLabels, true, type) <= sideRoom
  const barBottom =
    box.y1 -
    (sideEntries.length > 0 ? legendHeight(sideEntries, legendLabels, wrap, type) + type.row : 0)
  const side = hasColourbar
    ? colourbarGroup(
        series,
        columnX,
        box.y0 + MARKER,
        Math.max(box.y0 + MIN_PLOT, barBottom),
        barLabelRoom,
        type,
      ) +
      legendGroup(
        sideEntries,
        columnX,
        Math.max(box.y0 + MIN_PLOT, barBottom) + type.row,
        legendLabels,
        wrap,
        type,
      )
    : legendGroup(sideEntries, columnX, box.y0 + type.row / 2, legendLabels, wrap, type)
  const under = belowLegendGroup(
    belowRows,
    box.x0,
    height - PAD - belowHeight + type.row / 2,
    box.x1 - box.x0,
    type,
  )

  const title = tag('title', {}, escape(figureTitle(spec)))
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
    axisGroup(x, true, box, xLines, bottomRoom, type) +
    axisGroup(y, false, box, yLines, box.x0, type) +
    tag(
      'g',
      { class: 'data', 'clip-path': `url(#${clip})` },
      drawnBands + drawnPoints + drawnSeries,
    ) +
    side +
    under

  return tag(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      class: 'sbmlsim-plot',
      width,
      height,
      viewBox: `0 0 ${String(width)} ${String(height)}`,
      role: 'img',
      style: `font-family:${token('font')};font-size:${sizeToken('font-size', type.label)}`,
    },
    body,
  )
}
