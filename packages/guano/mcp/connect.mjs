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
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
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
  // the policy module reads DATA_DIR from util.mjs, which main() has pinned to
  // this same dir via GUANO_DATA_DIR
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
 * The data dir the server that will run uses.
 *
 * `util.mjs` derives it from its OWN location: under node_modules it is
 * `<cwd>/data`, otherwise `<its package root>/server/data`. Imported from
 * `packages/guano/`, that second branch resolves to
 * `packages/guano/server/data` — a directory a repo clone's `npm run serve`
 * (which runs `server/index.mjs` from the repo root) never reads. The nonce
 * landed there, the server looked in `<repo>/server/data`, and connect died
 * with "nonce mismatch — run `guano connect` from the instance machine", which
 * is the one thing that was never wrong.
 *
 * So: an explicit GUANO_DATA_DIR wins, then whichever candidate actually
 * exists, and only then the packaged default.
 */
async function resolveDataDir() {
  if (process.env.GUANO_DATA_DIR) return resolve(process.env.GUANO_DATA_DIR)
  const candidates = [join(process.cwd(), 'data'), join(process.cwd(), 'server', 'data')]
  for (const dir of candidates) {
    try {
      await access(dir)
      return dir
    } catch {
      /* not this one */
    }
  }
  const { DATA_DIR } = await import(pathToFileURL(join(ROOT, 'server', 'util.mjs')).href)
  return DATA_DIR
}

/**
 * This project's identity and address, for naming the client entry and for the
 * mismatch check `guano mcp` runs at boot.
 *
 * The DATA DIR is the authority, never the port. Probing a port first is the
 * bug this whole change exists to kill: with several projects on one machine
 * the instance answering :4174 is whichever booted first, so trusting it would
 * bake ANOTHER project's id and address into this project's entry — connecting
 * Claude to the wrong site while reporting success.
 *
 * So: read instance.json, and consult the running server only to confirm it is
 * the same instance (then its reported port wins, being live) or to learn an
 * address for a dir that has no record yet — a `--offline` connect before the
 * server has ever started.
 */
async function readIdentity(candidate, dataDir) {
  let file = null
  try {
    const parsed = JSON.parse(await readFile(join(dataDir, 'instance.json'), 'utf8'))
    if (parsed && typeof parsed.id === 'string' && parsed.id) file = parsed
  } catch {
    /* never booted, or older than instance ids */
  }
  const live = await probe(candidate)
  // the candidate IS us — prefer what it says, it is running right now
  if (live && file && live.instance === file.id) {
    return { id: file.id, port: live.port || file.port || null, base: candidate, strayPort: false }
  }
  // we have a record; the candidate is either silent or somebody else
  if (file) {
    return {
      id: file.id,
      port: file.port || null,
      base: file.port ? `http://localhost:${file.port}` : candidate,
      strayPort: Boolean(live && live.instance && live.instance !== file.id),
    }
  }
  // no record at all: nothing to compare, so claim nothing about identity
  return { id: '', port: null, base: candidate, strayPort: false }
}

/** /api/health, or null when nothing answers (or it predates instance ids) */
async function probe(base) {
  try {
    const res = await fetch(`${base}/api/health`)
    const h = await res.json()
    return h && typeof h === 'object' ? h : null
  } catch {
    return null
  }
}

/**
 * The project folder a data dir belongs to, for a slug when the project has no
 * name yet (a fresh instance, or `--offline` before setup).
 *
 * Walking up one level is wrong on its own: a repo clone's data dir is
 * `<repo>/server/data`, whose parent is `server`, which named the entry
 * `guano-server` — true of every clone and so no name at all. Generic
 * infrastructure segments are skipped until something project-shaped appears.
 */
const GENERIC_DIRS = new Set(['data', 'server', 'app', 'src', 'dist', 'build', 'var', 'tmp', '.data'])
function projectFolder(dataDir) {
  let dir = resolve(dataDir)
  for (let i = 0; i < 4; i++) {
    const name = basename(dir)
    if (!name || name === '/' || dir === dirname(dir)) break
    if (!GENERIC_DIRS.has(name.toLowerCase())) return name
    dir = dirname(dir)
  }
  return ''
}

/**
 * The name of the mcpServers entry: `guano-<slug>`, one per project.
 *
 * It used to be the bare key `guano` for every project, so connecting a second
 * one silently EVICTED the first — and because both entries also pointed at
 * the same default port, the surviving one talked to whichever instance had
 * booted first and got a 401 for its trouble. A key per project is what lets
 * several be connected at once, and it puts the project's name in front of the
 * agent (`mcp__guano-landing__get_page`) instead of leaving it ambiguous.
 */
function entryName(projectName, dataDir) {
  const raw = projectName?.trim() || projectFolder(dataDir)
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug ? `guano-${slug}` : 'guano'
}

/** the project's own name, for the entry slug (no server needed) */
async function readProjectName(dataDir) {
  try {
    const blob = JSON.parse(await readFile(join(dataDir, 'store', 'guano-project__main.json'), 'utf8'))
    if (typeof blob?.name === 'string' && blob.name.trim()) return blob.name.trim()
  } catch {
    /* not seeded yet */
  }
  try {
    const file = JSON.parse(await readFile(join(dataDir, 'instance.json'), 'utf8'))
    if (typeof file?.name === 'string' && file.name.trim()) return file.name.trim()
  } catch {
    /* no identity yet */
  }
  return ''
}

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
  const dataDir = await resolveDataDir()
  // Pin it for every server module loaded from here on. `util.mjs` reads
  // GUANO_DATA_DIR once at import time and `agent-policy.mjs` derives its file
  // from that, so without this the token could be written to one dir and the
  // policy beside it to another — which is exactly what the clone layout did.
  process.env.GUANO_DATA_DIR = dataDir
  // The address of THIS project, not of port 4174. An explicit GUANO_URL or
  // PORT is a contract and still wins; otherwise the port this data dir last
  // landed on is what the entry gets baked with, so a second project's config
  // never points at the first project's socket.
  const pinned = process.env.GUANO_URL || (process.env.PORT ? `http://localhost:${process.env.PORT}` : '')
  const identity = await readIdentity((pinned || 'http://localhost:4174').replace(/\/+$/, ''), dataDir)
  const base = (pinned || identity.base).replace(/\/+$/, '')
  if (identity.strayPort && !pinned) {
    console.log(`! another Guano project is on :4174 — this entry targets ${base} instead`)
  }

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
    minted = await mintDirect(dataDir, policy)
  } else {
    try {
      minted = await mintViaServer(base, dataDir, policy)
      console.log(`✓ token minted via the running instance at ${base} (admin: ${minted.email ?? 'pending'})`)
    } catch (e) {
      if (e?.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(e?.message ?? '')) {
        minted = await mintDirect(dataDir, policy)
        if (!minted.pending) console.log(`✓ server not running — token written to ${dataDir} (loaded at next start)`)
      } else {
        throw e
      }
    }
  }
  if (minted.pending) {
    console.log(`✓ token saved to ${dataDir} — it is bound to the admin account you create at /admin setup`)
  } else if (flag('--offline')) {
    console.log(`✓ token written to ${dataDir} (admin: ${minted.email}; loaded at next start)`)
  }
  const agentPolicy = minted.agentPolicy ?? {}
  const mainAllowed = agentPolicy.allowMainWrites === true
  const somethingOff = !mainAllowed || agentPolicy.allowPublish !== true
  console.log(
    `✓ agent permissions: work on Main ${onOff(mainAllowed)}, publish ${onOff(agentPolicy.allowPublish)}` +
      (!Object.keys(policy).length && somethingOff ? ' (unchanged — pass --main / --publish to turn them on)' : ''),
  )

  const projectName = await readProjectName(dataDir)
  const name = entryName(projectName, dataDir)
  const entry = {
    command: process.execPath,
    args: [join(ROOT, 'bin', 'guano.js'), 'mcp'],
    env: {
      GUANO_URL: base,
      GUANO_TOKEN: minted.token,
      // Which project this token belongs to. `guano mcp` compares it against
      // /api/health before presenting the token, so another project squatting
      // the port is REFUSED by name instead of answering with a 401 that reads
      // as "the token is dead".
      ...(identity.id ? { GUANO_INSTANCE: identity.id } : {}),
      // Main allowed → the target is settled in the client's own config, the
      // one consent channel a prompt-injected agent cannot reach, and the
      // agent starts working instead of asking "Main or a draft?"
      ...(mainAllowed ? { GUANO_MCP_TARGET: 'main' } : {}),
    },
  }
  if (mainAllowed) console.log('✓ GUANO_MCP_TARGET=main — the agent writes to Main without asking')
  console.log(`✓ MCP entry: ${name} → ${base}${projectName ? ` (${projectName})` : ''}`)

  // 3. --print: emit the snippet for any MCP client, touch nothing
  if (flag('--print')) {
    console.log('\nAdd this under "mcpServers" in your MCP client config:\n')
    console.log(JSON.stringify({ [name]: entry }, null, 2))
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
      console.log(JSON.stringify({ [name]: entry }, null, 2))
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
  const servers = { ...(config.mcpServers ?? {}) }
  // Retire a legacy bare `guano` entry, but ONLY when it is this same project:
  // leaving it would point a second MCP server at the same instance under a
  // name no `connect` ever updates again, and deleting someone else's would
  // disconnect a project this run never looked at.
  const legacy = servers.guano
  const legacyIsOurs =
    name !== 'guano' &&
    legacy &&
    (legacy.env?.GUANO_INSTANCE === identity.id || legacy.env?.GUANO_URL === base)
  if (legacyIsOurs) {
    delete servers.guano
    console.log('✓ replaced the old unnamed `guano` entry with a per-project one')
  }
  servers[name] = entry
  config.mcpServers = servers

  // A sibling entry aiming at the SAME url is a different project that this
  // one has taken the port from — its token can never be accepted here while
  // we hold the address. It is not deleted: that project may simply not be
  // running, and removing an entry this run never verified would disconnect a
  // site nobody asked about. Named instead, because two entries on one port is
  // precisely the confusion this naming scheme exists to end.
  const clashing = Object.entries(servers).filter(
    ([k, v]) => k !== name && v?.env?.GUANO_URL === base && v?.env?.GUANO_INSTANCE !== identity.id,
  )
  for (const [k] of clashing) {
    console.log(
      `! ${k} also targets ${base} but is a different project — it cannot work while this\n` +
        `  one holds that port. Give one of them its own PORT, or remove the entry.`,
    )
  }
  await mkdir(join(configPath, '..'), { recursive: true })
  await writeFile(configPath, JSON.stringify(config, null, 2))
  console.log(`✓ Claude Desktop config updated: ${configPath}`)
  const others = Object.keys(servers).filter((k) => k.startsWith('guano') && k !== name)
  if (others.length) console.log(`  other guano projects still connected: ${others.join(', ')}`)
  console.log(`\nDone. Open Claude Desktop — ${name} will be connected.`)
}
