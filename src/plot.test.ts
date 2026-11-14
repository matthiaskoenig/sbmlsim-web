import { describe, expect, it } from 'vitest'

import { marginFits, plotGeometry, plotSvg, tableMeasure } from './plot'
import type { PlotSpec, Points, Series, TextMeasure } from './plot'

// Every id below is a neutral one: a curve, a series and a knob are data of a
// payload and never of this library, so no model and no entity of a model is
// named here.

/**
 * The bound of time of one sweep of the renderer, in milliseconds. The
 * invariants are checked over sweeps of thousands of figures, cut into pieces
 * which take at most about half a second on an idle machine: a piece took up to
 * 1.8 s while another test suite kept every core of this machine of 20 busy (a
 * load of 15 to 24), so the bound is what such a machine stays within, and a
 * renderer about ten times slower is not.
 */
const SWEEP_TIMEOUT = 3_000

/** Build a series of `values` over four x, with a straight ramp as its values. */
function series(index: number, values?: number[]): Series {
  return {
    id: `curve${String(index)}`,
    label: `Curve ${String(index)}`,
    unit: 'mM',
    scale: 'linear',
    values: values ?? [index, index + 1, index + 2, index + 3],
  }
}

/** Build a spec of `count` series over the same four x. */
function spec(count: number, more: Partial<PlotSpec> = {}): PlotSpec {
  return {
    x: [0, 1, 2, 3],
    xLabel: 'time [h]',
    yLabel: 'value',
    series: Array.from({ length: count }, (_, index) => series(index + 1)),
    width: 480,
    height: 300,
    logY: false,
    ...more,
  }
}

/**
 * The labels which fill the legend of `columnLegend` up to `LEGEND_LIMIT`.
 *
 * They are long enough that one of them fills a row below the plot on its own,
 * which is what makes the rows too tall for a legend there.
 */
const FILLERS = Array.from(
  { length: 10 },
  (_, index) => `hydrochlorothiazide plasma concentration, level ${String(index + 1)}`,
)

/**
 * Build a spec whose legend keeps the column right of its plot.
 *
 * A legend goes below the plot when its column would want more than
 * `COLUMN_SHARE` of the width, unless the rows it would need there take more of
 * the height than a legend may. The labels are longer than that column and the
 * fillers are enough of them for the second, which is the figure whose legend
 * is still wrapped and cut in its column; the fillers fill it to the ten series
 * which still get a legend, so the figure never turns into a colour bar.
 *
 * @param labels the labels under test, which come first
 * @param more what the spec carries on top of the width and the height
 * @returns the spec
 */
function columnLegend(labels: string[], more: Partial<PlotSpec> = {}): PlotSpec {
  const all = [...labels, ...FILLERS].slice(0, 10)
  return spec(all.length, {
    width: 480,
    height: 400,
    series: all.map((label, index) => ({ ...series(index + 1), label })),
    ...more,
  })
}

/** Count how often a text occurs in another. */
function occurrences(text: string, what: string): number {
  return text.split(what).length - 1
}

/** Get the texts of every entry of the legend, in their order. */
function legendEntries(svg: string): string[] {
  const legend = /<g class="legend[^"]*"[\s\S]*$/.exec(svg)?.[0] ?? ''
  return [...legend.matchAll(/<g class="legend-entry"[\s\S]*?<\/g>/g)].map((one) =>
    texts(one[0]).join(' '),
  )
}

/** Get the `d` of every path of a class. */
function paths(svg: string, className: string): string[] {
  const found = svg.matchAll(new RegExp(`<path class="${className}"[^>]*\\sd="([^"]*)"`, 'g'))
  return [...found].map((one) => one[1] ?? '')
}

/** Get the pixel the plot box ends at, which is the right end of the x axis. */
function plotRight(svg: string): number {
  const found = /<line class="axis-line"[^>]*\sx2="([^"]*)"/.exec(svg)
  return Number(found?.[1] ?? Number.NaN)
}

/** Get the text of every `<text>` of the figure. */
function texts(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((one) => one[1] ?? '')
}

/**
 * Get the pixels a text of a figure spans along x, by the anchor it is drawn at.
 *
 * @param attributes the attributes of the `<text>` element
 * @param label its text
 * @param measure the measure it was laid out with
 * @param size its size
 * @returns where it starts and where it ends
 */
function spanOf(
  attributes: string,
  label: string,
  measure: (text: string, size: number) => number,
  size: number,
): { from: number; to: number } {
  const x = Number(/\sx="([^"]*)"/.exec(attributes)?.[1])
  const width = measure(label, size)
  const anchor = /text-anchor="([^"]*)"/.exec(attributes)?.[1] ?? 'start'
  const from = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x
  return { from, to: from + width }
}

/** The tick labels of an axis group with their attributes. */
function tickTexts(group: string): { attributes: string; label: string }[] {
  return [...group.matchAll(/<g class="tick">.*?<text([^>]*)>([^<]*)<\/text>/g)].map((one) => ({
    attributes: one[1] ?? '',
    label: one[2] ?? '',
  }))
}

/** The characters of `ROBOTO_ADVANCES`, printable ASCII and the ellipsis. */
const ROBOTO_CHARACTERS = `${Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join('')}\u2026`

/**
 * The advance widths of Roboto Regular in units of 2048 to an em, in the order of
 * `ROBOTO_CHARACTERS`, read with fontTools from `Roboto-Regular.ttf`.
 *
 * Roboto is the font Chrome resolves the font token of the figure to on
 * linux, and canvas `measureText` in Chrome gives these widths for the labels
 * of the panels to within 0.33 px (the difference is kerning, `Fr` of
 * `Frost`), where the table of the renderer is Arial and the estimate before
 * it was 35 % too wide: a measure of these widths is a measure of the widths
 * a reader sees, and one which is not the table.
 */
const ROBOTO_ADVANCES = [
  508, 528, 656, 1261, 1151, 1500, 1274, 358, 701, 713, 882, 1162, 403, 566, 540, 845, 1151, 1151,
  1151, 1151, 1151, 1151, 1151, 1151, 1151, 1151, 496, 433, 1041, 1124, 1071, 968, 1839, 1336, 1276,
  1333, 1344, 1164, 1132, 1395, 1461, 557, 1130, 1285, 1103, 1788, 1461, 1409, 1292, 1409, 1262,
  1216, 1222, 1328, 1304, 1817, 1284, 1230, 1227, 543, 841, 543, 856, 924, 633, 1114, 1150, 1072,
  1155, 1086, 712, 1150, 1128, 498, 490, 1038, 498, 1796, 1131, 1168, 1150, 1164, 694, 1057, 670,
  1129, 992, 1539, 1016, 969, 1016, 693, 500, 693, 1393, 1370,
]

/** Measure a text in Roboto, the widths of Chrome on linux. */
function chromeLike(text: string, size: number): number {
  let units = 0
  for (const character of text) {
    units += ROBOTO_ADVANCES[ROBOTO_CHARACTERS.indexOf(character)] ?? 1151
  }
  return (units / 2048) * size
}

/**
 * The figure of a small spec, byte for byte.
 *
 * It is the pin of every caller which hands the renderer nothing but what it
 * draws: a spec without `yLimits` and without `declaredLegends` draws these
 * bytes, so neither field can move the figure of a page which never passes
 * them, and nothing else drifts under them unnoticed either. It is drawn with
 * the table of the renderer (`tableMeasure`), which a spec without a measure is
 * laid out with, so it is one exact figure on every machine. It is re-taken
 * when the renderer changes its geometry on purpose, which the figure of the
 * change then has to show.
 */
const PINNED = `<svg xmlns="http://www.w3.org/2000/svg" class="sbmlsim-plot" width="240" height="160" viewBox="0 0 240 160" role="img" style="font-family:var(--sbmlsim-font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif);font-size:var(--sbmlsim-font-size, 12px)"><title>value [mM] over time [h]</title><defs><clipPath id="sbmlsim-plot-clip-64-14-232-100"><rect x="64" y="14" width="168" height="86"/></clipPath></defs><rect class="background" x="0" y="0" width="240" height="160" style="fill:var(--sbmlsim-figure-bg, transparent)"/><g class="axis x" style="stroke:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke-width:var(--sbmlsim-axis-width, 1px);fill:none;font-size:var(--sbmlsim-font-size-small, 11px)"><line class="axis-line" x1="64" y1="100" x2="232" y2="100"/><g class="tick"><line x1="71.64" y1="100" x2="71.64" y2="104"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="69" y="107" text-anchor="start" dominant-baseline="hanging">0</text></g><g class="tick"><line x1="122.55" y1="100" x2="122.55" y2="104"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="119" y="107" text-anchor="start" dominant-baseline="hanging">1</text></g><g class="tick"><line x1="173.45" y1="100" x2="173.45" y2="104"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="170" y="107" text-anchor="start" dominant-baseline="hanging">2</text></g><g class="tick"><line x1="224.36" y1="100" x2="224.36" y2="104"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="221" y="107" text-anchor="start" dominant-baseline="hanging">3</text></g><text class="axis-label" style="fill:var(--sbmlsim-fg, rgb(27 31 36));stroke:none;font-size:var(--sbmlsim-font-size, 12px)" x="148" y="131" text-anchor="middle">time [h]</text></g><g class="axis y" style="stroke:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke-width:var(--sbmlsim-axis-width, 1px);fill:none;font-size:var(--sbmlsim-font-size-small, 11px)"><line class="axis-line" x1="64" y1="14" x2="64" y2="100"/><g class="tick"><line x1="60" y1="96.09" x2="64" y2="96.09"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="57" y="96" text-anchor="end" dominant-baseline="central">1</text></g><g class="tick"><line x1="60" y1="70.03" x2="64" y2="70.03"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="57" y="70" text-anchor="end" dominant-baseline="central">2</text></g><g class="tick"><line x1="60" y1="43.97" x2="64" y2="43.97"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="57" y="44" text-anchor="end" dominant-baseline="central">3</text></g><g class="tick"><line x1="60" y1="17.91" x2="64" y2="17.91"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="57" y="18" text-anchor="end" dominant-baseline="central">4</text></g><text class="axis-label" style="fill:var(--sbmlsim-fg, rgb(27 31 36));stroke:none;font-size:var(--sbmlsim-font-size, 12px)" x="8" y="57" transform="rotate(-90 8 57)" text-anchor="middle" dominant-baseline="hanging">value [mM]</text></g><g class="data" clip-path="url(#sbmlsim-plot-clip-64-14-232-100)"><path class="curve" data-series="curve1" style="stroke:var(--sbmlsim-ramp-1, rgb(68 1 84));stroke-width:var(--sbmlsim-curve-width, 1.8px);fill:none" d="M71.64 96.09 L122.55 70.03 L173.45 43.97 L224.36 17.91"/></g><g class="legend below" style="fill:var(--sbmlsim-fg, rgb(27 31 36));font-size:var(--sbmlsim-font-size-small, 11px)"><g class="legend-entry" data-series="curve1"><line class="swatch" style="stroke:var(--sbmlsim-ramp-1, rgb(68 1 84));stroke-width:var(--sbmlsim-curve-width, 1.8px)" x1="116.74" y1="143" x2="134.74" y2="143"/><text x="140.74" y="143" dominant-baseline="central">Curve 1</text></g></g></svg>`

/** The spec `PINNED` was drawn from. */
function pinned(): PlotSpec {
  return {
    x: [0, 1, 2, 3],
    xLabel: 'time [h]',
    yLabel: 'value',
    series: [series(1)],
    width: 240,
    height: 160,
    logY: false,
  }
}

describe('plotSvg', () => {
  it('draws the figure it is pinned to, byte for byte', () => {
    expect(plotSvg(pinned())).toBe(PINNED)
    // the table is the measure of a spec which carries none
    expect(plotSvg({ ...pinned(), measure: tableMeasure })).toBe(PINNED)
  })

  it('draws one path per series', () => {
    expect(paths(plotSvg(spec(1)), 'curve')).toHaveLength(1)
    expect(paths(plotSvg(spec(4)), 'curve')).toHaveLength(4)
    expect(paths(plotSvg(spec(0)), 'curve')).toHaveLength(0)
  })

  it('labels an axis with its unit', () => {
    const svg = plotSvg(spec(2))
    expect(texts(svg)).toContain('value [mM]')
    expect(texts(svg)).toContain('time [h]')
  })

  it('leaves the unit of a series which does not share it to its legend entry', () => {
    const mixed = spec(2)
    const second = mixed.series[1]
    if (second === undefined) {
      throw new Error('the spec has two series')
    }
    const svg = plotSvg({ ...mixed, series: [series(1), { ...second, unit: 'mg' }] })
    expect(texts(svg)).toContain('value')
    expect(texts(svg)).not.toContain('value [mM]')
    expect(texts(svg)).toContain('Curve 1 [mM]')
    expect(texts(svg)).toContain('Curve 2 [mg]')
  })

  it('breaks a path at NaN instead of drawing through it', () => {
    const svg = plotSvg(spec(1, { series: [series(1, [1, Number.NaN, 3, 4])] }))
    const curve = paths(svg, 'curve')[0] ?? ''
    expect(occurrences(curve, 'M')).toBe(2)
    expect(svg).not.toContain('NaN')
  })

  it('places a log axis over at most six decades below the largest value', () => {
    const wide = plotSvg(spec(1, { series: [series(1, [1e-12, 1e-8, 1e-4, 1])], logY: true }))
    expect(texts(wide)).toContain('1e-6')
    expect(wide).not.toContain('1e-12')
    // data within the decades keeps its own limits
    const close = plotSvg(spec(1, { series: [series(1, [1e-3, 1e-2, 1e-1, 1])], logY: true }))
    expect(texts(close)).toContain('0.001')
  })

  it('labels a log axis of two decades at more than its decades', () => {
    // the ladder of 1, 2 and 5 is nine labels over these two and a half
    // decades, which is more than an axis of this height carries, and the
    // decades alone are the two of 0.01 and 0.1
    const svg = plotSvg(spec(1, { series: [series(1, [0.004, 0.05, 0.3, 0.6])], logY: true }))
    expect(texts(svg)).toContain('0.03')
    expect(texts(svg)).toContain('0.3')
    // and a figure of the height of a panel at the width of a phone, whose
    // axis asks for the three of `LEAST_TICKS`, carries more than its decades
    const small = plotSvg(
      spec(1, {
        series: [series(1, [0.004, 0.05, 0.3, 0.6])],
        logY: true,
        width: 326,
        height: 200,
      }),
    )
    expect(texts(small)).toContain('0.03')
  })

  it('keeps the colour bar of a figure in its column and puts its legend below', () => {
    // a colour bar is an axis of the figure and is read against the height of
    // the plot, so it keeps its column at any width; the legend of the study
    // data under it is a list and goes below the plot
    const svg = plotSvg(
      spec(11, {
        width: 390,
        points: [{ id: 'curve1', label: 'a very long series label of a study', x: [0], y: [1] }],
      }),
    )
    expect(svg).toContain('class="colourbar"')
    expect(svg).toContain('class="legend below"')
    expect(plotRight(svg)).toBeLessThan(390 - 8)
    expect(legendEntries(svg)).toEqual(['a very long series label of a study'])
  })

  it('draws a legend up to ten series and a colour bar above ten', () => {
    expect(plotSvg(spec(10))).toMatch(/class="legend( below)?"/)
    expect(plotSvg(spec(10))).not.toContain('class="colourbar"')
    expect(plotSvg(spec(11))).toContain('class="colourbar"')
    expect(plotSvg(spec(11))).not.toContain('class="legend')
  })

  it('draws the study points with their error bars under the curves', () => {
    const points: Points = {
      id: 'curve1',
      label: 'Series A',
      x: [0, 1, 2],
      y: [1, 2, 3],
      yerr: [0.1, 0.2, 0.3],
    }
    const svg = plotSvg(spec(1, { points: [points] }))
    expect(svg).toContain('class="points"')
    expect(svg).toContain('class="errorbar"')
    expect(occurrences(svg, 'class="marker"')).toBe(3)
    expect(svg.indexOf('class="points"')).toBeLessThan(svg.indexOf('class="curve"'))
    expect(texts(svg)).toContain('Series A')
  })

  it('leaves a study point beyond the x of the curves out of the figure and its axes', () => {
    // a study measures what it measured and a panel simulates the horizon it
    // declares: a point past the curves must stretch neither axis nor draw
    // anywhere, so the figure is the one of the simulation
    const inside: Points = { id: 'seriesA', label: 'Series A', x: [0, 1, 2], y: [1, 2, 3] }
    const beyond: Points = { ...inside, x: [...inside.x, 99], y: [...inside.y, 400] }
    const drawn = plotSvg(spec(1, { points: [beyond] }))
    expect(occurrences(drawn, 'class="marker"')).toBe(3)
    expect(texts(drawn)).not.toContain('99')
    expect(drawn).toBe(plotSvg(spec(1, { points: [inside] })))
  })

  it('lends a series the colour of the curve it names and keeps its own id', () => {
    const svg = plotSvg(
      spec(2, { points: [{ id: 'seriesA', label: 'Series A', curve: 'curve2', x: [0], y: [1] }] }),
    )
    expect(svg).toContain('<g class="points" data-series="seriesA">')
    const curve = /<path class="curve" data-series="curve2" style="stroke:([^;"]*)/.exec(svg)
    const marker = /<circle class="marker" style="fill:([^;"]*)/.exec(svg)
    expect(curve?.[1]).toContain('--sbmlsim-ramp')
    expect(marker?.[1]).toBe(curve?.[1])
  })

  it('draws the study points of a series without an error in the colour of its curve', () => {
    const svg = plotSvg(spec(2, { points: [{ id: 'curve2', label: 'Series A', x: [0], y: [1] }] }))
    expect(svg).not.toContain('class="errorbar"')
    const curve = /<path class="curve" data-series="curve2" style="stroke:([^;"]*)/.exec(svg)
    const marker = /<circle class="marker" style="fill:([^;"]*)/.exec(svg)
    expect(curve?.[1]).toContain('--sbmlsim-ramp')
    expect(marker?.[1]).toBe(curve?.[1])
  })

  it('gives the series under one curve a marker shape each, in their order', () => {
    // two studies under one curve carry the colour of that curve, so the shape
    // is the only thing which tells their points apart
    const under = (curve: string, id: string): Points => ({ id, label: id, curve, x: [0], y: [1] })
    const svg = plotSvg(
      spec(2, {
        points: [
          under('curve1', 'seriesA'),
          under('curve1', 'seriesB'),
          under('curve1', 'seriesC'),
          under('curve2', 'seriesD'),
        ],
      }),
    )
    const shapeOf = (id: string): string => {
      const group = new RegExp(`<g class="points" data-series="${id}">(.*?)</g>`).exec(svg)
      const marker = /<(circle|path) class="marker"[^>]*\s(?:r|d)="([^"]*)"/.exec(group?.[1] ?? '')
      return `${marker?.[1] ?? ''} ${marker?.[2] ?? ''}`
    }
    const shapes = ['seriesA', 'seriesB', 'seriesC', 'seriesD'].map(shapeOf)
    expect(new Set(shapes.slice(0, 3)).size).toBe(3)
    // the first series of every curve keeps the circle every series had
    expect(shapes[0]).toBe('circle 3')
    expect(shapes[3]).toBe('circle 3')
    // and the legend tells them apart by the same shapes
    const swatches = [...svg.matchAll(/<(circle|path) class="swatch"/g)].map((one) => one[1])
    expect(swatches).toEqual(['circle', 'path', 'path', 'circle'])
  })

  it('gives a series the shape of its rank, whatever is drawn beside it', () => {
    // the rank is the place of a series among the series declared under its
    // curve, so a series keeps its shape when a sibling is left out of the
    // figure, e.g. by the state of the knobs it was measured at
    const svg = plotSvg(
      spec(2, {
        points: [{ id: 'seriesB', label: 'Series B', curve: 'curve1', rank: 1, x: [0], y: [1] }],
      }),
    )
    expect(svg).toContain('<path class="marker"')
    expect(svg).not.toContain('<circle class="marker"')
  })

  it('keeps the circle of a curve of one series and its colour', () => {
    const svg = plotSvg(spec(2, { points: [{ id: 'curve2', label: 'Series A', x: [0], y: [1] }] }))
    expect(svg).toContain('<circle class="marker"')
    expect(svg).not.toContain('<path class="marker"')
    expect(svg).toContain('<circle class="swatch"')
  })

  it('takes its colours from the --sbmlsim tokens and not from hard coded hex', () => {
    // the figure of the assertion draws everything which carries a colour at
    // once: the curves, the colour bar above ten of them, the legend of the
    // study data, its markers and its error bars
    const svg = plotSvg(
      spec(11, {
        points: [{ id: 'curve1', label: 'Series A', x: [0, 1], y: [1, 2], yerr: [0.1, 0.2] }],
      }),
    )
    expect(svg).not.toMatch(/#[0-9a-f]{6}/i)
    const values = [
      ...svg.matchAll(/(?:^|[;"\s])(?:fill|stroke|stop-color|color)\s*[:=]\s*"?([^;"]*)/g),
    ].map((one) => one[1] ?? '')
    expect(values.length).toBeGreaterThan(30)
    for (const value of values) {
      const token = /^(var\(--sbmlsim-|color-mix\(in srgb, var\(--sbmlsim-)/.test(value)
      expect(value === 'none' || value.startsWith('url(#') || token).toBe(true)
    }
  })

  it('paints the colour bar as bands of its own tokens and not as a shared gradient', () => {
    const svg = plotSvg(spec(11))
    expect(svg).not.toContain('linearGradient')
    expect(svg).not.toContain('url(#sbmlsim-plot-ramp')
    const bands = /<g class="bar">(.*?)<\/g>/.exec(svg)?.[1] ?? ''
    expect(occurrences(bands, '<rect')).toBeGreaterThan(16)
    expect(bands).toContain('var(--sbmlsim-ramp-')
  })

  it('renders at the requested size without a canvas', () => {
    const svg = plotSvg(spec(2, { width: 640, height: 360 }))
    expect(svg).toContain('width="640"')
    expect(svg).toContain('height="360"')
    expect(svg).toContain('viewBox="0 0 640 360"')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
  })

  it('names the figure for a screen reader', () => {
    const svg = plotSvg(spec(1))
    expect(svg).toContain('role="img"')
    expect(/^<svg[^>]*><title>value \[mM\] over time \[h\]<\/title>/.test(svg)).toBe(true)
  })

  it('writes the same bytes for the same spec and keeps its numbers short', () => {
    expect(plotSvg(spec(3))).toBe(plotSvg(spec(3)))
    for (const path of paths(plotSvg(spec(3, { x: [0, 1 / 3, 2 / 3, 1] })), 'curve')) {
      expect(path).not.toMatch(/\d\.\d{3,}/)
    }
  })

  it('escapes what a label carries', () => {
    const svg = plotSvg(spec(1, { yLabel: '<b>&"value"' }))
    expect(svg).not.toContain('<b>')
    expect(svg).toContain('&lt;b&gt;&amp;')
  })

  it('writes no NaN into a figure it cannot draw', () => {
    expect(plotSvg(spec(0, { x: [] }))).not.toContain('NaN')
    expect(plotSvg(spec(1, { series: [series(1, [Number.NaN, Number.NaN])] }))).not.toContain('NaN')
    expect(plotSvg(spec(1, { series: [series(1, [0, -1, -2, 1])], logY: true }))).not.toContain(
      'NaN',
    )
    expect(plotSvg(spec(1, { series: [series(1, [2, 2, 2, 2])] }))).not.toContain('NaN')
    expect(plotSvg(spec(1, { width: 10, height: 10 }))).not.toContain('NaN')
  })

  it('gives the column right of the plot the room its labels need and no more', () => {
    // a figure wide enough that a column costs it less plot than a row below it
    const wide = { width: 1100, height: 160 }
    const short = plotSvg(spec(3, wide))
    const long = plotSvg(
      spec(3, {
        ...wide,
        series: spec(3).series.map((o) => ({ ...o, label: `${o.label} of a study` })),
      }),
    )
    expect(short).not.toContain('class="legend below"')
    expect(long).not.toContain('class="legend below"')
    expect(plotRight(long)).toBeLessThan(plotRight(short))
    expect(texts(short)).toContain('Curve 1')
    expect(texts(long)).toContain('Curve 1 of a study')
  })

  it('puts a legend below the plot where that leaves the larger plot box', () => {
    // the figure of a panel at the width of a phone: a column of these labels
    // would leave a plot nobody can read, so the legend goes under the plot,
    // which gets the whole width, and the labels are written out in full
    const svg = plotSvg(
      spec(2, {
        width: 390,
        series: [
          { ...series(1), label: 'hydrochlorothiazide plasma', unit: 'umol' },
          { ...series(2), label: 'hydrochlorothiazide urine', unit: 'umol' },
        ],
      }),
    )
    expect(svg).toContain('class="legend below"')
    // the plot ends at the padding of the figure, i.e. there is no column
    expect(plotRight(svg)).toBe(390 - 8)
    expect(legendEntries(svg)).toEqual(['hydrochlorothiazide plasma', 'hydrochlorothiazide urine'])
  })

  it('keeps a legend beside the plot where that leaves the larger plot box', () => {
    // a figure which is wide and short: the row a legend takes below it costs
    // more of the plot than the column beside it, so the column is what it gets
    const svg = plotSvg(spec(2, { width: 1100, height: 160 }))
    expect(svg).not.toContain('class="legend below"')
    expect(svg).toContain('class="legend"')
    expect(plotRight(svg)).toBeLessThan(1100 - 8)
  })

  it('packs the entries of a legend below the plot into the rows of the figure', () => {
    const svg = plotSvg(
      spec(3, {
        width: 390,
        series: Array.from({ length: 3 }, (_, index) => ({
          ...series(index + 1),
          label: `hydrochlorothiazide plasma level ${String(index + 1)}`,
        })),
      }),
    )
    expect(svg).toContain('class="legend below"')
    const swatches = [
      ...svg.matchAll(/<line class="swatch" [^>]*\sx1="([^"]*)" y1="([^"]*)"/g),
    ].map((one) => ({ x: Number(one[1]), y: Number(one[2]) }))
    expect(swatches).toHaveLength(3)
    // one entry per row at this width, every row centred on the plot box, which
    // is where the label of the x axis is centred, and a row is one row tall
    const box = plotGeometry(spec(3, { width: 390 })).box
    const starts = swatches.map((one) => one.x)
    expect(new Set(starts).size).toBe(1)
    expect(starts[0] ?? 0).toBeGreaterThan(box.x0)
    expect(starts[0] ?? 0).toBeLessThan((box.x0 + box.x1) / 2)
    expect((swatches[1]?.y ?? 0) - (swatches[0]?.y ?? 0)).toBe(18)
    // the last row ends inside the figure
    expect(swatches[2]?.y ?? 0).toBeLessThan(300)
  })

  it('leaves the plot a figure whose legend has no room below it', () => {
    // ten entries of these labels are ten rows below the plot, which is more of
    // the height than a legend may take, so the legend keeps its column there
    const svg = plotSvg(columnLegend([]))
    expect(svg).not.toContain('class="legend below"')
    expect(plotRight(svg)).toBeLessThan(480 - 8)
  })

  it('wraps a long legend label onto two lines instead of cutting it', () => {
    const svg = plotSvg(columnLegend(['plasma concentration of the total']))
    expect(legendEntries(svg)[0]).toBe('plasma concentration of the total')
    // the whole label is written, on the two lines of its words
    expect(texts(svg)).toContain('plasma concentration of')
    expect(texts(svg)).toContain('the total')
  })

  it('cuts the last line of a label which two lines do not hold with an ellipsis', () => {
    const label = 'A very long legend entry indeed, which runs on past two lines, and then some'
    const svg = plotSvg(columnLegend([label]))
    const lines = texts(svg).filter((one) => label.includes(one.replace('…', '')) && one !== '')
    expect(lines).toHaveLength(2)
    expect(lines[1]?.startsWith('…')).toBe(true)
    expect(lines[1]?.endsWith('some')).toBe(true)
  })

  it('starts the kept end of a cut label at a word, and inside one without', () => {
    const lastLine = (label: string): string => {
      const svg = plotSvg(columnLegend([label]))
      return texts(svg).find((one) => one.startsWith('…')) ?? ''
    }
    // the words of the end are words of the label and no tail of one
    expect(
      lastLine('A very long legend entry indeed, which runs on past two lines, and then some'),
    ).toBe('…lines, and then some')
    // a label which ends in a word longer than the room keeps the end of it,
    // because there is no word to start at
    expect(lastLine('Study A hydrochlorothiazideplasmaconcentrationofvolunteers')).toBe(
      '…oncentrationofvolunteers',
    )
  })

  it('keeps the end of a label which needs more than two lines, where labels differ', () => {
    const svg = plotSvg(columnLegend(['plasma concentration total', 'plasma concentration free']))
    const entries = legendEntries(svg)
    expect(entries[0]).not.toBe(entries[1])
    expect(entries[0]?.endsWith('total')).toBe(true)
    expect(entries[1]?.endsWith('free')).toBe(true)
  })

  it('wraps a legend only while it fits, and falls back to one line per entry', () => {
    const lines = (svg: string): number[] =>
      [...svg.matchAll(/<g class="legend-entry"[\s\S]*?<\/g>/g)].map((one) => texts(one[0]).length)
    const bottom = (svg: string): number => {
      const legend = /<g class="legend[^"]*"[\s\S]*$/.exec(svg)?.[0] ?? ''
      const ys = [...legend.matchAll(/<text[^>]*\sy="([^"]*)"/g)].map((one) => Number(one[1]))
      return Math.max(...ys)
    }
    // a column of ten labels of two lines each does not fit the plot box, so
    // every entry is written on one line and cut
    const full = plotSvg(columnLegend([], { height: 300 }))
    expect(bottom(full)).toBeLessThanOrEqual(300 - 42)
    expect(lines(full)).toEqual(Array.from({ length: 10 }, () => 1))
    expect(texts(full).some((one) => one.endsWith('…'))).toBe(true)
    // where the column is tall enough the same labels wrap onto two lines
    const tall = plotSvg(columnLegend([]))
    expect(lines(tall)).toEqual(Array.from({ length: 10 }, () => 2))
  })

  it('spaces the entries of a legend by the lines they wrap to, so none overlaps', () => {
    const svg = plotSvg(columnLegend(['hydrochlorothiazide plasma']))
    const swatches = [...svg.matchAll(/<line class="swatch"[^>]*\sy1="([^"]*)"/g)].map((one) =>
      Number(one[1]),
    )
    expect(swatches).toHaveLength(10)
    expect((swatches[1] ?? 0) - (swatches[0] ?? 0)).toBeGreaterThan(18)
  })

  it('cuts the labels of a colour bar which does not fit its column with an ellipsis', () => {
    const wide = spec(12, { width: 300, height: 220 })
    const svg = plotSvg({
      ...wide,
      series: wide.series.map((one, index) => ({
        ...one,
        label: `${String(0.125 * (index + 1))} mg/kg body weight`,
      })),
    })
    expect(svg).toContain('class="colourbar"')
    const cut = texts(svg).filter((one) => one.endsWith('…'))
    expect(cut.length).toBeGreaterThan(0)
    for (const label of texts(svg)) {
      expect(label.length).toBeLessThan(20)
    }
  })

  it('writes one notation on an axis and does not mix them', () => {
    const svg = plotSvg(spec(1, { series: [series(1, [0, -50000, -120000, -170000])] }))
    expect(texts(svg)).toContain('-5e+4')
    expect(texts(svg)).not.toContain('-50000')
    expect(texts(svg)).toContain('0')
  })

  it('caps an error bar only where it ends inside the axis', () => {
    const inside = plotSvg(
      spec(1, {
        series: [series(1, [1, 2, 3, 4])],
        logY: true,
        points: [{ id: 'curve1', label: 'Series A', x: [1], y: [4], yerr: [1] }],
      }),
    )
    const clipped = plotSvg(
      spec(1, {
        series: [series(1, [1, 2, 3, 4])],
        logY: true,
        points: [{ id: 'curve1', label: 'Series A', x: [1], y: [4], yerr: [9] }],
      }),
    )
    expect(occurrences(paths(inside, 'errorbar')[0] ?? '', 'M')).toBe(3)
    expect(occurrences(paths(clipped, 'errorbar')[0] ?? '', 'M')).toBe(2)
  })

  it('gives a flat series on a log axis the decade around it', () => {
    const svg = plotSvg(
      spec(1, { x: [100, 200, 300, 400], series: [series(1, [5, 5, 5, 5])], logY: true }),
    )
    expect(texts(svg)).toContain('1')
    expect(texts(svg)).toContain('10')
  })

  it('paints no surface behind a figure unless a host asks for one', () => {
    expect(plotSvg(spec(1))).toContain('fill:var(--sbmlsim-figure-bg, transparent)')
  })

  it('draws the axes, their ticks and the background of every figure', () => {
    const svg = plotSvg(spec(1))
    expect(svg).toContain('class="background"')
    expect(occurrences(svg, 'class="axis ')).toBe(2)
    expect(occurrences(svg, 'class="tick"')).toBeGreaterThan(3)
  })
})

describe('the room the legend keeps', () => {
  /** The labels of a figure whose second entry is drawn under a condition. */
  const CONDITIONED = ['urine', 'Beermann 1976 (5 mg, oral)']

  /** Build that figure, with the second entry drawn or only reserved. */
  function conditioned(width: number, shown: boolean, height = 300): PlotSpec {
    const base = spec(1, {
      width,
      height,
      series: [{ ...series(1), label: CONDITIONED[0] ?? '' }],
    })
    const declared = { ...base, declaredLegends: [[CONDITIONED[1] ?? '']] }
    return shown
      ? {
          ...declared,
          points: [{ id: 'seriesA', label: CONDITIONED[1] ?? '', curve: 'curve1', x: [0], y: [1] }],
        }
      : declared
  }

  /** The area of the plot box of a figure in square pixels. */
  function area(figure: PlotSpec): number {
    const box = plotGeometry(figure).box
    return (box.x1 - box.x0) * (box.y1 - box.y0)
  }

  it('lays the legend out over the labels it reserves and draws the entries it has', () => {
    const reserved = conditioned(390, false)
    const shown = conditioned(390, true)
    // the figure of the panel is the same figure whether or not the series of
    // its condition is drawn, so the curve is never redrawn in another box
    expect(plotGeometry(reserved).box).toEqual(plotGeometry(shown).box)
    expect(legendEntries(plotSvg(reserved))).toEqual([CONDITIONED[0]])
    expect(legendEntries(plotSvg(shown))).toEqual(CONDITIONED)
    // and the room it keeps is room: the same figure without the reserved label
    // keeps its legend beside the plot, where the reserved one takes the band
    // below it, so the reserve is part of the layout and not a note
    const plain = spec(1, {
      width: 900,
      height: 160,
      series: [{ ...series(1), label: CONDITIONED[0] ?? '' }],
    })
    expect(plotGeometry(conditioned(900, false, 160)).box.y1).toBeLessThan(
      plotGeometry(plain).box.y1,
    )
  })

  it('keeps the box of a declaration whichever of its conditioned series is drawn', () => {
    // two series under one curve, each drawn at a state of its own and their
    // labels of different lengths: the legend packs its rows in the order it is
    // given its labels, so the row count may not depend on which one is there
    const two = ['healthy', 'renal impairment, creatinine clearance 10 ml/min']
    const drawn = (which: number, width: number): PlotSpec => ({
      ...spec(1, { width, height: 200, series: [{ ...series(1), label: 'urine' }] }),
      declaredLegends: two.map((label) => [label]),
      points: [
        { id: `series${String(which)}`, label: two[which] ?? '', curve: 'curve1', x: [0], y: [1] },
      ],
    })
    for (const width of [316, 390]) {
      expect(plotGeometry(drawn(0, width)).box).toEqual(plotGeometry(drawn(1, width)).box)
    }
  })

  it('never gives a wider figure a smaller plot', () => {
    // the legend sits beside the plot or below it, whichever leaves the larger
    // box, so a viewport which grows past the width where the two trade places
    // never loses plot. The labels are the ones of a real panel, whose legend
    // trades places inside this sweep
    const seen = new Set<boolean>()
    let last = -1
    for (let width = 600; width <= 1500; width += 5) {
      const figure = conditioned(width, true, 160)
      seen.add(plotSvg(figure).includes('class="legend below"'))
      const now = area(figure)
      expect(now).toBeGreaterThanOrEqual(last)
      last = now
    }
    expect([...seen].sort()).toEqual([false, true])
  })
})

describe('the limits of the value axis', () => {
  /** Get the labels of the ticks of the y axis, in their order. */
  function yTicks(svg: string): string[] {
    const after = svg.split('<g class="axis ')[2] ?? ''
    const group = after.split('<g class="data"')[0] ?? ''
    return [...group.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((one) => one[1] ?? '')
  }

  it('takes them from what is drawn where the spec carries none', () => {
    const ticks = yTicks(plotSvg(spec(1)))
    expect(ticks[0]).toBe('1')
    expect(ticks).toContain('4')
    expect(ticks).not.toContain('100')
  })

  it('takes them from the spec where it carries them', () => {
    // the line reaches 4 of an axis which holds 100: the axis is the frame the
    // caller gave and not the one the line would ask for
    const svg = plotSvg(spec(1, { yLimits: { low: 0, high: 100 } }))
    expect(yTicks(svg)).toContain('100')
    expect(yTicks(svg)).toContain('0')
    const path = paths(svg, 'curve')[0] ?? ''
    const ys = [...path.matchAll(/[ML][\d.-]+ ([\d.-]+)/g)].map((one) => Number(one[1]))
    // the whole line sits in the lower fifth of a box which ends at 258
    expect(Math.min(...ys)).toBeGreaterThan(200)
  })

  it('applies the decades of a logarithmic axis to the limits it is given', () => {
    const svg = plotSvg(spec(1, { logY: true, yLimits: { low: 1e-9, high: 1e3 } }))
    // six decades below the largest value of the frame, as for drawn values
    expect(yTicks(svg)).toContain('0.001')
    expect(svg).not.toContain('1e-9')
    expect(svg).not.toContain('1e-8')
  })

  it('draws a figure of the limits of its own values alike either way', () => {
    // the frame of a caller which hands over what the figure would compute
    // itself is the figure the caller had without it
    expect(plotSvg(spec(1, { yLimits: { low: 1, high: 4 } }))).toBe(plotSvg(spec(1)))
  })
})

describe('the tick labels on whole pixels', () => {
  /** The ticks of an axis group: the pixel of each tick mark and its label. */
  function ticksOf(group: string): { mark: number; attributes: string; label: string }[] {
    return [
      ...group.matchAll(
        /<g class="tick"><line x1="([^"]*)" y1="([^"]*)"[^>]*\/><text([^>]*)>([^<]*)<\/text>/g,
      ),
    ].map((one) => ({
      mark: Number(group.includes('class="axis x"') ? one[1] : one[2]),
      attributes: one[3] ?? '',
      label: one[4] ?? '',
    }))
  }

  it('anchors every tick label on a whole pixel, at most half a pixel from where its tick centres it', () => {
    // a text drawn from a fraction of a pixel takes the colour fringes of
    // subpixel antialiasing at that fraction, so equal glyphs of two labels
    // would read in two tints
    const problems: string[] = []
    for (const measure of [tableMeasure, chromeLike]) {
      for (const span of [3, 96, 1440, 143000]) {
        for (let width = 220; width <= 700; width += 37) {
          const grid = Array.from({ length: 50 }, (_, index) => (span * index) / 49)
          const svg = plotSvg({
            ...spec(1, { x: grid, width, height: 200 }),
            series: [
              series(
                1,
                grid.map((_, index) => (3 * index) / 49),
              ),
            ],
            measure,
          })
          const [, xAxis = '', rest = ''] = svg.split('<g class="axis ')
          for (const one of ticksOf(`<g class="axis ${xAxis}`)) {
            const x = Number(/\sx="([^"]*)"/.exec(one.attributes)?.[1])
            const middle = x + measure(one.label, 11) / 2
            if (!Number.isInteger(x) || Math.abs(middle - one.mark) > 0.5 + 1e-9) {
              problems.push(`${measure.name} ${String(span)} ${String(width)} x ${one.label}`)
            }
          }
          for (const one of ticksOf(`<g class="axis ${rest.split('<g class="data"')[0] ?? ''}`)) {
            const x = Number(/\sx="([^"]*)"/.exec(one.attributes)?.[1])
            const y = Number(/\sy="([^"]*)"/.exec(one.attributes)?.[1])
            if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(y - one.mark) > 0.5) {
              problems.push(`${measure.name} ${String(span)} ${String(width)} y ${one.label}`)
            }
          }
        }
      }
    }
    expect(problems).toEqual([])
  })
})

describe('the declared ends of the axes', () => {
  /** Get the labels of the ticks of an axis, `x` or `y`, in their order. */
  function ticksOf(svg: string, axis: 'x' | 'y'): string[] {
    const group =
      (svg.split(`<g class="axis ${axis}"`)[1] ?? '').split(/<g class="(?:axis|data)/)[0] ?? ''
    return [...group.matchAll(/<g class="tick">.*?<text[^>]*>([^<]*)<\/text>/g)].map(
      (one) => one[1] ?? '',
    )
  }

  /** The data group of a figure, which is clipped to its plot box. */
  function dataOf(svg: string): string {
    return (
      /<g class="data" clip-path="url\(#([^)]*)\)">(.*?)<\/g><g class="legend/.exec(svg)?.[2] ?? ''
    )
  }

  it('runs a linear axis exactly from the one declared end to the other, with its ticks inside', () => {
    const figure = spec(1, { yEnds: { low: 0, high: 10 } })
    const drawn = plotGeometry(figure)
    expect(drawn.yAt(0)).toBeCloseTo(drawn.box.y1, 9)
    expect(drawn.yAt(10)).toBeCloseTo(drawn.box.y0, 9)
    const ticks = ticksOf(plotSvg(figure), 'y').map(Number)
    expect(ticks[0]).toBe(0)
    expect(ticks.at(-1)).toBe(10)
    // a frame of a caller holds nothing open beyond declared ends
    const framed = plotGeometry(
      spec(1, { yEnds: { low: 0, high: 10 }, yLimits: { low: -5, high: 50 } }),
    )
    expect(framed.yAt(10)).toBeCloseTo(framed.box.y0, 9)
    expect(framed.yAt(0)).toBeCloseTo(framed.box.y1, 9)
  })

  it('runs a logarithmic axis exactly over the decades its ends declare', () => {
    const figure = spec(1, { logY: true, yEnds: { low: 1e-3, high: 100 } })
    const drawn = plotGeometry(figure)
    expect(drawn.yAt(1e-3)).toBeCloseTo(drawn.box.y1, 9)
    expect(drawn.yAt(100)).toBeCloseTo(drawn.box.y0, 9)
    // the decades of the ends, every one inside them
    const ticks = ticksOf(plotSvg(figure), 'y').map(Number)
    expect(ticks[0]).toBe(0.001)
    expect(ticks.every((one) => one >= 1e-3 && one <= 100)).toBe(true)
  })

  it('works the other end out of what is drawn where one end is declared', () => {
    // the values 1..4: the upper end is the declared 10 exactly, the lower one
    // the margin of the span the axis shows, 1 less 5 % of 9
    const upper = plotGeometry(spec(1, { yEnds: { high: 10 } }))
    expect(upper.yAt(10)).toBeCloseTo(upper.box.y0, 9)
    expect(upper.yAt(1 - 0.45)).toBeCloseTo(upper.box.y1, 9)
    const lower = plotGeometry(spec(1, { yEnds: { low: -2 } }))
    expect(lower.yAt(-2)).toBeCloseTo(lower.box.y1, 9)
    expect(lower.yAt(4 + 0.3)).toBeCloseTo(lower.box.y0, 9)
    // a declared end which a logarithmic axis cannot show, the 0 of a linear
    // panel drawn logarithmic, is no end of it, and the other one still is
    const log = plotGeometry(spec(1, { logY: true, yEnds: { low: 0, high: 10 } }))
    expect(log.yAt(10)).toBeCloseTo(log.box.y0, 9)
    expect(log.yAt(1)).toBeLessThan(log.box.y1)
    expect(log.drawable(0)).toBe(false)
  })

  it('takes no pair of ends which is no span', () => {
    expect(plotSvg(spec(1, { yEnds: { low: 5, high: 5 } }))).toBe(plotSvg(spec(1)))
    expect(plotSvg(spec(1, { yEnds: { low: 6, high: 2 } }))).toBe(plotSvg(spec(1)))
  })

  it('cuts a curve and a series beyond the declared ends at the plot box', () => {
    const figure = spec(1, {
      yEnds: { low: 0, high: 2 },
      points: [
        { id: 'study', label: 'Study', curve: 'curve1', x: [1, 2], y: [1, 30], yerr: [3, 0] },
      ],
    })
    const svg = plotSvg(figure)
    const box = plotGeometry(figure).box
    // the curve 1..4 and the point at 30 are drawn in the group which is
    // clipped to the plot box, and nothing of the data is drawn outside it
    const clip =
      /<clipPath id="([^"]*)"><rect x="([^"]*)" y="([^"]*)" width="([^"]*)" height="([^"]*)"/.exec(
        svg,
      )
    expect(clip?.slice(2).map(Number)).toEqual([box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0])
    const data = dataOf(svg)
    expect(data).toContain('class="curve"')
    expect(data).toContain('data-series="study"')
    expect(svg.split('class="curve"')).toHaveLength(2)
    expect(svg.split('class="marker"').length - 1).toBe(2)
    // the bar of the point at 1 reaches past both ends: it ends at them and
    // has no cap of a bound the axis does not show
    const bar = /<path class="errorbar"[^>]*d="([^"]*)"/.exec(svg)?.[1] ?? ''
    expect(bar.split('M')).toHaveLength(2)
  })

  it('ends the x axis exactly at its declared end and draws nothing beyond it', () => {
    const figure = spec(1, {
      xEnd: 2,
      points: [{ id: 'study', label: 'Study', curve: 'curve1', x: [1, 2.5], y: [2, 3] }],
    })
    const drawn = plotGeometry(figure)
    expect(drawn.xAt(2)).toBeCloseTo(drawn.box.x1, 9)
    const svg = plotSvg(figure)
    // the point beyond the end is no point of the figure, as one beyond the
    // curves is not; the curve beyond it is cut at the plot box
    expect(svg.split('class="marker"').length - 1).toBe(1)
    expect(ticksOf(svg, 'x').at(-1)).toBe('2')
    expect(dataOf(svg)).toContain('class="curve"')
  })

  it('keeps the axes and the box where they are whatever is drawn, where both ends are declared', () => {
    // two states of the knobs of a panel, a curve of a tenth and one of
    // twice the other: the axis is the declared one in either
    const ends = { yEnds: { low: 0, high: 10 }, xEnd: 3 }
    const small = spec(1, { ...ends, series: [series(1, [0, 0.1, 0.2, 0.1])] })
    const large = spec(1, {
      ...ends,
      series: [series(1, [0, 8, 12, 4])],
      yLimits: { low: 0, high: 12 },
    })
    const one = plotSvg(small)
    const other = plotSvg(large)
    expect(plotGeometry(small).box).toEqual(plotGeometry(large).box)
    expect(ticksOf(one, 'y')).toEqual(ticksOf(other, 'y'))
    expect(ticksOf(one, 'x')).toEqual(ticksOf(other, 'x'))
  })
})

describe('a scale of the x axis', () => {
  /** The four arms of a study, whose legend a figure of a phone holds. */
  const ARMS = ['Frost 2013, 2.5 mg', 'Frost 2013, 5 mg', 'Frost 2013, 10 mg', 'Frost 2013, 25 mg']

  /** Get the labels of the ticks of the x axis. */
  function xLabels(svg: string): string[] {
    const axis = (svg.split('<g class="axis x"')[1] ?? '').split('<g class="axis y"')[0] ?? ''
    return [...axis.matchAll(/<g class="tick">.*?<text[^>]*>([^<]*)<\/text>/g)].map(
      (one) => one[1] ?? '',
    )
  }

  /** A figure of a phone over 0..143000 in the sizes of a host, with four arms. */
  function narrow(width: number, measure: TextMeasure): PlotSpec {
    const grid = Array.from({ length: 50 }, (_, index) => (143000 * index) / 49)
    return {
      ...spec(1, {
        x: grid,
        width,
        height: 200,
        xLabel: 'time (min)',
        yLabel: 'plasma concentration',
      }),
      series: [
        {
          ...series(
            1,
            grid.map((_, index) => (3 * index) / 49),
          ),
          label: 'plasma',
          unit: 'uM',
        },
      ],
      declaredLegends: [ARMS],
      points: ARMS.map((label, index) => ({
        id: `arm${String(index)}`,
        label,
        curve: 'curve1',
        x: [70000],
        y: [1],
      })),
      fontSizes: { label: 16, small: 14 },
      measure,
    }
  }

  it('is drawn with a first and a last tick where a layout can draw them apart', () => {
    // 220 to 230 px with four arms in 16 and 14 px drew the column beside the
    // plot over a single label, 1.5e+5, from which no scale can be read: the
    // band draws 0 and 1.5e+5 apart, so the column is no candidate there
    const single: string[] = []
    let excluded = 0
    for (const measure of [tableMeasure, chromeLike]) {
      for (let width = 220; width <= 230; width += 1) {
        const figure = narrow(width, measure)
        const labels = xLabels(plotSvg(figure))
        if (labels.length < 2) {
          single.push(`${String(width)}: ${labels.join(' ')}`)
        }
        excluded += marginFits(figure).filter((fit) => !fit.candidate).length
      }
    }
    expect(single).toEqual([])
    expect(excluded).toBeGreaterThan(0)
  })
})

describe('plotGeometry', () => {
  it('gives the box the figure draws its axes along', () => {
    const one = spec(1)
    const geometry = plotGeometry(one)
    const svg = plotSvg(one)
    expect(geometry.width).toBe(one.width)
    expect(geometry.height).toBe(one.height)
    const lines = [
      ...svg.matchAll(
        /<line class="axis-line" x1="([^"]*)" y1="([^"]*)" x2="([^"]*)" y2="([^"]*)"/g,
      ),
    ].map((one) => one.slice(1).map(Number))
    // the x axis runs along the bottom of the box, the y axis along its left
    expect(lines[0]).toEqual([geometry.box.x0, geometry.box.y1, geometry.box.x1, geometry.box.y1])
    expect(lines[1]).toEqual([geometry.box.x0, geometry.box.y0, geometry.box.x0, geometry.box.y1])
    expect(geometry.box.x1).toBeGreaterThan(geometry.box.x0)
    expect(geometry.box.y1).toBeGreaterThan(geometry.box.y0)
  })

  it('puts a value where the figure draws it', () => {
    const one = spec(1)
    const geometry = plotGeometry(one)
    const start = /^M([\d.-]+) ([\d.-]+)/.exec(paths(plotSvg(one), 'curve')[0] ?? '')
    expect(Number(start?.[1])).toBeCloseTo(geometry.xAt(one.x[0] ?? 0), 1)
    expect(Number(start?.[2])).toBeCloseTo(geometry.yAt(one.series[0]?.values[0] ?? 0), 1)
  })

  it('says which values its y axis can draw at all', () => {
    const geometry = plotGeometry(spec(1, { logY: true }))
    expect(geometry.drawable(1)).toBe(true)
    expect(geometry.drawable(0)).toBe(false)
    expect(geometry.drawable(Number.NaN)).toBe(false)
  })
})

/**
 * Measure a text as the renderer once guessed it, 0.55 of its size a character.
 *
 * It is the measure the tests compare against to show that a figure follows
 * its measure: the guess made `anti-Xa activity` 35 % wider than Chrome draws it.
 */
function estimate(text: string, size: number): number {
  return Array.from(text).length * size * 0.55
}

/** The figure of the anti-Xa panel: its curve, its y label and its three studies. */
function antiXa(width: number, height = 200): PlotSpec {
  return {
    ...spec(1, { width, height, yLabel: 'anti-Xa activity' }),
    series: [{ ...series(1), label: 'anti-Xa', unit: 'ng/ml' }],
    declaredLegends: [['Frost 2021', 'Frost 2015, young', 'Frost 2015, elderly']],
  }
}

describe('the label of an axis', () => {
  /**
   * Get the lines the label of an axis is written on, in their order.
   *
   * The figure writes the x axis before the y axis, so the two groups are the
   * two pieces the figure splits into at the start of an axis.
   */
  function labelLines(svg: string, horizontal: boolean): string[] {
    const after = svg.split('<g class="axis ')[horizontal ? 1 : 2] ?? ''
    const group = after.split('<g class="data"')[0] ?? ''
    return [...group.matchAll(/<text class="axis-label"[^>]*>([^<]*)<\/text>/g)].map(
      (one) => one[1] ?? '',
    )
  }

  it('is one line and the room of one line where it fits', () => {
    const svg = plotSvg(spec(1))
    expect(labelLines(svg, false)).toEqual(['value [mM]'])
    expect(labelLines(svg, true)).toEqual(['time [h]'])
  })

  it('wraps at its words where it is longer than its axis, and keeps its unit', () => {
    const name = 'plasma concentration of hydrochlorothiazide'
    const lines = labelLines(plotSvg(spec(1, { yLabel: name, height: 234, width: 390 })), false)
    expect(lines.length).toBeGreaterThan(1)
    // the lines are the words of the label and the unit is at its end
    expect(lines.join(' ')).toContain('plasma')
    expect(lines[lines.length - 1]?.endsWith('[mM]')).toBe(true)
  })

  it('gives the margin of its axis the lines it wraps to', () => {
    const name = 'plasma concentration of hydrochlorothiazide'
    const one = plotSvg(spec(1, { height: 234, width: 390 }))
    const two = plotSvg(spec(1, { yLabel: name, height: 234, width: 390 }))
    // the plot starts further right by the line the label needs, so a wrapped
    // label is written beside the tick labels and never over them
    const left = (svg: string): number =>
      Number(/<line class="axis-line"[^>]*\sx1="([^"]*)"/.exec(svg)?.[1] ?? Number.NaN)
    expect(left(two) - left(one)).toBe(14)
  })

  it('cuts the last line of a label which two lines do not hold, keeping its unit', () => {
    const name = 'a curve of a very long name which runs past the axis it labels'
    const lines = labelLines(plotSvg(spec(1, { yLabel: name, height: 160, width: 300 })), false)
    expect(lines).toHaveLength(2)
    expect(lines[1]?.startsWith('\u2026')).toBe(true)
    expect(lines[1]?.endsWith('[mM]')).toBe(true)
  })

  it('reads a label whole on two lines where its measured width fits', () => {
    // `anti-Xa activity [ng/ml]` beside the plot of a 316 px figure under the
    // band of its studies: the words are 78 px wide in the table and in
    // Chrome, which two lines of the height of the plot hold, while the 0.55 em
    // a character the renderer once guessed made them 106 px and cut the label
    for (const measure of [tableMeasure, chromeLike]) {
      const lines = labelLines(plotSvg({ ...antiXa(316), measure }), false)
      expect({ measure: measure.name, lines }).toEqual({
        measure: measure.name,
        lines: ['anti-Xa activity', '[ng/ml]'],
      })
    }
    const guessed = labelLines(plotSvg({ ...antiXa(316), measure: estimate }), false)
    expect(guessed).toEqual(['anti-Xa', '\u2026[ng/ml]'])
  })

  it('keeps the band of the anti-Xa panel where a longer y label would cost it a row', () => {
    // the y label takes two lines and no more: a third line moves the plot
    // right by a line, the band then needs a fourth row, which is more of the
    // height than a legend may take, and the legend goes beside a plot of half
    // the width with its study labels cut
    for (const measure of [tableMeasure, chromeLike]) {
      for (let width = 249; width <= 262; width += 1) {
        const svg = plotSvg({ ...antiXa(width), measure })
        expect({
          measure: measure.name,
          width,
          below: svg.includes('class="legend below"'),
        }).toEqual({ measure: measure.name, width, below: true })
      }
    }
  })

  it('wraps the label of the x axis the same way', () => {
    const label = 'time after the administration of the first dose of the drug [h]'
    const lines = labelLines(plotSvg(spec(1, { xLabel: label, width: 300, height: 220 })), true)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines[lines.length - 1]?.endsWith('[h]')).toBe(true)
    // and the figure keeps its lines inside itself
    const ys = [
      ...plotSvg(spec(1, { xLabel: label, width: 300, height: 220 })).matchAll(
        /<text class="axis-label"[^>]*\sy="([^"]*)"/g,
      ),
    ].map((one) => Number(one[1]))
    expect(Math.max(...ys)).toBeLessThanOrEqual(220)
  })
})

describe('the room the tick labels keep', () => {
  /** The size of the font of a tick label, the renderer's. */
  const SMALL_FONT = 11

  /** A figure over a grid of minutes, whose ticks are four digits wide. */
  function minutes(width: number, more: Partial<PlotSpec> = {}): PlotSpec {
    const grid = Array.from({ length: 50 }, (_, index) => (index * 1440) / 49)
    return spec(1, {
      width,
      height: 200,
      x: grid,
      xLabel: 'time (min)',
      series: [
        {
          ...series(
            1,
            grid.map((at) => at / 30),
          ),
          label: 'urine',
        },
      ],
      ...more,
    })
  }

  /** The pixels every tick label of the x axis spans, in their order. */
  function xTickSpans(svg: string): { label: string; from: number; to: number }[] {
    const axis = svg.split('<g class="axis ')[1] ?? ''
    const group = axis.split('<g class="data"')[0] ?? ''
    return tickTexts(group).map((one) => ({
      label: one.label,
      ...spanOf(one.attributes, one.label, tableMeasure, SMALL_FONT),
    }))
  }

  it('keeps every tick label of the x axis inside the figure', () => {
    // a tick label is centred on its tick, so the label of the last tick of an
    // axis reaches half its width past the end of the plot: the margins of the
    // figure are grown by what its ticks need beyond them, which is
    // `_fit_margins` of sbmlsim, and the sweep is every width a host gives a
    // figure from a phone to a wide screen
    for (let width = 240; width <= 1500; width += 7) {
      for (const span of xTickSpans(plotSvg(minutes(width)))) {
        expect({ width, label: span.label, from: span.from }).toEqual({
          width,
          label: span.label,
          from: Math.max(span.from, 0),
        })
        expect({ width, label: span.label, to: span.to }).toEqual({
          width,
          label: span.label,
          to: Math.min(span.to, width),
        })
      }
    }
  })

  it('moves the edge its labels overhang and leaves the other one where it was', () => {
    // the two sides are counted apart, so the room the label of the last tick
    // needs comes out of the right margin and the plot starts where it started
    const long = plotGeometry(minutes(316)).box
    const short = plotGeometry(minutes(316, { x: [0, 1, 2, 3] })).box
    expect(long.x0).toBe(short.x0)
    expect(long.x1).toBeLessThan(short.x1)
  })

  it('leaves the margins of the layout where no label overhangs', () => {
    // the same grid on a figure wide enough that its last tick label falls
    // inside the plot: a margin grows by what its ticks need and by no more, so
    // this figure is the figure of the layout
    expect(plotGeometry(minutes(600)).box).toEqual(
      plotGeometry(minutes(600, { x: [0, 1, 2, 3] })).box,
    )
  })
})

describe('the band of rows below the plot', () => {
  /** The padding of a figure, the renderer's. */
  const PAD = 8
  /** The height of a row of a legend, the renderer's. */
  const ROW = 18
  /** The size of the font of a legend entry, the renderer's. */
  const SMALL_FONT = 11

  /**
   * The figure of the urine panel of a renal page with its study series drawn.
   *
   * The height is the one the element gives a figure of this width, so the
   * sweeps below are the figures a host shows and not sizes made up for them.
   */
  function urine(width: number, yLabel: string, height?: number): PlotSpec {
    const grid = Array.from({ length: 50 }, (_, index) => (index * 1440) / 49)
    return {
      x: grid,
      xLabel: 'time [min]',
      yLabel,
      series: [
        {
          id: 'curve1',
          label: 'urine',
          unit: 'µmol',
          scale: 'linear',
          values: grid.map((at) => at / 30),
        },
      ],
      width,
      height: height ?? Math.round(Math.min(420, Math.max(200, width * 0.6))),
      logY: false,
      declaredLegends: [['Beermann 1976']],
      points: [{ id: 's0', label: 'Beermann 1976', curve: 'curve1', x: [720], y: [10] }],
    }
  }

  /** The pixel every row of the legend below the plot is centred on, in their order. */
  function bandRows(svg: string): number[] {
    const band = /<g class="legend below"[\s\S]*$/.exec(svg)?.[0] ?? ''
    const ys = [...band.matchAll(/<text [^>]*\sy="([^"]*)"/g)].map((one) => Number(one[1]))
    return [...new Set(ys)]
  }

  /**
   * What is wrong with the band of a figure whose every declared series is drawn.
   *
   * The rows the layout reserves end at the padding of the figure, so a band
   * of as many rows as it reserved has its last row centred half a row above
   * that padding; a row which is drawn and was not reserved is below it, and
   * the glyphs of a row reach half a font size either side of its centre.
   */
  function bandProblem(figure: PlotSpec): string | null {
    const rows = bandRows(plotSvg(figure))
    const last = rows.at(-1)
    if (last === undefined) {
      return null
    }
    const height = figure.height
    if (last !== height - PAD - ROW / 2 || last + SMALL_FONT / 2 > height) {
      return `${String(figure.width)}x${String(height)} ${figure.yLabel}: rows at ${rows.join(', ')}`
    }
    return null
  }

  it('reserves the rows it draws at the size where it once drew one more', () => {
    // the urine panel at 255 px: the label of the y axis wraps, which narrows
    // the plot, and the row of `urine` and `Beermann 1976` which fits a room
    // counted without that does not fit the plot it is drawn under
    const figure = urine(255, 'amount in urine', 200)
    const rows = bandRows(plotSvg(figure))
    expect(rows.length).toBeGreaterThan(0)
    expect(bandProblem(figure)).toBeNull()
    expect((rows.at(-1) ?? 0) + SMALL_FONT / 2).toBeLessThanOrEqual(200)
  })

  /** The sweeps of the band, one per y label and half of the widths 220 to 1400 px. */
  const BAND_SWEEPS = ['amount', 'amount in urine'].flatMap((yLabel) =>
    [
      [220, 810],
      [811, 1400],
    ].map(([from = 0, to = 0]) => ({ yLabel, from, to })),
  )
  /** The figures of each sweep which drew a band, which the last test reads. */
  const banded: number[] = []

  it.each(BAND_SWEEPS)(
    'reserves the rows it draws at every size, $yLabel, $from to $to px',
    ({ yLabel, from, to }) => {
      // the rows are counted against the width of the plot box the fit returns,
      // which is the width they are drawn into, so the band and its rows are one
      // measurement and no estimate of the margins can open a gap between them
      const problems: string[] = []
      let count = 0
      for (let width = from; width <= to; width += 1) {
        for (const height of new Set([urine(width, yLabel).height, 200])) {
          const figure = urine(width, yLabel, height)
          count += bandRows(plotSvg(figure)).length > 0 ? 1 : 0
          const problem = bandProblem(figure)
          if (problem !== null) {
            problems.push(problem)
          }
        }
      }
      banded.push(count)
      expect(problems).toEqual([])
    },
    SWEEP_TIMEOUT,
  )

  it('draws a band for many figures of the sweeps', () => {
    // a sweep which never draws a band checks nothing of its rows
    expect(banded).toHaveLength(BAND_SWEEPS.length)
    expect(banded.reduce((sum, one) => sum + one, 0)).toBeGreaterThan(1000)
  })
})

describe('the fit of the margins', () => {
  /** The padding of a figure, the renderer's. */
  const PAD = 8
  /** The size of the font of a tick label, the renderer's. */
  const SMALL_FONT = 11
  /** What the two decimals of a coordinate of the figure may round a pixel by. */
  const WRITTEN = 0.005

  /** The ranges of x a figure is swept over: short and long labels, both signs. */
  const RANGES: [number, number][] = [
    [0, 3],
    [0, 1440],
    [0, 15000],
    [0, 150000],
    [-170000, 0],
    [0, 1e-4],
    [0, 0.75],
    [-1500, 1500],
    [0, 2880],
    [1e6, 1.2e6],
  ]

  /** A figure over a range, with a band of a curve and a study series or a curve alone. */
  function figure(
    range: [number, number],
    width: number,
    height: number,
    yLabel: string,
    study: boolean,
  ): PlotSpec {
    const [low, high] = range
    const grid = Array.from({ length: 50 }, (_, index) => low + ((high - low) * index) / 49)
    const curve = {
      ...series(
        1,
        grid.map((_, index) => index),
      ),
      label: 'urine',
    }
    const base = spec(1, { x: grid, xLabel: 'time [min]', yLabel, width, height, series: [curve] })
    return study
      ? {
          ...base,
          declaredLegends: [['Beermann 1976']],
          points: [
            { id: 's0', label: 'Beermann 1976', curve: 'curve1', x: [grid[25] ?? 0], y: [1] },
          ],
        }
      : base
  }

  /** The pixels every tick label of the x axis spans. */
  function xTickSpans(
    svg: string,
    measure: TextMeasure = tableMeasure,
  ): { from: number; to: number }[] {
    const axis = svg.split('<g class="axis ')[1] ?? ''
    const group = axis.split('<g class="data"')[0] ?? ''
    return tickTexts(group).map((one) => spanOf(one.attributes, one.label, measure, SMALL_FONT))
  }

  /** The pixel the column of a legend beside the plot starts at, the figure without one. */
  function columnStart(svg: string): number {
    if (svg.includes('class="legend below"') || !svg.includes('class="legend"')) {
      return Number.POSITIVE_INFINITY
    }
    const found = /<g class="legend"[\s\S]*?<line class="swatch" [^>]*\sx1="([^"]*)"/.exec(svg)
    return Number(found?.[1] ?? Number.NaN)
  }

  /** The sweeps of the fit, one per measure and range of x, each within `SWEEP_TIMEOUT`. */
  const FIT_SWEEPS = [tableMeasure, chromeLike].flatMap((measure) =>
    RANGES.map((range) => ({ measure, range, label: `${measure.name} ${String(range)}` })),
  )
  /** The most passes a figure of each sweep took, which the last test reads. */
  const passes: number[] = []

  it.each(FIT_SWEEPS)(
    'ends on a pass which measured the box it returns, within its bound, $label',
    ({ measure, range }) => {
      // the fit ends on the first pass which asks for nothing, so the tick labels
      // of the box it returns are inside the room of the plot to the rounding of
      // the written coordinates: inside the padding of the figure, where nothing
      // is right of the plot, and left of the column of a legend beside it. A
      // width is a constant of its text for the measure of a fit, so the fit
      // settles whatever the measure is, which the table and the widths of
      // Chrome both show
      const problems: string[] = []
      let most = 0
      for (let width = 200; width <= 1600; width += 13) {
        for (const height of [120, 200, 300]) {
          for (const yLabel of ['amount', 'amount in urine']) {
            for (const study of [false, true]) {
              const one = { ...figure(range, width, height, yLabel, study), measure }
              const svg = plotSvg(one)
              const name = `${measure.name} ${String(range)} ${String(width)}x${String(height)} ${yLabel}`
              for (const fit of marginFits(one)) {
                most = Math.max(most, fit.passes)
                if (!fit.settled) {
                  problems.push(`${name}: unsettled after ${String(fit.passes)} passes`)
                }
              }
              const right = Math.min(width - PAD, columnStart(svg))
              for (const span of xTickSpans(svg, measure)) {
                if (span.from < PAD - WRITTEN || span.to > right + WRITTEN) {
                  problems.push(`${name}: a tick label at ${String(span.from)}..${String(span.to)}`)
                }
              }
            }
          }
        }
      }
      passes.push(most)
      expect(problems).toEqual([])
    },
    SWEEP_TIMEOUT,
  )

  it('takes more than one pass for some figure of the sweeps', () => {
    // a fit which never takes a second pass checks nothing of the passes
    expect(passes).toHaveLength(FIT_SWEEPS.length)
    expect(Math.max(...passes)).toBeGreaterThan(1)
  })
})

describe('the room the y tick labels keep', () => {
  /** The padding of a figure, the renderer's. */
  const PAD = 8
  /** The size of the font of a tick label and of an axis label, the renderer's. */
  const SMALL_FONT = 11
  const LABEL_FONT = 12

  /** A figure whose y axis covers `low..high`, over a grid of four x. */
  function valued(low: number, high: number, more: Partial<PlotSpec> = {}): PlotSpec {
    const values = [low, low + (high - low) / 3, low + (2 * (high - low)) / 3, high]
    return spec(1, { series: [{ ...series(1, values), label: 'urine' }], ...more })
  }

  /** The pixel every y tick label starts at, its right end less its estimated width. */
  function yTickStarts(svg: string, measure: TextMeasure = tableMeasure): number[] {
    const axis = (svg.split('<g class="axis ')[2] ?? '').split('<g class="data"')[0] ?? ''
    return tickTexts(axis).map((one) => spanOf(one.attributes, one.label, measure, SMALL_FONT).from)
  }

  /** The pixel the glyphs of the last line of the y label end at. */
  function labelEnd(svg: string): number {
    const axis = (svg.split('<g class="axis ')[2] ?? '').split('<g class="data"')[0] ?? ''
    const xs = [...axis.matchAll(/<text class="axis-label"[^>]*\sx="([^"]*)"/g)].map((one) =>
      Number(one[1]),
    )
    return Math.max(...xs) + LABEL_FONT
  }

  /** The ranges of the y axis swept: one character to a seven character exponent. */
  const RANGES: [number, number][] = [
    [0, 3],
    [0, 1.2e-4],
    [0, 0.0012],
    [0, 150000],
    [-170000, 0],
    [0, 1440],
  ]

  /** A font a third wider than the table. */
  function wide(text: string, size: number): number {
    return tableMeasure(text, size) * 1.3
  }

  /** The sweeps of the y tick labels, one per range of y. */
  const TICK_SWEEPS = RANGES.map(([low, high]) => ({
    low,
    high,
    label: `${String(low)}..${String(high)}`,
  }))

  it.each(TICK_SWEEPS)(
    'keeps every y tick label inside the figure and clear of the label of its axis, $label',
    ({ low, high }) => {
      // a y tick label is written right-aligned left of the plot and the lines of
      // the y label run from the left edge of the figure: the left margin grows by
      // what the widest tick label needs beyond the lines, as the right margin
      // grows by what the last x tick label needs, by the widths of the measure,
      // which a font a third wider than the table shows
      const problems: string[] = []
      for (const measure of [tableMeasure, wide]) {
        for (const yLabel of ['amount', 'amount in urine of a long name']) {
          for (let width = 240; width <= 1500; width += 7) {
            for (const height of [160, 300]) {
              const svg = plotSvg({ ...valued(low, high, { width, height, yLabel }), measure })
              const clear = Math.max(labelEnd(svg), PAD)
              for (const start of yTickStarts(svg, measure)) {
                if (start < clear - 0.005) {
                  problems.push(
                    `${measure.name} ${String(high)} ${String(width)}x${String(height)} ${yLabel}: ${String(start)} < ${String(clear)}`,
                  )
                }
              }
            }
          }
        }
      }
      expect(problems).toEqual([])
    },
    SWEEP_TIMEOUT,
  )

  it('moves the left edge for its labels and leaves the right one where it was', () => {
    // the two sides are counted apart: a wide y tick label moves where the plot
    // starts and never where it ends
    const wide = plotGeometry(valued(-170000, 0, { width: 600 })).box
    const narrow = plotGeometry(valued(0, 4, { width: 600 })).box
    expect(wide.x0).toBeGreaterThan(narrow.x0)
    expect(wide.x1).toBe(narrow.x1)
  })

  it('leaves the margins of the layout where its labels fit', () => {
    // two characters and five characters both fit the room `LEFT` leaves beside
    // one line of the y label, so neither figure moves
    expect(plotGeometry(valued(0, 40)).box).toEqual(plotGeometry(valued(0, 4)).box)
    expect(plotGeometry(valued(0, 0.004)).box).toEqual(plotGeometry(valued(0, 4)).box)
  })
})

describe('the column beside the plot', () => {
  it('stays where the layout gave it its room when the last tick label narrows the plot', () => {
    // a plot whose last x tick label needs room ends before the column, and the
    // label reaches past the end of the plot towards it: the column holds still
    // and the label ends a gap before it. Over 0..143000 the last tick, 1.5e+5,
    // sits a pixel inside the end of the axis and half its label beyond it
    const grid = Array.from({ length: 50 }, (_, index) => (index * 143000) / 49)
    const figure = columnLegend([], { x: grid, width: 480, height: 400 })
    const svg = plotSvg(figure)
    expect(svg).not.toContain('class="legend below"')
    const swatch = Number(
      /<g class="legend"[\s\S]*?<line class="swatch" [^>]*\sx1="([^"]*)"/.exec(svg)?.[1],
    )
    const axis = svg.split('<g class="axis ')[1] ?? ''
    const ends = tickTexts(axis).map(
      (one) => spanOf(one.attributes, one.label, tableMeasure, 11).to,
    )
    const box = plotGeometry(figure).box
    // the plot was narrowed for its last label, which reaches past its end
    expect(Math.max(...ends)).toBeGreaterThan(box.x1 + 12)
    expect(Math.max(...ends) + 12).toBeLessThanOrEqual(swatch + 0.005)
  })
})

describe('a row of the band below the plot', () => {
  it('is centred by the swatch, its gap and its label, with nothing after the label', () => {
    // a row is centred on the plot as the label of the x axis is: the width it
    // is centred by ends where its last label ends, so a row of one entry has
    // its swatch and its label at the same distance from the two ends of the plot
    const figure = spec(1, { width: 390, series: [{ ...series(1), label: 'urine' }] })
    const svg = plotSvg(figure)
    expect(svg).toContain('class="legend below"')
    const start = Number(/<line class="swatch" [^>]*\sx1="([^"]*)"/.exec(svg)?.[1])
    const end = start + 18 + 6 + tableMeasure('urine', 11)
    const box = plotGeometry(figure).box
    expect(Math.abs((start + end) / 2 - (box.x0 + box.x1) / 2)).toBeLessThan(0.01)
  })
})

describe('the measure of the text', () => {
  /** One entry of the band below the plot: where its swatch starts and its text. */
  interface BandEntry {
    /** The pixel its swatch starts at. */
    start: number
    /** The pixel its label starts at. */
    at: number
    /** The pixel its row is centred on. */
    row: number
    /** Its label as it is written. */
    label: string
  }

  /** The entries of the band below the plot, in their order. */
  function bandEntries(svg: string): BandEntry[] {
    const band = /<g class="legend below"[\s\S]*$/.exec(svg)?.[0] ?? ''
    // the swatch of a curve is a line and the one of a study a marker, so an
    // entry starts the swatch and its gap before its label
    return [
      ...band.matchAll(
        /<g class="legend-entry"[^>]*>(?:(?!<\/g>).)*?<text x="([^"]*)" y="([^"]*)"[^>]*>([^<]*)<\/text><\/g>/g,
      ),
    ].map((one) => ({
      start: Number(one[1]) - 18 - 6,
      at: Number(one[1]),
      row: Number(one[2]),
      label: one[3] ?? '',
    }))
  }

  /** The labels of the band below the plot, row by row. */
  function bandRows(svg: string): string[][] {
    const rows = new Map<number, string[]>()
    for (const entry of bandEntries(svg)) {
      rows.set(entry.row, [...(rows.get(entry.row) ?? []), entry.label])
    }
    return [...rows.values()]
  }

  /**
   * Pack labels into rows of a width, as a reader would with a ruler.
   *
   * An entry is its swatch, the gap after it and its label, and two entries of
   * a row are a column gap apart; the widths are the measure's.
   */
  function packed(labels: string[], room: number, measure: TextMeasure): string[][] {
    const rows: string[][] = []
    let row: string[] = []
    let used = 0
    for (const label of labels) {
      const needed = 18 + 6 + measure(label, 11)
      if (row.length > 0 && used + 12 + needed > room + 1e-9) {
        rows.push(row)
        row = []
        used = 0
      }
      used += used === 0 ? needed : 12 + needed
      row.push(label)
    }
    return row.length > 0 ? [...rows, row] : rows
  }

  /** The labels of the study series of `urine`. */
  const STUDIES = ['Beermann 1976 (5 mg, oral)', 'Frost 2015, young', 'Frost 2015, elderly']

  /** A figure of a curve and three study series under it, every one of them drawn. */
  function urine(width: number, height = 200): PlotSpec {
    return {
      ...spec(1, { width, height, yLabel: 'amount in urine' }),
      series: [{ ...series(1), label: 'urine', unit: 'umol' }],
      declaredLegends: [STUDIES],
      points: STUDIES.map((label, index) => ({
        id: `study${String(index)}`,
        label,
        curve: 'curve1',
        x: [1],
        y: [2],
      })),
    }
  }

  /** A figure of a curve and one study of a label longer than a row of a phone. */
  function longStudy(width: number): PlotSpec {
    const label = 'a study of a long name, 5 mg oral, healthy volunteers'
    return {
      ...urine(width),
      declaredLegends: [[label]],
      points: [{ id: 'study0', label, curve: 'curve1', x: [1], y: [2] }],
    }
  }

  it('keeps one exact table where a spec carries no measure', () => {
    // the advances of Arial: the table is the same on every machine and pins
    // the figures of the tests, and a character it lacks is a digit wide
    expect(tableMeasure('anti-Xa activity', 12)).toBe(78.029296875)
    expect(tableMeasure('1.5e+5', 11)).toBe(33.95068359375)
    expect(tableMeasure('一', 11)).toBe(tableMeasure('0', 11))
    expect(tableMeasure('', 11)).toBe(0)
  })

  it('gives one spec two geometries under two measures', () => {
    const narrow = (text: string, size: number): number => tableMeasure(text, size) * 0.7
    const wide = (text: string, size: number): number => tableMeasure(text, size) * 1.4
    const boxes = [narrow, tableMeasure, wide].map(
      (measure) => plotGeometry({ ...urine(316), measure }).box,
    )
    expect(boxes[0]).not.toEqual(boxes[1])
    expect(boxes[1]).not.toEqual(boxes[2])
    // a wider font needs more room for the lines of its labels
    expect(boxes[2]?.x0 ?? 0).toBeGreaterThan(boxes[0]?.x0 ?? 0)
  })

  it('wraps a label by the measure and not by a guess of its characters', () => {
    // the same label at the same size reads whole under the widths of Chrome
    // and is cut under the old guess, and a measure twice as wide wraps the x
    // label which one line holds in the table
    const label = 'time after the first dose [h]'
    const lines = (measure: TextMeasure): string[] => {
      const svg = plotSvg({ ...spec(1, { xLabel: label, width: 260, height: 200 }), measure })
      const axis = (svg.split('<g class="axis ')[1] ?? '').split('<g class="data"')[0] ?? ''
      return [...axis.matchAll(/<text class="axis-label"[^>]*>([^<]*)<\/text>/g)].map(
        (one) => one[1] ?? '',
      )
    }
    expect(lines(tableMeasure)).toEqual([label])
    expect(lines((text, size) => tableMeasure(text, size) * 2)).toEqual([
      'time after the',
      'first dose [h]',
    ])
  })

  it('packs the rows of the band by the measure', () => {
    // every row of the band is the labels packed into the width of the plot by
    // the widths of the measure, and the measures pack them differently
    const counts = new Set<string>()
    for (const measure of [tableMeasure, chromeLike, estimate]) {
      for (let width = 220; width <= 700; width += 4) {
        const figure = { ...urine(width), measure }
        const svg = plotSvg(figure)
        if (!svg.includes('class="legend below"')) {
          continue
        }
        const box = plotGeometry(figure).box
        const labels = ['urine', ...STUDIES]
        const expected = packed(labels, box.x1 - box.x0, measure)
        // a label too long for its row is cut where it is written, so the rows
        // are compared by the start of what is written
        const drawn = bandRows(svg).map((row) => row.map((one) => one.replace('…', '')))
        expect({ measure: measure.name, width, rows: drawn.map((row) => row.length) }).toEqual({
          measure: measure.name,
          width,
          rows: expected.map((row) => row.length),
        })
        counts.add(`${measure.name} ${String(width)} ${String(expected.length)}`)
      }
    }
    const byWidth = (name: string): string[] =>
      [...counts].filter((one) => one.startsWith(`${name} `)).map((one) => one.slice(name.length))
    expect(byWidth('tableMeasure')).not.toEqual(byWidth('estimate'))
  })

  it('centres every row of the band on the plot to half a pixel by the drawn widths', () => {
    // a row is centred by the widths of the measure, so a measure which is the
    // one of the font a reader sees puts the row where it looks centred: here
    // the widths of Chrome, at the figures the element draws at 255, 316, 390
    // and 1280 px and every width between; a row whose label is cut is
    // centred by what is written of it
    const problems: string[] = []
    let rows = 0
    let cut = 0
    for (const make of [urine, antiXa, longStudy]) {
      for (const width of [
        220,
        242,
        316,
        550,
        ...Array.from({ length: 120 }, (_, i) => 230 + 4 * i),
      ]) {
        const figure = { ...make(width), measure: chromeLike }
        const svg = plotSvg(figure)
        const box = plotGeometry(figure).box
        const byRow = new Map<number, BandEntry[]>()
        for (const entry of bandEntries(svg)) {
          byRow.set(entry.row, [...(byRow.get(entry.row) ?? []), entry])
        }
        for (const entries of byRow.values()) {
          const first = entries[0]
          const last = entries.at(-1)
          if (first === undefined || last === undefined) {
            continue
          }
          const end = last.at + chromeLike(last.label, 11)
          rows += 1
          cut += last.label.endsWith('\u2026') ? 1 : 0
          const offset = (first.start + end) / 2 - (box.x0 + box.x1) / 2
          if (Math.abs(offset) > 0.5) {
            problems.push(`${make.name} ${String(width)}: ${String(offset)}`)
          }
        }
      }
    }
    expect(rows).toBeGreaterThan(200)
    expect(cut).toBeGreaterThan(10)
    expect(problems).toEqual([])
  })

  it('takes a width the measure cannot give from the table', () => {
    // a measure which fails on a text puts no NaN into the figure: that text
    // is measured with the table, which here is every text
    const broken = (): number => Number.NaN
    const negative = (): number => -5
    for (const measure of [broken, negative]) {
      const svg = plotSvg({ ...urine(316), measure })
      expect(svg).not.toContain('NaN')
      expect(svg).toBe(plotSvg(urine(316)))
    }
  })
  it('gives the column beside the plot the width of its widest label by the measure', () => {
    // the column is the gap, the swatch, its gap and the widest label, so the
    // plot ends where that column starts, by whichever measure the spec carries
    const wide = (text: string, size: number): number => tableMeasure(text, size) * 1.3
    for (const measure of [tableMeasure, chromeLike, wide]) {
      const figure = { ...spec(3, { width: 1100, height: 160 }), measure }
      const svg = plotSvg(figure)
      expect(svg).not.toContain('class="legend below"')
      const widest = Math.max(...figure.series.map((one) => measure(one.label, 11)))
      expect({ measure: measure.name, right: plotGeometry(figure).box.x1 }).toEqual({
        measure: measure.name,
        right: 1100 - 8 - (12 + 18 + 6 + widest),
      })
    }
  })

  it('cuts a label which its row does not hold so that it ends inside the plot, ellipsis and all', () => {
    // a label longer than the whole row is written from where its row starts,
    // and what is written of it, the ellipsis included, ends where the plot ends
    let cut = 0
    for (let width = 200; width <= 260; width += 1) {
      const figure = { ...longStudy(width), measure: chromeLike }
      const box = plotGeometry(figure).box
      for (const entry of bandEntries(plotSvg(figure))) {
        if (entry.label.endsWith('\u2026')) {
          cut += 1
          expect({ width, end: entry.at + chromeLike(entry.label, 11) <= box.x1 + 0.01 }).toEqual({
            width,
            end: true,
          })
        }
      }
    }
    expect(cut).toBeGreaterThan(10)
  })
})

describe('the choice of the legend', () => {
  /** The labels of three studies, the anti-Xa panel's. */
  const STUDIES = ['Frost 2021', 'Frost 2015, young', 'Frost 2015, elderly']
  /** The labels of five arms of one study, drawn together. */
  const ARMS = [
    'Frost 2013, 2.5 mg',
    'Frost 2013, 5 mg',
    'Frost 2013, 10 mg',
    'Frost 2013, 25 mg',
    'Frost 2013, 50 mg',
  ]

  /** A figure over `x` whose y axis covers `low..high`, with the studies declared. */
  function figure(
    width: number,
    height: number,
    x: [number, number],
    y: [number, number],
    studies: string[],
  ): PlotSpec {
    const grid = Array.from({ length: 50 }, (_, index) => x[0] + ((x[1] - x[0]) * index) / 49)
    const values = grid.map((_, index) => y[0] + ((y[1] - y[0]) * index) / 49)
    return {
      ...spec(1, { x: grid, width, height, yLabel: 'amount', xLabel: 'time [min]' }),
      series: [{ ...series(1, values), label: 'curve' }],
      ...(studies.length > 0 ? { declaredLegends: [studies] } : {}),
    }
  }

  /** The area of the plot box a figure draws. */
  function drawnArea(one: PlotSpec): number {
    const box = plotGeometry(one).box
    return (box.x1 - box.x0) * (box.y1 - box.y0)
  }

  /** The sweeps of the choice of the box, one per range of y. */
  const BOX_SWEEPS = (
    [
      [0, 3],
      [-170000, 0],
      [0, 150000],
    ] as [number, number][]
  ).map((y) => ({ y, label: `${String(y[0])}..${String(y[1])}` }))
  /** The figures of each sweep whose band took more than 35 % of the height. */
  const tall: number[] = []

  it.each(BOX_SWEEPS)(
    'draws the larger of the boxes it can draw and follows no other rule, $label',
    ({ y }) => {
      // the larger of two boxes loses no more plot to a change of the content
      // than the layout which loses more, so one row more never halves a plot,
      // which a cap on the share of the height a band takes did: it threw away a
      // band which still left the larger plot
      const problems: string[] = []
      let count = 0
      for (const studies of [[], ['Beermann 1976'], STUDIES, ARMS]) {
        for (let width = 220; width <= 700; width += 3) {
          for (const height of [120, 200, 300]) {
            const one = { ...figure(width, height, [0, 143000], y, studies), measure: chromeLike }
            const fits = marginFits(one)
            const best = Math.max(...fits.filter((fit) => fit.candidate).map((fit) => fit.area))
            if (Math.abs(drawnArea(one) - best) > 1e-6) {
              problems.push(
                `${String(y)} ${String(studies.length)} ${String(width)}x${String(height)}`,
              )
            }
            // the rows a band reserves are the height between the room of the x
            // axis, one line of its label here, and the plot
            const band = height - 42 - plotGeometry(one).box.y1
            count += plotSvg(one).includes('class="legend below"') && band > 0.35 * height ? 1 : 0
          }
        }
      }
      tall.push(count)
      expect(problems).toEqual([])
    },
    SWEEP_TIMEOUT,
  )

  it('draws bands which a cap of 35 % of the height refused in the sweeps', () => {
    // a sweep without such a band checks nothing of the cap it replaced
    expect(tall).toHaveLength(BOX_SWEEPS.length)
    expect(tall.reduce((sum, one) => sum + one, 0)).toBeGreaterThan(0)
  })

  it('keeps the band of a narrow figure whose y tick labels grow by a character', () => {
    // a seven character y tick label (`-1.5e+5`) moves the plot right, and the
    // band of the five arms of a study takes six rows, which is more than a
    // third of the height and still the larger plot: the band stays, where a
    // cap on its share put the legend beside a plot of less area
    for (const width of [229, 232, 235]) {
      for (const y of [
        [0, 3],
        [-170000, 0],
      ] as [number, number][]) {
        const one = { ...figure(width, 300, [0, 143000], y, ARMS), measure: chromeLike }
        expect({ width, y, below: plotSvg(one).includes('class="legend below"') }).toEqual({
          width,
          y,
          below: true,
        })
      }
    }
  })
})

describe('the sizes the text is drawn in', () => {
  /** The padding of a figure, the renderer's. */
  const PAD = 8
  /** The sizes a host sets the tokens of the figure to. */
  const SIZES = { label: 16, small: 14 }

  /** A figure of a curve over minutes with a band of studies, in the sizes given. */
  function sized(width: number, studies: string[], measure: TextMeasure): PlotSpec {
    const grid = Array.from({ length: 50 }, (_, index) => (index * 1440) / 49)
    return {
      ...spec(1, {
        x: grid,
        width,
        height: Math.round(Math.min(420, Math.max(200, width * 0.6))),
        xLabel: 'time (min)',
        yLabel: 'plasma concentration',
      }),
      series: [
        {
          ...series(
            1,
            grid.map((at) => at / 30),
          ),
          label: 'plasma',
          unit: 'uM',
        },
      ],
      declaredLegends: [studies],
      points: studies.map((label, index) => ({
        id: `study${String(index)}`,
        label,
        curve: 'curve1',
        x: [720],
        y: [10],
      })),
      fontSizes: SIZES,
      measure,
    }
  }

  /** The text elements of a group of the figure, with their attributes. */
  function textsOf(group: string): { attributes: string; text: string }[] {
    return [...group.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)].map((one) => ({
      attributes: one[1] ?? '',
      text: one[2] ?? '',
    }))
  }

  /** Read a number attribute of a text element. */
  function attribute(attributes: string, name: string): number {
    return Number(new RegExp(`\\s${name}="([^"]*)"`).exec(attributes)?.[1] ?? Number.NaN)
  }

  it('keeps every text inside the figure and clear of its neighbours in the sizes of a host', () => {
    // a host which sets the size tokens draws the figure in 16 and 14 px: the
    // widths are measured at those sizes and every line, row and margin which
    // holds text is as tall as its font, so nothing leaves the figure, no row
    // of the band passes the end of the plot, the x label stays below the x
    // tick labels and the lines of the y label do not overlap
    const problems: string[] = []
    for (const measure of [tableMeasure, chromeLike]) {
      for (const studies of [
        [],
        ['Beermann 1976 (5 mg, oral)'],
        ['Frost 2021', 'Frost 2015, young'],
      ]) {
        for (let width = 220; width <= 700; width += 7) {
          const figure = sized(width, studies, measure)
          const svg = plotSvg(figure)
          const box = plotGeometry(figure).box
          const name = `${measure.name} ${String(studies.length)} ${String(width)}`
          const [, xAxis = '', rest = ''] = svg.split('<g class="axis ')
          const yAxis = rest.split('<g class="data"')[0] ?? ''
          const band = /<g class="legend below"[\s\S]*$/.exec(svg)?.[0] ?? ''
          // a tick label stays inside the padding, a line of the label inside the figure
          for (const one of textsOf(xAxis)) {
            const x = attribute(one.attributes, 'x')
            const label = one.attributes.includes('axis-label')
            const drawn = spanOf(
              one.attributes,
              one.text,
              measure,
              label ? SIZES.label : SIZES.small,
            )
            const edge = label ? 0 : PAD
            if (drawn.from < edge - 0.01 || drawn.to > width - edge + 0.01) {
              problems.push(`${name}: x axis text ${one.text} at ${String(x)}`)
            }
          }
          const tickBottom = box.y1 + 4 + 3 + SIZES.small
          for (const one of textsOf(xAxis).filter((t) => t.attributes.includes('axis-label'))) {
            const baseline = attribute(one.attributes, 'y')
            if (
              baseline - 0.75 * SIZES.label < tickBottom ||
              baseline + 0.25 * SIZES.label > figure.height
            ) {
              problems.push(`${name}: x label at ${String(baseline)} below ${String(tickBottom)}`)
            }
          }
          const lines = textsOf(yAxis)
            .filter((t) => t.attributes.includes('axis-label'))
            .map((t) => attribute(t.attributes, 'x'))
          for (const [index, x] of lines.entries()) {
            const next = lines[index + 1]
            if (next !== undefined && next - x < SIZES.label) {
              problems.push(`${name}: y label lines ${String(x)} and ${String(next)}`)
            }
          }
          const labelEnd = Math.max(PAD, ...lines.map((x) => x + SIZES.label))
          for (const one of textsOf(yAxis).filter((t) => !t.attributes.includes('axis-label'))) {
            const start = attribute(one.attributes, 'x') - measure(one.text, SIZES.small)
            if (start < labelEnd - 0.01) {
              problems.push(`${name}: y tick ${one.text} starts at ${String(start)}`)
            }
          }
          for (const one of textsOf(band)) {
            const end = attribute(one.attributes, 'x') + measure(one.text, SIZES.small)
            const row = attribute(one.attributes, 'y')
            if (end > box.x1 + 0.01 || row + SIZES.small / 2 > figure.height) {
              problems.push(
                `${name}: a row of the band ${one.text} ends at ${String(end)}, ${String(row)}`,
              )
            }
          }
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('writes the sizes it was laid out in as the fallbacks of the tokens', () => {
    const svg = plotSvg({ ...pinned(), fontSizes: SIZES })
    expect(svg).toContain('font-size:var(--sbmlsim-font-size, 16px)')
    expect(svg).toContain('font-size:var(--sbmlsim-font-size-small, 14px)')
    expect(svg).not.toContain('12px')
    // a size which is no size is the size of the design
    expect(plotSvg({ ...pinned(), fontSizes: { label: Number.NaN, small: 0 } })).toBe(PINNED)
  })
})

describe('the legends a figure may draw', () => {
  /** A figure of a curve whose study data may draw the legends given. */
  function legends(declared: string[][], width = 316, height = 200): PlotSpec {
    return { ...spec(1, { width, height }), declaredLegends: declared }
  }

  /** Labels two of which do not fit one row of a band at 316 px. */
  const LONG_A = 'Study A 2013, a single oral dose in healthy volunteers'
  const LONG_B = 'Study B 2015, a single oral dose in elderly volunteers'

  it('reserves the rows of the legend which needs the most', () => {
    // the band holds the legend of any state, so it is as tall as the one of
    // the most rows, whichever order the legends come in
    const most = plotGeometry(legends([[LONG_A, LONG_B]])).box
    expect(plotGeometry(legends([['short'], [LONG_A, LONG_B]])).box).toEqual(most)
    expect(plotGeometry(legends([[LONG_A, LONG_B], ['short']])).box).toEqual(most)
    // and not the rows of every label at once, which no state draws
    expect(plotGeometry(legends([[LONG_A], [LONG_B]])).box).toEqual(
      plotGeometry(legends([[LONG_A]])).box,
    )
    expect(plotGeometry(legends([[LONG_A], [LONG_B]])).box.y1).toBeGreaterThan(most.y1)
  })

  it('reserves the rows of the legend it draws whatever a caller declares', () => {
    // the legend drawn now is laid out with the declared ones, so a caller
    // which declares less than it draws gets a band of the rows it draws
    const drawn = {
      ...legends([['short']]),
      points: [LONG_A, LONG_B].map((label, index) => ({
        id: `study${String(index)}`,
        label,
        curve: 'curve1',
        x: [1],
        y: [2],
      })),
    }
    const declared = { ...drawn, declaredLegends: [[LONG_A, LONG_B]] }
    expect(plotGeometry(drawn).box).toEqual(plotGeometry(declared).box)
  })

  it('gives the column the widest label of any legend', () => {
    // a figure wide and short keeps its legend beside the plot, whose column is
    // as wide as the widest label any legend may show, wherever it is listed
    const column = (declared: string[][]): number => {
      const figure = legends(declared, 1100, 110)
      expect(plotSvg(figure)).not.toContain('class="legend below"')
      return plotGeometry(figure).box.x1
    }
    expect(column([[LONG_B.slice(0, 20)], [LONG_A]])).toBe(column([[LONG_A]]))
    expect(column([[LONG_A], [LONG_B.slice(0, 20)]])).toBe(column([[LONG_A]]))
  })
})

describe('the ticks of the x axis', () => {
  /** The sweeps of the gaps, one per measure and span of x. */
  const GAP_SWEEPS = [tableMeasure, chromeLike].flatMap((measure) =>
    [1440, 96, 143000].map((span) => ({ measure, span, label: `${measure.name} ${String(span)}` })),
  )
  /** The figures of each sweep which drew fewer than three ticks, which the last test reads. */
  const fewer: number[] = []

  it.each(GAP_SWEEPS)(
    'keeps a gap between the labels of neighbouring ticks however narrow the plot, $label',
    ({ measure, span }) => {
      // an axis asks for fewer ticks until its measured labels keep their gap, so
      // a plot beside a legend at the width of a phone writes no two labels into
      // each other, falling to two ticks or one where that is all it holds
      const problems: string[] = []
      let count = 0
      for (const declared of [
        [],
        [['Beermann 1976 (5 mg, oral)']],
        [['Frost 2021', 'Frost 2015, young', 'Frost 2015, elderly']],
      ]) {
        for (let at = 0; at < 2 * 394; at += 1) {
          // every width at the height the element gives it and at 120 px
          const width = 220 + 3 * Math.floor(at / 2)
          const height =
            at % 2 === 0 ? (width < 300 ? 200 : Math.round(Math.min(420, width * 0.6))) : 120
          const grid = Array.from({ length: 50 }, (_, index) => (span * index) / 49)
          const svg = plotSvg({
            ...spec(1, { x: grid, width, height }),
            declaredLegends: declared,
            measure,
          })
          const axis = (svg.split('<g class="axis ')[1] ?? '').split('<g class="data"')[0] ?? ''
          const spans = tickTexts(axis).map((one) => spanOf(one.attributes, one.label, measure, 11))
          count += spans.length < 3 ? 1 : 0
          for (const [index, one] of spans.entries()) {
            const next = spans[index + 1]
            if (next !== undefined && next.from - one.to < 6 - 0.01) {
              problems.push(
                `${measure.name} ${String(span)} ${String(width)}: ${String(next.from - one.to)}`,
              )
            }
          }
        }
      }
      fewer.push(count)
      expect(problems).toEqual([])
    },
    SWEEP_TIMEOUT,
  )

  it('falls to fewer than three ticks for some figure of the sweeps', () => {
    // a sweep which never thins an axis checks nothing of the thinning
    expect(fewer).toHaveLength(GAP_SWEEPS.length)
    expect(fewer.reduce((sum, one) => sum + one, 0)).toBeGreaterThan(0)
  })
})

describe('a band which cannot be drawn', () => {
  it('is no layout of a figure whose rows and wrapped x label leave no plot', () => {
    // the rows of a band and the lines of a wrapped x label are both below the
    // plot, so a band is drawn only where both leave the plot its least height;
    // where they do not, the legend stays beside the plot and no row is drawn
    // over the x label or out of the figure
    const problems: string[] = []
    let beside = 0
    for (let width = 220; width <= 500; width += 2) {
      for (const count of [2, 3, 4]) {
        const labels = Array.from({ length: count }, (_, index) => `Study ${String(index)} 2001`)
        const figure: PlotSpec = {
          ...spec(1, {
            width,
            height: 120,
            xLabel: 'time after the first dose of the drug, in hours [h]',
          }),
          declaredLegends: [labels],
          points: labels.map((label, index) => ({
            id: `study${String(index)}`,
            label,
            curve: 'curve1',
            x: [1],
            y: [2],
          })),
        }
        const svg = plotSvg(figure)
        if (!svg.includes('class="legend below"')) {
          beside += 1
          continue
        }
        const baselines = [
          ...svg.matchAll(/<text class="axis-label"[^>]*\sy="([^"]*)" text-anchor="middle">/g),
        ].map((one) => Number(one[1]))
        const rows = [
          ...(/<g class="legend below"[\s\S]*$/.exec(svg)?.[0] ?? '').matchAll(
            /<text [^>]*\sy="([^"]*)"/g,
          ),
        ].map((one) => Number(one[1]))
        const top = Math.min(...rows) - 9
        if (top < Math.max(...baselines) || Math.max(...rows) + 5.5 > 120) {
          problems.push(`${String(width)} ${String(count)}: rows ${rows.join(', ')}`)
        }
      }
    }
    expect(problems).toEqual([])
    expect(beside).toBeGreaterThan(0)
  })
})

describe('the box solved for the ticks it draws', () => {
  /** The padding of a figure, the renderer's. */
  const PAD = 8
  /** The sizes a host sets the tokens of the figure to. */
  const LARGE = { label: 16, small: 14 }
  /** The three studies of the anti-Xa panel. */
  const STUDIES = ['Frost 2021', 'Frost 2015, young', 'Frost 2015, elderly']

  /** A figure over `0..span` whose y axis covers `low..high`. */
  function over(
    span: number,
    [low, high]: [number, number],
    width: number,
    height: number,
    more: Partial<PlotSpec> = {},
  ): PlotSpec {
    const grid = Array.from({ length: 50 }, (_, index) => (span * index) / 49)
    const values = grid.map((_, index) => low + ((high - low) * index) / 49)
    return {
      ...spec(1, { x: grid, width, height, xLabel: 'time (min)', yLabel: 'plasma concentration' }),
      series: [{ ...series(1, values), label: 'plasma', unit: 'uM' }],
      ...more,
    }
  }

  /** The room of the plot of a figure: its right end and the pixel its tick labels may reach. */
  function room(svg: string, width: number): number {
    if (svg.includes('class="legend below"') || !svg.includes('class="legend"')) {
      return width - PAD
    }
    // the column starts a gap after the room, and its first label after its swatch
    return Number(/<g class="legend"[\s\S]*?<text x="([^"]*)"/.exec(svg)?.[1]) - 18 - 6 - 12
  }

  /** The pixel the label of the last x tick ends at, by a measure at a size. */
  function lastTickEnd(svg: string, measure: TextMeasure, size: number): number {
    const axis = (svg.split('<g class="axis ')[1] ?? '').split('<g class="data"')[0] ?? ''
    const ends = tickTexts(axis).map((one) => spanOf(one.attributes, one.label, measure, size).to)
    return Math.max(...ends)
  }

  /** The area of the plot box of a figure. */
  function area(figure: PlotSpec): number {
    const box = plotGeometry(figure).box
    return (box.x1 - box.x0) * (box.y1 - box.y0)
  }

  it('ends the plot where the room or its last drawn tick label needs it, and no sooner', () => {
    // a figure of 232 px over 0..143000 in 16 and 14 px drew 0 and 1e+5 and
    // ended its plot 22 px before the room, held there for a 1.5e+5 a pass of
    // the fit had and the figure no longer drew: the box is solved once more
    // for the ticks it draws, so one of the two ends where the other allows
    for (const measure of [tableMeasure, chromeLike]) {
      for (const width of [232, 233, 240, 260, 300]) {
        const figure = { ...over(143000, [0, 3], width, 200, { fontSizes: LARGE }), measure }
        const svg = plotSvg(figure)
        const box = plotGeometry(figure).box
        const edge = room(svg, width)
        const slack = Math.min(edge - box.x1, edge - lastTickEnd(svg, measure, LARGE.small))
        // a tick label starts on a whole pixel, which moves it by half a pixel at
        // most, and the room is solved with that half pixel, so the end binds to
        // within a pixel
        expect({ measure: measure.name, width, slack: slack <= 1.01 }).toEqual({
          measure: measure.name,
          width,
          slack: true,
        })
      }
    }
  })

  it('starts the plot where its drawn y tick labels and the lines of its label need it', () => {
    // the left end only grew in the fit, so a narrower set of y tick labels than
    // an earlier pass had kept the plot further right than they need; it is the
    // widest drawn label, its gaps and the lines of the y label, or the room of
    // one line, whichever is larger
    for (const sizes of [{ label: 12, small: 11 }, LARGE]) {
      for (const [width, height] of [
        [468, 281],
        [482, 289],
        [300, 200],
      ] as [number, number][]) {
        const figure = { ...over(1440, [1e-6, 1.2e-4], width, height), fontSizes: sizes }
        const svg = plotSvg(figure)
        const axis = (svg.split('<g class="axis ')[2] ?? '').split('<g class="data"')[0] ?? ''
        const lines = [...axis.matchAll(/class="axis-label"/g)].length
        const widest = Math.max(
          ...[...axis.matchAll(/<g class="tick">.*?<text[^>]*>([^<]*)<\/text>/g)].map((one) =>
            tableMeasure(one[1] ?? '', sizes.small),
          ),
        )
        const line = sizes.label + 2
        const needed = Math.max(
          64 + (sizes.label - 12) + (lines - 1) * line,
          PAD + lines * line + 3 + widest + 3 + 4,
        )
        expect({ width, x0: plotGeometry(figure).box.x0 }).toEqual({
          width,
          x0: expect.closeTo(needed, 6) as number,
        })
      }
    }
  })

  /** The sweeps of the widths, one per span of x, each in the sizes of a host and the design. */
  const WIDTH_SWEEPS = [1440, 143000, 3].map((span) => ({ span, label: String(span) }))

  it.each(WIDTH_SWEEPS)(
    'never gives a wider figure a smaller plot at a height, in the sizes of a host and the design, $label',
    ({ span }) => {
      // a tick set which a narrow axis thins keeps its first and its last tick,
      // whose labels are the ones which reach past the ends, so a figure which
      // grows into drawing more ticks does not lose the plot their ends cost; and
      // the box is solved for the ticks it draws, so no end of an earlier pass
      // holds it in
      const problems: string[] = []
      for (const sizes of [undefined, LARGE]) {
        for (const declared of [[], [['Beermann 1976 (5 mg, oral)']], [STUDIES]]) {
          let last = 0
          for (let width = 220; width <= 640; width += 1) {
            const figure = {
              ...over(
                span,
                [0, 3],
                width,
                200,
                declared.length > 0 ? { declaredLegends: declared } : {},
              ),
              ...(sizes === undefined ? {} : { fontSizes: sizes }),
            }
            const now = area(figure)
            if (now < last - 1e-6) {
              problems.push(
                `${String(sizes?.label ?? 12)} ${String(span)} ${String(declared.length)} ${String(width)}: ${String(last)} -> ${String(now)}`,
              )
            }
            last = now
          }
        }
      }
      expect(problems).toEqual([])
    },
    SWEEP_TIMEOUT,
  )

  it('gives the figure of three studies at 298 px no smaller plot than at 297 px', () => {
    // the case of the review: three studies, 0..1440, 297 and 298 px
    const at = (width: number): number =>
      area({ ...over(1440, [0, 3], width, 200, { declaredLegends: [STUDIES] }), fontSizes: LARGE })
    expect(at(298)).toBeGreaterThanOrEqual(at(297))
  })

  it('draws the ticks the box was solved for and not the ones of the solved box', () => {
    // at 331 x 300 in 16 and 14 px over 0..96 the fit settles on a box which
    // asks for 0, 50 and 100, and the box is solved for them: it is wider than
    // the box of the fit and would ask for 0 to 100 by 20, whose ends the solve
    // did not see, so the figure draws the ticks it was solved for
    const figure = over(96, [1e-6, 1.2e-4], 331, 300, { fontSizes: LARGE })
    const axis =
      (plotSvg(figure).split('<g class="axis ')[1] ?? '').split('<g class="data"')[0] ?? ''
    const drawn = [...axis.matchAll(/<g class="tick">.*?<text[^>]*>([^<]*)<\/text>/g)].map(
      (one) => one[1],
    )
    expect(drawn).toEqual(['0', '50', '100'])
  })

  it('reserves the rows the band draws under the solved box', () => {
    // the solved box is wider than the box of the fit, where the legend packs
    // into fewer rows: the band is as tall as the rows it draws there
    const label = 'Beermann 1976 (5 mg, oral)'
    const figure = over(1440, [1e-6, 1.2e-4], 370, 300, {
      fontSizes: LARGE,
      declaredLegends: [[label]],
      points: [{ id: 'study0', label, curve: 'curve1', x: [720], y: [1e-4] }],
    })
    const band = /<g class="legend below"[\s\S]*$/.exec(plotSvg(figure))?.[0] ?? ''
    const rows = [
      ...new Set([...band.matchAll(/<text [^>]*\sy="([^"]*)"/g)].map((one) => Number(one[1]))),
    ]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.at(-1)).toBe(300 - PAD - (LARGE.small + 7) / 2)
  })

  it('thins the ticks of a narrow axis to ones which keep its first and its last', () => {
    // 0..143000 asks for 0, 5e+4, 1e+5 and 1.5e+5, whose labels in 14 px do not
    // fit a plot of 120 px: it draws the first and the last of them
    const figure = over(143000, [0, 3], 240, 200, { fontSizes: LARGE })
    const axis =
      (plotSvg(figure).split('<g class="axis ')[1] ?? '').split('<g class="data"')[0] ?? ''
    const drawn = [...axis.matchAll(/<g class="tick">.*?<text[^>]*>([^<]*)<\/text>/g)].map(
      (one) => one[1],
    )
    expect(drawn).toEqual(['0', '1.5e+5'])
  })

  it('draws a layout whose plot keeps its least width where another one is too narrow', () => {
    // in 16 and 14 px a column of four arms leaves a plot narrower than its
    // last tick label needs: that layout is clamped wider and its labels pass
    // the room, so the figure takes the band, which it can draw
    const arms = [
      'Frost 2013, 2.5 mg',
      'Frost 2013, 5 mg',
      'Frost 2013, 10 mg',
      'Frost 2013, 25 mg',
    ]
    const figure = over(143000, [-170000, -1], 220, 200, {
      fontSizes: LARGE,
      declaredLegends: [arms],
      points: arms.map((label, index) => ({
        id: `arm${String(index)}`,
        label,
        curve: 'curve1',
        x: [70000],
        y: [-1],
      })),
    })
    const svg = plotSvg(figure)
    expect(svg).toContain('class="legend below"')
    expect(lastTickEnd(svg, tableMeasure, LARGE.small)).toBeLessThanOrEqual(220 - PAD + 0.01)
    expect(marginFits(figure).map((fit) => fit.candidate)).toEqual([false, true])
  })
})
