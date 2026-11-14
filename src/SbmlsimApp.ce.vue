<script setup lang="ts">
/*
 * `<sbmlsim-app>`: the shell of the app of a model, in any HTML page.
 *
 * A model app is configuration and not code: the element reads the `app/1`
 * declaration of the model, once per variant a reader chooses, and draws its title, the navigation of its
 * pages, the switcher of its variants, the controls of the knobs the panels of
 * a page share, a grid of `<sbmlsim-panel>` elements of the page which is shown
 * and a provenance footer. That is all it does. It owns no simulation logic: it
 * reads the app and nothing else, never simulates and never reads into the
 * shadow root of a panel, which it lays out on the rows of its grid through the
 * part the panel exposes and nothing more, so what a panel shows, and how it
 * fails, is the element of the panel alone.
 *
 * It has the shadow root, the tokens and the typography of the panel
 * (`SbmlsimPanel.ce.vue` has the reasons, and `theme.css` the table): it
 * declares no colour of its own, so a host which sets a `--sbmlsim-*` token
 * moves the shell and its panels together. Unlike a panel, which is a figure
 * in the prose of a page, the shell is a page level region with a title, a
 * navigation, a grid and a footer, so it paints its own surface (`--_bg`, which
 * is dark under `theme="dark"` and under a dark `prefers-color-scheme`) and
 * its text is read against that surface and not against whatever page it sits
 * in; the text never inherits the colour of the page.
 *
 * ## The grid
 *
 * The grid has as many columns as fit panels of at least 30rem, and a track
 * which would stay empty collapses, so a lone panel takes the row: two columns
 * from about 976px of the width of the shell, one below it, which is also the
 * one column of a phone. The width is the one of the shell and not of the
 * window, so an app in a column of a page is as narrow as its column.
 *
 * The cards of a row share the rows of the grid: a card spans three, the head,
 * the body and the foot of its panel, and lays its panel out on them as a
 * subgrid, through the shadow root of the panel (`::part(panel)`). Two panels
 * side by side whose titles take other numbers of lines, or of which one has an
 * error line under its plot, draw their plots at one height; a panel alone in
 * a page is a column of its own and is laid out as it always is.
 *
 * The head of a card is reserved before its panel has read its declaration:
 * the app carries the title and the subtitle of every panel of a page
 * (`heads`), and each card holds a copy of the head of its panel which is laid
 * out and never drawn, in the fonts, the line height and the gap of the head
 * of the panel and at the width of the card, so the browser wraps it into the
 * lines the panel's head will take and the head row of the grid is as tall as
 * the tallest head of the row from the first frame. The panel reserves the
 * height of its figure from its width itself, and the foot row holds one line
 * of the provenance, so nothing of a page moves while its panels load.
 *
 * ## What happens to a page
 *
 * The declaration is read once per variant, and a switch of the
 * page, which is the attribute `page` (the id of a page, the first page for one
 * which is missing or unknown), only swaps which panels are in the grid. The
 * panels of the page which is shown are mounted with `auto`, so they start
 * themselves, and the panels of the page which is left are frozen
 * (`freeze()`, which stops their requests) and removed: the DOM holds the
 * panels of one page and never of every page. A panel is therefore created
 * again when its page is returned to, with the knobs at the values of its
 * declaration and not at the ones the reader left them at, and it asks the
 * endpoint for its declaration and its first grid again, which the endpoint
 * answers from its cache of the simulations; the navigation, the title and the
 * footer stay where they are. A reader's switch of the page is announced to a
 * screen reader in a polite live region and to the page with `sbmlsim-page`,
 * whose `detail` is `{ page }`, the id of the page; the page can give its pages
 * addresses with it and answer the back button by setting `page` again.
 * The event is for the reader's switch, not for the attribute being set from
 * outside, which the page which set it knows.
 *
 * ## The knobs a page shares
 *
 * A knob id which more than one panel of the page declares is one knob of the
 * page: the shell draws one control of it above the grid and every panel which
 * declares it is set from that control, so every plot of the page is of the
 * state the controls show; a panel whose run failed says that it cannot draw
 * that state rather than draw another one. A knob id one panel of the page
 * declares stays in that panel. Its control is `KnobControl.ce.vue`, the
 * control the panel would have drawn, described for a screen reader by the
 * titles of the panels it sets (`aria-describedby`).
 *
 * Which knobs those are is stated by the service in the app (`shared`): it
 * works them out of the panels of each page when it starts, refuses a page two
 * of whose panels declare one id differently, and hands the shell each shared
 * knob with its declaration and the panels it sets. The shell reads no
 * declaration of a panel, so a panel which cannot be read changes nothing of
 * the controls of its page, and the panels are placed with the app. The
 * controls are listed in the order the first panel which declares one lists
 * them, start at the declared default, start there again whenever the page is
 * shown, as the knobs of its panels do, and have a Reset of their own, which
 * can be pressed while one of them is away from its default.
 *
 * Every panel a shared knob sets gets the attribute `values`, a JSON object of
 * exactly the shared knobs which set it, written again on every movement of a
 * control (`input` and `change` alike); a panel takes it as the release of its
 * own control, so the knob its grid covers is read out of the grid while it is
 * dragged and any other one costs one run. A panel no shared knob sets gets no
 * `values`, so a movement of a shared knob changes nothing of it.
 *
 * ## The variant
 *
 * An app with more than one variant has a switcher, a select with the variants
 * in the order of the declaration, the first one chosen. The chosen variant is
 * the attribute `variant` of every panel of the page, which simulates it, and
 * stays chosen while the page changes. An app of one variant or none has no
 * switcher, and its panels simulate the variant their declaration names.
 *
 * The declarations of the panels may differ by the variant, and so may what
 * the app derives from them: the shell reads the app again in the variant a
 * reader switches to (`switchTo`). While it does, the panels keep the figures
 * of the variant before, dimmed, inert and hidden from a screen reader, under a
 * caption beside the switcher which names the variant they are switched to; then it draws the
 * controls, the scenarios and the heads of that variant and gives every panel
 * the variant and the values of the shared knobs at once, a value kept where
 * the knob of that variant takes it (`adopt`), and each panel holds its figure
 * of the variant before, dimmed, until it draws one of the new variant
 * (`awaiting`). The app names the variant it answers (`variant`): the first one
 * the shell reads is the variant the switcher starts at, every app is kept by
 * its variant, and an app of another variant than the one asked for is a body
 * which is no app.
 *
 * ## The scenarios of a page
 *
 * A page may name scenarios, states of its shared knobs such as example
 * patients: a select of them above the shared controls sets every knob a
 * scenario names in one state and shows the scenario the knobs are at, or the
 * entry `custom`, which cannot be picked (`ScenarioControl.ce.vue`).
 *
 * ## The footer
 *
 * The citation, the DOI and the licenses of the declaration, and the versions
 * which simulated: the shell listens to `sbmlsim-result` of its panels, which
 * carries the provenance of every successful simulation, keeps the latest one
 * of each panel, and names the version of sbmlsim, the engine and the short
 * hash of the model of those answers, so the line says what the page shows and
 * not what the service happens to run, and it does not grow with the moves of
 * a knob.
 *
 * ## A failure
 *
 * An endpoint which cannot be reached, a model which has no app, or a body
 * which is no app leave the element with one line in the voice of the panel
 * (`FAILURE_MESSAGES`), which names no url, no host and no status, and with no
 * navigation, no grid and no footer: an app which cannot be read has nothing
 * to frame. `sbmlsim-error` is dispatched as the panel does it.
 */

import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useHost,
  useTemplateRef,
  watch,
} from 'vue'
import type { PropType } from 'vue'

import {
  DEFAULT_TIMEOUT,
  FAILURE_MESSAGES,
  PanelClient,
  PanelRequestError,
  failureKind,
} from './client'
import type { FailureKind } from './client'
import type {
  AppDeclaration,
  AppPage,
  PanelAxis,
  PanelSummary,
  Provenance,
  Scenario,
  SharedKnob,
} from './contract'
import KnobControl from './KnobControl.ce.vue'
import { cardLevels } from './columns'
import ResetButton from './ResetButton.ce.vue'
import ScenarioControl from './ScenarioControl.ce.vue'
import { drawableKnob, keepControlKeys, ownValue, sameValue, snapValue, validValue } from './knob'
import { placedPanelTag } from './tags'

/** Which values of the design tokens the element asks for. */
type ThemeName = 'auto' | 'light' | 'dark'

/** The smallest level a heading of HTML has. */
const LEAST_HEADING = 1
/** The largest level a heading of HTML has. */
const MOST_HEADING = 6
/** The characters of the hash of a model the footer shows. */
const HASH_LENGTH = 8
/** The separator of the parts of the footer. */
const SEPARATOR = ' · '
/** The doi resolver a doi is linked to. */
const DOI_RESOLVER = 'https://doi.org/'
/** What a doi may be written with in front of its number. */
const DOI_PREFIX = /^https?:\/\/(?:dx\.)?doi\.org\//i
/** What the line of a switch of the variant which failed says after the failure. */
const SWITCH_MESSAGE = 'The panels of the variant shown cannot be drawn.'
/** The label of the select of the scenarios of a page, which are examples of its knobs. */
const SCENARIO_LABEL = 'Example'

const props = defineProps({
  /** The endpoint of the service, empty is the origin of the page. */
  endpoint: { type: String, default: '' },
  /** The id of the model, as the endpoint serves it. */
  model: { type: String, default: '' },
  /** The id of the page which is shown, the first page of the app without. */
  page: { type: String, default: '' },
  /** Which values of the tokens are used: `auto` (the default), `light` or `dark`. */
  theme: { type: String as PropType<ThemeName>, default: 'auto' },
  /** The milliseconds one request is given before it is stopped. */
  timeout: { type: Number, default: DEFAULT_TIMEOUT },
  /**
   * The level the title of the app is drawn at, 1 by default; its panels are
   * drawn one level below it, so a page which embeds the app under a heading of
   * its own writes the level below that.
   */
  headingLevel: { type: Number, default: 1 },
})

const host = useHost()
const grid = useTemplateRef<HTMLElement>('grid')

/** The app, `null` until it arrived and where it could not be read. */
const app = shallowRef<AppDeclaration | null>(null)
/** What went wrong, `null` while nothing did. */
const failure = ref<FailureKind | null>(null)
/** The id of the variant the reader chose, empty where the app has none. */
const chosen = ref('')
/**
 * The id of the variant the app which is drawn was read in: the variant its
 * panels simulate and its controls, its scenarios and its heads are of. It is
 * the chosen one once the app of that variant has been read.
 */
const shownVariant = ref('')
/** Whether the app of the chosen variant is being read, or could not be, and the panels are not drawn. */
const switching = ref(false)
/** What went wrong reading the app of the chosen variant, `null` while nothing did. */
const switchFailure = ref<FailureKind | null>(null)
/**
 * The panels of the page which have not drawn the variant the app was switched
 * to yet, by their id: each draws the figure of the variant before, dimmed,
 * until it draws its first of the new one or fails, and the caption of the
 * switch stays over the grid until none is left.
 */
const awaiting = ref<ReadonlySet<string>>(new Set())
/** The apps of the variants which were read, by the id of the variant, for a reader who switches back. */
const read = new Map<string, AppDeclaration>()
/** The provenance of the latest answer of each panel of the page, by the id of the panel. */
const answers = ref<Record<string, Provenance>>({})
/** What the live region says, the page which was switched to; empty until a reader switches. */
const announced = ref('')

/** The controller of the request of the app, so a superseded one is dropped. */
let flight: AbortController | null = null
/** The controller of the request of the app of a variant, so a superseded switch is dropped. */
let switchFlight: AbortController | null = null

/** The value of every knob the panels of the page share, by its id. */
const shared = ref<Record<string, number>>({})

/** The page which is shown: the one `page` names, else the first one. */
const current = computed<AppPage | null>(() => {
  const pages = app.value?.pages ?? []
  return pages.find((one) => one.id === props.page) ?? pages[0] ?? null
})

/** The variants the reader switches between, empty for an app which has fewer than two. */
const variants = computed(() => {
  const all = app.value?.variants ?? []
  return all.length > 1 ? all : []
})

/**
 * The variant the panels simulate, empty for the one their declaration names:
 * the variant of the app which is drawn, so a panel reads its declaration in
 * the variant its controls are of, and never in one whose app is still read.
 */
const variantOfPanels = computed<string>(() =>
  variants.value.length > 0 ? shownVariant.value : '',
)

/**
 * The knobs the panels of the page share, as the service states them in the
 * app: the ids more than one of its panels declares, each with its declaration
 * and the panels it sets, in the order the first panel which declares one
 * lists them.
 */
const sharedKnobs = computed<SharedKnob[]>(() => {
  const page = current.value
  // a knob whose control cannot be built is left out, as a panel leaves it out
  // of its own controls (`drawableKnob`), and the rest of the page is drawn
  return page === null
    ? []
    : (app.value?.shared[page.id] ?? []).filter((one) => drawableKnob(one.knob))
})

/** The label of the variant the app is switched to, empty while no switch is under way. */
const switchCaption = computed<string>(() => {
  if (switchFailure.value !== null || (!switching.value && awaiting.value.size === 0)) {
    return ''
  }
  const label = variants.value.find((one) => one.id === chosen.value)?.label ?? chosen.value
  return captionOf(label)
})

/**
 * Get the caption of a switch to a variant.
 *
 * @param label the label of the variant
 * @returns the caption which names it
 */
function captionOf(label: string): string {
  return `Switching to ${label} …`
}

/**
 * Whether the provenance line names answers of the variant before a switch: it
 * stays, dimmed like the figures, until the answers of the new variant replace
 * it, and the answer of a panel whose switch failed is dropped as its figure is.
 */
const simulatedHeld = computed<boolean>(() => switching.value || awaiting.value.size > 0)

/**
 * The versions which simulated what the page shows, as the footer names them:
 * none while the app of a variant cannot be read, whose figures of the variant
 * before are not drawn, and the answers of the variant which is drawn again
 * when the reader returns to it.
 */
const simulatedShown = computed<string>(() => (switchFailure.value === null ? simulated.value : ''))

/** The scenarios of the page which is shown, none for a page without. */
const scenarios = computed<Scenario[]>(() => current.value?.scenarios ?? [])

/**
 * The layout of the card of the shared knobs at every number of columns which
 * fit it (`columns.ts`): the columns of its grid as the custom properties
 * `--_columns-<fit>`, which the container query of the width of the card reads,
 * and the classes `start-<fit>` of the knobs which start a line at that width.
 */
const levels = computed(() => cardLevels(sharedKnobs.value.length, scenarios.value.length > 0))

/**
 * The columns of the grid of the card at every level, as custom properties: the
 * columns of the knobs and, where the Reset has one of its own, `auto`.
 */
const levelStyle = computed<Record<string, string>>(() =>
  Object.fromEntries(
    levels.value.flatMap((level, index): [string, string][] => [
      [`--_columns-${String(index + 1)}`, String(level.columns)],
      ...(level.reset ? [[`--_reset-${String(index + 1)}`, 'auto'] as [string, string]] : []),
    ]),
  ),
)

/**
 * Get the classes of a shared knob which starts a line at some widths of the card.
 *
 * @param position the position of the knob among the shared knobs
 * @returns a class `start-<fit>` for every level at which it starts a line
 */
function startsOf(position: number): string[] {
  return levels.value.flatMap((level, index) =>
    level.starts.includes(position) ? [`start-${String(index + 1)}`] : [],
  )
}

/**
 * The scenario the shared knobs of the page are at: the first whose every value
 * is the value its knob has now, `null` for knobs at none of them.
 */
const scenarioShown = computed<string | null>(() => {
  const knobs = new Map(sharedKnobs.value.map((one) => [one.knob.id, one.knob]))
  const at = scenarios.value.find((one) =>
    Object.entries(one.values).every(([id, value]) => {
      const knob = knobs.get(id)
      return knob !== undefined && sameValue(ownValue(shared.value, id) ?? knob.default, value)
    }),
  )
  return at?.id ?? null
})

/**
 * Set the shared knobs of the page to a scenario a reader picked.
 *
 * Every knob it names is set at once, in one state of the knobs, so a panel
 * takes the pick as one change of its attribute `values` and runs at most once
 * for it, whichever of its knobs moved; a knob it does not name keeps the value
 * it has. A value of a knob the page does not share is no knob of the page's,
 * which the service does not let a scenario name, and is left out.
 *
 * @param id the id of the scenario
 */
function pickScenario(id: string): void {
  const picked = scenarios.value.find((one) => one.id === id)
  if (picked === undefined) {
    return
  }
  const knobs = new Set(sharedKnobs.value.map((one) => one.knob.id))
  // built of entries, so every knob id is a property of its own, `__proto__` among them
  shared.value = Object.fromEntries([
    ...Object.entries(shared.value),
    ...Object.entries(picked.values).filter(([knob]) => knobs.has(knob)),
  ])
}

/** Whether every shared knob of the page is at its declared default, which a reset changes nothing of. */
const sharedAtDefaults = computed<boolean>(() =>
  sharedKnobs.value.every(
    (one) => (ownValue(shared.value, one.knob.id) ?? one.knob.default) === one.knob.default,
  ),
)

/** The heads of the panels of the page by the id of the panel, as the service states them in the app. */
const heads = computed<Map<string, PanelSummary>>(() => {
  const page = current.value
  return new Map(
    (page === null ? [] : (app.value?.heads[page.id] ?? [])).map((one) => [one.id, one]),
  )
})

/**
 * Get the attribute `values` of a panel of the page.
 *
 * @param id the id of the panel
 * @returns the JSON of the shared knobs which set the panel, at their values,
 *   `undefined` for a panel no shared knob sets, which is placed without the
 *   attribute
 */
function valuesOf(id: string): string | undefined {
  const given = sharedKnobs.value
    .filter((one) => one.panels.some((panel) => panel.id === id))
    .map((one): [string, number] => [
      one.knob.id,
      ownValue(shared.value, one.knob.id) ?? one.knob.default,
    ])
  // built of entries, so every knob id is a property of its own, `__proto__` among them
  return given.length === 0 ? undefined : JSON.stringify(Object.fromEntries(given))
}

/**
 * Get the attribute `head` of a panel of the page.
 *
 * @param id the id of the panel
 * @returns the JSON of the title and the subtitle the app names for it, which
 *   the panel shows until it has read its declaration, so a card shows the head
 *   of the variant of the app at once; `undefined` for a panel the app names
 *   no head of
 */
function headOf(id: string): string | undefined {
  const one = heads.value.get(id)
  return one === undefined
    ? undefined
    : JSON.stringify({ title: one.title, subtitle: one.subtitle })
}

/**
 * Get the id of the text which says which panels a shared control sets.
 *
 * @param knob the knob
 * @returns an id which is unique inside the shadow root of the shell
 */
function drivesId(knob: PanelAxis): string {
  return `drives-${knob.id}`
}

/**
 * Get the text which says which panels a shared control sets.
 *
 * @param one the shared knob
 * @returns the titles of its panels, in the order of the page
 */
function drivesText(one: SharedKnob): string {
  return `Sets ${one.panels.map((panel) => panel.title).join(', ')}`
}

/**
 * Take a movement of the control of a shared knob.
 *
 * @param knob the knob
 * @param value the value its control was moved to
 */
function moveShared(knob: PanelAxis, value: number): void {
  shared.value = { ...shared.value, [knob.id]: value }
}

/** Put every shared knob of the page back to its declared default. */
function resetShared(): void {
  shared.value = Object.fromEntries(sharedKnobs.value.map((one) => [one.knob.id, one.knob.default]))
}

/** The level of the title of the app, within the levels HTML has. */
const titleTag = computed<string>(() => {
  const asked = Math.round(props.headingLevel)
  const level = Number.isFinite(asked) ? asked : LEAST_HEADING
  return `h${String(Math.min(MOST_HEADING, Math.max(LEAST_HEADING, level)))}`
})

/** The level of the title of a panel, the one below the title of the app. */
const panelLevel = computed<number>(() => {
  const own = Number(titleTag.value.slice(1))
  return Math.min(MOST_HEADING, own + 1)
})

/**
 * The tag this shell places its panels under.
 *
 * It is read once, when the shell is created, and not on every render: a page
 * which registers the elements again under other names gets shells of the new
 * names which place the new panel, while the shells it already has on the page
 * keep placing the panel they were built with.
 */
const panelTag = placedPanelTag()

/** The link of the DOI, `null` for an app which declares none. */
const doiLink = computed<string | null>(() => {
  const doi = app.value?.doi.trim().replace(DOI_PREFIX, '') ?? ''
  return doi === '' ? null : `${DOI_RESOLVER}${encodeURI(doi)}`
})

/** The text of the DOI as it is shown, without its resolver. */
const doiText = computed<string>(() => app.value?.doi.trim().replace(DOI_PREFIX, '') ?? '')

/** The versions which simulated what the page shows, empty before the first answer. */
const simulated = computed<string>(() => {
  const latest = Object.values(answers.value)
  if (latest.length === 0) {
    return ''
  }
  const versions = [...new Set(latest.map((one) => `sbmlsim ${one.sbmlsim}`))]
  const engines = [...new Set(latest.map((one) => one.engine))]
  const models = [...new Set(latest.map((one) => one.model_sha256.slice(0, HASH_LENGTH)))]
  return [
    `Simulated with ${versions.join(', ')}`,
    engines.join(', '),
    `model ${models.join(', ')}`,
  ].join(SEPARATOR)
})

/**
 * Tell the page that something failed, as a panel does.
 *
 * @param kind what failed, a short machine string
 */
function announce(kind: FailureKind): void {
  host?.dispatchEvent(
    new CustomEvent('sbmlsim-error', {
      detail: { kind, message: FAILURE_MESSAGES[kind] },
      bubbles: true,
      composed: true,
    }),
  )
}

/** Read the app of the model; its failure is the one line the element shows. */
async function load(): Promise<void> {
  flight?.abort()
  switchFlight?.abort()
  switchFlight = null
  read.clear()
  switching.value = false
  switchFailure.value = null
  awaiting.value = new Set()
  const controller = new AbortController()
  flight = controller
  app.value = null
  failure.value = null
  try {
    const declared = await new PanelClient(props.endpoint, props.timeout).app(
      props.model,
      controller.signal,
    )
    if (declared.pages.length === 0) {
      // an app without a page has nothing to show, which is a body which is no app
      failure.value = 'body'
      announce('body')
      return
    }
    if (declared.variants.length > 1 && declared.variant === '') {
      // a switcher of the variants needs to know which of them the app is of,
      // which an app of the version without `variant` does not say
      throw new PanelRequestError('body')
    }
    app.value = declared
    shownVariant.value = declared.variant
    read.set(declared.variant, declared)
    // the switcher shows the variant the app is of; an app whose default
    // variant is none it lists is switched to the first one it lists
    const listed = declared.variants.some((one) => one.id === declared.variant)
    chosen.value = listed ? declared.variant : (declared.variants[0]?.id ?? '')
  } catch (error) {
    if (controller.signal.aborted && flight !== controller) {
      return
    }
    const kind = failureKind(error)
    if (kind !== 'aborted') {
      failure.value = kind
      announce(kind)
    }
  } finally {
    if (flight === controller) {
      flight = null
    }
  }
}

/**
 * Draw the app of another variant: its pages, its controls, its scenarios and
 * the heads of its panels, and its panels in that variant, all at once.
 *
 * A shared knob of the page keeps its value where the knob is a shared knob of
 * the page in that variant too and the value is one it takes there; any other
 * starts at its default. The panels get the variant and the values in one
 * render, so each reads its declaration of that variant once and runs it at
 * those values.
 *
 * @param declared the app of the variant
 * @param variant the id of the variant
 */
function adopt(declared: AppDeclaration, variant: string): void {
  const page = declared.pages.find((one) => one.id === current.value?.id) ?? declared.pages[0]
  const knobs = page === undefined ? [] : (declared.shared[page.id] ?? [])
  // built of entries, so every knob id is a property of its own, `__proto__` among them
  shared.value = Object.fromEntries(
    knobs.map((one) => {
      const value = ownValue(shared.value, one.knob.id)
      return [
        one.knob.id,
        value !== undefined && validValue(one.knob, value)
          ? snapValue(one.knob, value)
          : one.knob.default,
      ]
    }),
  )
  app.value = declared
  shownVariant.value = variant
  switching.value = false
  switchFailure.value = null
  awaiting.value = new Set(page?.panels ?? [])
}

/**
 * Switch the app to the variant a reader chose.
 *
 * The declarations of the panels may differ by the variant, and so may the
 * knobs a page shares, its scenarios and the heads of its cards: the app is
 * read again in that variant (`?variant=`). While it is, its panels keep the
 * figures of the variant before, dimmed, inert and hidden from a screen reader
 * under the caption of the switch, and its controls and tabs take no movement,
 * so no figure of the variant before is presented as one of the variant the
 * switcher shows, and none is drawn of the declaration of one variant and the
 * controls of another. A failure clears them at once, with a line which says
 * what failed. A reader who switches back to a variant whose app was read gets
 * it back without a request.
 *
 * @param variant the id of the variant
 */
async function switchTo(variant: string): Promise<void> {
  switchFlight?.abort()
  switchFlight = null
  switchFailure.value = null
  if (variant === shownVariant.value) {
    switching.value = false
    return
  }
  switching.value = true
  const known = read.get(variant)
  if (known !== undefined) {
    adopt(known, variant)
    return
  }
  const controller = new AbortController()
  switchFlight = controller
  try {
    const declared = await new PanelClient(props.endpoint, props.timeout).app(
      props.model,
      controller.signal,
      variant,
    )
    if (switchFlight !== controller) {
      return
    }
    if (declared.pages.length === 0 || declared.variant !== variant) {
      // an app without a page has nothing to show, and an app of another
      // variant than the one asked for would draw its controls under the
      // switcher of this one: both are bodies which are no app of the switch
      throw new PanelRequestError('body')
    }
    read.set(variant, declared)
    adopt(declared, variant)
  } catch (error) {
    if (switchFlight !== controller) {
      return
    }
    const kind = failureKind(error)
    if (kind !== 'aborted') {
      switchFailure.value = kind
      announce(kind)
    }
  } finally {
    if (switchFlight === controller) {
      switchFlight = null
    }
  }
}

/** Get the panels in the grid, the elements the shell itself placed. */
function shownPanels(): HTMLElement[] {
  return grid.value === null ? [] : [...grid.value.querySelectorAll<HTMLElement>('sbmlsim-panel')]
}

/**
 * Freeze the panels of the page which is left, before they are removed.
 *
 * It runs before the grid is patched, so a request of a panel which is on its
 * way is stopped and not left to answer into an element which is gone.
 */
function freezeShown(): void {
  for (const one of shownPanels()) {
    ;(one as HTMLElement & { freeze?: () => void }).freeze?.()
  }
}

/**
 * Collect the provenance of an answer a panel announced.
 *
 * @param event the `sbmlsim-result` event of a panel
 */
function collect(event: Event): void {
  const provenance = (event as CustomEvent<{ provenance?: Provenance }>).detail.provenance
  if (provenance !== undefined) {
    // keyed by the panel the shell placed, which a failure of it is dropped by
    const placed = event.target instanceof Element ? event.target.getAttribute('panel') : null
    answers.value = { ...answers.value, [placed ?? provenance.panel]: provenance }
    settle(event)
  }
}

/**
 * Take a panel whose switch of the variant failed off the switch, and drop the
 * answer of the variant before it held from the provenance line, as the panel
 * dropped its figure.
 *
 * @param event the `sbmlsim-error` of a panel
 */
function dropFailed(event: Event): void {
  const id = event.target instanceof Element ? event.target.getAttribute('panel') : null
  if (id !== null && awaiting.value.has(id)) {
    answers.value = Object.fromEntries(
      Object.entries(answers.value).filter(([panel]) => panel !== id),
    )
  }
  settle(event)
}

/**
 * Take a panel off the panels a switch of the variant awaits.
 *
 * A panel which drew a figure of the variant it was given, or failed to, has
 * done with the switch: its figure of the variant before is gone either way.
 *
 * @param event the `sbmlsim-result` or the `sbmlsim-error` of a panel, whose
 *   target is the panel the shell placed
 */
function settle(event: Event): void {
  const id = event.target instanceof Element ? event.target.getAttribute('panel') : null
  if (id === null || !awaiting.value.has(id)) {
    return
  }
  const left = new Set(awaiting.value)
  left.delete(id)
  awaiting.value = left
}

/**
 * Switch the page, which is the attribute `page` of the element, and say so.
 *
 * @param id the id of the page
 */
function show(id: string): void {
  if (id === current.value?.id) {
    return
  }
  host?.setAttribute('page', id)
  const title = app.value?.pages.find((one) => one.id === id)?.title ?? id
  announced.value = `Showing ${title}`
  host?.dispatchEvent(
    new CustomEvent('sbmlsim-page', {
      detail: { page: id },
      bubbles: true,
      composed: true,
    }),
  )
}

watch(
  () => current.value?.id,
  () => {
    freezeShown()
    answers.value = {}
    awaiting.value = new Set()
    resetShared()
  },
  { flush: 'pre' },
)

watch(chosen, (variant) => {
  void switchTo(variant)
})

watch(
  () => [props.endpoint, props.model],
  () => {
    freezeShown()
    answers.value = {}
    void load()
  },
)

onMounted(() => {
  void load()
})

onBeforeUnmount(() => {
  flight?.abort()
  switchFlight?.abort()
})
</script>

<template>
  <div class="shell">
    <p v-if="failure !== null" class="error" role="alert">{{ FAILURE_MESSAGES[failure] }}</p>
    <p v-else-if="app === null" class="pending">Loading the app</p>
    <template v-else-if="current !== null">
      <header class="head">
        <component :is="titleTag" class="title">{{ app.title }}</component>
        <p v-if="app.subtitle !== ''" class="subtitle">{{ app.subtitle }}</p>
      </header>
      <div v-if="app.pages.length > 1 || variants.length > 0" class="bar">
        <nav v-if="app.pages.length > 1" class="nav" aria-label="Pages">
          <button
            v-for="one in app.pages"
            :key="one.id"
            type="button"
            class="tab"
            :data-label="one.title"
            :aria-current="one.id === current.id ? 'page' : undefined"
            :disabled="switching"
            @click="show(one.id)"
          >
            {{ one.title }}
          </button>
        </nav>
        <div v-if="variants.length > 0" class="variant">
          <label class="variant-pick">
            <span class="variant-label">Variant</span>
            <select v-model="chosen" class="variant-select">
              <option v-for="one in variants" :key="one.id" :value="one.id">{{ one.label }}</option>
            </select>
          </label>
          <!-- the caption of a switch, beside the switcher: it keeps the room of the
               longest caption any variant has at all times, each laid out in one cell
               and never drawn, so it moves nothing when it appears -->
          <span class="switch-caption">
            <span v-for="one in variants" :key="one.id" class="switching-copy" aria-hidden="true">
              {{ captionOf(one.label) }}
            </span>
            <span class="caption" role="status">{{ switchCaption }}</span>
          </span>
        </div>
      </div>
      <div
        v-if="sharedKnobs.length > 0"
        class="knobs"
        role="group"
        aria-label="Simulation settings of the page"
        @keydown="keepControlKeys($event)"
      >
        <!-- the grid of the controls in the card, whose width picks its level -->
        <div class="knobs-grid control-row" :style="levelStyle">
          <!-- the examples of the page set the controls below, so they are above them,
               in a row of their own -->
          <ScenarioControl
            v-if="scenarios.length > 0"
            :label="SCENARIO_LABEL"
            :scenarios="scenarios"
            :shown="scenarioShown"
            :disabled="switching"
            @pick="pickScenario($event)"
          />
          <KnobControl
            v-for="(one, position) of sharedKnobs"
            :key="one.knob.id"
            :class="startsOf(position)"
            :axis="one.knob"
            :value="ownValue(shared, one.knob.id) ?? one.knob.default"
            :described-by="drivesId(one.knob)"
            :disabled="switching"
            @input="moveShared(one.knob, $event)"
            @change="moveShared(one.knob, $event)"
          />
          <!-- level with the first line of controls, the selects, and never below a slider -->
          <div class="knobs-reset">
            <div class="control-line">
              <ResetButton :disabled="switching" :idle="sharedAtDefaults" @reset="resetShared()" />
            </div>
          </div>
          <!-- hidden, so a screen reader hears the text once, as the description of its
               control, and not again after the controls; aria-describedby reads it -->
          <p v-for="one of sharedKnobs" :id="drivesId(one.knob)" :key="one.knob.id" hidden>
            {{ drivesText(one) }}
          </p>
        </div>
      </div>
      <!-- a region and no main: the page which embeds the shell has its own landmark;
           `values` is written as the attribute a page writes, and left off a panel
           which shares no knob -->
      <p v-if="switchFailure !== null" class="error" role="alert">
        {{ FAILURE_MESSAGES[switchFailure] }} {{ SWITCH_MESSAGE }}
      </p>
      <section
        ref="grid"
        :key="current.id"
        class="grid"
        :class="{ switching: switching, failed: switchFailure !== null }"
        :aria-busy="switchCaption !== '' ? 'true' : 'false'"
        :aria-label="current.title"
        @sbmlsim-result="collect"
        @sbmlsim-error="dropFailed"
      >
        <div v-for="one in current.panels" :key="one" class="cell">
          <component
            :is="panelTag"
            auto
            :endpoint="props.endpoint"
            :model="props.model"
            :panel="one"
            :theme="props.theme"
            :timeout="props.timeout"
            :heading-level="panelLevel"
            :variant="variantOfPanels"
            :values.attr="valuesOf(one)"
            :head.attr="headOf(one)"
            :inert="switching"
            :aria-hidden.attr="switching ? 'true' : undefined"
          ></component>
          <div class="reserve" aria-hidden="true">
            <div
              v-if="(heads.get(one)?.title ?? '') !== '' || (heads.get(one)?.subtitle ?? '') !== ''"
              class="reserve-head"
            >
              <div v-if="(heads.get(one)?.title ?? '') !== ''" class="reserve-title">
                {{ heads.get(one)?.title }}
              </div>
              <div v-if="(heads.get(one)?.subtitle ?? '') !== ''" class="reserve-subtitle">
                {{ heads.get(one)?.subtitle }}
              </div>
            </div>
          </div>
        </div>
      </section>
      <p class="live" aria-live="polite">{{ announced }}</p>
      <footer class="footer">
        <p v-if="app.citation !== ''" class="citation">{{ app.citation }}</p>
        <p class="facts">
          <template v-if="doiLink !== null">
            <span
              >DOI <a :href="doiLink" target="_blank" rel="noopener">{{ doiText }}</a></span
            >
          </template>
          <span v-if="app.licenses.length > 0">{{ app.licenses.join(', ') }}</span>
        </p>
        <p
          v-if="simulatedShown !== ''"
          class="simulated"
          :class="{ held: simulatedHeld }"
          :aria-hidden="simulatedHeld ? 'true' : undefined"
        >
          {{ simulatedShown }}
        </p>
      </footer>
    </template>
  </div>
</template>

<style src="./theme.css"></style>

<style>
/*
 * The host carries its box and its surface, and every text colour and every
 * piece of typography is declared on `.shell`, so a rule of the page which
 * matches the element cannot hand its own colour to what is inside by
 * inheritance. The panels inherit the `--sbmlsim-*` tokens through the shadow
 * boundary, which is how `theme` and a token of the page reach them.
 */
:host {
  display: block;
  /* the surface of the shell, read through the private token, which is dark
   * under a dark scheme and under `theme="dark"`, so the text on it, which is
   * the colour of the same table, is readable on any page */
  background: var(--_bg);
  color-scheme: light dark;
}

:host([theme='light']) {
  color-scheme: light;
}

:host([theme='dark']) {
  color-scheme: dark;
}

.shell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-sizing: border-box;
  max-width: 76rem;
  margin: 0 auto;
  padding: 16px;
  /* the grid below reads the width of the shell and not of the window, so an
   * app in a column of a page is as narrow as its column */
  container-type: inline-size;
  color: var(--_fg);
  font-family: var(--_font);
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: 1.5;
  text-align: left;
  text-transform: none;
  letter-spacing: normal;
}

.head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.title {
  margin: 0;
  color: var(--_fg);
  font-size: 24px;
  font-weight: 600;
  line-height: 1.25;
}

.subtitle {
  margin: 0;
  color: var(--_fg-soft);
  font-size: 14px;
}

.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px 16px;
  border-bottom: 1px solid var(--_line);
}

.nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0 4px;
}

.tab {
  margin: 0 0 -1px;
  padding: 8px 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--_fg-soft);
  font: inherit;
  cursor: pointer;
}

/* the bold of the current page and the regular weight of the others are
 * reserved by every tab, so the tabs do not move when the page changes: the
 * width of a tab is the wider of its title in either weight, whichever it is
 * drawn in, and a font which draws a short title a fraction of a pixel wider in
 * its regular weight than in bold moves the tabs after it by that fraction
 * otherwise */
.tab::before,
.tab::after {
  display: block;
  height: 0;
  overflow: hidden;
  visibility: hidden;
  content: attr(data-label);
}

.tab::before {
  font-weight: 400;
}

.tab::after {
  font-weight: 600;
}

.tab:hover {
  color: var(--_fg);
}

.tab[aria-current='page'] {
  border-bottom-color: var(--_accent);
  color: var(--_fg);
  font-weight: 600;
}

.variant {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  max-width: 100%;
  padding-bottom: 6px;
  color: var(--_fg-soft);
  font-size: var(--_font-size);
}

.variant-pick {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* the caption of a switch and a copy of it for every variant, in one cell: the
 * copies are laid out and never drawn, so the cell is as wide as the longest
 * caption from the first frame and the caption appears without moving anything */
.switch-caption {
  display: inline-grid;
  max-width: 100%;
  font-size: var(--_font-size-small);
}

.switch-caption > * {
  grid-area: 1 / 1;
}

.switching-copy {
  visibility: hidden;
}

.variant-select {
  padding: 4px 8px;
  border: 1px solid var(--_line);
  border-radius: calc(var(--_radius) / 2);
  background: var(--_bg-card);
  color: var(--_fg);
  font: inherit;
}

/* the controls of the knobs the panels of the page share, on a card as the
 * panels are, a row of controls (`control.css`) as the controls of a panel
 * are, so the Reset sits on the line of the selects. The padding under the
 * last line is the card's less the gap of a line, which that line carries. The
 * card is the container whose width picks the level of its grid */
.knobs {
  container: knobs / inline-size;
  padding: 12px 16px calc(12px - var(--_line-gap));
  border: 1px solid var(--_line);
  border-radius: var(--_radius);
  background: var(--_bg-card);
  box-shadow: var(--_shadow);
}

/*
 * Balanced rows of knobs at their natural width (`columns.ts`): the card holds
 * `fit` columns of 200px, which hold the label of an example, and the gap of
 * 16px between them, and its knobs take `ceil(n / ceil(n / fit))` of them, so
 * the rows are as even as the width allows. Each level of the card below is a
 * range of its inner width, from `fit * 200 + (fit - 1) * 16` px on, and reads
 * the columns of that level (`--_columns-<fit>`, which the shell computes from
 * its knobs) and starts a line at the knobs of that level (`.start-<fit>`). A
 * column is as wide as the card gives it up to 20rem and no wider, so the card
 * is not filled beyond that; a control fills a phone. A Reset which has a
 * column of its own (`--_reset-<fit>`, `auto` or nothing) has one as wide as it
 * is, and it never takes width from a control.
 */
.knobs-grid.control-row {
  grid-template-columns: repeat(var(--_columns-1, 1), minmax(0, 20rem)) var(--_reset-1,);
}

@container knobs (416px <= width < 632px) {
  .knobs-grid.control-row {
    grid-template-columns: repeat(var(--_columns-2), minmax(0, 20rem)) var(--_reset-2,);
  }

  .knobs-grid > .start-2 {
    grid-column-start: 1;
  }
}

@container knobs (632px <= width < 848px) {
  .knobs-grid.control-row {
    grid-template-columns: repeat(var(--_columns-3), minmax(0, 20rem)) var(--_reset-3,);
  }

  .knobs-grid > .start-3 {
    grid-column-start: 1;
  }
}

@container knobs (848px <= width < 1064px) {
  .knobs-grid.control-row {
    grid-template-columns: repeat(var(--_columns-4), minmax(0, 20rem)) var(--_reset-4,);
  }

  .knobs-grid > .start-4 {
    grid-column-start: 1;
  }
}

@container knobs (1064px <= width < 1280px) {
  .knobs-grid.control-row {
    grid-template-columns: repeat(var(--_columns-5), minmax(0, 20rem)) var(--_reset-5,);
  }

  .knobs-grid > .start-5 {
    grid-column-start: 1;
  }
}

@container knobs (1280px <= width < 1496px) {
  .knobs-grid.control-row {
    grid-template-columns: repeat(var(--_columns-6), minmax(0, 20rem)) var(--_reset-6,);
  }

  .knobs-grid > .start-6 {
    grid-column-start: 1;
  }
}

@container knobs (1496px <= width < 1712px) {
  .knobs-grid.control-row {
    grid-template-columns: repeat(var(--_columns-7), minmax(0, 20rem)) var(--_reset-7,);
  }

  .knobs-grid > .start-7 {
    grid-column-start: 1;
  }
}

@container knobs (width >= 1712px) {
  .knobs-grid.control-row {
    grid-template-columns: repeat(var(--_columns-8), minmax(0, 20rem)) var(--_reset-8,);
  }

  .knobs-grid > .start-8 {
    grid-column-start: 1;
  }
}

/* the select of the scenarios takes a line of its own, above the knobs it
 * sets, in the first column, so it is as wide as the first of them under it */
.knobs-grid > .scenario {
  grid-column: 1;
}

.knobs-grid > .scenario + * {
  grid-column-start: 1;
}

/* where the card holds two columns, the Reset takes the second column of the
 * line of the examples, beside their select and level with it, on a line which
 * has the room and uses it otherwise for nothing; in one column it follows the
 * knobs on a line of its own */
@container knobs (width >= 416px) {
  .knobs-grid > .scenario ~ .knobs-reset {
    grid-row: 1 / span 2;
    grid-column: 2;
  }
}

/*
 * The rows a card spans are reserved before its panel has read anything, so a
 * card does not grow under the reader when the declaration and the first run
 * arrive. The head row holds the copy of the head of each panel of the row
 * (`.reserve`), which the browser lays out as the panel will. The body row
 * needs nothing: a panel reserves the height of its figure from its width
 * before it has an answer. The foot row holds one line of the provenance in
 * the line height of the panel (1.45), as a minimum of the track, since a
 * subgrid card ignores a `min-height` of its own: the track holds the line, the
 * padding and the border of the card, less half of the difference between the
 * gap of the grid and the gap of the panel (16px and 8px), which the subgrid
 * takes as a margin.
 */
.grid {
  --_card-pad: 16px;
  --_track-edge: calc(var(--_card-pad) + 1px - 4px);

  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 30rem), 1fr));
  grid-auto-rows: auto auto minmax(calc(var(--_font-size-small) * 1.45 + var(--_track-edge)), auto);
  gap: 16px;
}

/*
 * A card is three rows of the grid, the head, the body and the foot of its
 * panel, and the card, the panel element and the panel inside its shadow root
 * (`::part(panel)`) are subgrids of them: the heads of the panels of a row of
 * the grid share one row, so the plots of a row line up whatever the lines of
 * the titles above them and whatever sits below them. The gaps inside a card
 * are the panel's own, the gap between two rows of cards the grid's.
 */
.cell {
  display: grid;
  grid-row: span 3;
  grid-template-rows: subgrid;
  row-gap: 0;
  min-width: 0;
  padding: var(--_card-pad);
  border: 1px solid var(--_line);
  border-radius: var(--_radius);
  background: var(--_bg-card);
  box-shadow: var(--_shadow);
}

.cell > * {
  display: grid;
  grid-row: 1 / -1;
  grid-column: 1;
  grid-template-rows: subgrid;
  row-gap: 0;
}

/*
 * The copy of the head of the panel of a card, laid out on the rows of the card
 * as the panel is (a subgrid of the gap of the panel) and in the type of the
 * head of the panel (`SbmlsimPanel.ce.vue`, `.head`, `.title`, `.subtitle`),
 * and never drawn: it holds the head row at the height the head of the panel
 * takes before the panel has drawn it, and the panel is drawn over it.
 */
.cell > .reserve {
  visibility: hidden;
  pointer-events: none;
  row-gap: 8px;
}

.reserve-head {
  display: flex;
  grid-row: 1;
  flex-direction: column;
  gap: 2px;
  font-family: var(--_font);
  font-size: var(--_font-size);
  font-style: normal;
  font-weight: 400;
  line-height: 1.45;
  text-transform: none;
  letter-spacing: normal;
}

.reserve-title {
  font-size: 15px;
  font-weight: 600;
}

.reserve-subtitle {
  font-size: var(--_font-size);
}

.cell > ::part(panel) {
  display: grid;
  grid-row: 1 / -1;
  grid-template-rows: subgrid;
  row-gap: 8px;
}

/*
 * A switch of the variant: while the app of the variant is read, the panels
 * keep the figures of the variant before, dimmed, inert and hidden from a
 * screen reader, with the caption beside the switcher which names the variant
 * they are being switched to, so none of them is taken for a figure of it and
 * the reader
 * keeps the reference a switch is made to compare against; each panel then
 * holds its figure dimmed itself until it draws one of the new variant. An app
 * of a variant which cannot be read leaves no figure of the variant before:
 * the panels keep their room and are not drawn. Nothing of the page moves in
 * either.
 */
.grid.switching > .cell > *::part(figure),
.grid.switching > .cell > *::part(foot) {
  opacity: 0.35;
}

.grid.failed > .cell > :not(.reserve) {
  visibility: hidden;
}

/* read by a screen reader and drawn nowhere: the live region of a page switch */
.live {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.footer {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 12px;
  border-top: 1px solid var(--_line);
  color: var(--_fg-soft);
  font-size: var(--_font-size);
}

/* a citation carries a url, one word longer than a phone is wide at a large
   font, which would scroll the page sideways: it breaks where it has to */
.footer p {
  margin: 0;
  overflow-wrap: anywhere;
}

.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 0 16px;
}

.simulated {
  font-family: var(--_font-mono);
  font-size: var(--_font-size-small);
}

/* the provenance of the figures of the variant before a switch, dimmed as they are */
.simulated.held {
  opacity: 0.35;
}

.footer a {
  color: var(--_accent);
}

.error {
  margin: 0;
  color: var(--_outlier);
}

.pending {
  margin: 0;
  color: var(--_fg-soft);
}

:focus-visible {
  outline: 2px solid var(--_accent);
  outline-offset: 2px;
}

/* a figure keeps the room on a phone, where the card is nearly the screen */
@container (max-width: 480px) {
  .grid {
    --_card-pad: 12px;
  }
}
</style>
