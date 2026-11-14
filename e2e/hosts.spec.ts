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
      // a panel alone is as tall as what it draws: the room a card of an app
      // gives it above its body is none here
      const room = await panel.evaluate((element) => {
        const inner = element.shadowRoot
        const head = inner?.querySelector('.head')?.getBoundingClientRect().bottom ?? 0
        const body = inner?.querySelector('.body')?.getBoundingClientRect().top ?? 0
        const box = inner?.querySelector('.panel')
        return body - head - (box ? Number.parseFloat(getComputedStyle(box).rowGap) : 0)
      })
      expect(room).toBeCloseTo(0, 0)

      // the first control of the panel, which is the knob the run grids over:
      // a slider on the deck, a select on the two pages of the renal panels.
      // Two steps of the arrow key are what a reader does, and they have to
      // move the curve: the model is nearly linear in the dose, so the curve of
      // a smaller dose is the same shape, and it is the frame which makes the
      // difference visible. The value axis is taken over the whole answer, so
      // the curve of a smaller dose is drawn lower in an axis which holds still
      // instead of being redrawn identically in an axis scaled to itself
      const knob = panel.locator('input[type=range], select').first()
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
            left: Math.min(...boxes.map((box) => box.left)),
            right: Math.max(...boxes.map((box) => box.right)),
          }
        }),
      )
      expect(entries.length).toBeGreaterThanOrEqual(2)
      const names = entries.map((entry) => entry.text)
      expect(new Set(names).size).toBe(names.length)
      // the curves of this panel are one quantity in one unit, so the unit is
      // on the axis and every entry is the short label of its curve, which
      // fits the column of a phone as well as the one of a page
      expect(names.join('')).not.toContain('…')
      // no entry runs into the next one, whether the legend is the column
      // beside the plot, where the entries are stacked, or the band below it,
      // where they are packed into rows
      for (const [index, entry] of entries.entries()) {
        const next = entries[index + 1]
        if (next !== undefined) {
          const stacked = entry.bottom <= next.top + 1
          const beside = entry.right <= next.left + 1
          expect(stacked || beside).toBe(true)
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

  /**
   * Give the HCTZ app a second variant, which the service does not know.
   *
   * The wire is what is under test, so the declaration names two variants and
   * the service, which knows the one, answers what is read in the other as it
   * answers the first: the app, a declaration and the study data in `impaired`
   * are the ones without a variant, so the shell and the panels read them in
   * the variant as they read a variant which differs.
   */
  async function twoVariants(page: Page): Promise<{ asked: () => string[] }> {
    const asked: string[] = []
    await page.route(
      (url) => url.pathname === '/api/models/hctz/app',
      async (route) => {
        const url = new URL(route.request().url())
        asked.push(`app ${url.searchParams.get('variant') ?? ''}`)
        const response = await route.fetch({ url: route.request().url().replace(/\?.*$/, '') })
        const body = (await response.json()) as Record<string, unknown>
        body.variants = [
          { id: 'default', label: 'Default' },
          { id: 'impaired', label: 'Impaired' },
        ]
        // the app names the variant it answers, the one it was asked for
        body.variant = url.searchParams.get('variant') ?? 'default'
        await route.fulfill({ response, json: body })
      },
    )
    await page.route(
      (url) =>
        url.pathname.startsWith('/api/models/hctz/panels/') && url.searchParams.has('variant'),
      async (route) => {
        const url = new URL(route.request().url())
        asked.push(
          `${url.pathname.split('/').at(-1) ?? ''} ${url.searchParams.get('variant') ?? ''}`,
        )
        await route.continue({ url: route.request().url().replace(/\?.*$/, '') })
      },
    )
    return { asked: () => asked }
  }

  test('draws the navigation, the panels of a page and the footer from the declaration', async ({
    page,
  }) => {
    const app = await openApp(page)
    await expect(app.locator('h1')).toHaveText('Hydrochlorothiazide')
    // the three pages of the demo: the renal function, the dose and a patient
    await expect(app.locator('.nav .tab')).toHaveText(['Renal impairment', 'Dose', 'Patient'])
    await expect(app.locator('.nav .tab[aria-current=page]')).toHaveText('Renal impairment')
    await expect(app.locator('sbmlsim-panel')).toHaveCount(2)
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
    const renal = countRequests(page, '/panels/renal_plasma')
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
    // the declaration of a panel is read by the panel alone: the app says
    // which knobs its pages share
    expect(renal.urls()).toHaveLength(1)
    // the page is the attribute, so it can be linked to
    await expect(app).toHaveAttribute('page', 'dose')
    // and back: the panels are created again and read their declarations again
    await app.locator('.tab', { hasText: 'Renal impairment' }).click()
    await expect(app.locator('sbmlsim-panel')).toHaveCount(2)
    await expect(app.locator('sbmlsim-panel svg path').first()).toBeVisible()
    expect(apps.urls()).toHaveLength(1)
  })

  test('draws one control of a knob the panels of a page share, which moves both plots', async ({
    page,
  }) => {
    const simulations = countSimulations(page)
    const app = await openApp(page)
    const panels = app.locator('sbmlsim-panel')
    await expect(panels.nth(1).locator('svg path').first()).toBeVisible()
    // the renal function and the dose are declared by both panels of the page,
    // so the page has one control of each and the panels have none
    await expect(app.locator('.knobs label')).toHaveText(['renal function', 'dose'])
    await expect(panels.locator('select, input[type=range]')).toHaveCount(0)
    await expect.poll(simulations.count).toBe(2)
    const before = [await curves(panels.nth(0)), await curves(panels.nth(1))]
    await app.locator('.knobs select').first().selectOption({ label: 'impaired' })
    await expect.poll(() => curves(panels.nth(0))).not.toBe(before[0])
    await expect.poll(() => curves(panels.nth(1))).not.toBe(before[1])
    for (const one of await panels.all()) {
      await expect(one).toHaveAttribute('values', '{"egfr":0.4,"dose":25}')
    }
    // the grid of either panel covers the renal function, so the move is read
    // out of it, and the pause is longer than the debounce of a release
    await page.waitForTimeout(500)
    expect(simulations.count()).toBe(2)
  })

  test('draws a shared knob with the control a panel draws', async ({ page }) => {
    /** The geometry and the type of the control of the renal function and its label. */
    const look = (root: Locator): Promise<Record<string, string | number>> =>
      root.locator('#knob-egfr').evaluate((select) => {
        const label = select.closest('.knob')?.querySelector('label')
        if (label === null || label === undefined) {
          throw new Error('the control has no label')
        }
        const of = (one: Element): CSSStyleDeclaration => getComputedStyle(one)
        return {
          height: select.getBoundingClientRect().height,
          font: `${of(select).fontSize} ${of(select).fontFamily}`,
          border: `${of(select).borderTopWidth} ${of(select).borderTopColor}`,
          label: label.textContent.trim(),
          labelHeight: label.getBoundingClientRect().height,
          labelFont: `${of(label).fontSize} ${of(label).color}`,
          gap: select.getBoundingClientRect().top - label.getBoundingClientRect().bottom,
        }
      })
    await page.goto('/demo/docs.html')
    const alone = page.locator('sbmlsim-panel')
    await expect(alone.locator('svg path').first()).toBeVisible()
    const drawn = await look(alone)
    const app = await openApp(page)
    expect(await look(app.locator('.knobs'))).toEqual(drawn)
  })

  test('puts the label of a slider and of a select beside it at one height', async ({ page }) => {
    /** The top of the label and of the control of every knob of a row of controls. */
    const tops = (root: Locator): Promise<number[][]> =>
      root
        .locator('.knob')
        .evaluateAll((all) =>
          all.map((knob) => [
            knob.querySelector('.knob-label')?.getBoundingClientRect().top ?? Number.NaN,
            knob.querySelector('select, .knob-row')?.getBoundingClientRect().top ?? Number.NaN,
            knob.querySelector('select, .knob-row')?.getBoundingClientRect().bottom ?? Number.NaN,
          ]),
        )
    // the dose page shares a slider of the dose and a select of the renal function
    const app = await openApp(page)
    await app.locator('.tab', { hasText: 'Dose' }).click()
    await expect(app.locator('.knobs input[type=range]')).toHaveCount(1)
    const shared = await tops(app.locator('.knobs'))
    expect(shared).toHaveLength(2)
    expect(shared[1]).toEqual(shared[0])
    // and the dose panel alone draws both in its stacked controls
    await page.goto('/demo/plain.html')
    await page.evaluate(() => {
      document.querySelector('sbmlsim-panel')?.remove()
      const one = document.createElement('sbmlsim-panel')
      for (const [name, value] of Object.entries({
        endpoint: '',
        model: 'hctz',
        panel: 'dose_plasma',
        layout: 'stacked',
        auto: '',
      })) {
        one.setAttribute(name, value)
      }
      document.body.append(one)
    })
    const alone = page.locator('sbmlsim-panel')
    await expect(alone.locator('svg path').first()).toBeVisible()
    const stacked = await tops(alone)
    expect(stacked).toHaveLength(2)
    expect(stacked[1]).toEqual(stacked[0])
  })

  for (const width of [390, 768, 1280]) {
    test(`puts a Reset level with the selects of its row and the select of the examples as wide as the control under it at ${String(width)} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      /** The vertical centre of the Reset, or the options, and the boxes of the selects of a row. */
      const row = (
        root: Locator,
        reset: string,
      ): Promise<{ reset: number; selects: { left: number; right: number; centre: number }[] }> =>
        root.evaluate((element, selector) => {
          const scope = element.shadowRoot ?? element
          const centre = (box: DOMRect): number => (box.top + box.bottom) / 2
          const button = scope.querySelector(selector)
          return {
            reset: button === null ? Number.NaN : centre(button.getBoundingClientRect()),
            selects: [...scope.querySelectorAll('select')].map((one) => {
              const box = one.getBoundingClientRect()
              return { left: box.left, right: box.right, centre: centre(box) }
            }),
          }
        }, reset)
      // the patient page: the examples, the clearance with its stops and its
      // slider, the dose, and the Reset of the row
      await page.goto('/demo/app.html')
      await page.evaluate(() => {
        const one = document.querySelector('sbmlsim-app')
        one?.setAttribute('page', 'patient')
      })
      const app = page.locator('sbmlsim-app')
      await expect(app.locator('#scenario')).toBeVisible()
      await expect(app.locator('sbmlsim-panel').nth(1).locator('svg path').first()).toBeVisible()
      const shell = await row(app, '.knobs .reset')
      const [example, stops, dose] = shell.selects
      // the Reset is centred on the line of the selects of its row, the dose's,
      // or on a line of its own under it where the row has no column left for it
      if (width >= 1280) {
        expect(Math.abs(shell.reset - (dose?.centre ?? Number.NaN))).toBeLessThan(0.5)
      } else {
        expect(shell.reset).toBeGreaterThan((dose?.centre ?? 0) + 12)
      }
      // and the select of the examples is as wide as the control under it
      expect(Math.abs((example?.right ?? 0) - (stops?.right ?? 1))).toBeLessThan(0.5)
      expect(Math.abs((example?.left ?? 0) - (stops?.left ?? 1))).toBeLessThan(0.5)
      // a panel alone draws its options level with its selects as well
      await page.goto('/demo/plain.html')
      await page.evaluate(() => {
        document.querySelector('sbmlsim-panel')?.remove()
        const one = document.createElement('sbmlsim-panel')
        for (const [name, value] of Object.entries({
          endpoint: '',
          model: 'hctz',
          panel: 'patient_plasma',
          layout: 'stacked',
          auto: '',
        })) {
          one.setAttribute(name, value)
        }
        document.body.append(one)
      })
      const alone = page.locator('sbmlsim-panel')
      await expect(alone.locator('svg path').first()).toBeVisible()
      const own = await row(alone, '.options .control-line')
      const ownDose = own.selects.at(-1)
      const sameRow = Math.abs(own.reset - (ownDose?.centre ?? Number.NaN)) < 0.5
      // beside the selects, or on a line of its own where the row wraps, never at a slider
      if (width >= 768) {
        expect(sameRow).toBe(true)
      } else if (!sameRow) {
        // on a line of its own it carries no label line: it is one gap of the
        // row below the controls above it
        const gap = await alone.evaluate((element) => {
          const root = element.shadowRoot
          const options = root?.querySelector('.options .control-line')?.getBoundingClientRect()
          const bottoms = [...(root?.querySelectorAll('.controls > .knob .knob-body') ?? [])].map(
            (one) => one.getBoundingClientRect().bottom,
          )
          // the gap between two lines of a row of controls
          const rowGap = Number.parseFloat(
            getComputedStyle(root?.querySelector('.controls') ?? element).getPropertyValue(
              '--_line-gap',
            ),
          )
          return { gap: (options?.top ?? 0) - Math.max(...bottoms), rowGap }
        })
        expect(Math.abs(gap.gap - gap.rowGap)).toBeLessThan(0.5)
      }
    })
  }

  for (const width of [390, 470, 640, 768, 1280]) {
    test(`puts the options and the Reset on the line of the selects, for one to four knobs, at ${String(width)} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      // the knobs of the patient page and of its plasma panel, cut to one or
      // grown to four with choice knobs of their own
      let count = 2
      const extra = (index: number): Record<string, unknown> => ({
        id: `extra${String(index)}`,
        label: `extra knob ${String(index)}`,
        target: null,
        unit: null,
        kind: 'choice',
        min: null,
        max: null,
        steps: 2,
        choices: [
          { label: 'one', value: 1 },
          { label: 'two', value: 2 },
        ],
        default: 1,
      })
      const knobsOf = (given: Record<string, unknown>[]): Record<string, unknown>[] =>
        [...given, ...[0, 1].map(extra)].slice(0, count)
      await page.route(
        (url) => url.pathname === '/api/models/hctz/panels/patient_plasma',
        async (route) => {
          const response = await route.fetch()
          const body = (await response.json()) as Record<string, unknown>
          body.axes = knobsOf(body.axes as Record<string, unknown>[])
          await route.fulfill({ response, json: body })
        },
      )
      await page.route(
        (url) => url.pathname === '/api/models/hctz/app',
        async (route) => {
          const response = await route.fetch()
          const body = (await response.json()) as {
            shared: Record<string, { knob: Record<string, unknown>; panels: unknown[] }[]>
          }
          const shared = body.shared.patient ?? []
          const panels = shared[0]?.panels ?? []
          body.shared.patient = knobsOf(shared.map((one) => one.knob)).map((knob) => ({
            knob,
            panels,
          }))
          await route.fulfill({ response, json: body })
        },
      )
      /**
       * The problems of a row of controls: an item without a label (the
       * options, the Reset) whose line has knobs and which is not centred on
       * the first select of that line, or whose line has none and which does
       * not start at the top of its line.
       */
      const problems = (root: Locator, row: string, item: string): Promise<string[]> =>
        root.evaluate(
          (element, [rowSelector, itemSelector]) => {
            const scope = element.shadowRoot ?? element
            const container = scope.querySelector(rowSelector ?? '')
            const target = scope.querySelector(itemSelector ?? '')
            if (container === null || target === null) {
              return ['no row or no item']
            }
            const line = target.querySelector('.control-line')?.getBoundingClientRect()
            const box = target.getBoundingClientRect()
            const centre = (one: DOMRect): number => (one.top + one.bottom) / 2
            const knobs = [...container.querySelectorAll(':scope > .knob')].filter(
              (one) => Math.abs(one.getBoundingClientRect().top - box.top) < 0.5,
            )
            if (line === undefined) {
              return ['no line']
            }
            if (knobs.length === 0) {
              return Math.abs(line.top - box.top) < 0.5
                ? []
                : [`alone at ${String(line.top - box.top)}`]
            }
            const select = knobs[0]?.querySelector('select, .knob-row')?.getBoundingClientRect()
            const off = select === undefined ? Number.NaN : centre(line) - centre(select)
            return Math.abs(off) < 1 ? [] : [`${String(knobs.length)} knobs, off by ${String(off)}`]
          },
          [row, item],
        )
      const found: string[] = []
      for (count = 1; count <= 4; count += 1) {
        await page.goto('/demo/app.html')
        await page.evaluate(() =>
          document.querySelector('sbmlsim-app')?.setAttribute('page', 'patient'),
        )
        const app = page.locator('sbmlsim-app')
        await expect(app.locator('.knobs .knob:not(.scenario)')).toHaveCount(count)
        for (const one of await problems(app, '.knobs', '.knobs-reset')) {
          found.push(`shell ${String(count)}: ${one}`)
        }
        // the Reset takes no width from a select of its line: the selects of a
        // column are as wide as each other, the last one under the others too
        const columns = await app.evaluate((element) => {
          const widths = new Map<number, number[]>()
          for (const one of element.shadowRoot?.querySelectorAll('.knobs select') ?? []) {
            const box = one.getBoundingClientRect()
            widths.set(Math.round(box.left), [
              ...(widths.get(Math.round(box.left)) ?? []),
              box.width,
            ])
          }
          return [...widths.values()]
        })
        for (const widths of columns) {
          if (Math.max(...widths) - Math.min(...widths) > 0.5) {
            found.push(`shell ${String(count)}: selects of one column ${widths.join(', ')}`)
          }
        }
        await page.goto('/demo/plain.html')
        await page.evaluate(() => {
          document.querySelector('sbmlsim-panel')?.remove()
          const one = document.createElement('sbmlsim-panel')
          for (const [name, value] of Object.entries({
            endpoint: '',
            model: 'hctz',
            panel: 'patient_plasma',
            layout: 'stacked',
            auto: '',
          })) {
            one.setAttribute(name, value)
          }
          document.body.append(one)
        })
        const alone = page.locator('sbmlsim-panel')
        await expect(alone.locator('.knob')).toHaveCount(count)
        for (const one of await problems(alone, '.controls', '.options')) {
          found.push(`panel ${String(count)}: ${one}`)
        }
      }
      expect(found).toEqual([])
    })
  }

  for (const width of [390, 1024, 1280]) {
    test(`fits a card to its panel and a shared control to the page at ${String(width)} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      const app = await openApp(page)
      await expect(app.locator('sbmlsim-panel').nth(1).locator('svg path').first()).toBeVisible()
      const sizes = await app.evaluate((element) => {
        const root = element.shadowRoot
        // the room of a card beyond what its panel draws: between the head and
        // the body, between the body and the foot, and under the foot, each read
        // off the text and not off the boxes, which a row of the grid stretches
        const cells = [...(root?.querySelectorAll('.cell') ?? [])].map((cell) => {
          const inner = cell.querySelector('sbmlsim-panel')?.shadowRoot
          const box = (selector: string): DOMRect | undefined =>
            inner?.querySelector(selector)?.getBoundingClientRect()
          const head = box('.head > :last-child')?.bottom ?? 0
          const body = box('.body')
          const foot = box('.foot > :first-child')?.top ?? 0
          const end = box('.foot > :last-child')?.bottom ?? 0
          const style = getComputedStyle(cell)
          const inside =
            cell.getBoundingClientRect().bottom -
            Number.parseFloat(style.paddingBottom) -
            Number.parseFloat(style.borderBottomWidth)
          return (body?.top ?? 0) - head - 8 + (foot - (body?.bottom ?? 0) - 8) + (inside - end)
        })
        const bar = root?.querySelector('.knobs')
        const knob = root?.querySelector('.knobs .knob')?.getBoundingClientRect().width ?? 0
        const inner = bar
          ? bar.clientWidth -
            Number.parseFloat(getComputedStyle(bar).paddingLeft) -
            Number.parseFloat(getComputedStyle(bar).paddingRight)
          : 0
        return { cells, knob, inner }
      })
      // a card holds its panel and no empty room under it
      for (const left of sizes.cells) {
        expect(left).toBeCloseTo(0, 0)
      }
      // a control fills a phone and stays at 20rem on a wide page
      expect(sizes.knob).toBeCloseTo(Math.min(sizes.inner, 320), 0)
    })
  }

  /** The plot box of every panel of the app and the room between the parts of each. */
  function rows(app: Locator): Promise<
    {
      top: number
      bottom: number
      lines: number
      room: number
      error: boolean
    }[]
  > {
    return app.locator('sbmlsim-panel').evaluateAll((all) =>
      all.map((panel) => {
        const inner = panel.shadowRoot
        const box = (selector: string): DOMRect | undefined =>
          inner?.querySelector(selector)?.getBoundingClientRect()
        const plot = box('g.axis.y .axis-line')
        // the text of the head and not its box, which a row of the grid stretches
        const text = box('.head > :last-child')
        const head = box('.head > :first-child')
        const body = box('.body')
        return {
          top: plot?.top ?? 0,
          bottom: plot?.bottom ?? 0,
          lines: (text?.bottom ?? 0) - (head?.top ?? 0),
          // the room between the head and the body beyond the gap of the panel
          room: (body?.top ?? 0) - (text?.bottom ?? 0) - 8,
          error: inner?.querySelector('.error') !== null,
        }
      }),
    )
  }

  /** Give the subtitle of the urine panel more lines than the one of the plasma panel. */
  async function longerUrineSubtitle(page: Page): Promise<void> {
    // as the apixaban panels have between 1060 and 1180 px; the service is untouched
    await page.route('**/api/models/hctz/panels/renal_urine', async (route) => {
      const response = await route.fetch()
      const body = (await response.json()) as { panel: Record<string, string> }
      body.panel.subtitle = `${body.panel.subtitle ?? ''}, ${'and more words of it '.repeat(6)}`
      await route.fulfill({ response, json: body })
    })
  }

  for (const width of [390, 1280]) {
    test(`lines up the plots of a row whose titles take other lines at ${String(width)} px`, async ({
      page,
    }) => {
      await longerUrineSubtitle(page)
      await page.setViewportSize({ width, height: 900 })
      const app = await openApp(page)
      await expect(app.locator('sbmlsim-panel').nth(1).locator('svg path').first()).toBeVisible()
      const [plasma, urine] = await rows(app)
      if (plasma === undefined || urine === undefined) {
        throw new Error('the page has two panels')
      }
      // the heads differ by lines either way
      expect(urine.lines - plasma.lines).toBeGreaterThan(15)
      if (width === 1280) {
        expect(Math.abs(urine.top - plasma.top)).toBeLessThan(0.5)
        expect(Math.abs(urine.bottom - plasma.bottom)).toBeLessThan(0.5)
        // the plasma panel takes the lines it lacks as room above its body
        expect(plasma.room).toBeCloseTo(urine.lines - plasma.lines, 0)
        expect(urine.room).toBeCloseTo(0, 0)
      } else {
        // one column: every card is as tall as its own panel and has no room to place
        expect(plasma.room).toBeCloseTo(0, 0)
        expect(urine.room).toBeCloseTo(0, 0)
      }
    })
  }

  test('lines up the plots of a row when one has an error line under it', async ({ page }) => {
    await longerUrineSubtitle(page)
    // the second run of the plasma panel fails, and every one after it
    let runs = 0
    await page.route('**/panels/renal_plasma/simulate', async (route) => {
      runs += 1
      await (runs > 1 ? route.abort() : route.continue())
    })
    await page.setViewportSize({ width: 1280, height: 900 })
    const app = await openApp(page)
    const panels = app.locator('sbmlsim-panel')
    await expect(panels.nth(1).locator('svg path').first()).toBeVisible()
    const dose = app.locator('.knobs select').nth(1)
    // a dose the plasma panel cannot run, and back to the one it drew: it draws
    // that figure again with the line of its failure under it
    await dose.selectOption({ label: '50 mg' })
    await expect(panels.nth(0).locator('.error')).toContainText('cannot be drawn')
    await expect(panels.nth(0).locator('svg path')).toHaveCount(0)
    await dose.selectOption({ label: '25 mg' })
    await expect(panels.nth(0).locator('svg path').first()).toBeVisible()
    await expect(panels.nth(0).locator('.error')).toBeVisible()
    const [plasma, urine] = await rows(app)
    if (plasma === undefined || urine === undefined) {
      throw new Error('the page has two panels')
    }
    expect(plasma.error).toBe(true)
    expect(urine.error).toBe(false)
    expect(Math.abs(urine.top - plasma.top)).toBeLessThan(0.5)
    expect(Math.abs(urine.bottom - plasma.bottom)).toBeLessThan(0.5)
  })

  test('lines up the plot of a panel without a head with the plots beside it', async ({ page }) => {
    // a panel whose declaration names neither a title nor a subtitle draws no
    // head, and its body and its foot keep their rows of the grid
    await page.route('**/api/models/hctz/panels/renal_urine', async (route) => {
      const response = await route.fetch()
      const body = (await response.json()) as { panel: Record<string, string> }
      body.panel.title = ''
      body.panel.subtitle = ''
      await route.fulfill({ response, json: body })
    })
    await page.setViewportSize({ width: 1280, height: 900 })
    const app = await openApp(page)
    const panels = app.locator('sbmlsim-panel')
    await expect(panels.nth(1).locator('svg path').first()).toBeVisible()
    await expect(panels.nth(1).locator('.head')).toHaveCount(0)
    const [plasma, urine] = await rows(app)
    if (plasma === undefined || urine === undefined) {
      throw new Error('the page has two panels')
    }
    expect(Math.abs(urine.top - plasma.top)).toBeLessThan(0.5)
    const order = await panels.nth(1).evaluate((element) => {
      const inner = element.shadowRoot
      const body = inner?.querySelector('.body')?.getBoundingClientRect()
      const foot = inner?.querySelector('.foot')?.getBoundingClientRect()
      return (foot?.top ?? 0) - (body?.bottom ?? 0)
    })
    expect(order).toBeCloseTo(8, 0)
  })

  /**
   * Heads which wrap to several lines and differ between the two panels of a
   * row, so the head row of a card is as tall as the tallest of them.
   */
  const LONG_HEADS: Record<string, { title: string; subtitle: string }> = {
    renal_plasma: {
      title: 'Plasma concentration of the drug over the renal function of the patient',
      subtitle:
        'How the concentration in the plasma follows the renal function after a single oral dose, from a normal function down to an impaired one, as the studies of the model measured it.',
    },
    renal_urine: {
      title: 'Urinary excretion over the renal function',
      subtitle:
        'How much of the dose reaches the urine, and how much later, as the function of the kidneys falls from normal to impaired, for every dose of the studies, after a single oral dose of the drug and over the two days after it.',
    },
  }

  for (const [width, long] of [
    [390, false],
    [1280, false],
    [390, true],
    [1280, true],
  ] as const) {
    const heads = long ? ', with heads of several lines' : ''
    test(`moves nothing while the panels load at ${String(width)} px${heads}`, async ({ page }) => {
      if (long) {
        // the app and the declarations name the same heads, as the service
        // derives both from the panels
        await page.route('**/api/models/hctz/app', async (route) => {
          const response = await route.fetch()
          const body = (await response.json()) as {
            heads: Record<string, { id: string; title: string; subtitle: string }[]>
          }
          for (const one of Object.values(body.heads).flat()) {
            Object.assign(one, LONG_HEADS[one.id] ?? {})
          }
          await route.fulfill({ response, json: body })
        })
      }
      // the service answers before the first paint, so its answers are held
      // back as a remote one holds them: the declarations 400 ms, the runs 300 ms
      await page.route(/\/panels\/[^/]+$/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 400))
        if (!long) {
          await route.continue()
          return
        }
        const response = await route.fetch()
        const body = (await response.json()) as { panel: { id: string } }
        Object.assign(body.panel, LONG_HEADS[body.panel.id] ?? {})
        await route.fulfill({ response, json: body })
      })
      await page.route('**/simulate', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 300))
        await route.continue()
      })
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/demo/app.html')
      // where the second card and the footer are on every frame until both
      // figures are drawn, from the frame the grid is first laid out
      const tops = await page.evaluate(
        () =>
          new Promise<string[]>((done) => {
            const seen: string[] = []
            const tick = (): void => {
              const root = document.querySelector('sbmlsim-app')?.shadowRoot
              const cells = [...(root?.querySelectorAll('.cell') ?? [])]
              const footer = root?.querySelector('.footer')
              const drawn = [...(root?.querySelectorAll('sbmlsim-panel') ?? [])].filter(
                (one) => one.shadowRoot?.querySelector('svg') !== null,
              ).length
              if (cells.length === 2 && footer) {
                const key = `${String(cells[1]?.getBoundingClientRect().top)} ${String(footer.getBoundingClientRect().top)}`
                if (seen.at(-1) !== key) {
                  seen.push(key)
                }
              }
              if (drawn === 2) {
                done(seen)
                return
              }
              requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          }),
      )
      expect(tops).toHaveLength(1)
    })
  }

  test('keeps the focus on a shared Reset it was pressed with', async ({ page }) => {
    const app = await openApp(page)
    await app.locator('.knobs select').first().selectOption({ label: 'impaired' })
    const reset = app.locator('.knobs button.reset')
    await reset.focus()
    await page.keyboard.press('Enter')
    await expect(app.locator('.knobs select').first()).toHaveValue('1')
    await expect(reset).toHaveAttribute('aria-disabled', 'true')
    // the focus is still on the button, which says it has nothing left to do
    expect(
      await app.evaluate((element) => element.shadowRoot?.activeElement?.className ?? null),
    ).toBe('reset')
  })

  test('draws no figure of the variant before when the run of a switch fails', async ({ page }) => {
    const reads = await twoVariants(page)
    // the service knows one variant: the plasma panel cannot run the other,
    // which fails once the test lets it, the urine panel is answered without it
    let fail: (() => void) | null = null
    const failing = new Promise<void>((resolve) => {
      fail = resolve
    })
    await page.route('**/simulate', async (route) => {
      const request = route.request()
      const sent = request.postDataJSON() as Record<string, unknown>
      if (request.url().includes('renal_plasma') && sent.variant === 'impaired') {
        await failing
        await route.abort()
        return
      }
      await route.continue({ postData: JSON.stringify({ values: sent.values, grid: sent.grid }) })
    })
    const app = await openApp(page)
    const panels = app.locator('sbmlsim-panel')
    await expect(panels.nth(1).locator('svg path').first()).toBeVisible()
    await app.locator('.variant-select').selectOption('impaired')
    // while its run is pending the panel holds the figure of the variant
    // before, dimmed and inert, and draws none as a figure of the variant shown
    await expect(panels.nth(0).locator('.held svg path').first()).toBeAttached()
    await expect(panels.nth(0).locator('.plot')).toHaveCount(0)
    expect(reads.asked()).toContain('renal_plasma impaired')
    ;(fail as unknown as () => void)()
    await expect(panels.nth(0).locator('.error')).toContainText('cannot be drawn')
    // the failure drops it at once
    await expect(panels.nth(0).locator('svg path')).toHaveCount(0)
    await expect(panels.nth(0).locator('.provenance')).toHaveCount(0)
    await expect(panels.nth(1).locator('svg path').first()).toBeVisible()
    // back on the variant it drew, it draws it again
    await app.locator('.variant-select').selectOption('default')
    await expect(panels.nth(0).locator('svg path').first()).toBeVisible()
  })

  test('a panel whose run failed follows the shared controls once it runs again', async ({
    page,
  }) => {
    let failing = false
    await page.route('**/panels/renal_plasma/simulate', async (route) => {
      await (failing ? route.abort() : route.continue())
    })
    const app = await openApp(page)
    const panels = app.locator('sbmlsim-panel')
    await expect(panels.nth(1).locator('svg path').first()).toBeVisible()
    const [renal, dose] = [app.locator('.knobs select').nth(0), app.locator('.knobs select').nth(1)]
    failing = true
    await dose.selectOption({ label: '50 mg' })
    await expect(panels.nth(0).locator('.error')).toContainText('cannot be drawn')
    // the panel draws no figure of a state the controls do not show, also
    // where the grid it holds covers the knob which moves
    await renal.selectOption({ label: 'impaired' })
    await expect(panels.nth(0).locator('svg path')).toHaveCount(0)
    failing = false
    await renal.selectOption({ label: 'normal' })
    await expect(panels.nth(0).locator('svg path').first()).toBeVisible()
    await expect(panels.nth(0).locator('.error')).toHaveCount(0)
    // its figure is the one a panel alone of its width draws at that state
    const shown = await panels
      .nth(0)
      .locator('svg path')
      .evaluateAll((all) => all.map((one) => one.getAttribute('d') ?? '').join('|'))
    const width = await panels.nth(0).evaluate((element) => element.getBoundingClientRect().width)
    await page.goto('/demo/plain.html')
    await page.evaluate((wide) => {
      document.querySelector('sbmlsim-panel')?.remove()
      const one = document.createElement('sbmlsim-panel')
      one.style.width = `${String(wide)}px`
      for (const [name, value] of Object.entries({
        endpoint: '',
        model: 'hctz',
        panel: 'renal_plasma',
        values: '{"egfr":1,"dose":50}',
        auto: '',
      })) {
        one.setAttribute(name, value)
      }
      document.body.append(one)
    }, width)
    const alone = page.locator('sbmlsim-panel')
    await expect(alone.locator('svg path').first()).toBeVisible()
    await expect
      .poll(() =>
        alone
          .locator('svg path')
          .evaluateAll((all) => all.map((one) => one.getAttribute('d') ?? '').join('|')),
      )
      .toBe(shown)
  })

  test('keeps the shared controls of a page whose panel cannot be read', async ({ page }) => {
    await page.route('**/api/models/hctz/panels/renal_urine', (route) => route.abort())
    const app = await openApp(page)
    await expect(app.locator('.knobs label')).toHaveText(['renal function', 'dose'])
    await expect(app.locator('sbmlsim-panel').nth(0).locator('select')).toHaveCount(0)
    await expect(app.locator('sbmlsim-panel').nth(1).locator('.error')).toBeVisible()
  })

  test('sends the chosen variant to every panel of the page', async ({ page }) => {
    // the HCTZ project has one SBML file, so the app declares one variant; the
    // wire is what is under test here, so the declaration is given two and the
    // service, which knows only the one, answers the simulations without it
    await twoVariants(page)
    const sent: (string | undefined)[] = []
    await page.route('**/simulate', async (route) => {
      const request = route.request().postDataJSON() as Record<string, unknown>
      sent.push(request.variant as string | undefined)
      await route.continue({
        postData: JSON.stringify({ values: request.values, grid: request.grid }),
      })
    })
    const app = await openApp(page)
    await expect.poll(() => sent.length).toBe(2)
    expect(sent).toEqual(['default', 'default'])
    await app.locator('.tab', { hasText: 'Dose' }).click()
    await expect(app.locator('sbmlsim-panel')).toHaveCount(2)
    await expect.poll(() => sent.length).toBe(4)
    expect(sent.slice(2)).toEqual(['default', 'default'])
    await app.locator('.variant-select').selectOption('impaired')
    await expect.poll(() => sent.length).toBe(6)
    expect(sent.slice(4)).toEqual(['impaired', 'impaired'])
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
    // every page of the HCTZ app shows two panels, since a panel draws one
    // quantity; the layout of a page of one panel is what is under test, so
    // the declaration is given such a page and the service is untouched
    await page.route('**/api/models/hctz/app', async (route) => {
      const response = await route.fetch()
      const body = (await response.json()) as Record<string, unknown>
      const pages = body.pages as Record<string, unknown>[]
      body.pages = [{ ...pages[0], panels: ['renal_plasma'] }]
      await route.fulfill({ response, json: body })
    })
    await page.setViewportSize({ width: 1280, height: 900 })
    const app = await openApp(page)
    await expect(app.locator('sbmlsim-panel')).toHaveCount(1)
    const widths = await app.evaluate((element) => {
      const root = element.shadowRoot
      const cell = root?.querySelector('.cell')?.getBoundingClientRect()
      const grid = root?.querySelector('.grid')?.getBoundingClientRect()
      return { cell: cell?.width ?? 0, grid: grid?.width ?? 0 }
    })
    expect(widths.cell).toBeCloseTo(widths.grid, 0)
  })
})

test.describe('the page of a patient', () => {
  /** Open the app on a page of a model and wait until both of its plots are drawn. */
  async function openPage(page: Page, model: string, id: string): Promise<Locator> {
    // the shell of the demo page is replaced by one of the model and the page,
    // so nothing of the app of another model is ever drawn on it
    await page.goto('/demo/app.html')
    await page.evaluate(
      ({ name, shown }) => {
        document.querySelector('sbmlsim-app')?.remove()
        const one = document.createElement('sbmlsim-app')
        for (const [attribute, value] of Object.entries({
          endpoint: '',
          model: name,
          page: shown,
        })) {
          one.setAttribute(attribute, value)
        }
        document.body.append(one)
      },
      { name: model, shown: id },
    )
    const app = page.locator('sbmlsim-app')
    await expect(app.locator('sbmlsim-panel').nth(1).locator('svg path').first()).toBeVisible()
    await expect(app.locator('sbmlsim-panel').nth(0).locator('svg path').first()).toBeVisible()
    return app
  }

  /** The axes of the figures of a page: every axis line and tick, which are where a figure is laid out. */
  function axesOf(app: Locator): Promise<string[]> {
    return app
      .locator('sbmlsim-panel')
      .evaluateAll((all) =>
        all.map((one) =>
          [...(one.shadowRoot?.querySelectorAll('svg .axis') ?? [])]
            .map((axis) => axis.outerHTML)
            .join(''),
        ),
      )
  }

  /** The curves of every figure of a page. */
  function curvesOf(app: Locator): Promise<string[]> {
    return app
      .locator('sbmlsim-panel')
      .evaluateAll((all) =>
        all.map((one) =>
          [...(one.shadowRoot?.querySelectorAll('svg path.curve') ?? [])]
            .map((path) => path.getAttribute('d') ?? '')
            .join('|'),
        ),
      )
  }

  test('picks a scenario, which moves both plots, the select of the stops and the slider', async ({
    page,
  }) => {
    // the runs of the patient page, not of the page the demo opens on first
    let runs = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/panels/patient_')) {
        runs += 1
      }
    })
    const simulations = { count: (): number => runs }
    const app = await openPage(page, 'hctz', 'patient')
    await expect.poll(simulations.count).toBe(2)
    const scenario = app.locator('#scenario')
    // the defaults are the healthy patient of 25 mg
    await expect(scenario).toHaveValue('healthy')
    await expect(app.locator('.knobs label').first()).toHaveText('Example')
    const before = await curvesOf(app)
    await scenario.selectOption({ label: 'severe impairment, 12.5 mg' })
    await expect.poll(async () => (await curvesOf(app))[0]).not.toBe(before[0])
    await expect.poll(async () => (await curvesOf(app))[1]).not.toBe(before[1])
    await expect(app.locator('#knob-crcl-stops')).toHaveValue('20')
    await expect(app.locator('#knob-crcl')).toHaveValue('20')
    await expect(app.locator('#knob-dose')).toHaveValue('12.5')
    for (const one of await app.locator('sbmlsim-panel').all()) {
      await expect(one).toHaveAttribute('values', '{"crcl":20,"dose":12.5}')
    }
    // one state: one run per panel for both knobs, and the pause is longer
    // than the debounce of a release
    await page.waitForTimeout(500)
    expect(simulations.count()).toBe(4)
    // a knob moved away from the scenario leaves it, which is no pick
    await app.locator('#knob-crcl-stops').selectOption({ label: 'mild impairment' })
    await expect(scenario).toHaveValue('')
    await expect(scenario.locator('option[value=""]')).toHaveText('custom')
    await expect(scenario.locator('option[value=""]')).toBeDisabled()
    // and Reset brings the defaults back, which the select follows
    await app.locator('.knobs button.reset').click()
    await expect(scenario).toHaveValue('healthy')
  })

  test('keeps the select of the stops and the slider in step', async ({ page }) => {
    const app = await openPage(page, 'hctz', 'patient')
    const stops = app.locator('#knob-crcl-stops')
    const slider = app.locator('#knob-crcl')
    await expect(stops).toHaveValue('110')
    await stops.selectOption({ label: 'moderate impairment' })
    await expect(slider).toHaveValue('45')
    await expect(app.locator('.knobs .knob-value').first()).toHaveText('45')
    // a step of the slider off the stop is no stop, and a step back is it again
    await slider.focus()
    await page.keyboard.press('ArrowRight')
    await expect(slider).toHaveValue('46')
    await expect(stops).toHaveValue('custom')
    await page.keyboard.press('ArrowLeft')
    await expect(slider).toHaveValue('45')
    await expect(stops).toHaveValue('45')
    // both are reached with the keyboard and named for a screen reader
    const names = await app.evaluate((element) => {
      const root = element.shadowRoot
      const name = (id: string): string =>
        (root?.getElementById(id)?.getAttribute('aria-labelledby') ?? '')
          .split(' ')
          .map((one) => root?.getElementById(one)?.textContent.trim() ?? '')
          .join(' ')
      return {
        stops: name('knob-crcl-stops'),
        slider: root?.querySelector('label[for="knob-crcl"]')?.textContent.trim() ?? '',
      }
    })
    expect(names).toEqual({
      stops: 'creatinine clearance [ml/min] named value',
      slider: 'creatinine clearance [ml/min]',
    })
  })

  test('holds the axes of its plots still as the knobs move', async ({ page }) => {
    const app = await openPage(page, 'hctz', 'patient')
    const axes = await axesOf(app)
    // the declared ends: 0 to 2 uM, 0 to 100 umol, 24 h
    expect(axes[0]).toContain('>2<')
    expect(axes[1]).toContain('>100<')
    const before = await curvesOf(app)
    await app.locator('#knob-crcl-stops').selectOption({ label: 'kidney failure' })
    await expect.poll(async () => (await curvesOf(app))[0]).not.toBe(before[0])
    expect(await axesOf(app)).toEqual(axes)
    const failing = await curvesOf(app)
    await app.locator('#knob-dose').selectOption({ label: '50 mg' })
    await expect.poll(async () => (await curvesOf(app))[0]).not.toBe(failing[0])
    expect(await axesOf(app)).toEqual(axes)
    const heavy = await curvesOf(app)
    await app.locator('#scenario').selectOption({ label: 'healthy, 25 mg' })
    await expect.poll(async () => (await curvesOf(app))[0]).not.toBe(heavy[0])
    expect(await axesOf(app)).toEqual(axes)
  })

  test('holds the figures of the variant before, dimmed under a caption, until the new ones are drawn', async ({
    page,
  }) => {
    // the app of the variant and the runs of it are held back until the test
    // lets them go, so the switch is seen half way
    const gates: Record<string, () => void> = {}
    const gate = (name: string): Promise<void> =>
      new Promise((resolve) => {
        gates[name] = resolve
      })
    const appRead = gate('app')
    const declarations = gate('declarations')
    const runs = gate('runs')
    await page.route(
      (url) => url.pathname.endsWith('/app') && url.searchParams.get('variant') === 'low_reference',
      async (route) => {
        await appRead
        await route.continue()
      },
    )
    await page.route(
      (url) =>
        url.pathname.includes('/panels/') &&
        !url.pathname.endsWith('/data') &&
        url.searchParams.get('variant') === 'low_reference',
      async (route) => {
        await declarations
        await route.continue()
      },
    )
    await page.route('**/simulate', async (route) => {
      const sent = route.request().postDataJSON() as Record<string, unknown>
      if (sent.variant === 'low_reference') {
        await runs
      }
      await route.continue()
    })
    const app = await openPage(page, 'hctz_variants', 'patient')
    const cells = (): Promise<string> =>
      app
        .locator('.cell')
        .evaluateAll((all) =>
          all.map((one) => JSON.stringify(one.getBoundingClientRect().toJSON())).join('|'),
        )
    // every box of the page above the footer, which a caption must not move
    const boxes = async (): Promise<string> =>
      `${await cells()}|${await app.evaluate((element) =>
        ['.bar', '.knobs', '.grid', '.variant', '.switch-caption']
          .map((one) =>
            JSON.stringify(
              element.shadowRoot?.querySelector(one)?.getBoundingClientRect().toJSON(),
            ),
          )
          .join('|'),
      )}`
    const before = await boxes()
    const first = await curvesOf(app)
    const caption = app.locator('.variant .caption')
    const line = app.locator('.footer .simulated')
    await expect(caption).toHaveText('')
    const provenance = await line.textContent()
    await app.locator('.variant-select').selectOption({ label: 'reference 90 ml/min' })
    // the app of the variant is read: the figures before stay, dimmed, inert
    // and hidden from a reader, under the caption which names the variant
    await expect(caption).toHaveText('Switching to reference 90 ml/min …')
    for (const one of await app.locator('sbmlsim-panel').all()) {
      await expect(one).toHaveAttribute('inert', '')
      await expect(one).toHaveAttribute('aria-hidden', 'true')
    }
    expect(await curvesOf(app)).toEqual(first)
    expect(await boxes()).toBe(before)
    // the provenance of the figures before stays, dimmed as they are
    await expect(line).toHaveText(provenance ?? '')
    await expect(line).toHaveClass(/held/)
    gates.app?.()
    // the app of the variant names the heads of its panels, which the cards
    // show at once, while the panels still read their declarations
    await expect(app.locator('sbmlsim-panel .title')).toHaveText([
      'Plasma concentration of a patient (reference 90 ml/min)',
      'Urinary excretion of a patient (reference 90 ml/min)',
    ])
    expect(await boxes()).toBe(before)
    gates.declarations?.()
    // the panels read their declarations of the variant and hold the figures
    // before until their runs answer
    await expect(app.locator('sbmlsim-panel .title').first()).toHaveText(
      'Plasma concentration of a patient (reference 90 ml/min)',
    )
    for (const one of await app.locator('sbmlsim-panel').all()) {
      await expect(one.locator('.held svg path').first()).toBeAttached()
      await expect(one.locator('.plot')).toHaveCount(0)
      await expect(one).not.toHaveAttribute('inert')
    }
    await expect(caption).toHaveText('Switching to reference 90 ml/min …')
    expect(await boxes()).toBe(before)
    await expect(line).toHaveClass(/held/)
    gates.runs?.()
    await expect(app.locator('sbmlsim-panel .held')).toHaveCount(0)
    await expect(
      app.locator('sbmlsim-panel').nth(0).locator('.plot svg path').first(),
    ).toBeVisible()
    await expect(
      app.locator('sbmlsim-panel').nth(1).locator('.plot svg path').first(),
    ).toBeVisible()
    await expect(caption).toHaveText('')
    expect(await boxes()).toBe(before)
    await expect(line).not.toHaveClass(/held/)
  })

  test('keeps the height of a panel alone while it is switched to another variant', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 900 })
    let release: (() => void) | null = null
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(
      (url) =>
        url.pathname.includes('/panels/') && url.searchParams.get('variant') === 'low_reference',
      async (route) => {
        await held
        await route.continue()
      },
    )
    await page.goto('/demo/plain.html')
    await page.evaluate(() => {
      document.querySelector('sbmlsim-panel')?.remove()
      const one = document.createElement('sbmlsim-panel')
      for (const [name, value] of Object.entries({
        endpoint: '',
        model: 'hctz_variants',
        panel: 'patient_plasma',
        variant: 'default',
        auto: '',
      })) {
        one.setAttribute(name, value)
      }
      document.body.append(one)
    })
    const alone = page.locator('sbmlsim-panel')
    await expect(alone.locator('.plot svg path').first()).toBeVisible()
    // the height of the panel on every frame from the switch until its new figure
    await page.evaluate(() => {
      const panel = document.querySelector('sbmlsim-panel')
      const heights: number[] = []
      ;(window as unknown as { heights: number[] }).heights = heights
      const tick = (): void => {
        heights.push(panel?.getBoundingClientRect().height ?? 0)
        if (heights.length < 2000) {
          requestAnimationFrame(tick)
        }
      }
      requestAnimationFrame(tick)
      panel?.setAttribute('variant', 'low_reference')
    })
    await page.waitForTimeout(500)
    // the head, the controls and the provenance of the variant before stay
    await expect(alone.locator('.held svg path').first()).toBeAttached()
    await expect(alone.locator('.provenance.held')).toHaveCount(1)
    ;(release as unknown as () => void)()
    await expect(alone.locator('.plot svg path').first()).toBeVisible()
    await page.waitForTimeout(300)
    const heights = await page.evaluate(() => (window as unknown as { heights: number[] }).heights)
    expect(heights.length).toBeGreaterThan(10)
    expect(new Set(heights).size).toBe(1)
  })

  test('switches the declaration on screen with the variant', async ({ page }) => {
    const app = await openPage(page, 'hctz_variants', 'patient')
    const titles = app.locator('sbmlsim-panel .title')
    await expect(titles).toHaveText([
      'Plasma concentration of a patient',
      'Urinary excretion of a patient',
    ])
    // a clearance below both references, so the two derive other renal functions
    await app.locator('#scenario').selectOption({ label: 'moderate impairment, 25 mg' })
    await expect(app.locator('#knob-crcl')).toHaveValue('45')
    await expect(app.locator('sbmlsim-panel').nth(0)).toHaveAttribute(
      'values',
      '{"crcl":45,"dose":25}',
    )
    await expect.poll(async () => (await curvesOf(app))[0]).not.toBe('')
    const first = await curvesOf(app)
    await app.locator('.variant-select').selectOption({ label: 'reference 90 ml/min' })
    await expect(titles).toHaveText([
      'Plasma concentration of a patient (reference 90 ml/min)',
      'Urinary excretion of a patient (reference 90 ml/min)',
    ])
    // the heads of the cards are the ones of that variant, and the knobs keep
    // the values which are values of the knobs of that variant
    await expect(app.locator('.reserve-title')).toHaveText([
      'Plasma concentration of a patient (reference 90 ml/min)',
      'Urinary excretion of a patient (reference 90 ml/min)',
    ])
    await expect(app.locator('#knob-crcl')).toHaveValue('45')
    await expect.poll(async () => (await curvesOf(app))[0]).not.toBe('')
    await expect.poll(async () => (await curvesOf(app))[0]).not.toBe(first[0])
    // and back, to the declaration and the curves of the first variant
    await app.locator('.variant-select').selectOption({ label: 'reference 110 ml/min' })
    await expect(titles).toHaveText([
      'Plasma concentration of a patient',
      'Urinary excretion of a patient',
    ])
    await expect.poll(async () => (await curvesOf(app))[0]).toBe(first[0])
  })
})
