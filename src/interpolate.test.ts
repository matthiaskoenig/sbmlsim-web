import { describe, expect, it } from 'vitest'

import type { Grid, GridAxis, SimulateResponse } from './contract'
import { interpolate } from './interpolate'

/** Build an axis of a grid from its id and its values, the rest being filler. */
function axis(id: string, values: number[]): GridAxis {
  return { id, label: id, unit: null, values }
}

/** Build a grid of the given axes and curves, with every point integrated. */
function grid(
  dims: GridAxis[],
  curves: Record<string, (number | null)[][]>,
  failed: number[] = [],
): Grid {
  const points = dims.reduce((total, one) => total * one.values.length, 1)
  const rows = Object.values(curves)[0] ?? []
  const columns = rows[0]?.length ?? 0
  return {
    dims,
    x: Array.from({ length: columns }, (_, index) => index),
    curves,
    status: { ok: failed.length === 0, points, failed },
  }
}

describe('interpolate', () => {
  it('returns the row of a grid point exactly', () => {
    const g = grid([axis('egfr', [0, 1, 2])], {
      c: [
        [10, 11],
        [20, 21],
        [30, 31],
      ],
    })
    expect(interpolate(g, { egfr: 1 }).c).toEqual([20, 21])
  })

  it('interpolates linearly between two rows', () => {
    const g = grid([axis('egfr', [0, 1])], {
      c: [
        [0, 0],
        [2, 4],
      ],
    })
    expect(interpolate(g, { egfr: 0.5 }).c).toEqual([1, 2])
  })

  it('interpolates on an axis of uneven steps', () => {
    const g = grid([axis('egfr', [0, 1, 10])], { c: [[0], [10], [100]] })
    expect(interpolate(g, { egfr: 5.5 }).c).toEqual([55])
  })

  it('clamps a value outside the axis to its end', () => {
    const g = grid([axis('egfr', [0, 1])], {
      c: [
        [0, 0],
        [2, 4],
      ],
    })
    expect(interpolate(g, { egfr: -7 }).c).toEqual([0, 0])
    expect(interpolate(g, { egfr: 7 }).c).toEqual([2, 4])
  })

  it('interpolates over two axes multilinearly', () => {
    // the rows are the points of (dose, egfr) in C order, the last axis fastest
    const g = grid([axis('dose', [0, 1]), axis('egfr', [0, 1])], {
      c: [[0], [1], [2], [3]],
    })
    expect(interpolate(g, { dose: 0.5, egfr: 0.5 }).c).toEqual([1.5])
    expect(interpolate(g, { dose: 0, egfr: 0.5 }).c).toEqual([0.5])
    expect(interpolate(g, { dose: 1, egfr: 1 }).c).toEqual([3])
  })

  it('gives every curve of the grid', () => {
    const g = grid([axis('egfr', [0, 1])], { a: [[0], [2]], b: [[4], [8]] })
    expect(interpolate(g, { egfr: 0.5 })).toEqual({ a: [1], b: [6] })
  })

  it('returns the single row of a grid without axes', () => {
    const g = grid([], { c: [[1, 2, 3]] })
    expect(interpolate(g, {}).c).toEqual([1, 2, 3])
  })

  it('holds an axis which the position does not name at its first value', () => {
    const g = grid([axis('egfr', [0, 1])], {
      c: [
        [0, 0],
        [2, 4],
      ],
    })
    expect(interpolate(g, {}).c).toEqual([0, 0])
  })

  it('keeps NaN out of a neighbouring row', () => {
    // the point in the middle did not integrate: the positions it bounds are
    // NaN, the ones it does not keep their values
    const g = grid(
      [axis('egfr', [0, 1, 2])],
      {
        c: [
          [0, 0],
          [null, null],
          [4, 8],
        ],
      },
      [1],
    )
    expect(interpolate(g, { egfr: 0.5 }).c).toEqual([NaN, NaN])
    expect(interpolate(g, { egfr: 1 }).c).toEqual([NaN, NaN])
    expect(interpolate(g, { egfr: 1.5 }).c).toEqual([NaN, NaN])
    expect(interpolate(g, { egfr: 0 }).c).toEqual([0, 0])
    expect(interpolate(g, { egfr: 2 }).c).toEqual([4, 8])
  })

  it('keeps a failed point out of one curve only where it bounds', () => {
    const g = grid([axis('dose', [0, 1]), axis('egfr', [0, 1])], {
      a: [[0], [1], [2], [null]],
      b: [[0], [1], [2], [3]],
    })
    expect(interpolate(g, { dose: 0, egfr: 0.5 })).toEqual({ a: [0.5], b: [0.5] })
    expect(interpolate(g, { dose: 1, egfr: 0.5 })).toEqual({ a: [NaN], b: [2.5] })
  })

  it('reads the answer of a simulation as it comes off the wire', () => {
    const answer: SimulateResponse = {
      contract: 'panel/1',
      spec_hash: '0'.repeat(64),
      x: [0, 1],
      dims: [axis('egfr', [0, 1])],
      curves: {
        c: [
          [0, 0],
          [2, 4],
        ],
      },
      units: { x: 'hr', c: 'uM' },
      provenance: {
        model: 'm',
        panel: 'p',
        model_sha256: '0'.repeat(64),
        variant: null,
        engine: 'roadrunner',
        sbmlsim: '0.0.0',
        seconds: 0.1,
        created: '2026-11-12T22:41:35.090689+00:00',
      },
      status: { ok: true, points: 2, failed: [] },
    }
    expect(interpolate(answer, { egfr: 0.25 }).c).toEqual([0.5, 1])
  })

  it('interpolates over three axes multilinearly', () => {
    // the rows are the points of (a, b, c) in C order, the row of (i, j, k)
    // being 4 * i + 2 * j + k
    const g = grid([axis('a', [0, 1]), axis('b', [0, 1]), axis('c', [0, 1])], {
      v: [[0], [1], [2], [3], [4], [5], [6], [7]],
    })
    // the centre of the cube is the mean of its eight corners, 28 / 8
    expect(interpolate(g, { a: 0.5, b: 0.5, c: 0.5 }).v).toEqual([3.5])
    // on two of the axes exactly: 0.75 * row(1, 0, 0) + 0.25 * row(1, 0, 1)
    expect(interpolate(g, { a: 1, b: 0, c: 0.25 }).v).toEqual([4.25])
  })

  it('reads an axis whose values descend', () => {
    // a choice knob keeps the order its declaration lists its choices in, so an
    // axis of the doses 50, 25 and 12.5 arrives in that order
    const g = grid([axis('dose', [50, 25, 12.5])], { c: [[100], [200], [300]] })
    expect(interpolate(g, { dose: 50 }).c).toEqual([100])
    expect(interpolate(g, { dose: 25 }).c).toEqual([200])
    expect(interpolate(g, { dose: 12.5 }).c).toEqual([300])
    // half way between the values 50 and 25 is half way between their rows
    expect(interpolate(g, { dose: 37.5 }).c).toEqual([150])
    // outside the axis: the nearer of its ends, which is its first row here
    expect(interpolate(g, { dose: 100 }).c).toEqual([100])
    expect(interpolate(g, { dose: 0 }).c).toEqual([300])
  })

  it('reads an axis whose values are in no order', () => {
    const g = grid([axis('k', [0, 2, 1])], { c: [[0], [20], [10]] })
    // the first interval which brackets the value is the one which is read:
    // 1.5 lies in [0, 2] at three quarters, 0.25 * 0 + 0.75 * 20
    expect(interpolate(g, { k: 1.5 }).c).toEqual([15])
    // a value no interval brackets reads the nearest point, the value 2 here
    expect(interpolate(g, { k: 3 }).c).toEqual([20])
  })

  it('gives NaN for a grid whose axis has no values', () => {
    const g = grid([axis('k', [])], { c: [[1, 2]] })
    expect(interpolate(g, { k: 0 }).c).toEqual([NaN, NaN])
  })
})
