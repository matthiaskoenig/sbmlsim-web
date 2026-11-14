/**
 * Stage the demo pages for the end to end tests.
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

/** The release of Zensical the documentation page is built with. */
const ZENSICAL = 'zensical==0.1.0'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const site = join(root, '.site')

await rm(site, { recursive: true, force: true })
await mkdir(join(site, 'demo'), { recursive: true })
await cp(join(root, 'dist'), join(site, 'dist'), { recursive: true })
await cp(join(root, 'demo'), join(site, 'demo'), { recursive: true })
await cp(join(root, 'node_modules/reveal.js/dist'), join(site, 'node_modules/reveal.js/dist'), {
  recursive: true,
})

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
