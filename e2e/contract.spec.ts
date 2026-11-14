import { readFileSync, writeFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

// `src/contract.ts` is a mirror of the payloads of `python -m sbmlsim.serve`,
// kept by hand, and `src/fixtures/contract.json` is what the endpoint of these
// tests answers - the app, a declaration of a panel with study data, its study
// data and a run of it - which `src/contract.test.ts` reads through the client.
// This test reads the payloads again from the endpoint and compares them with
// the fixture, so a field the service adds, renames or drops fails here and
// never only in a page; `UPDATE_CONTRACT_FIXTURE=1 npm run e2e -- contract`
// writes the fixture again instead.
//
// What changes from run to run and from machine to machine is fixed or cut:
// the time and the seconds of a run and the version of sbmlsim, and the values
// of the arrays of a run, of which the first three are kept, to six digits.

/** The fixture, relative to this file. */
const FIXTURE = new URL('../src/fixtures/contract.json', import.meta.url)
/** The model and the panel the fixture is of. */
const MODEL = 'hctz'
const PANEL = 'renal_urine'
/** The values of an array of a run the fixture keeps. */
const KEPT = 3

/** A knob of a declaration, as far as the run of the fixture reads it. */
interface Knob {
  id: string
  default: number
  choices: unknown[]
}

/** Read a route of the endpoint as JSON. */
async function read(
  request: APIRequestContext,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const answer =
    body === undefined ? await request.get(path) : await request.post(path, { data: body })
  expect(answer.ok(), path).toBe(true)
  return (await answer.json()) as Record<string, unknown>
}

/** Keep the first values of an array of numbers, to six digits. */
function cut(values: (number | null)[]): (number | null)[] {
  return values.slice(0, KEPT).map((one) => (one === null ? null : Number(one.toPrecision(6))))
}

test('the payloads of the endpoint are the ones of the contract fixture', async ({ request }) => {
  const path = `/api/models/${MODEL}/panels/${PANEL}`
  const panel = await read(request, path)
  const [gridded, ...fixed] = panel.axes as Knob[]
  if (gridded === undefined) {
    throw new Error(`the panel ${PANEL} has no knob`)
  }
  const run = await read(request, `${path}/simulate`, {
    values: Object.fromEntries(fixed.map((one) => [one.id, one.default])),
    grid: { [gridded.id]: gridded.choices.length },
  })
  run.x = cut(run.x as number[])
  run.curves = Object.fromEntries(
    Object.entries(run.curves as Record<string, (number | null)[][]>).map(([id, rows]) => [
      id,
      rows.map((row) => cut(row)),
    ]),
  )
  run.provenance = {
    ...(run.provenance as Record<string, unknown>),
    sbmlsim: '0.0.0',
    seconds: 0,
    created: '2026-01-01T00:00:00+00:00',
  }
  const served = {
    app: await read(request, `/api/models/${MODEL}/app`),
    panel,
    data: await read(request, `${path}/data`),
    run,
  }
  if (process.env.UPDATE_CONTRACT_FIXTURE === '1') {
    writeFileSync(FIXTURE, `${JSON.stringify(served, null, 2)}\n`)
  }
  expect(served).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')))
})
