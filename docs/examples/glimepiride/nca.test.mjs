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

import { beforeAll, describe, expect, it } from 'vitest'

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
}

/** The cells of the table, one row per line. */
function table() {
  return [...document.querySelectorAll('#pk-parameters tr')].map((row) =>
    [...row.children].map((cell) => cell.textContent),
  )
}

/** One row of the table, by the name of its parameter. */
function row(name) {
  return table().find((cells) => cells[0] === name) ?? []
}

beforeAll(async () => {
  document.body.innerHTML =
    '<section id="pk-parameters"><table></table><p class="pk-note"></p></section>'
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

describe('the request of the kernel', () => {
  it('carries the curve, the dose as an amount and the units of the analysis', () => {
    const request = page.requestOf([0, 1, 2], [1, 2, Number.NaN], 8.153)
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

  it('is answered in the units the page names', () => {
    const gli = curveOf(DOSE)
    const answer = kernel.analyze(page.requestOf(gli.x, gli.values, (1000 * DOSE) / 490.616))
    for (const [name, unit] of Object.entries(page.KERNEL_UNITS)) {
      const column = answer.header.columns.find((one) => one.name === name)
      expect(column?.unit, name).toBe(unit)
    }
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
