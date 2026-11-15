// Register the endpoint `local:glimepiride` of the example: the routes of the sbmlsim service
// answered inside the page from the bundle of the glimepiride app (`bundle/`), whose simulations
// run on sbmlsim-core in a pool of Web Workers. The elements of sbmlsim-web
// (`sbmlsimWeb`, loaded before this module) wait for the registration, so this module may run
// after they connected. Both the documentation page and `app.html` load it.
import { createPanelEndpoint } from './sbmlsim-core/panels.mjs'

globalThis.sbmlsimWeb.registerEndpoint(
  'local:glimepiride',
  createPanelEndpoint({ bundle: new URL('./bundle/bundle.json', import.meta.url) }),
)
