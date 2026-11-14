/**
 * The knobs of a panel as a reader moves them, shared by the panel and the shell.
 *
 * A knob is drawn by `KnobControl.ce.vue` wherever it is drawn: inside the
 * panel which declares it, and above the grid of an app for a knob which more
 * than one panel of the page declares (`SbmlsimApp.ce.vue`). Its label, its
 * step, the text of its value and the keys it keeps are therefore stated once,
 * here, so a reader cannot tell from a control which element drew it.
 */

import type { PanelAxis, PanelChoice, PanelDeclaration } from './contract'

/** The significant digits the value of a knob is shown with. */
export const KNOB_DIGITS = 4
/** The steps a range knob moves in, which is finer than the grid it reads. */
const RANGE_STEPS = 100
/** How far from a whole number of steps a value may lie and still be on a ladder. */
const ON_LADDER = 1e-6

/** The keys a range input and a select act on themselves. */
const CONTROL_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])

/**
 * Write a number of a label without the digits nobody reads.
 *
 * @param value the number
 * @param digits the significant digits it keeps
 * @returns it as short text, empty for a value which is no finite number
 */
export function shortNumber(value: number, digits: number): string {
  return Number.isFinite(value) ? String(Number(value.toPrecision(digits))) : ''
}

/**
 * Get whether a value of a payload carries the fields a field names.
 *
 * @param value the value
 * @param strings the fields which have to be text
 * @returns whether it is an object carrying every one of them
 */
export function carries(value: unknown, strings: string[]): boolean {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const fields = value as Record<string, unknown>
  return strings.every((name) => typeof fields[name] === 'string')
}

/**
 * Get the knobs of a declaration which can be drawn as a control.
 *
 * The guard of the client refuses a declaration whose knobs are not objects
 * with an id, so this is the second lock of that door: a control which cannot
 * be built is not drawn, and a hole in the guard therefore costs a knob and
 * never the element, which has an error line to show.
 *
 * @param declared the declaration, `null` until it was read
 * @returns the knobs which can be drawn, in the order of the declaration
 */
export function knobsOf(declared: PanelDeclaration | null): PanelAxis[] {
  const given: unknown[] = declared?.axes ?? []
  return given.filter(drawableKnob)
}

/**
 * Get whether a knob can be drawn as a control.
 *
 * It is the one rule of a knob of a panel (`knobsOf`) and of a knob the panels
 * of a page share, so a knob whose control cannot be built is left out in
 * either, and the rest of its panel or of its page is drawn.
 *
 * @param one the knob, as a payload carries it
 * @returns whether it carries an id, a label, a kind, choices which can each be
 *   drawn as an option, and a default
 */
export function drawableKnob(one: unknown): one is PanelAxis {
  return (
    carries(one, ['id', 'label', 'kind']) &&
    Array.isArray((one as PanelAxis).choices) &&
    (one as PanelAxis).choices.every(isChoice) &&
    typeof (one as PanelAxis).default === 'number'
  )
}

/**
 * Get whether an item of the choices of a knob can be drawn as an option.
 *
 * @param value the item, a choice of a choice knob or a named stop of a range knob
 * @returns whether it carries a label and a finite value
 */
function isChoice(value: unknown): boolean {
  return (
    carries(value, ['label']) &&
    typeof (value as PanelChoice).value === 'number' &&
    Number.isFinite((value as PanelChoice).value)
  )
}

/** The units which are no unit to a reader: a dimensionless number is written without one. */
const NO_UNITS: ReadonlySet<string> = new Set(['', 'dimensionless', '1'])

/**
 * Get the label of a knob.
 *
 * @param axis the knob
 * @returns `<label> [<unit>]` for a range knob, whose readout is a bare
 *   number, as sbmlsim labels the axis of a figure; the label alone for a
 *   choice knob, whose choices carry their units themselves, and for a knob
 *   of no unit or of a dimensionless one, which a reader reads as no unit
 */
export function knobLabel(axis: PanelAxis): string {
  return axis.kind === 'range' && axis.unit !== null && !NO_UNITS.has(axis.unit.trim())
    ? `${axis.label} [${axis.unit}]`
    : axis.label
}

/**
 * Get a step of the ladder 1, 2, 5 near a wanted one.
 *
 * @param wanted the step which is wanted, a positive number
 * @returns the step of the ladder closest above it
 */
function niceStep(wanted: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(wanted))
  const share = wanted / magnitude
  return (share <= 1.5 ? 1 : share <= 3 ? 2 : share <= 7 ? 5 : 10) * magnitude
}

/** The finer steps of the ladder 1, 2, 5 a range knob tries for its stops, as shares of the nice step. */
const FINER = [1, 2, 5, 10, 20, 50, 100]

/**
 * Get whether values lie on the ladder a step builds from a start.
 *
 * @param start the smallest value of the knob, where the ladder starts
 * @param step the step of the ladder
 * @param values the values which have to lie on it
 * @returns whether each is a whole number of steps from the start
 */
function onLadder(start: number, step: number, values: number[]): boolean {
  return values.every((value) => {
    const steps = (value - start) / step
    return Math.abs(steps - Math.round(steps)) <= ON_LADDER
  })
}

/**
 * Get the step a range knob moves in.
 *
 * It is finer than the grid the knob is read from on purpose: the grid is
 * where the simulations are, the knob is where the reader is, and the
 * interpolation between them is what makes a movement cost nothing.
 *
 * The value a knob starts at has to lie on the ladder the step builds, or the
 * browser snaps the control to the nearest value which does and the reader is
 * shown, and told by a screen reader, a number the panel is not simulating. A
 * nice step near a hundredth of the span usually lands on it; where it does
 * not, the distance from the smallest value to the declared one is divided
 * into a whole number of steps of about that size instead. The named stops of
 * a knob have to lie on the ladder as well, or a slider moved onto a stop
 * would pass it and never show it in the select of the stops: a finer step of
 * the ladder 1, 2, 5 which reaches the default and every stop is taken where
 * the nice one does not, down to a hundredth of it.
 *
 * @param axis the knob, of the kind `range`
 * @returns the step, 1 for a knob whose bounds are no span
 */
export function rangeStep(axis: PanelAxis): number {
  const low = axis.min ?? 0
  const high = axis.max ?? 0
  const span = high - low
  if (!(span > 0)) {
    return 1
  }
  const nice = niceStep(span / RANGE_STEPS)
  const stops = stopsOf(axis).map((one) => one.value)
  if (stops.length > 0) {
    const reached = FINER.map((share) => nice / share).find((step) =>
      onLadder(low, step, [axis.default, ...stops]),
    )
    if (reached !== undefined) {
      return reached
    }
  }
  const offset = axis.default - low
  if (!(offset > 0)) {
    return nice
  }
  const steps = offset / nice
  if (Math.abs(steps - Math.round(steps)) <= ON_LADDER) {
    return nice
  }
  return offset / Math.max(1, Math.round(steps))
}

/**
 * Get the named stops of a range knob.
 *
 * @param axis the knob
 * @returns the choices of a range knob which lie within its bounds, in the
 *   order it declares them; none for a choice knob, whose choices are its
 *   values and no stops on a slider
 */
export function stopsOf(axis: PanelAxis): PanelChoice[] {
  if (axis.kind !== 'range') {
    return []
  }
  const low = axis.min ?? Number.NEGATIVE_INFINITY
  const high = axis.max ?? Number.POSITIVE_INFINITY
  return axis.choices.filter((one) => one.value >= low && one.value <= high)
}

/**
 * Get whether two values of a knob are one value.
 *
 * A value is a number of a payload or of a control, so it is compared with a
 * tolerance of the last bits a value of a slider is computed with.
 *
 * @param one a value
 * @param other another value
 * @returns whether they are equal to a part in a billion of their magnitude
 */
export function sameValue(one: number, other: number): boolean {
  return Math.abs(one - other) <= ON_LADDER * Math.max(1, Math.abs(one), Math.abs(other))
}

/**
 * Get the choice of a list a value is at.
 *
 * @param choices the choices, the named stops of a range knob or the choices of a choice knob
 * @param value the value
 * @returns the first choice whose value it is, `null` for a value which is none of them
 */
export function choiceAt(choices: PanelChoice[], value: number): PanelChoice | null {
  return choices.find((one) => sameValue(one.value, value)) ?? null
}

/**
 * Get the value a knob takes for a value which is one of its numbers to the
 * last bits.
 *
 * A value which is a bound or a choice of its knob within the tolerance of
 * `sameValue` - a value a host computed, `0.30000000000000004` for a choice of
 * 0.3 - is taken for that number and sent as it, since the endpoint compares a
 * value with the numbers of the declaration exactly and refuses one it does not
 * take. Every other value is the value as it is.
 *
 * @param axis the knob
 * @param value the value
 * @returns the bound or the choice it is, else the value
 */
export function snapValue(axis: PanelAxis, value: number): number {
  if (axis.kind === 'choice') {
    return choiceAt(axis.choices, value)?.value ?? value
  }
  for (const bound of [axis.min, axis.max]) {
    if (bound !== null && sameValue(bound, value)) {
      return bound
    }
  }
  return choiceAt(stopsOf(axis), value)?.value ?? value
}

/**
 * Get whether a value is a value a knob takes.
 *
 * @param axis the knob
 * @param value the value
 * @returns whether it is a finite number within the bounds of a range knob, or
 *   one of the choices of a choice knob
 */
export function validValue(axis: PanelAxis, value: number): boolean {
  if (!Number.isFinite(value)) {
    return false
  }
  if (axis.kind === 'choice') {
    return choiceAt(axis.choices, value) !== null
  }
  const low = axis.min ?? Number.NEGATIVE_INFINITY
  const high = axis.max ?? Number.POSITIVE_INFINITY
  return value >= low - ON_LADDER * Math.abs(low) && value <= high + ON_LADDER * Math.abs(high)
}

/**
 * Read the value a control carries.
 *
 * @param event the `input` or `change` event of the control
 * @returns the value, `null` for a target which is no control or a value which
 *   is no number
 */
export function controlValue(event: Event): number | null {
  const target = event.target
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) {
    return null
  }
  const value = Number(target.value)
  return Number.isFinite(value) ? value : null
}

/**
 * Keep the keys a knob acts on to the knob.
 *
 * A key event leaves the shadow root retargeted at the element, so a host which
 * decides on the target - reveal.js skips a key whose active element is an
 * `input` - sees the element and not the knob, and a deck would turn the slide
 * under a reader who moves a knob with the arrow keys. The event stops here
 * instead, at the knob, and only for the keys the knob uses: every other key
 * reaches the host as it does without the element.
 *
 * @param event the `keydown` event of the controls
 */
export function keepControlKeys(event: KeyboardEvent): void {
  const target = event.target
  const isControl =
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement && target.type === 'range')
  if (isControl && CONTROL_KEYS.has(event.key)) {
    event.stopPropagation()
  }
}

/** What the attribute `values` of a panel says. */
export type HostValues =
  /** The attribute is absent, or empty, which is what an absent one is read as. */
  | { kind: 'absent' }
  /** The attribute cannot be read; the panel is as if it were absent. */
  | { kind: 'malformed'; reason: string }
  /** The values the host sets, by the id of the knob. */
  | { kind: 'given'; values: Record<string, number> }

/**
 * Read the attribute `values` of a panel: the knobs the host of the panel owns.
 *
 * It is a JSON object of knob id to number. Text which is no JSON, JSON which
 * is no object, and an object one of whose values is no finite number are read
 * as nothing at all, so a host which writes it wrong gets the panel it gets
 * without it and not a panel of some of its knobs. Which ids are knobs of the
 * panel is not decided here: the panel ignores an id it does not declare.
 *
 * @param text the text of the attribute, `undefined` for an absent one
 * @returns what it says
 */
export function hostValues(text: string | undefined): HostValues {
  if (text === undefined || text === '') {
    return { kind: 'absent' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { kind: 'malformed', reason: 'is no JSON' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'malformed', reason: 'is no JSON object' }
  }
  const entries: [string, number][] = []
  for (const [id, value] of Object.entries(parsed)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { kind: 'malformed', reason: `gives the knob '${id}' no finite number` }
    }
    entries.push([id, value])
  }
  // `fromEntries` defines every id as a property of its own, `__proto__` among
  // them, which an assignment would take for the prototype
  return { kind: 'given', values: Object.fromEntries(entries) }
}

/**
 * Get the value a record of knob values holds for a knob of its own.
 *
 * A knob id is text of a declaration, so it may be the name of a property every
 * object inherits, `constructor` or `toString`, which a plain lookup answers
 * with a function.
 *
 * @param values the values by the id of the knob
 * @param id the id of the knob
 * @returns its value, `undefined` for a knob the record does not hold
 */
export function ownValue(values: Record<string, number>, id: string): number | undefined {
  return Object.hasOwn(values, id) ? values[id] : undefined
}
