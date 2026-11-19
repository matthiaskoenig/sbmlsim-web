<script setup lang="ts">
/*
 * The figure of a model, which is the control of its app: a reader clicks an
 * organ of the drawing and the element reports the key path of what was
 * clicked, the app opens the panels of it (`AppFigure.panels`).
 *
 * The drawing is the svg of the declaration, inserted as markup. It is trusted:
 * it comes from the model package which assembles the app, the same origin as
 * the panel declarations and the model, and it is not sanitized, which is a
 * recorded decision and not an oversight. The elements of it which matter carry
 * `data-k`; the key path of an element is the keys of it and of its ancestors
 * joined from the outside in, `li` or `li/sub:gli`.
 *
 * One delegated listener reads a click. The longest path of the clicked element
 * which opens a panel wins, so an element of a group whose own path is not in
 * the map falls back to the group, and a click on an element without a key, or
 * one whose paths open nothing (a decoration), reports nothing. The elements
 * which open something are drawn as controls, a pointer, a focus ring and the
 * keys of a button, and the ones which open nothing are not. The nesting of
 * controls is deliberate, a chip inside an organ is genuinely its own control,
 * and at most two deep. A key path is joined with `/`, so a key which contains
 * one is ambiguous. The paths in
 * `marked`, the readouts on screen, are drawn marked and say so as
 * `aria-pressed`, which is how the figure shows the state of the dashboard; the
 * element only draws what it is told and the app decides what a click does, so
 * a click on a marked path is reported like any other one.
 */
import { computed, onMounted, ref, useHost, watch } from 'vue'
import type { PropType } from 'vue'

import type { AppFigure } from './contract'

/** The attribute of the drawing which carries the key of an element. */
const KEY = 'data-k'

/** The separator of the keys of a path. */
const SEPARATOR = '/'

/** The class of an element which opens a panel. */
const LIVE = 'k-live'

/** The class of an element whose path is on screen. */
const MARKED = 'k-marked'

const props = defineProps({
  /** The figure of the app, `null` for none: the element draws nothing then. */
  figure: { type: Object as PropType<AppFigure | null>, default: null },
  /** The key paths whose readouts are on screen, drawn marked. */
  marked: { type: Array as PropType<string[]>, default: () => [] },
  /**
   * The names of the key paths, which the drawing itself does not carry: the accessible name of
   * a control, the key path where there is none.
   */
  labels: { type: Object as PropType<Record<string, string>>, default: () => ({}) },
})

const host = useHost()

/** The wrapper the drawing is inserted into. */
const drawing = ref<HTMLElement | null>(null)

/** The key paths which open at least one panel. */
const opening = computed<Set<string>>(
  () =>
    new Set(
      Object.entries(props.figure?.panels ?? {})
        .filter(([, ids]) => ids.length > 0)
        .map(([path]) => path),
    ),
)

/**
 * Get the keys of an element and of its ancestors up to the wrapper.
 *
 * @param element the element
 * @returns the keys from the outside in, empty for an element inside none
 */
function keysOf(element: Element | null): string[] {
  const keys: string[] = []
  for (let one = element; one !== null && one !== drawing.value; one = one.parentElement) {
    const key = one.getAttribute(KEY)
    if (key !== null) {
      keys.unshift(key)
    }
  }
  return keys
}

/**
 * Get the path an element opens, the longest one of its keys which opens a panel.
 *
 * @param element the element
 * @returns the path, `null` where none of them does
 */
function opened(element: Element | null): string | null {
  const keys = keysOf(element)
  for (let length = keys.length; length > 0; length -= 1) {
    const path = keys.slice(0, length).join(SEPARATOR)
    if (opening.value.has(path)) {
      return path
    }
  }
  return null
}

/**
 * Report a path to the page.
 *
 * @param key the key path
 */
function select(key: string): void {
  host?.dispatchEvent(
    new CustomEvent('sbmlsim-figure-select', {
      detail: { key },
      bubbles: true,
      composed: true,
    }),
  )
}

/**
 * Take a click anywhere in the drawing.
 *
 * @param event the click
 */
function click(event: MouseEvent): void {
  const key = opened(event.target instanceof Element ? event.target : null)
  if (key !== null) {
    select(key)
  }
}

/**
 * Take a key of the keyboard, which acts as a press on a focused control of the drawing.
 *
 * @param event the key
 */
function press(event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return
  }
  const target = event.target instanceof Element ? event.target : null
  const key = target?.classList.contains(LIVE) === true ? opened(target) : null
  if (key !== null) {
    event.preventDefault()
    select(key)
  }
}

/** Draw what the element is told: which elements are controls and which are marked. */
function decorate(): void {
  const root = drawing.value
  if (root === null) {
    return
  }
  const marked = new Set(props.marked)
  for (const element of root.querySelectorAll(`[${KEY}]`)) {
    const path = keysOf(element).join(SEPARATOR)
    const live = opening.value.has(path)
    element.classList.toggle(LIVE, live)
    element.classList.toggle(MARKED, live && marked.has(path))
    if (live) {
      element.setAttribute('role', 'button')
      element.setAttribute('aria-label', props.labels[path] ?? path)
      element.setAttribute('tabindex', '0')
      element.setAttribute('aria-pressed', marked.has(path) ? 'true' : 'false')
    } else {
      for (const attribute of ['role', 'tabindex', 'aria-pressed', 'aria-label']) {
        element.removeAttribute(attribute)
      }
    }
  }
}

// shallow: the app replaces the three, and a deep watch would walk the whole svg string
watch(() => [props.figure, props.marked, props.labels] as const, decorate, { flush: 'post' })

onMounted(decorate)
</script>

<template>
  <figure v-if="props.figure" class="figure" part="figure">
    <!-- eslint-disable vue/no-v-html -- trusted markup of the model package, see the comment above -->
    <div
      ref="drawing"
      class="drawing"
      part="drawing"
      role="group"
      :aria-label="props.figure.title"
      @click="click"
      @keydown="press"
      v-html="props.figure.svg"
    ></div>
    <!-- eslint-enable vue/no-v-html -->
    <figcaption class="caption">
      <span class="title">{{ props.figure.title }}</span>
      <span v-if="props.figure.credit" class="credit">{{ props.figure.credit }}</span>
    </figcaption>
  </figure>
</template>

<style src="./theme.css"></style>

<style>
.figure {
  display: block;
  margin: 0;
  color: var(--_fg);
  font-family: var(--sbmlsim-font, inherit);
  font-size: var(--_font-size-small);
}

.drawing svg {
  display: block;
  width: 100%;
  height: auto;
}

/* only what opens a panel is drawn as a control */
.drawing .k-live {
  cursor: pointer;
}

/* a pointer over a control is a soft glow of the text colour, a hint and no state */
.drawing .k-live:hover {
  filter: drop-shadow(0 0 3px var(--_fg-soft));
}

.drawing .k-live:focus-visible {
  outline: 2px solid var(--_accent);
  outline-offset: 2px;
}

/*
 * A path which is on screen is a crisp outline in the accent, of a kind the
 * hover never is: the stroke of the shapes of the element, a constant width on
 * the screen whatever the scale of the drawing. A control of the same element
 * which is not on screen keeps its own look.
 */
.drawing .k-marked:is(path, rect, circle, ellipse, polygon, polyline),
.drawing
  .k-marked
  :is(path, rect, circle, ellipse, polygon, polyline):not(
    .k-live:not(.k-marked),
    .k-live:not(.k-marked) *
  ) {
  stroke: var(--_accent);
  stroke-width: 3px;
  vector-effect: non-scaling-stroke;
}

/* a filter is dropped where the colours are forced, so the mark and the hover are lines there */
@media (forced-colors: active) {
  .drawing .k-live:hover {
    outline: 1px dashed CanvasText;
  }

  .drawing .k-marked:is(path, rect, circle, ellipse, polygon, polyline),
  .drawing
    .k-marked
    :is(path, rect, circle, ellipse, polygon, polyline):not(
      .k-live:not(.k-marked),
      .k-live:not(.k-marked) *
    ) {
    stroke: Highlight;
    stroke-width: 4px;
  }

  .drawing .k-marked {
    outline: 3px solid Highlight;
    outline-offset: 1px;
  }
}

.caption {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
  margin-top: 4px;
}

.credit {
  color: var(--_fg-soft);
}
</style>
