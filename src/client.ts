/**
 * The HTTP client of an sbmlsim endpoint and what a failed request is.
 *
 * `PanelClient` is the only place in this library which calls `fetch`. It
 * speaks the routes of `python -m sbmlsim.serve` and nothing else, it bounds
 * every request with a timeout, it checks the contract version of every answer
 * before it is read, and it fails with one typed error whose `kind` is a short
 * machine string: no status code, no url and no host ever reaches the page
 * which embeds a panel, because a reader cannot act on them and a deployment
 * should not have to publish them.
 *
 * `FAILURE_MESSAGES` is the one line a reader is shown per kind. It is a fixed
 * table rather than the message of the error which was caught, so that nothing
 * a server, a browser or a stack trace writes can leak into a page.
 */

import { CONTRACTS, ContractError, checkContract } from './contract'
import type {
  AppDeclaration,
  PanelDataResponse,
  PanelDataSeries,
  PanelDeclaration,
  SimulateRequest,
  SimulateResponse,
} from './contract'

/**
 * What went wrong with a request, a short machine string.
 *
 * `aborted` is the one which is no failure: it is what a request which was
 * superseded or stopped answers with, and the element which stopped it drops
 * it instead of showing it. `internal` is never thrown by the client; it is
 * the kind of a failure of the renderer itself.
 */
export type FailureKind =
  'network' | 'timeout' | 'http' | 'contract' | 'body' | 'aborted' | 'internal'

/** The one line a reader is shown per kind; none of them names a url or a host. */
export const FAILURE_MESSAGES: Readonly<Record<FailureKind, string>> = {
  network: 'The simulation endpoint could not be reached.',
  timeout: 'The simulation endpoint did not answer in time.',
  http: 'The simulation endpoint refused the request.',
  contract: 'The simulation endpoint speaks another version of the panel contract.',
  body: 'The answer of the simulation endpoint could not be read.',
  aborted: 'The request was stopped.',
  internal: 'The panel could not be drawn.',
}

/** A request which did not answer with the payload it was asked for. */
export class PanelRequestError extends Error {
  /** What went wrong, the kind a page reads from an `sbmlsim-error` event. */
  readonly kind: FailureKind

  /**
   * Build the error of a request which failed.
   *
   * @param kind what went wrong
   * @param cause the error which was caught, for a caller which debugs; it is
   *   never shown to a reader and never leaves the element
   */
  constructor(kind: FailureKind, cause?: unknown) {
    super(FAILURE_MESSAGES[kind], cause === undefined ? undefined : { cause })
    this.name = 'PanelRequestError'
    this.kind = kind
  }
}

/** The milliseconds a request is given before it is stopped. */
export const DEFAULT_TIMEOUT = 8000

/** The smallest timeout which is taken as one; below it the default is used. */
const LEAST_TIMEOUT = 1

/**
 * Get the kind of an error which was caught anywhere in the element.
 *
 * @param error the error
 * @returns its kind for a `PanelRequestError`, `internal` for everything else,
 *   which is a failure of the renderer and not of the endpoint
 */
export function failureKind(error: unknown): FailureKind {
  return error instanceof PanelRequestError ? error.kind : 'internal'
}

/**
 * Join an endpoint and a path of a route.
 *
 * @param endpoint the endpoint, with or without a trailing slash; an empty one
 *   makes the path relative to the page, which is the teaching mode where the
 *   page is served by the service itself
 * @param path the path of the route, which starts with a slash
 * @returns the url of the request
 */
function join(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, '')}${path}`
}

/**
 * Get the query of a route which is read in a variant of the model.
 *
 * @param variant the id of the variant, empty for the default variant
 * @returns `?variant=<id>` with the id encoded, empty for the default variant,
 *   so a route of the default variant is the route it always was
 */
function variantQuery(variant: string): string {
  return variant === '' ? '' : `?variant=${encodeURIComponent(variant)}`
}

/**
 * Get whether a value is a plain object, which every payload of a route is.
 *
 * @param value the parsed body
 * @returns whether fields can be read off it
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Get whether every item of a list is an object carrying a string `id`.
 *
 * @param items the items of a list of a payload
 * @returns whether each of them can be read as one of its kind
 */
function allIdentified(items: unknown[]): boolean {
  return items.every((one) => isObject(one) && typeof one.id === 'string')
}

/**
 * Get whether a value of a payload is a number which may be absent.
 *
 * @param value the value
 * @returns whether it is a finite number, `null` or absent
 */
function isLimit(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value))
  )
}

/**
 * Get whether a value is a record of text by text.
 *
 * @param value the value
 * @returns whether it is an object whose every value is text
 */
function isTexts(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.values(value).every((one) => typeof one === 'string')
}

/**
 * Get whether a value is a record of numbers by text.
 *
 * @param value the value
 * @returns whether it is an object whose every value is a finite number
 */
function isNumbers(value: unknown): value is Record<string, number> {
  return (
    isObject(value) &&
    Object.values(value).every((one) => typeof one === 'number' && Number.isFinite(one))
  )
}

/**
 * Check that a body carries the fields of a declaration before it is read.
 *
 * The check is the shape and not the values: a payload may grow a field within
 * its version, so an unknown field is ignored, while a body whose `axes` is no
 * array is no declaration whatever its `contract` says. The items of the three
 * lists are checked as well, because the panel walks them to build its
 * controls, its curves and its series: a body which is checked here is a body
 * every reader of it can read without a guard of its own.
 *
 * A field the contract grew within its version may be absent, since an
 * endpoint which speaks the version without it is still one of the version: the
 * limits of the axes are then `null` and the derived values none, which is what
 * a declaration which states neither means. A field which is present and of
 * another type is no declaration.
 *
 * @param body the parsed body, of the contract `panel/1`
 * @returns the declaration, with the fields which may be absent filled in
 * @throws PanelRequestError of the kind `body` for a body which is no
 *   declaration
 */
function asDeclaration(body: unknown): PanelDeclaration {
  if (
    !isObject(body) ||
    !isObject(body.panel) ||
    !Array.isArray(body.axes) ||
    !Array.isArray(body.curves) ||
    !Array.isArray(body.data) ||
    !allIdentified(body.axes) ||
    !allIdentified(body.curves) ||
    !allIdentified(body.data) ||
    !isObject(body.simulation) ||
    !isObject(body.limits) ||
    !isLimit(body.panel.y_min) ||
    !isLimit(body.panel.y_max) ||
    !isLimit(body.panel.x_max) ||
    !(body.simulation.derived === undefined || isTexts(body.simulation.derived))
  ) {
    throw new PanelRequestError('body')
  }
  const panel = body.panel
  const simulation = body.simulation
  return {
    ...body,
    panel: {
      ...panel,
      y_min: panel.y_min ?? null,
      y_max: panel.y_max ?? null,
      x_max: panel.x_max ?? null,
    },
    simulation: { ...simulation, derived: simulation.derived ?? {} },
  } as unknown as PanelDeclaration
}

/**
 * Get whether a value is a knob of the shape a shared knob is read with.
 *
 * A knob may carry no target, which is a knob the derived values of the
 * simulation read (`PanelAxis.target`); nothing here reads it beyond its type.
 * The items of its choices are not checked here but where a control is built of
 * them (`knobsOf`, `drawableKnob`), alike for a knob of a panel and a knob of an
 * app: a choice which cannot be drawn costs that knob in either, and never the
 * whole declaration or the whole app.
 *
 * @param value the item
 * @returns whether it carries the fields a control reads
 */
function isKnob(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.kind === 'string' &&
    (value.target === undefined || value.target === null || typeof value.target === 'string') &&
    Array.isArray(value.choices) &&
    typeof value.default === 'number'
  )
}

/**
 * Get whether the shared knobs of an app can be read.
 *
 * @param value the `shared` of the body
 * @returns whether it is an object of lists of knobs, each with the panels it sets
 */
function isShared(value: unknown): boolean {
  return (
    isObject(value) &&
    Object.values(value).every(
      (page) =>
        Array.isArray(page) &&
        page.every(
          (one) =>
            isObject(one) &&
            isKnob(one.knob) &&
            Array.isArray(one.panels) &&
            one.panels.every(
              (panel) =>
                isObject(panel) && typeof panel.id === 'string' && typeof panel.title === 'string',
            ),
        ),
    )
  )
}

/**
 * Get whether the heads of the panels of an app can be read.
 *
 * @param value the `heads` of the body
 * @returns whether it is an object of lists of panels, each with its id, its
 *   title and its subtitle
 */
function isHeads(value: unknown): boolean {
  return (
    isObject(value) &&
    Object.values(value).every(
      (page) =>
        Array.isArray(page) &&
        page.every(
          (one) =>
            isObject(one) &&
            typeof one.id === 'string' &&
            typeof one.title === 'string' &&
            typeof one.subtitle === 'string',
        ),
    )
  )
}

/**
 * Get whether the scenarios of a page can be read.
 *
 * @param value the `scenarios` of a page, absent for a page of an endpoint
 *   which states none
 * @returns whether it is absent or a list of scenarios, each with its id, which
 *   is not empty (an SId never is, and the select of the scenarios takes the
 *   empty value for the state of no scenario), its label and the values it sets
 */
function isScenarios(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (one) =>
          isObject(one) &&
          typeof one.id === 'string' &&
          one.id !== '' &&
          typeof one.label === 'string' &&
          isNumbers(one.values),
      ))
  )
}

/**
 * Check that a body carries the fields of an app before it is read.
 *
 * The items of the pages, of the variants, of the shared knobs and of the
 * heads are checked as well, because the shell walks them to build its
 * navigation, its switcher, its controls and its cards. A body without the
 * shared knobs is no app: the shell would show every panel with controls of
 * its own, which is a page of two states when its panels share a knob. A body
 * without the heads is none either, since every card would move when the head
 * of its panel arrives. The scenarios of a page may be absent, as of an
 * endpoint which speaks the version without them, and are none then, and so
 * may the variant the app answers, which is empty then.
 *
 * @param body the parsed body, of the contract `app/1`
 * @returns the app, every page with its scenarios
 * @throws PanelRequestError of the kind `body` for a body which is no app
 */
function asApp(body: unknown): AppDeclaration {
  if (
    !isObject(body) ||
    typeof body.title !== 'string' ||
    typeof body.subtitle !== 'string' ||
    typeof body.citation !== 'string' ||
    typeof body.doi !== 'string' ||
    !Array.isArray(body.licenses) ||
    !Array.isArray(body.pages) ||
    !Array.isArray(body.variants) ||
    !allIdentified(body.pages) ||
    !allIdentified(body.variants) ||
    !body.pages.every(
      (page) =>
        typeof (page as Record<string, unknown>).title === 'string' &&
        Array.isArray((page as Record<string, unknown>).panels) &&
        isScenarios((page as Record<string, unknown>).scenarios),
    ) ||
    !body.variants.every((one) => typeof (one as Record<string, unknown>).label === 'string') ||
    !isShared(body.shared) ||
    !isHeads(body.heads) ||
    !(body.variant === undefined || typeof body.variant === 'string')
  ) {
    throw new PanelRequestError('body')
  }
  const pages = (body.pages as Record<string, unknown>[]).map((page) => ({
    ...page,
    scenarios: page.scenarios ?? [],
  }))
  return { ...body, pages, variant: body.variant ?? '' } as unknown as AppDeclaration
}

/**
 * Get whether an item of `dims` is an axis of a grid.
 *
 * @param value the item
 * @returns whether it carries the id and the values the interpolation reads
 */
function isAxisOfGrid(value: unknown): boolean {
  return isObject(value) && typeof value.id === 'string' && Array.isArray(value.values)
}

/**
 * Check that a body carries the fields of the answer of a run before it is read.
 *
 * The fields of the provenance are checked too, because the footer of a panel
 * writes them: a body which is checked here is a body every reader of it can
 * read without a guard of its own.
 *
 * @param body the parsed body, of the contract `panel/1`
 * @returns the answer of the run
 * @throws PanelRequestError of the kind `body` for a body which is no answer
 *   of a run
 */
function asGrid(body: unknown): SimulateResponse {
  if (
    !isObject(body) ||
    typeof body.spec_hash !== 'string' ||
    !Array.isArray(body.x) ||
    !Array.isArray(body.dims) ||
    !isObject(body.curves) ||
    !isObject(body.units) ||
    !isObject(body.status) ||
    !Array.isArray(body.status.failed) ||
    !body.dims.every(isAxisOfGrid) ||
    !isObject(body.provenance) ||
    typeof body.provenance.engine !== 'string' ||
    typeof body.provenance.seconds !== 'number'
  ) {
    throw new PanelRequestError('body')
  }
  return body as unknown as SimulateResponse
}

/**
 * Check that a body carries the series of the study data before it is read.
 *
 * @param body the parsed body, of the contract `paneldata/1`
 * @returns the series
 * @throws PanelRequestError of the kind `body` for a body which is no study data
 */
function asSeries(body: unknown): PanelDataSeries[] {
  if (!isObject(body) || !Array.isArray(body.series)) {
    throw new PanelRequestError('body')
  }
  return (body as unknown as PanelDataResponse).series
}

/**
 * The client of one sbmlsim endpoint.
 *
 * Every method answers the payload of its route or throws a
 * `PanelRequestError`; nothing else leaves the client, so a caller which
 * catches that one type catches a dead network, a slow endpoint, a refused
 * request, a payload of another contract version and a body which is not the
 * one of its route alike.
 */
export class PanelClient {
  /** The endpoint the client talks to, without a trailing slash. */
  readonly endpoint: string
  /** The milliseconds one request is given before it is stopped. */
  readonly timeoutMs: number

  /**
   * Build the client of an endpoint.
   *
   * @param endpoint the origin and path the routes hang under, e.g.
   *   `https://models.example.org`; an empty one makes every request relative
   *   to the page, which is what the service does when it serves the page
   *   itself
   * @param timeoutMs the milliseconds one request is given, `DEFAULT_TIMEOUT`
   *   for a value which is no positive number
   */
  constructor(endpoint: string, timeoutMs: number = DEFAULT_TIMEOUT) {
    this.endpoint = endpoint.replace(/\/+$/, '')
    this.timeoutMs =
      Number.isFinite(timeoutMs) && timeoutMs >= LEAST_TIMEOUT ? timeoutMs : DEFAULT_TIMEOUT
  }

  /**
   * Get the app of a model, the route `app`.
   *
   * The declarations of the panels may differ by the variant of the model, and
   * so may what the app derives from them, the knobs its pages share and the
   * heads of their panels: the app is read in the variant a reader chose.
   *
   * @param model the id of the model, which the endpoint serves
   * @param signal a signal which stops the request
   * @param variant the variant the app is read in, the default variant of the
   *   model for an empty one
   * @returns the pages, the variants and the provenance texts of the app
   * @throws PanelRequestError for every failure; a model which declares no app
   *   and a variant the app does not name are `http` failures
   */
  async app(model: string, signal?: AbortSignal, variant = ''): Promise<AppDeclaration> {
    const body = await this.read(
      `/api/models/${encodeURIComponent(model)}/app${variantQuery(variant)}`,
      CONTRACTS.app,
      signal,
    )
    return asApp(body)
  }

  /**
   * Get the declaration of a panel, the route `panels/{panel}`.
   *
   * @param model the id of the model, which the endpoint serves
   * @param panel the id of the panel of that model
   * @param signal a signal which stops the request, e.g. of a superseded move
   * @param variant the variant whose declaration is read, the default variant
   *   of the model for an empty one: a declaration may differ by the variant
   * @returns the declaration of the panel
   * @throws PanelRequestError for every failure
   */
  async panel(
    model: string,
    panel: string,
    signal?: AbortSignal,
    variant = '',
  ): Promise<PanelDeclaration> {
    const body = await this.read(
      `${this.panelPath(model, panel)}${variantQuery(variant)}`,
      CONTRACTS.panel,
      signal,
    )
    return asDeclaration(body)
  }

  /**
   * Get the study data behind the curves of a panel, the route `data`.
   *
   * @param model the id of the model
   * @param panel the id of the panel
   * @param signal a signal which stops the request
   * @param variant the variant whose declaration names the series, the default
   *   variant of the model for an empty one
   * @returns the series the panel declares, in its order; empty for a panel
   *   which declares none
   * @throws PanelRequestError for every failure
   */
  async data(
    model: string,
    panel: string,
    signal?: AbortSignal,
    variant = '',
  ): Promise<PanelDataSeries[]> {
    const body = await this.read(
      `${this.panelPath(model, panel)}/data${variantQuery(variant)}`,
      CONTRACTS.data,
      signal,
    )
    return asSeries(body)
  }

  /**
   * Run a simulation of a panel, the route `simulate`.
   *
   * @param model the id of the model
   * @param panel the id of the panel
   * @param body the values of the knobs and the points of the grid, which the
   *   endpoint bounds by the limits its declaration carries
   * @param signal a signal which stops the request
   * @returns the grid of the run with its units and its provenance, which is a
   *   `Grid` and more
   * @throws PanelRequestError for every failure
   */
  async simulate(
    model: string,
    panel: string,
    body: SimulateRequest,
    signal?: AbortSignal,
  ): Promise<SimulateResponse> {
    const answer = await this.read(
      `${this.panelPath(model, panel)}/simulate`,
      CONTRACTS.panel,
      signal,
      body,
    )
    return asGrid(answer)
  }

  /**
   * Read a stored answer of a run from a url of its own.
   *
   * The url is not a route of the endpoint: it is the static file a page ships
   * next to itself as the fallback of a panel, which is fetched while the
   * endpoint is asked and drawn when the endpoint does not answer.
   *
   * @param url the url of the file, absolute or relative to the page
   * @param signal a signal which stops the request
   * @returns the stored answer
   * @throws PanelRequestError for every failure
   */
  async stored(url: string, signal?: AbortSignal): Promise<SimulateResponse> {
    const body = await this.fetchJson(url, CONTRACTS.panel, signal)
    return asGrid(body)
  }

  /**
   * Get the path of the routes of one panel.
   *
   * @param model the id of the model
   * @param panel the id of the panel
   * @returns the path, with both ids encoded, so an id is a path component and
   *   never a path
   */
  private panelPath(model: string, panel: string): string {
    return `/api/models/${encodeURIComponent(model)}/panels/${encodeURIComponent(panel)}`
  }

  /**
   * Read a route of the endpoint.
   *
   * @param path the path of the route
   * @param contract the version the answer has to carry
   * @param signal a signal which stops the request
   * @param body the body of a POST, none for a GET
   * @returns the parsed body
   * @throws PanelRequestError for every failure
   */
  private async read(
    path: string,
    contract: string,
    signal: AbortSignal | undefined,
    body?: SimulateRequest,
  ): Promise<unknown> {
    return this.fetchJson(join(this.endpoint, path), contract, signal, body)
  }

  /**
   * Fetch one url and read its body as the payload of a contract.
   *
   * The request carries no credential: a page of another origin may not send
   * one to the service anyway, and a panel is public data.
   *
   * @param url the url
   * @param contract the version the answer has to carry
   * @param signal a signal which stops the request
   * @param body the body of a POST, none for a GET
   * @returns the parsed body
   * @throws PanelRequestError of the kind `timeout` for a request which was
   *   not answered within `timeoutMs`, `aborted` for one the caller stopped,
   *   `network` for one which never reached the endpoint, `http` for a status
   *   which is no success, `contract` for a payload of another version and
   *   `body` for one which cannot be read
   */
  private async fetchJson(
    url: string,
    contract: string,
    signal: AbortSignal | undefined,
    body?: SimulateRequest,
  ): Promise<unknown> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.timeoutMs)
    const stop = (): void => {
      controller.abort()
    }
    signal?.addEventListener('abort', stop)
    try {
      const answer = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'omit',
        headers:
          body === undefined
            ? { accept: 'application/json' }
            : { accept: 'application/json', 'content-type': 'application/json' },
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (!answer.ok) {
        throw new PanelRequestError('http')
      }
      let parsed: unknown
      try {
        parsed = await answer.json()
      } catch (error) {
        throw new PanelRequestError('body', error)
      }
      checkContract(parsed, contract)
      return parsed
    } catch (error) {
      throw PanelClient.failure(error, timedOut)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
    }
  }

  /**
   * Get the error a failed request throws.
   *
   * @param error the error which was caught
   * @param timedOut whether the request was stopped by its own timeout
   * @returns the typed error; one which already is one is kept, a contract
   *   error becomes `contract`, an abort becomes `timeout` or `aborted`, and
   *   everything else - a `TypeError` of `fetch` above all - becomes `network`
   */
  private static failure(error: unknown, timedOut: boolean): PanelRequestError {
    if (error instanceof PanelRequestError) {
      return error
    }
    if (error instanceof ContractError) {
      return new PanelRequestError('contract', error)
    }
    if (timedOut) {
      return new PanelRequestError('timeout', error)
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return new PanelRequestError('aborted', error)
    }
    return new PanelRequestError('network', error)
  }
}
