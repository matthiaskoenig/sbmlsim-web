// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MEASURED_LIMIT, canvasMeasure, fontOf, fontShorthand, whenFontArrives } from './measure'
import type { FigureFont } from './measure'

// happy-dom has neither a canvas nor a font set, so both are stubs here, which
// a browser has as they are stubbed: a font which is the shorthand it was last
// set to, a width of the text in it, a font set which says whether a font is
// there and loads one.

/** The font every test measures in. */
const FONT: FigureFont = { family: 'Inter, sans-serif', weight: '400', style: 'normal' }

/** The texts the stub of canvas measured, with the font it measured them in. */
let measured: string[] = []

/**
 * Give the page a canvas whose text is a pixel per character and pixel of size.
 *
 * @param accepts whether it takes the shorthand it is given, which a browser
 *   refuses for one it cannot parse and keeps the font it had
 */
function canvas(accepts = true): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => {
    let font = '10px sans-serif'
    return {
      get font(): string {
        return font
      },
      set font(value: string) {
        if (accepts) {
          font = value
        }
      },
      measureText: (text: string) => {
        measured.push(`${font}|${text}`)
        const size = Number(/(\d+)px/.exec(font)?.[1] ?? 10)
        return { width: text.length * size }
      },
    }
  }) as never)
}

afterEach(() => {
  measured = []
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, 'fonts')
})

describe('canvasMeasure', () => {
  it('measures a text in the font and at the size it is asked about', () => {
    canvas()
    const measure = canvasMeasure(FONT)
    expect(measure?.('abc', 11)).toBe(33)
    expect(measure?.('abc', 12)).toBe(36)
    expect(measured).toEqual([
      'normal 400 11px Inter, sans-serif|abc',
      'normal 400 12px Inter, sans-serif|abc',
    ])
  })

  it('asks canvas about a text at a size once', () => {
    canvas()
    const measure = canvasMeasure(FONT)
    measure?.('abc', 11)
    measure?.('abc', 11)
    measure?.('abd', 11)
    expect(measured).toHaveLength(2)
  })

  it('forgets what it measured past its limit and measures again', () => {
    canvas()
    const measure = canvasMeasure(FONT)
    for (let index = 0; index <= MEASURED_LIMIT; index += 1) {
      measure?.(String(index), 11)
    }
    measured = []
    measure?.('0', 11)
    expect(measured).toHaveLength(1)
  })

  it('gives no width for a font canvas refuses, which the renderer takes from its table', () => {
    canvas(false)
    expect(canvasMeasure(FONT)?.('abc', 11)).toBeNaN()
  })

  it('is none where the page has no canvas', () => {
    expect(canvasMeasure(FONT)).toBeNull()
  })
})

describe('fontOf', () => {
  it('reads the family, the weight and the style the page resolved', () => {
    const element = document.createElement('div')
    element.style.fontFamily = 'var(--figure-font, Arial)'
    element.style.setProperty('--figure-font', 'Inter,   sans-serif')
    element.style.fontStyle = 'italic'
    element.style.fontWeight = '600'
    document.body.append(element)
    expect(fontOf(element)).toEqual({ family: 'Inter, sans-serif', weight: '600', style: 'italic' })
    expect(fontShorthand(FONT, 11)).toBe('normal 400 11px Inter, sans-serif')
  })
})

describe('whenFontArrives', () => {
  /** Give the document a font set. */
  function fonts(there: boolean, loaded: Promise<unknown[]>): { load: ReturnType<typeof vi.fn> } {
    const load = vi.fn(() => loaded)
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { check: () => there, load },
    })
    return { load }
  }

  /** Let the promises of a load settle. */
  async function settled(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('calls back once when the font has loaded', async () => {
    const set = fonts(false, Promise.resolve([{ family: 'Inter' }]))
    const arrived = vi.fn()
    whenFontArrives(FONT, arrived)
    await settled()
    expect(set.load).toHaveBeenCalledWith('normal 400 12px Inter, sans-serif')
    expect(arrived).toHaveBeenCalledTimes(1)
  })

  it('calls nothing for a font which is there, which failed or which matched none', async () => {
    const arrived = vi.fn()
    fonts(true, Promise.resolve([{ family: 'Inter' }]))
    whenFontArrives(FONT, arrived)
    fonts(false, Promise.reject(new Error('the font failed')))
    whenFontArrives(FONT, arrived)
    fonts(false, Promise.resolve([]))
    whenFontArrives(FONT, arrived)
    await settled()
    expect(arrived).not.toHaveBeenCalled()
  })

  it('calls nothing where the page has no font set', async () => {
    const arrived = vi.fn()
    whenFontArrives(FONT, arrived)
    await settled()
    expect(arrived).not.toHaveBeenCalled()
  })
})
