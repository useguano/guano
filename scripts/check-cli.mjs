// The shipped CLI, checked the way a user meets it. 0.1.4 published a
// bin/guano.js whose HELP template literal held an unescaped backtick, so
// EVERY subcommand died with a SyntaxError before running a line — and nothing
// in the repo ever loaded the file, so every gate passed. The parse sweep is
// the cheap half; actually invoking the CLI is the half that proves the
// published entry point runs at all.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { globSync } from 'node:fs'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const fails = []
const fail = (msg) => fails.push(msg)

const node = process.execPath
const run = (args, opts = {}) =>
  execFileSync(node, args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })

// 1. every shipped module parses
const files = globSync(['packages/**/*.{js,mjs,cjs}', 'server/**/*.{js,mjs,cjs}', 'scripts/*.mjs'], {
  cwd: REPO,
  exclude: (p) => p.includes('node_modules'),
})
let parsed = 0
for (const rel of files.sort()) {
  try {
    run(['--check', join(REPO, rel)])
    parsed++
  } catch (e) {
    fail(`${rel} does not parse:\n${String(e.stderr || e.message).trim().split('\n').slice(0, 3).join('\n')}`)
  }
}
console.log(`parsed ${parsed}/${files.length} shipped modules`)

// 2. the bin entries exist, carry a shebang, and are the file package.json names
const pkgs = ['packages/guano', 'packages/create-guano']
for (const dir of pkgs) {
  const pkg = JSON.parse(readFileSync(join(REPO, dir, 'package.json'), 'utf8'))
  for (const [name, rel] of Object.entries(pkg.bin ?? {})) {
    let src
    try {
      src = readFileSync(join(REPO, dir, rel), 'utf8')
    } catch {
      fail(`${pkg.name}: bin "${name}" points at ${rel}, which does not exist`)
      continue
    }
    if (!src.startsWith('#!')) fail(`${pkg.name}: ${rel} has no shebang, so an installed "${name}" cannot run`)
  }
}

// 3. the CLI actually runs — --version, --help and an unknown command. These
//    are the three paths that touch no server and no data dir.
const CLI = join(REPO, 'packages', 'guano', 'bin', 'guano.js')
const version = JSON.parse(readFileSync(join(REPO, 'packages', 'guano', 'package.json'), 'utf8')).version
try {
  const out = run([CLI, '--version']).trim()
  if (out !== version) fail(`guano --version printed "${out}", package.json says "${version}"`)
} catch (e) {
  fail(`guano --version failed:\n${String(e.stderr || e.message).trim()}`)
}

let help = ''
try {
  help = run([CLI, '--help'])
} catch (e) {
  fail(`guano --help failed:\n${String(e.stderr || e.message).trim()}`)
}
if (help) {
  for (const needle of ['Usage:', 'guano dev', 'guano mcp', 'guano connect', '`npm create @useguano`', '`guano connect`']) {
    if (!help.includes(needle)) fail(`guano --help no longer mentions ${needle}`)
  }
  if (help.includes('\\`')) fail('guano --help prints literal \\` — a backtick escape leaked into the output')
}

try {
  run([CLI, 'nonsense-command'])
  fail('guano nonsense-command exited 0; an unknown command must exit 1')
} catch (e) {
  if (e.status !== 1) fail(`guano nonsense-command exited ${e.status}, expected 1`)
  else if (!String(e.stderr).includes('unknown command')) fail('an unknown command does not say so')
}

if (fails.length) {
  console.error(`\n${fails.length} problem${fails.length > 1 ? 's' : ''}:\n`)
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('CLI OK — parses, runs, and reports its version')
