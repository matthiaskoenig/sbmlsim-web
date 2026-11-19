// The pharmacokinetic parameters of the app and the uncertainty of the fit they carry,
// computed in this page.
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
// The table has two phases, so a reader never waits for a number:
//
// 1. the curve the panel just drew is analysed at once and gives the value of every parameter;
// 2. the draws of the uncertainty of the fit follow. The figures shade the band of those draws,
//    and the parameters of a shaded curve are a distribution of their own - which no band of a
//    figure states, since the 95th percentile of a concentration at every time is the curve of
//    no draw. So the page asks the endpoint for the curves of the draws themselves
//    (`PanelClient.simulate` with `draws`, one point, where they travel), analyses all of them
//    in one batch of the kernel and reduces that table to the statistics of every parameter
//    (`summarize` of the kernel, no statistic of this page). The cell then carries the value of
//    the model, the standard deviation of the draws and the box of their spread.
//
// The reader picks the draws (`#pk-draws`), the page holds the panels of the app to the same
// number (`draws` of `<sbmlsim-app>`), and the declaration of the panel says what that number
// may be: the draws of the sample are the most the endpoint can answer, and the draws a request
// runs are the first of them, so the band and the boxes settle as the number goes up rather
// than jumping.
//
// The curves carry a molar concentration (`µM` of the model) and the knob carries a dose in mg,
// so the dose travels into the analysis as an amount of substance (`Mr_gli` of the model,
// 490.616 g/mol) and the clearance comes back in l/h. `µM` itself is a spelling the registry of
// the kernel does not read, so the unit of the request is its definition, `µmol/l`.
import { createRuntime } from './pkpdutils-core/loader.mjs'

// Nothing of the page imports this module - both pages load it as a script, and it writes the
// table of `#pk-parameters` by itself - so what it exports is exported for `nca.test.mjs`
// alone: the requests it builds, the numbers it writes and the units it holds the kernel to.

/** The molar mass of glimepiride, `Mr_gli` of the model, in g/mol. */
export const MOLAR_MASS = 490.616

/** The model and the endpoint of the page, the ones `register.mjs` registers. */
const MODEL = 'glimepiride'
const ENDPOINT = `local:${MODEL}`

/**
 * The milliseconds one request of the draws is given.
 *
 * A request of 64 draws is 65 runs of a whole-body model, which the pool runs over the cores of
 * the machine; the default of the client is the eight seconds of an interactive panel.
 */
const DRAWS_TIMEOUT = 120000

/**
 * The milliseconds the draws wait for the knobs to come to rest.
 *
 * Every panel of the app announces what it drew, and the dose moves the figures out of a grid
 * which is already simulated, so a drag of a slider announces a figure per frame while the
 * draws of a position cost runs of their own: they follow the last position and not every one.
 */
const DRAWS_DELAY = 150

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
 * exposure can be trusted, and `names` is a row of two columns, a window. `lognormal` and
 * `discrete` are what the parameter is, which travel into the statistics of the draws.
 */
const PARAMETERS = [
  { name: 'cmax', text: 'C', sub: 'max', unit: 'µmol/l', lognormal: true },
  { name: 'tmax', text: 't', sub: 'max', unit: 'h', discrete: true },
  { name: 'auc_last', text: 'AUC', sub: '0-last', unit: 'µmol·h/l', lognormal: true },
  { name: 'auc_inf_obs', text: 'AUC', sub: '0-∞', unit: 'µmol·h/l', lognormal: true },
  { name: 'thalf', text: 't', sub: '1/2', unit: 'h', lognormal: true },
  { name: 'mrt', text: 'MRT', unit: 'h', lognormal: true },
  { name: 'cl_f', text: 'CL/F', unit: 'l/h', dosed: true, lognormal: true },
  { name: 'vz_f', text: 'V', sub: 'z', tail: '/F', unit: 'l', dosed: true, lognormal: true },
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

/** Every column of the table, in the order the requests of the kernel carry them. */
const COLUMNS = PARAMETERS.flatMap((parameter) =>
  namesOf(parameter).map((name) => ({ name, parameter })),
)

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

/**
 * The statistics of the draws the table reads, as the kernel names them.
 *
 * The kernel answers every statistic of every column and a host takes the ones it wants
 * (`pkpd_summarize`), so these are the names of the blocks this page reads out of the payload.
 */
export const STATISTICS = ['sd', 'median', 'q25', 'q75', 'min', 'max', 'count']

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

/** The client of the endpoint, built on the first request of the draws. */
let client = null

/**
 * The rows of the table: the panel of an analyte against the parameters of its last run.
 *
 * A row carries the parameters of the curve the panel drew, the flags of that analysis and,
 * once the draws of that same position are back, the statistics of every column.
 */
const rows = new Map()

/** The knob values the rows hold, so a table never mixes two states of the app. */
let shown = ''

/** The dose of the rows, in mg. */
let dose = Number.NaN

/** What went wrong, shown in place of the note. */
let failure = ''

/** The uncertainty the panels declare, `null` for a model which declares none. */
let declared = null

/** The draws the reader asked for, the number of the declaration until they do. */
let draws = 0

/** What the draws of the table came from: the fit, the level of the band and what failed. */
let provenance = null

/** The timer of the draws of the position which is shown. */
let timer = null

/** The table, the note, the control of the draws and the app element of the page. */
let table = null
let note = null
let control = null
let app = null

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
 * The request of the analysis: one row per curve, every row the same times and dose.
 *
 * @param {number[]} times the output times of the run, in hours
 * @param {(number | null)[][]} curves the concentrations of every row, in µmol/l
 * @param {number} amount the dose, in µmol
 * @returns {object} the request of the contract `analysis/1`
 */
export function requestOf(times, curves, amount) {
  return {
    contract: 'analysis/1',
    batch: {
      contract: 'batch/1',
      sample_dims: ['curve'],
      sample_shape: [curves.length],
      n_time: times.length,
      // the times of a batch are the times of every row, as its values are
      times: curves.flatMap(() => times),
      // a point the solver did not reach is no observation, which is what a missing value is
      values: curves.flatMap((values) =>
        values.map((value) => (value === null || !Number.isFinite(value) ? 'NaN' : value)),
      ),
      max_doses: 1,
      dose_amount: curves.map(() => amount),
      dose_time: curves.map(() => 0),
      dose_duration: curves.map(() => 'NaN'),
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
 * The request of the statistics of the draws: the table of the analysis, column by column.
 *
 * The values are row major over `(column, group, draw)` with one group, so the block of a
 * statistic the kernel answers is one number per column of the table.
 *
 * @param {object} answer the answer of the analysis of the draws
 * @returns {object} the request of `pkpd_summarize`
 */
export function summaryRequestOf(answer) {
  const columns = COLUMNS.map(({ name }) => answer.column(name) ?? [])
  const samples = columns.reduce((most, column) => Math.max(most, column.length), 0)
  return {
    values: columns.flatMap((column) =>
      Array.from({ length: samples }, (_, draw) => {
        const value = column[draw]
        return value === undefined || !Number.isFinite(value) ? 'NaN' : value
      }),
    ),
    n_vars: COLUMNS.length,
    n_groups: 1,
    n_samples: samples,
    ci_level: 0.9,
    lognormal: COLUMNS.map(({ parameter }) => parameter.lognormal === true),
    discrete: COLUMNS.map(({ parameter }) => parameter.discrete === true),
  }
}

/**
 * The statistics of every column, read out of the answer of `summarize`.
 *
 * @param {object} answer the answer of `pkpd_summarize`
 * @returns {Record<string, Record<string, number>>} per column name the statistics of
 *   `STATISTICS`, each `NaN` where the kernel has none
 */
export function statisticsOf(answer) {
  const names = answer.header.statistics ?? []
  const width = answer.header.width ?? 0
  const read = {}
  COLUMNS.forEach(({ name }, column) => {
    read[name] = {}
    for (const statistic of STATISTICS) {
      const block = names.indexOf(statistic)
      read[name][statistic] =
        block < 0 ? Number.NaN : (answer.values[block * width + column] ?? Number.NaN)
    }
  })
  return read
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
 * The parameters of one row of an answer of the kernel, by their name.
 *
 * @param {object} answer the answer of the analysis
 * @param {string[]} wrong the columns whose unit is not the one the page names
 * @param {number} row the row of the batch
 * @returns {Record<string, number>} the value of every column of the table
 */
function parametersOf(answer, wrong, row) {
  const parameters = {}
  for (const { name } of COLUMNS) {
    parameters[name] = wrong.includes(name)
      ? Number.NaN
      : (answer.column(name)?.[row] ?? Number.NaN)
  }
  return parameters
}

/**
 * The dose of a figure as an amount of substance, in µmol.
 *
 * @param {object} figure the figure of a panel, `drawn()` of the element
 * @returns {number} the amount
 */
function amountOf(figure) {
  return (1000 * (figure.values.dose ?? 0)) / MOLAR_MASS
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
  const result = run.analyze(requestOf(figure.x, [curve], amountOf(figure)))
  const wrong = checkUnits(result)
  rows.set(analyte.panel, {
    parameters: parametersOf(result, wrong, 0),
    flags: result.column('flags')?.[0] ?? 0,
    wrong,
    statistics: null,
  })
}

/**
 * Analyse the draws of one analyte and keep the statistics of their parameters.
 *
 * The curves of the draws travel for an answer of a single point, so the request is the
 * position of the knobs itself and never the grid the panel runs over its dose.
 *
 * @param {object} analyte the analyte of `ANALYTES`
 * @param {Record<string, number>} values the values of the knobs of the panel
 * @returns {Promise<object | null>} the uncertainty of the answer, `null` for an answer which
 *   carries none
 */
async function analyseDraws(analyte, values) {
  const answer = await client.simulate(MODEL, analyte.panel, { values, draws })
  const curves = answer.uncertainty?.curves?.[analyte.curve]
  if (curves === undefined || curves.length === 0) {
    return answer.uncertainty ?? null
  }
  const run = await runtime()
  const amount = (1000 * (values.dose ?? 0)) / MOLAR_MASS
  // a draw which did not integrate is a row of nulls, which is a row of missing observations
  const result = run.analyze(
    requestOf(
      answer.x,
      curves.map((one) => one ?? answer.x.map(() => null)),
      amount,
    ),
  )
  const held = rows.get(analyte.panel)
  if (held !== undefined) {
    held.statistics = statisticsOf(run.summarize(summaryRequestOf(result)))
  }
  return answer.uncertainty ?? null
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
 * The draws a reader may pick, the powers of two the sample of the endpoint holds.
 *
 * @param {number} most the draws of the sample, `PanelUncertainty.max_draws`
 * @returns {number[]} the numbers of the control, `0` (no band) first and `most` last
 */
export function drawChoices(most) {
  const choices = [0]
  for (let n = 8; n < most; n *= 2) {
    choices.push(n)
  }
  if (most > 0) {
    choices.push(most)
  }
  return choices
}

/**
 * The spread of the draws of a cell, relative to their median, in percent.
 *
 * The box of a cell says how wide the draws of that parameter are and not how large it is - the
 * number beside it says that - so every box is read against the median of its own cell. The
 * scale is one for the whole table, the widest cell of it, so the boxes of two parameters and
 * of two analytes are the same scale and the table states it once.
 *
 * The ends are the whiskers of a box plot: the draws within one and a half interquartile ranges
 * of the box, which is what makes the scale of the table a scale of the draws and not of their
 * most extreme one - a reader who asks for more draws would otherwise watch every box shrink as
 * the extremes of a larger sample pull the axis wider.
 *
 * @param {Record<string, number>} statistics the statistics of the column of a cell
 * @param {number} point the value of the model itself, the number beside the box
 * @returns {{low: number, high: number, q25: number, q75: number, point: number} | null} the
 *   ends of the whisker and of the box in percent of the median, `null` without a median
 */
export function relativeBox(statistics, point) {
  const median = statistics?.median ?? Number.NaN
  if (!Number.isFinite(median) || median === 0) {
    return null
  }
  const share = (value) => (Number.isFinite(value) ? (100 * (value - median)) / median : Number.NaN)
  const { q25, q75, min, max } = statistics
  const fence = 1.5 * (q75 - q25)
  return {
    low: share(Math.max(min, q25 - fence)),
    high: share(Math.min(max, q75 + fence)),
    q25: share(q25),
    q75: share(q75),
    point: share(point),
  }
}

/**
 * The scale of the boxes of the table: the widest end of any of them, in percent.
 *
 * @param {Array<object | null>} boxes the boxes of the cells, `null` where a cell has none
 * @returns {number} the half width of the axis of every box, `0` for a table without one
 */
export function boxScale(boxes) {
  const ends = boxes
    .filter((box) => box !== null)
    .flatMap((box) => [box.low, box.high, box.point])
    .filter((end) => Number.isFinite(end))
    .map((end) => Math.abs(end))
  const widest = Math.max(0, ...ends)
  if (widest === 0) {
    return 0
  }
  // a round number, so the legend of the table states a scale a reader can hold on to
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500]
  return steps.find((step) => step >= widest) ?? Math.ceil(widest)
}

/** The namespace of the figures of the boxes. */
const SVG = 'http://www.w3.org/2000/svg'

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
 * The figure of the box of a cell: the range of the draws, their quartiles and the value.
 *
 * One rectangle per mark and no stroke, since the figure is stretched to the width of its cell
 * (`preserveAspectRatio="none"`) and a stroke would be stretched with it.
 *
 * @param {object} box the box of the cell, `relativeBox`
 * @param {number} scale the half width of the axis, in percent
 * @returns {SVGSVGElement} the figure, 100 by 12 units of its own
 */
function boxFigure(box, scale) {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'pk-box')
  svg.setAttribute('viewBox', '0 0 100 12')
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('aria-hidden', 'true')
  const at = (share) => 50 + (50 * Math.max(-scale, Math.min(scale, share))) / scale
  const rect = (className, x, width, y, height, least = 0.6) => {
    const mark = document.createElementNS(SVG, 'rect')
    mark.setAttribute('class', className)
    mark.setAttribute('x', String(x))
    mark.setAttribute('width', String(Math.max(width, least)))
    mark.setAttribute('y', String(y))
    mark.setAttribute('height', String(height))
    svg.append(mark)
    return mark
  }
  // the median of the draws, which every box is read against, is the middle of the axis
  rect('pk-middle', 49.7, 0.6, 1, 10)
  if (Number.isFinite(box.low) && Number.isFinite(box.high)) {
    rect('pk-range', at(box.low), at(box.high) - at(box.low), 5.5, 1)
  }
  if (Number.isFinite(box.q25) && Number.isFinite(box.q75)) {
    // the bar of a cell whose draws agree is still a bar and not the rule behind it
    rect('pk-iqr', at(box.q25), at(box.q75) - at(box.q25), 3, 6, 1.5)
  }
  if (Number.isFinite(box.point)) {
    rect('pk-point-mark', at(box.point) - 0.4, 0.8, 0, 12)
  }
  return svg
}

/**
 * What a cell says about its draws, the title of the cell.
 *
 * @param {object} parameter the parameter of the row
 * @param {Record<string, number>} statistics the statistics of its column
 * @returns {string} the sentence
 */
function boxTitle(parameter, statistics) {
  const show = (value) => format(value, parameter.percent)
  return (
    `${String(statistics.count)} draws: median ${show(statistics.median)}, ` +
    `half of them between ${show(statistics.q25)} and ${show(statistics.q75)}, ` +
    `all of them between ${show(statistics.min)} and ${show(statistics.max)} ${parameter.unit}`
  )
}

/**
 * The cell of one parameter of one analyte: the value, the spread of the draws and their box.
 *
 * @param {object} parameter the parameter of `PARAMETERS`
 * @param {object} analyte the analyte of `ANALYTES`
 * @returns {{cell: HTMLTableCellElement, box: object | null}} the cell and the box it waits for
 */
function valueCell(parameter, analyte) {
  const cell = document.createElement('td')
  cell.className = 'pk-value'
  // the box, the value and its spread are one line, so a table of eleven parameters and three
  // analytes is a block a reader takes in at once
  const line = document.createElement('div')
  line.className = 'pk-cell'
  cell.append(line)
  const held = rows.get(analyte.panel)
  const point = document.createElement('span')
  point.className = 'pk-point'
  line.append(point)
  if (held === undefined) {
    point.textContent = '…'
    return { cell, box: null }
  }
  if (parameter.dosed === true && analyte.dosed !== true) {
    point.textContent = '–'
    return { cell, box: null }
  }
  const names = namesOf(parameter)
  const shownValues = names.map((name) => format(held.parameters[name], parameter.percent))
  // a window without either of its ends is one missing value and not two dashes of one
  point.textContent = shownValues.every((one) => one === '–') ? '–' : shownValues.join('–')
  // the spread of the draws and their box, for a parameter of one column alone: the two ends of
  // a window are two numbers of one cell and carry no single spread
  const statistics = names.length === 1 ? held.statistics?.[names[0]] : undefined
  if (statistics === undefined || statistics === null) {
    return { cell, box: null }
  }
  const spread = document.createElement('span')
  spread.className = 'pk-spread'
  spread.textContent = `± ${format(statistics.sd, parameter.percent)}`
  line.append(spread)
  const box = relativeBox(statistics, held.parameters[names[0]])
  if (box !== null) {
    cell.title = boxTitle(parameter, statistics)
  }
  return { cell, box }
}

/**
 * The cells of one row: the name, the unit and one value per analyte.
 *
 * @param {object} parameter the parameter of `PARAMETERS`
 * @param {Array<{cell: HTMLTableCellElement, box: object}>} waiting the cells which carry a box,
 *   which this appends to: the scale of a box is the one of the whole table, so the figures are
 *   drawn once every cell is built
 * @returns {HTMLTableRowElement} the row
 */
function valueRow(parameter, waiting) {
  const row = document.createElement('tr')
  row.append(nameCell(parameter))
  const unit = document.createElement('td')
  unit.className = 'pk-unit'
  unit.textContent = parameter.unit
  row.append(unit)
  for (const analyte of ANALYTES) {
    const { cell, box } = valueCell(parameter, analyte)
    if (box !== null) {
      waiting.push({ cell, box })
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
  const waiting = []
  for (const parameter of PARAMETERS) {
    ;(parameter.quality === true ? quality : body).append(valueRow(parameter, waiting))
  }
  // one scale for every box of the table, which the note states
  const scale = boxScale(waiting.map(({ box }) => box))
  for (const { cell, box } of waiting) {
    if (scale > 0) {
      cell.querySelector('.pk-cell').prepend(boxFigure(box, scale))
    }
  }
  table.replaceChildren(head, body, quality)
  renderNote(scale)
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

/**
 * The sentence of the draws: what they are, how many ran and what the boxes show.
 *
 * @param {number} scale the half width of the axis of the boxes, in percent
 * @returns {string} the sentence, empty for a table without draws
 */
function drawsLine(scale) {
  if (draws === 0 || provenance === null) {
    return declared === null
      ? ''
      : 'The parameters are the model at its own parameters; pick the draws above to see what ' +
          'the uncertainty of the fit does to them.'
  }
  const level = `${format(100 * provenance.level)} %`
  const lost = provenance.failed.length
  return (
    `± is the standard deviation of ${String(provenance.draws)} draws of the ten parameters of ` +
    `${provenance.fit}, the very draws the figures shade as their ${level} band. The box of a ` +
    `cell is those draws against their own median, the bar their middle half and the whisker ` +
    `the ones within one and a half of it, on one axis of ± ${format(scale)} % for the whole ` +
    `table; the line is the value beside it, and the cell says the rest.` +
    (lost === 0 ? '' : ` ${String(lost)} of the draws did not integrate and are left out.`)
  )
}

/** Write the line under the table: the dose of the rows, the draws and every flag. */
function renderNote(scale) {
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
  const spread = drawsLine(scale)
  if (spread !== '') {
    lines.push(spread)
  }
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
 * Analyse the draws of every analyte at one position of the knobs.
 *
 * @param {string} key the position the rows hold, which a movement of a knob replaces
 * @param {Record<string, number>} values the values of the knobs
 * @returns {Promise<void>}
 */
async function takeDraws(key, values) {
  if (client === null) {
    client = new globalThis.sbmlsimWeb.PanelClient(ENDPOINT, DRAWS_TIMEOUT)
  }
  for (const analyte of ANALYTES) {
    const uncertainty = await analyseDraws(analyte, values)
    if (key !== shown) {
      // the knobs moved while this ran: these draws are of the position before them
      return
    }
    if (uncertainty !== null) {
      provenance = {
        draws: uncertainty.draws,
        fit: uncertainty.fit,
        level: uncertainty.level,
        failed: uncertainty.failed,
      }
    }
    render()
  }
}

/**
 * Ask for the draws of the position which is shown, once the knobs come to rest.
 *
 * @param {string} key the position the rows hold
 * @param {Record<string, number>} values the values of the knobs
 */
function scheduleDraws(key, values) {
  if (timer !== null) {
    clearTimeout(timer)
  }
  if (draws === 0 || declared === null) {
    return
  }
  timer = setTimeout(() => {
    timer = null
    takeDraws(key, values).catch((bad) => {
      failure = bad instanceof Error ? bad.message : String(bad)
      render()
    })
  }, DRAWS_DELAY)
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
    provenance = null
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
    scheduleDraws(key, { ...figure.values })
  }
}

/**
 * Build the control of the draws out of what the panels declare.
 *
 * The declaration says what a reader may ask for - the sample of the endpoint is the most - so
 * the page writes no number of its own, and a model which declares no uncertainty keeps no
 * control: there is nothing to turn up.
 *
 * @returns {Promise<void>}
 */
async function readDeclaration() {
  if (control === null) {
    return
  }
  const client = new globalThis.sbmlsimWeb.PanelClient(ENDPOINT, DRAWS_TIMEOUT)
  const panel = await client.panel(MODEL, ANALYTES[0].panel)
  declared = panel.simulation.uncertainty ?? null
  if (declared === null) {
    control.hidden = true
    return
  }
  draws = Math.max(0, Math.min(declared.draws, declared.max_draws))
  const select = control.querySelector('select')
  for (const choice of drawChoices(declared.max_draws)) {
    const option = document.createElement('option')
    option.value = String(choice)
    option.textContent = choice === 0 ? 'none' : String(choice)
    option.selected = choice === draws
    select.append(option)
  }
  select.addEventListener('change', () => {
    draws = Number(select.value)
    // the figures shade the draws of the reader and the table states them
    if (app !== null) {
      app.draws = draws
    }
    provenance = null
    for (const held of rows.values()) {
      held.statistics = null
    }
    render()
    if (shown !== '') {
      scheduleDraws(shown, JSON.parse(shown))
    }
  })
  control.hidden = false
  render()
}

/** Find the table of the page and follow what the panels of the app draw. */
function start() {
  table = document.querySelector('#pk-parameters table')
  note = document.querySelector('#pk-parameters .pk-note')
  control = document.querySelector('#pk-draws')
  app = document.querySelector('sbmlsim-app')
  if (table === null) {
    return
  }
  render()
  document.addEventListener('sbmlsim-shown', (event) => {
    void take(event)
  })
  readDeclaration().catch(() => {
    // a page whose endpoint does not answer its declaration keeps no control of the draws: the
    // panels of the app say the same thing in their own lines
    if (control !== null) {
      control.hidden = true
    }
  })
}

start()
