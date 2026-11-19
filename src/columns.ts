/**
 * The columns of the card of the shared controls of an app: balanced rows of
 * knobs at their natural width.
 *
 * The card holds `fit` columns of `COLUMN_MIN` and the gap between them, and
 * its `n` knobs take `ceil(n / ceil(n / fit))` of them, so the rows are as even
 * as the width allows: six knobs which fit five columns are two rows of three
 * and not a row of five over one knob alone. The rows are as few as the columns
 * which fit allow and differ by one knob at most, the longer ones first, so
 * seven knobs which fit three columns are three rows of 3, 2 and 2 and not of
 * 3, 3 and 1 (`rowsOf`). A column is as wide as it can be up to `COLUMN_MAX` and the
 * card is not filled beyond that.
 *
 * The width the card has is a matter of the layout and not of a script: the
 * shell lays out a level of the card for every number of columns which can fit
 * (`LEVELS`), each the columns of the grid and the knobs which start a line, and
 * a container query of the card picks the level of its width
 * (`SbmlsimApp.ce.vue`), so nothing is measured and the first frame is right.
 */

/** The narrowest column of the card, which holds the label of an example. */
export const COLUMN_MIN = 200
/** The gap between two columns of the card, the `column-gap` of a row of controls. */
export const COLUMN_GAP = 16
/**
 * The widest column of the card. Every length of the rule is in px, as the
 * grid it lays out is (`SbmlsimApp.ce.vue`): a length of the layout of a
 * component never depends on the root font of its host, which a documentation
 * theme sets to 125 % and a slide deck to its own, so the container queries
 * and the columns are one unit system.
 */
export const COLUMN_MAX = 320
/** The numbers of columns which can fit that the card lays out a level for; the last level holds for every wider card. */
export const LEVELS = 8

/** The layout of the card at one number of columns which fit. */
export interface CardLevel {
  /** The columns of the knobs, each as wide as the card gives it up to `COLUMN_MAX`. */
  columns: number
  /** The positions of the knobs which start a line, the first knob left out. */
  starts: number[]
}

/**
 * Get the columns the knobs of a card take, balanced over its rows.
 *
 * @param knobs the number of knobs
 * @param fit the number of columns of `COLUMN_MIN` which fit the card
 * @returns `ceil(knobs / ceil(knobs / fit))`, at least 1
 */
export function balancedColumns(knobs: number, fit: number): number {
  const most = Math.max(1, Math.floor(fit))
  const count = Math.max(1, Math.floor(knobs))
  return Math.ceil(count / Math.ceil(count / most))
}

/**
 * Get the knobs of every row of a card, as even as the columns which fit allow.
 *
 * @param knobs the number of knobs
 * @param fit the number of columns of `COLUMN_MIN` which fit the card
 * @returns the knobs of each row in their order: as few rows as `fit` allows,
 *   of `balancedColumns` knobs or one fewer, the longer rows first
 */
export function rowsOf(knobs: number, fit: number): number[] {
  const count = Math.max(1, Math.floor(knobs))
  const columns = balancedColumns(count, fit)
  const rows = Math.ceil(count / columns)
  // the rows of all the columns, and the others one knob shorter
  const full = count - rows * (columns - 1)
  return Array.from({ length: rows }, (_, index) => (index < full ? columns : columns - 1))
}

/**
 * Get the inner width a card needs to hold a number of columns.
 *
 * @param fit the number of columns
 * @returns the pixels of `fit` columns of `COLUMN_MIN` and the gaps between them
 */
export function levelWidth(fit: number): number {
  return fit * COLUMN_MIN + (fit - 1) * COLUMN_GAP
}

/**
 * Get the layout of a card of knobs at a number of columns which fit.
 *
 * The knobs take their balanced columns and start a line at every row of
 * `rowsOf`.
 *
 * @param knobs the number of knobs
 * @param fit the number of columns of `COLUMN_MIN` which fit the card
 * @returns the columns of the knobs and the knobs which start a line
 */
export function cardLevel(knobs: number, fit: number): CardLevel {
  const rows = rowsOf(knobs, fit)
  const starts: number[] = []
  let at = 0
  for (const row of rows.slice(0, -1)) {
    at += row
    starts.push(at)
  }
  return { columns: balancedColumns(knobs, fit), starts }
}

/**
 * Get the layout of a card at every level, the first of one column.
 *
 * @param knobs the number of knobs
 * @returns the level of `1` to `LEVELS` columns which fit, in that order
 */
export function cardLevels(knobs: number): CardLevel[] {
  return Array.from({ length: LEVELS }, (_, index) => cardLevel(knobs, index + 1))
}
