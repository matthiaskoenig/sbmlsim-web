/**
 * sbmlsim-web: the renderer of the interactive panels of an SBML model.
 *
 * Importing this module registers the custom element `<sbmlsim-panel>`, so a
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

/**
 * Register the element with the browser.
 *
 * @param tagName the tag to register it under, `PANEL_TAG` without; a class of
 *   a custom element belongs to one tag, so another tag is given a class of
 *   its own, built from the same component
 * @returns whether this call registered it; `false` for a tag which is taken
 *   already and for an environment without custom elements, in both of which
 *   the call changes nothing
 */
export function register(tagName: string = PANEL_TAG): boolean {
  if (typeof customElements === 'undefined') {
    return false
  }
  if (customElements.get(tagName) !== undefined) {
    return false
  }
  customElements.define(
    tagName,
    tagName === PANEL_TAG ? SbmlsimPanelElement : defineCustomElement(SbmlsimPanel),
  )
  return true
}

register()
