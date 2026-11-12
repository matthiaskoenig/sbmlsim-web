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
})
