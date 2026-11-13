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
    const svg = plotSvg(spec(2, { points: [{ id: 'curve1', label: 'Series A', x: [0], y: [1] }] }))
    expect(svg).not.toMatch(/#[0-9a-f]{6}/i)
    expect(svg).toContain('var(--sbmlsim-')
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

  it('draws the axes, their ticks and the background of every figure', () => {
    const svg = plotSvg(spec(1))
    expect(svg).toContain('class="background"')
    expect(occurrences(svg, 'class="axis ')).toBe(2)
    expect(occurrences(svg, 'class="tick"')).toBeGreaterThan(3)
  })
})
