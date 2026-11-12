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
 * The value is clamped to the ends of the axis, so a position outside it reads
 * the row of its end, and a value which lands on a point of the axis reads that
 * row alone. An axis whose values are not sorted brackets nothing and reads its
 * nearest point.
 *
 * @param values the values of the axis, in their order
 * @param wanted the position on the axis; a value which is no finite number is
 *   the first point of the axis
 * @returns one index for a value which lands on a point or outside the axis,
 *   two for one between two points; never a weight of 0
 */
function axisWeights(values: number[], wanted: number): AxisWeight[] {
  const last = values.length - 1
  const low = values[0]
  const high = values[last]
  if (low === undefined || high === undefined) {
    return []
  }
  if (last === 0 || !Number.isFinite(wanted) || wanted <= low) {
    return [{ index: 0, weight: 1 }]
  }
  if (wanted >= high) {
    return [{ index: last, weight: 1 }]
  }
  for (let index = 0; index < last; index += 1) {
    const left = values[index]
    const right = values[index + 1]
    if (left === undefined || right === undefined) {
      break
    }
    if (wanted >= left && wanted <= right) {
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
  // an axis whose values are not sorted brackets nothing: read its nearest point
  let nearest = 0
  let distance = Math.abs(low - wanted)
  for (let index = 1; index <= last; index += 1) {
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
 *   of them
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
 * The interpolation is multilinear over the axes of the grid and clamped to
 * their ends, and it reads only the points which bound the position: a point
 * which did not integrate (`null` in the curves, its flat index in
 * `status.failed`) gives `NaN` for the whole column of a curve it bounds and
 * leaves a position it does not bound as it is.
 *
 * @param grid the grid of a run, a `SimulateResponse` among them
 * @param at the position, the value of a knob by the id of its axis; an axis
 *   the position does not name, or names with a value which is no finite
 *   number, stays at its first value
 * @returns one timecourse per curve id of the grid, over the times of `grid.x`
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
      let ok = true
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
