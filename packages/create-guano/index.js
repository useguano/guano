#!/usr/bin/env node
// @useguano/create: scaffold a project dir that runs Guano via npm scripts,
// install it, and connect Claude Desktop — all in this one command, so what
// is left afterwards is `cd my-site && npm run dev`. Zero dependencies —
// prompts with node:readline.
//
//   npm create @useguano [dir] [--no-install] [--no-connect | --connect]
//                        [--main] [--publish] [--config <claude config path>]
//
// The MCP connect runs through the just-installed package's own
// `guano connect --offline`: it mints a PENDING API token into <dir>/data,
// writes the two agent permissions there, and writes Claude Desktop's config.
// The server binds the token to the first admin at /admin setup, and the
// setup form shows the permissions instead of asking them again.
import { spawnSync } from 'node:child_process'
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

// Connect Claude Desktop? Flags decide non-interactively (CI never asks and
// never connects); a terminal asks, default yes.
let connect = false
let policyFlags = []
if (flag('--no-connect')) {
  connect = false
} else if (flag('--connect') || flag('--main') || flag('--publish')) {
  connect = true
} else if (rl) {
  connect = await yes('Connect Claude Desktop to this site over MCP?', true)
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

await mkdir(target, { recursive: true })
if ((await readdir(target)).length) {
  rl?.close()
  console.error(`${target} is not empty — refusing to scaffold over existing files`)
  process.exit(1)
}

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

  '.env.example': `# PORT=4174
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

Open http://localhost:4174/admin, create the first account, then build your
site. Your published site is served at http://localhost:4174/.

If you said yes to Claude Desktop when scaffolding, it is already connected:
the agent token is bound to the admin account you create, and the permissions
you chose (edit the live project, publish) show on the setup form and stay
editable in Settings → MCP → Agent permissions.

- \`npm run start\` — production server (\`NODE_ENV=production\`)
- \`npm run build\` — export the site as static files to \`./dist-site\`
- \`npm run connect\` — connect Claude Desktop later, or from another machine (quit Claude first; \`--main\` / \`--publish\` grant the agent permissions, or it asks)
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

// ---- connect Claude Desktop, through the installed package ----
// GUANO_CREATE_LOCAL_PKG is a dev-only escape hatch: with --no-install there
// is no node_modules, so a repo checkout names its own packages/guano here.
let connected = false
if (connect) {
  const pkgDir = existsSync(join(target, 'node_modules', '@useguano', 'guano'))
    ? join(target, 'node_modules', '@useguano', 'guano')
    : process.env.GUANO_CREATE_LOCAL_PKG
  if (!pkgDir) {
    console.error('\nClaude Desktop not connected: guano is not installed yet — run `npm run connect` inside the project later.')
  } else {
    try {
      // the package resolves its data dir from this env at import time
      const dataDir = join(target, 'data')
      await mkdir(dataDir, { recursive: true, mode: 0o700 })
      process.env.GUANO_DATA_DIR = dataDir
      const { main } = await import(pathToFileURL(join(pkgDir, 'mcp', 'connect.mjs')).href)
      const connectArgs = [...policyFlags, '--offline', '--yes']
      if (opt('--config')) connectArgs.push('--config', resolve(opt('--config')))
      console.log('\nConnecting Claude Desktop…')
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
      console.error(`\n✗ ${e?.message ?? e}\n  Claude Desktop not connected — run \`npm run connect\` inside the project later.`)
    }
  }
}
rl?.close()

console.log(`
Next:
  cd ${dir}${installed || !install ? '' : '\n  npm install'}
  npm run dev   → http://localhost:4174/admin  (create your admin account)
${connected ? '\nThen open Claude Desktop — guano is connected; the agent token is bound to the admin you create.\n' : ''}`)
