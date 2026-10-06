// `guano connect` — one-command MCP setup for Claude Desktop.
//
// Does everything the manual dance did: mints an API token (proving instance
// ownership via a nonce file in the data dir — no password, no copy-paste),
// writes the mcpServers entry into Claude Desktop's config with absolute
// paths, and guards the classic failure modes:
//   - Claude Desktop overwrites its config from memory on quit → refuse to
//     write while the app runs (--force overrides)
//   - the server caches api-tokens.json in memory → mint through the running
//     server (/api/auth/connect); fall back to a direct file write only when
//     the server is down (safe: it loads the file at next boot)
import { randomBytes, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function claudeConfigPath() {
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  if (process.platform === 'win32')
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json')
}

function claudeDesktopRunning() {
  try {
    if (process.platform === 'darwin') {
      execFileSync('pgrep', ['-x', 'Claude'], { stdio: 'ignore' })
      return true
    }
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', [], { encoding: 'utf8' })
      return /claude\.exe/i.test(out)
    }
  } catch {
    /* pgrep exits 1 when not running */
  }
  return false
}

/** mint via the RUNNING server (in-memory token cache stays coherent) */
async function mintViaServer(base, dataDir) {
  const nonce = randomBytes(32).toString('hex')
  const nonceFile = join(dataDir, '.connect-nonce')
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  await writeFile(nonceFile, nonce, { mode: 0o600 })
  try {
    const res = await fetch(`${base}/api/auth/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce, name: 'guano connect (Claude Desktop)' }),
    })
    const detail = await res.json().catch(() => null)
    if (!res.ok) throw new Error(detail?.error ?? `connect failed (${res.status})`)
    return detail // { token, email }
  } finally {
    await rm(nonceFile, { force: true })
  }
}

/** server down: append the token file directly — loaded at next boot */
async function mintDirect(dataDir) {
  let users
  try {
    users = JSON.parse(await readFile(join(dataDir, 'users.json'), 'utf8'))
  } catch {
    throw new Error(
      `no admin account found in ${dataDir} — start guano (\`guano dev\`), open /admin and complete setup, then re-run \`guano connect\``,
    )
  }
  const admin = users.find((u) => u.role === 'admin')
  if (!admin) throw new Error('no admin account yet — complete /admin setup first')
  const raw = 'guano_' + randomBytes(24).toString('hex')
  const file = join(dataDir, 'api-tokens.json')
  let tokens = []
  try {
    tokens = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    /* first token */
  }
  tokens.push({
    id: randomBytes(12).toString('hex'),
    tokenHash: createHash('sha256').update(raw).digest('hex'),
    userId: admin.id,
    name: 'guano connect (Claude Desktop)',
    createdAt: Date.now(),
    lastUsedAt: null,
  })
  await writeFile(file, JSON.stringify(tokens), { mode: 0o600 })
  return { token: raw, email: admin.email }
}

export async function main(args = []) {
  const flag = (name) => args.includes(name)
  const opt = (name) => {
    const i = args.indexOf(name)
    return i !== -1 ? args[i + 1] : undefined
  }
  const base = (process.env.GUANO_URL || `http://localhost:${process.env.PORT || 4174}`).replace(/\/+$/, '')
  const { DATA_DIR } = await import(pathToFileURL(join(ROOT, 'server', 'util.mjs')).href)

  // 1. mint a token (server preferred; direct file only when it's down)
  let minted
  try {
    minted = await mintViaServer(base, DATA_DIR)
    console.log(`✓ token minted via the running instance at ${base} (admin: ${minted.email})`)
  } catch (e) {
    if (e?.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(e?.message ?? '')) {
      minted = await mintDirect(DATA_DIR)
      console.log(`✓ server not running — token written to ${DATA_DIR} (loaded at next start)`)
    } else {
      throw e
    }
  }

  const entry = {
    command: process.execPath,
    args: [join(ROOT, 'bin', 'guano.js'), 'mcp'],
    env: { GUANO_URL: base, GUANO_TOKEN: minted.token },
  }

  // 2. --print: emit the snippet for any MCP client, touch nothing
  if (flag('--print')) {
    console.log('\nAdd this under "mcpServers" in your MCP client config:\n')
    console.log(JSON.stringify({ guano: entry }, null, 2))
    return
  }

  // 3. write Claude Desktop's config — but never while the app is running
  //    (it flushes its in-memory copy on quit, silently reverting the edit)
  const configPath = opt('--config') ?? claudeConfigPath()
  if (!opt('--config') && claudeDesktopRunning() && !flag('--force')) {
    console.error(
      '\n✗ Claude Desktop is running. Quit it completely first (it overwrites its config\n' +
        '  on quit, which would silently undo this setup), then re-run `guano connect`.',
    )
    process.exit(1)
  }
  let config = {}
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'))
  } catch {
    /* first MCP server ever — start fresh */
  }
  config.mcpServers = { ...(config.mcpServers ?? {}), guano: entry }
  await mkdir(join(configPath, '..'), { recursive: true })
  await writeFile(configPath, JSON.stringify(config, null, 2))
  console.log(`✓ Claude Desktop config updated: ${configPath}`)
  console.log('\nDone. Open Claude Desktop — guano will be connected.')
}
