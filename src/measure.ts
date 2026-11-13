/**
 * The measure of the text of a figure in the font a page draws it in.
 *
 * The renderer lays a figure out with whatever measure its spec carries and
 * touches no dom itself, so this is where the dom is read: the font the
 * element resolved for its figure, the width canvas gives a text in that font,
 * and the moment a font which was still loading arrives. A page whose browser
 * has no canvas, and the tests, get no measure from here, and the renderer
 * then measures with its table.
 */

import type { TextMeasure } from './plot'

/** The font a figure is drawn in, as the page resolved it. */
export interface FigureFont {
  /** The family, the list of families as the page resolved it. */
  family: string
  /** The weight, `400` for a regular one. */
  weight: string
  /** The style, `normal` for an upright one. */
  style: string
}

/**
 * The widths one measure keeps at most before it forgets them all.
 *
 * A figure is laid out on every movement of a knob, and the tick labels of a
 * frame which moves are new texts each time, so a measure of a long session
 * would otherwise keep every label it was ever asked about.
 */
export const MEASURED_LIMIT = 4096

/** The size the arrival of a font is asked about, which any size of it answers. */
const PROBE_SIZE = 12

/**
 * Read the font the text of an element is drawn in.
 *
 * @param element the element the text is drawn in or inherits its font from
 * @returns its family, weight and style, `null` where the page resolves no
 *   family for it, which is a dom that computes no style
 */
export function fontOf(element: Element): FigureFont | null {
  try {
    const style = globalThis.getComputedStyle(element)
    const family = style.fontFamily.replace(/\s+/g, ' ').trim()
    if (family === '') {
      return null
    }
    return {
      family,
      weight: style.fontWeight === '' ? '400' : style.fontWeight,
      style: style.fontStyle === '' ? 'normal' : style.fontStyle,
    }
  } catch {
    return null
  }
}

/**
 * Write a font as the shorthand canvas and `document.fonts` read.
 *
 * @param font the font
 * @param size its size in pixels
 * @returns the shorthand, style, weight, size and family in that order
 */
export function fontShorthand(font: FigureFont, size: number): string {
  return `${font.style} ${font.weight} ${String(size)}px ${font.family}`
}

/**
 * Build the measure of a font on canvas `measureText`.
 *
 * The measure keeps the width of every text it was asked about, by its size
 * and its text, so a figure which is laid out again for a movement of a knob
 * asks canvas only about the labels it has not written before; the font is
 * the one of the measure, so a font which changes is a new measure with
 * nothing kept. A width canvas cannot give in the font, which is a shorthand
 * it refused, is `NaN`, which the renderer takes from its table instead.
 *
 * @param font the font the text is drawn in
 * @returns the measure, `null` where the page has no canvas to measure with
 */
export function canvasMeasure(font: FigureFont): TextMeasure | null {
  let context: CanvasRenderingContext2D | null
  try {
    context = globalThis.document.createElement('canvas').getContext('2d')
  } catch {
    context = null
  }
  if (context === null) {
    return null
  }
  const drawing = context
  const widths = new Map<string, number>()
  return (text, size) => {
    const key = `${String(size)}\u0000${text}`
    const known = widths.get(key)
    if (known !== undefined) {
      return known
    }
    drawing.font = fontShorthand(font, size)
    // canvas keeps the font it had for a shorthand it cannot parse, so a width
    // is only one of this font where the font canvas reports carries its size
    const width = drawing.font.includes(`${String(size)}px`)
      ? drawing.measureText(text).width
      : Number.NaN
    if (widths.size >= MEASURED_LIMIT) {
      widths.clear()
    }
    widths.set(key, width)
    return width
  }
}

/**
 * Call back once when a font which is still loading has arrived.
 *
 * A font the page serves itself may arrive after the first figure was laid
 * out with the font the browser drew in meanwhile, and the widths of the two
 * differ. This asks `document.fonts` about the one font of the figure, once:
 * a font which is there already, a system font among them, calls nothing, a
 * font which loads calls back when it has loaded, and a font which fails calls
 * nothing, since the figure was measured in the fallback it is drawn in. No
 * listener is left on the page, so the fonts the page loads for anything else
 * never lay the figure out again.
 *
 * @param font the font of the figure
 * @param arrived what is called when it has arrived
 */
export function whenFontArrives(font: FigureFont, arrived: () => void): void {
  const fonts: FontFaceSet | undefined = (globalThis.document as Document | undefined)?.fonts
  if (
    fonts === undefined ||
    typeof fonts.check !== 'function' ||
    typeof fonts.load !== 'function'
  ) {
    return
  }
  const shorthand = fontShorthand(font, PROBE_SIZE)
  try {
    if (fonts.check(shorthand)) {
      return
    }
    fonts.load(shorthand).then(
      (faces) => {
        if (faces.length > 0) {
          arrived()
        }
      },
      () => undefined,
    )
  } catch {
    // a font set which cannot be asked leaves the figure as it was measured
  }
}
