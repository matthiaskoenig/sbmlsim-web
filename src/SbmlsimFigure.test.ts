// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import type { AppFigure } from './contract'
import { FIGURE_TAG } from './index'
import type { SbmlsimFigureHTMLElement } from './index'

// A neutral drawing: a group `li` with a chip `sub:gli` inside, a chip with no
// group around it, a decoration which opens nothing and an element without a key.
const SVG = `<svg viewBox="0 0 10 10">
  <g data-k="li" id="group"><rect data-k="sub:gli" id="chip"></rect><rect id="bare"></rect></g>
  <rect data-k="sub:out" id="outside"></rect>
  <rect data-k="frame" id="frame"></rect>
  <g data-k="ki" id="kidney"><rect data-k="sub:gli" id="chip2"></rect><g data-k="deep"><rect data-k="leaf" id="leaf"></rect></g><rect data-k="mark" id="decor"></rect></g>
</svg>`

/** The figure of a test with the given map of panels. */
function figureOf(panels: Record<string, string[]>): AppFigure {
  return { svg: SVG, title: 'a figure', credit: '', panels }
}

const selections: string[] = []

/** Put the element in the page with a figure and the paths on screen. */
async function figureElement(
  panels: Record<string, string[]>,
  marked: string[] = [],
): Promise<SbmlsimFigureHTMLElement> {
  const element = document.createElement(FIGURE_TAG)
  element.addEventListener('sbmlsim-figure-select', (event) => {
    selections.push((event as CustomEvent<{ key: string }>).detail.key)
  })
  document.body.append(element)
  element.figure = figureOf(panels)
  element.marked = marked
  await settled()
  return element
}

/** Let vue render and the element decorate the drawing. */
async function settled(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

/** The root of the element's own tree. */
function root(element: SbmlsimFigureHTMLElement): ShadowRoot {
  if (element.shadowRoot === null) {
    throw new Error('the element has no shadow root')
  }
  return element.shadowRoot
}

/** Click what the selector finds in the drawing. */
function click(element: SbmlsimFigureHTMLElement, selector: string): void {
  const target = root(element).querySelector(selector)
  if (target === null) {
    throw new Error(`no '${selector}' in the drawing`)
  }
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

/** The ids of the marked elements. */
function marked(element: SbmlsimFigureHTMLElement): string[] {
  return [...root(element).querySelectorAll('.k-marked')].map(
    (one) => one.getAttribute('data-k') ?? '',
  )
}

/** The overlay of the element, the dialog the enlarged drawing moves into. */
function overlay(element: SbmlsimFigureHTMLElement): HTMLDialogElement {
  const dialog = root(element).querySelector('dialog')
  if (dialog === null) {
    throw new Error('the element has no overlay')
  }
  return dialog
}

/** Whether the drawing sits inside what the selector finds. */
function inside(element: SbmlsimFigureHTMLElement, selector: string): boolean {
  const box = root(element).querySelector(selector)
  const drawing = root(element).querySelector('.drawing')
  return box !== null && drawing !== null && box.contains(drawing)
}

/** Press what the selector finds in the element's own tree. */
function press(element: SbmlsimFigureHTMLElement, selector: string): void {
  const target = root(element).querySelector(selector)
  if (target === null) {
    throw new Error(`no '${selector}' in the element`)
  }
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

afterEach(() => {
  selections.length = 0
  document.body.replaceChildren()
})

describe('the figure element', () => {
  it('reports the path of the keys of what was clicked', async () => {
    const element = await figureElement({ 'li/sub:gli': ['li_gli'] })
    click(element, '[data-k="sub:gli"]')
    expect(selections).toEqual(['li/sub:gli'])
  })

  it('falls back to the shorter path when the longer one is not in the map', async () => {
    const element = await figureElement({ li: ['li_all'] })
    click(element, '[data-k="sub:gli"]')
    expect(selections).toEqual(['li'])
  })

  it('reports nothing for an element which carries no key', async () => {
    const element = await figureElement({ li: ['li_all'] })
    click(element, '#outside')
    click(element, 'svg')
    expect(selections).toEqual([])
  })

  it('reports nothing for a decoration and a key which opens no panel', async () => {
    const element = await figureElement({ frame: [], 'li/sub:gli': ['li_gli'] })
    click(element, '#frame')
    click(element, '#bare')
    expect(selections).toEqual([])
    expect(root(element).querySelector('#frame')?.classList.contains('k-live')).toBe(false)
    expect(root(element).querySelector('#frame')?.hasAttribute('tabindex')).toBe(false)
  })

  it('reports a key which opens several panels once', async () => {
    const element = await figureElement({ li: ['li_a', 'li_b'] })
    click(element, '#group')
    expect(selections).toEqual(['li'])
  })

  it('marks every path it is told is on screen', async () => {
    const element = await figureElement({ 'li/sub:gli': ['li_gli'], li: ['li_all'] }, [
      'li/sub:gli',
    ])
    expect(marked(element)).toEqual(['sub:gli'])
    expect(root(element).querySelector('#chip')?.getAttribute('aria-pressed')).toBe('true')
    expect(root(element).querySelector('#group')?.getAttribute('aria-pressed')).toBe('false')
  })

  it('follows the marks as they change, and still reports a click on a marked path', async () => {
    const element = await figureElement({ li: ['li_all'], 'sub:out': ['out'] }, ['li'])
    expect(marked(element)).toEqual(['li'])
    element.marked = ['sub:out']
    await settled()
    expect(marked(element)).toEqual(['sub:out'])
    click(element, '#outside')
    expect(selections).toEqual(['sub:out'])
  })

  it('reports a press of Enter on a control and ignores one on a decoration', async () => {
    const element = await figureElement({ li: ['li_all'], frame: [] })
    root(element)
      .querySelector('#group')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    root(element)
      .querySelector('#frame')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(selections).toEqual(['li'])
  })

  it('draws nothing without a figure', async () => {
    const element = await figureElement({})
    element.figure = null
    await settled()
    expect(root(element).querySelector('svg')).toBeNull()
  })

  it('reports the chip inside a group whose key opens several panels', async () => {
    const element = await figureElement({ li: ['li_a', 'li_b'], 'li/sub:gli': ['li_gli'] })
    click(element, '#chip')
    expect(selections).toEqual(['li/sub:gli'])
  })

  it('falls back to the group from a decoration nested in it', async () => {
    const element = await figureElement({ ki: ['ki_all'], 'ki/mark': [] })
    click(element, '#decor')
    expect(selections).toEqual(['ki'])
    expect(root(element).querySelector('#decor')?.classList.contains('k-live')).toBe(false)
  })

  it('reads a path of three levels', async () => {
    const element = await figureElement({ 'ki/deep/leaf': ['leaf'], 'ki/deep': ['deep'] })
    click(element, '#leaf')
    expect(selections).toEqual(['ki/deep/leaf'])
  })

  it('tells the same child key under two groups apart', async () => {
    const element = await figureElement({ 'li/sub:gli': ['in_li'], 'ki/sub:gli': ['in_ki'] }, [
      'ki/sub:gli',
    ])
    click(element, '#chip')
    click(element, '#chip2')
    expect(selections).toEqual(['li/sub:gli', 'ki/sub:gli'])
    expect([...root(element).querySelectorAll('.k-marked')].map((one) => one.id)).toEqual(['chip2'])
  })

  it('does not mark a path which opens nothing', async () => {
    const element = await figureElement({ frame: [], li: ['li_all'] }, ['frame', 'li'])
    expect(marked(element)).toEqual(['li'])
  })

  it('names a control by its label, and by its path without one', async () => {
    const element = await figureElement({ li: ['li_all'], 'li/sub:gli': ['li_gli'] })
    element.labels = { li: 'Liver' }
    await settled()
    expect(root(element).querySelector('#group')?.getAttribute('aria-label')).toBe('Liver')
    expect(root(element).querySelector('#chip')?.getAttribute('aria-label')).toBe('li/sub:gli')
    expect(root(element).querySelector('#frame')?.hasAttribute('aria-label')).toBe(false)
  })

  it('applies the marks again to a replaced drawing and to one which comes back', async () => {
    const element = await figureElement({ li: ['li_all'] }, ['li'])
    element.figure = {
      ...figureOf({ li: ['li_all'] }),
      svg: SVG.replace('id="group"', 'id="again"'),
    }
    await settled()
    expect(marked(element)).toEqual(['li'])
    expect(root(element).querySelector('#again')?.classList.contains('k-marked')).toBe(true)
    element.figure = null
    await settled()
    expect(root(element).querySelector('svg')).toBeNull()
    element.figure = figureOf({ li: ['li_all'] })
    await settled()
    expect(marked(element)).toEqual(['li'])
    click(element, '#group')
    expect(selections).toEqual(['li'])
  })

  it('enlarges the drawing when it is clicked beside its controls', async () => {
    const element = await figureElement({ 'li/sub:gli': ['li_gli'] })
    click(element, '#bare')
    await settled()
    expect(selections).toEqual([])
    expect(overlay(element).open).toBe(true)
    expect(inside(element, 'dialog')).toBe(true)
  })

  it('keeps the height of the figure while the drawing is away', async () => {
    const element = await figureElement({ 'li/sub:gli': ['li_gli'] })
    const frame = root(element).querySelector<HTMLElement>('.frame')
    if (frame === null) {
      throw new Error("no '.frame' in the element")
    }
    expect(frame.style.minHeight).toBe('')
    click(element, '#bare')
    await settled()
    expect(frame.style.minHeight).not.toBe('')
    press(element, '.close')
    await settled()
    expect(frame.style.minHeight).toBe('')
  })

  it('keeps one drawing when it is enlarged', async () => {
    const element = await figureElement({ 'li/sub:gli': ['li_gli'] })
    click(element, '#bare')
    await settled()
    expect(root(element).querySelectorAll('.drawing')).toHaveLength(1)
    expect(root(element).querySelectorAll('.drawing svg')).toHaveLength(1)
  })

  it('enlarges the drawing from the button of the figure', async () => {
    const element = await figureElement({ li: ['li_all'] })
    press(element, '.zoom')
    await settled()
    expect(overlay(element).open).toBe(true)
    expect(selections).toEqual([])
  })

  it('does not enlarge the drawing when a control is clicked', async () => {
    const element = await figureElement({ 'li/sub:gli': ['li_gli'] })
    click(element, '[data-k="sub:gli"]')
    await settled()
    expect(selections).toEqual(['li/sub:gli'])
    expect(overlay(element).open).toBe(false)
  })

  it('reports the key of a control of the enlarged drawing and closes the overlay', async () => {
    const element = await figureElement({ 'li/sub:gli': ['li_gli'] })
    click(element, '#bare')
    await settled()
    click(element, '[data-k="sub:gli"]')
    await settled()
    expect(selections).toEqual(['li/sub:gli'])
    expect(overlay(element).open).toBe(false)
    expect(inside(element, 'dialog')).toBe(false)
  })

  it('closes the overlay from its button and from a click beside the drawing', async () => {
    const element = await figureElement({ li: ['li_all'] })
    press(element, '.zoom')
    await settled()
    press(element, '.close')
    await settled()
    expect(overlay(element).open).toBe(false)
    press(element, '.zoom')
    await settled()
    press(element, 'dialog')
    await settled()
    expect(overlay(element).open).toBe(false)
    expect(selections).toEqual([])
  })

  it('has no overlay and no button without a figure', async () => {
    const element = document.createElement(FIGURE_TAG)
    document.body.append(element)
    await settled()
    expect(root(element).querySelector('dialog')).toBeNull()
    expect(root(element).querySelector('.zoom')).toBeNull()
  })

  it('draws a figure which is given before the element is in the page', async () => {
    const element = document.createElement(FIGURE_TAG)
    element.figure = figureOf({ li: ['li_all'] })
    element.marked = ['li']
    document.body.append(element)
    await settled()
    expect(marked(element)).toEqual(['li'])
  })
})
