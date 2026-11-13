/**
 * Run the end to end tests against a live sbmlsim endpoint.
 *
 * The endpoint is the python package, which lives in another repository: the
 * checkout is `SBMLSIM_REPO` (`../sbmlsim` without), and the pages are served
 * by it (`--static`), so the tests need that checkout, `uv` and Chrome. Where
 * the checkout is not there - the continuous integration of this repository
 * has no other repository - the run is skipped and says so, and does not fail.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(process.env.SBMLSIM_REPO ?? join(root, '../sbmlsim'))

if (!existsSync(join(repo, 'pyproject.toml'))) {
  console.log(`e2e skipped: no sbmlsim checkout at ${repo} (set SBMLSIM_REPO)`)
  process.exit(0)
}
const run = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, SBMLSIM_REPO: repo },
})
process.exit(run.status ?? 1)
