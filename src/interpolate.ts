/**
 * The local interpolation of a grid which was fetched once.
 *
 * A grid is one request per figure and not one per movement of a knob: a
 * renderer fetches the points of the axes once and reads the position between
 * them here, while a knob moves. This module is pure - no network, no vue, no
 * dom - so it is the same function in a page, in a test and in a worker.
 */

import type { Grid } from './contract'

/** One index of an axis and the weight it carries at a position. */
interface AxisWeight {
  /** The index of the point on the axis. */
  index: number
  /** Its weight, which is greater than 0 and at most 1. */
  weight: number
}

/** One point of the grid which bounds a position, by its flat index in C order. */
interface Corner {
  /** The flat index of the point, the row of a curve. */
  row: number
  /** The weight of its row; the weights of the corners of a position sum to 1. */
  weight: number
}

/**
 * Get the indices of an axis which bound a value, with their weights.
 *
 * The axis is read in the order its payload states it and in no other: the
 * values of a range knob ascend, the values of a choice knob are its choices in
 * the order their declaration lists them, which may descend or do neither. The
 * first interval of two neighbours which brackets the value is the one which is
 * read, whichever way it runs, so a value which lands on a point of the axis
 * reads that point alone.
 *
 * A value which no interval brackets - one beyond either end of a monotone
 * axis, and one which an axis of another order does not cover - reads the
 * nearest point of the axis, which is the clamp to the nearer of its ends.
 *
 * @param values the values of the axis, in the order of the payload
 * @param wanted the position on the axis; a value which is no finite number is
 *   the first point of the axis
 * @returns one index for a value which lands on a point or outside the axis,
 *   two for one between two points; never a weight of 0, and none at all for an
 *   axis without values
 */
function axisWeights(values: number[], wanted: number): AxisWeight[] {
  const last = values.length - 1
  if (last < 0) {
    return []
  }
  if (last === 0 || !Number.isFinite(wanted)) {
    return [{ index: 0, weight: 1 }]
  }
  for (let index = 0; index < last; index += 1) {
    const left = values[index]
    const right = values[index + 1]
    if (left === undefined || right === undefined) {
      break
    }
    if (wanted >= Math.min(left, right) && wanted <= Math.max(left, right)) {
      const share = right === left ? 0 : (wanted - left) / (right - left)
      if (share === 0) {
        return [{ index, weight: 1 }]
      }
      if (share === 1) {
        return [{ index: index + 1, weight: 1 }]
      }
      return [
        { index, weight: 1 - share },
        { index: index + 1, weight: share },
      ]
    }
  }
  let nearest = 0
  let distance = Number.POSITIVE_INFINITY
  for (let index = 0; index <= last; index += 1) {
    const value = values[index]
    if (value !== undefined && Math.abs(value - wanted) < distance) {
      nearest = index
      distance = Math.abs(value - wanted)
    }
  }
  return [{ index: nearest, weight: 1 }]
}

/**
 * Get the points of a grid which bound a position, with their weights.
 *
 * The rows of a curve are the points of the axes in C order, the last axis
 * fastest, which is the stride of every axis.
 *
 * @param grid the grid of a run
 * @param at the position, the value of a knob by the id of its axis; an axis
 *   the position does not name stays at its first value
 * @returns the corners of the position, at most 2^n of n axes, each with a
 *   weight greater than 0, so a point which does not bound the position is none
 *   of them; none at all for a grid with an axis without values, which has no
 *   point to read
 */
function corners(grid: Grid, at: Record<string, number>): Corner[] {
  let found: Corner[] = [{ row: 0, weight: 1 }]
  let stride = 1
  for (let index = grid.dims.length - 1; index >= 0; index -= 1) {
    const axis = grid.dims[index]
    if (axis === undefined) {
      continue
    }
    const weights = axisWeights(axis.values, at[axis.id] ?? Number.NaN)
    const grown: Corner[] = []
    for (const corner of found) {
      for (const one of weights) {
        grown.push({
          row: corner.row + one.index * stride,
          weight: corner.weight * one.weight,
        })
      }
    }
    found = grown
    stride *= axis.values.length
  }
  return found
}

/**
 * Interpolate the curves of a grid at a position of its knobs.
 *
 * The interpolation is multilinear over however many axes the grid has and
 * clamped to the ends of every one of them, and it reads only the points which
 * bound the position: a point which did not integrate (`null` in the curves,
 * its flat index in `status.failed`) gives `NaN` for the whole column of a
 * curve it bounds and leaves a position it does not bound as it is.
 *
 * @param grid the grid of a run, a `SimulateResponse` among them
 * @param at the position, the value of a knob by the id of its axis; an axis
 *   the position does not name, or names with a value which is no finite
 *   number, stays at its first value
 * @returns one timecourse per curve id of the grid, over the times of `grid.x`;
 *   `NaN` where a point which bounds the position did not integrate and
 *   everywhere for a grid with an axis without values
 */
export function interpolate(grid: Grid, at: Record<string, number>): Record<string, number[]> {
  const failed = new Set(grid.status.failed)
  const bounds = corners(grid, at)
  const columns = grid.x.length
  const curves: Record<string, number[]> = {}
  for (const [id, rows] of Object.entries(grid.curves)) {
    const values: number[] = []
    for (let column = 0; column < columns; column += 1) {
      let total = 0
      let ok = bounds.length > 0
      for (const corner of bounds) {
        const value = rows[corner.row]?.[column]
        if (failed.has(corner.row) || value === undefined || value === null) {
          ok = false
          break
        }
        total += corner.weight * value
      }
      values.push(ok ? total : Number.NaN)
    }
    curves[id] = values
  }
  return curves
}
