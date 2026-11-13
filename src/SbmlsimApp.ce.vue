<script setup lang="ts">
/*
 * `<sbmlsim-app>`: the shell of the app of a model, in any HTML page.
 *
 * A model app is configuration and not code: the element reads the `app/1`
 * declaration of the model once, and draws its title, the navigation of its
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
 * ## What happens to a page
 *
 * The declaration is read once for the life of the element, and a switch of the
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

import { DEFAULT_TIMEOUT, FAILURE_MESSAGES, PanelClient, failureKind } from './client'
import type { FailureKind } from './client'
import type { AppDeclaration, AppPage, PanelAxis, Provenance, SharedKnob } from './contract'
import KnobControl from './KnobControl.ce.vue'
import ResetButton from './ResetButton.ce.vue'
import { keepControlKeys, ownValue } from './knob'
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
/** The provenance of the latest answer of each panel of the page, by the id of the panel. */
const answers = ref<Record<string, Provenance>>({})
/** What the live region says, the page which was switched to; empty until a reader switches. */
const announced = ref('')

/** The controller of the request of the app, so a superseded one is dropped. */
let flight: AbortController | null = null

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

/** The variant the panels simulate, empty for the one their declaration names. */
const variantOfPanels = computed<string>(() => (variants.value.length > 0 ? chosen.value : ''))

/**
 * The knobs the panels of the page share, as the service states them in the
 * app: the ids more than one of its panels declares, each with its declaration
 * and the panels it sets, in the order the first panel which declares one
 * lists them.
 */
const sharedKnobs = computed<SharedKnob[]>(() => {
  const page = current.value
  return page === null ? [] : (app.value?.shared[page.id] ?? [])
})

/** Whether every shared knob of the page is at its declared default, which a reset changes nothing of. */
const sharedAtDefaults = computed<boolean>(() =>
  sharedKnobs.value.every(
    (one) => (ownValue(shared.value, one.knob.id) ?? one.knob.default) === one.knob.default,
  ),
)

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
    app.value = declared
    chosen.value = declared.variants[0]?.id ?? ''
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
    answers.value = { ...answers.value, [provenance.panel]: provenance }
  }
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
    resetShared()
  },
  { flush: 'pre' },
)

watch(variantOfPanels, () => {
  answers.value = {}
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
            @click="show(one.id)"
          >
            {{ one.title }}
          </button>
        </nav>
        <label v-if="variants.length > 0" class="variant">
          <span class="variant-label">Variant</span>
          <select v-model="chosen" class="variant-select">
            <option v-for="one in variants" :key="one.id" :value="one.id">{{ one.label }}</option>
          </select>
        </label>
      </div>
      <div
        v-if="sharedKnobs.length > 0"
        class="knobs"
        role="group"
        aria-label="Simulation settings of the page"
        @keydown="keepControlKeys($event)"
      >
        <KnobControl
          v-for="one of sharedKnobs"
          :key="one.knob.id"
          :axis="one.knob"
          :value="ownValue(shared, one.knob.id) ?? one.knob.default"
          :described-by="drivesId(one.knob)"
          @input="moveShared(one.knob, $event)"
          @change="moveShared(one.knob, $event)"
        />
        <ResetButton :disabled="sharedAtDefaults" @click="resetShared()" />
        <p v-for="one of sharedKnobs" :id="drivesId(one.knob)" :key="one.knob.id" class="unseen">
          {{ drivesText(one) }}
        </p>
      </div>
      <!-- a region and no main: the page which embeds the shell has its own landmark;
           `values` is written as the attribute a page writes, and left off a panel
           which shares no knob -->
      <section
        ref="grid"
        :key="current.id"
        class="grid"
        :aria-label="current.title"
        @sbmlsim-result="collect"
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
          ></component>
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
        <p v-if="simulated !== ''" class="simulated">{{ simulated }}</p>
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

/* the bold of the current page is reserved by every tab, so the tabs do not move
 * when the page changes */
.tab::after {
  display: block;
  height: 0;
  overflow: hidden;
  visibility: hidden;
  content: attr(data-label);
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
  align-items: center;
  gap: 8px;
  padding-bottom: 6px;
  color: var(--_fg-soft);
  font-size: var(--_font-size);
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
 * panels are; a control fills a phone and is no wider than a reader reads a
 * select at on a wide page */
.knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: flex-end;
  padding: 12px 16px;
  border: 1px solid var(--_line);
  border-radius: var(--_radius);
  background: var(--_bg-card);
  box-shadow: var(--_shadow);
}

.knobs .knob {
  max-width: 20rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 30rem), 1fr));
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
  padding: 16px;
  border: 1px solid var(--_line);
  border-radius: var(--_radius);
  background: var(--_bg-card);
  box-shadow: var(--_shadow);
}

.cell > * {
  display: grid;
  grid-row: 1 / -1;
  grid-template-rows: subgrid;
  row-gap: 0;
}

.cell > ::part(panel) {
  display: grid;
  grid-row: 1 / -1;
  grid-template-rows: subgrid;
  row-gap: 8px;
}

/* read by a screen reader and drawn nowhere: the live region of a page switch
 * and the text which says which panels a shared control sets */
.live,
.unseen {
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
  .cell {
    padding: 12px;
  }
}
</style>
