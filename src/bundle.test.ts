import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createContext, runInNewContext } from 'node:vm'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'

// What a page loads is the bundle and not the sources, and a bundle is built
// with another set of replacements than the tests run with: a reference the
// bundler leaves behind, `process.env.NODE_ENV` of the build of vue above all,
// is a `ReferenceError` in a browser and the whole library dies at its import,
// while node, which has a `process`, never notices. The bundle is therefore
// built here and evaluated in a context which has no `process` and no dom, as
// bare as the page of a slide deck.

/** The exports of the library a page reads off the global of the bundle. */
interface Library {
  /** The tag the element registers itself under. */
  PANEL_TAG: string
  /** The registration, which answers whether it registered anything. */
  register: (tagName?: string) => boolean
  /** The class of the element. */
  SbmlsimPanelElement: unknown
  /** The client of an endpoint. */
  PanelClient: unknown
  /** The registration of an endpoint inside the page. */
  registerEndpoint: unknown
  /** The renderer of a figure. */
  plotSvg: unknown
  /** The reader of a grid. */
  interpolate: unknown
}

/** The directory the bundle is built into, removed after the tests. */
let out = ''

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'sbmlsim-web-bundle-'))
  await build({
    configFile: resolve('vite.config.ts'),
    logLevel: 'silent',
    build: { outDir: out, emptyOutDir: true, sourcemap: false },
  })
}, 120000)

afterAll(() => {
  if (out !== '') {
    rmSync(out, { recursive: true, force: true })
  }
})

/** Read a file of the build. */
function built(name: string): string {
  return readFileSync(join(out, name), 'utf8')
}

describe('the bundle a page loads', () => {
  it('carries the element, the client and the renderer', () => {
    const context: Record<string, unknown> = { console }
    createContext(context)
    runInNewContext(built('sbmlsim-web.umd.cjs'), context)
    const library = context.sbmlsimWeb as Library
    expect(library.PANEL_TAG).toBe('sbmlsim-panel')
    expect(typeof library.register).toBe('function')
    expect(typeof library.SbmlsimPanelElement).toBe('function')
    expect(typeof library.PanelClient).toBe('function')
    expect(typeof library.plotSvg).toBe('function')
    expect(typeof library.interpolate).toBe('function')
    // a host without custom elements, which is what this context is, gets a
    // library which registers nothing and throws nothing
    expect(library.register()).toBe(false)
  })

  it('carries the same library as one script tag with the global of a page', () => {
    // the page of a course platform loads this file, which a static server
    // serves as a script where it serves a `.cjs` file as a download
    const context: Record<string, unknown> = { console }
    createContext(context)
    runInNewContext(built('sbmlsim-web.iife.js'), context)
    const library = context.sbmlsimWeb as Library
    expect(library.PANEL_TAG).toBe('sbmlsim-panel')
    expect(typeof library.SbmlsimPanelElement).toBe('function')
    // a page which simulates in its own workers registers its endpoint on the global
    expect(typeof library.registerEndpoint).toBe('function')
  })

  it('leaves nothing of the bundler behind for a browser to trip over', () => {
    for (const name of ['sbmlsim-web.js', 'sbmlsim-web.umd.cjs', 'sbmlsim-web.iife.js']) {
      expect(built(name)).not.toMatch(/\bprocess\s*\.\s*env\b/)
    }
  })

  it('carries the tokens of the design in the element itself', () => {
    // the styles of a `.ce.vue` are inlined into the shadow root, so a page
    // which loads no stylesheet of this library still gets the figure of a
    // report and the hooks a host overrides
    expect(built('sbmlsim-web.js')).toContain('--sbmlsim-fg')
    expect(built('sbmlsim-web.js')).toContain('--_fg')
  })

  it('keeps every colour a pair the browser resolves against the scheme of the page', () => {
    // a minifier which lowers `light-dark()` writes it as variables of its own,
    // which a custom property of the design carries as text, so no colour of
    // the panel would resolve and its text would take the colour of the page
    for (const name of ['sbmlsim-web.js', 'sbmlsim-web.umd.cjs', 'sbmlsim-web.iife.js']) {
      expect(built(name)).toContain('light-dark(')
      expect(built(name)).not.toContain('lightningcss')
      // and the light table for a browser which does not know it
      expect(built(name)).toMatch(/@supports not \(color: ?light-dark\(/)
    }
  })
})
