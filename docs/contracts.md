# Contracts

The elements read three versioned JSON contracts and nothing else. `src/contract.ts` of the library is the only place which knows the shape of a payload, and the service of sbmlsim writes them ([The contracts](https://matthiaskoenig.github.io/sbmlsim/serve/#the-contracts) of its documentation).

| contract      | payloads                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------- |
| `panel/1`     | the declaration of a panel (`PanelDeclaration`) and the answer of a run (`SimulateResponse`) |
| `paneldata/1` | the study data drawn under its curves (`PanelDataResponse`)                                  |
| `app/1`       | the pages of the panels of a model (`AppDeclaration`)                                        |

## What a reader may rely on

- **The version.** Every payload carries it as `contract`, and the client refuses a payload of another version, of none or of one which is no version (`checkContract`, the failure `contract`).
- **Plain JSON.** Objects, arrays, numbers, strings and `null`, where `null` is "no unit" and "no value" and nothing else; JSON carries no `NaN`, so a point which did not integrate is `null` in the curves of a grid and its flat index is in `status.failed`.
- **The ids are data.** The ids of the models, panels, knobs, curves and series come from the payloads, so no model and no entity of a model is built into the library.
- **An added field keeps the version.** A payload may grow a field within its version, so the client ignores the fields it does not know; a field which is removed or changes its meaning is a new version (`panel/2`).
- **The shape is checked before it is read.** A body which carries its version but not the fields of its payload is the failure `body`, so every reader of a checked body reads it without a guard of its own.

## `panel/1`: the declaration of a panel

`GET /api/models/{model}/panels/{panel}?variant=` answers a `PanelDeclaration`:

| field        | what it is                                                                                                                                                                                                                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract`   | `"panel/1"`                                                                                                                                                                                                                                                                                                                        |
| `panel`      | the texts and the limits of the axes: `id`, `title`, `subtitle`, `x_label`, `y_label` (the units are appended by the renderer), `y_min`, `y_max`, `x_max` (`null` for an axis which frames what is drawn)                                                                                                                          |
| `axes`       | the knobs in the order they are shown, each an axis of a grid (below)                                                                                                                                                                                                                                                              |
| `curves`     | the curves in the order they are drawn: `id` (a selection of the model and the key of its values in a grid), `label`, `unit`, `scale` (`linear` or `log`)                                                                                                                                                                          |
| `data`       | the study data drawn under the curves: `id`, `label`, `curve`, `dataset`, the columns `x`, `y`, `yerr`, the rows `sel`, the state of the knobs it was measured under `at`, `conversion`, `unit`                                                                                                                                    |
| `simulation` | the simulation every point of a grid runs: `variant`, `end` (in the time unit of the model), `points` (output steps, a run answers one time more), `x_unit`, `preinit` (the pre-initialization which is no knob), `derived` (formulas of the knobs by the entity they set, which the endpoint evaluates and a renderer never does) |
| `limits`     | the bounds of the endpoint: the largest `end`, the most `points`, `knobs`, points of a `grid` and `curves`                                                                                                                                                                                                                         |

A knob (`PanelAxis`) is `id`, `label`, `target` (the entity it sets, `null` for a knob the derived values read), `unit`, `kind` (`range` of bounds `min` and `max`, or `choice`), `steps` (the points a grid over a range knob runs by default), `choices` (the choices of a choice knob, or the named stops of a range knob, each a `label` and a `value`) and `default`.

## `panel/1`: a simulation

`POST /api/models/{model}/panels/{panel}/simulate` takes a `SimulateRequest`:

```json
{ "values": { "dose": 25 }, "grid": { "egfr": 5 }, "variant": "male" }
```

`values` are the knobs by id in the units of the knobs (a knob left out runs at its default), `grid` the points of the knobs a run grids over (a knob of the grid takes no value), and `variant` the variant to simulate. The elements grid over one knob per request. The answer is a `SimulateResponse`:

| field        | what it is                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `contract`   | `"panel/1"`                                                                                                                    |
| `dims`       | the axes of the grid, each `id`, `label`, `unit` and the `values` it covered; empty for a run of one point                     |
| `x`          | the output times of every row                                                                                                  |
| `curves`     | the rows of every curve by its id, one row per point of `dims` in C order (the last axis fastest), `null` where a point failed |
| `status`     | `ok`, the number of `points` and the flat indices of the points which `failed`                                                 |
| `units`      | the unit of every curve and, under `x`, of the times; `null` for no unit                                                       |
| `spec_hash`  | the sha256 of the resolved request, an opaque string which identifies what was simulated                                       |
| `provenance` | `model`, `panel`, `model_sha256` of the SBML, `variant` (resolved), `engine`, `sbmlsim` (its version), `seconds` and `created` |

`interpolate(grid, at)` of the library reads a position between the points of such a grid, multilinear over its axes and clamped to their ends; a failed point gives `NaN` for the positions it bounds and touches no neighbour it does not bound.

## `paneldata/1`

`GET /api/models/{model}/panels/{panel}/data?variant=` answers the series a panel declares, in its order (`series`, empty for a panel without data). A series (`PanelDataSeries`) is `id`, `label`, the points `x` and `y`, the error of every value `yerr` (`null` for a point or a series without one), `x_unit` and `unit` (the units of the curve it sits under) and the number of subjects behind every point `count`.

## `app/1`

`GET /api/models/{model}/app?variant=` answers the `AppDeclaration` of a model, a 404 for a model without an app:

| field                         | what it is                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract`                    | `"app/1"`                                                                                                                                          |
| `title`, `subtitle`           | the model as it is shown                                                                                                                           |
| `pages`                       | the pages in their order: `id`, `title`, the ids of its `panels` and its `scenarios` (each `id`, `label` and the `values` of the knobs it sets)    |
| `variants`                    | the variants a reader switches between, each `id` and `label`; empty for the default variant alone                                                 |
| `citation`, `doi`, `licenses` | the texts of the provenance footer                                                                                                                 |
| `shared`                      | the knobs the panels of each page share, by page: the `knob` (a `PanelAxis`) and the `panels` (`id`, `title`) which declare it                     |
| `heads`                       | the panels of each page with their `id`, `title` and `subtitle`, by page, which the shell lays the cards out with before a panel has read anything |
| `variant`                     | the id of the variant the app answers: the one of `?variant=`, else the default variant of the model                                               |

`shared` and `heads` are derived by the service from the declarations of the panels and are no part of the declaration of the app.
