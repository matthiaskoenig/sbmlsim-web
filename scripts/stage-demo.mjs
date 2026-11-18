/**
 * Stage the demo pages for the end to end tests.
 *
 * The glimepiride example of the documentation is staged as well (`docs/examples/glimepiride`
 * and the bundle under `assets/`), since it is a page of static files which needs no endpoint:
 * `e2e/example.spec.ts` drives it where the service serves it.
 *
 * The staged directory has the layout of the repository (`demo/`, `dist/` and
 * the reveal.js distribution under `node_modules/`), so a page refers to its
 * script as it does in the repository, and it is what `python -m sbmlsim.serve
 * --static` mounts, which makes a page and the endpoint one origin and needs no
 * CORS. `demo/docs.md` is built to `docs.html` here by Zensical with the site
 * of `demo/zensical.toml`, so the page the tests drive is the one a
 * documentation site writes, with its theme, its palettes and its handling of
 * raw HTML. Zensical runs through `uvx` at the version sbmlsim builds its own
 * documentation with (`ZENSICAL`).
 */
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ZENSICAL } from './zensical.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const site = join(root, '.site')

await rm(site, { recursive: true, force: true })
await mkdir(join(site, 'demo'), { recursive: true })
await cp(join(root, 'dist'), join(site, 'dist'), { recursive: true })
await cp(join(root, 'demo'), join(site, 'demo'), { recursive: true })
await cp(join(root, 'node_modules/reveal.js/dist'), join(site, 'node_modules/reveal.js/dist'), {
  recursive: true,
})

// the glimepiride example, the page of the documentation which is static files: the example
// itself and the bundle of this checkout, which its page loads as the pages of the site do
await mkdir(join(site, 'examples'), { recursive: true })
await cp(join(root, 'docs/examples/glimepiride'), join(site, 'examples/glimepiride'), {
  recursive: true,
})
await mkdir(join(site, 'assets/sbmlsim-web'), { recursive: true })
for (const file of ['sbmlsim-web.iife.js', 'sbmlsim-web.iife.js.map']) {
  await cp(join(root, 'dist', file), join(site, 'assets/sbmlsim-web', file))
}

// the site of the documentation page is built apart and laid over the demo
const build = await mkdtemp(join(tmpdir(), 'sbmlsim-web-docs-'))
try {
  await mkdir(join(build, 'docs'))
  await cp(join(root, 'demo/zensical.toml'), join(build, 'zensical.toml'))
  await cp(join(root, 'demo/docs.md'), join(build, 'docs/docs.md'))
  await cp(join(root, 'demo/docs.css'), join(build, 'docs/docs.css'))
  const built = spawnSync('uvx', ['--from', ZENSICAL, 'zensical', 'build'], {
    cwd: build,
    stdio: 'inherit',
  })
  if (built.status !== 0) {
    throw new Error(`zensical build failed with ${String(built.status ?? built.signal)}`)
  }
  await cp(join(build, 'site'), join(site, 'demo'), { recursive: true })
} finally {
  await rm(build, { recursive: true, force: true })
}
