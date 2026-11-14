import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { seriesColour } from './plot'

// The colours of the default theme meet the contrast WCAG asks of them against
// every surface of their scheme: 4.5:1 for a colour of text (1.4.3) and 3:1 for
// one of a line or a mark (1.4.11). The table is read out of `theme.css`, the
// one place its values are written, so a colour which is changed there is
// checked here.

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8')

/** The body of the first rule of `theme.css` whose selector is `selector`. */
function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`)
  if (at < 0) {
    throw new Error(`theme.css has no rule ${selector}`)
  }
  return css.slice(at, css.indexOf('}', at))
}

/** The light and the dark value of a token of the private table of the host. */
function pair(name: string): [string, string] {
  const found = new RegExp(
    `--_${name}: var\\(--sbmlsim-${name}, light-dark\\((rgb\\([^)]*\\)), (rgb\\([^)]*\\))\\)\\)`,
  ).exec(rule(':host'))
  if (found?.[1] === undefined || found[2] === undefined) {
    throw new Error(`theme.css has no pair of --_${name}`)
  }
  return [found[1], found[2]]
}

/** The channels of an `rgb(r g b)`. */
function channels(colour: string): number[] {
  return (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
}

/** The relative luminance of WCAG of a colour. */
function luminance(rgb: number[]): number {
  const [r = 0, g = 0, b = 0] = rgb.map((value) => {
    const share = value / 255
    return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The contrast ratio of WCAG of two colours. */
function contrast(one: number[], other: number[]): number {
  const [a, b] = [luminance(one), luminance(other)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** The surfaces text and lines are drawn on. */
const SURFACES = ['bg', 'bg-soft', 'bg-card']
/** The colours of text. */
const TEXT = ['fg', 'fg-soft', 'accent', 'error']
/** The colours of lines and marks: the curves, the kinds of the data, the focus ring. */
const LINES = ['ramp-1', 'ramp-6', 'training', 'validation', 'outlier', 'excluded', 'accent']
/** The anchors of the ramp, which a curve takes or mixes two of. */
const RAMP = ['ramp-1', 'ramp-2', 'ramp-3', 'ramp-4', 'ramp-5', 'ramp-6']

/** The least contrast of a colour against the surfaces of a scheme. */
function least(colour: number[], scheme: 0 | 1): number {
  return Math.min(...SURFACES.map((one) => contrast(colour, channels(pair(one)[scheme]))))
}

describe('the colours of the default theme', () => {
  for (const [scheme, name] of [
    [0, 'light'],
    [1, 'dark'],
  ] as const) {
    it(`give text 4.5:1 against every surface of the ${name} scheme`, () => {
      for (const one of TEXT) {
        expect(least(channels(pair(one)[scheme]), scheme), one).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`give a line 3:1 against every surface of the ${name} scheme, a mix of the ramp too`, () => {
      for (const one of LINES) {
        expect(least(channels(pair(one)[scheme]), scheme), one).toBeGreaterThanOrEqual(3)
      }
      // a curve between two anchors is their `color-mix` in srgb
      for (let index = 1; index < RAMP.length; index += 1) {
        const low = channels(pair(RAMP[index - 1] ?? '')[scheme])
        const high = channels(pair(RAMP[index] ?? '')[scheme])
        for (let step = 0; step <= 20; step += 1) {
          const part = step / 20
          const mixed = low.map((value, at) => value * (1 - part) + (high[at] ?? 0) * part)
          expect(least(mixed, scheme)).toBeGreaterThanOrEqual(3)
        }
      }
    })
  }

  it('are the same table in every rule which writes it', () => {
    const named = { light: rule(":host([theme='light'])"), dark: rule(":host([theme='dark'])") }
    for (const one of [...SURFACES, ...TEXT, ...LINES, ...RAMP]) {
      const [light, dark] = pair(one)
      expect(rule(':root'), one).toContain(`--sbmlsim-${one}: light-dark(${light}, ${dark});`)
      expect(named.light, one).toContain(`--sbmlsim-${one}: ${light};`)
      expect(named.dark, one).toContain(`--sbmlsim-${one}: ${dark};`)
    }
    expect(named.light).toContain('color-scheme: light;')
    expect(named.dark).toContain('color-scheme: dark;')
  })

  it('give a browser without light-dark() the light table, so its figure keeps its curves', () => {
    // a colour of `light-dark()` is invalid there, and an invalid stroke is none
    const at = css.indexOf('@supports not (color: light-dark(rgb(0 0 0), rgb(255 255 255))) {')
    expect(at).toBeGreaterThan(css.indexOf(':host {'))
    const block = css.slice(at, css.indexOf("\n:host([theme='light'])", at))
    for (const one of [...SURFACES, ...TEXT, ...LINES, ...RAMP]) {
      const [light] = pair(one)
      expect(block, one).toContain(`--_${one}: var(--sbmlsim-${one}, ${light});`)
      expect(block, one).toContain(`--sbmlsim-${one}: ${light};`)
    }
    expect(block.slice(block.indexOf('{'))).not.toContain('light-dark(')
  })

  it('give a figure out of its panel the light ramp as its fallback', () => {
    // a figure carries the value of its token as the fallback of `var()`, which
    // is what an SVG copied out of the panel is drawn with
    for (const [index, one] of RAMP.entries()) {
      expect(seriesColour(index, RAMP.length)).toBe(`var(--sbmlsim-${one}, ${pair(one)[0]})`)
    }
  })
})
