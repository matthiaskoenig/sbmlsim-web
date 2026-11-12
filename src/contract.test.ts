import { describe, expect, it } from 'vitest'

import { CONTRACTS, ContractError, checkContract } from './contract'
import type {
  AppDeclaration,
  PanelDataResponse,
  PanelDeclaration,
  SimulateRequest,
  SimulateResponse,
} from './contract'

// The bodies below are the ones of the contract document of sbmlsim
// (`docs/serve.md`), field for field: a field which this library names
// otherwise, or does not name at all, fails to compile here.

const declaration: PanelDeclaration = {
  contract: 'panel/1',
  panel: {
    id: 'renal',
    title: 'Renal impairment',
    subtitle: 'hydrochlorothiazide after a single oral dose',
    x_label: 'time [hr]',
  },
  axes: [
    {
      id: 'dose',
      label: 'dose',
      target: 'PODOSE_hctz',
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
      id: 'egfr',
      label: 'renal function',
      target: 'f_renal_function',
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
    { id: '[Cve_hctz]', label: 'hydrochlorothiazide, plasma', unit: 'uM', scale: 'linear' },
    { id: 'Aurine_hctz', label: 'hydrochlorothiazide, urine', unit: 'umol', scale: 'linear' },
  ],
  data: [
    {
      id: 'beermann1976_urine',
      label: 'Beermann 1976 (5 mg, oral)',
      curve: 'Aurine_hctz',
      dataset: 'Beermann1976_Tab1A',
      x: 'time',
      y: 'value',
      yerr: null,
      sel: { label: 'amount_urine_hctz5po_4' },
      conversion: '1/(297.7 g/mole)',
      unit: null,
    },
  ],
  simulation: {
    variant: null,
    end: 120.0,
    points: 2,
    x_unit: 'hr',
    preinit: { BW: 75.0 },
  },
  limits: { end: 10000.0, points: 2000, knobs: 4, grid: 64, curves: 16 },
}

const request: SimulateRequest = { values: { dose: 25.0 }, grid: { egfr: 3 } }

const answer: SimulateResponse = {
  contract: 'panel/1',
  spec_hash: '31f8db7d3d6d14a46ad2a5d1642c36999a6ce89ea1ff9863bb2a97d553642e6d',
  x: [0.0, 1.0, 2.0],
  dims: [{ id: 'egfr', label: 'renal function', unit: 'dimensionless', values: [0.2, 0.6, 1.0] }],
  curves: {
    '[Cve_hctz]': [
      [1.727788792509682e-45, 0.4657270384445122, 0.7080096418038107],
      [1.7277887925096822e-45, 0.3916815929135674, 0.5462303310110749],
      [1.727788792509682e-45, 0.34200231622543875, 0.4516395144971838],
    ],
    Aurine_hctz: [
      [1.6234091601443682e-69, 0.5849593608918757, 2.2902077861891277],
      [4.870219778211929e-69, 1.436210578900252, 5.26572987877097],
      [8.117020126691858e-69, 2.0211049712399904, 7.0914377715035295],
    ],
  },
  units: { x: 'hr', '[Cve_hctz]': 'uM', Aurine_hctz: 'umol' },
  provenance: {
    model: 'hctz',
    panel: 'renal',
    model_sha256: 'e47e40b60ff28f8d3a12b0b99d09482ed3cba8e239dcb5cd9cc14cadae48f82c',
    variant: null,
    engine: 'roadrunner',
    sbmlsim: '0.22.0',
    seconds: 0.07926412999950117,
    created: '2026-11-12T22:41:35.090689+00:00',
  },
  status: { ok: true, points: 3, failed: [] },
}

const data: PanelDataResponse = {
  contract: 'paneldata/1',
  series: [
    {
      id: 'beermann1976_urine',
      label: 'Beermann 1976 (5 mg, oral)',
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
  title: 'Hydrochlorothiazide',
  subtitle: 'a physiologically based model of hydrochlorothiazide',
  pages: [{ id: 'renal', title: 'Renal impairment', panels: ['renal'] }],
  variants: [],
  citation: 'Koenig et al. (2026)',
  doi: '10.5281/zenodo.0000000',
  licenses: ['CC BY-SA 4.0'],
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
    expect(declaration.limits.knobs).toBe(4)
    expect(answer.dims[0]?.values).toEqual([0.2, 0.6, 1.0])
    expect(request.grid).toEqual({ egfr: 3 })
    expect(app.pages[0]?.panels).toEqual([declaration.panel.id])
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
    expect(data.series[0]?.unit).toBe(answer.units.Aurine_hctz)
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
})
