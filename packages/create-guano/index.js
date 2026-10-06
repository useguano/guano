#!/usr/bin/env node
// @useguano/create: scaffold a project dir that runs Guano via npm scripts, then
// install it. Zero dependencies — prompts with node:readline when no dir is
// given. `npm create @useguano [dir] [--no-install]`.
import { spawnSync } from 'node:child_process'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import readline from 'node:readline/promises'

const args = process.argv.slice(2)
const install = !args.includes('--no-install')
let dir = args.find((a) => !a.startsWith('--'))
const DEFAULT_DIR = 'my-site'
if (!dir) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  dir = (await rl.question(`Project folder (${DEFAULT_DIR}): `)).trim() || DEFAULT_DIR
  rl.close()
}

const target = resolve(dir)
const name = basename(target)
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/^-+|-+$/g, '') || DEFAULT_DIR

await mkdir(target, { recursive: true })
if ((await readdir(target)).length) {
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

Open http://localhost:4174/admin, create the first account, build your site.
Your published site is served at http://localhost:4174/.

- \`npm run start\` — production server (\`NODE_ENV=production\`)
- \`npm run build\` — export the site as static files to \`./dist-site\`
- \`npm run connect\` — connect Claude Desktop to this instance over MCP (quit Claude first)
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

console.log(`
Next:
  cd ${dir}${installed ? '' : '\n  npm install'}
  npm run dev   → http://localhost:4174/admin
`)
