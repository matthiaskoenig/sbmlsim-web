import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { PanelClient } from './client'

import { CONTRACTS, ContractError, checkContract } from './contract'
import type {
  AppDeclaration,
  PanelDataResponse,
  PanelDeclaration,
  SimulateRequest,
  SimulateResponse,
} from './contract'

// The bodies below are the ones of the contract document of sbmlsim
// (`docs/serve.md`) field for field, with every id of its example replaced by a
// neutral one: a model, a panel, a knob, a curve and a series are data of a
// payload and never of this library. TypeScript checks the names of the fields
// and not their values, so the fixtures stay what they are for, a compile-time
// diff against the document: a field which this library names otherwise, or
// does not name at all, fails to compile here.

const declaration: PanelDeclaration = {
  contract: 'panel/1',
  panel: {
    id: 'panelA',
    title: 'Panel A',
    subtitle: 'the question the panel answers',
    x_label: 'time [hr]',
    y_label: '',
    y_min: null,
    y_max: null,
    x_max: null,
  },
  axes: [
    {
      id: 'knobA',
      label: 'knob A',
      target: 'targetA',
      unit: 'mg',
      kind: 'choice',
      min: null,
      max: null,
      steps: 5,
      choices: [
        { label: '12.5 mg', value: 12.5 },
        { label: '25 mg', value: 25.0 },
      ],
      default: 25.0,
    },
    {
      id: 'knobB',
      label: 'knob B',
      target: 'targetB',
      unit: 'dimensionless',
      kind: 'range',
      min: 0.2,
      max: 1.0,
      steps: 3,
      choices: [],
      default: 1.0,
    },
  ],
  curves: [
    { id: '[curveA]', label: 'curve A', unit: 'uM', scale: 'linear' },
    { id: 'curveB', label: 'curve B', unit: 'umol', scale: 'linear' },
  ],
  data: [
    {
      id: 'seriesA',
      label: 'Study A (single dose)',
      curve: 'curveB',
      dataset: 'StudyA_Tab1A',
      x: 'time',
      y: 'value',
      yerr: null,
      sel: { label: 'seriesA_rows' },
      at: null,
      conversion: '1/(100 g/mole)',
      unit: null,
    },
  ],
  simulation: {
    variant: null,
    end: 120.0,
    points: 2,
    x_unit: 'hr',
    preinit: { paramA: 75.0 },
    derived: {},
    dosing: [],
    uncertainty: null,
  },
  limits: { end: 10000.0, points: 2000, knobs: 8, grid: 64, curves: 16 },
}

const request: SimulateRequest = { values: { knobA: 25.0 }, grid: { knobB: 3 } }

const answer: SimulateResponse = {
  contract: 'panel/1',
  spec_hash: '31f8db7d3d6d14a46ad2a5d1642c36999a6ce89ea1ff9863bb2a97d553642e6d',
  x: [0.0, 1.0, 2.0],
  dims: [{ id: 'knobB', label: 'knob B', unit: 'dimensionless', values: [0.2, 0.6, 1.0] }],
  curves: {
    '[curveA]': [
      [1.727788792509682e-45, 0.4657270384445122, 0.7080096418038107],
      [1.7277887925096822e-45, 0.3916815929135674, 0.5462303310110749],
      [1.727788792509682e-45, 0.34200231622543875, 0.4516395144971838],
    ],
    curveB: [
      [1.6234091601443682e-69, 0.5849593608918757, 2.2902077861891277],
      [4.870219778211929e-69, 1.436210578900252, 5.26572987877097],
      [8.117020126691858e-69, 2.0211049712399904, 7.0914377715035295],
    ],
  },
  units: { x: 'hr', '[curveA]': 'uM', curveB: 'umol' },
  provenance: {
    model: 'm1',
    panel: 'panelA',
    model_sha256: 'e47e40b60ff28f8d3a12b0b99d09482ed3cba8e239dcb5cd9cc14cadae48f82c',
    variant: null,
    engine: 'roadrunner',
    sbmlsim: '0.22.0',
    seconds: 0.07926412999950117,
    created: '2026-11-12T22:41:35.090689+00:00',
  },
  status: { ok: true, points: 3, failed: [] },
  uncertainty: null,
}

const data: PanelDataResponse = {
  contract: 'paneldata/1',
  series: [
    {
      id: 'seriesA',
      label: 'Study A (single dose)',
      x: [0.0, 12.0, 96.0, 168.0],
      y: [0.0, 10.110849848841115, 13.873026536781996, 13.889821968424588],
      yerr: null,
      x_unit: 'hr',
      unit: 'umol',
      count: [1, 1, 1, 1],
    },
  ],
}

const app: AppDeclaration = {
  contract: 'app/1',
  title: 'Model A',
  subtitle: 'what the model is',
  pages: [{ id: 'pageA', title: 'Page A', panels: ['panelA', 'panelB'], scenarios: [] }],
  variants: [],
  citation: 'Author et al. (2026)',
  doi: '10.0000/zenodo.0000000',
  licenses: ['CC BY-SA 4.0'],
  shared: {
    pageA: [
      {
        knob: {
          id: 'knobA',
          label: 'knob A',
          target: 'targetA',
          unit: 'dimensionless',
          kind: 'choice',
          min: null,
          max: null,
          steps: 5,
          choices: [
            { label: 'low', value: 0.4 },
            { label: 'high', value: 1.0 },
          ],
          default: 1.0,
        },
        panels: [
          { id: 'panelA', title: 'Panel A' },
          { id: 'panelB', title: 'Panel B' },
        ],
      },
    ],
  },
  heads: {
    pageA: [
      { id: 'panelA', title: 'Panel A', subtitle: 'what panel A answers' },
      { id: 'panelB', title: 'Panel B', subtitle: 'what panel B answers' },
    ],
  },
  variant: 'default',
}

describe('the contracts', () => {
  it('names the version of each of them', () => {
    expect(CONTRACTS).toEqual({ panel: 'panel/1', data: 'paneldata/1', app: 'app/1' })
  })

  it('types the bodies of an endpoint', () => {
    expect(() => {
      checkContract(declaration, CONTRACTS.panel)
      checkContract(answer, CONTRACTS.panel)
      checkContract(data, CONTRACTS.data)
      checkContract(app, CONTRACTS.app)
    }).not.toThrow()
    expect(declaration.limits.knobs).toBe(8)
    expect(answer.dims[0]?.values).toEqual([0.2, 0.6, 1.0])
    expect(request.grid).toEqual({ knobB: 3 })
    expect(app.pages[0]?.panels).toEqual([declaration.panel.id, 'panelB'])
    expect(app.shared.pageA?.[0]?.panels.map((one) => one.id)).toEqual(app.pages[0]?.panels)
    expect(app.heads.pageA?.map((one) => one.id)).toEqual(app.pages[0]?.panels)
  })

  it('reads the limits of the endpoint and not its own', () => {
    expect(Object.keys(declaration.limits).sort()).toEqual([
      'curves',
      'end',
      'grid',
      'knobs',
      'points',
    ])
  })

  it('states no unit as null on both contracts', () => {
    expect(declaration.data[0]?.unit).toBeNull()
    expect(data.series[0]?.unit).toBe(answer.units.curveB)
    expect(data.series[0]?.x_unit).toBe(answer.units.x)
  })
})

describe('checkContract', () => {
  it('accepts a body of the expected contract', () => {
    expect(() => {
      checkContract({ contract: 'panel/1' }, CONTRACTS.panel)
    }).not.toThrow()
  })

  it('accepts a body which grew a field within its version', () => {
    expect(() => {
      checkContract({ contract: 'paneldata/1', series: [], added: 1 }, CONTRACTS.data)
    }).not.toThrow()
  })

  it('rejects a body of another contract version', () => {
    expect(() => {
      checkContract({ contract: 'panel/2' }, 'panel/1')
    }).toThrow(ContractError)
  })

  it('rejects a body which carries no contract', () => {
    expect(() => {
      checkContract({}, CONTRACTS.data)
    }).toThrow(ContractError)
    expect(() => {
      checkContract(null, CONTRACTS.app)
    }).toThrow(ContractError)
  })

  it('names the version it got and the one it expected', () => {
    try {
      checkContract({ contract: 'app/2' }, CONTRACTS.app)
      expect.unreachable('a body of another version is refused')
    } catch (error) {
      expect(error).toBeInstanceOf(ContractError)
      expect((error as ContractError).contract).toBe('app/2')
      expect((error as ContractError).expected).toBe('app/1')
      expect((error as ContractError).message).toContain('app/2')
    }
  })

  it('says of a contract which is no version what it carries', () => {
    const messages = [
      { body: { contract: 2 }, says: 'carries 2 as its contract' },
      { body: { contract: null }, says: 'carries null as its contract' },
      { body: { contract: { version: 1 } }, says: 'carries an object as its contract' },
      { body: {}, says: 'carries no contract' },
    ]
    for (const { body, says } of messages) {
      try {
        checkContract(body, CONTRACTS.panel)
        expect.unreachable('a body which is of no version is refused')
      } catch (error) {
        expect(error).toBeInstanceOf(ContractError)
        expect((error as ContractError).message).toContain(says)
        expect((error as ContractError).message).toContain('panel/1')
      }
    }
    expect(new ContractError(2, CONTRACTS.panel).contract).toBe(2)
  })
})

/**
 * The payloads of a live endpoint, `src/fixtures/contract.json`, which
 * `e2e/contract.spec.ts` compares with what the endpoint of the end to end
 * tests serves of `examples.panels.hctz` of sbmlsim: the app, a declaration
 * with study data, its data and a run of it.
 */
const served = JSON.parse(
  readFileSync(new URL('./fixtures/contract.json', import.meta.url), 'utf8'),
) as Record<'app' | 'panel' | 'data' | 'run', Record<string, unknown>>

describe('the payloads of the service', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** A client which reads every route from the fixture. */
  function client(): PanelClient {
    vi.stubGlobal('fetch', (url: string) => {
      const path = url.split('?')[0] ?? ''
      const body = path.endsWith('/app')
        ? served.app
        : path.endsWith('/simulate')
          ? served.run
          : path.endsWith('/data')
            ? served.data
            : served.panel
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
    })
    return new PanelClient('https://endpoint.example.org')
  }

  it('are read by the client as the contracts this library speaks', async () => {
    // the client checks the version and the shape of every payload, so a field
    // the service renamed or dropped is a failure of the read here
    const reader = client()
    const app = await reader.app('hctz')
    const panel = await reader.panel('hctz', 'renal_urine')
    const data = await reader.data('hctz', 'renal_urine')
    const run = await reader.simulate('hctz', 'renal_urine', {})
    expect(app.pages.length).toBeGreaterThan(0)
    expect(panel.axes.length).toBeGreaterThan(0)
    expect(panel.data.length).toBeGreaterThan(0)
    expect(data.length).toBeGreaterThan(0)
    expect(run.dims.length).toBe(1)
  })

  it('carry every field of the types of the contract and no other', () => {
    // the keys the service writes are the keys the types name, at every level
    // the renderer reads
    const keys = (value: unknown): string[] => Object.keys(value as object).sort()
    expect(keys(served.panel)).toEqual(keys(declaration))
    expect(keys(served.panel.panel)).toEqual(keys(declaration.panel))
    expect(keys(served.panel.simulation)).toEqual(keys(declaration.simulation))
    expect(keys(served.panel.limits)).toEqual(keys(declaration.limits))
    expect(keys((served.panel.axes as unknown[])[0])).toEqual(keys(declaration.axes[0]))
    expect(keys((served.panel.curves as unknown[])[0])).toEqual(keys(declaration.curves[0]))
    expect(keys((served.panel.data as unknown[])[0])).toEqual(keys(declaration.data[0]))
    expect(keys(served.run)).toEqual(keys(answer))
    expect(keys(served.run.provenance)).toEqual(keys(answer.provenance))
    expect(keys(served.run.status)).toEqual(keys(answer.status))
    expect(keys(served.data)).toEqual(keys(data))
    expect(keys((served.data.series as unknown[])[0])).toEqual(keys(data.series[0]))
    expect(keys(served.app)).toEqual(keys(app))
  })
})
