import { describe, expect, it } from 'vitest'

import { balancedColumns, cardLevel, cardLevels, LEVELS, levelWidth, rowsOf } from './columns'

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

  it('starts a line at every row of the knobs', () => {
    expect(cardLevel(6, 5)).toEqual({ columns: 3, starts: [3] })
    expect(cardLevel(7, 3)).toEqual({ columns: 3, starts: [3, 5] })
    expect(cardLevel(1, 5)).toEqual({ columns: 1, starts: [] })
    expect(cardLevel(2, 1)).toEqual({ columns: 1, starts: [1] })
    expect(cardLevel(5, 4)).toEqual({ columns: 3, starts: [3] })
  })

  it('lays out a level for every number of columns up to the last', () => {
    // six knobs are one row where six columns fit
    expect(cardLevels(6).map((one) => one.columns)).toEqual([1, 2, 3, 3, 3, 6, 6, 6])
    expect(cardLevels(2).map((one) => one.columns)).toEqual([1, 2, 2, 2, 2, 2, 2, 2])
  })
})
