import { describe, expect, it } from 'vitest'

import { plotSvg } from './plot'
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

/** Count how often a text occurs in another. */
function occurrences(text: string, what: string): number {
  return text.split(what).length - 1
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

describe('plotSvg', () => {
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

  it('draws the study points of a series without an error in the colour of its curve', () => {
    const svg = plotSvg(spec(2, { points: [{ id: 'curve2', label: 'Series A', x: [0], y: [1] }] }))
    expect(svg).not.toContain('class="errorbar"')
    const curve = /<path class="curve" data-series="curve2" style="stroke:([^;"]*)/.exec(svg)
    const marker = /<circle class="marker" style="fill:([^;"]*)/.exec(svg)
    expect(curve?.[1]).toContain('--sbmlsim-ramp')
    expect(marker?.[1]).toBe(curve?.[1])
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

  it('cuts a legend entry which does not fit its column with an ellipsis', () => {
    const svg = plotSvg(
      spec(1, {
        series: [{ ...series(1), label: 'A very long legend entry indeed, and then some' }],
      }),
    )
    const entry = texts(svg).find((one) => one.startsWith('A very long'))
    expect(entry?.endsWith('…')).toBe(true)
    expect(entry?.length).toBeLessThan(30)
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
