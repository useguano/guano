#!/usr/bin/env node
// Guano CLI.
//   guano dev     start the server for local editing (http, relaxed cookie)
//   guano start   start the server for production (NODE_ENV=production)
//   guano build   export the current project as a static site (./dist-site)
// Env: PORT, GUANO_DATA_DIR (default ./data when installed), COOKIE_SECURE,
// PUBLISH_TOKEN, MEDIA_QUOTA — see the README.
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const [cmd, ...rest] = process.argv.slice(2)

const HELP = `guano — self-hosted visual website builder

Usage:
  guano dev              start the server for local editing
  guano start            start the server for production
  guano build [--out d]  export the published project as a static site
                         (default ./dist-site)
  guano connect          set up Claude Desktop automatically: mints an API
                         token, settles what the agent may do (--main lets it
                         edit the live project, --publish lets it publish;
                         with neither it asks, --yes skips) and writes the MCP
                         config (quit Claude first; --print emits the snippet
                         for other MCP clients). Works before /admin setup
                         too — the token is bound to the first admin.
                         --offline never talks to a server (what
                         \`npm create @useguano\` runs for you)
  guano mcp              run the MCP server (stdio) for AI agents
  guano --version

The admin editor is served at /admin, your published site at /.
Data lives in $GUANO_DATA_DIR (default ./data). Docs: see the README.

guano mcp connects to a RUNNING instance over HTTP — set GUANO_URL
(default http://localhost:4174) and GUANO_TOKEN. \`guano connect\` sets
both up for you; manual tokens live in the editor under My account →
API tokens.
`

async function version() {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  console.log(pkg.version)
}

const startServer = () => import(pathToFileURL(join(ROOT, 'server', 'index.mjs')).href)

async function buildSite() {
  const outFlag = rest.indexOf('--out')
  const outDir = resolve(outFlag !== -1 && rest[outFlag + 1] ? rest[outFlag + 1] : 'dist-site')
  const { DATA_DIR } = await import(pathToFileURL(join(ROOT, 'server', 'util.mjs')).href)
  const { exportSite } = await import(pathToFileURL(join(ROOT, 'server', 'export.mjs')).href)
  let project
  try {
    // the current project, Main branch (what "apply to site" publishes)
    project = JSON.parse(
      await readFile(join(DATA_DIR, 'store', 'guano-project__main.json'), 'utf8'),
    )
  } catch {
    console.error(`no project found in ${join(DATA_DIR, 'store')} — run \`guano dev\`, create your site, then build.`)
    process.exit(1)
  }
  // v2 FIRST. The server migrates every blob at boot, but `guano build` reads
  // the store file directly, so a store written before the schema change (or
  // one restored from a backup) reached the exporter as v1: the aliases it no
  // longer collapses, and an instance still stored as an unexpanded `:Card:`
  // leaf, which renders as NOTHING — the page silently missing its card.
  // In memory only; persisting is the server's job, at boot, behind a backup.
  const migrated = await migrateInMemory(project)
  if (migrated) console.log(`guano build: ${migrated}`)
  const stats = await exportSite(project, outDir)
  console.log(`exported ${stats.routes} routes (${(stats.bytes / 1024).toFixed(1)} kB) to ${outDir}`)
}

/** bring one blob up to the current schema, returning a one-line summary of
 * what changed (or null). The bundle lives at `runtime/` in both the repo and
 * the packed layout; a missing one is a warning, never a failed build. */
async function migrateInMemory(project) {
  const mod = await import(
    pathToFileURL(join(ROOT, 'runtime', 'mcp-runtime.mjs')).href
  ).catch(() => null)
  if (!mod?.migrateProject) {
    console.warn(
      'guano build: schema migration skipped — the editor-logic bundle is missing ' +
        '(run `npm run build:mcp-runtime`). An older project may export incompletely.',
    )
    return null
  }
  const { report } = mod.migrateProject(project)
  return mod.describeMigration('guano-project:main', report)
}

switch (cmd) {
  case 'dev':
    await startServer()
    break
  case 'start':
    process.env.NODE_ENV ??= 'production'
    await startServer()
    break
  case 'build':
    await buildSite()
    break
  case 'mcp': {
    const { main } = await import(pathToFileURL(join(ROOT, 'mcp', 'server.mjs')).href)
    await main()
    break
  }
  case 'connect': {
    const { main } = await import(pathToFileURL(join(ROOT, 'mcp', 'connect.mjs')).href)
    try {
      await main(rest)
    } catch (e) {
      console.error(`✗ ${e.message}`)
      process.exit(1)
    }
    break
  }
  case '--version':
  case '-v':
    await version()
    break
  case '--help':
  case '-h':
  case undefined:
    console.log(HELP)
    break
  default:
    console.error(`unknown command: ${cmd}\n`)
    console.log(HELP)
    process.exit(1)
}
