#!/usr/bin/env node
// @superbird-app/create: scaffold a project dir that runs Superbird via npm scripts,
// install it, and tell you how to reach it. Zero dependencies — prompts with
// node:readline.
//
//   npm create @superbird-app [dir] [--no-install] [--connect [--main] [--publish]
//                        [--config <claude config path>]]
//
// THIS IS THE SERVER INSTALLER. Decided 2026-10-18 with launcher-only
// building: a VPS runs this, and the Build surface is reached from Superbird
// Launcher on a Mac over the approval that instance grants it. So the Claude
// questions are no longer ASKED — a server has no Claude on it, the editor's
// own AI panel is Superbird's main integration and needs no wiring up, and a
// prompt that every server install answers "no" to is a prompt that teaches
// people to stop reading prompts.
//
// `--connect` keeps the whole flow for the one case it was written for: a
// person scaffolding on their own laptop who wants Claude Code or Claude
// Desktop pointed at it. It mints a PENDING API token into <dir>/data, writes
// the two agent permissions there, and writes the config of every Claude
// client on the machine; the server binds the token to the first admin at
// /admin setup, and the setup form shows the permissions instead of asking
// them again.
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

// Connect Claude? NOT ASKED any more — opt in with `--connect`.
//
// This command is how a server is installed, and a server has no Claude on
// it: the editor's own AI panel is Superbird's main integration, and the Build
// surface is reached from Superbird Launcher over the approval the instance
// grants it. A question every server install answers "no" to is a question
// people stop reading. `--no-connect` is still accepted and still means no,
// so an existing script keeps working.
const connect = flag('--connect') || flag('--main') || flag('--publish')
const policyFlags = []
if (connect && !flag('--no-connect')) {
  if (flag('--main')) policyFlags.push('--main')
  if (flag('--publish')) policyFlags.push('--publish')
  if (!policyFlags.length && rl) {
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
  // /_superbird/preview, so there is no second port to keep free above it.
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
          dev: 'superbird dev',
          start: 'superbird start',
          build: 'superbird build',
          connect: 'superbird connect',
        },
        dependencies: {
          '@superbird-app/superbird': '^0.1.0',
        },
      },
      null,
      2,
    ) + '\n',

  'superbird.config.js': `// Superbird reads its configuration from environment variables today
// (see .env.example). This file is reserved for future options.
export default {}
`,

  // A real .env, not just the example: the port is this project's identity on
  // the machine, and leaving it to the 4174 default is what makes two projects
  // fight over one address.
  '.env': `# This project's own port. Keep it — two Superbird sites on one machine
# must not share one, or whichever starts first answers for both and the
# other's MCP token is refused with a 401.
PORT=${port}

# What you called this project in the terminal. It prefills the Project name
# on the setup screen, so nobody is asked to name the same thing twice. Only
# read before the first admin account exists; edit the name in the editor
# after that.
SUPERBIRD_PROJECT_NAME=${displayName}
`,

  '.env.example': `PORT=${port}
# SUPERBIRD_DATA_DIR=./data     # users, media, drafts, the published site — back this up
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

A [Superbird](https://www.npmjs.com/package/@superbird-app/superbird) site.

\`\`\`sh
npm run start
\`\`\`

Open http://localhost:${port}/admin and create the first account. From this
machine that is all it takes; from anywhere else the form asks for a **setup
code**, which the server prints in its own log the first time it starts. It is
what stands in for being at the machine — without it, the first stranger to
reach a fresh instance would become its admin.

**Then add this server in Superbird Launcher** (Home → Servers → Add a server…)
and build from there. Pages, components, settings and publishing live in the
Mac app; what this instance serves is the site, its forms, and the content
view for anyone you invite. Approving the app once in your browser is what
gives that Mac builder access, and you can revoke it any time under
My account → API tokens.

Two things that follow from that, and are chosen rather than missed: **every
builder needs a Mac**, and once a project is on a server there is no offline
building.

Your published site is served at http://localhost:${port}/, and this project
runs on port ${port} (set in \`.env\`). Each Superbird site on a machine needs its
own, so two of them never answer for one address.

- \`npm run dev\` — the same server with dev logging
- \`npm run start\` — production server (\`NODE_ENV=production\`)
- \`npm run build\` — export the site as static files to \`./dist-site\`
- \`npm run connect\` — point Claude Code or Claude Desktop at this site over MCP. Not needed for the editor's own AI panel, which is Superbird's main integration and needs no wiring up. (Writes Claude Code's \`~/.claude.json\` and Claude Desktop's config; quit Desktop first; \`--main\` / \`--publish\` grant the agent permissions, or it asks.)
- everything lives in \`./data\` — **backing up = copying that directory**

See the @superbird-app/superbird package README for deploy notes and environment variables.
`,
}

for (const [file, content] of Object.entries(files)) {
  await writeFile(join(target, file), content)
}
console.log(`Scaffolded ${name} in ${target}`)

let installed = false
if (install) {
  console.log('Installing superbird…')
  // npm itself (not `npx`/the create shim) so a failure here is npm's own
  // message; a non-zero exit is reported and the next steps include install.
  const r = spawnSync('npm', ['install'], { cwd: target, stdio: 'inherit', shell: process.platform === 'win32' })
  installed = r.status === 0
  if (!installed) console.error('\nnpm install failed — run it yourself in the project folder.')
}

// ---- connect Claude, through the installed package ----
// SUPERBIRD_CREATE_LOCAL_PKG is a dev-only escape hatch: with --no-install there
// is no node_modules, so a repo checkout names its own packages/superbird here.
let connected = false
if (connect) {
  const pkgDir = existsSync(join(target, 'node_modules', '@superbird-app', 'superbird'))
    ? join(target, 'node_modules', '@superbird-app', 'superbird')
    : process.env.SUPERBIRD_CREATE_LOCAL_PKG
  if (!pkgDir) {
    console.error('\nClaude not connected: superbird is not installed yet — run `npm run connect` inside the project later.')
  } else {
    try {
      // the package resolves its data dir from this env at import time
      const dataDir = join(target, 'data')
      await mkdir(dataDir, { recursive: true, mode: 0o700 })
      process.env.SUPERBIRD_DATA_DIR = dataDir
      // The port we just picked and wrote into .env. `bin/superbird.js` loads that
      // file for a CLI `superbird connect`, but this call imports connect directly
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
  npm run start   → http://localhost:${port}/admin

The FIRST account is created at /admin. From this machine that is all it
takes; from anywhere else the form asks for a setup code, which the server
prints in its own log the first time it starts — look for "the form asks for
this code". It is what stands in for being at the machine: without it, the
first stranger to reach a fresh instance would become its admin.

Then add this server in Superbird Launcher (Home → Servers → Add a server…) and
build from there. Pages, components, settings and publishing live in the app;
this instance serves the site, its forms, and the content view for anyone you
invite.
${connected ? '\nClaude is connected on this machine; the agent token is bound to the admin you create.\n' : ''}`)
