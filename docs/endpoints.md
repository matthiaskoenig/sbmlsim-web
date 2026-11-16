# Endpoints

The `endpoint` of an element names who answers its requests. The elements speak the routes of the service of sbmlsim and nothing else, so an endpoint is either that service, on a server, or a function of the page which answers the same routes inside the page.

| `endpoint`                   | who answers                                                                |
| ---------------------------- | -------------------------------------------------------------------------- |
| `https://models.example.org` | the service of sbmlsim at that origin, which allows the origin of the page |
| empty                        | the origin of the page itself: a page the service serves (`--static`)      |
| `local:<name>`               | the function the page registered under that name (`registerEndpoint`)      |

## The routes

| route                                                  | answers                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `GET /api/models/{model}/app?variant=`                 | the app of the model (`app/1`), a 404 for a model without one                    |
| `GET /api/models/{model}/panels/{panel}?variant=`      | the declaration of a panel (`panel/1`)                                           |
| `GET /api/models/{model}/panels/{panel}/data?variant=` | the study data under its curves (`paneldata/1`)                                  |
| `POST /api/models/{model}/panels/{panel}/simulate`     | a run of the panel at the values of its knobs or over a grid of them (`panel/1`) |

The ids are encoded as path components, the query `variant` is left out for the default variant, and the body of a simulation is `{"values": {...}, "grid": {...}, "variant": "..."}` ([Contracts](contracts.md)). Every request is bounded by the `timeout` of the element, carries no credential, and a 503 with a `Retry-After` is sent again after the time it names, at most six times.

## The service of sbmlsim

`python -m sbmlsim.serve` of [sbmlsim](https://matthiaskoenig.github.io/sbmlsim/) (>= 0.24.0, with the extra `web`) serves the panels and the apps of the models of the command line, simulates them on its own engines and keeps their answers in a cache ([Interactive panels](https://matthiaskoenig.github.io/sbmlsim/serve/) of its documentation).

**The teaching mode.** One command serves the pages and the API from one process, so the page is of the origin of the API and writes `endpoint=""`:

```bash
pip install "sbmlsim[web]"
python -m sbmlsim.serve --model hctz=examples.panels.hctz:PROJECT --static slides --open
```

`--static DIR` is mounted at `/` after the routes, so the deck in `slides/` is `http://127.0.0.1:8000/` and talks to its own origin. That is what keeps a lecture working in a browser of 2026: a request from a public `https` page to `http://localhost` is Local Network Access in Chrome, which asks the reader for a permission, and mixed content in Safari, which blocks it; a page of the origin of the API needs neither and no CORS header at all.

**A page of another origin.** A documentation site on GitHub Pages or a course talks to a public `https` endpoint, which allows each origin which embeds the panels:

```bash
python -m sbmlsim.serve --model hctz=examples.panels.hctz:PROJECT --host 0.0.0.0 --allow-origin https://docs.example.org
```

A public deployment runs behind a reverse proxy which terminates TLS and limits the rate and the body of the requests, keeps `--experiments` off and probes `GET /healthz`; the documentation of sbmlsim lists what it must set.

## An endpoint inside the page

An `endpoint` which starts with `local:` is no server: it is answered by a function of the page itself, which the page registers under that exact name with `registerEndpoint`. This is how a static page (GitHub Pages, a course, a file share) runs the panels of a model without a service: the function answers the routes inside the page, e.g. on a simulator which runs in Web Workers in the browser of the reader.

```ts
registerEndpoint(endpoint: string, fetcher: EndpointFetch): void

type EndpointFetch = (url: string, init: RequestInit) => Promise<Response>
```

[sbmlsim-core](https://matthiaskoenig.github.io/sbmlsim-core/) has such a function: `createPanelEndpoint` of its npm package (`sbmlsim-core/panels`) answers the routes from a bundle of the panels of a model which sbmlsim exports (`python -m sbmlsim.serve --model id=module:attribute --export DIR`, sbmlsim >= 0.25.0), simulating the compiled model in WebAssembly on a pool of Web Workers. A page of an app on it is the script of the elements, the tag and a module script which registers the endpoint:

```html
<script src="https://cdn.jsdelivr.net/npm/sbmlsim-web@0.3.0/dist/sbmlsim-web.iife.js"></script>
<sbmlsim-app endpoint="local:glimepiride" model="glimepiride"></sbmlsim-app>
<script type="module">
  import { createPanelEndpoint } from 'https://cdn.jsdelivr.net/npm/sbmlsim-core@0.6.0/panels.mjs'

  sbmlsimWeb.registerEndpoint(
    'local:glimepiride',
    createPanelEndpoint({ bundle: new URL('./bundle/glimepiride/bundle.json', location.href) }),
  )
</script>
```

`registerEndpoint` is in the releases from 0.2.0 on, and both scripts are pinned to a release, as on any page; the npm package `sbmlsim-core` starts the workers of its pool from a module of the page's origin, so it runs from the CDN as well, and only the bundle (`bundle.json` and the compiled model) is a file of the site. Any function with the signature of `fetch` will do; one which answers every request with a stored payload is a few lines:

```js
import { registerEndpoint } from 'sbmlsim-web'

const stored = { '/api/models/demo/panels/plasma': declaration /* , ... */ }

registerEndpoint('local:demo', async (url, init) => {
  const path = url.slice('local:demo'.length).split('?')[0]
  const body = stored[path]
  return body === undefined
    ? Response.json({ detail: 'Not found.' }, { status: 404 })
    : Response.json(body)
})
```

What the client does with the function:

- **It hands it what it would hand `fetch`.** The url is the endpoint joined with the path of the route, `local:demo/api/models/demo/panels/plasma/simulate`, with `?variant=` where a route is read in a variant, and the `init` is the one `fetch` gets: the method, the headers, the body of a POST as JSON text, `credentials: 'omit'` and the signal which stops the request.
- **It reads the `Response` as one of the network.** A status which is no success is an `http` failure, a 503 with a `Retry-After` is sent again after that time, the body is parsed as JSON, its `contract` is checked and its shape guarded. A rejection, or an exception the function throws, is a `network` failure.
- **It bounds it with the timeout and the signal.** A request which the function does not answer within the `timeout` of the element is a `timeout`, and one the element stops (a superseded run, `freeze()`) is stopped, also when the function does not listen to the signal it was given; the function may stop its own work on that signal.
- **It waits for the registration.** An element may connect before its endpoint is registered, which is what a page does whose module script registers it after the elements started: its requests wait for the registration, within their timeout and their signal, and are sent to the function as soon as it is there.
- **One name, one function.** A second registration of a name replaces the first for the requests sent after it, a trailing slash is no part of the name (`local:demo/` is `local:demo`), and registering a name which does not start with `local:` throws a `TypeError`, so a url of the network is never answered by the page. The `fallback` of a panel is a file of its own and is always fetched over the network.
