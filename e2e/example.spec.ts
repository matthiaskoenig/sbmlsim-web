import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

// The glimepiride example of the documentation (`docs/examples/glimepiride`), which
// `scripts/stage-demo.mjs` stages next to the demo. The page is static files - the bundle of
// the app, the engine of sbmlsim-core and the kernel of pkpdutils, all of them in the page -
// so the endpoint of these tests serves it and answers nothing of it.
//
// What is tested here is what no unit test reaches: the table of the parameters (`nca.mjs`)
// against the panels of a real browser, over the event which crosses the shadow root of the
// app and the WebAssembly module which analyses the curves, and the draws of the uncertainty of
// the fit - the band of the figures and the spread of the parameters - which are runs of the
// model in the page.

/** The page of the example. */
const PAGE = '/examples/glimepiride/app.html'

/** The row of a parameter of the table, by the name in its first cell. */
function parameter(page: Page, name: string): Locator {
  return page
    .locator('#pk-parameters tbody tr')
    .filter({ has: page.getByRole('rowheader', { name, exact: true }) })
}

/** The cell of one analyte of a row. */
function cell(row: Locator, analyte: number): Locator {
  return row.locator('td.pk-value').nth(analyte)
}

/** The number of one analyte of a row, as the table shows it. */
async function value(row: Locator, analyte: number): Promise<number> {
  return Number(await cell(row, analyte).locator('.pk-point').textContent())
}

test.describe('the glimepiride example', () => {
  test('analyses the curves it draws, in the page', async ({ page }) => {
    await page.goto(PAGE)
    const cmax = parameter(page, 'Cmax')
    // the first scan of the app fills the three columns of the table
    await expect(cell(cmax, 2).locator('.pk-point')).not.toHaveText('…', { timeout: 30_000 })

    // the peak of a 4 mg dose of the model, the one its figure draws, and the metabolites
    // under it; a row of the second block says what the terminal regression stood on
    expect(await value(cmax, 0)).toBeCloseTo(0.551, 2)
    expect(await value(cmax, 1)).toBeCloseTo(0.0707, 3)
    expect(await value(cmax, 2)).toBeCloseTo(0.041, 3)
    expect(await value(parameter(page, 'tmax'), 0)).toBeCloseTo(2.1, 1)
    await expect(parameter(page, 'terminal window').locator('td.pk-value').first()).toContainText(
      '50.0',
    )
    await expect(page.locator('#pk-parameters .pk-note')).toContainText('4.00 mg glimepiride')

    // the dose of the app is the knob its run grids over: moving it draws another curve out of
    // the grid and simulates nothing, and the table follows it all the same. The model is
    // linear in the dose, so half again the dose is half again the peak
    // the draws of the page are runs of their own and the only ones a movement may cost
    const simulations: (number | undefined)[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/simulate')) {
        simulations.push((request.postDataJSON() as { draws?: number }).draws)
      }
    })
    const before = await value(cmax, 0)
    await page.locator('sbmlsim-app').evaluate((app) => {
      const knob = app.shadowRoot?.querySelector<HTMLInputElement>('#knob-dose')
      if (knob === null || knob === undefined) {
        throw new Error('the app draws no dose knob')
      }
      knob.value = '6'
      knob.dispatchEvent(new Event('input', { bubbles: true }))
      knob.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect(page.locator('#pk-parameters .pk-note')).toContainText('6.00 mg glimepiride')
    expect(await value(cmax, 0)).toBeCloseTo(1.5 * before, 2)
    // no panel ran anything: every simulation of the movement is a request of the draws of the
    // page, which the grid of a panel does not carry
    expect(simulations.filter((draws) => draws === undefined)).toEqual([])
  })

  test('shades the draws of the fit and states their spread', async ({ page }) => {
    await page.goto(PAGE)
    const cmax = parameter(page, 'Cmax')
    await expect(cell(cmax, 2).locator('.pk-point')).not.toHaveText('…', { timeout: 30_000 })

    // the draws are one number and its one control is the field of the settings card of the app:
    // the table has none of its own and follows the draws the panels ran with
    await expect(page.locator('#pk-draws')).toHaveCount(0)
    const draws = page.locator('sbmlsim-app input.draws')
    await expect(draws).toBeVisible()
    await expect(draws).toHaveValue('16')
    // a number of four digits fits the field beside its spin buttons: the client width of a
    // number input already leaves the spin buttons out, and the room is at least that text
    const room = await draws.evaluate((input: HTMLInputElement) => {
      const style = getComputedStyle(input)
      const probe = document.createElement('span')
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${style.font}`
      probe.textContent = '1000'
      document.body.append(probe)
      const text = probe.getBoundingClientRect().width
      probe.remove()
      const inner =
        input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      return { text, inner }
      return { text, inner }
    })
    expect(room.inner).toBeGreaterThanOrEqual(room.text)

    // every figure of the app shades the band of those draws under its curve
    await expect(page.locator('sbmlsim-app .curve-band').first()).toBeAttached({
      timeout: 60_000,
    })
    expect(await page.locator('sbmlsim-app .curve-band').count()).toBeGreaterThanOrEqual(4)

    // and every cell of the table carries the spread of the draws and their box
    const peak = cell(cmax, 0)
    await expect(peak.locator('.pk-spread')).toContainText('±', { timeout: 60_000 })
    await expect(peak.locator('svg.pk-box rect')).toHaveCount(4)
    await expect(peak).toHaveAttribute('title', /16 draws: median/)
    // and the coefficient of variation of the draws, the standard deviation over their mean
    await expect(peak.locator('.pk-cv')).toContainText(/^CV \d/)
    const note = page.locator('#pk-parameters .pk-note')
    await expect(note).toContainText('standard deviation of 16 draws')
    await expect(note).toContainText('90.0 % band')
    // the spread of a peak of this fit is a few percent of it and never zero
    const spread = Number((await peak.locator('.pk-spread').textContent())?.replace('± ', ''))
    expect(spread).toBeGreaterThan(0)
    expect(spread).toBeLessThan(await value(cmax, 0))

    // a reader who asks for more draws gets them, and for none gets no band at all
    await draws.fill('32')
    await draws.dispatchEvent('change')
    await expect(note).toContainText('standard deviation of 32 draws', { timeout: 60_000 })
    await draws.fill('0')
    await draws.dispatchEvent('change')
    await expect(note).toContainText('set the draws in the settings above the panels', {
      timeout: 60_000,
    })
    await expect(peak.locator('.pk-spread')).toHaveCount(0)
    await expect(page.locator('sbmlsim-app .curve-band')).toHaveCount(0, { timeout: 60_000 })
  })

  test('takes the table away while the app shows its information', async ({ page }) => {
    await page.goto(PAGE)
    const cmax = parameter(page, 'Cmax')
    await expect(cell(cmax, 2).locator('.pk-point')).not.toHaveText('…', { timeout: 30_000 })
    const table = page.locator('#pk-parameters')
    await expect(table).toBeVisible()

    // the table is of the plasma curves above it, which the information view does not show
    await page.locator('sbmlsim-app [part="information-tab"]').click()
    await expect(table).toBeHidden()

    // and it comes back with the next page the reader opens
    await page.locator('sbmlsim-app button.tab:not(.information-tab)').first().click()
    await expect(table).toBeVisible()
    await expect(cell(cmax, 2).locator('.pk-point')).not.toHaveText('…')
  })
})
