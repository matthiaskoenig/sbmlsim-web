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

/** The key of the drawing which opens a panel the page declares but shows by no default. */
const EXTRA = 'extra'
/** The id of that panel, a copy of the second panel of the example. */
const EXTRA_PANEL = 'm1x'
/** The keys of the drawing and the panels they open, the extra one among them. */
const KEYS: Record<string, string[]> = {
  plasma: ['glimepiride'],
  m1: ['m1'],
  m2: ['m2'],
  urine: ['urine'],
  liver: ['m1', 'm2'],
  [EXTRA]: [EXTRA_PANEL],
}

/** The simulation of a request, which every panel of one state shares (the run key of the endpoint). */
interface Request {
  start: number
  end: number
  output: unknown
}

/**
 * The module which registers the endpoint of the example, in place of the one of the page: the
 * same bundle on a pool which records every simulation it is asked for in `window.poolRuns` and
 * counts those in flight in `window.poolInFlight`.
 *
 * It is a copy of `register.mjs` of the example, apart from the pool, and has to track it.
 */
const REGISTRATION = `
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
globalThis.poolInFlight = 0
pool.simulate = async (key, request, options) => {
  globalThis.poolRuns.push(JSON.stringify([key, request]))
  globalThis.poolInFlight += 1
  try {
    return await simulate(key, request, options)
  } finally {
    globalThis.poolInFlight -= 1
  }
}
globalThis.sbmlsimWeb.registerEndpoint(
  'local:glimepiride',
  createPanelEndpoint({ bundle: new URL('${BASE}/bundle/bundle.json', location.href), pool }),
)
`

/**
 * Serve the example on a pool which counts.
 *
 * With `figure` the app declares a drawing whose keys open the panels of `KEYS`, shows the first
 * panel only, and lists a copy of the second panel as a fifth one, which a default never shows.
 * `extraEnd` gives that copy another end of the simulation, which no panel of the page has.
 */
async function stage(page: Page, figure: boolean, extraEnd?: number): Promise<void> {
  await page.route(`**${BASE}/register.mjs`, (route) =>
    route.fulfill({ contentType: 'text/javascript', body: REGISTRATION }),
  )
  if (!figure) {
    return
  }
  await page.route(`**${BASE}/bundle/bundle.json`, async (route) => {
    const response = await route.fetch()
    const bundle = (await response.json()) as {
      answers: Record<
        string,
        {
          app: {
            pages: { panels: string[]; figure?: boolean; shown?: string[] }[]
            figure?: unknown
          }
          panels: Record<string, { declaration: { panel: { id: string } }; run: { end: number } }>
        }
      >
    }
    for (const answer of Object.values(bundle.answers)) {
      const copy = structuredClone(answer.panels.m1)
      if (copy === undefined) {
        throw new Error('the example has no panel m1')
      }
      copy.declaration.panel.id = EXTRA_PANEL
      copy.run.end = extraEnd ?? copy.run.end
      answer.panels[EXTRA_PANEL] = copy
      const first = answer.app.pages[0]
      if (first?.panels[0] === undefined) {
        throw new Error('the example has no page')
      }
      first.panels.push(EXTRA_PANEL)
      first.figure = true
      first.shown = [first.panels[0]]
      answer.app.figure = {
        svg:
          '<svg viewBox="0 0 600 100">' +
          Object.keys(KEYS)
            .map(
              (name, i) =>
                `<g data-k="${name}"><rect x="${String(10 + i * 98)}" y="10" width="80" height="80" /></g>`,
            )
            .join('') +
          '</svg>',
        title: 'The body',
        credit: '',
        panels: KEYS,
      }
    }
    await route.fulfill({ response, json: bundle })
  })
}

/**
 * The simulations the pool has been asked for, once the panels are drawn, the draws of their
 * bands are, and nothing is in flight any more.
 */
async function runs(page: Page, panels: number): Promise<string[]> {
  const app = page.locator('sbmlsim-app')
  await expect(app.locator('sbmlsim-panel')).toHaveCount(panels)
  for (const one of await app.locator('sbmlsim-panel').all()) {
    await expect(one.locator('svg path').first()).toBeVisible({ timeout: 60_000 })
    await expect(one.locator('.curve-band').first()).toBeAttached({ timeout: 60_000 })
  }
  await expect
    .poll(
      () => page.evaluate(() => (globalThis as unknown as { poolInFlight: number }).poolInFlight),
      {
        timeout: 60_000,
      },
    )
    .toBe(0)
  return page.evaluate(() => (globalThis as unknown as { poolRuns: string[] }).poolRuns)
}

/** The key of the drawing, as a locator of the part a reader presses. */
function key(page: Page, name: string): Locator {
  return page.locator(`sbmlsim-app sbmlsim-figure [data-k=${name}]`)
}

/** The distinct simulations (start, end, output) of the requests the pool recorded. */
function scans(recorded: string[]): string[] {
  return [
    ...new Set(
      recorded.map((one) => {
        const { start, end, output } = (JSON.parse(one) as [string, Request])[1]
        return JSON.stringify([start, end, output])
      }),
    ),
  ]
}

/**
 * Open the example with the drawing and press every key which shows a panel it does not show,
 * the extra panel among them, then wait for the five panels and return what the pool ran.
 */
async function selectEveryKey(page: Page, extraEnd?: number): Promise<string[]> {
  await stage(page, true, extraEnd)
  await page.goto(PAGE)
  await expect(page.locator('sbmlsim-app sbmlsim-panel')).toHaveCount(1)
  // the plasma is shown already, a press on it would take it away, and the liver is the
  // metabolites again: every other key is pressed
  for (const name of ['m1', 'm2', 'urine', EXTRA]) {
    await key(page, name).locator('rect').click()
  }
  return runs(page, 5)
}

test.describe('the readouts of a drawing', () => {
  test('the panes of a selection ask the pool for the scan the declared panels do', async ({
    page,
  }) => {
    // the baseline: the four panels the page declares, shown without a drawing
    const baseline = await page.context().newPage()
    await stage(baseline, false)
    await baseline.goto(PAGE)
    const declared = await runs(baseline, 4)
    await baseline.close()
    expect(declared.length).toBeGreaterThan(0)
    const scan = scans(declared)
    expect(scan).toHaveLength(1)

    const selected = await selectEveryKey(page)

    // a panel of the selection which asked for another end, or other points, would be another
    // scan of the model: every request of the pool is the scan of the declared panels
    expect(scans(selected)).toEqual(scan)
    // and the points the four declared panels ask for are asked for as often as the page itself
    // does (its panels grid over different knobs, so a few points are shared between two runs),
    // which assumes that sharing is deterministic. The copy of the second panel adds nothing to
    // this comparison, its run is the one of the second panel: what shows that it really ran is
    // the wait of `runs` for its drawn path and band
    expect([...selected].sort()).toEqual([...declared].sort())
  })

  test('sees a panel which asks for another end of the simulation', async ({ page }) => {
    // the detector of the test above: the extra panel with the end 1500 instead of 3000 is a
    // second scan of the model, and the scans the pool recorded are no longer one
    const selected = await selectEveryKey(page, 1500)
    expect(scans(selected)).toHaveLength(2)
    expect(scans(selected).some((one) => one.includes('1500'))).toBe(true)
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
