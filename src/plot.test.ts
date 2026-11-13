import { describe, expect, it } from 'vitest'

import { plotGeometry, plotSvg } from './plot'
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
 * The figure of a small spec as the renderer drew it before there was a frame
 * for the value axis.
 *
 * It is the pin of every caller which does not hand one over: a spec without
 * `yLimits` has to draw the bytes it drew before the field existed, so the
 * field cannot move a figure of a page which never passes it.
 */
const PINNED = `<svg xmlns="http://www.w3.org/2000/svg" class="sbmlsim-plot" width="240" height="160" viewBox="0 0 240 160" role="img" style="font-family:var(--sbmlsim-font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif);font-size:var(--sbmlsim-font-size, 12px)"><title>value [mM] over time [h]</title><defs><clipPath id="sbmlsim-plot-clip-64-14-153_65-118"><rect x="64" y="14" width="89.65" height="104"/></clipPath></defs><rect class="background" x="0" y="0" width="240" height="160" style="fill:var(--sbmlsim-figure-bg, transparent)"/><g class="axis x" style="stroke:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke-width:var(--sbmlsim-axis-width, 1px);fill:none;font-size:var(--sbmlsim-font-size-small, 11px)"><line class="axis-line" x1="64" y1="118" x2="153.65" y2="118"/><g class="tick"><line x1="68.08" y1="118" x2="68.08" y2="122"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="68.08" y="125" text-anchor="middle" dominant-baseline="hanging">0</text></g><g class="tick"><line x1="95.24" y1="118" x2="95.24" y2="122"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="95.24" y="125" text-anchor="middle" dominant-baseline="hanging">1</text></g><g class="tick"><line x1="122.41" y1="118" x2="122.41" y2="122"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="122.41" y="125" text-anchor="middle" dominant-baseline="hanging">2</text></g><g class="tick"><line x1="149.57" y1="118" x2="149.57" y2="122"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="149.57" y="125" text-anchor="middle" dominant-baseline="hanging">3</text></g><text class="axis-label" style="fill:var(--sbmlsim-fg, rgb(27 31 36));stroke:none;font-size:var(--sbmlsim-font-size, 12px)" x="108.83" y="149" text-anchor="middle">time [h]</text></g><g class="axis y" style="stroke:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke-width:var(--sbmlsim-axis-width, 1px);fill:none;font-size:var(--sbmlsim-font-size-small, 11px)"><line class="axis-line" x1="64" y1="14" x2="64" y2="118"/><g class="tick"><line x1="60" y1="113.27" x2="64" y2="113.27"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="57" y="113.27" text-anchor="end" dominant-baseline="central">1</text></g><g class="tick"><line x1="60" y1="81.76" x2="64" y2="81.76"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="57" y="81.76" text-anchor="end" dominant-baseline="central">2</text></g><g class="tick"><line x1="60" y1="50.24" x2="64" y2="50.24"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="57" y="50.24" text-anchor="end" dominant-baseline="central">3</text></g><g class="tick"><line x1="60" y1="18.73" x2="64" y2="18.73"/><text style="fill:var(--sbmlsim-fg-soft, rgb(91 100 114));stroke:none" x="57" y="18.73" text-anchor="end" dominant-baseline="central">4</text></g><text class="axis-label" style="fill:var(--sbmlsim-fg, rgb(27 31 36));stroke:none;font-size:var(--sbmlsim-font-size, 12px)" x="8" y="66" transform="rotate(-90 8 66)" text-anchor="middle" dominant-baseline="hanging">value [mM]</text></g><g class="data" clip-path="url(#sbmlsim-plot-clip-64-14-153_65-118)"><path class="curve" data-series="curve1" style="stroke:var(--sbmlsim-ramp-1, rgb(68 1 84));stroke-width:var(--sbmlsim-curve-width, 1.8px);fill:none" d="M68.08 113.27 L95.24 81.76 L122.41 50.24 L149.57 18.73"/></g><g class="legend" style="fill:var(--sbmlsim-fg, rgb(27 31 36));font-size:var(--sbmlsim-font-size-small, 11px)"><g class="legend-entry" data-series="curve1"><line class="swatch" style="stroke:var(--sbmlsim-ramp-1, rgb(68 1 84));stroke-width:var(--sbmlsim-curve-width, 1.8px)" x1="165.65" y1="23" x2="183.65" y2="23"/><text x="189.65" y="23" dominant-baseline="central">Curve 1</text></g></g></svg>`

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
  it('draws the figure it drew before there was a frame for the value axis', () => {
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
    expect(plotSvg(spec(10))).toContain('class="legend"')
    expect(plotSvg(spec(10))).not.toContain('class="colourbar"')
    expect(plotSvg(spec(11))).toContain('class="colourbar"')
    expect(plotSvg(spec(11))).not.toContain('class="legend"')
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
    const short = plotSvg(spec(3))
    const long = plotSvg({
      ...spec(3),
      series: spec(3).series.map((one) => ({ ...one, label: `${one.label} of a study` })),
    })
    expect(plotRight(long)).toBeLessThan(plotRight(short))
    expect(texts(short)).toContain('Curve 1')
    expect(texts(long)).toContain('Curve 1 of a study')
  })

  it('puts a legend which wants more than a third of the width below the plot', () => {
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

  it('keeps a legend which fits its column beside the plot', () => {
    const svg = plotSvg(spec(2, { width: 390 }))
    expect(svg).not.toContain('class="legend below"')
    expect(svg).toContain('class="legend"')
    expect(plotRight(svg)).toBeLessThan(390 - 8)
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
    // one entry per row at this width, and a row is one row of a legend tall
    expect(swatches.map((one) => one.x)).toEqual([8, 8, 8])
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
