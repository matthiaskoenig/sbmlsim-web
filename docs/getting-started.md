# Getting started

## What you need

- **An endpoint** which answers the routes of the service of sbmlsim: the service itself, **sbmlsim >= 0.24.0** (`python -m sbmlsim.serve`), the first release which serves the contracts, or a function of the page which answers the same routes ([Endpoints](endpoints.md)).
- **A browser** which resolves `light-dark()` and lays out CSS subgrids: Chrome and Edge 123, Firefox 120 and Safari 17.5 or newer. An older browser draws the light figure whatever the scheme of the page.

## Load the elements

=== "Script tag"

    A page loads one script from a CDN, which registers both elements; the script is pinned to a release, so a page does not change under its readers when a new one is published:

    ```html
    <script src="https://cdn.jsdelivr.net/npm/sbmlsim-web@0.5.0/dist/sbmlsim-web.iife.js"></script>
    ```

    `https://unpkg.com/sbmlsim-web@0.5.0` serves the same file. It is an IIFE bundle which defines the global `sbmlsimWeb` with every export of the package (`sbmlsimWeb.registerEndpoint`, `sbmlsimWeb.register`, ...), a `.js` file which a static server serves as a script.

=== "npm"

    ```bash
    npm install sbmlsim-web
    ```

    ```js
    import 'sbmlsim-web' // registers <sbmlsim-panel> and <sbmlsim-app>
    ```

    The package is an ES module with a UMD build for a `require` (`sbmlsim-web.umd.cjs`) and the IIFE bundle (`sbmlsim-web/iife`). Vue is inlined in every bundle and is no dependency of the package, so a project which runs a Vue of its own gets no second copy in its dependencies. The types (`dist/types`) give `document.querySelector('sbmlsim-panel')` its methods in TypeScript, and `sbmlsim-web/theme.css` is the table of the design tokens.

Importing the package registers both elements under their tags. The registration does nothing where a tag is taken already, which a page which loads the library twice does, and nothing at all where there are no custom elements (node, a server side render).

## A panel

One tag draws one panel of a model. `endpoint` is the service, `model` and `panel` the ids it serves, and `auto` starts the element when it is connected:

```html
<script src="https://cdn.jsdelivr.net/npm/sbmlsim-web@0.5.0/dist/sbmlsim-web.iife.js"></script>
<sbmlsim-panel
  endpoint="https://models.example.org"
  model="hctz"
  panel="renal_plasma"
  auto
></sbmlsim-panel>
```

Without `auto` nothing is fetched and nothing is drawn before the page calls `activate()`, which is what a deck with every slide in the page or a long page which mounts its panels lazily wants:

```html
<sbmlsim-panel
  endpoint="https://models.example.org"
  model="hctz"
  panel="renal_plasma"
></sbmlsim-panel>
<script type="module">
  for (const panel of document.querySelectorAll('sbmlsim-panel')) panel.activate()
</script>
```

## An app

One tag draws the app of a model, with its pages, its variants and its shared knobs, which the model declares:

```html
<script src="https://cdn.jsdelivr.net/npm/sbmlsim-web@0.5.0/dist/sbmlsim-web.iife.js"></script>
<sbmlsim-app endpoint="https://models.example.org" model="hctz"></sbmlsim-app>
```

The shell starts itself and the panels it places; it needs no `auto` and no script.

## An endpoint

A page of another origin than the service is answered only when the service allows its origin:

```bash
python -m sbmlsim.serve --model hctz=examples.panels.hctz:PROJECT --allow-origin https://docs.example.org
```

A page which the service serves itself (`--static DIR`) is of its origin and writes `endpoint=""`; a page without a server registers a function which answers the routes inside the page. Both are described in [Endpoints](endpoints.md).

## Listen to the elements

The elements dispatch events which bubble out of their shadow root:

```js
document.addEventListener('sbmlsim-error', (event) => {
  console.log(event.detail.kind, event.detail.message)
})
document.addEventListener('sbmlsim-result', (event) => {
  console.log(event.detail.spec_hash, event.detail.provenance.engine)
})
```

[Components](components.md) lists every attribute, method and event.
