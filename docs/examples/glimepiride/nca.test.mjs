// @vitest-environment happy-dom
// The table of the parameters of the example (`nca.mjs`), from the figure of a panel to the
// cells of the page, over the kernel the example carries (`pkpdutils-core/`).
//
// The curve of the test is one compartment with a first order absorption, whose parameters are
// known in closed form, so the numbers of the table are checked against arithmetic and not
// against a recording of the kernel; what the kernel is held to here are the units of its
// columns, which the page names itself.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { beforeAll, describe, expect, it, vi } from 'vitest'

import { createRuntime } from './pkpdutils-core/loader.mjs'

/** The parameters of the curve of the test: absorption, elimination, volume, dose in mg. */
const KA = 1.5
const KE = 0.12
const V = 10
const DOSE = 4

/** The module of the page, imported once the document has the table it writes. */
let page

/** The runtime of the kernel, for the test of the units. */
let kernel

/**
 * The curve of a dose, one compartment with a first order absorption, over 0 to 50 h.
 *
 * @param {number} dose the dose, in mg
 * @param {number} scale a factor on the whole curve, which makes a second analyte of it
 * @returns {{ x: number[], values: number[] }} the times, in hours, and the concentrations,
 *   in µmol/l
 */
function curveOf(dose, scale = 1) {
  const amount = (1000 * dose) / 490.616
  const x = []
  const values = []
  for (let i = 0; i <= 500; i += 1) {
    const t = i / 10
    x.push(t)
    values.push((scale * amount * KA * (Math.exp(-KE * t) - Math.exp(-KA * t))) / (V * (KA - KE)))
  }
  return { x, values }
}

/** The figure a panel hands out, as `drawn()` builds it. */
function figureOf(dose) {
  const gli = curveOf(dose)
  return {
    x: gli.x,
    curves: {
      Carm_gli: gli.values,
      Carm_gli_m1: curveOf(dose, 0.2).values,
      Carm_gli_m2: curveOf(dose, 0.1).values,
    },
    values: { dose, bw: 73 },
    units: { x: 'hr', Carm_gli: 'µM' },
    provenance: { engine: 'test' },
    spec_hash: 'a'.repeat(16),
  }
}

/** Announce the figure of a panel as the element does, from an element which hands it out. */
async function show(panel, figure) {
  const element = document.createElement('div')
  element.drawn = () => figure
  document.body.append(element)
  element.dispatchEvent(
    new CustomEvent('sbmlsim-shown', {
      detail: { panel, values: figure.values },
      bubbles: true,
      composed: true,
    }),
  )
  // the module analyses in a promise of its own, which this lets run
  await new Promise((resolve) => setTimeout(resolve, 0))
  element.remove()
}

/** Announce the figure of a dose from all three panels, as one scan of the app does. */
async function showAll(dose) {
  const figure = figureOf(dose)
  for (const panel of ['glimepiride', 'm1', 'm2']) {
    await show(panel, figure)
  }
  // every panel is analysed in a promise of its own and a column which has not come back yet
  // carries the ellipsis, so the table of the three is written once none of them is pending;
  // waiting a turn of the event loop per panel is a claim about the machine and not about this
  await vi.waitFor(() => {
    expect(table().flat()).not.toContain('…')
  })
}

/**
 * The text of one cell: the value alone, which a cell carries beside its spread and its box.
 *
 * @param {Element} cell the cell
 * @returns {string} the value as it is shown
 */
function cellText(cell) {
  return cell.querySelector('.pk-point')?.textContent ?? cell.textContent
}

/** The cells of the table, one row per line. */
function table() {
  return [...document.querySelectorAll('#pk-parameters tr')].map((row) =>
    [...row.children].map((cell) => cellText(cell)),
  )
}

/** One cell of the table, by the name of its parameter and the column of its analyte. */
function cell(name, column) {
  const row = [...document.querySelectorAll('#pk-parameters tr')].find(
    (one) => cellText(one.children[0]) === name,
  )
  return row?.children[column] ?? null
}

/** The line under the table. */
function noteText() {
  return document.querySelector('#pk-parameters .pk-note').textContent
}

/** The answers of one number of draws the stub holds back until a promise settles, or `null`. */
let hold = null

/** The draws every request of the stub asked for, in the order they were sent. */
const asked = []

/**
 * The answer of a simulation of the stub: the curve of the panel and the draws of its band.
 *
 * Every draw is the curve of the test scaled by a factor of its own, so the parameters of the
 * draws are the parameters of that curve scaled and their spread is known.
 *
 * @param {string} panel the id of the panel
 * @param {object} body the body of the request
 * @returns {object} the answer, `panel/1`
 */
function answerOf(panel, body) {
  const curve = { glimepiride: 'Carm_gli', m1: 'Carm_gli_m1', m2: 'Carm_gli_m2' }[panel]
  const scale = { glimepiride: 1, m1: 0.2, m2: 0.1 }[panel]
  const dose = body.values.dose ?? 0
  const one = curveOf(dose, scale)
  const rows = Array.from(
    { length: body.draws },
    (_, draw) => curveOf(dose, scale * (1 + 0.1 * Math.sin(draw + 1))).values,
  )
  return {
    contract: 'panel/1',
    spec_hash: 'b'.repeat(16),
    x: one.x,
    dims: [],
    curves: { [curve]: [one.values] },
    units: { x: 'hr', [curve]: 'µM' },
    provenance: { engine: 'test' },
    status: { ok: true, points: 1, failed: [] },
    ...(body.draws === 0
      ? {}
      : {
          uncertainty: {
            draws: body.draws,
            fit: 'fit test',
            level: 0.9,
            band: {},
            curves: { [curve]: rows },
            failed: [],
          },
        }),
  }
}

/** The declaration and the simulations of the endpoint, as the page asks for them. */
class StubClient {
  async panel() {
    return { simulation: { uncertainty: { draws: 8, max_draws: 16, level: 0.9, seed: 0 } } }
  }

  async simulate(model, panel, body) {
    asked.push({ panel, draws: body.draws })
    // a test holds the answers of one number of draws back to force the order they come in
    if (hold !== null && body.draws === hold.draws) {
      await hold.until
    }
    return answerOf(panel, body)
  }
}

/** One row of the table, by the name of its parameter. */
function row(name) {
  return table().find((cells) => cells[0] === name) ?? []
}

beforeAll(async () => {
  document.body.innerHTML =
    '<sbmlsim-app></sbmlsim-app>' +
    '<section id="pk-parameters">' +
    '<table></table><p class="pk-note"></p></section>'
  globalThis.sbmlsimWeb = { PanelClient: StubClient }
  // the path of the file and not `import.meta.url`, which is no file url under vitest
  const wasm = await readFile(
    join(process.cwd(), 'docs/examples/glimepiride/pkpdutils-core/runtime/pkpdutils-core.wasm'),
  )
  // the module fetches the module of the kernel, which node does not do for a file
  globalThis.fetch = (url) =>
    Promise.resolve({
      ok: String(url).endsWith('.wasm'),
      arrayBuffer: () => Promise.resolve(wasm),
    })
  kernel = await createRuntime({ module: wasm })
  page = await import('./nca.mjs')
})

describe('the numbers of the table', () => {
  it('writes the parameters of the curve a panel draws', async () => {
    await showAll(DOSE)

    // the closed form of the curve: the elimination half-life, the clearance of the dose over
    // the volume and the area of the whole curve
    const thalf = Math.LN2 / KE
    const amount = (1000 * DOSE) / 490.616
    const peak = Math.log(KA / KE) / (KA - KE)
    const cmax = ((amount * KA) / (V * (KA - KE))) * (Math.exp(-KE * peak) - Math.exp(-KA * peak))
    // the cell carries three digits and the peak of a grid of a tenth of an hour is a little
    // under the peak of the curve, so the two agree to about a thousandth and not closer
    expect(Number(row('Cmax')[2])).toBeCloseTo(cmax, 2)
    expect(Number(row('tmax')[2])).toBeCloseTo(peak, 1)
    expect(Number(row('AUC0-∞')[2])).toBeCloseTo(amount / (KE * V), 2)
    expect(Number(row('t1/2')[2])).toBeCloseTo(thalf, 1)
    expect(Number(row('CL/F')[2])).toBeCloseTo(KE * V, 2)
    expect(Number(row('Vz/F')[2])).toBeCloseTo(V, 1)
    // the metabolites are a fifth and a tenth of the curve, and carry no clearance of the dose
    expect(Number(row('Cmax')[3])).toBeCloseTo(0.2 * cmax, 3)
    expect(Number(row('Cmax')[4])).toBeCloseTo(0.1 * cmax, 3)
    expect(row('CL/F')[3]).toBe('–')
    expect(row('Vz/F')[4]).toBe('–')
  })

  it('names the dose of the rows and raises no flag of such a curve', async () => {
    await showAll(DOSE)
    const note = document.querySelector('#pk-parameters .pk-note').textContent
    expect(note).toContain('4.00 mg glimepiride')
    expect(note).toContain(`M = ${String(page.MOLAR_MASS)} g/mol`)
    // a curve which is exactly one exponential in its tail raises nothing
    expect(note).not.toContain('extrapolated;')
    expect(note).not.toContain('half-lives.')
  })

  it('follows the dose of the knobs and never mixes two states', async () => {
    await showAll(DOSE)
    const before = Number(row('Cmax')[2])
    await show('m1', figureOf(2 * DOSE))
    // the knobs moved between the two: the row of the dose before them is gone
    expect(row('Cmax')[2]).toBe('…')
    expect(Number(row('Cmax')[3])).toBeCloseTo(0.4 * before, 3)
    expect(document.querySelector('#pk-parameters .pk-note').textContent).toContain('8.00 mg')
  })

  it('leaves the table of a page which carries none', async () => {
    // the module is already started; a second start on a page without the table is what a page
    // which only embeds the app does, and it writes nothing and throws nothing
    expect(() => document.querySelectorAll('#pk-parameters')).not.toThrow()
  })
})

describe('the draws of the uncertainty', () => {
  /**
   * The panels of the app run with a number of draws, as the draws field of its settings card
   * makes them: every panel announces the run it answered with the draws it asked for.
   *
   * @param {number} draws the draws of the runs
   */
  function ran(draws) {
    const element = document.createElement('div')
    document.body.append(element)
    for (const panel of ['glimepiride', 'm1', 'm2']) {
      element.dispatchEvent(
        new CustomEvent('sbmlsim-result', {
          detail: { panel, draws },
          bubbles: true,
          composed: true,
        }),
      )
    }
    element.remove()
  }

  /** Wait for the draws of the position which is shown to be back in the table. */
  async function settle(name = 'Cmax') {
    await vi.waitFor(
      () => {
        expect(cell(name, 2).querySelector('.pk-spread')).not.toBeNull()
      },
      { timeout: 5000 },
    )
  }

  it('has no control of its own: the draws field of the app is the one', () => {
    expect(document.querySelector('#pk-draws')).toBeNull()
  })

  it('starts at the draws of the declaration and fills a cell with the draws of that position', async () => {
    asked.length = 0
    await showAll(DOSE)
    // the value of the cell is there before the draws are asked for at all
    expect(Number(cell('Cmax', 2).querySelector('.pk-point').textContent)).toBeGreaterThan(0)
    await settle()
    // one request per analyte, each for the draws of the declaration
    expect(asked).toEqual([
      { panel: 'glimepiride', draws: 8 },
      { panel: 'm1', draws: 8 },
      { panel: 'm2', draws: 8 },
    ])
    const peak = cell('Cmax', 2)
    expect(peak.querySelector('.pk-spread').textContent).toMatch(/^± \d/)
    expect(peak.querySelector('svg.pk-box')).not.toBeNull()
    // the marks of the box: the range of the draws, their middle half and the value
    expect(peak.querySelectorAll('svg.pk-box rect').length).toBe(4)
    expect(peak.title).toContain('8 draws: median')
    expect(peak.title).toContain('coefficient of variation')
    // the coefficient of variation is the standard deviation over the mean of the draws
    // the draws of the stub are the curve times 1 + 0.1 sin(draw + 1), so the peak of the draws
    // varies as those factors do: the sample standard deviation over the mean, in percent
    const factors = Array.from({ length: 8 }, (_, draw) => 1 + 0.1 * Math.sin(draw + 1))
    const mean = factors.reduce((sum, one) => sum + one, 0) / factors.length
    const sd = Math.sqrt(
      factors.reduce((sum, one) => sum + (one - mean) ** 2, 0) / (factors.length - 1),
    )
    expect(peak.querySelector('.pk-cv').textContent).toBe(`CV ${page.format(100 * (sd / mean))} %`)
    // the time of the peak is the same in every draw of a scaled curve, so its spread is 0
    expect(cell('tmax', 2).querySelector('.pk-spread').textContent).toBe('± 0.00')
    // the metabolites carry no clearance of the dose, so that cell carries no box either
    expect(cell('CL/F', 3).querySelector('.pk-spread')).toBeNull()
    expect(cell('CL/F', 3).querySelector('.pk-cv')).toBeNull()
    const note = noteText()
    expect(note).toContain('standard deviation of 8 draws')
    expect(note).toContain('fit test')
    expect(note).toContain('90.0 % band')
    expect(note).toMatch(/axis of ± \d/)
  })

  it('says it is computing while the draws are in flight and states them once back', async () => {
    ran(8)
    await showAll(DOSE)
    await settle()
    ran(16)
    // the draws are asked for and not yet back: the note must not say there are none
    expect(noteText()).toContain('Computing the 16 draws')
    expect(noteText()).not.toContain('set the draws')
    await settle()
    expect(noteText()).toContain('standard deviation of 16 draws')
  })

  it('drops the loop of draws a new number superseded, even when it answers last', async () => {
    ran(8)
    await showAll(DOSE)
    await settle()
    asked.length = 0
    let release
    hold = { draws: 16, until: new Promise((resolve) => (release = resolve)) }
    ran(16)
    // the loop of 16 is in flight, its first answer held back, when the number moves again
    await vi.waitFor(() => {
      expect(asked.some((one) => one.draws === 16)).toBe(true)
    })
    ran(8)
    await settle()
    await vi.waitFor(() => {
      expect(noteText()).toContain('standard deviation of 8 draws')
    })
    // now the superseded loop answers, after the one which replaced it
    hold = null
    release()
    await new Promise((resolve) => setTimeout(resolve, 100))
    // it writes nothing: the table states the draws of the last number only
    expect(noteText()).toContain('standard deviation of 8 draws')
    expect(cell('Cmax', 2).title).toContain('8 draws: median')
    expect(cell('Cmax', 3).title).toContain('8 draws: median')
    expect(cell('Cmax', 4).title).toContain('8 draws: median')
  })

  it('asks for the draws the panels ran with', async () => {
    asked.length = 0
    ran(16)
    // the spread of the draws before is gone until the new ones are back
    expect(cell('Cmax', 2).querySelector('.pk-spread')).toBeNull()
    await settle()
    expect(asked.map((one) => one.draws)).toEqual([16, 16, 16])
    expect(noteText()).toContain('standard deviation of 16 draws')
  })

  it('holds the draws to what the endpoint can answer', async () => {
    ran(8)
    await settle()
    asked.length = 0
    // more than the sample holds is the sample, as the panels of the app run it
    ran(64)
    await settle()
    expect(asked.map((one) => one.draws)).toEqual([16, 16, 16])
  })

  it('asks for nothing and states nothing when the panels ran without draws', async () => {
    asked.length = 0
    ran(0)
    await showAll(DOSE)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(asked).toEqual([])
    expect(cell('Cmax', 2).querySelector('.pk-spread')).toBeNull()
    expect(cell('Cmax', 2).querySelector('svg.pk-box')).toBeNull()
    expect(noteText()).toContain('set the draws in the settings above the panels')
    // and back on again, so the table of a reader who changed their mind is the same table
    ran(8)
    await settle()
    expect(asked.map((one) => one.draws)).toEqual([8, 8, 8])
  })
})

describe('the information view of the app', () => {
  /** Announce the page the reader switched to, as the app does. */
  function openPage(page) {
    document
      .querySelector('sbmlsim-app')
      .dispatchEvent(
        new CustomEvent('sbmlsim-page', { detail: { page }, bubbles: true, composed: true }),
      )
  }

  it('takes the table away and brings it back with the next page', () => {
    const section = document.querySelector('#pk-parameters')
    openPage('information')
    expect(section.hidden).toBe(true)
    openPage('overview')
    expect(section.hidden).toBe(false)
  })

  it('follows the page attribute a deployment sets from outside', async () => {
    const section = document.querySelector('#pk-parameters')
    const app = document.querySelector('sbmlsim-app')
    app.setAttribute('page', 'information')
    await vi.waitFor(() => {
      expect(section.hidden).toBe(true)
    })
    app.setAttribute('page', 'overview')
    await vi.waitFor(() => {
      expect(section.hidden).toBe(false)
    })
  })
})

describe('the request of the kernel', () => {
  it('carries the curve, the dose as an amount and the units of the analysis', () => {
    const request = page.requestOf([0, 1, 2], [[1, 2, Number.NaN]], 8.153)
    expect(request.contract).toBe('analysis/1')
    expect(request.batch.unit).toBe('µmol/l')
    expect(request.batch.dose_unit).toBe('µmol')
    expect(request.batch.time_unit).toBe('hr')
    expect(request.batch.route).toBe('oral')
    expect(request.batch.dose_amount).toEqual([8.153])
    // JSON has no spelling of a number which is not finite, and a point which did not
    // integrate is a missing observation
    expect(request.batch.values).toEqual([1, 2, 'NaN'])
    expect(request.options.auc_method).toBe('linear_log')
  })

  it('carries one row per curve of a batch, every row at the same dose', () => {
    const request = page.requestOf(
      [0, 1],
      [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
      2.5,
    )
    expect(request.batch.sample_dims).toEqual(['curve'])
    expect(request.batch.sample_shape).toEqual([3])
    expect(request.batch.n_time).toBe(2)
    expect(request.batch.times).toEqual([0, 1, 0, 1, 0, 1])
    expect(request.batch.values).toEqual([1, 2, 3, 4, 5, 6])
    expect(request.batch.dose_amount).toEqual([2.5, 2.5, 2.5])
    expect(request.batch.dose_time).toEqual([0, 0, 0])
    expect(request.batch.dose_duration).toEqual(['NaN', 'NaN', 'NaN'])
  })

  it('is answered in the units the page names', () => {
    const gli = curveOf(DOSE)
    const answer = kernel.analyze(page.requestOf(gli.x, [gli.values], (1000 * DOSE) / 490.616))
    for (const [name, unit] of Object.entries(page.KERNEL_UNITS)) {
      const column = answer.header.columns.find((one) => one.name === name)
      expect(column?.unit, name).toBe(unit)
    }
  })
})

describe('the statistics of the draws', () => {
  /** The answer of the analysis of three curves of a dose, the draws of a cell. */
  function answerOf() {
    const rows = [1, 1.1, 0.9].map((scale) => curveOf(DOSE, scale).values)
    return kernel.analyze(page.requestOf(curveOf(DOSE).x, rows, (1000 * DOSE) / 490.616))
  }

  it('reduces the table of the analysis to one statistic per parameter', () => {
    const answer = answerOf()
    const request = page.summaryRequestOf(answer)
    expect(request.n_groups).toBe(1)
    expect(request.n_samples).toBe(3)
    expect(request.n_vars).toBe(request.lognormal.length)
    expect(request.values.length).toBe(request.n_vars * 3)
    const statistics = page.statisticsOf(kernel.summarize(request))
    // the three curves are the same curve scaled, so the peak of the draws is the peak of the
    // middle one, a tenth above it and a tenth below it
    const cmax = answer.column('cmax')
    expect(statistics.cmax.count).toBe(3)
    expect(statistics.cmax.median).toBeCloseTo(cmax[0], 10)
    expect(statistics.cmax.min).toBeCloseTo(cmax[2], 10)
    expect(statistics.cmax.max).toBeCloseTo(cmax[1], 10)
    const mean = (cmax[0] + cmax[1] + cmax[2]) / 3
    const sd = Math.sqrt(
      [...cmax].reduce((sum, one) => sum + (one - mean) ** 2, 0) / (cmax.length - 1),
    )
    expect(statistics.cmax.sd).toBeCloseTo(sd, 10)
    // the time of the peak is the same in all three: a scaled curve peaks where it peaked
    expect(statistics.tmax.sd).toBeCloseTo(0, 10)
  })

  it('reports the coefficient of variation of every parameter', () => {
    const statistics = page.statisticsOf(kernel.summarize(page.summaryRequestOf(answerOf())))
    // a fraction: the standard deviation over the mean of the draws, here of 1, 1.1 and 0.9
    // times one curve, so the peak and the area vary by a tenth and the time of the peak by none
    expect(page.STATISTICS).toContain('cv')
    expect(statistics.cmax.cv).toBeCloseTo(0.1, 6)
    expect(statistics.auc_inf_obs.cv).toBeCloseTo(0.1, 2)
    expect(statistics.tmax.cv).toBeCloseTo(0, 10)
  })

  it('leaves a parameter the kernel has none of as a missing number', () => {
    const statistics = page.statisticsOf({ header: { statistics: ['sd'], width: 0 }, values: [] })
    expect(statistics.cmax.median).toBeNaN()
    expect(statistics.cmax.sd).toBeNaN()
  })
})

describe('the coefficient of variation of a cell', () => {
  it('is a percentage of the fraction the kernel answers', () => {
    expect(page.variationText(0.1)).toBe('CV 10.0 %')
    expect(page.variationText(0.0123)).toBe('CV 1.23 %')
  })

  it('is a dash and no dangling percent sign where there is none', () => {
    expect(page.variationText(Number.NaN)).toBe('CV –')
    expect(page.variationText(Number.POSITIVE_INFINITY)).toBe('CV –')
  })
})

describe('the box of a cell', () => {
  it('is the draws against their own median, in percent', () => {
    // the whiskers reach one and a half interquartile ranges, here 3, so they are the whole
    // range of these draws
    const box = page.relativeBox({ min: 8, q25: 9, median: 10, q75: 11, max: 13 }, 10.5)
    expect(box.low).toBeCloseTo(-20, 10)
    expect(box.q25).toBeCloseTo(-10, 10)
    expect(box.q75).toBeCloseTo(10, 10)
    expect(box.high).toBeCloseTo(30, 10)
    expect(box.point).toBeCloseTo(5, 10)
  })

  it('leaves a draw beyond the whiskers of the box outside them', () => {
    // one draw at 40 is past `q75 + 1.5 * (q75 - q25)`, the whisker of a box plot, so the box
    // of a table of many draws is the draws and not their most extreme one
    const box = page.relativeBox({ min: 9, q25: 9, median: 10, q75: 11, max: 40 }, 10)
    expect(box.high).toBeCloseTo(40, 10)
    expect(box.low).toBeCloseTo(-10, 10)
  })

  it('is nothing without a median to read it against', () => {
    expect(page.relativeBox({ median: 0, min: 0, max: 0 }, 0)).toBeNull()
    expect(page.relativeBox({ median: Number.NaN }, 1)).toBeNull()
    expect(page.relativeBox(undefined, 1)).toBeNull()
  })

  it('takes the scale of the widest box of the table, a round number', () => {
    const box = (low, high) => ({ low, high, q25: low / 2, q75: high / 2, point: 0 })
    expect(page.boxScale([box(-3, 4), box(-1, 2)])).toBe(5)
    expect(page.boxScale([box(-30, 4), null])).toBe(50)
    expect(page.boxScale([box(-0.2, 0.4)])).toBe(1)
    expect(page.boxScale([])).toBe(0)
    expect(page.boxScale([null])).toBe(0)
  })
})

describe('a number of the table', () => {
  it('is three significant digits, a dash where there is none', () => {
    expect(page.format(0.5506)).toBe('0.551')
    expect(page.format(31.4159)).toBe('31.4')
    expect(page.format(2)).toBe('2.00')
    expect(page.format(0.2318, true)).toBe('23.2')
    expect(page.format(Number.NaN)).toBe('–')
    expect(page.format(Number.POSITIVE_INFINITY)).toBe('–')
    expect(page.format(0)).toBe('0.00')
    expect(page.format(1.2e-5)).toBe('1.20e-5')
    expect(page.format(123456)).toBe('1.23e+5')
  })
})
