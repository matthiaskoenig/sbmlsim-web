<script setup lang="ts">
/*
 * The control of one knob: its label, and a slider with its value or a select
 * of its choices. A range knob with named stops - the stages of a renal
 * impairment over a clearance - draws a select of its stops above its slider:
 * the two are one control under one visible label, the slider named by the
 * label and the select by the label and the words `named value`, both
 * reachable with the keyboard. Picking a stop moves the slider to it, and a
 * slider moved onto a stop shows that stop in the select; a value which is no
 * stop shows the entry `custom`, which is drawn only then and cannot be
 * picked. A range knob without stops is drawn as it always was.
 *
 * It is the one control of a knob wherever the knob is drawn, inside a panel
 * and above the grid of an app (`SbmlsimApp.ce.vue`), so a reader cannot tell
 * from the control which element drew it. It is a component of the element
 * which draws it and no custom element of its own: it lives in the shadow root
 * of that element, which takes its stylesheet in with it (`*.ce.vue`), so its
 * label points at its input inside one root.
 *
 * It holds no state: it shows the value it is given and says what a reader did,
 * `input` while a slider is dragged and `change` when it is released or a
 * choice is picked, which is the difference between reading a grid and asking
 * for a run.
 */

import { computed } from 'vue'
import type { PropType } from 'vue'

import type { PanelAxis, PanelChoice } from './contract'
import {
  KNOB_DIGITS,
  choiceAt,
  controlValue,
  knobLabel,
  rangeStep,
  shortNumber,
  stopsOf,
} from './knob'

/** The value of the entry of the select of the stops which says the value is no stop. */
const CUSTOM = 'custom'

const props = defineProps({
  /** The knob. */
  axis: { type: Object as PropType<PanelAxis>, required: true },
  /** The value the control shows, in the unit of the knob. */
  value: { type: Number, required: true },
  /** Whether the control takes no movement, e.g. of a frozen panel. */
  disabled: { type: Boolean, default: false },
  /** The id of a text which says what the control sets, none without. */
  describedBy: { type: String, default: undefined },
})

const emit = defineEmits<{
  /** The slider is being dragged to a value. */
  input: [value: number]
  /** The slider was released at a value, or a choice was picked. */
  change: [value: number]
}>()

/**
 * Get the id of the control, which its label points at.
 *
 * @returns an id which is unique inside the shadow root it is drawn in, where
 *   a knob id is drawn once
 */
function controlId(): string {
  return `knob-${props.axis.id}`
}

/** The named stops of a range knob, none for a choice knob or a range knob without. */
const stops = computed<PanelChoice[]>(() => stopsOf(props.axis))

/**
 * What the slider of a knob with stops says to a screen reader: its value and
 * the stop it is at, e.g. `110, normal`, so a reader of the slider alone hears
 * the stage as a reader of the select does; nothing extra off a stop or for a
 * knob without stops, whose value is what it says.
 */
const valueText = computed<string | undefined>(() => {
  const at = choiceAt(stops.value, props.value)
  return at === null ? undefined : `${shortNumber(props.value, KNOB_DIGITS)}, ${at.label}`
})

/** The value the select of the stops shows: the stop the knob is at, else `custom`. */
const stopShown = computed<string>(() => {
  const at = choiceAt(stops.value, props.value)
  return at === null ? CUSTOM : String(at.value)
})

/**
 * Get the id of the visible label, which the select of the stops is named by.
 *
 * @returns an id which is unique inside the shadow root it is drawn in
 */
function labelId(): string {
  return `knob-${props.axis.id}-label`
}

/**
 * Get the id of the select of the stops.
 *
 * @returns an id which is unique inside the shadow root it is drawn in
 */
function stopsId(): string {
  return `knob-${props.axis.id}-stops`
}

/**
 * Get the id of the words which name the select of the stops after the label.
 *
 * @returns an id which is unique inside the shadow root it is drawn in
 */
function stopsNameId(): string {
  return `knob-${props.axis.id}-stops-name`
}

/**
 * Say what a reader did with the control.
 *
 * @param kind `input` for a movement, `change` for a release
 * @param event the event of the control
 */
function say(kind: 'input' | 'change', event: Event): void {
  const value = controlValue(event)
  if (value === null) {
    return
  }
  if (kind === 'input') {
    emit('input', value)
  } else {
    emit('change', value)
  }
}
</script>

<template>
  <div class="knob" :class="{ stopped: stops.length > 0 }">
    <label :id="labelId()" class="knob-label" :for="controlId()">{{ knobLabel(props.axis) }}</label>
    <!-- the controls of the knob, under the line of its label -->
    <div class="knob-body">
      <template v-if="props.axis.kind === 'range'">
        <template v-if="stops.length > 0">
          <!-- the words which name the select after the label; hidden, since the
               label is the one visible name of the two controls -->
          <span :id="stopsNameId()" hidden>named value</span>
          <select
            :id="stopsId()"
            class="knob-select"
            :value="stopShown"
            :aria-labelledby="`${labelId()} ${stopsNameId()}`"
            :aria-describedby="props.describedBy"
            :disabled="props.disabled"
            @change="say('change', $event)"
          >
            <option v-if="stopShown === CUSTOM" :value="CUSTOM" disabled>custom</option>
            <option v-for="stop of stops" :key="stop.label" :value="String(stop.value)">
              {{ stop.label }}
            </option>
          </select>
        </template>
        <div class="knob-row">
          <input
            :id="controlId()"
            type="range"
            :min="props.axis.min ?? 0"
            :max="props.axis.max ?? 1"
            :step="rangeStep(props.axis)"
            :value="props.value"
            :aria-valuetext="valueText"
            :aria-describedby="props.describedBy"
            :disabled="props.disabled"
            @input="say('input', $event)"
            @change="say('change', $event)"
          />
          <output class="knob-value" :for="controlId()" aria-live="off">{{
            shortNumber(props.value, KNOB_DIGITS)
          }}</output>
        </div>
      </template>
      <select
        v-else
        :id="controlId()"
        class="knob-select"
        :value="props.value"
        :aria-describedby="props.describedBy"
        :disabled="props.disabled"
        @change="say('change', $event)"
      >
        <option v-for="choice of props.axis.choices" :key="choice.label" :value="choice.value">
          {{ choice.label }}
        </option>
      </select>
    </div>
  </div>
</template>

<style src="./control.css"></style>

<style>
/*
 * The label, the select and the size of the control are the ones of
 * `control.css`, which the select of the scenarios of a page shares; the row
 * of a slider and its value are the control of a knob alone.
 */
.knob-row {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: var(--_control-height);
}

.knob-row input {
  flex: 1 1 auto;
  min-width: 0;
  accent-color: var(--_accent);
}

.knob-value {
  min-width: 4ch;
  color: var(--_fg);
  font-family: var(--_font-mono);
  font-size: var(--_font-size-small);
  text-align: right;
}
</style>
