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

`plotSvg(spec)` draws a figure as one inline SVG string: the axes with their ticks and their units, one path per curve, the study data as markers with error bars under them, and a legend of up to ten curves or, above them, a colour bar, which is where sbmlsim draws one. It is pure - a string in, a string out, no dom, no canvas and no plotting library - so the same figure is built in a page, in a test and in a worker, and it stays crisp under the transform of a slide. A logarithmic axis follows the rule of sbmlsim (at most six decades below the largest value), so a web figure and a matplotlib figure of the same data have the same limits.

Every colour, font and stroke width of a figure is a `--sbmlsim-*` token whose fallback is the value of the style of the sbmlsim reports, so a page which loads nothing still gets the figure of a report. `src/theme.css` (`sbmlsim-web/theme.css`) carries those tokens in light and dark, and a page which sets one of them on the element it draws a panel in gets the figure in its own colours.

## The element

A page writes one tag and calls `activate()` on it:

```html
<script type="module" src="sbmlsim-web.js"></script>
<sbmlsim-panel
  endpoint="https://models.example.org"
  model="MODEL"
  panel="PANEL"
  fallback="./stored.json"
></sbmlsim-panel>
<script type="module">
  for (const one of document.querySelectorAll('sbmlsim-panel')) one.activate()
</script>
```

| attribute  | what it is                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `endpoint` | the service the panel talks to; empty is the origin of the page, which is the teaching mode                           |
| `model`    | the id of the model, as the endpoint serves it                                                                        |
| `panel`    | the id of the panel of that model                                                                                     |
| `layout`   | `auto` (the default, the controls beside the figure above 560 px and under it below), `sidebar`, `stacked`, `toolbar` |
| `theme`    | `auto` (the default, `prefers-color-scheme`), `light`, `dark`                                                         |
| `fallback` | the url of a stored answer of a run, drawn when the endpoint does not answer                                          |
| `timeout`  | the milliseconds one request is given, 8000 without                                                                   |

`activate()` starts it, `freeze()` stops every pending request and freezes the knobs, and `reset()` puts the knobs back to the values the declaration states. Nothing is fetched and nothing is drawn before `activate()`, so a slide deck or a long page mounts its panels lazily. The element registers itself on import under `sbmlsim-panel`; `register(tagName)` gives it another tag.

**A request grids over at most one knob.** The first run grids over the first `range` knob of the panel at its declared `steps`, with every other knob at its default, and while that knob moves every movement is read out of the grid locally: five moves of it are no request at all. Releasing any other knob schedules one run which grids over **that** knob instead and holds the one which was gridded before at the value it now has, so the knob a reader is working with is always the one which costs nothing. An `input` event interpolates and redraws, a `change` event schedules a run, and a scheduled run which is superseded is cancelled rather than raced.

**Nothing rejects into the page.** A dead network, a slow endpoint, a refused request, a payload of another contract version and a body which cannot be read are all caught inside the element, retried once where that can help, and resolved into the stored result with frozen knobs and one line a reader can act on. The line names no url and no host. The element also dispatches `sbmlsim-error` (`{detail: {kind, message}}`, bubbling and composed) so a page can react. The stored result is fetched on `activate()` next to the declaration and not when a request fails, because an endpoint which cannot be reached cannot serve a fallback either.

The element has a shadow root, so the styles of the host page cannot reach it and it cannot leak into the page; the `--sbmlsim-*` tokens, which `theme.css` declares on `:host` as well as on `:root`, are the one hook from outside.

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
