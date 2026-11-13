import { describe, expect, it } from 'vitest'

import { marginFits, plotGeometry, plotSvg } from './plot'
import type { PlotSpec, Points, Series } from './plot'

// Every id below is a neutral one: a curve, a series and a knob are data of a
// payload and never of this library, so no model and no entity of a model is
// named here.

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
  (_, index) => `hydrochlorothiazide plasma level ${String(index + 1)}`,
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
 * The figure of a small spec, byte for byte.
 *
 * It is the pin of every caller which hands the renderer nothing but what it
 * draws: a spec without `yLimits` and without `declaredLabels` draws these
 * bytes, so neither field can move the figure of a page which never passes
 * them, and nothing else drifts under them unnoticed either. It is re-taken
 * when the renderer changes its geometry on purpose, which the figure of the
 * change then has to show.
 */
const PINNED = `<svg xmlns="http://www.w3.org/2000/svg" class="sbmlsim-plot" width="240" height="160" viewBox="0 0 240 160" role="img" style="font-family:var(--sbmlsim-font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif);font-size:var(--sbmlsim-font-size, 12px)"><title>value [mM] over time [h]</title><defs><clipPath id="sbmlsim-plot-clip-64-14-232-100"><rect x="64" y="14" width="168" height="86"/></clipPath></defs><rect class="background" x="0" y="0" width="240" height="160" style="fill:var(--sbmlsim-figure-bg, transparent)"/><g class="axis x" style="stroke:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke-width:var(--sbmlsim-axis-width, 1px);fill:none;font-size:var(--sbmlsim-font-size-small, 11px)"><line class="axis-line" x1="64" y1="100" x2="232" y2="100"/><g class="tick"><line x1="71.64" y1="100" x2="71.64" y2="104"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="71.64" y="107" text-anchor="middle" dominant-baseline="hanging">0</text></g><g class="tick"><line x1="122.55" y1="100" x2="122.55" y2="104"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="122.55" y="107" text-anchor="middle" dominant-baseline="hanging">1</text></g><g class="tick"><line x1="173.45" y1="100" x2="173.45" y2="104"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="173.45" y="107" text-anchor="middle" dominant-baseline="hanging">2</text></g><g class="tick"><line x1="224.36" y1="100" x2="224.36" y2="104"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="224.36" y="107" text-anchor="middle" dominant-baseline="hanging">3</text></g><text class="axis-label" style="fill:var(--sbmlsim-fg, rgb(27 31 36));stroke:none;font-size:var(--sbmlsim-font-size, 12px)" x="148" y="131" text-anchor="middle">time [h]</text></g><g class="axis y" style="stroke:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke-width:var(--sbmlsim-axis-width, 1px);fill:none;font-size:var(--sbmlsim-font-size-small, 11px)"><line class="axis-line" x1="64" y1="14" x2="64" y2="100"/><g class="tick"><line x1="60" y1="96.09" x2="64" y2="96.09"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="57" y="96.09" text-anchor="end" dominant-baseline="central">1</text></g><g class="tick"><line x1="60" y1="70.03" x2="64" y2="70.03"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="57" y="70.03" text-anchor="end" dominant-baseline="central">2</text></g><g class="tick"><line x1="60" y1="43.97" x2="64" y2="43.97"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="57" y="43.97" text-anchor="end" dominant-baseline="central">3</text></g><g class="tick"><line x1="60" y1="17.91" x2="64" y2="17.91"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="57" y="17.91" text-anchor="end" dominant-baseline="central">4</text></g><text class="axis-label" style="fill:var(--sbmlsim-fg, rgb(27 31 36));stroke:none;font-size:var(--sbmlsim-font-size, 12px)" x="8" y="57" transform="rotate(-90 8 57)" text-anchor="middle" dominant-baseline="hanging">value [mM]</text></g><g class="data" clip-path="url(#sbmlsim-plot-clip-64-14-232-100)"><path class="curve" data-series="curve1" style="stroke:var(--sbmlsim-ramp-1, rgb(68 1 84));stroke-width:var(--sbmlsim-curve-width, 1.8px);fill:none" d="M71.64 96.09 L122.55 70.03 L173.45 43.97 L224.36 17.91"/></g><g class="legend below" style="fill:var(--sbmlsim-fg, rgb(27 31 36));font-size:var(--sbmlsim-font-size-small, 11px)"><g class="legend-entry" data-series="curve1"><line class="swatch" style="stroke:var(--sbmlsim-ramp-1, rgb(68 1 84));stroke-width:var(--sbmlsim-curve-width, 1.8px)" x1="114.83" y1="143" x2="132.82" y2="143"/><text x="138.82" y="143" dominant-baseline="central">Curve 1</text></g></g></svg>`

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
    const svg = plotSvg(columnLegend(['plasma concentration total']))
    expect(legendEntries(svg)[0]).toBe('plasma concentration total')
    // the whole label is written, on the two lines of its words
    expect(texts(svg)).toContain('plasma concentration')
    expect(texts(svg)).toContain('total')
  })

  it('cuts the last line of a label which two lines do not hold with an ellipsis', () => {
    const svg = plotSvg(columnLegend(['A very long legend entry indeed, and then some']))
    const lines = texts(svg).filter(
      (one) =>
        'A very long legend entry indeed, and then some'.includes(one.replace('…', '')) &&
        one !== '',
    )
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
    expect(lastLine('A very long legend entry indeed, and then some')).toBe('…and then some')
    // a label which ends in a word longer than the room keeps the end of it,
    // because there is no word to start at
    expect(lastLine('Study A hydrochlorothiazideplasmaconcentrationofvolunteers')).toBe('…lunteers')
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
    const declared = { ...base, declaredLabels: [CONDITIONED[1] ?? ''] }
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
      width: 1100,
      height: 160,
      series: [{ ...series(1), label: CONDITIONED[0] ?? '' }],
    })
    expect(plotGeometry(conditioned(1100, false, 160)).box.y1).toBeLessThan(
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
      declaredLabels: two,
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

  // `anti-Xa activity [ng/ml]` beside the 90 px plot of a 316 px figure: two
  // lines hold it in the browser and not in the estimate of `EM`, which cuts it
  it.todo(
    'reads a label whole on two lines where its measured width fits (the measured-width task)',
  )

  it('keeps the band of the anti-Xa panel where a longer y label would cost it a row', () => {
    // the y label takes two lines and no more: a third line moves the plot
    // right by a line, the band then needs a fourth row, which is more of the
    // height than a legend may take, and the legend goes beside a plot of half
    // the width with its study labels cut
    for (let width = 249; width <= 262; width += 1) {
      const figure: PlotSpec = {
        ...spec(1, { width, height: 200, yLabel: 'anti-Xa activity' }),
        series: [{ ...series(1), label: 'anti-Xa', unit: 'ng/ml' }],
        declaredLabels: ['Frost 2021', 'Frost 2015, young', 'Frost 2015, elderly'],
      }
      const svg = plotSvg(figure)
      expect({ width, below: svg.includes('class="legend below"') }).toEqual({
        width,
        below: true,
      })
    }
  })

  it('wraps the label of the x axis the same way', () => {
    const label = 'time after the administration of the dose [h]'
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
  /** The size of the font of a tick label, the estimate of the renderer. */
  const SMALL_FONT = 11
  /** The width of one character of that font, the estimate of the renderer. */
  const EM = 0.55

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
    return [
      ...group.matchAll(/<g class="tick">.*?<text[^>]*\sx="([^"]*)"[^>]*>([^<]*)<\/text>/g),
    ].map((one) => {
      const at = Number(one[1])
      const label = one[2] ?? ''
      const half = (label.length * SMALL_FONT * EM) / 2
      return { label, from: at - half, to: at + half }
    })
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
      declaredLabels: ['Beermann 1976'],
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

  it('reserves the rows it draws at every size, with a short and a wrapped y label', () => {
    // the rows are counted against the width of the plot box the fit returns,
    // which is the width they are drawn into, so the band and its rows are one
    // measurement and no estimate of the margins can open a gap between them
    const problems: string[] = []
    let banded = 0
    for (const yLabel of ['amount', 'amount in urine']) {
      for (let width = 220; width <= 1400; width += 1) {
        for (const height of new Set([urine(width, yLabel).height, 200])) {
          const figure = urine(width, yLabel, height)
          banded += bandRows(plotSvg(figure)).length > 0 ? 1 : 0
          const problem = bandProblem(figure)
          if (problem !== null) {
            problems.push(problem)
          }
        }
      }
    }
    expect(banded).toBeGreaterThan(1000)
    expect(problems).toEqual([])
  })
})

describe('the fit of the margins', () => {
  /** The padding of a figure, the renderer's. */
  const PAD = 8
  /** The size of the font of a tick label, the estimate of the renderer. */
  const SMALL_FONT = 11
  /** The width of one character of that font, the estimate of the renderer. */
  const EM = 0.55
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
          declaredLabels: ['Beermann 1976'],
          points: [
            { id: 's0', label: 'Beermann 1976', curve: 'curve1', x: [grid[25] ?? 0], y: [1] },
          ],
        }
      : base
  }

  /** The pixels every tick label of the x axis spans. */
  function xTickSpans(svg: string): { from: number; to: number }[] {
    const axis = svg.split('<g class="axis ')[1] ?? ''
    const group = axis.split('<g class="data"')[0] ?? ''
    return [
      ...group.matchAll(/<g class="tick">.*?<text[^>]*\sx="([^"]*)"[^>]*>([^<]*)<\/text>/g),
    ].map((one) => {
      const half = ((one[2] ?? '').length * SMALL_FONT * EM) / 2
      return { from: Number(one[1]) - half, to: Number(one[1]) + half }
    })
  }

  /** The pixel the column of a legend beside the plot starts at, the figure without one. */
  function columnStart(svg: string): number {
    if (svg.includes('class="legend below"') || !svg.includes('class="legend"')) {
      return Number.POSITIVE_INFINITY
    }
    const found = /<g class="legend"[\s\S]*?<line class="swatch" [^>]*\sx1="([^"]*)"/.exec(svg)
    return Number(found?.[1] ?? Number.NaN)
  }

  it('ends on a pass which measured the box it returns, within its bound', () => {
    // the fit ends on the first pass which asks for nothing, so the tick labels
    // of the box it returns are inside the room of the plot to the rounding of
    // the written coordinates: inside the padding of the figure, where nothing
    // is right of the plot, and left of the column of a legend beside it
    const problems: string[] = []
    let most = 0
    for (const range of RANGES) {
      for (let width = 200; width <= 1600; width += 13) {
        for (const height of [120, 200, 300]) {
          for (const yLabel of ['amount', 'amount in urine']) {
            for (const study of [false, true]) {
              const one = figure(range, width, height, yLabel, study)
              const svg = plotSvg(one)
              const name = `${String(range)} ${String(width)}x${String(height)} ${yLabel}`
              for (const fit of marginFits(one)) {
                most = Math.max(most, fit.passes)
                if (!fit.settled) {
                  problems.push(`${name}: unsettled after ${String(fit.passes)} passes`)
                }
              }
              const right = Math.min(width - PAD, columnStart(svg))
              for (const span of xTickSpans(svg)) {
                if (span.from < PAD - WRITTEN || span.to > right + WRITTEN) {
                  problems.push(`${name}: a tick label at ${String(span.from)}..${String(span.to)}`)
                }
              }
            }
          }
        }
      }
    }
    expect(problems).toEqual([])
    expect(most).toBeGreaterThan(1)
  })
})

describe('the room the y tick labels keep', () => {
  /** The padding of a figure, the renderer's. */
  const PAD = 8
  /** The size of the font of a tick label and of an axis label, the renderer's. */
  const SMALL_FONT = 11
  const LABEL_FONT = 12
  /** The width of one character of a font, a share of its size, the renderer's estimate. */
  const EM = 0.55

  /** A figure whose y axis covers `low..high`, over a grid of four x. */
  function valued(low: number, high: number, more: Partial<PlotSpec> = {}): PlotSpec {
    const values = [low, low + (high - low) / 3, low + (2 * (high - low)) / 3, high]
    return spec(1, { series: [{ ...series(1, values), label: 'urine' }], ...more })
  }

  /** The pixel every y tick label starts at, its right end less its estimated width. */
  function yTickStarts(svg: string): number[] {
    const axis = (svg.split('<g class="axis ')[2] ?? '').split('<g class="data"')[0] ?? ''
    return [
      ...axis.matchAll(/<g class="tick">.*?<text[^>]*\sx="([^"]*)"[^>]*>([^<]*)<\/text>/g),
    ].map((one) => Number(one[1]) - (one[2] ?? '').length * SMALL_FONT * EM)
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

  it('keeps every y tick label inside the figure and clear of the label of its axis', () => {
    // a y tick label is written right-aligned left of the plot and the lines of
    // the y label run from the left edge of the figure: the left margin grows by
    // what the widest tick label needs beyond the lines, as the right margin
    // grows by what the last x tick label needs
    const problems: string[] = []
    for (const [low, high] of RANGES) {
      for (const yLabel of ['amount', 'amount in urine of a long name']) {
        for (let width = 240; width <= 1500; width += 7) {
          for (const height of [160, 300]) {
            const svg = plotSvg(valued(low, high, { width, height, yLabel }))
            const clear = Math.max(labelEnd(svg), PAD)
            for (const start of yTickStarts(svg)) {
              if (start < clear - 0.005) {
                problems.push(
                  `${String(high)} ${String(width)}x${String(height)} ${yLabel}: ${String(start)} < ${String(clear)}`,
                )
              }
            }
          }
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('moves the left edge for its labels and leaves the right one where it was', () => {
    // the two sides are counted apart: a wide y tick label moves where the plot
    // starts and never where it ends
    const wide = plotGeometry(valued(0, 1.2e-4, { width: 600 })).box
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
    const ends = [
      ...axis.matchAll(/<g class="tick">.*?<text[^>]*\sx="([^"]*)"[^>]*>([^<]*)<\/text>/g),
    ].map((one) => Number(one[1]) + ((one[2] ?? '').length * 11 * 0.55) / 2)
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
    const end = start + 18 + 6 + 'urine'.length * 11 * 0.55
    const box = plotGeometry(figure).box
    expect(Math.abs((start + end) / 2 - (box.x0 + box.x1) / 2)).toBeLessThan(0.01)
  })
})
