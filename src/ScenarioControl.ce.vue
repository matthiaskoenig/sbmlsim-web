<script setup lang="ts">
/*
 * The control of the scenarios of a page of an app: a select of named states
 * of its shared knobs, e.g. example patients, above the controls of those
 * knobs (`SbmlsimApp.ce.vue`).
 *
 * It is drawn in the type of the control of a knob (`control.css`), with a
 * visible label of its own, and it holds no state: it shows the scenario the
 * knobs are at, which its owner works out, and says which one a reader picked.
 * Where the knobs are at no scenario it shows the entry `custom`, which is
 * drawn only then and cannot be picked.
 */

import type { PropType } from 'vue'

import type { Scenario } from './contract'

/**
 * The value of the entry which says the knobs are at no scenario: the empty
 * text, which no id of a scenario is (an SId is not empty, and the client
 * refuses an app whose scenario has an empty id), so a scenario of any id,
 * `custom` among them, can be picked.
 */
const CUSTOM = ''

const props = defineProps({
  /** The label of the control, what the scenarios are. */
  label: { type: String, required: true },
  /** The scenarios in the order the page lists them. */
  scenarios: { type: Array as PropType<Scenario[]>, required: true },
  /** The id of the scenario the knobs are at, `null` for none. */
  shown: { type: String as PropType<string | null>, default: null },
  /** Whether the control takes no pick, e.g. while the app is read again. */
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits<{
  /** A reader picked a scenario, by its id. */
  pick: [id: string]
}>()

/**
 * Say which scenario a reader picked.
 *
 * @param event the `change` event of the select
 */
function say(event: Event): void {
  const target = event.target
  if (target instanceof HTMLSelectElement && target.value !== CUSTOM) {
    emit('pick', target.value)
  }
}
</script>

<template>
  <div class="knob scenario">
    <label class="knob-label" for="scenario">{{ props.label }}</label>
    <div class="knob-body">
      <select
        id="scenario"
        class="knob-select"
        :value="props.shown ?? CUSTOM"
        :disabled="props.disabled"
        @change="say($event)"
      >
        <option v-if="props.shown === null" :value="CUSTOM" disabled>custom</option>
        <option v-for="one of props.scenarios" :key="one.id" :value="one.id">
          {{ one.label }}
        </option>
      </select>
    </div>
  </div>
</template>

<style src="./control.css"></style>
