/**
 * The pharmacokinetic parameters of a curve a panel just ran.
 *
 * A reader of a panel asks what the curve means in numbers: how high the
 * exposure went, when, how much of it there was and how long it takes to halve.
 * This is the non-compartmental analysis of the curve as it was simulated - no
 * model, no fit - over the window the panel ran, so it answers for the
 * individual the knobs describe and moves with them. The module is pure - no
 * network, no vue, no dom - so it is the same function in a page, in a test and
 * in a worker.
 *
 * The analysis is the usual one: the peak and its time are read off the points,
 * the area is the linear trapezoid over them, and the terminal phase is the
 * log-linear fit of the tail which gives the half-life and the extrapolation of
 * the area to infinity. A curve whose tail does not fall - a cumulative amount,
 * a curve still rising at the end of the window - has no terminal phase, and
 * the half-life and the extrapolated area are `null` rather than a number read
 * off a fit which does not describe it.
 */

/** The parameters of one curve; `null` where the curve does not carry one. */
export interface PkParameters {
  /** The highest value of the curve, in the unit of the curve. */
  cmax: number
  /** The time of the peak, in the time unit of the panel. */
  tmax: number
  /** The area under the curve over the window, by the linear trapezoid. */
  auc: number
  /**
   * The area extrapolated to infinity, `auc + last / lambdaZ`; `null` without a
   * terminal phase.
   */
  aucInf: number | null
  /** The slope of the terminal phase, `1/time`; `null` without one. */
  lambdaZ: number | null
  /** The half-life of the terminal phase, `ln 2 / lambdaZ`; `null` without one. */
  thalf: number | null
  /** The points of the tail the terminal phase was fitted over, 0 without one. */
  terminalPoints: number
}

/** The median of a sample and the two percentiles of a level. */
export interface PkSummary {
  /** The median of the values. */
  median: number
  /** The low percentile, e.g. the 5th of a level of 0.9. */
  low: number
  /** The high percentile, e.g. the 95th of a level of 0.9. */
  high: number
}

/** The fewest points of a tail a terminal phase is fitted over. */
const TERMINAL_POINTS = 3

/** One point of a curve which was integrated: a time and a value. */
interface Point {
  /** The time of the point. */
  t: number
  /** The value of the curve there. */
  y: number
}

/**
 * Get the points of a curve which carry a number, in the order of the times.
 *
 * A draw which did not integrate a point leaves `null` there, and a panel
 * delivers the times of the whole run beside it, so the pairs are formed here
 * and the holes are left out.
 */
function points(x: number[], y: (number | null)[]): Point[] {
  const found: Point[] = []
  y.forEach((value, index) => {
    const t = x[index]
    if (value !== null && Number.isFinite(value) && t !== undefined && Number.isFinite(t)) {
      found.push({ t, y: value })
    }
  })
  return found
}

/**
 * Get the slope of the log-linear fit of the tail of a curve.
 *
 * The tail is read from the last point backwards, every window of at least
 * `TERMINAL_POINTS` positive values after the peak, and the window with the
 * best fit (the highest adjusted coefficient of determination) is the terminal
 * phase, which is the rule of a non-compartmental analysis. A window whose
 * slope does not fall is no terminal phase.
 *
 * Args:
 *   tail: the points after the peak, in the order of the times.
 *
 * Returns:
 *   The slope `lambdaZ` (positive, `1/time`) and the points it was fitted
 *   over, or `null` for a tail which carries no terminal phase.
 */
function terminal(tail: Point[]): { lambdaZ: number; used: number } | null {
  const usable = tail.filter((point) => point.y > 0)
  let best: { lambdaZ: number; used: number; quality: number } | null = null
  for (let count = TERMINAL_POINTS; count <= usable.length; count += 1) {
    const window = usable.slice(usable.length - count)
    const xs = window.map((point) => point.t)
    const ys = window.map((point) => Math.log(point.y))
    const n = window.length
    const meanX = xs.reduce((sum, value) => sum + value, 0) / n
    const meanY = ys.reduce((sum, value) => sum + value, 0) / n
    let sxy = 0
    let sxx = 0
    let syy = 0
    for (let index = 0; index < n; index += 1) {
      const dx = (xs[index] ?? 0) - meanX
      const dy = (ys[index] ?? 0) - meanY
      sxy += dx * dy
      sxx += dx * dx
      syy += dy * dy
    }
    if (sxx <= 0 || syy <= 0) continue
    const slope = sxy / sxx
    if (slope >= 0) continue
    const r2 = (sxy * sxy) / (sxx * syy)
    // the adjusted coefficient, which is what keeps a window of three points
    // from winning against a longer one which describes the tail as well
    const quality = 1 - ((1 - r2) * (n - 1)) / (n - 2)
    if (best === null || quality > best.quality) {
      best = { lambdaZ: -slope, used: n, quality }
    }
  }
  return best === null ? null : { lambdaZ: best.lambdaZ, used: best.used }
}

/**
 * Get the pharmacokinetic parameters of one curve.
 *
 * Args:
 *   x: the output times of the panel, in its time unit.
 *   y: the values of the curve, `null` where it was not integrated.
 *
 * Returns:
 *   The parameters, or `null` for a curve of fewer than two points or one
 *   which stays at zero, which no analysis describes.
 */
export function pkOf(x: number[], y: (number | null)[]): PkParameters | null {
  const found = points(x, y)
  const first = found[0]
  const last = found[found.length - 1]
  if (found.length < 2 || first === undefined || last === undefined) return null
  let peak = first
  for (const point of found) {
    if (point.y > peak.y) peak = point
  }
  if (!(peak.y > 0)) return null
  let auc = 0
  for (let index = 1; index < found.length; index += 1) {
    const left = found[index - 1]
    const right = found[index]
    if (left === undefined || right === undefined) continue
    auc += ((right.t - left.t) * (left.y + right.y)) / 2
  }
  const after = found.filter((point) => point.t > peak.t)
  const phase = after.length >= TERMINAL_POINTS ? terminal(after) : null
  return {
    cmax: peak.y,
    tmax: peak.t,
    auc,
    aucInf: phase === null ? null : auc + last.y / phase.lambdaZ,
    lambdaZ: phase === null ? null : phase.lambdaZ,
    thalf: phase === null ? null : Math.LN2 / phase.lambdaZ,
    terminalPoints: phase === null ? 0 : phase.used,
  }
}

/**
 * Get the median and the percentiles of a level over the draws of a parameter.
 *
 * The percentiles are linear between the order statistics, the definition the
 * band of a curve uses, so the table and the band of a panel state the same
 * share of the same draws. A draw which carries no number for the parameter -
 * one whose curve has no terminal phase, say - is left out.
 *
 * Args:
 *   values: the value of the parameter of every draw, `null` for none.
 *   level: the share the band covers, e.g. `0.9` for the 5th to the 95th.
 *
 * Returns:
 *   The summary, or `null` if no draw carries a number.
 */
export function summary(values: (number | null)[], level: number): PkSummary | null {
  const sorted = values
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .sort((left, right) => left - right)
  if (sorted.length === 0) return null
  const tail = (1 - level) / 2
  return {
    median: percentile(sorted, 0.5),
    low: percentile(sorted, tail),
    high: percentile(sorted, 1 - tail),
  }
}

/** Get a percentile of sorted values, linear between the order statistics. */
function percentile(sorted: number[], share: number): number {
  const first = sorted[0] ?? Number.NaN
  if (sorted.length === 1) return first
  const position = share * (sorted.length - 1)
  const low = Math.floor(position)
  const high = Math.ceil(position)
  const below = sorted[low] ?? first
  const above = sorted[high] ?? below
  if (low === high) return below
  return below + (position - low) * (above - below)
}
