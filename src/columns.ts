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
 * theme sets to 125 % and a slide deck to its own, so the container queries,
 * the columns and the room of the Reset are one unit system.
 */
export const COLUMN_MAX = 320
/**
 * The room the Reset takes in a column of its own, beside the columns of the
 * knobs and the gap before it: the button is 49.7px wide in the 11px of the
 * small type of the panel (its padding of 2 x 10px, its border of 2 x 1px and
 * its label), so the room leaves 30px for a larger small type a host sets
 * (`--sbmlsim-font-size-small`), about 17px. It is the room a level keeps
 * beside full columns of knobs before it gives the Reset a column there; the
 * end to end tests measure the button against it.
 */
export const RESET_ROOM = 80
/** The numbers of columns which can fit that the card lays out a level for; the last level holds for every wider card. */
export const LEVELS = 8

/** The layout of the card at one number of columns which fit. */
export interface CardLevel {
  /** The columns of the knobs, each as wide as the card gives it up to `COLUMN_MAX`. */
  columns: number
  /**
   * Whether the Reset has a column of its own after them, as wide as the Reset:
   * beside the examples above a single column of knobs, or after the last knob
   * of a last row which is as long as the others. It takes no width from a knob
   * beyond its own.
   */
  reset: boolean
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
 * `rowsOf`. The examples of a page take a line of their own above the knobs
 * with the Reset beside them, in the second column of the knobs or, above a
 * single column of them, in a column of its own where two fit, and a page
 * without examples has its Reset follow the last knob: in the free column of a
 * last row which is shorter than the first, and else in a column of its own. A
 * column of its own is as wide as the Reset and given only where the narrowest
 * card of the level holds it beside the columns of the knobs at their widest
 * (`COLUMN_MAX`, `RESET_ROOM`), so the Reset never narrows a select. Where no
 * column is left for it, it takes a line of its own.
 *
 * @param knobs the number of knobs
 * @param fit the number of columns of `COLUMN_MIN` which fit the card
 * @param examples whether the page has examples, whose select takes a line above the knobs
 * @returns the columns of the knobs, whether the Reset has one of its own, and
 *   the knobs which start a line
 */
export function cardLevel(knobs: number, fit: number, examples: boolean): CardLevel {
  const balanced = balancedColumns(knobs, fit)
  const rows = rowsOf(knobs, fit)
  const starts: number[] = []
  let at = 0
  for (const row of rows.slice(0, -1)) {
    at += row
    starts.push(at)
  }
  // the Reset has a column of its own only where the narrowest card of the
  // level holds it beside the columns of the knobs at their widest, so it never
  // narrows a select; elsewhere it takes a line of its own
  const room = levelWidth(fit) >= balanced * (COLUMN_MAX + COLUMN_GAP) + RESET_ROOM
  if (examples) {
    // beside the examples in the second column of the knobs, or in one of its own
    return { columns: balanced, reset: balanced < 2 && room, starts }
  }
  const shorter = (rows.at(-1) ?? balanced) < balanced
  return { columns: balanced, reset: !shorter && room, starts }
}

/**
 * Get the layout of a card at every level, the first of one column.
 *
 * @param knobs the number of knobs
 * @param examples whether the page has examples
 * @returns the level of `1` to `LEVELS` columns which fit, in that order
 */
export function cardLevels(knobs: number, examples: boolean): CardLevel[] {
  return Array.from({ length: LEVELS }, (_, index) => cardLevel(knobs, index + 1, examples))
}
