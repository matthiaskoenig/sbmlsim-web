<script setup lang="ts">
/*
 * The button which puts knobs back to their declared defaults, in a panel for
 * the knobs the panel owns and above the grid of an app for the knobs its
 * panels share (`SbmlsimApp.ce.vue`), drawn alike in both.
 *
 * It is disabled while what it resets is at its defaults, so a Reset which can
 * be pressed always changes something a reader sees. `disabled` and `click`
 * fall through to the button.
 */
</script>

<template>
  <button type="button" class="reset">Reset</button>
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

.reset:hover:not(:disabled) {
  border-color: var(--_accent);
  color: var(--_accent);
}

/* a reset with nothing to reset is drawn as one which does nothing */
.reset:disabled {
  color: var(--_fg-soft);
  cursor: default;
  opacity: 0.6;
}
</style>
