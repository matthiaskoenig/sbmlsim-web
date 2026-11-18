import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

// The glimepiride example of the documentation (`docs/examples/glimepiride`), which
// `scripts/stage-demo.mjs` stages next to the demo. The page is static files - the bundle of
// the app, the engine of sbmlsim-core and the kernel of pkpdutils, all of them in the page -
// so the endpoint of these tests serves it and answers nothing of it.
//
// What is tested here is what no unit test reaches: the table of the parameters (`nca.mjs`)
// against the panels of a real browser, over the event which crosses the shadow root of the
// app and the WebAssembly module which analyses the curves.

/** The page of the example. */
const PAGE = '/examples/glimepiride/app.html'

/** The row of a parameter of the table, by the name in its first cell. */
function parameter(page: Page, name: string): Locator {
  return page
    .locator('#pk-parameters tbody tr')
    .filter({ has: page.getByRole('rowheader', { name, exact: true }) })
}

/** The number of one analyte of a row, as the table shows it. */
async function value(row: Locator, analyte: number): Promise<number> {
  return Number(await row.locator('td.pk-value').nth(analyte).textContent())
}

test.describe('the glimepiride example', () => {
  test('analyses the curves it draws, in the page', async ({ page }) => {
    await page.goto(PAGE)
    const cmax = parameter(page, 'Cmax')
    // the first scan of the app fills the three columns of the table
    await expect(cmax.locator('td.pk-value').last()).not.toHaveText('…', { timeout: 30_000 })

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
    const simulations: string[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/simulate')) {
        simulations.push(request.url())
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
    expect(simulations).toEqual([])
  })
})
