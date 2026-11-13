/**
 * sbmlsim-web: the renderer of the interactive panels of an SBML model.
 *
 * The library speaks the three versioned contracts of an sbmlsim endpoint
 * (`panel/1`, `paneldata/1`, `app/1`) and nothing else: see `./contract`. The
 * components which draw a panel are added on top of it.
 *
 * `plotSvg` draws the figure of a panel as one inline SVG string, in the
 * tokens of `./theme.css`, which a host loads to get the design system and
 * overrides token by token.
 */

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
export { interpolate } from './interpolate'
export { plotSvg } from './plot'
export type { PlotSpec, Points, Series } from './plot'
