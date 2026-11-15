# sbmlsim-web

sbmlsim-web is the renderer of the interactive panels of an SBML model: two web components, `<sbmlsim-panel>` and `<sbmlsim-app>`, which draw a panel - its knobs, its curves and the study data under them - and the app of a model in any HTML page, a documentation site, a slide deck or a course. They are Vue 3 custom elements with a shadow root, published to npm as [`sbmlsim-web`](https://www.npmjs.com/package/sbmlsim-web), and Vue is bundled into the package, so a page loads one script and writes one tag.

## What draws what

A model declares its panels in its own SBML, as an annotation of its `<model>`, and the app of a model (its pages, its variants and the example states of its knobs) in the project of the model. Nothing of a model is built into this library: the ids of the models, panels, knobs, curves and series are data of the payloads it reads.

- **The declaration** lives with the model. [sbmlsim](https://matthiaskoenig.github.io/sbmlsim/) reads it from the SBML and the project, checks it and serves it ([Interactive panels](https://matthiaskoenig.github.io/sbmlsim/serve/) of its documentation).
- **The simulations** are run by an endpoint: the service of sbmlsim (`python -m sbmlsim.serve`) on a server, or a function of the page itself which answers the same routes, e.g. on [sbmlsim-core](https://matthiaskoenig.github.io/sbmlsim-core/), which simulates the model in WebAssembly in the browser of the reader ([Endpoints](endpoints.md)).
- **The drawing** is this library: it reads the declaration, draws the controls, asks the endpoint for a grid of simulations and reads every movement of a knob out of that grid locally.

| element           | what it draws                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<sbmlsim-panel>` | one panel: its knobs, the figure of its curves with the study data under them, a readout at the cursor and the provenance of what it shows                           |
| `<sbmlsim-app>`   | the app of a model: its title, the navigation of its pages, the switcher of its variants, the knobs its panels share, the panels of a page and the provenance footer |

## The contracts

The library talks to an endpoint through three versioned JSON contracts and nothing else ([Contracts](contracts.md)):

| contract      | what it carries                                                 |
| ------------- | --------------------------------------------------------------- |
| `panel/1`     | the declaration of a panel and the answer of a simulation of it |
| `paneldata/1` | the study data drawn under its curves                           |
| `app/1`       | the pages of the panels of a model                              |

Every payload carries its version as `contract`, and a payload of a version the library does not speak is refused and shown as one line, never drawn.

## How a panel works

A grid is fetched once per figure and not once per movement of a knob. The first run grids over the first range knob of the panel, and while that knob moves every movement is read out of the grid locally, multilinear over the axes and clamped to their ends: five moves of a knob are no request at all. Releasing another knob runs one simulation which grids over that knob instead. A point which did not integrate is `null` on the wire with its index in `status.failed`, and it gives a gap only where it bounds the position which is read.

Nothing a request does rejects into the page: a dead network, a slow endpoint, a refused request, a payload of another version and a body which cannot be read are caught inside the element and shown as one line a reader can act on, which names no url and no host, and the element dispatches `sbmlsim-error` for the page.

## Where to go next

- [Getting started](getting-started.md): the script tag or the npm package, a panel and an app.
- [Components](components.md): every attribute, method and event of both elements and the exports of the package.
- [Embedding](embedding.md): a Zensical or MkDocs site, a reveal.js deck, a Moodle course or a plain page, and the theming tokens.
- [Endpoints](endpoints.md): the service of sbmlsim, and an endpoint inside the page.
- [Contracts](contracts.md): the payloads the elements read.
- [Examples](examples/index.md): pages which run the panels of a model.

The source is [matthiaskoenig/sbmlsim-web](https://github.com/matthiaskoenig/sbmlsim-web), under the MIT license.
