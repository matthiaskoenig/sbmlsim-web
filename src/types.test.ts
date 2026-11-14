import { describe, expect, it } from 'vitest'

import type {
  AppDeclaration,
  Scenario,
  SbmlsimPanelHTMLElement,
  SharedKnob,
  SharedPanel,
} from './index'

// What a TypeScript host reads off the package: the types `vue-tsc` checks
// this file against are the ones of `src/index.ts`, which the build writes
// into `dist/types`. The imports are types only, so nothing of the elements is
// defined in node.

describe('the types of the package', () => {
  it('give the element of a tag the methods of the panel', () => {
    // without the map of the tags this is an `Element` without `activate()`,
    // and `vue-tsc --noEmit` fails on this file
    const start = (page: ParentNode): Promise<void> | undefined =>
      page.querySelector('sbmlsim-panel')?.activate()
    const panel: SbmlsimPanelHTMLElement | null = null
    expect(typeof start).toBe('function')
    expect(panel).toBeNull()
  })

  it('name every type an app is built of', () => {
    const scenario: Scenario = { id: 'a', label: 'A', values: { knobA: 1 } }
    const shared: SharedPanel = { id: 'panelA', title: 'Panel A' }
    const knob: SharedKnob['panels'] = [shared]
    const pages: AppDeclaration['pages'][number]['scenarios'] = [scenario]
    expect([knob.length, pages.length]).toEqual([1, 1])
  })
})
