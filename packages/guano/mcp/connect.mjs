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
//
// It runs BEFORE setup too: with no admin account the token is PENDING and the
// server binds it to the first admin at /admin setup, which is how
// `npm create @useguano` connects Claude at scaffold time (`--offline` skips
// the network — a server on the default port may be another project's).
//
// It also settles the two agent permissions a connected instance needs
// answered — may the agent work on Main, may it publish — because the
// alternative was: connect, open Claude, watch the first write 403, open
// /admin, find Settings → MCP → Agent permissions, flip, restart. `--main` /
// `--publish` set them; with neither flag and a terminal, the two questions
// are asked (default No); `--yes` skips the questions and leaves the policy
// as it is. The person running this holds the data dir, which is the same
// ownership the nonce already proves. When Main is allowed, GUANO_MCP_TARGET
// is written into the client config too, so the agent never has to ask which
// target to use.
import { randomBytes, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import readline from 'node:readline/promises'

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
async function mintViaServer(base, dataDir, policy) {
  const nonce = randomBytes(32).toString('hex')
  const nonceFile = join(dataDir, '.connect-nonce')
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  await writeFile(nonceFile, nonce, { mode: 0o600 })
  try {
    const res = await fetch(`${base}/api/auth/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce, name: 'guano connect (Claude Desktop)', policy }),
    })
    const detail = await res.json().catch(() => null)
    if (!res.ok) throw new Error(detail?.error ?? `connect failed (${res.status})`)
    return detail // { token, email, agentPolicy }
  } finally {
    await rm(nonceFile, { force: true })
  }
}

/** server down (or `--offline`): append the token file directly — loaded at
 *  next boot. With no admin account yet the record is PENDING (`userId: null`,
 *  `pendingFirstAdmin: true`): the server binds it to the first admin the
 *  moment that account is created at /admin setup. That is what lets the
 *  scaffolder connect Claude before the server has ever run. */
async function mintDirect(dataDir, policy) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  let users = []
  try {
    users = JSON.parse(await readFile(join(dataDir, 'users.json'), 'utf8'))
  } catch {
    /* no account yet — pending token */
  }
  const admin = Array.isArray(users) ? users.find((u) => u.role === 'admin') : null
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
    userId: admin ? admin.id : null,
    name: 'guano connect (Claude Desktop)',
    createdAt: Date.now(),
    lastUsedAt: null,
    ...(admin ? {} : { pendingFirstAdmin: true }),
  })
  await writeFile(file, JSON.stringify(tokens), { mode: 0o600 })
  // the policy module reads DATA_DIR from util.mjs, which is this same dir
  const { writeAgentPolicy, readAgentPolicy } = await import(
    pathToFileURL(join(ROOT, 'server', 'agent-policy.mjs')).href
  )
  const agentPolicy = Object.keys(policy).length ? await writeAgentPolicy(policy) : await readAgentPolicy()
  return { token: raw, email: admin?.email ?? null, agentPolicy, pending: !admin }
}

/**
 * The two onboarding switches, from flags or from two questions. Returns only
 * the keys to SET — an empty object leaves the stored policy as it is, which
 * is what `--yes` with no flags means.
 */
async function choosePolicy(flag) {
  const policy = {}
  if (flag('--main')) policy.allowMainWrites = true
  if (flag('--publish')) policy.allowPublish = true
  if (Object.keys(policy).length || flag('--yes') || flag('--no-prompt')) return policy
  if (!process.stdin.isTTY || !process.stdout.isTTY) return policy
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const yes = async (q) => /^y(es)?$/i.test((await rl.question(`${q} [y/N] `)).trim())
  try {
    console.log('\nTwo questions about what the agent may do (change them any time in\n/admin → Settings → MCP → Agent permissions):\n')
    policy.allowMainWrites = await yes(
      'Let agents edit the live project (Main)? Off, they work in a draft you apply yourself.',
    )
    policy.allowPublish = await yes('Let agents publish the site? Off, they can still preview their work.')
  } finally {
    rl.close()
  }
  return policy
}

const onOff = (v) => (v ? 'on' : 'off')

/**
 * @param {string[]} args  CLI flags
 * @param {{whenClaudeRunning?: () => Promise<'retry'|'skip'>}} opts
 *   `whenClaudeRunning` is the scaffolder's hook: asked when Claude Desktop is
 *   open, it returns 'retry' after the person quit it or 'skip' to leave the
 *   config alone (the snippet is printed instead). Without it the CLI exits
 *   with the error it always had.
 */
export async function main(args = [], opts = {}) {
  const flag = (name) => args.includes(name)
  const opt = (name) => {
    const i = args.indexOf(name)
    return i !== -1 ? args[i + 1] : undefined
  }
  const base = (process.env.GUANO_URL || `http://localhost:${process.env.PORT || 4174}`).replace(/\/+$/, '')
  const { DATA_DIR } = await import(pathToFileURL(join(ROOT, 'server', 'util.mjs')).href)

  // 1. the agent permissions — asked before anything is written, so a ^C here
  //    changes nothing
  const policy = await choosePolicy(flag)

  // 2. mint a token. Through the running server when there is one (its token
  //    cache stays coherent); straight into the data dir when it is down —
  //    or with --offline, which never asks the network: a server on the
  //    default port may belong to ANOTHER project, and minting through it
  //    would connect Claude to the wrong instance. The scaffolder passes it.
  let minted
  if (flag('--offline')) {
    minted = await mintDirect(DATA_DIR, policy)
  } else {
    try {
      minted = await mintViaServer(base, DATA_DIR, policy)
      console.log(`✓ token minted via the running instance at ${base} (admin: ${minted.email ?? 'pending'})`)
    } catch (e) {
      if (e?.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(e?.message ?? '')) {
        minted = await mintDirect(DATA_DIR, policy)
        if (!minted.pending) console.log(`✓ server not running — token written to ${DATA_DIR} (loaded at next start)`)
      } else {
        throw e
      }
    }
  }
  if (minted.pending) {
    console.log(`✓ token saved to ${DATA_DIR} — it is bound to the admin account you create at /admin setup`)
  } else if (flag('--offline')) {
    console.log(`✓ token written to ${DATA_DIR} (admin: ${minted.email}; loaded at next start)`)
  }
  const agentPolicy = minted.agentPolicy ?? {}
  const mainAllowed = agentPolicy.allowMainWrites === true
  const somethingOff = !mainAllowed || agentPolicy.allowPublish !== true
  console.log(
    `✓ agent permissions: work on Main ${onOff(mainAllowed)}, publish ${onOff(agentPolicy.allowPublish)}` +
      (!Object.keys(policy).length && somethingOff ? ' (unchanged — pass --main / --publish to turn them on)' : ''),
  )

  const entry = {
    command: process.execPath,
    args: [join(ROOT, 'bin', 'guano.js'), 'mcp'],
    env: {
      GUANO_URL: base,
      GUANO_TOKEN: minted.token,
      // Main allowed → the target is settled in the client's own config, the
      // one consent channel a prompt-injected agent cannot reach, and the
      // agent starts working instead of asking "Main or a draft?"
      ...(mainAllowed ? { GUANO_MCP_TARGET: 'main' } : {}),
    },
  }
  if (mainAllowed) console.log('✓ GUANO_MCP_TARGET=main — the agent writes to Main without asking')

  // 3. --print: emit the snippet for any MCP client, touch nothing
  if (flag('--print')) {
    console.log('\nAdd this under "mcpServers" in your MCP client config:\n')
    console.log(JSON.stringify({ guano: entry }, null, 2))
    return
  }

  // 4. write Claude Desktop's config — but never while the app is running
  //    (it flushes its in-memory copy on quit, silently reverting the edit)
  const configPath = opt('--config') ?? claudeConfigPath()
  while (!opt('--config') && !flag('--force') && claudeDesktopRunning()) {
    const answer = opts.whenClaudeRunning ? await opts.whenClaudeRunning() : 'exit'
    if (answer === 'retry') continue
    if (answer === 'skip') {
      console.log('\nClaude Desktop left running — its config was not written. Add this under "mcpServers" yourself:\n')
      console.log(JSON.stringify({ guano: entry }, null, 2))
      console.log('\nor quit Claude Desktop and run `npm run connect` later to write it for you.')
      return
    }
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
