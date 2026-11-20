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
 *
 * A model drawing is dense and wide, and in the column of a page its labels are
 * small, so the element shows it at the size of the window in a dialog: the
 * button in the corner of the figure opens it, and so does a click on the
 * drawing which opens no panel, which is every place of it that is not a
 * control. A click on a control of the enlarged drawing reports its path and
 * closes the dialog, so a reader aims at an organ in the large drawing and
 * lands back on the panels it opened; a click beside the drawing, the close
 * button and Escape close it as well. The drawing is not copied into the
 * dialog, it moves there and back (`Teleport`), so the ids inside the svg stay
 * unique, the controls and the marks are the ones the page decorated, and one
 * listener serves both places.
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

/** The dialog which holds the drawing while it is enlarged. */
const overlay = ref<HTMLDialogElement | null>(null)

/** The box inside the dialog the drawing moves into. */
const stage = ref<HTMLElement | null>(null)

/** The box of the figure the drawing leaves while it is enlarged. */
const frame = ref<HTMLElement | null>(null)

/** The height the frame held when the drawing left it, in px. */
const held = ref(0)

/** Whether the drawing is shown at the size of the window. */
const enlarged = ref(false)

/** The name of the button which enlarges the drawing. */
const ENLARGE = 'Enlarge the figure'

/** The name of the button which closes the enlarged drawing. */
const CLOSE = 'Close the figure'

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
 * Show the drawing at the size of the window.
 *
 * The figure keeps the height the drawing had while it is away, so the page
 * behind the dialog does not jump and the caption stays where it was.
 */
function enlarge(): void {
  if (props.figure !== null) {
    held.value = frame.value?.getBoundingClientRect().height ?? 0
    enlarged.value = true
  }
}

/** Put the drawing back into the figure of the page. */
function shrink(): void {
  enlarged.value = false
}

/**
 * Take a click anywhere in the drawing, enlarged or in the page.
 *
 * A click which opens no panel enlarges the drawing, and closes it where it is
 * enlarged already; a click on a control reports its path and leaves the
 * drawing in the figure of the page.
 *
 * @param event the click
 */
function click(event: MouseEvent): void {
  const key = opened(event.target instanceof Element ? event.target : null)
  if (key === null) {
    if (enlarged.value) {
      shrink()
    } else {
      enlarge()
    }
    return
  }
  select(key)
  shrink()
}

/**
 * Take a click of the dialog itself, which is the room beside the drawing.
 *
 * @param event the click
 */
function beside(event: MouseEvent): void {
  if (event.target === overlay.value) {
    shrink()
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
    shrink()
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

// after the drawing moved, so the dialog is shown with the drawing already in it
watch(
  enlarged,
  (open) => {
    const dialog = overlay.value
    if (dialog === null) {
      return
    }
    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  },
  { flush: 'post' },
)

// a figure which is taken away leaves no dialog open
watch(
  () => props.figure,
  (figure) => {
    if (figure === null) {
      shrink()
    }
  },
)

onMounted(decorate)
</script>

<template>
  <figure v-if="props.figure" class="figure" part="figure">
    <!-- before the drawing, so its box is there when the drawing moves into it -->
    <dialog
      ref="overlay"
      class="overlay"
      part="overlay"
      :aria-label="props.figure.title"
      @close="shrink"
      @click="beside"
    >
      <div ref="stage" class="stage" part="stage"></div>
      <button
        type="button"
        class="button close"
        part="close"
        :aria-label="CLOSE"
        :title="CLOSE"
        @click="shrink"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </svg>
      </button>
    </dialog>
    <div ref="frame" class="frame" :style="enlarged ? { minHeight: `${held}px` } : undefined">
      <Teleport :to="stage" :disabled="!enlarged">
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
      </Teleport>
      <button
        type="button"
        class="button zoom"
        part="zoom"
        :aria-label="ENLARGE"
        :title="ENLARGE"
        @click="enlarge"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.4 10.4l4 4M7 5v4M5 7h4" />
        </svg>
      </button>
    </div>
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
 * A path which is on screen is a halo in the accent around the element as a
 * whole, two shadows so it reads at normal zoom, where the hover is a single
 * soft neutral one: the two differ in colour, which is what tells the organ on
 * screen from the one under the pointer. The mark must never depend on the
 * kinds of shape children a group happens to contain. A `data-k` group is a
 * label, an icon, a box and every arrow inside it, and anything applied per
 * child, a stroke for one, repaints the internals of the drawing, so it stays
 * a filter of the element, which leaves every stroke and fill as the model
 * package drew it.
 */
.drawing .k-marked,
.drawing .k-marked:hover {
  filter: drop-shadow(0 0 2px var(--_accent)) drop-shadow(0 0 2px var(--_accent));
}

/* a filter is dropped where the colours are forced, so the mark and the hover are outlines there */
@media (forced-colors: active) {
  .drawing .k-live:hover {
    outline: 1px dashed CanvasText;
  }

  .drawing .k-marked,
  .drawing .k-marked:hover {
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

/* the drawing and the button which enlarges it, which sits in the corner of the figure */
.frame {
  position: relative;
}

.button {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--_line);
  border-radius: var(--_radius);
  background: var(--_bg-card);
  color: var(--_fg-soft);
  cursor: pointer;
}

.button:hover,
.button:focus-visible {
  color: var(--_fg);
  border-color: var(--_accent);
}

.button:focus-visible {
  outline: 2px solid var(--_accent);
  outline-offset: 2px;
}

.button svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.4;
  stroke-linecap: round;
}

.zoom {
  position: absolute;
  inset-block-start: 4px;
  inset-inline-end: 4px;
  opacity: 0.7;
}

.zoom:hover,
.zoom:focus-visible {
  opacity: 1;
}

/*
 * The enlarged drawing: a dialog of the window, with the drawing fitted into it
 * so that no part of it is cut off and the labels are read at the size the
 * model package drew them. No viewport unit of the width of the page is used
 * elsewhere in the element, but the dialog is the window and not the column it
 * sits in, so it is measured in them.
 */
.overlay {
  box-sizing: border-box;
  width: min(96vw, 1800px);
  max-width: 96vw;
  max-height: 94vh;
  padding: 12px;
  border: 1px solid var(--_line);
  border-radius: var(--_radius);
  background: var(--_bg-card);
  color: var(--_fg);
  overflow: auto;
}

.overlay::backdrop {
  background: rgb(0 0 0 / 60%);
}

.close {
  position: absolute;
  inset-block-start: 12px;
  inset-inline-end: 12px;
}

.stage {
  min-width: 0;
}

/* in the dialog the drawing fits the window, where in the page it fills its column */
.overlay .drawing svg {
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 86vh;
  margin: 0 auto;
}
</style>
