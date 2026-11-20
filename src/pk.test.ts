import { describe, expect, it } from 'vitest'

import { pkOf, summary } from './pk'
import type { PkParameters } from './pk'

/** The times of a dense day in hours, every six minutes. */
const HOURS = Array.from({ length: 241 }, (_, index) => index * 0.1)

/**
 * A one-compartment curve with a first order absorption, the textbook case.
 *
 * c(t) = A * (exp(-ke t) - exp(-ka t)), whose parameters the parameters of a
 * non-compartmental analysis are known for: the terminal slope is `ke`, so the
 * half-life is ln2/ke, and the area under the curve from zero to infinity is
 * A * (1/ke - 1/ka).
 */
function bateman(ka: number, ke: number, a: number): (number | null)[] {
  return HOURS.map((t) => a * (Math.exp(-ke * t) - Math.exp(-ka * t)))
}

/** The parameters of a curve, which the analysis has to describe. */
function described(y: (number | null)[]): PkParameters {
  const pk = pkOf(HOURS, y)
  if (pk === null) {
    throw new Error('the analysis describes no curve')
  }
  return pk
}

describe('pkOf', () => {
  it('reads the peak of a curve and the time it is reached at', () => {
    const pk = described(bateman(1.0, 0.1, 10.0))
    // the peak of a bateman curve is at ln(ka/ke)/(ka - ke)
    const tmax = Math.log(1.0 / 0.1) / (1.0 - 0.1)
    expect(pk.tmax).toBeCloseTo(tmax, 1)
    expect(pk.cmax).toBeCloseTo(10.0 * (Math.exp(-0.1 * tmax) - Math.exp(-tmax)), 2)
  })

  it('integrates the area under the curve of the window', () => {
    const pk = described(bateman(1.0, 0.1, 10.0))
    // the trapezoid of a dense curve is the integral of the window,
    // A * ((1 - exp(-ke T))/ke - (1 - exp(-ka T))/ka) over 24 hr
    const expected = 10.0 * ((1 - Math.exp(-2.4)) / 0.1 - (1 - Math.exp(-24.0)) / 1.0)
    expect(pk.auc).toBeCloseTo(expected, 1)
  })

  it('reads the half-life of the terminal slope and extrapolates the area', () => {
    const pk = described(bateman(1.0, 0.1, 10.0))
    expect(pk.thalf).toBeCloseTo(Math.LN2 / 0.1, 1)
    // the area to infinity is A * (1/ke - 1/ka), the whole exposure
    expect(pk.aucInf).toBeCloseTo(10.0 * (1 / 0.1 - 1 / 1.0), 0)
    expect(pk.aucInf).toBeGreaterThan(pk.auc)
  })

  it('has no half-life for a curve which does not decay', () => {
    const pk = described(HOURS.map((t) => t))
    expect(pk.cmax).toBeCloseTo(24.0, 6)
    expect(pk.thalf).toBeNull()
    expect(pk.aucInf).toBeNull()
  })

  it('leaves out the points a draw did not integrate', () => {
    const y = bateman(1.0, 0.1, 10.0)
    const holes = y.map((value, index) => (index % 50 === 7 ? null : value))
    expect(described(holes).cmax).toBeCloseTo(described(y).cmax, 2)
  })

  it('is null for a curve of no points and for one of only nulls', () => {
    expect(pkOf([], [])).toBeNull()
    expect(
      pkOf(
        HOURS,
        HOURS.map(() => null),
      ),
    ).toBeNull()
  })

  it('is null for a curve which stays at zero', () => {
    expect(
      pkOf(
        HOURS,
        HOURS.map(() => 0.0),
      ),
    ).toBeNull()
  })
})

describe('summary', () => {
  it('gives the median and the percentiles of the level', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const band = summary(values, 0.8)
    expect(band).toEqual({
      median: expect.closeTo(5.5, 6) as number,
      // the 10th and the 90th percentile of the ten values
      low: expect.closeTo(1.9, 6) as number,
      high: expect.closeTo(9.1, 6) as number,
    })
  })

  it('is the value itself for one draw and null for none', () => {
    expect(summary([42.0], 0.9)).toEqual({ median: 42.0, low: 42.0, high: 42.0 })
    expect(summary([], 0.9)).toBeNull()
  })

  it('leaves out what a draw has no number for', () => {
    expect(summary([1, null, 3], 0.9)?.median).toBeCloseTo(2.0, 6)
  })
})
