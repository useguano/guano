// prepack: build the admin SPA + the MCP runtime bundle at the repo root, then
// copy the runtime pieces into this package so the tarball is self-contained:
//   dist/            the built admin SPA (served at /admin)
//   runtime/         the bundled MCP runtime (mcp-runtime.mjs; `guano mcp`)
//   server/          the node server (code files only — NEVER server/data),
//                    including the built motion-runtime.js the exporter ships
//                    and server/public/, the unauthenticated namespace
//   src/lib/shared/  plain-JS modules the server imports as ../src/lib/shared
// The copied layout mirrors the repo exactly, so no import rewriting is
// needed and the packed server runs identically to the repo one.
// (runtime/ is written directly into this package by vite.mcp.config.ts, so it
// needs building here but no copy step.)
import { execSync } from 'node:child_process'
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = fileURLToPath(new URL('..', import.meta.url))
const REPO = join(PKG, '..', '..')

// the shipped CLI, before anything else: 0.1.4 published a bin/guano.js that
// did not parse, so every subcommand died on load. A tarball whose entry point
// cannot run is not worth building.
console.log('prepack: checking the CLI…')
execSync('npm run check:cli', { cwd: REPO, stdio: 'inherit' })

console.log('prepack: building the admin SPA…')
execSync('npm run build', { cwd: REPO, stdio: 'inherit' })

console.log('prepack: building the MCP runtime bundle…')
execSync('npm run build:mcp-runtime', { cwd: REPO, stdio: 'inherit' })

// the published site's tween runtime — emitted into server/, so it ships with
// the server copy below
console.log('prepack: building the motion runtime…')
execSync('npm run build:motion', { cwd: REPO, stdio: 'inherit' })

// the published site's carousel runtime — same deal, emitted into server/
console.log('prepack: building the slider runtime…')
execSync('npm run build:slider', { cwd: REPO, stdio: 'inherit' })

for (const dir of ['dist', 'server', 'src']) {
  await rm(join(PKG, dir), { recursive: true, force: true })
}

await cp(join(REPO, 'dist'), join(PKG, 'dist'), { recursive: true })

await mkdir(join(PKG, 'server'), { recursive: true })
for (const f of await readdir(join(REPO, 'server'))) {
  // code files only — server/data holds live user data and must never ship
  if (!f.endsWith('.mjs') && !f.endsWith('.js')) continue
  await cp(join(REPO, 'server', f), join(PKG, 'server', f))
}

// server/public/ is a DIRECTORY of modules index.mjs imports (the public
// namespace: forms, store, cors, csv, deliver). The loop above reads one level
// and filters on filename, so it shipped none of them and the packed server
// died on its first import — copy the tree whole.
await cp(join(REPO, 'server', 'public'), join(PKG, 'server', 'public'), {
  recursive: true,
})

await cp(join(REPO, 'src', 'lib', 'shared'), join(PKG, 'src', 'lib', 'shared'), {
  recursive: true,
})

// the licence exceptions are listed in `files`, so a stale copy ships as the
// licence — restage it from the root rather than trusting the one on disk
for (const pkg of [PKG, join(REPO, 'packages', 'create-guano')]) {
  await cp(join(REPO, 'LICENSE-EXCEPTIONS.md'), join(pkg, 'LICENSE-EXCEPTIONS.md'))
}

console.log('prepack: dist/, runtime/, server/, src/lib/shared/, LICENSE-EXCEPTIONS.md staged')
