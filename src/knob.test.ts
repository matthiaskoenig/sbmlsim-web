import { describe, expect, it } from 'vitest'

import type { PanelAxis } from './contract'
import { choiceAt, rangeStep, stopsOf, validValue } from './knob'

/** A range knob of a clearance, with the stops of a renal impairment. */
function clearance(more: Partial<PanelAxis> = {}): PanelAxis {
  return {
    id: 'crcl',
    label: 'creatinine clearance',
    target: null,
    unit: 'ml/min',
    kind: 'range',
    min: 10,
    max: 150,
    steps: 8,
    choices: [
      { label: 'normal', value: 110 },
      { label: 'mild impairment', value: 75 },
      { label: 'severe impairment', value: 20 },
    ],
    default: 110,
    ...more,
  }
}

/** Get whether a value lies on the ladder of a step from a start. */
function onLadder(start: number, step: number, value: number): boolean {
  const steps = (value - start) / step
  return Math.abs(steps - Math.round(steps)) < 1e-6
}

describe('the stops of a range knob', () => {
  it('are the choices of a range knob within its bounds, and none of a choice knob', () => {
    expect(stopsOf(clearance()).map((one) => one.value)).toEqual([110, 75, 20])
    expect(stopsOf(clearance({ choices: [{ label: 'beyond', value: 200 }] }))).toEqual([])
    expect(stopsOf(clearance({ kind: 'choice' }))).toEqual([])
  })

  it('lie on the ladder of the slider, so a slider moved onto a stop lands on it', () => {
    // 0.2..1 moves in steps of 0.01, which 0.333 does not lie on: a finer step
    // of the ladder 1, 2, 5 reaches it
    const axis = clearance({
      min: 0.2,
      max: 1,
      default: 1,
      choices: [
        { label: 'a', value: 0.333 },
        { label: 'b', value: 0.6 },
      ],
    })
    const step = rangeStep(axis)
    for (const value of [1, 0.333, 0.6]) {
      expect(onLadder(0.2, step, value)).toBe(true)
    }
    expect(step).toBeCloseTo(0.001, 12)
    // the stops of the demo lie on the step of a knob without them
    expect(rangeStep(clearance())).toBe(rangeStep(clearance({ choices: [] })))
  })

  it('finds the stop a value is at to the last bits of a slider', () => {
    const stops = clearance().choices
    expect(choiceAt(stops, 75)?.label).toBe('mild impairment')
    expect(choiceAt(stops, 75 + 1e-12)?.label).toBe('mild impairment')
    expect(choiceAt(stops, 76)).toBeNull()
  })

  it('takes a value within the bounds of a range knob and a choice of a choice knob', () => {
    expect(validValue(clearance(), 52)).toBe(true)
    expect(validValue(clearance(), 9)).toBe(false)
    expect(validValue(clearance(), Number.NaN)).toBe(false)
    const choice = clearance({ kind: 'choice', min: null, max: null })
    expect(validValue(choice, 75)).toBe(true)
    expect(validValue(choice, 52)).toBe(false)
  })
})
