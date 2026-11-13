/**
 * sbmlsim-web: the renderer of the interactive panels of an SBML model.
 *
 * Importing this module registers the custom elements `<sbmlsim-panel>` and `<sbmlsim-app>`, so a
 * page loads one script and writes one tag. The registration is a no-op where
 * the tag name is taken already, which is what a page which loads the library
 * twice does, and it does nothing at all where there is no `customElements` at
 * all, which is what node and a server side render are; `register(tagName)` is
 * there for a page which wants the element under a name of its own.
 *
 * The library speaks the three versioned contracts of an sbmlsim endpoint
 * (`panel/1`, `paneldata/1`, `app/1`) and nothing else: see `./contract`.
 * `PanelClient` is the one place which calls `fetch`, `interpolate` reads a
 * position between the points of a grid which was fetched once, `plotSvg`
 * draws the figure as one inline SVG string in the tokens of `./theme.css`,
 * which a host loads to get the design system and overrides token by token.
 */

import { defineCustomElement } from 'vue'

import SbmlsimApp from './SbmlsimApp.ce.vue'
import SbmlsimPanel from './SbmlsimPanel.ce.vue'

export { CONTRACTS, ContractError, checkContract } from './contract'
export type {
  AppDeclaration,
  AppPage,
  AppVariant,
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
  PanelsResponse,
  Provenance,
  SimulateRequest,
  SimulateResponse,
  Status,
} from './contract'
export {
  DEFAULT_TIMEOUT,
  FAILURE_MESSAGES,
  PanelClient,
  PanelRequestError,
  failureKind,
} from './client'
export type { FailureKind } from './client'
export { interpolate } from './interpolate'
export { plotGeometry, plotSvg, seriesColour } from './plot'
export type { PlotBox, PlotGeometry, PlotSpec, Points, Series } from './plot'

/** The tag the element is registered under unless a page asks for another one. */
export const PANEL_TAG = 'sbmlsim-panel'

/**
 * The class of `<sbmlsim-panel>`, a custom element with a shadow root.
 *
 * It carries the attributes `endpoint`, `model`, `panel`, `layout`, `theme`,
 * `hover`, `data`, `fallback`, `timeout`, `heading-level` and `auto` and the
 * methods `activate()`, `freeze()` and `reset()`, and it dispatches
 * `sbmlsim-error` when a request failed.
 */
export const SbmlsimPanelElement = defineCustomElement(SbmlsimPanel)

/** The tag of the shell of an app, which places the `<sbmlsim-panel>` elements of its pages. */
export const APP_TAG = 'sbmlsim-app'

/**
 * The class of `<sbmlsim-app>`, the shell of the app of a model.
 *
 * It carries the attributes `endpoint`, `model`, `page`, `theme`, `timeout` and
 * `heading-level`, and it dispatches `sbmlsim-error` when the app could not be
 * read. It places `<sbmlsim-panel>` elements, so the panel has to be registered
 * under `PANEL_TAG` where the shell is used.
 */
export const SbmlsimAppElement = defineCustomElement(SbmlsimApp)

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
 *   given a class of its own, built from the same component
 * @returns whether this call registered either of them; `false` for tags which
 *   are taken already and for an environment without custom elements, in both
 *   of which the call changes nothing
 */
export function register(tagName: string = PANEL_TAG, appTagName: string = APP_TAG): boolean {
  const panel = define(tagName, () =>
    tagName === PANEL_TAG ? SbmlsimPanelElement : defineCustomElement(SbmlsimPanel),
  )
  const shell = define(appTagName, () =>
    appTagName === APP_TAG ? SbmlsimAppElement : defineCustomElement(SbmlsimApp),
  )
  return panel || shell
}

register()
