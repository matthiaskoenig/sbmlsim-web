/**
 * Stage the demo pages for the end to end tests.
 *
 * The staged directory has the layout of the repository (`demo/`, `dist/` and
 * the reveal.js distribution under `node_modules/`), so a page refers to its
 * script as it does in the repository, and it is what `python -m sbmlsim.serve
 * --static` mounts, which makes a page and the endpoint one origin and needs no
 * CORS. `demo/docs.md` is rendered to `docs.html` here: the markdown is the
 * page a documentation site would build, the HTML around it is a stand-in for
 * its theme.
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { marked } from 'marked'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const site = join(root, '.site')

const DOCS_PAGE = (body) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>sbmlsim-web on a docs page</title>
    <style>
      body { max-width: 46rem; margin: 2rem auto; padding: 0 1rem; font: 16px/1.6 system-ui, sans-serif; color: #24292f; }
      h1 { font-size: 1.8rem; line-height: 1.25; }
    </style>
  </head>
  <body>
${body}
  </body>
</html>
`

await rm(site, { recursive: true, force: true })
await mkdir(join(site, 'demo'), { recursive: true })
await cp(join(root, 'dist'), join(site, 'dist'), { recursive: true })
await cp(join(root, 'demo'), join(site, 'demo'), { recursive: true })
await cp(join(root, 'node_modules/reveal.js/dist'), join(site, 'node_modules/reveal.js/dist'), {
  recursive: true,
})
const markdown = await readFile(join(root, 'demo/docs.md'), 'utf8')
await writeFile(join(site, 'demo/docs.html'), DOCS_PAGE(await marked.parse(markdown)))
