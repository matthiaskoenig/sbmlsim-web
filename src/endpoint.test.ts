// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { APP_TAG, PANEL_TAG, registerEndpoint } from './index'
import type { EndpointFetch } from './index'

// The elements on an endpoint inside the page: a page which simulates in the
// browser of its reader registers a function with the signature of `fetch`
// under `local:<name>` and writes that name as the `endpoint` of its elements,
// which then never reach the network. The function here answers the routes
// with the payloads of a live endpoint, `src/fixtures/contract.json`, as real
// `Response`s, so the elements read them exactly as the answers of a service.

/**
 * The payloads of a live endpoint: the app, a declaration, its data and a run
 * of it, read from the root of the repository, where the tests run, since the
 * `URL` of happy-dom reads no file url.
 */
const served = JSON.parse(readFileSync(resolve('src/fixtures/contract.json'), 'utf8')) as Record<
  'app' | 'panel' | 'data' | 'run',
  Record<string, unknown>
>

/** The id of the model and of the panel of the fixture. */
const MODEL = 'hctz'
const PANEL = 'renal_urine'

/** The urls the function of the page was asked for. */
let asked: string[] = []

/** The network, which no test of this file may reach. */
let network = vi.fn<typeof fetch>()

/**
 * Answer a route of the service from the fixture, as the function of a page does.
 *
 * Every panel of the app is answered with the one declaration of the fixture,
 * which is all a test of the shell needs: it draws the cards of its page.
 */
const answer: EndpointFetch = (url, init) => {
  asked.push(url)
  const path = url.split('?')[0] ?? ''
  const body = path.endsWith('/app')
    ? served.app
    : path.endsWith('/simulate')
      ? served.run
      : path.endsWith('/data')
        ? served.data
        : served.panel
  expect(init.method).toBe(path.endsWith('/simulate') ? 'POST' : 'GET')
  return Promise.resolve(
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
  )
}

/** Let every request in flight answer and the dom catch up. */
async function settled(): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

/** Get the shadow root of an element, which has one. */
function shadow(element: HTMLElement): ShadowRoot {
  const root = element.shadowRoot
  if (root === null) {
    throw new Error('the element has no shadow root')
  }
  return root
}

beforeEach(() => {
  asked = []
  network = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('Failed to fetch')))
  globalThis.fetch = network
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('an element on an endpoint inside the page', () => {
  it('draws a panel from the function the page registered, also after it connected', async () => {
    const heard: string[] = []
    document.addEventListener('sbmlsim-result', (event) =>
      heard.push((event as CustomEvent<{ spec_hash: string }>).detail.spec_hash),
    )
    // the tag map of the package types the element as a page sees it
    const element = document.createElement('sbmlsim-panel')
    element.setAttribute('endpoint', 'local:page-panel')
    element.setAttribute('model', MODEL)
    element.setAttribute('panel', PANEL)
    element.setAttribute('auto', '')
    document.body.append(element)
    await settled()
    // the panel waits for the endpoint, which a module script of the page
    // registers after the elements connected
    expect(asked).toEqual([])
    registerEndpoint('local:page-panel', answer)
    await settled()
    const root = shadow(element)
    expect(root.querySelector('.plot .figure-svg svg')).not.toBeNull()
    expect(root.textContent).toContain('Urinary excretion over the renal function')
    expect(root.querySelector('.error')).toBeNull()
    expect(heard).toEqual([served.run.spec_hash])
    expect(asked).toContain(`local:page-panel/api/models/${MODEL}/panels/${PANEL}`)
    expect(asked.some((url) => url.endsWith('/simulate'))).toBe(true)
    expect(network).not.toHaveBeenCalled()
  })

  it('draws the app of a model from the function the page registered', async () => {
    registerEndpoint('local:page-app', answer)
    const element = document.createElement(APP_TAG)
    element.setAttribute('endpoint', 'local:page-app')
    element.setAttribute('model', MODEL)
    document.body.append(element)
    await settled()
    const root = shadow(element)
    expect(root.querySelector('.title')?.textContent.trim()).toBe(served.app.title)
    const panels = [...root.querySelectorAll(PANEL_TAG)]
    expect(panels.length).toBeGreaterThan(0)
    // the shell hands its endpoint to the panels it places
    expect(panels.every((one) => one.getAttribute('endpoint') === 'local:page-app')).toBe(true)
    expect(asked[0]).toBe(`local:page-app/api/models/${MODEL}/app`)
    expect(network).not.toHaveBeenCalled()
  })
})
