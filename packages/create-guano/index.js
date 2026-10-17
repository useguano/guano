#!/usr/bin/env node
// @useguano/create: scaffold a project dir that runs Guano via npm scripts,
// install it, and connect Claude — all in this one command, so what
// is left afterwards is `cd my-site && npm run dev`. Zero dependencies —
// prompts with node:readline.
//
//   npm create @useguano [dir] [--no-install] [--no-connect | --connect]
//                        [--main] [--publish] [--config <claude config path>]
//
// The MCP connect runs through the just-installed package's own
// `guano connect --offline`: it mints a PENDING API token into <dir>/data,
// writes the two agent permissions there, and writes the config of every
// Claude client on the machine (Claude Code and Claude Desktop).
// The server binds the token to the first admin at /admin setup, and the
// setup form shows the permissions instead of asking them again.
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import readline from 'node:readline/promises'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name) => {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] : undefined
}
const install = !flag('--no-install')
const interactive = process.stdin.isTTY && process.stdout.isTTY
let dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--config')
const DEFAULT_DIR = 'my-site'

// ---- every question first, so a ^C anywhere here changes nothing ----
const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const ask = (q) => rl.question(q)
const yes = async (q, dflt) => {
  const a = (await ask(`${q} [${dflt ? 'Y/n' : 'y/N'}] `)).trim()
  return a ? /^y(es)?$/i.test(a) : dflt
}

if (!dir) {
  dir = rl ? (await ask(`Project folder (${DEFAULT_DIR}): `)).trim() || DEFAULT_DIR : DEFAULT_DIR
}

// Connect Claude? Flags decide non-interactively (CI never asks and
// never connects); a terminal asks, default yes.
let connect = false
let policyFlags = []
if (flag('--no-connect')) {
  connect = false
} else if (flag('--connect') || flag('--main') || flag('--publish')) {
  connect = true
} else if (rl) {
  connect = await yes('Connect Claude (Code and Desktop) to this site over MCP?', true)
}
if (connect) {
  if (flag('--main')) policyFlags.push('--main')
  if (flag('--publish')) policyFlags.push('--publish')
  if (!policyFlags.length && rl && !flag('--connect')) {
    console.log('\nTwo questions about what the agent may do (change them any time in\n/admin → Settings → MCP → Agent permissions):\n')
    if (await yes('Let agents edit the live project (Main)? Off, they work in a draft you apply yourself.', false))
      policyFlags.push('--main')
    if (await yes('Let agents publish the site? Off, they can still preview their work.', false))
      policyFlags.push('--publish')
    console.log('')
  }
}

const target = resolve(dir)
const name =
  basename(target)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || DEFAULT_DIR

/**
 * The same thing, as a NAME rather than a package slug.
 *
 * `acme-landing` is what npm needs and what the folder is called; "Acme
 * Landing" is what belongs in a field labelled Project name. The setup screen
 * prefills it and the human can change it there — this is a head start, not a
 * decision.
 */
const displayName = name
  .split('-')
  .filter(Boolean)
  .map((w) => w[0].toUpperCase() + w.slice(1))
  .join(' ')

await mkdir(target, { recursive: true })
if ((await readdir(target)).length) {
  rl?.close()
  console.error(`${target} is not empty — refusing to scaffold over existing files`)
  process.exit(1)
}

/**
 * A free port for THIS project, written into .env as an explicit PORT.
 *
 * Every project used to default to 4174, so a second one on the same machine
 * lost the race and walked to the next free port — which left its MCP entry,
 * the Vite proxy and any open tab addressing the FIRST project's socket, where
 * its own token is unknown and the 401 reads as "the token is dead". An
 * explicit port is a contract the server honours instead of walking, and
 * putting it in a file the user can read makes "which port is this site on" a
 * question with an answer.
 *
 * 4174 is still preferred, so a first project looks exactly as documented.
 */
async function pickPort(first = 4174, tries = 40) {
  // One port per site: the preview is served by the same server under
  // /_guano/preview, so there is no second port to keep free above it.
  for (let port = first; port < first + tries; port += 1) {
    if (await free(port)) return port
  }
  return first
}

function free(port) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '0.0.0.0')
  })
}

const port = await pickPort()

const files = {
  'package.json':
    JSON.stringify(
      {
        name,
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: {
          dev: 'guano dev',
          start: 'guano start',
          build: 'guano build',
          connect: 'guano connect',
        },
        dependencies: {
          '@useguano/guano': '^0.1.0',
        },
      },
      null,
      2,
    ) + '\n',

  'guano.config.js': `// Guano reads its configuration from environment variables today
// (see .env.example). This file is reserved for future options.
export default {}
`,

  // A real .env, not just the example: the port is this project's identity on
  // the machine, and leaving it to the 4174 default is what makes two projects
  // fight over one address.
  '.env': `# This project's own port. Keep it — two Guano sites on one machine
# must not share one, or whichever starts first answers for both and the
# other's MCP token is refused with a 401.
PORT=${port}

# What you called this project in the terminal. It prefills the Project name
# on the setup screen, so nobody is asked to name the same thing twice. Only
# read before the first admin account exists; edit the name in the editor
# after that.
GUANO_PROJECT_NAME=${displayName}
`,

  '.env.example': `PORT=${port}
# GUANO_DATA_DIR=./data     # users, media, drafts, the published site — back this up
# COOKIE_SECURE=1           # set 0 only for plain-HTTP LAN setups
# PUBLISH_TOKEN=            # optional: token for CI publishes
# MEDIA_QUOTA=2147483648    # media library ceiling in bytes
`,

  '.gitignore': `node_modules
data/
dist-site/
.env
`,

  'README.md': `# ${name}

A [Guano](https://www.npmjs.com/package/@useguano/guano) site.

\`\`\`sh
npm run dev
\`\`\`

Open http://localhost:${port}/admin, create the first account, then build your
site. Your published site is served at http://localhost:${port}/.

This project runs on port ${port} (set in \`.env\`). Each Guano site on a
machine needs its own, so two of them never answer for one address.

If you said yes to Claude when scaffolding, it is already connected:
the agent token is bound to the admin account you create, and the permissions
you chose (edit the live project, publish) show on the setup form and stay
editable in Settings → MCP → Agent permissions.

- \`npm run start\` — production server (\`NODE_ENV=production\`)
- \`npm run build\` — export the site as static files to \`./dist-site\`
- \`npm run connect\` — connect Claude later, or from another machine (writes Claude Code's \`~/.claude.json\` and Claude Desktop's config; quit Desktop first; \`--main\` / \`--publish\` grant the agent permissions, or it asks)
- everything lives in \`./data\` — **backing up = copying that directory**

See the @useguano/guano package README for deploy notes and environment variables.
`,
}

for (const [file, content] of Object.entries(files)) {
  await writeFile(join(target, file), content)
}
console.log(`Scaffolded ${name} in ${target}`)

let installed = false
if (install) {
  console.log('Installing guano…')
  // npm itself (not `npx`/the create shim) so a failure here is npm's own
  // message; a non-zero exit is reported and the next steps include install.
  const r = spawnSync('npm', ['install'], { cwd: target, stdio: 'inherit', shell: process.platform === 'win32' })
  installed = r.status === 0
  if (!installed) console.error('\nnpm install failed — run it yourself in the project folder.')
}

// ---- connect Claude, through the installed package ----
// GUANO_CREATE_LOCAL_PKG is a dev-only escape hatch: with --no-install there
// is no node_modules, so a repo checkout names its own packages/guano here.
let connected = false
if (connect) {
  const pkgDir = existsSync(join(target, 'node_modules', '@useguano', 'guano'))
    ? join(target, 'node_modules', '@useguano', 'guano')
    : process.env.GUANO_CREATE_LOCAL_PKG
  if (!pkgDir) {
    console.error('\nClaude not connected: guano is not installed yet — run `npm run connect` inside the project later.')
  } else {
    try {
      // the package resolves its data dir from this env at import time
      const dataDir = join(target, 'data')
      await mkdir(dataDir, { recursive: true, mode: 0o700 })
      process.env.GUANO_DATA_DIR = dataDir
      // The port we just picked and wrote into .env. `bin/guano.js` loads that
      // file for a CLI `guano connect`, but this call imports connect directly
      // — so without this it saw no PORT, fell back to the 4174 default and
      // baked `http://localhost:4174` into the entry of a project whose .env
      // says 4180. Every scaffolded project claimed one address, and whichever
      // one held it answered for all of them.
      process.env.PORT = String(port)
      const { main } = await import(pathToFileURL(join(pkgDir, 'mcp', 'connect.mjs')).href)
      const connectArgs = [...policyFlags, '--offline', '--yes']
      if (opt('--config')) connectArgs.push('--config', resolve(opt('--config')))
      console.log('\nConnecting Claude…')
      await main(connectArgs, {
        whenClaudeRunning: async () => {
          if (!rl) return 'skip'
          const a = (
            await ask('Claude Desktop is running and overwrites its config on quit. Quit it, then press Enter (or type skip): ')
          ).trim()
          return /^s(kip)?$/i.test(a) ? 'skip' : 'retry'
        },
      })
      connected = true
    } catch (e) {
      console.error(`\n✗ ${e?.message ?? e}\n  Claude not connected — run \`npm run connect\` inside the project later.`)
    }
  }
}
rl?.close()

console.log(`
Next:
  cd ${dir}${installed || !install ? '' : '\n  npm install'}
  npm run dev   → http://localhost:${port}/admin  (create your admin account)
${connected ? '\nThen open Claude — guano is connected; the agent token is bound to the admin you create.\n' : ''}`)
