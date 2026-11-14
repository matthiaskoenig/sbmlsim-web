/**
 * The wire contracts of an sbmlsim endpoint: `panel/1`, `paneldata/1`, `app/1`.
 *
 * This module is the only place in this library which knows the shape of a
 * payload, and it knows nothing else: it imports nothing, it names no model and
 * no entity of a model, and every id (of a model, a panel, a knob, a curve or a
 * series) is data which comes from the payloads.
 *
 * `null` is the one way a payload says "no unit" and "no value": JSON carries no
 * `NaN`, so a point which did not integrate is `null` in the curves of a grid
 * and its flat index is in `status.failed`. A number which may be absent is
 * `null` here as well and never `undefined`.
 *
 * A payload may grow a field within its version, so a reader ignores the fields
 * it does not know; a field which is removed or changes its meaning is a new
 * version, which `checkContract` refuses.
 */

/** The version of each of the three contracts, as a payload carries it. */
export const CONTRACTS = {
  panel: 'panel/1',
  data: 'paneldata/1',
  app: 'app/1',
} as const

/** The version of one of the contracts, the `contract` of a payload. */
export type ContractVersion = (typeof CONTRACTS)[keyof typeof CONTRACTS]

/** A payload of a contract version this library does not speak. */
export class ContractError extends Error {
  /**
   * The `contract` of the payload as it carries it: a version for a payload
   * which states one, a value of another type for one which states something
   * which is no version, `undefined` for one which states none.
   */
  readonly contract: unknown
  /** The version which was expected. */
  readonly expected: string

  /**
   * Build the error of a payload which is not of the expected version.
   *
   * @param contract the `contract` of the payload, `undefined` for none
   * @param expected the version which was expected
   */
  constructor(contract: unknown, expected: string) {
    super(ContractError.of(contract, expected))
    this.name = 'ContractError'
    this.contract = contract
    this.expected = expected
  }

  /**
   * Get the message of a payload which is not of the expected version.
   *
   * @param contract the `contract` of the payload
   * @param expected the version which was expected
   * @returns the message, which names what the payload carries and what was
   *   expected, and says which of the two cases it is
   */
  private static of(contract: unknown, expected: string): string {
    if (contract === undefined) {
      return `The payload carries no contract and is not of '${expected}'.`
    }
    if (typeof contract === 'string') {
      return `The payload is of the contract '${contract}' and not of '${expected}'.`
    }
    return (
      `The payload carries ${ContractError.shown(contract)} as its contract, which is ` +
      `no version, and is not of '${expected}'.`
    )
  }

  /**
   * Show the `contract` of a payload which is no version at all.
   *
   * @param contract the `contract` of the payload, which is no string
   * @returns what it carries where that is a value to show, and what kind of
   *   value it is otherwise
   */
  private static shown(contract: unknown): string {
    switch (typeof contract) {
      case 'number':
      case 'boolean':
      case 'bigint':
        return String(contract)
      case 'object':
        return contract === null ? 'null' : 'an object'
      default:
        return `a value of the type ${typeof contract}`
    }
  }
}

/**
 * Check that a body is of the expected contract version.
 *
 * @param body the parsed body of an answer of the endpoint
 * @param expected the version it has to carry, one of `CONTRACTS`
 * @throws ContractError for a body of another version, for one whose `contract`
 *   is no version and for one which carries no `contract` at all, a body which
 *   is no object among them
 */
export function checkContract(body: unknown, expected: string): void {
  const contract =
    typeof body === 'object' && body !== null && 'contract' in body ? body.contract : undefined
  if (contract !== expected) {
    throw new ContractError(contract, expected)
  }
}

/** The scale of the axis a curve is drawn on. */
export type CurveScale = 'linear' | 'log'

/** The kind of a knob: bounds a reader moves over, or a list of choices. */
export type KnobKind = 'range' | 'choice'

/** One choice of a knob of the kind `choice`. */
export interface PanelChoice {
  /** The choice as it is shown. */
  label: string
  /** The value the knob sets, in the unit of the knob. */
  value: number
}

/**
 * A knob of a panel: a value a reader sets, and an axis of a grid.
 *
 * A knob sets an entity of the model, or none: a knob without a target is read
 * by the formulas of the derived values of its simulation
 * (`PanelSimulation.derived`), e.g. a creatinine clearance which derives the
 * renal function the model has. A renderer draws and sends both alike, by the
 * id of the knob, and reads no target.
 */
export interface PanelAxis {
  /** The id of the knob, the key of its value in a request and of its axis in a grid. */
  id: string
  /** The knob as it is shown. */
  label: string
  /** The entity of the model the knob sets, `null` for a knob the derived values read. */
  target: string | null
  /** The unit of its values, `null` for the unit of its target in the model. */
  unit: string | null
  /** `range` for a knob of bounds, `choice` for one of choices. */
  kind: KnobKind
  /** The smallest value of a range knob, `null` for a choice knob. */
  min: number | null
  /** The largest value of a range knob, `null` for a choice knob. */
  max: number | null
  /** The points a grid over a range knob runs by default. */
  steps: number
  /**
   * The choices of a choice knob in their order, and the named stops of a
   * range knob, e.g. the stages of a renal impairment over a clearance, each a
   * value inside its bounds; empty for a range knob without stops.
   */
  choices: PanelChoice[]
  /** The value the knob starts at. */
  default: number
}

/** A curve of a panel: one output of its simulation over the time. */
export interface PanelCurve {
  /** The id of the curve, a selection of the model and the key of its values in a grid. */
  id: string
  /** Its entry in the legend. */
  label: string
  /** The unit of its values, `null` for a selection the model gives no unit. */
  unit: string | null
  /** The scale its axis is drawn on. */
  scale: CurveScale
}

/** The declaration of the study data drawn under a curve of a panel. */
export interface PanelDataDeclaration {
  /** The id of the series, the key of its values in the study data of the panel. */
  id: string
  /** The series as it is shown, e.g. the study it comes from. */
  label: string
  /** The curve it belongs under, `null` for the curve of its own id. */
  curve: string | null
  /** The id of the figure or the table of the study it comes from; it is no path. */
  dataset: string
  /** The column of the times. */
  x: string
  /** The column of the values. */
  y: string
  /** The column of the error of the values, `null` for a series without one. */
  yerr: string | null
  /** The rows of the dataset the series is, `null` for every row of it. */
  sel: Record<string, string> | null
  /**
   * The state of the knobs the series was measured under, the value of every
   * knob it names, `null` for a series which was measured under none of them.
   *
   * A renderer draws the series only while the knobs are at that state, so the
   * data of one condition is never drawn under a curve of another; a knob the
   * state does not name is not constrained, and a series which names none is
   * drawn whatever the knobs are set to. Every knob it names is a knob of the
   * kind `choice` and every value one of the choices of its knob, which the
   * endpoint checks where a panel is declared.
   */
  at: Record<string, number> | null
  /** A quantity the values are multiplied by, `null` for none. */
  conversion: string | null
  /** The unit it is delivered in, `null` for the unit of its curve. */
  unit: string | null
}

/** The simulation a panel runs, the same for every point of its grid. */
export interface PanelSimulation {
  /** The variant of the model, `null` for the default variant of its project. */
  variant: string | null
  /** The end of the simulation, in the time unit of the model. */
  end: number
  /** The output steps; a run answers one time more. */
  points: number
  /** The unit the time axis is delivered in, `null` for the time unit of the model. */
  x_unit: string | null
  /** The values of the pre-initialization which are no knob, by the entity they set. */
  preinit: Record<string, number>
  /**
   * The values the endpoint derives from the knobs, a formula of the knobs by
   * the entity it sets, empty for a panel which derives none; a renderer never
   * evaluates them, it sends the knobs and the endpoint does.
   */
  derived: Record<string, string>
}

/** The bounds of a declaration and of a request alike, which the endpoint states. */
export interface PanelLimits {
  /** The largest end of the simulation of a panel, in the time unit of its model. */
  end: number
  /** The most output steps of that simulation. */
  points: number
  /** The most knobs of a panel, which are the axes one request may grid over (8). */
  knobs: number
  /** The most points of one axis, and of the product of the axes of one request. */
  grid: number
  /** The most curves of a panel. */
  curves: number
}

/** The texts of a panel and the limits of its axes. */
export interface PanelTexts {
  /** The id of the panel, the one a request names. */
  id: string
  /** The title of the panel. */
  title: string
  /** The question the panel answers, empty for a panel without one. */
  subtitle: string
  /**
   * The label of the time axis, `time` for a panel which declares none.
   *
   * A renderer appends the unit the run delivers its time in (`x_unit`), as
   * it appends the one of the curves to `y_label`, so the unit is no part of it.
   */
  x_label: string
  /**
   * The label of the value axis, empty for a panel which declares none.
   *
   * A renderer names that axis after the curves then, and appends the unit
   * they share in either case, so the unit is no part of it.
   */
  y_label: string
  /**
   * The lower end of the value axis, in the unit of the curves, `null` for an
   * axis which frames what the panel draws there.
   *
   * A declared end is the end of the axis exactly, whatever a curve reaches,
   * so two states of the knobs are drawn against one axis and can be
   * compared; a curve beyond it is cut at the plot.
   */
  y_min: number | null
  /** The upper end of the value axis, as `y_min`, `null` for one which frames what is drawn. */
  y_max: number | null
  /**
   * The end of the time axis, in the unit it is delivered in (`x_unit`),
   * `null` for the end of the simulation; nothing beyond it is drawn.
   */
  x_max: number | null
}

/** The declaration of a panel, the `panel/1` payload a renderer draws from. */
export interface PanelDeclaration {
  /** The version of the payload, `CONTRACTS.panel`. */
  contract: string
  /** The texts of the panel. */
  panel: PanelTexts
  /** Its knobs in the order they are shown, which are the axes of a grid. */
  axes: PanelAxis[]
  /** Its curves in the order they are drawn. */
  curves: PanelCurve[]
  /** The study data drawn under its curves. */
  data: PanelDataDeclaration[]
  /** The simulation it runs. */
  simulation: PanelSimulation
  /** The limits of the endpoint, which a renderer reads instead of carrying its own. */
  limits: PanelLimits
}

/** A request of a simulation of a panel: the knobs a reader set and the grid. */
export interface SimulateRequest {
  /** The value of a knob by its id, in the unit of the knob; a knob left out runs at its default. */
  values?: Record<string, number>
  /** The points of a knob of the grid by its id; a knob of the grid takes no value. */
  grid?: Record<string, number>
  /** The variant of the model to simulate; the one the panel declares without. */
  variant?: string
}

/** One axis of the grid a run covered. */
export interface GridAxis {
  /** The id of the knob of the axis. */
  id: string
  /** The knob as it is shown. */
  label: string
  /** The unit of the values, `null` for values which carry none. */
  unit: string | null
  /** The values of the knob the run covered, in their order. */
  values: number[]
}

/** The outcome of a run of a panel. */
export interface Status {
  /** Whether every point of the grid integrated. */
  ok: boolean
  /** The points of the grid, one for a run without a grid. */
  points: number
  /** The flat indices in C order of the points which did not integrate. */
  failed: number[]
}

/** Where the curves of an answer come from. */
export interface Provenance {
  /** The id of the model, the one the request named. */
  model: string
  /** The id of the panel. */
  panel: string
  /** The sha256 of the SBML file which was simulated. */
  model_sha256: string
  /**
   * The name of the SBML which was simulated: the variant the request asked
   * for, else the one the panel declares, else the first variant of the
   * project, which is its default. It is resolved, so an answer of a
   * simulation always names one.
   */
  variant: string | null
  /** The engine which integrated. */
  engine: string
  /** The version of sbmlsim which ran the simulation. */
  sbmlsim: string
  /** The seconds the run took in the service. */
  seconds: number
  /** When the run finished, an ISO 8601 timestamp in UTC. */
  created: string
}

/**
 * The grid of a run: one row per point of `dims` in C order, the last axis
 * fastest, and `x` the output times of every row.
 *
 * A value which did not integrate is `null` and the flat index of its point is
 * in `status.failed`, which is what `interpolate` reads.
 */
export interface Grid {
  /** The axes of the grid, empty for a run of one point. */
  dims: GridAxis[]
  /** The output times of every row. */
  x: number[]
  /** The rows of every curve by its id, one row per point of the grid. */
  curves: Record<string, (number | null)[][]>
  /** The outcome of the run. */
  status: Status
}

/** The answer of a simulation of a panel, the `panel/1` payload of a run. */
export interface SimulateResponse extends Grid {
  /** The version of the payload, `CONTRACTS.panel`. */
  contract: string
  /** The sha256 of the resolved request, which identifies what was simulated. */
  spec_hash: string
  /** The unit of every curve and, under `x`, of the times; `null` for no unit. */
  units: Record<string, string | null>
  /** Where the curves come from. */
  provenance: Provenance
}

/** One series of the study data of a panel, on the axis of its curve. */
export interface PanelDataSeries {
  /** The id of the series, the one of its declaration. */
  id: string
  /** The series as it is shown, e.g. the study it comes from. */
  label: string
  /** The times of the points, in the unit `x_unit` names. */
  x: number[]
  /** The values of the points, in the unit `unit` names. */
  y: number[]
  /** The error of every value, `null` for a point or a series without one. */
  yerr: (number | null)[] | null
  /** The unit of the times, `null` for times which carry none. */
  x_unit: string | null
  /** The unit of the values, `null` for values which carry none. */
  unit: string | null
  /** The number of subjects behind every point, `null` for a dataset without them. */
  count: number[] | null
}

/** The study data behind the curves of a panel, the `paneldata/1` payload. */
export interface PanelDataResponse {
  /** The version of the payload, `CONTRACTS.data`. */
  contract: string
  /** The series the panel declares in its order, empty for a panel without data. */
  series: PanelDataSeries[]
}

/** A named state of the knobs of a page, e.g. an example patient, which a reader picks. */
export interface Scenario {
  /** The id of the scenario, distinct within its page. */
  id: string
  /** The scenario as it is shown. */
  label: string
  /**
   * The value of every knob it sets, by the id of the knob, in the unit of the
   * knob; a knob it does not name keeps the value it has. Every knob it names
   * is a knob the panels of its page share (`AppDeclaration.shared`).
   */
  values: Record<string, number>
}

/** One page of the app of a model. */
export interface AppPage {
  /** The id of the page, the one a link of the app names. */
  id: string
  /** The page as it is shown, its entry in the navigation. */
  title: string
  /** The ids of its panels in the order they are shown. */
  panels: string[]
  /** The scenarios a reader picks the knobs of the page from, empty for a page without. */
  scenarios: Scenario[]
}

/** One variant of the model of an app, which a reader switches to. */
export interface AppVariant {
  /** The id of the variant, a variant of the model. */
  id: string
  /** The variant as it is shown. */
  label: string
}

/** A panel a shared knob of a page sets. */
export interface SharedPanel {
  /** The id of the panel, one of the panels of the page. */
  id: string
  /** The title of the panel, which names it to a reader of the control. */
  title: string
}

/** A knob more than one panel of a page declares, which the page shows one control of. */
export interface SharedKnob {
  /** Its declaration, which every panel of `panels` declares alike. */
  knob: PanelAxis
  /** The panels of the page which declare it, in the order the page shows them. */
  panels: SharedPanel[]
}

/** The app of a model: the pages of its panels, the `app/1` payload. */
export interface AppDeclaration {
  /** The version of the payload, `CONTRACTS.app`. */
  contract: string
  /** The title of the app, the model as it is shown. */
  title: string
  /** What the model is, shown below the title. */
  subtitle: string
  /** The pages of the app in the order they are shown. */
  pages: AppPage[]
  /** The variants a reader switches between, empty for the default variant alone. */
  variants: AppVariant[]
  /** The citation of the model, shown in the provenance footer. */
  citation: string
  /** The DOI of the model, shown in that footer. */
  doi: string
  /** The licenses of the model and its data, shown in that footer. */
  licenses: string[]
  /**
   * The knobs the panels of a page share, by the id of the page, each in the
   * order the first panel which declares one lists them; empty for a page whose
   * panels share none. The service derives them from the panels, so they are
   * no part of the declaration of the app.
   */
  shared: Record<string, SharedKnob[]>
  /**
   * The panels of a page with their titles and subtitles, by the id of the
   * page, in the order the page shows them. They are the heads of the
   * declarations of the panels, which the shell lays the head of each card out
   * with before its panel has read its declaration; the service derives them
   * from the panels, so they are no part of the declaration of the app either.
   */
  heads: Record<string, PanelSummary[]>
  /**
   * The id of the variant the app answers: the one it was read in with
   * `?variant=`, else the default variant of the model, which an app read
   * without one is of. Its knobs, its scenarios and its heads are of that
   * variant.
   */
  variant: string
}

/** A model the endpoint serves, as it is listed. */
export interface ModelSummary {
  /** The id of the model, the one a request names. */
  id: string
  /** The model as it is shown. */
  title: string
}

/** The models the endpoint serves, in the order it serves them. */
export interface ModelsResponse {
  /** The version of the payload, `CONTRACTS.panel`. */
  contract: string
  /** The models. */
  models: ModelSummary[]
}

/** A panel of a model as it is listed, without its knobs and curves. */
export interface PanelSummary {
  /** The id of the panel, the one a request names. */
  id: string
  /** The title of the panel. */
  title: string
  /** The question the panel answers. */
  subtitle: string
}

/** The panels a model declares, in the order it declares them. */
export interface PanelsResponse {
  /** The version of the payload, `CONTRACTS.panel`. */
  contract: string
  /** The id of the model. */
  model: string
  /** The panels, whose declaration is fetched one by one. */
  panels: PanelSummary[]
}

/** The answer of the health check of the endpoint. */
export interface HealthResponse {
  /** `ok` for an endpoint which is up. */
  status: string
  /** The version of sbmlsim which runs the simulations. */
  sbmlsim: string
  /** The number of models it serves. */
  models: number
}
