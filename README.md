# sbmlsim-web

The renderer of the interactive panels of an SBML model: Vue 3 components which draw a panel - its knobs, its curves and the study data under them - in any HTML page, a documentation site, a slide deck or a course.

A model declares its panels in its own SBML and an [sbmlsim](https://github.com/matthiaskoenig/sbmlsim) endpoint (`python -m sbmlsim.serve`) serves that declaration and runs its simulations. This library talks to such an endpoint and to nothing else, through three versioned JSON contracts:

| contract      | what it carries                                                 |
| ------------- | --------------------------------------------------------------- |
| `panel/1`     | the declaration of a panel and the answer of a simulation of it |
| `paneldata/1` | the study data drawn under its curves                           |
| `app/1`       | the pages of the panels of a model                              |

`src/contract.ts` is the only place which knows the shape of a payload. The ids of the models, panels, knobs, curves and series are data which come from those payloads, so no model and no entity of a model is built into this library, and `checkContract` refuses a payload of a version it does not speak.

A grid is fetched once per figure and not once per movement of a knob: `interpolate(grid, at)` reads a position between its points locally, multilinear over the axes and clamped to their ends. A point which did not integrate is `null` on the wire with its index in `status.failed`, and it gives `NaN` for the positions it bounds without touching a neighbour it does not bound.

## Build

```bash
npm ci
npm run lint       # eslint and prettier
npm test           # vitest
npm run typecheck  # the whole project, the tests included
npm run build      # dist/sbmlsim-web.js (ESM), dist/sbmlsim-web.umd.cjs (UMD), dist/types
npm run format     # write what prettier wants
```

Vue is bundled into both builds, so a host page needs nothing else: it reads `dist/sbmlsim-web.js` with a `<script type="module">` or through a bundler, and `dist/sbmlsim-web.umd.cjs` is the same library for a `require` and for a page which wants the `sbmlsimWeb` global.

## License

MIT
