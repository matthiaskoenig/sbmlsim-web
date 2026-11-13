/**
 * Run the end to end tests against a live sbmlsim endpoint.
 *
 * The endpoint is the python package, which lives in another repository: the
 * checkout is `SBMLSIM_REPO` (`../sbmlsim` without), and the pages are served
 * by it (`--static`), so the tests need that checkout, `uv` and Chrome. Where
 * the checkout is not there at its default place - the continuous integration
 * of this repository has no other repository - the run is skipped and says so,
 * as a notice of the run under GitHub Actions; a `SBMLSIM_REPO` which is set
 * and wrong fails, so a typo does not hide the suite.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const explicit = process.env.SBMLSIM_REPO
const repo = resolve(explicit ?? join(root, '../sbmlsim'))

if (!existsSync(join(repo, 'pyproject.toml'))) {
  // a path which was given and is wrong is a typo, and a typo must not hide the
  // whole suite; only the default place of the checkout may be empty
  if (explicit !== undefined) {
    console.error(`e2e failed: SBMLSIM_REPO is set to ${repo}, which is no sbmlsim checkout`)
    process.exit(1)
  }
  const reason = `no sbmlsim checkout at ${repo} (set SBMLSIM_REPO)`
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log(`::notice title=e2e skipped::${reason}`)
  }
  console.log(`e2e skipped: ${reason}`)
  process.exit(0)
}
const run = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, SBMLSIM_REPO: repo },
})
process.exit(run.status ?? 1)
