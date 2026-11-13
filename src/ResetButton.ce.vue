<script setup lang="ts">
/*
 * The button which puts knobs back to their declared defaults, in a panel for
 * the knobs the panel owns and above the grid of an app for the knobs its
 * panels share (`SbmlsimApp.ce.vue`), drawn alike in both.
 *
 * While what it resets is at its defaults it does nothing, says so to a screen
 * reader (`aria-disabled`) and is drawn as a button which does nothing, but it
 * stays focusable: a reader who presses it with the keyboard puts everything
 * back and keeps the focus where it was, on the button, and is told that it has
 * nothing left to do. A `disabled` button would drop the focus to the start of
 * the page the moment the reset is done. `disabled` itself, which falls through
 * to the button, is for a panel which is frozen, whose controls are all dead.
 */

const props = defineProps({
  /** Whether what the button resets is at its defaults, so a press does nothing. */
  idle: { type: Boolean, default: false },
})

const emit = defineEmits<{
  /** A press while there is something to reset. */
  reset: []
}>()

/** Take a press of the button, which resets only where there is something to reset. */
function press(): void {
  if (!props.idle) {
    emit('reset')
  }
}
</script>

<template>
  <button
    type="button"
    class="reset"
    :aria-disabled="props.idle ? 'true' : undefined"
    @click="press()"
  >
    Reset
  </button>
</template>

<style>
.reset {
  padding: 3px 10px;
  border: 1px solid var(--_line);
  border-radius: 6px;
  background: var(--_bg-card);
  color: var(--_fg);
  font-family: inherit;
  font-size: var(--_font-size-small);
  cursor: pointer;
}

.reset:hover:not(:disabled, [aria-disabled='true']) {
  border-color: var(--_accent);
  color: var(--_accent);
}

/* a reset with nothing to reset is drawn as one which does nothing */
.reset:disabled,
.reset[aria-disabled='true'] {
  color: var(--_fg-soft);
  cursor: default;
  opacity: 0.6;
}
</style>
