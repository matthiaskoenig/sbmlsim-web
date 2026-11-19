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
 *
 * An endpoint which starts with `local:` (`LOCAL_PREFIX`) is no server but a
 * function of the page itself, which the page registers with
 * `registerEndpoint`: a page which simulates in the browser of its reader, in
 * a Web Worker, answers the routes of the service with a function which has the
 * signature of `fetch` (`EndpointFetch`), and the client hands it every request
 * it would hand `fetch` and reads its answer as one of the network, so the
 * elements cannot tell the two apart and every failure is the failure of the
 * same kind.
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
 * it instead of showing it. `busy` is a request the endpoint shed as long as
 * the client retried it (`BUSY_ATTEMPTS`). `internal` is never thrown by the
 * client; it is the kind of a failure of the renderer itself.
 */
export type FailureKind =
  'network' | 'timeout' | 'busy' | 'http' | 'contract' | 'body' | 'aborted' | 'internal'

/** The one line a reader is shown per kind; none of them names a url or a host. */
export const FAILURE_MESSAGES: Readonly<Record<FailureKind, string>> = {
  network: 'The simulation endpoint could not be reached.',
  timeout: 'The simulation endpoint did not answer in time.',
  busy: 'The simulation endpoint is busy; move a control to try again.',
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
 * How often a request is sent which the endpoint sheds.
 *
 * An endpoint which holds as many requests of a model as it may answers one
 * more at once with a 503 and a `Retry-After` (sbmlsim 0.24.0, "One model
 * never stalls the others" of its `docs/serve.md`), which asks the client to
 * send it again: a page of several panels, or several pages, can ask for more
 * than that at once. The client sends it again after the time the answer asks
 * for, with a jitter of up to half of it so the panels of a page do not come
 * back together, and gives up after this many tries.
 */
export const BUSY_ATTEMPTS = 6

/** The seconds a shed request waits for its next try where the answer names none. */
const BUSY_WAIT = 2

/**
 * The fewest seconds a shed request waits for its next try: an answer which
 * asks for no wait, `Retry-After: 0` or a date which is past, is no reason to
 * send the requests of a page back to back into a service which sheds them.
 */
const LEAST_BUSY_WAIT = 0.5

/** The most seconds a shed request waits for its next try, whatever the answer asks for. */
const MOST_BUSY_WAIT = 10

/**
 * The prefix of an endpoint which a function of the page answers.
 *
 * `local:` is no scheme a browser fetches, so an endpoint which starts with it
 * can never be a url of the network by mistake, and the rest of it is a name of
 * the page's choosing, e.g. `local:glimepiride`.
 */
export const LOCAL_PREFIX = 'local:'

/**
 * A function which answers the requests of an endpoint inside the page.
 *
 * It has the signature of `fetch`: it is called with the url of the route,
 * which is the endpoint joined with the path of the route (e.g.
 * `local:glimepiride/api/models/glimepiride/panels/plasma?variant=male`), and
 * with the `init` the client gives `fetch` for it (the method, the headers, the
 * body of a POST as JSON text and the signal which stops it), and it answers a
 * `Response`, which the client reads exactly as one of the network: its status,
 * a 503 with a `Retry-After` sent again, its body as JSON of the contract of the
 * route. A rejection is a `network` failure, unless the signal stopped it.
 */
export type EndpointFetch = (url: string, init: RequestInit) => Promise<Response>

/** The functions the page registered, by their endpoint without a trailing slash. */
const registered = new Map<string, EndpointFetch>()

/** The requests which wait for the registration of their endpoint, by that endpoint. */
const waiting = new Map<string, Set<(fetcher: EndpointFetch) => void>>()

/**
 * Get an endpoint as it is compared, without its trailing slashes.
 *
 * @param endpoint the endpoint as it was written
 * @returns the endpoint the routes are joined to
 */
function trimmed(endpoint: string): string {
  return endpoint.replace(/\/+$/, '')
}

/**
 * Get whether an endpoint is answered by a function of the page.
 *
 * @param endpoint the endpoint
 * @returns whether it starts with `LOCAL_PREFIX`
 */
function isLocal(endpoint: string): boolean {
  return endpoint.startsWith(LOCAL_PREFIX)
}

/**
 * Register the function which answers an endpoint inside the page.
 *
 * Every element whose `endpoint` is this string sends its requests to the
 * function instead of the network, the ones which are already on the page
 * included: a client of an endpoint which is not registered yet waits for the
 * registration, within the timeout and the signal of its request, so a page may
 * register from a module script which runs after the elements connected. A
 * second registration of an endpoint replaces the first for the requests sent
 * after it. A trailing slash is no part of the name, as it is no part of any
 * endpoint (`local:x/` is `local:x`).
 *
 * @param endpoint the endpoint, which starts with `local:`, e.g. `local:glimepiride`
 * @param fetcher the function which answers its routes
 * @throws TypeError for an endpoint which does not start with `local:`, which
 *   is a url of the network and never answered by the page, and for a fetcher
 *   which is no function
 */
export function registerEndpoint(endpoint: string, fetcher: EndpointFetch): void {
  if (typeof endpoint !== 'string' || !isLocal(endpoint)) {
    throw new TypeError(`an endpoint of the page starts with '${LOCAL_PREFIX}'`)
  }
  if (typeof fetcher !== 'function') {
    throw new TypeError('the fetcher of an endpoint is a function with the signature of fetch')
  }
  const name = trimmed(endpoint)
  registered.set(name, fetcher)
  const waiters = waiting.get(name)
  waiting.delete(name)
  for (const resume of waiters ?? []) {
    resume(fetcher)
  }
}

/**
 * Get the function which answers an endpoint of the page, once it is registered.
 *
 * @param endpoint the endpoint, without a trailing slash
 * @param signal the signal of the request, which stops the wait
 * @returns the function, at once when it is registered already
 * @throws the reason of the signal, an `AbortError` as `fetch` throws it, when
 *   the signal stops the wait first
 */
function registration(endpoint: string, signal: AbortSignal): Promise<EndpointFetch> {
  const now = registered.get(endpoint)
  if (now !== undefined) {
    return Promise.resolve(now)
  }
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason as Error)
      return
    }
    const waiters = waiting.get(endpoint) ?? new Set<(fetcher: EndpointFetch) => void>()
    waiting.set(endpoint, waiters)
    const resume = (fetcher: EndpointFetch): void => {
      signal.removeEventListener('abort', stop)
      resolve(fetcher)
    }
    const stop = (): void => {
      waiters.delete(resume)
      if (waiters.size === 0 && waiting.get(endpoint) === waiters) {
        waiting.delete(endpoint)
      }
      reject(signal.reason as Error)
    }
    waiters.add(resume)
    signal.addEventListener('abort', stop, { once: true })
  })
}

/**
 * Wait for a promise unless a signal stops the wait first.
 *
 * `fetch` rejects when its signal stops it, a function of the page may not: it
 * may run its work to the end whatever the signal says. The request is
 * therefore stopped here, so its timeout and its caller stop it alike for both.
 *
 * @param pending what is waited for
 * @param signal the signal of the request
 * @returns what it resolves to
 * @throws what it rejects with, or the reason of the signal when that comes first
 */
function untilStopped<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  let stop = (): void => undefined
  const stopped = new Promise<never>((_resolve, reject) => {
    stop = (): void => {
      reject(signal.reason as Error)
    }
    if (signal.aborted) {
      stop()
    } else {
      signal.addEventListener('abort', stop, { once: true })
    }
  })
  return Promise.race([pending, stopped]).finally(() => {
    signal.removeEventListener('abort', stop)
  })
}

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
  return `${trimmed(endpoint)}${path}`
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
 * Get whether a value of a payload is a limit of an axis.
 *
 * @param value the value
 * @returns whether it is a finite number or `null`, which is no limit
 */
function isLimit(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
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
 * The limits of the axes and the derived values are fields of `panel/1` like
 * every other, so a body without them, or with one of another type, is no
 * declaration.
 *
 * @param body the parsed body, of the contract `panel/1`
 * @returns the declaration
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
    !isTexts(body.simulation.derived)
  ) {
    throw new PanelRequestError('body')
  }
  return body as unknown as PanelDeclaration
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
 * Get whether the figure of an app can be read.
 *
 * @param value the `figure` of the body, absent in a payload before the figure
 * @returns whether it is absent or `null` (no figure), or a figure with its
 *   svg, title, credit and the lists of panel ids a key path opens
 */
function isFigure(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (isObject(value) &&
      typeof value.svg === 'string' &&
      typeof value.title === 'string' &&
      typeof value.credit === 'string' &&
      isObject(value.panels) &&
      Object.values(value.panels).every(
        (ids) => Array.isArray(ids) && ids.every((id) => typeof id === 'string'),
      ))
  )
}

/**
 * Get whether the figure fields of a page can be read.
 *
 * @param page a page of the body
 * @returns whether `figure` is absent or a boolean and `shown` absent or a list of ids
 */
function isFigurePage(page: Record<string, unknown>): boolean {
  return (
    (page.figure === undefined || typeof page.figure === 'boolean') &&
    (page.shown === undefined ||
      (Array.isArray(page.shown) && page.shown.every((id) => typeof id === 'string')))
  )
}

/**
 * Get whether the scenarios of a page can be read.
 *
 * @param value the `scenarios` of a page
 * @returns whether it is a list of scenarios, each with its id, which
 *   is not empty (an SId never is, and the select of the scenarios takes the
 *   empty value for the state of no scenario), its label and the values it sets
 */
function isScenarios(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (one) =>
        isObject(one) &&
        typeof one.id === 'string' &&
        one.id !== '' &&
        typeof one.label === 'string' &&
        isNumbers(one.values),
    )
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
 * of its panel arrives. The scenarios of every page and the variant the app
 * answers are fields of `app/1` like every other.
 *
 * @param body the parsed body, of the contract `app/1`
 * @returns the app
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
        isScenarios((page as Record<string, unknown>).scenarios) &&
        isFigurePage(page as Record<string, unknown>),
    ) ||
    !body.variants.every((one) => typeof (one as Record<string, unknown>).label === 'string') ||
    !isShared(body.shared) ||
    !isHeads(body.heads) ||
    typeof body.variant !== 'string' ||
    !isFigure(body.figure)
  ) {
    throw new PanelRequestError('body')
  }
  return body as unknown as AppDeclaration
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
   *   itself, and one which starts with `local:` is answered by the function
   *   the page registered under it (`registerEndpoint`)
   * @param timeoutMs the milliseconds one request is given, `DEFAULT_TIMEOUT`
   *   for a value which is no positive number
   */
  constructor(endpoint: string, timeoutMs: number = DEFAULT_TIMEOUT) {
    this.endpoint = trimmed(endpoint)
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
    return this.fetchJson(
      join(this.endpoint, path),
      contract,
      signal,
      body,
      isLocal(this.endpoint) ? this.endpoint : null,
    )
  }

  /**
   * Fetch one url and read its body as the payload of a contract, sending it
   * again while the endpoint sheds it (`BUSY_ATTEMPTS`).
   *
   * @param url the url
   * @param contract the version the answer has to carry
   * @param signal a signal which stops the request and the wait for its next try
   * @param body the body of a POST, none for a GET
   * @param local the endpoint of the page which answers the url, `null` for
   *   a url of the network
   * @returns the parsed body
   * @throws PanelRequestError as `fetchOnce`, and `busy` for a request which
   *   was shed every time it was sent
   */
  private async fetchJson(
    url: string,
    contract: string,
    signal: AbortSignal | undefined,
    body?: SimulateRequest,
    local: string | null = null,
  ): Promise<unknown> {
    for (let attempt = 1; ; attempt += 1) {
      const answer = await this.fetchOnce(url, contract, signal, body, local)
      if (!(answer instanceof Shed)) {
        return answer
      }
      if (attempt >= BUSY_ATTEMPTS) {
        throw new PanelRequestError('busy')
      }
      await pause(answer.seconds * (1 + Math.random() / 2), signal)
    }
  }

  /**
   * Fetch one url once and read its body as the payload of a contract.
   *
   * The request carries no credential: a page of another origin may not send
   * one to the service anyway, and a panel is public data.
   *
   * A url of an endpoint of the page is answered by the function registered
   * under that endpoint, with the same `init`, and its answer is read as one
   * of the network; the wait for its registration is part of the request, so
   * the timeout and the signal bound it.
   *
   * @param url the url
   * @param contract the version the answer has to carry
   * @param signal a signal which stops the request
   * @param body the body of a POST, none for a GET
   * @param local the endpoint of the page which answers the url, `null` for
   *   a url of the network, which `fetch` answers
   * @returns the parsed body, or `Shed` for a 503 which asks to be retried
   * @throws PanelRequestError of the kind `timeout` for a request which was
   *   not answered within `timeoutMs`, `aborted` for one the caller stopped,
   *   `network` for one which never reached the endpoint, `http` for a status
   *   which is no success, `contract` for a payload of another version and
   *   `body` for one which cannot be read
   */
  private async fetchOnce(
    url: string,
    contract: string,
    signal: AbortSignal | undefined,
    body?: SimulateRequest,
    local: string | null = null,
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
    // a request its caller stopped before it was sent is stopped at once
    if (signal?.aborted === true) {
      controller.abort()
    }
    signal?.addEventListener('abort', stop)
    try {
      const fetcher: EndpointFetch =
        local === null
          ? (target, init) => fetch(target, init)
          : await registration(local, controller.signal)
      const answer = await untilStopped(
        fetcher(url, {
          method: body === undefined ? 'GET' : 'POST',
          credentials: 'omit',
          headers:
            body === undefined
              ? { accept: 'application/json' }
              : { accept: 'application/json', 'content-type': 'application/json' },
          signal: controller.signal,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        controller.signal,
      )
      if (answer.status === 503 && answer.headers.has('retry-after')) {
        return new Shed(answer.headers.get('retry-after'))
      }
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

/** A request the endpoint shed, with the seconds it asked the client to wait. */
class Shed {
  /** The seconds before the next try, at most `MOST_BUSY_WAIT`. */
  readonly seconds: number

  /**
   * Read the `Retry-After` of a 503.
   *
   * @param header the header, seconds or an HTTP date; one which is neither is
   *   `BUSY_WAIT`
   */
  constructor(header: string | null) {
    const text = (header ?? '').trim()
    const seconds = /^\d+$/.test(text) ? Number(text) : (Date.parse(text) - Date.now()) / 1000
    this.seconds = Number.isFinite(seconds)
      ? Math.min(Math.max(seconds, LEAST_BUSY_WAIT), MOST_BUSY_WAIT)
      : BUSY_WAIT
  }
}

/**
 * Wait, unless the caller stops the request first.
 *
 * @param seconds how long
 * @param signal the signal of the request
 * @returns when the time is up
 * @throws PanelRequestError of the kind `aborted` when the signal stops it
 */
function pause(seconds: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new PanelRequestError('aborted'))
      return
    }
    const stop = (): void => {
      clearTimeout(timer)
      reject(new PanelRequestError('aborted'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop)
      resolve()
    }, seconds * 1000)
    signal?.addEventListener('abort', stop, { once: true })
  })
}
