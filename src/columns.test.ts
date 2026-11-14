import { describe, expect, it } from 'vitest'

import {
  balancedColumns,
  cardLevel,
  cardLevels,
  COLUMN_GAP,
  COLUMN_MAX,
  LEVELS,
  levelWidth,
  RESET_ROOM,
  rowsOf,
} from './columns'

describe('the columns of the card of the shared controls', () => {
  it('balances the rows of the knobs over the columns which fit', () => {
    // the examples of the ruling: rows as even as the width allows
    expect(balancedColumns(6, 5)).toBe(3)
    expect(balancedColumns(6, 4)).toBe(3)
    expect(balancedColumns(5, 4)).toBe(3)
    expect(balancedColumns(2, 5)).toBe(2)
    expect(balancedColumns(7, 5)).toBe(4)
    expect(balancedColumns(7, 3)).toBe(3)
    expect(balancedColumns(4, 3)).toBe(2)
    expect(balancedColumns(3, 1)).toBe(1)
    // every knob count against every fit: no row longer than the columns, and
    // the rows differ by at most one knob while no fewer rows would do
    for (let knobs = 1; knobs <= 12; knobs += 1) {
      for (let fit = 1; fit <= LEVELS; fit += 1) {
        const columns = balancedColumns(knobs, fit)
        const rows = Math.ceil(knobs / columns)
        expect(columns).toBeLessThanOrEqual(fit)
        expect(rows).toBe(Math.ceil(knobs / Math.min(fit, knobs)))
        expect(columns * rows - knobs).toBeLessThan(rows)
      }
    }
  })

  it('splits the knobs into as few rows as fit, which differ by one knob at most', () => {
    expect(rowsOf(6, 5)).toEqual([3, 3])
    expect(rowsOf(7, 3)).toEqual([3, 2, 2])
    expect(rowsOf(7, 5)).toEqual([4, 3])
    expect(rowsOf(5, 4)).toEqual([3, 2])
    expect(rowsOf(2, 5)).toEqual([2])
    for (let knobs = 1; knobs <= 12; knobs += 1) {
      for (let fit = 1; fit <= LEVELS; fit += 1) {
        const rows = rowsOf(knobs, fit)
        expect(rows.reduce((sum, row) => sum + row, 0)).toBe(knobs)
        expect(rows).toHaveLength(Math.ceil(knobs / Math.min(fit, knobs)))
        expect(Math.max(...rows) - Math.min(...rows)).toBeLessThanOrEqual(1)
        expect(Math.max(...rows)).toBeLessThanOrEqual(fit)
        expect([...rows].sort((a, b) => b - a)).toEqual(rows)
      }
    }
  })

  it('measures a level by its columns of 200px and the gaps between them', () => {
    expect([1, 2, 3, 4, 5].map(levelWidth)).toEqual([200, 416, 632, 848, 1064])
  })

  it('gives the examples a line with the Reset beside them where two columns fit', () => {
    expect(cardLevel(6, 5, true)).toEqual({ columns: 3, reset: false, starts: [3] })
    expect(cardLevel(7, 3, true)).toEqual({ columns: 3, reset: false, starts: [3, 5] })
    expect(cardLevel(1, 5, true)).toEqual({ columns: 1, reset: true, starts: [] })
    expect(cardLevel(2, 1, true)).toEqual({ columns: 1, reset: false, starts: [1] })
  })

  it('lets the Reset of a page without examples follow the last knob', () => {
    // in the free column of a shorter last line
    expect(cardLevel(5, 4, false)).toEqual({ columns: 3, reset: false, starts: [3] })
    // in a column of its own where one more fits, the knobs wrapping at theirs
    expect(cardLevel(2, 5, false)).toEqual({ columns: 2, reset: true, starts: [] })
    expect(cardLevel(8, 7, false)).toEqual({ columns: 4, reset: true, starts: [4] })
    // on a line of its own where the narrowest card of the level has no room
    // for it beside the knobs at 20rem, which it would narrow
    expect(cardLevel(2, 3, false)).toEqual({ columns: 2, reset: false, starts: [] })
    expect(cardLevel(6, 4, false)).toEqual({ columns: 3, reset: false, starts: [3] })
    expect(cardLevel(6, 5, false)).toEqual({ columns: 3, reset: false, starts: [3] })
    // on a line of its own where no column is left
    expect(cardLevel(2, 2, false)).toEqual({ columns: 2, reset: false, starts: [] })
  })

  it('never gives the Reset a column which would narrow a select', () => {
    for (let knobs = 1; knobs <= 8; knobs += 1) {
      for (let fit = 1; fit <= LEVELS; fit += 1) {
        for (const examples of [false, true]) {
          const level = cardLevel(knobs, fit, examples)
          if (level.reset) {
            expect(levelWidth(fit)).toBeGreaterThanOrEqual(
              level.columns * (COLUMN_MAX + COLUMN_GAP) + RESET_ROOM,
            )
          }
        }
      }
    }
  })

  it('lays out a level for every number of columns up to the last', () => {
    // six knobs are one row where six columns fit
    expect(cardLevels(6, true).map((one) => one.columns)).toEqual([1, 2, 3, 3, 3, 6, 6, 6])
    expect(cardLevels(2, false).map((one) => [one.columns, one.reset])).toEqual([
      [1, false],
      [2, false],
      [2, false],
      ...Array.from({ length: 5 }, () => [2, true]),
    ])
  })
})
