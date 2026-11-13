import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

/** The pages of the three hosts, as the endpoint serves them. */
const HOSTS = ['plain.html', 'slides.html', 'docs.html']

/** The simulation requests of a page, which the tests count. */
function countSimulations(page: Page): { count: () => number } {
  let n = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/simulate')) {
      n += 1
    }
  })
  return { count: () => n }
}

/** The geometry of every curve of the figure, which changes when a curve does. */
async function curves(panel: Locator): Promise<string> {
  const paths = await panel
    .locator('svg path')
    .evaluateAll((all) => all.map((p) => p.getAttribute('d') ?? ''))
  return paths.join('|')
}

/** The position of the slide which is shown, from the classes the deck sets. */
function slideIndex(page: Page): Promise<number> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.slides > section')].findIndex((slide) =>
      slide.classList.contains('present'),
    ),
  )
}

/** Open a page and wait until the figure is drawn, on the slide where it is. */
async function open(page: Page, name: string): Promise<Locator> {
  // the deck opens on the slide of the panel, which needs no transition to it
  await page.goto(name === 'slides.html' ? '/demo/slides.html#/1' : `/demo/${name}`)
  const panel = page.locator('sbmlsim-panel')
  await expect(panel.locator('svg path').first()).toBeVisible()
  return panel
}

test.describe('the element works on every host', () => {
  for (const name of HOSTS) {
    test(`renders and updates on ${name}`, async ({ page }) => {
      const simulations = countSimulations(page)
      const panel = await open(page, name)
      await expect.poll(simulations.count).toBe(1)
      const before = await curves(panel)
      expect(before).not.toBe('')

      const knob = panel.locator('input[type=range]').first()
      await knob.focus()
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('ArrowLeft')
      await expect.poll(() => curves(panel)).not.toBe(before)
      // a move of the gridded knob is read out of the grid which is drawn, and
      // the pause is longer than the debounce of a release
      await page.waitForTimeout(500)
      expect(simulations.count()).toBe(1)
    })
  }
})

test.describe('the slides', () => {
  test('keep their keyboard navigation while a knob has focus', async ({ page }) => {
    await open(page, 'slides.html')
    const knob = page.locator('sbmlsim-panel input[type=range]').first()
    await knob.focus()
    // the knob takes the arrow keys, and the deck stays on its slide
    const before = await knob.inputValue()
    await page.keyboard.press('ArrowLeft')
    expect(await knob.inputValue()).not.toBe(before)
    expect(await slideIndex(page)).toBe(1)
    // a key the knob has no use for still turns the page
    await page.keyboard.press('n')
    await expect.poll(() => slideIndex(page)).toBe(2)
  })

  test('a mouse drag moves the knob and leaves the slide', async ({ page }) => {
    await open(page, 'slides.html')
    const knob = page.locator('sbmlsim-panel input[type=range]').first()
    const box = await knob.boundingBox()
    if (box === null) {
      throw new Error('the knob has no box')
    }
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width * 0.9, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.1, y, { steps: 8 })
    await page.mouse.up()
    expect(await slideIndex(page)).toBe(1)
    expect(await knob.inputValue()).not.toBe('1')
  })

  test('the panel is readable on a dark reveal theme', async ({ page }) => {
    const panel = await open(page, 'slides.html')
    // the contrast of the text and of the first curve against what is behind
    // them, from the colours the browser computed, so a token which does not
    // reach the shadow root fails here
    const ratios = await panel.evaluate((host) => {
      const parse = (text: string): number[] => (text.match(/[\d.]+/g) ?? []).map(Number)
      const lin = (c: number): number => {
        const s = c / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      const luminance = ([r = 0, g = 0, b = 0]: number[]): number =>
        0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
      const ratio = (a: string, b: string): number => {
        const [x, y] = [luminance(parse(a)), luminance(parse(b))]
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
      }
      const root = host.shadowRoot
      if (root === null) {
        throw new Error('the element has no shadow root')
      }
      const style = (selector: string): CSSStyleDeclaration => {
        const found = root.querySelector(selector)
        if (found === null) {
          throw new Error(`no ${selector}`)
        }
        return getComputedStyle(found)
      }
      const page = getComputedStyle(document.body).backgroundColor
      const select = style('select')
      return {
        title: ratio(style('.title').color, page),
        label: ratio(style('.knob-label').color, page),
        curve: ratio(style('svg path').stroke, page),
        select: ratio(select.color, select.backgroundColor),
      }
    })
    expect(ratios.title).toBeGreaterThan(7)
    expect(ratios.label).toBeGreaterThan(4.5)
    expect(ratios.select).toBeGreaterThan(4.5)
    expect(ratios.curve).toBeGreaterThan(3)
  })
})

test.describe('the slides on a touch screen', () => {
  test.use({ hasTouch: true })

  /** Swipe from one point to another with real touch events, as a finger does. */
  async function swipe(
    page: Page,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Promise<void> {
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [from],
    })
    for (let step = 1; step <= 6; step += 1) {
      const at = {
        x: from.x + ((to.x - from.x) * step) / 6,
        y: from.y + ((to.y - from.y) * step) / 6,
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at] })
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await session.detach()
  }

  test('a swipe which starts on the panel does not change the slide', async ({ page }) => {
    await open(page, 'slides.html')
    // the control which the swipe is made to prove: the same gesture turns the
    // slide where it starts outside the element, so a swipe which does not
    // turn it on the panel is the attribute `data-prevent-swipe` at work and
    // not a gesture reveal does not read
    const title = await page.locator('sbmlsim-panel .title').boundingBox()
    if (title === null) {
      throw new Error('the panel has no title')
    }
    const start = { x: title.x + title.width / 2, y: title.y + title.height / 2 }
    await swipe(page, start, { x: start.x - 300, y: start.y })
    expect(await slideIndex(page)).toBe(1)
    await swipe(page, { x: 1100, y: 40 }, { x: 600, y: 40 })
    await expect.poll(() => slideIndex(page)).toBe(2)
  })
})

test.describe('the legend', () => {
  for (const width of [1280, 390]) {
    test(`tells the curves apart at ${String(width)} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await open(page, 'docs.html')
      const entries = await page.locator('sbmlsim-panel .legend-entry').evaluateAll((all) =>
        all.map((entry) => {
          const lines = [...entry.querySelectorAll('text')]
          const boxes = lines.map((line) => line.getBoundingClientRect())
          return {
            text: lines.map((line) => line.textContent).join(' '),
            top: Math.min(...boxes.map((box) => box.top)),
            bottom: Math.max(...boxes.map((box) => box.bottom)),
          }
        }),
      )
      expect(entries.length).toBeGreaterThanOrEqual(2)
      const names = entries.map((entry) => entry.text)
      expect(new Set(names).size).toBe(names.length)
      expect(names.join('')).not.toContain('…')
      for (const [index, entry] of entries.entries()) {
        const next = entries[index + 1]
        if (next !== undefined) {
          expect(entry.bottom).toBeLessThanOrEqual(next.top + 1)
        }
      }
    })
  }
})
