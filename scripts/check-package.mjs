/**
 * Check the package a publish would ship against the build.
 *
 * Every entry point `package.json` names - `main`, `module`, `types`, `unpkg`,
 * `jsdelivr` and every target of `exports` - exists and is in the files `npm
 * pack` ships, and no type file the package ships imports anything of vue,
 * which the bundles inline and the package does not depend on: a consumer
 * installs no vue for the types and gets no second one beside its own. The
 * declarations `vue-tsc` writes for the components themselves import vue and
 * are reached from no entry point, so `files` leaves them out of the package.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const problems = []

/** Every string a nested object of entry points holds. */
function targets(value) {
  return typeof value === 'string' ? [value] : Object.values(value ?? {}).flatMap(targets)
}

const entries = [pkg.main, pkg.module, pkg.types, pkg.unpkg, pkg.jsdelivr, ...targets(pkg.exports)]
const report = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
  }),
)
// npm 10 answers a list of the packages, npm 11 an object of them by name
const packed = (Array.isArray(report) ? report[0] : report[pkg.name]).files.map((one) => one.path)
for (const entry of entries) {
  const path = normalize(entry)
  if (!existsSync(join(root, path))) {
    problems.push(`${entry} is named by package.json and was not built`)
  } else if (!packed.includes(path)) {
    problems.push(`${entry} is named by package.json and is not packed`)
  }
}
// every type file which is shipped, whether an entry point reaches it or not
for (const file of packed.filter((one) => one.endsWith('.d.ts'))) {
  const text = readFileSync(join(root, file), 'utf8')
  for (const [, module] of text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
    if (module === 'vue' || module.startsWith('vue/') || module.startsWith('@vue/')) {
      problems.push(`${file} is packed and imports ${module}`)
    }
  }
}
if (Object.keys(pkg.dependencies ?? {}).includes('vue')) {
  problems.push('vue is a dependency, although every bundle inlines it')
}

// the types of the entry point and every module they import, none of them vue
const seen = new Set()
const queue = [normalize(pkg.types)]
while (queue.length > 0) {
  const file = queue.pop()
  if (seen.has(file)) {
    continue
  }
  seen.add(file)
  const text = readFileSync(join(root, file), 'utf8')
  for (const [, module] of text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
    if (module === 'vue' || module.startsWith('vue/') || module.startsWith('@vue/')) {
      problems.push(`${file} imports ${module}`)
    } else if (module.startsWith('.')) {
      const next = normalize(join(dirname(file), `${module.replace(/\.js$/, '')}.d.ts`))
      if (!existsSync(join(root, next))) {
        problems.push(`${file} imports ${module}, which has no types`)
      } else {
        queue.push(next)
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`the package does not match the build:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log(
  `the package matches the build: ${String(entries.length)} entry points, ${String(seen.size)} type files`,
)
