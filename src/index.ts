/**
 * sbmlsim-web: the renderer of the interactive panels of an SBML model.
 *
 * Importing this module registers the custom elements `<sbmlsim-panel>`, `<sbmlsim-app>` and
 * `<sbmlsim-figure>`, so a page loads one script and writes one tag. The registration is a no-op where
 * the tag name is taken already, which is what a page which loads the library
 * twice does, and it does nothing at all where there is no `customElements` at
 * all, which is what node and a server side render are; `register(tagName)` is
 * there for a page which wants the element under a name of its own.
 *
 * The library speaks the three versioned contracts of an sbmlsim endpoint
 * (`panel/1`, `paneldata/1`, `app/1`) and nothing else: see `./contract`.
 * `PanelClient` is the one place which calls `fetch`, or the function a page
 * registered for an endpoint `local:<name>` (`registerEndpoint`), which
 * answers the routes inside the page, e.g. on a simulator in a Web Worker;
 * `interpolate` reads a position between the points of a grid which was
 * fetched once, `plotSvg` draws the figure as one inline SVG string in the
 * tokens of `./theme.css`, which a host loads to get the design system and
 * overrides token by token.
 */

import { defineCustomElement } from 'vue'

import type { AppFigure, SimulateResponse } from './contract'
import type { DrawnFigure } from './interpolate'
import SbmlsimApp from './SbmlsimApp.ce.vue'
import SbmlsimFigure from './SbmlsimFigure.ce.vue'
import SbmlsimPanel from './SbmlsimPanel.ce.vue'
import { APP_TAG, FIGURE_TAG, PANEL_TAG, placeFigureTag, placePanelTag } from './tags'

export {
  CONTRACTS,
  ContractError,
  checkContract,
  figureOf,
  shownPanels,
  showsFigure,
} from './contract'
export type {
  AppDeclaration,
  AppFigure,
  AppPage,
  AppVariant,
  Band,
  ContractVersion,
  CurveScale,
  Grid,
  GridAxis,
  HealthResponse,
  KnobKind,
  ModelSummary,
  ModelsResponse,
  PanelAxis,
  PanelChoice,
  PanelCurve,
  PanelDataDeclaration,
  PanelDataResponse,
  PanelDataSeries,
  PanelDeclaration,
  PanelLimits,
  PanelSimulation,
  PanelSummary,
  PanelTexts,
  PanelUncertainty,
  PanelsResponse,
  Provenance,
  Scenario,
  SharedKnob,
  SharedPanel,
  SimulateRequest,
  SimulateResponse,
  Status,
  Uncertainty,
} from './contract'
export {
  DEFAULT_TIMEOUT,
  FAILURE_MESSAGES,
  LOCAL_PREFIX,
  PanelClient,
  PanelRequestError,
  failureKind,
  registerEndpoint,
} from './client'
export type { EndpointFetch, FailureKind } from './client'
export { interpolate, interpolateBands } from './interpolate'
export type { DrawnBand, DrawnFigure } from './interpolate'
export { canvasMeasure, fontOf } from './measure'
export type { FigureFont } from './measure'
export { plotGeometry, plotSvg, seriesColour, tableMeasure } from './plot'
export type {
  AxisEnds,
  Limits,
  PlotBox,
  PlotGeometry,
  PlotSpec,
  Points,
  Series,
  SeriesBand,
  TextMeasure,
} from './plot'

export { APP_TAG, FIGURE_TAG, PANEL_TAG }

/**
 * `<sbmlsim-panel>` as a page sees it: an element with its methods, which
 * `document.querySelector('sbmlsim-panel')` gives a TypeScript host.
 */
export interface SbmlsimPanelHTMLElement extends HTMLElement {
  /** Start the panel, or lift a freeze and do what it dropped. */
  activate(): Promise<void>
  /** Stop every pending request and freeze the knobs. */
  freeze(): void
  /** Put every knob back to the value its declaration states. */
  reset(): void
  /**
   * Set the scale of the y axis as a click on the switch of the panel does, where its curves
   * share one scale.
   *
   * @param on whether the axis is logarithmic
   */
  setLog(on: boolean): void
  /**
   * The answer of the last simulation of this panel, a copy, or `null`.
   *
   * `null` before the first answer, for a failure and for the stored fallback of a
   * declaration, which is no simulation. A readout which computes something of its own from
   * the curves a panel drew reads it here rather than running the same simulation again.
   */
  result(): SimulateResponse | null
  /**
   * The figure this panel draws, one curve per id at the position of its controls, or `null`.
   *
   * The grid of the last run read where the knobs stand, which is the figure itself.
   * `sbmlsim-shown` says when it changed.
   */
  drawn(): DrawnFigure | null
}

/** `<sbmlsim-app>` as a page sees it, an element which is driven by its attributes alone. */
export type SbmlsimAppHTMLElement = HTMLElement

/**
 * `<sbmlsim-figure>` as a page sees it: the drawing of a model, which is driven by its two
 * properties and reports a click as `sbmlsim-figure-select`, `detail: { key }`.
 */
export interface SbmlsimFigureHTMLElement extends HTMLElement {
  /** The figure of the app, `null` for none. */
  figure: AppFigure | null
  /** The key paths whose readouts are on screen, drawn marked. */
  marked: string[]
  /** The names of the key paths, the accessible names of the controls; the key path without one. */
  labels: Record<string, string>
}

/**
 * The class of a custom element of the package, which the browser builds an
 * element of; it is typed as the element a page sees and not as the class of
 * vue it is built with, so the types of the package import nothing of vue,
 * which every bundle inlines.
 */
export interface ElementClass<Element extends HTMLElement> {
  new (): Element
  readonly prototype: Element
}

/**
 * Type the class of a custom element vue built as the element a page sees.
 *
 * @param built the class
 * @returns the same class
 */
function elementClass<Element extends HTMLElement>(
  built: CustomElementConstructor,
): ElementClass<Element> {
  return built as ElementClass<Element>
}

declare global {
  interface HTMLElementTagNameMap {
    'sbmlsim-panel': SbmlsimPanelHTMLElement
    'sbmlsim-app': SbmlsimAppHTMLElement
    'sbmlsim-figure': SbmlsimFigureHTMLElement
  }
}

/**
 * The class of `<sbmlsim-panel>`, a custom element with a shadow root.
 *
 * It carries the attributes `endpoint`, `model`, `panel`, `layout`, `theme`,
 * `hover`, `data`, `fallback`, `timeout`, `heading-level`, `variant`, `values`,
 * `draws`, `auto`, `log`, `head` and `size` and the methods `activate()`, `freeze()`,
 * `reset()` and `setLog()`. It dispatches
 * `sbmlsim-error` when a request failed and `sbmlsim-result`, with the
 * `provenance` and the `spec_hash` of the answer, when a simulation succeeded:
 * never for a failure and never for a stored fallback, which is no simulation.
 */
export const SbmlsimPanelElement = elementClass<SbmlsimPanelHTMLElement>(
  defineCustomElement(SbmlsimPanel),
)

/**
 * The class of `<sbmlsim-app>`, the shell of the app of a model.
 *
 * It carries the attributes `endpoint`, `model`, `page`, `selection`, `theme`, `timeout`,
 * `draws` and `heading-level`, and it dispatches `sbmlsim-error` when the app could not be
 * read, `sbmlsim-page`, with the id of the page, when a reader switches the
 * page, and `sbmlsim-selection`, with the ids of the panels shown, when the selection changes. It places the panels under the tag `register` was called with, so the
 * panel has to be registered under it where the shell is used.
 */
export const SbmlsimAppElement = elementClass<SbmlsimAppHTMLElement>(
  defineCustomElement(SbmlsimApp),
)

/**
 * The class of `<sbmlsim-figure>`, the drawing of a model as the control of its app.
 *
 * It carries the properties `figure`, `marked` and `labels` and dispatches `sbmlsim-figure-select` with
 * the `key` path of the element a reader clicked, where that opens a panel.
 */
export const SbmlsimFigureElement = elementClass<SbmlsimFigureHTMLElement>(
  defineCustomElement(SbmlsimFigure),
)

/**
 * Define one element, unless its tag is taken or there is nothing to define it in.
 *
 * @param tagName the tag
 * @param build builds a class of its own for another tag, since a class of a
 *   custom element belongs to one tag
 * @returns whether this call defined it
 */
function define(tagName: string, build: () => CustomElementConstructor): boolean {
  if (typeof customElements === 'undefined' || customElements.get(tagName) !== undefined) {
    return false
  }
  customElements.define(tagName, build())
  return true
}

/**
 * Register the elements with the browser.
 *
 * @param tagName the tag to register the panel under, `PANEL_TAG` without
 * @param appTagName the tag to register the shell of an app under, `APP_TAG`
 *   without; a class of a custom element belongs to one tag, so another tag is
 *   given a class of its own, built from the same component; the shells place
 *   their panels under `tagName`, which a shell reads when it is created, so a
 *   second call changes what the shells built after it place and leaves the
 *   ones already on the page as they are
 * @param figureTagName the tag to register the figure of a model under, `FIGURE_TAG` without
 * @returns whether this call registered any of them; `false` for tags which
 *   are taken already and for an environment without custom elements, in both
 *   of which the call changes nothing
 */
export function register(
  tagName: string = PANEL_TAG,
  appTagName: string = APP_TAG,
  figureTagName: string = FIGURE_TAG,
): boolean {
  placePanelTag(tagName)
  placeFigureTag(figureTagName)
  const panel = define(tagName, () =>
    tagName === PANEL_TAG ? SbmlsimPanelElement : defineCustomElement(SbmlsimPanel),
  )
  const shell = define(appTagName, () =>
    appTagName === APP_TAG ? SbmlsimAppElement : defineCustomElement(SbmlsimApp),
  )
  const figure = define(figureTagName, () =>
    figureTagName === FIGURE_TAG ? SbmlsimFigureElement : defineCustomElement(SbmlsimFigure),
  )
  return panel || shell || figure
}

register()
