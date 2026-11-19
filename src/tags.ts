/**
 * The tags of the three elements and the one a shell places its panels under.
 *
 * It is a module of its own because both `index.ts`, which registers the
 * elements, and the shell, which places the panels, need it, and the shell
 * cannot import the index which imports it.
 */

/** The tag the panel is registered under unless a page asks for another one. */
export const PANEL_TAG = 'sbmlsim-panel'

/** The tag the shell of an app is registered under unless a page asks for another one. */
export const APP_TAG = 'sbmlsim-app'

/** The tag the figure of a model is registered under unless a page asks for another one. */
export const FIGURE_TAG = 'sbmlsim-figure'

/**
 * The tag the shells place their panels under, the one `register` was called
 * with last. A shell reads it once, when it is created, so a later call changes
 * what the shells built after it place and leaves the ones already on the page
 * as they are.
 */
let placed: string = PANEL_TAG

/**
 * Get the tag a shell places its panels under.
 *
 * @returns the tag of the panel as `register` registered it
 */
export function placedPanelTag(): string {
  return placed
}

/**
 * Set the tag a shell places its panels under.
 *
 * @param tagName the tag the panel is registered under
 */
export function placePanelTag(tagName: string): void {
  placed = tagName
}
