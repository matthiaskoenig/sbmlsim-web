// The pharmacokinetic parameters of the app, computed in this page.
//
// The panels of the app draw the simulated plasma concentrations of glimepiride and of its
// metabolites M1 and M2. This module analyses the very curves they draw: a panel says with
// `sbmlsim-shown` whenever what it draws changed - the answer of a run, and the movement of a
// knob its grid already covers, which simulates nothing - and hands the figure out with
// `drawn()`. The kernel of [pkpdutils](https://matthiaskoenig.github.io/pkpdutils/) runs the
// non-compartmental analysis of it as WebAssembly, in this page, next to the simulation which
// produced it, and the parameters go into the table of `#pk-parameters`; a page without that
// element gets nothing.
//
// The curves carry a molar concentration (`µM` of the model) and the knob carries a dose in mg,
// so the dose travels into the analysis as an amount of substance (`Mr_gli` of the model,
// 490.616 g/mol) and the clearance comes back in l/h. `µM` itself is a spelling the registry of
// the kernel does not read, so the unit of the request is its definition, `µmol/l`.
import { createRuntime } from './pkpdutils-core/loader.mjs'

// Nothing of the page imports this module - both pages load it as a script, and it writes the
// table of `#pk-parameters` by itself - so what it exports is exported for `nca.test.mjs`
// alone: the request it builds, the numbers it writes and the units it holds the kernel to.

/** The molar mass of glimepiride, `Mr_gli` of the model, in g/mol. */
export const MOLAR_MASS = 490.616

/** The analytes of the table: the panel which simulates each one and the curve it draws. */
const ANALYTES = [
  { panel: 'glimepiride', curve: 'Carm_gli', label: 'Glimepiride', dosed: true },
  { panel: 'm1', curve: 'Carm_gli_m1', label: 'M1', dosed: false },
  { panel: 'm2', curve: 'Carm_gli_m2', label: 'M2', dosed: false },
]

/**
 * The parameters of the table, one row each, in the order they are shown.
 *
 * `unit` is the unit the analysis answers in for a curve in `µmol/l` over hours, which
 * `checkUnits` holds the kernel to, `percent` is a fraction shown as a percentage and `dosed`
 * is a parameter of the parent alone: a metabolite carries no dose of its own, so a clearance
 * and a volume of distribution over the dose of glimepiride would be no parameter of it.
 * `quality` is a row of the second block: what the terminal regression stood on and how much of
 * the area is extrapolated, the three numbers which say how far a parameter of the infinite
 * exposure can be trusted, and `names` is a row of two columns, a window.
 */
const PARAMETERS = [
  { name: 'cmax', text: 'C', sub: 'max', unit: 'µmol/l' },
  { name: 'tmax', text: 't', sub: 'max', unit: 'h' },
  { name: 'auc_last', text: 'AUC', sub: '0-last', unit: 'µmol·h/l' },
  { name: 'auc_inf_obs', text: 'AUC', sub: '0-∞', unit: 'µmol·h/l' },
  { name: 'thalf', text: 't', sub: '1/2', unit: 'h' },
  { name: 'mrt', text: 'MRT', unit: 'h' },
  { name: 'cl_f', text: 'CL/F', unit: 'l/h', dosed: true },
  { name: 'vz_f', text: 'V', sub: 'z', tail: '/F', unit: 'l', dosed: true },
  {
    names: ['lambda_z_t_first', 'lambda_z_t_last'],
    text: 'terminal window',
    unit: 'h',
    quality: true,
  },
  { name: 'lambda_z_span', text: 'span of the window', unit: 'half-lives', quality: true },
  {
    name: 'auc_extrap_fraction',
    text: 'AUC extrapolated',
    unit: '%',
    percent: true,
    quality: true,
  },
]

/**
 * The names of the columns of a parameter: the two ends of a window, one otherwise.
 *
 * @param {object} parameter the parameter of `PARAMETERS`
 * @returns {string[]} the names of its columns
 */
function namesOf(parameter) {
  return parameter.names ?? [parameter.name]
}

/** The unit of the answer of every parameter, as the kernel spells it. */
export const KERNEL_UNITS = {
  cmax: 'micromole / liter',
  tmax: 'hour',
  auc_last: 'hour * micromole / liter',
  auc_inf_obs: 'hour * micromole / liter',
  auc_extrap_fraction: 'dimensionless',
  thalf: 'hour',
  mrt: 'hour',
  cl_f: 'liter / hour',
  vz_f: 'liter',
  lambda_z_t_first: 'hour',
  lambda_z_t_last: 'hour',
  lambda_z_span: 'dimensionless',
}

/** The flags of the analysis by their bit, `NCAFlag` of pkpdutils. */
const FLAGS = [
  [1, 'the terminal slope is positive'],
  [2, 'too few points for the terminal regression'],
  [4, 'more than a fifth of the area is extrapolated'],
  [8, 'no maximum'],
  [16, 'no absorption phase'],
  [32, 'the curve was truncated below the limit of quantification'],
  [64, 'no data'],
  [128, 'the window of the terminal regression moved under the perturbation'],
  [256, 'the last dosing interval is not covered by the curve'],
  [512, 'the trough of an interval was extrapolated'],
  [1024, 'the terminal regression covers less than two half-lives'],
  [2048, 'the parameters were not accepted'],
  [4096, 'a partial area is extrapolated'],
  [8192, 'the terminal phase sits at a very low concentration'],
]

/** The runtime of the kernel, instantiated once on the first answer. */
let kernel = null

/** The rows of the table: the panel of an analyte against the parameters of its last run. */
const rows = new Map()

/** The knob values the rows hold, so a table never mixes two states of the app. */
let shown = ''

/** The dose of the rows, in mg. */
let dose = Number.NaN

/** What went wrong, shown in place of the note. */
let failure = ''

/** The table and the note of the page, `null` on a page which has neither. */
let table = null
let note = null

/**
 * The runtime of the kernel, created on the first call and kept for every later one.
 *
 * @returns {Promise<object>} the runtime of the npm package `pkpdutils-core`
 */
async function runtime() {
  if (kernel === null) {
    const url = new URL('./pkpdutils-core/runtime/pkpdutils-core.wasm', import.meta.url)
    const answer = await fetch(url)
    if (!answer.ok) {
      throw new Error('the module of the kernel was not served')
    }
    kernel = await createRuntime({ module: await answer.arrayBuffer() })
  }
  return kernel
}

/**
 * The request of one analyte: the curve of the panel, the dose of the knob and the units.
 *
 * @param {number[]} times the output times of the run, in hours
 * @param {(number | null)[]} values the concentrations of the curve, in µmol/l
 * @param {number} amount the dose, in µmol
 * @returns {object} the request of the contract `analysis/1`
 */
export function requestOf(times, values, amount) {
  return {
    contract: 'analysis/1',
    batch: {
      contract: 'batch/1',
      sample_dims: ['analyte'],
      sample_shape: [1],
      n_time: times.length,
      times,
      // a point the solver did not reach is no observation, which is what a missing value is
      values: values.map((value) => (value === null || !Number.isFinite(value) ? 'NaN' : value)),
      max_doses: 1,
      dose_amount: [amount],
      dose_time: [0],
      dose_duration: ['NaN'],
      time_unit: 'hr',
      unit: 'µmol/l',
      dose_unit: 'µmol',
      route: 'oral',
      coords: [],
    },
    options: { kind: 'concentration', auc_method: 'linear_log' },
  }
}

/**
 * Hold the kernel to the units the table names.
 *
 * The table carries the unit of every parameter as a word of the page, so a release of the
 * kernel which answers another unit has to be seen rather than shown: the row of a parameter
 * whose unit is not the one of `KERNEL_UNITS` is dropped and the note says so.
 *
 * @param {object} answer the answer of the kernel
 * @returns {string[]} the names of the parameters whose unit is not the expected one
 */
function checkUnits(answer) {
  return Object.entries(KERNEL_UNITS)
    .filter(([name, unit]) => {
      const column = answer.header.columns.find((one) => one.name === name)
      return column !== undefined && column.unit !== unit
    })
    .map(([name]) => name)
}

/**
 * Analyse the curve of one analyte, as its panel draws it.
 *
 * @param {object} analyte the analyte of `ANALYTES`
 * @param {object} figure the figure of its panel, `drawn()` of the element
 * @returns {Promise<void>}
 */
async function analyse(analyte, figure) {
  const curve = figure.curves?.[analyte.curve]
  if (curve === undefined) {
    return
  }
  const run = await runtime()
  const amount = (1000 * (figure.values.dose ?? 0)) / MOLAR_MASS
  const result = run.analyze(requestOf(figure.x, curve, amount))
  const wrong = checkUnits(result)
  const parameters = {}
  for (const name of PARAMETERS.flatMap(namesOf)) {
    parameters[name] = wrong.includes(name) ? Number.NaN : (result.column(name)?.[0] ?? Number.NaN)
  }
  rows.set(analyte.panel, {
    parameters,
    flags: result.column('flags')?.[0] ?? 0,
    wrong,
  })
}

/**
 * One number of the table, in three significant digits.
 *
 * @param {number} value the value, which is `NaN` where the analysis has none
 * @param {boolean} percent whether it is a fraction shown as a percentage
 * @returns {string} the number, or an en dash where there is none
 */
export function format(value, percent) {
  const shown = percent === true ? 100 * value : value
  if (!Number.isFinite(shown)) {
    return '–'
  }
  if (shown !== 0 && (Math.abs(shown) >= 1e4 || Math.abs(shown) < 1e-3)) {
    return shown.toExponential(2)
  }
  return shown.toPrecision(3)
}

/**
 * The cell of the name of a parameter, with its subscript.
 *
 * @param {object} parameter the parameter of `PARAMETERS`
 * @returns {HTMLTableCellElement} the cell
 */
function nameCell(parameter) {
  const cell = document.createElement('th')
  cell.scope = 'row'
  cell.append(document.createTextNode(parameter.text))
  if (parameter.sub !== undefined) {
    const sub = document.createElement('sub')
    sub.textContent = parameter.sub
    cell.append(sub)
  }
  if (parameter.tail !== undefined) {
    cell.append(document.createTextNode(parameter.tail))
  }
  return cell
}

/**
 * The cells of one row: the name, the unit and one value per analyte.
 *
 * @param {object} parameter the parameter of `PARAMETERS`
 * @returns {HTMLTableRowElement} the row
 */
function valueRow(parameter) {
  const row = document.createElement('tr')
  row.append(nameCell(parameter))
  const unit = document.createElement('td')
  unit.className = 'pk-unit'
  unit.textContent = parameter.unit
  row.append(unit)
  for (const analyte of ANALYTES) {
    const cell = document.createElement('td')
    cell.className = 'pk-value'
    const held = rows.get(analyte.panel)
    if (held === undefined) {
      cell.textContent = '\u2026'
    } else if (parameter.dosed === true && analyte.dosed !== true) {
      cell.textContent = '\u2013'
    } else {
      const shownValues = namesOf(parameter).map((name) =>
        format(held.parameters[name], parameter.percent),
      )
      // a window without either of its ends is one missing value and not two dashes of one
      cell.textContent = shownValues.every((one) => one === '\u2013')
        ? '\u2013'
        : shownValues.join('\u2013')
    }
    row.append(cell)
  }
  return row
}

/** Write the rows the page holds into the table and the line under it. */
function render() {
  if (table === null) {
    return
  }
  const head = document.createElement('thead')
  const headRow = document.createElement('tr')
  for (const text of ['Parameter', 'Unit', ...ANALYTES.map((one) => one.label)]) {
    const cell = document.createElement('th')
    cell.scope = 'col'
    cell.textContent = text
    headRow.append(cell)
  }
  head.append(headRow)
  // two blocks: the parameters, and what the terminal regression and the extrapolation stood on
  const body = document.createElement('tbody')
  const quality = document.createElement('tbody')
  quality.className = 'pk-quality'
  for (const parameter of PARAMETERS) {
    ;(parameter.quality === true ? quality : body).append(valueRow(parameter))
  }
  table.replaceChildren(head, body, quality)
  renderNote()
}

/**
 * The labels of a sentence, as a sentence lists them.
 *
 * @param {string[]} labels the labels
 * @returns {string} one label, two with an "and", more with commas and an "and"
 */
function listed(labels) {
  return labels.length < 2
    ? (labels[0] ?? '')
    : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

/** Write the line under the table: the dose of the rows, what computed them and every flag. */
function renderNote() {
  if (note === null) {
    return
  }
  if (failure !== '') {
    note.textContent = `The parameters could not be computed: ${failure}`
    return
  }
  const amount = (1000 * dose) / MOLAR_MASS
  const lines = [
    `A single oral dose of ${format(dose)} mg glimepiride (${format(amount)} µmol, ` +
      `M = ${MOLAR_MASS} g/mol), analysed over the simulated 0 to 50 h of this patient with ` +
      `the linear up / log down trapezoid and the best fit of the terminal slope. CL/F and ` +
      `Vz/F are of glimepiride alone: a metabolite carries no dose of its own. A whole-body ` +
      `model keeps a slowly decaying terminal phase at the end of that window, so the rows ` +
      `under the rule say what the regression of the terminal slope stood on and how much of ` +
      `the area to infinity is extrapolated.`,
  ]
  // the analytes which raised the same flags are one sentence: a model raises them for all
  // three as often as not, and three sentences of the same words are three times the reading
  const together = new Map()
  for (const analyte of ANALYTES) {
    const held = rows.get(analyte.panel)
    const raised = FLAGS.filter(([bit]) => ((held?.flags ?? 0) & bit) !== 0).map(([, text]) => text)
    if (raised.length > 0) {
      const text = raised.join('; ')
      together.set(text, [...(together.get(text) ?? []), analyte.label])
    }
    if ((held?.wrong ?? []).length > 0) {
      lines.push(
        `${analyte.label}: the kernel answered another unit than this page names for ` +
          `${held.wrong.join(', ')}, which is left out.`,
      )
    }
  }
  for (const [text, labels] of together) {
    lines.push(`${listed(labels)}: ${text}.`)
  }
  note.textContent = lines.join(' ')
}

/**
 * Take what a panel draws: analyse its curve and write the table again.
 *
 * The event crosses the shadow root of the app, which retargets it, so the panel is the first
 * element of the composed path and not the target.
 *
 * @param {Event} event the `sbmlsim-shown` of a panel
 * @returns {Promise<void>}
 */
async function take(event) {
  const detail = event.detail ?? {}
  const analyte = ANALYTES.find((one) => one.panel === detail.panel)
  if (analyte === undefined) {
    return
  }
  const panel = event.composedPath()[0]
  const figure = typeof panel?.drawn === 'function' ? panel.drawn() : null
  if (figure === null) {
    return
  }
  const key = JSON.stringify(figure.values)
  if (key !== shown) {
    // the knobs moved: the rows of the state before it are no parameters of this one
    rows.clear()
    shown = key
    dose = figure.values.dose ?? Number.NaN
  }
  try {
    await analyse(analyte, figure)
    failure = ''
  } catch (bad) {
    failure = bad instanceof Error ? bad.message : String(bad)
  }
  // a knob which moved while this analysis ran has cleared these rows already
  if (key === shown) {
    render()
  }
}

/** Find the table of the page and follow what the panels of the app draw. */
function start() {
  table = document.querySelector('#pk-parameters table')
  note = document.querySelector('#pk-parameters .pk-note')
  if (table === null) {
    return
  }
  render()
  document.addEventListener('sbmlsim-shown', (event) => {
    void take(event)
  })
}

start()
