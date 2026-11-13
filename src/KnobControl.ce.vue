<script setup lang="ts">
/*
 * The control of one knob: its label, and a slider with its value or a select
 * of its choices.
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

import type { PropType } from 'vue'

import type { PanelAxis } from './contract'
import { KNOB_DIGITS, controlValue, knobLabel, rangeStep, shortNumber } from './knob'

const props = defineProps({
  /** The knob. */
  axis: { type: Object as PropType<PanelAxis>, required: true },
  /** The value the control shows, in the unit of the knob. */
  value: { type: Number, required: true },
  /** Whether the control takes no movement, e.g. of a frozen panel. */
  disabled: { type: Boolean, default: false },
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
  <div class="knob">
    <label class="knob-label" :for="controlId()">{{ knobLabel(props.axis) }}</label>
    <div v-if="props.axis.kind === 'range'" class="knob-row">
      <input
        :id="controlId()"
        type="range"
        :min="props.axis.min ?? 0"
        :max="props.axis.max ?? 1"
        :step="rangeStep(props.axis)"
        :value="props.value"
        :disabled="props.disabled"
        @input="say('input', $event)"
        @change="say('change', $event)"
      />
      <output class="knob-value" :for="controlId()" aria-live="off">{{
        shortNumber(props.value, KNOB_DIGITS)
      }}</output>
    </div>
    <select
      v-else
      :id="controlId()"
      class="knob-select"
      :value="props.value"
      :disabled="props.disabled"
      @change="say('change', $event)"
    >
      <option v-for="choice of props.axis.choices" :key="choice.label" :value="choice.value">
        {{ choice.label }}
      </option>
    </select>
  </div>
</template>

<style>
/*
 * The control declares its own size and line height, the ones of the panel, so
 * it is drawn alike in a panel and in the shell of an app, whose text is set
 * otherwise. Where it sits and how wide it is belongs to the element which
 * draws it.
 */
.knob {
  display: flex;
  flex: 1 1 160px;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: var(--_font-size);
  line-height: 1.45;
}

.knob-label {
  color: var(--_fg-soft);
  font-size: var(--_font-size-small);
}

.knob-row {
  display: flex;
  gap: 8px;
  align-items: center;
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

.knob-select {
  width: 100%;
  padding: 3px 6px;
  border: 1px solid var(--_line);
  border-radius: 6px;
  background: var(--_bg-card);
  color: var(--_fg);
  font-family: inherit;
  font-size: var(--_font-size);
}
</style>
