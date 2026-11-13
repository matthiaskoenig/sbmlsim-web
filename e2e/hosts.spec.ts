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

      // the first control of the panel, which is the knob the run grids over:
      // a slider on the deck, a select on the two pages of the renal panel.
      // `Home` is its lowest value, which both kinds of control take and which
      // the figure must show: a step of the dose slider does not move a pixel,
      // since the axis is scaled to the data and the model is nearly linear in
      // the dose, so the curve of a smaller dose is the same curve
      const knob = panel.locator('input[type=range], select').first()
      await knob.focus()
      await page.keyboard.press('Home')
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
    const before = await knob.inputValue()
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
    expect(await knob.inputValue()).not.toBe(before)
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
  /** The width of a page which gives the legend its whole column. */
  const WIDE = 1280

  for (const width of [WIDE, 390]) {
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
      if (width >= WIDE) {
        // the labels of the panel fit the column of a page
        expect(names.join('')).not.toContain('…')
      } else {
        // the curves of this panel are a concentration and an amount, so each
        // entry carries its own unit, and a label too long for a phone is cut
        // in its middle: the unit at its end is what a reader must keep
        expect(names.every((name) => name.endsWith(']'))).toBe(true)
      }
      for (const [index, entry] of entries.entries()) {
        const next = entries[index + 1]
        if (next !== undefined) {
          expect(entry.bottom).toBeLessThanOrEqual(next.top + 1)
        }
      }
    })
  }
})

test.describe('the app shell', () => {
  /** The requests of one kind the page made, which the tests count. */
  function countRequests(page: Page, ends: string): { urls: () => string[] } {
    const urls: string[] = []
    page.on('request', (request) => {
      if (request.url().endsWith(ends)) {
        urls.push(request.url())
      }
    })
    return { urls: () => urls }
  }

  /** Open the app page and wait until the figure of its first panel is drawn. */
  async function openApp(page: Page): Promise<Locator> {
    await page.goto('/demo/app.html')
    const app = page.locator('sbmlsim-app')
    await expect(app.locator('sbmlsim-panel svg path').first()).toBeVisible()
    return app
  }

  test('draws the navigation, the panels of a page and the footer from the declaration', async ({
    page,
  }) => {
    const app = await openApp(page)
    await expect(app.locator('h1')).toHaveText('Hydrochlorothiazide')
    await expect(app.locator('.nav .tab')).toHaveText(['Renal impairment', 'Dose'])
    await expect(app.locator('.nav .tab[aria-current=page]')).toHaveText('Renal impairment')
    await expect(app.locator('sbmlsim-panel')).toHaveCount(1)
    // the declaration of the HCTZ app has one variant, so there is no switcher
    await expect(app.locator('.variant')).toHaveCount(0)
    await expect(app.locator('.footer')).toContainText('Beermann et al. (1976)')
    await expect(app.locator('.footer')).toContainText('CC BY-SA 4.0')
    await expect(app.locator('.footer a')).toHaveAttribute(
      'href',
      'https://doi.org/10.5281/zenodo.0000000',
    )
    await expect(app.locator('.simulated')).toContainText('roadrunner')
  })

  test('switches the page without reading the app again', async ({ page }) => {
    const apps = countRequests(page, '/api/models/hctz/app')
    const renal = countRequests(page, '/panels/renal')
    const app = await openApp(page)
    await app.locator('.tab', { hasText: 'Dose' }).click()
    await expect(app.locator('sbmlsim-panel')).toHaveCount(2)
    await expect(app.locator('sbmlsim-panel svg path').first()).toBeVisible()
    await expect(app.locator('sbmlsim-panel .title')).toHaveText([
      'Plasma concentration over the dose',
      'Urinary excretion over the dose',
    ])
    await expect(app.locator('.nav .tab[aria-current=page]')).toHaveText('Dose')
    expect(apps.urls()).toHaveLength(1)
    expect(renal.urls()).toHaveLength(1)
    // the page is the attribute, so it can be linked to
    await expect(app).toHaveAttribute('page', 'dose')
    // and back: the panel is created again and reads its declaration again
    await app.locator('.tab', { hasText: 'Renal impairment' }).click()
    await expect(app.locator('sbmlsim-panel')).toHaveCount(1)
    await expect(app.locator('sbmlsim-panel svg path').first()).toBeVisible()
    expect(apps.urls()).toHaveLength(1)
  })

  test('sends the chosen variant to every panel of the page', async ({ page }) => {
    // the HCTZ project has one SBML file, so the app declares one variant; the
    // wire is what is under test here, so the declaration is given two and the
    // service, which knows only the one, answers the simulations without it
    await page.route('**/api/models/hctz/app', async (route) => {
      const response = await route.fetch()
      const body = (await response.json()) as Record<string, unknown>
      body.variants = [
        { id: 'default', label: 'Default' },
        { id: 'impaired', label: 'Impaired' },
      ]
      await route.fulfill({ response, json: body })
    })
    const sent: (string | undefined)[] = []
    await page.route('**/simulate', async (route) => {
      const request = route.request().postDataJSON() as Record<string, unknown>
      sent.push(request.variant as string | undefined)
      await route.continue({
        postData: JSON.stringify({ values: request.values, grid: request.grid }),
      })
    })
    const app = await openApp(page)
    await expect.poll(() => sent.length).toBe(1)
    expect(sent).toEqual(['default'])
    await app.locator('.tab', { hasText: 'Dose' }).click()
    await expect(app.locator('sbmlsim-panel')).toHaveCount(2)
    await expect.poll(() => sent.length).toBe(3)
    expect(sent.slice(1)).toEqual(['default', 'default'])
    await app.locator('.variant-select').selectOption('impaired')
    await expect.poll(() => sent.length).toBe(5)
    expect(sent.slice(3)).toEqual(['impaired', 'impaired'])
  })

  test('shows one readable line and no frame when the endpoint cannot be reached', async ({
    page,
  }) => {
    await page.route('**/api/models/hctz/app', (route) => route.abort())
    await page.goto('/demo/app.html')
    const app = page.locator('sbmlsim-app')
    await expect(app.locator('[role=alert]')).toHaveText(
      'The simulation endpoint could not be reached.',
    )
    for (const gone of ['.head', '.bar', '.grid', '.footer', 'sbmlsim-panel']) {
      await expect(app.locator(gone)).toHaveCount(0)
    }
    await expect(app.locator('[role=alert]')).not.toContainText('127.0.0.1')
  })

  for (const { width, columns } of [
    { width: 1280, columns: 2 },
    { width: 800, columns: 1 },
    { width: 390, columns: 1 },
  ]) {
    test(`lays the page out in ${String(columns)} column(s) at ${String(width)} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      const app = await openApp(page)
      await app.locator('.tab', { hasText: 'Dose' }).click()
      await expect(app.locator('sbmlsim-panel')).toHaveCount(2)
      await expect(app.locator('sbmlsim-panel svg path').nth(1)).toBeVisible()
      const geometry = await app.evaluate((element) => {
        const root = element.shadowRoot
        const box = (selector: string): DOMRect => {
          const found = root?.querySelector(selector)
          if (!found) {
            throw new Error(`no ${selector}`)
          }
          return found.getBoundingClientRect()
        }
        const cells = [...(root?.querySelectorAll('.cell') ?? [])].map((one) =>
          one.getBoundingClientRect(),
        )
        const footer = box('.footer')
        return {
          columns: new Set(cells.map((one) => Math.round(one.x))).size,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          // the footer starts below the last card and the cards stay in the shell
          gap: footer.top - Math.max(...cells.map((one) => one.bottom)),
          widest: Math.max(...cells.map((one) => one.right)) - box('.shell').right,
        }
      })
      expect(geometry.columns).toBe(columns)
      expect(geometry.overflow).toBe(0)
      expect(geometry.gap).toBeGreaterThanOrEqual(12)
      expect(geometry.widest).toBeLessThanOrEqual(0)
    })
  }

  test('keeps its navigation where it is when the page changes', async ({ page }) => {
    const app = await openApp(page)
    const position = (): Promise<number[]> =>
      app.locator('.tab').evaluateAll((all) => all.map((one) => one.getBoundingClientRect().x))
    const before = await position()
    await app.locator('.tab', { hasText: 'Dose' }).click()
    await expect(app.locator('sbmlsim-panel')).toHaveCount(2)
    expect(await position()).toEqual(before)
  })

  /**
   * Measure the contrast of the text of the shell against what it sits on.
   *
   * The background behind an element is the first one which is painted on the
   * way up, through the shadow roots, so the measure is of the surface the
   * reader sees and not of one the element happens not to sit on.
   */
  async function contrasts(app: Locator): Promise<Record<string, number>> {
    return app.evaluate((element) => {
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
      const behind = (start: Element): string => {
        let node: Node | null = start
        while (node !== null) {
          if (node instanceof Element) {
            const paint = getComputedStyle(node).backgroundColor
            if (parse(paint).length < 4 || parse(paint)[3] !== 0) {
              return paint
            }
          }
          node = node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentNode
        }
        return 'rgb(255, 255, 255)'
      }
      const root = element.shadowRoot
      const measure = (selector: string): number => {
        const found = root?.querySelector(selector)
        if (!found) {
          throw new Error(`no ${selector}`)
        }
        return ratio(getComputedStyle(found).color, behind(found))
      }
      const shell = root?.querySelector('.shell')
      return {
        title: measure('.title'),
        subtitle: measure('.subtitle'),
        idle: measure('.tab:not([aria-current])'),
        current: measure('.tab[aria-current]'),
        citation: measure('.citation'),
        link: measure('.footer a'),
        // the surface itself, against the white of a page which is not dark
        surface: ratio(shell ? behind(shell) : '', 'rgb(255, 255, 255)'),
      }
    })
  }

  test('is readable with theme dark on a light page', async ({ page }) => {
    await page.goto('/demo/app.html')
    const app = page.locator('sbmlsim-app')
    await app.evaluate((element) => {
      element.setAttribute('theme', 'dark')
    })
    await expect(app.locator('sbmlsim-panel svg path').first()).toBeVisible()
    const ratios = await contrasts(app)
    // the surface is dark, so the light text of the dark table sits on it
    expect(ratios.surface).toBeGreaterThan(10)
    expect(ratios.title).toBeGreaterThan(7)
    for (const name of ['subtitle', 'idle', 'current', 'citation', 'link']) {
      expect(ratios[name], name).toBeGreaterThan(4.5)
    }
  })

  test('is readable under a dark colour scheme on the unmodified page', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/demo/app.html')
    const app = page.locator('sbmlsim-app')
    await expect(app.locator('sbmlsim-panel svg path').first()).toBeVisible()
    const ratios = await contrasts(app)
    expect(ratios.surface).toBeGreaterThan(10)
    expect(ratios.title).toBeGreaterThan(7)
    for (const name of ['subtitle', 'idle', 'current', 'citation', 'link']) {
      expect(ratios[name], name).toBeGreaterThan(4.5)
    }
  })

  test('is readable in the light theme', async ({ page }) => {
    await page.goto('/demo/app.html')
    const app = page.locator('sbmlsim-app')
    await expect(app.locator('sbmlsim-panel svg path').first()).toBeVisible()
    const ratios = await contrasts(app)
    expect(ratios.surface).toBeLessThan(1.1)
    expect(ratios.title).toBeGreaterThan(7)
    for (const name of ['subtitle', 'idle', 'current', 'citation', 'link']) {
      expect(ratios[name], name).toBeGreaterThan(4.5)
    }
  })

  test('announces a page change and tells the page', async ({ page }) => {
    const app = await openApp(page)
    await app.evaluate((element) => {
      const heard: unknown[] = []
      element.addEventListener('sbmlsim-page', (event) => heard.push((event as CustomEvent).detail))
      ;(window as unknown as { heard: unknown[] }).heard = heard
    })
    await app.locator('.tab', { hasText: 'Dose' }).click()
    await expect(app.locator('.live')).toHaveText('Showing Dose')
    expect(await page.evaluate(() => (window as unknown as { heard: unknown[] }).heard)).toEqual([
      { page: 'dose' },
    ])
    await expect(app.locator('main')).toHaveCount(0)
  })

  test('lets a lone panel take the row', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const app = await openApp(page)
    const widths = await app.evaluate((element) => {
      const root = element.shadowRoot
      const cell = root?.querySelector('.cell')?.getBoundingClientRect()
      const grid = root?.querySelector('.grid')?.getBoundingClientRect()
      return { cell: cell?.width ?? 0, grid: grid?.width ?? 0 }
    })
    expect(widths.cell).toBeCloseTo(widths.grid, 0)
  })
})
