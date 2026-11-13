import { defineConfig } from '@playwright/test'

/** The port of the endpoint, which also serves the pages. */
const PORT = process.env.E2E_PORT ?? '8791'
/** The checkout of the python package, which `scripts/e2e.mjs` has checked. */
const REPO = process.env.SBMLSIM_REPO ?? '../sbmlsim'

// The tests drive the Chrome which is installed (`channel: 'chrome'`) instead
// of a browser which playwright downloads. The pages are staged by
// `scripts/stage-demo.mjs` and served by the endpoint itself with `--static`,
// so a page and its API are one origin.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'chrome',
    headless: true,
  },
  webServer: {
    command:
      `node scripts/stage-demo.mjs && cd "${REPO}" && uv run python -m sbmlsim.serve ` +
      `--model hctz=examples.panels.hctz:PROJECT --host 127.0.0.1 --port ${PORT} ` +
      `--static "${process.cwd()}/.site"`,
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
