/**
 * Build or serve the documentation site.
 *
 * The pages of `docs/` load the elements from the bundle of this checkout and
 * not from a CDN, so the site documents the library it is built with and an
 * example page draws its panels with it. The bundle (`dist/sbmlsim-web.iife.js`
 * of `npm run build`, with its source map) is copied into `docs/assets/
 * sbmlsim-web/`, which `extra_javascript` of `zensical.toml` names and which
 * is ignored by git, and Zensical then builds the site into `site/` or serves
 * it. Zensical runs through `uvx` at the pinned release (`ZENSICAL`).
 *
 * Usage: `node scripts/docs.mjs build` (what `npm run docs` runs after the
 * build of the library) or `node scripts/docs.mjs serve` (`npm run docs:serve`).
 */
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ZENSICAL } from './zensical.mjs'

/** The files of the build the pages load. */
const BUNDLE = ['sbmlsim-web.iife.js', 'sbmlsim-web.iife.js.map']

/** The commands of Zensical this script runs, with their arguments. */
const COMMANDS = {
  build: ['build', '--clean'],
  serve: ['serve'],
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const command = process.argv[2] ?? 'build'
if (!(command in COMMANDS)) {
  console.error(`usage: node scripts/docs.mjs [${Object.keys(COMMANDS).join('|')}]`)
  process.exit(2)
}

const target = join(root, 'docs/assets/sbmlsim-web')
await mkdir(target, { recursive: true })
for (const name of BUNDLE) {
  const source = join(root, 'dist', name)
  if (!existsSync(source)) {
    console.error(`${source} is missing: run npm run build first`)
    process.exit(1)
  }
  await copyFile(source, join(target, name))
}

const run = spawnSync('uvx', ['--from', ZENSICAL, 'zensical', ...COMMANDS[command]], {
  cwd: root,
  stdio: 'inherit',
})
if (run.status !== 0) {
  console.error(`zensical ${command} failed with ${String(run.status ?? run.signal)}`)
  process.exit(1)
}
