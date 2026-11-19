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
})
