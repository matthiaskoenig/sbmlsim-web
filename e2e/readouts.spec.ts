import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

// A reader of a model drawing selects readouts, and every pane of the selection is a curve of
// the same scan of the model. The glimepiride example (`docs/examples/glimepiride`) answers its
// routes in the page on a pool of workers, so the runs the panes cost are counted where the
// model is simulated, at the pool, and not as requests.

/** The page of the example. */
const PAGE = '/examples/glimepiride/app.html'
/** The directory the example is served from. */
const BASE = '/examples/glimepiride'

/** The panels of the first page of the example and the keys of the drawing which open them. */
const KEYS: Record<string, string[]> = {
  plasma: ['glimepiride'],
  m1: ['m1'],
  m2: ['m2'],
  urine: ['urine'],
  liver: ['m1', 'm2'],
}

/**
 * The module which registers the endpoint of the example, in place of the one of the page: the
 * same bundle on a pool which records every simulation it is asked for in `window.poolRuns`
 * and, with a figure, an app declaration which carries the drawing and shows one panel.
 */
function registration(figure: boolean): string {
  return `
import { createPanelEndpoint } from '${BASE}/sbmlsim-core/panels.mjs'
import { createPool, defaultWorkers } from '${BASE}/sbmlsim-core/pool.mjs'

const bytes = async (name) =>
  new Uint8Array(await (await fetch('${BASE}/sbmlsim-core/runtime/' + name)).arrayBuffer())
const pool = await createPool({
  engine: await bytes('engine.wasm'),
  mathlib: await bytes('mathlib.wasm'),
  workers: defaultWorkers(),
})
const simulate = pool.simulate.bind(pool)
globalThis.poolRuns = []
pool.simulate = (key, request, options) => {
  globalThis.poolRuns.push(JSON.stringify([key, request]))
  return simulate(key, request, options)
}
const inner = createPanelEndpoint({ bundle: new URL('${BASE}/bundle/bundle.json', location.href), pool })
const figure = ${String(figure)}
const keys = ${JSON.stringify(KEYS)}
const endpoint = async (url, init) => {
  const response = await inner(url, init)
  if (!figure || !String(url).endsWith('/app')) return response
  const app = await response.json()
  const first = app.pages[0]
  first.figure = true
  first.shown = [first.panels[0]]
  app.figure = {
    svg: '<svg viewBox="0 0 500 100">' +
      Object.keys(keys).map((key, i) =>
        '<g data-k="' + key + '"><rect x="' + (10 + i * 98) + '" y="10" width="80" height="80" /></g>').join('') +
      '</svg>',
    title: 'The body',
    credit: '',
    panels: keys,
  }
  return new Response(JSON.stringify(app), { status: 200, headers: { 'content-type': 'application/json' } })
}
endpoint.close = () => inner.close()
globalThis.sbmlsimWeb.registerEndpoint('local:glimepiride', endpoint)
`
}

/** Serve the example with its endpoint on a pool which counts, with or without the drawing. */
async function stage(page: Page, figure: boolean): Promise<void> {
  await page.route(`**${BASE}/register.mjs`, (route) =>
    route.fulfill({ contentType: 'text/javascript', body: registration(figure) }),
  )
}

/** The simulations the pool has been asked for, once the page has been quiet for a moment. */
async function runs(page: Page): Promise<string[]> {
  let previous = -1
  let now = 0
  while (now !== previous) {
    previous = now
    await page.waitForTimeout(1500)
    now = await page.evaluate(
      () => (globalThis as unknown as { poolRuns: string[] }).poolRuns.length,
    )
  }
  return page.evaluate(() => (globalThis as unknown as { poolRuns: string[] }).poolRuns)
}

/** The key of the drawing, as a locator of the part a reader presses. */
function key(page: Page, name: string): Locator {
  return page.locator(`sbmlsim-app sbmlsim-figure [data-k=${name}]`)
}

test.describe('the readouts of a drawing', () => {
  test('a selection of every key of the figure simulates what the page shows alone', async ({
    page,
  }) => {
    // the baseline: the four panels the page declares, shown without a drawing
    const baseline = await page.context().newPage()
    await stage(baseline, false)
    await baseline.goto(PAGE)
    await expect(baseline.locator('sbmlsim-app sbmlsim-panel')).toHaveCount(4)
    await expect(baseline.locator('sbmlsim-app sbmlsim-panel svg path').first()).toBeVisible({
      timeout: 60_000,
    })
    const declared = await runs(baseline)
    await baseline.close()
    expect(declared.length).toBeGreaterThan(0)

    await stage(page, true)
    await page.goto(PAGE)
    await expect(page.locator('sbmlsim-app sbmlsim-panel')).toHaveCount(1)
    // the plasma is shown already, a press on it would take it away, and the liver is the
    // metabolites again: every other key is pressed
    for (const name of ['m1', 'm2', 'urine']) {
      await key(page, name).locator('rect').click()
    }
    await expect(page.locator('sbmlsim-app sbmlsim-panel')).toHaveCount(4)
    await expect(page.locator('sbmlsim-app sbmlsim-panel svg path').nth(3)).toBeVisible({
      timeout: 60_000,
    })
    const selected = await runs(page)

    // the panes of the selection reach the pool as the panels of the page do: the same points,
    // each as often (the panels grid over different knobs, so a few points are shared between
    // two runs of the page itself), whichever way the panels came to be shown
    expect([...selected].sort()).toEqual([...declared].sort())
  })

  test('a click on a place adds its panes and a second click removes them', async ({ page }) => {
    await stage(page, true)
    await page.goto(PAGE)
    const panels = page.locator('sbmlsim-app sbmlsim-panel')
    await expect(panels).toHaveCount(1)
    const liver = key(page, 'liver')
    await expect(liver).toHaveAttribute('aria-pressed', 'false')
    await liver.locator('rect').click()
    await expect(panels).toHaveCount(3)
    await expect(liver).toHaveAttribute('aria-pressed', 'true')
    await liver.locator('rect').click()
    await expect(panels).toHaveCount(1)
    await expect(liver).toHaveAttribute('aria-pressed', 'false')
  })
})
