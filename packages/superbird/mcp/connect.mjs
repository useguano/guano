// `superbird connect` — one-command MCP setup for Claude Code and Claude Desktop.
//
// Does everything the manual dance did: mints an API token (proving instance
// ownership via a nonce file in the data dir — no password, no copy-paste),
// writes the mcpServers entry into every Claude client on the machine with
// absolute paths (see `clientTargets`: it wrote Desktop's config only, so a
// Claude Code user got the whole success path and no tools), and guards the
// classic failure modes:
//   - Claude Desktop overwrites its config from memory on quit → refuse to
//     write while the app runs (--force overrides)
//   - the server caches api-tokens.json in memory → mint through the running
//     server (/api/auth/connect); fall back to a direct file write only when
//     the server is down (safe: it loads the file at next boot)
//
// It runs BEFORE setup too: with no admin account the token is PENDING and the
// server binds it to the first admin at /admin setup, which is how
// `npm create @superbird-app` connects Claude at scaffold time (`--offline` skips
// the network — a server on the default port may be another project's).
//
// It also settles the two agent permissions a connected instance needs
// answered — may the agent work on Main, may it publish — because the
// alternative was: connect, open Claude, watch the first write 403, open
// /admin, find Settings → MCP → Agent permissions, flip, restart. `--main` /
// `--publish` set them; with neither flag and a terminal, the two questions
// are asked (default No); `--yes` skips the questions and leaves the policy
// as it is. The person running this holds the data dir, which is the same
// ownership the nonce already proves. When Main is allowed, SUPERBIRD_MCP_TARGET
// is written into the client config too, so the agent never has to ask which
// target to use.
//
// `--embedded` + `--target <main|draftId>` are the EDITOR's pair, valid only
// with `--config <file>`: they mark one config file as the AI panel's and name
// the branch the editor has loaded. → docs/instance.md
import { randomBytes, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { writeJsonAtomic } from './fsx.mjs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import readline from 'node:readline/promises'
import { createApi } from './api.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function claudeConfigPath() {
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  if (process.platform === 'win32')
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json')
}

/**
 * The MCP clients this writes, in order.
 *
 * It wrote ONE of them. Every path above is Claude Desktop's, and nothing ever
 * wrote Claude Code's `~/.claude.json` — so a Claude Code user got the entire
 * success path, minted token and `✓ MCP project … →` included, and no tools,
 * because the entry lives in a file their client does not read. Nothing named
 * the cause; `--config` and `--print` were the way out and neither is
 * mentioned where that user would be looking.
 *
 * Claude Code goes first: it needs no quit, so a Desktop that is open cannot
 * cost the write that would have worked.
 *
 * `always` is the asymmetry. Claude Desktop's config file is ours to create —
 * an MCP entry is the whole of what it holds. `~/.claude.json` is Claude
 * Code's own state (accounts, history, per-project settings), so its ABSENCE
 * means Claude Code has never run here and there is nothing to connect:
 * writing a stub would be inventing another tool's private state.
 */
export function clientTargets(explicit) {
  if (explicit)
    return [{ label: explicit, path: resolve(explicit), needsQuit: false, stdio: false, always: true }]
  return [
    { label: 'Claude Code', path: join(homedir(), '.claude.json'), needsQuit: false, stdio: true, always: false },
    { label: 'Claude Desktop', path: claudeConfigPath(), needsQuit: true, stdio: false, always: true },
  ]
}

export function claudeDesktopRunning() {
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
      body: JSON.stringify({ nonce, name: 'superbird connect (Claude Desktop)', policy }),
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
  const raw = 'superbird_' + randomBytes(24).toString('hex')
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
    name: 'superbird connect (Claude Desktop)',
    createdAt: Date.now(),
    lastUsedAt: null,
    ...(admin ? {} : { pendingFirstAdmin: true }),
  })
  await writeFile(file, JSON.stringify(tokens), { mode: 0o600 })
  // the policy module reads DATA_DIR from util.mjs, which main() has pinned to
  // this same dir via SUPERBIRD_DATA_DIR
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
 * `packages/superbird/`, that second branch resolves to
 * `packages/superbird/server/data` — a directory a repo clone's `npm run serve`
 * (which runs `server/index.mjs` from the repo root) never reads. The nonce
 * landed there, the server looked in `<repo>/server/data`, and connect died
 * with "nonce mismatch — run `superbird connect` from the instance machine", which
 * is the one thing that was never wrong.
 *
 * So: an explicit SUPERBIRD_DATA_DIR wins, then whichever candidate actually
 * exists, and only then the packaged default.
 */
export async function resolveDataDir() {
  if (process.env.SUPERBIRD_DATA_DIR) return resolve(process.env.SUPERBIRD_DATA_DIR)
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
 * mismatch check `superbird mcp` runs at boot.
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
export async function readIdentity(candidate, dataDir) {
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

/**
 * Mint this data dir's instance.json if it has none yet, so `readIdentity`
 * above has something to read.
 *
 * It is `boot()`'s own `ensureInstance`, and it is idempotent, so the server
 * adopts whatever is already on disk at its first start — the id is the same
 * either way, it just exists EARLIER.
 *
 * Without this, a data dir that has never booted had no id, `readIdentity`
 * reached its "claim nothing about identity" branch and the client entry was
 * written with NO instance id. That is every project `npm create @superbird-app`
 * connects, because it connects before the server has ever run: the router
 * then falls back to the token test against whatever holds the port, and the
 * day the entry's token goes stale the answer is a plain 401, reported as
 * "no configured project is running" while /api/health answers 200 ok.
 *
 * `port` goes in for the same reason — it is this project's address, known
 * here from PORT (the scaffolder's .env) and otherwise not knowable until the
 * server listens. Never overwritten: the live server records the port it
 * actually got, and that one is the truth.
 */
async function ensureLocalIdentity(dataDir) {
  try {
    await mkdir(dataDir, { recursive: true, mode: 0o700 })
    // these read DATA_DIR from util.mjs, which main() has pinned to this dir
    const { ensureInstance, updateInstance } = await import(
      pathToFileURL(join(ROOT, 'server', 'instance.mjs')).href
    )
    const record = await ensureInstance()
    const port = Number(process.env.PORT)
    if (!record.port && Number.isInteger(port) && port > 0 && port < 65536) {
      return await updateInstance({ port })
    }
    return record
  } catch {
    // Identity is a nicety here, not the job: a read-only or unusual data dir
    // must still get a token and an entry, exactly as it did before.
    return null
  }
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
 * `superbird-server` — true of every clone and so no name at all. Generic
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
 * This project's slug inside the shared entry's SUPERBIRD_PROJECTS map.
 *
 * There have been three schemes. The bare key `superbird` for every project, which
 * silently EVICTED the previous one. Then `superbird-<slug>`, one mcpServers entry
 * each — which fixed the eviction and introduced a worse nuisance: Claude
 * Desktop launches every entry it has at startup, so every project not running
 * that minute failed its handshake and raised its own "could not connect"
 * alert. Now ONE entry whose env carries a map, keyed by this slug: one
 * process, one toolset, one tool list, and nothing to fail for a project that
 * is simply not up.
 */
export const ENTRY_KEY = 'superbird'

function projectSlug(projectName, dataDir) {
  const raw = projectName?.trim() || projectFolder(dataDir)
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || 'project'
}

/** a slug nothing else in the map is using — two sites both called "Site" would
 *  otherwise overwrite each other's url and token */
function uniqueSlug(base, taken, selfInstance) {
  if (!taken[base] || taken[base].instance === selfInstance) return base
  for (let i = 2; i < 50; i++) {
    const candidate = `${base}-${i}`
    if (!taken[candidate] || taken[candidate].instance === selfInstance) return candidate
  }
  return base
}

/**
 * Give a folded entry the instance id it never had — using its TOKEN, never
 * the port.
 *
 * A legacy entry carries a url and no id, and every one of them says :4174,
 * because that was the only default there was. Fold three in and the map
 * claims one address three times; the router reads a missing id as "never a
 * mismatch", so whichever instance holds the port answers for all three and
 * `resolve()` refuses as ambiguous — the fold manufacturing the exact bug the
 * map exists to end.
 *
 * Health alone cannot settle it: reading an id off a port and writing it into
 * an entry IS the bug `readIdentity` exists to avoid, one layer up. The token
 * can. It was minted into ONE data dir, so an instance that accepts it is that
 * project by definition. Rejected, or no answer, we learn nothing and write
 * nothing — an entry we cannot identify is left exactly as it was, because the
 * project it belongs to may simply not be running this minute.
 */
async function identifyInherited(inherited) {
  const named = []
  for (const [slug, p] of Object.entries(inherited)) {
    if (!p || p.instance || typeof p.url !== 'string' || !p.url || !p.token) continue
    const api = createApi({ base: p.url, token: p.token })
    const health = await api.health()
    if (!health || typeof health.instance !== 'string' || !health.instance) continue
    try {
      await api.whoami()
    } catch {
      // Including a PENDING token: an instance with no admin yet answers that
      // way for ANY token, so it proves nothing about which project this is.
      continue
    }
    p.instance = health.instance
    named.push(slug)
  }
  return named
}

/**
 * A remote instance's identity, over HTTP only.
 *
 * `readIdentity` reads instance.json first and consults a server only to
 * confirm it — because probing an address and trusting what answers is how a
 * connect bakes ANOTHER project's id into this project's entry. That reasoning
 * does not apply here: the human named the url explicitly, so the address IS
 * the contract and health is the only identity source there is.
 */
async function remoteIdentity(base) {
  let health = null
  try {
    const res = await fetch(`${base}/api/health`)
    health = await res.json()
  } catch (e) {
    console.error(
      `✗ cannot reach ${base} (${e.message}). Check the url, and that the instance is running\n` +
        '  and reachable from here — a VPS needs its studio published, not just its site.',
    )
    process.exit(1)
  }
  if (!health || typeof health !== 'object') {
    console.error(`✗ ${base} answered /api/health with something that is not a Superbird instance`)
    process.exit(1)
  }
  return {
    id: typeof health.instance === 'string' ? health.instance : '',
    base,
    name: '',
    strayPort: false,
  }
}

/** the remote instance's agent policy and project name, as the token sees them.
 *  Reported rather than set: that file lives in the server's own data dir. */
async function remotePolicy(base, token) {
  try {
    const res = await fetch(`${base}/api/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      console.error(
        `✗ ${base} refused that token (${res.status}). Create a fresh one in its editor under\n` +
          '  My account → API tokens. A token is bound to ONE instance — one from another\n' +
          '  project will always be refused here.',
      )
      process.exit(1)
    }
    const me = await res.json()
    console.log(`✓ token accepted by ${base} as ${plain(me.email)} (${plain(me.role)})`)
    if (me.instance?.name) console.log(`✓ project: ${me.instance.name}`)
    return { ...(me.agentPolicy ?? {}), __name: me.instance?.name ?? '' }
  } catch (e) {
    console.error(`✗ cannot reach ${base}: ${e.message}`)
    process.exit(1)
  }
}

/**
 * Device authorization: get a token for a REMOTE instance without a copy-paste.
 *
 * The CLI asks for a short code, the human approves it in that instance's own
 * /admin where they are already signed in, and the CLI collects the token. The
 * admin session is the remote stand-in for "I hold the data dir" — see
 * server/device.mjs. `--token` remains for a headless runner, which has no
 * browser to approve anything in.
 */
async function authorizeDevice(base) {
  let started
  try {
    const res = await fetch(`${base}/api/auth/device`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'superbird connect (Claude Desktop)' }),
    })
    started = await res.json()
    if (!res.ok) throw new Error(started?.error ?? `could not start (${res.status})`)
  } catch (e) {
    console.error(
      `✗ ${base} would not start an authorization (${e.message}).\n` +
        '  An older instance has no device flow — make a token in its editor under My account →\n' +
        `  API tokens and pass it:  superbird connect --url ${base} --token superbird_…`,
    )
    process.exit(1)
  }
  // `verifyPath` comes from the host we are connecting to, and it is
  // concatenated onto the base and handed to `open`. A value that does not
  // start with a single `/` is not a path on that host: "\\evil.tld/x" and
  // "@evil.tld/x" both make a different origin out of it. The flow's own path
  // is the fallback, so a hostile or old instance cannot redirect the browser.
  const verifyPath =
    typeof started.verifyPath === 'string' && /^\/[^/\\]/.test(started.verifyPath)
      ? started.verifyPath
      : `/admin/authorize?code=${encodeURIComponent(started.userCode ?? '')}`
  const verifyUrl = `${base}${verifyPath}`
  console.log('')
  console.log(`  Approve this connection at:  ${verifyUrl}`)
  console.log(`  Your code:                   ${started.userCode}`)
  console.log('')
  console.log('  Waiting for approval… (ctrl-C to stop)')
  openBrowser(verifyUrl)

  const interval = Math.max(1, Number(started.intervalSeconds) || 2) * 1000
  const deadline = Date.now() + (Number(started.expiresInSeconds) || 600) * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval))
    let body
    try {
      const res = await fetch(`${base}/api/auth/device/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceCode: started.deviceCode }),
      })
      body = await res.json()
      // 429 is the server enforcing its own poll interval — wait, never give up
      if (res.status === 429) continue
      if (res.status === 404) {
        console.error(`\n✗ ${body?.error ?? 'that authorization is gone'}`)
        process.exit(1)
      }
    } catch (e) {
      console.error(`\n✗ lost contact with ${base}: ${e.message}`)
      process.exit(1)
    }
    if (body?.status === 'granted') {
      console.log(`\n✓ approved by ${body.email}`)
      return body
    }
  }
  console.error('\n✗ that code expired before it was approved — run `superbird connect` again')
  process.exit(1)
}

/** best effort: the flow prints the url too, so a failure here costs nothing */
function openBrowser(url) {
  // `start` is a cmd builtin, not an executable, so execFileSync could never
  // find it and Windows silently never opened the browser.
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  try {
    execFileSync(cmd, args, { stdio: 'ignore', timeout: 4000 })
  } catch {
    /* no browser, headless box, or a platform without the helper */
  }
}

/**
 * The one directory the client entry confines every tool path argument to.
 *
 * A local project gets its own folder: that is where a payload would live, and
 * it is already the blast radius of everything else the entry can do. A REMOTE
 * project has no folder on this machine, and the fallback was `process.cwd()` —
 * so anyone who ran `superbird connect --url` from their home directory handed the
 * agent read access to every document under it, uploadable to a site the remote
 * end controls. A remote connect gets a purpose-made directory instead.
 *
 * Either way a root that resolves to the home directory or to a filesystem
 * root is refused: a fence that wide is not a fence, and the only cure once it
 * is written into a client config is noticing.
 */
function fenceRoot(dataDir, remoteUrl) {
  const root = dataDir
    ? resolve(dataDir, '..')
    : join(homedir(), '.superbird', 'payloads', hostSlug(remoteUrl ?? ''))
  const home = resolve(homedir())
  if (root === home || dirname(root) === root) {
    console.error(
      `✗ the agent's file root would be ${root}, which is your whole home directory (or the\n` +
        '  filesystem root). Every tool that takes a local path would reach everything under it.\n' +
        '  Move the project into a folder of its own, or set SUPERBIRD_DATA_DIR to one.',
    )
    process.exit(1)
  }
  return root
}

/** A string from the remote end, safe to print: a terminal reads escape
 *  sequences, and these values are chosen by the host we just met. */
const plain = (value) =>
  // eslint-disable-next-line no-control-regex
  String(value ?? '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200)

/** a slug for a remote project with no local folder to name it after */
function hostSlug(base) {
  try {
    return new URL(base).hostname.replace(/^www\./, '')
  } catch {
    return 'remote'
  }
}

/** the project's own name, for the entry slug (no server needed) */
async function readProjectName(dataDir) {
  try {
    const blob = JSON.parse(await readFile(join(dataDir, 'store', 'superbird-project__main.json'), 'utf8'))
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
  /**
   * REMOTE mode: a project on a VPS, reached over HTTPS.
   *
   * Everything the local flow does to prove it may mint a token touches the
   * data dir — the nonce file that `/api/auth/connect` reads back, and the
   * direct write that `--offline` falls back to. Neither is possible from
   * another machine, and that route is loopback-only besides, so remote
   * connects carry a token the human made in the editor (My account → API
   * tokens) instead of minting one. The agent policy is that instance's own,
   * set in its Settings → MCP rather than by a flag here.
   */
  const remoteUrl = opt('--url')
  const remote = !!remoteUrl
  if (remote && !/^https:\/\//.test(remoteUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(remoteUrl)) {
    console.error(
      `✗ --url must be an https: address (got ${remoteUrl}). A token travels on every request;\n` +
        '  over plain http anything on the path can read it. http is allowed for localhost only.',
    )
    process.exit(1)
  }

  /**
   * The EMBEDDED pair, written only for the AI panel's own config file.
   *
   * `--embedded` puts `SUPERBIRD_MCP_EMBEDDED=1` on the entry, which is the one
   * signal `superbird mcp` reads to drop `use_project` / `set_target` and refuse a
   * write with no target instead of asking for one. It is refused without
   * `--config` because the shared Claude configs are an OUTSIDE client's: an
   * embedded entry there would leave Claude Desktop unable to say which
   * project it meant.
   *
   * `--target` writes the project's target unconditionally — the editor knows
   * which branch is loaded, and that answer is not the agent policy's to
   * gate. Without it the external rule stands: a target is written only when
   * Main is allowed.
   */
  const embedded = flag('--embedded')
  if (embedded && !opt('--config')) {
    console.error(
      '✗ --embedded needs --config <file>. It marks ONE config file as the editor\'s own AI\n' +
        '  panel; the shared Claude Code and Claude Desktop configs belong to an outside\n' +
        '  client, which has no editor to ask which project and branch it is looking at.',
    )
    process.exit(1)
  }
  const wantTarget = opt('--target')
  if (wantTarget !== undefined && !/^(main|[0-9a-f-]{8,})$/i.test(wantTarget)) {
    console.error(
      `✗ --target must be "main" or a draft id (got "${wantTarget}"). ` +
        'A draft is not created here — the editor makes it.',
    )
    process.exit(1)
  }

  const dataDir = remote ? null : await resolveDataDir()
  const fileRoot = fenceRoot(dataDir, remoteUrl)
  // a remote project's payload directory is ours to make; a local project's
  // folder is the one connect was just run in
  if (remote) await mkdir(fileRoot, { recursive: true, mode: 0o700 })
  // Pin it for every server module loaded from here on. `util.mjs` reads
  // SUPERBIRD_DATA_DIR once at import time and `agent-policy.mjs` derives its file
  // from that, so without this the token could be written to one dir and the
  // policy beside it to another — which is exactly what the clone layout did.
  if (dataDir) process.env.SUPERBIRD_DATA_DIR = dataDir
  // The address of THIS project, not of port 4174. An explicit SUPERBIRD_URL or
  // PORT is a contract and still wins; otherwise the port this data dir last
  // landed on is what the entry gets baked with, so a second project's config
  // never points at the first project's socket.
  const pinned = remote
    ? remoteUrl
    : process.env.SUPERBIRD_URL || (process.env.PORT ? `http://localhost:${process.env.PORT}` : '')
  // Give this data dir an id BEFORE reading its identity, or a project that
  // has never booted gets an entry with none — see ensureLocalIdentity.
  if (dataDir) await ensureLocalIdentity(dataDir)
  const identity = remote
    ? await remoteIdentity(remoteUrl.replace(/\/+$/, ''))
    : await readIdentity((pinned || 'http://localhost:4174').replace(/\/+$/, ''), dataDir)
  const base = (pinned || identity.base).replace(/\/+$/, '')
  if (identity.strayPort && !pinned) {
    console.log(`! another Superbird project is on :4174 — this entry targets ${base} instead`)
  }

  // 1. the agent permissions — asked before anything is written, so a ^C here
  //    changes nothing. A remote instance owns its own policy: it lives in that
  //    server's data dir, which this machine cannot write.
  const policy = remote ? {} : await choosePolicy(flag)

  // 2. mint a token. Through the running server when there is one (its token
  //    cache stays coherent); straight into the data dir when it is down —
  //    or with --offline, which never asks the network: a server on the
  //    default port may belong to ANOTHER project, and minting through it
  //    would connect Claude to the wrong instance. The scaffolder passes it.
  let minted
  if (remote) {
    // env as well as the flag: the desktop launcher spawns this, and a token
    // on argv is readable by every process on the machine through `ps`
    const given = opt('--token') ?? process.env.SUPERBIRD_CONNECT_TOKEN ?? ''
    if (given) {
      // The escape hatch, and the only option on a headless box: a token the
      // human made in that instance's editor. Being signed in there to create
      // it is the same proof the device flow asks for, done by hand.
      // A launcher token (`superbirdl_…`) is named rather than lumped in with
      // nonsense: it IS a Superbird credential, it is simply the other kind, and
      // the server would refuse it by name on the first call anyway. Saying so
      // here saves the round trip and the confusion.
      if (/^superbirdl_/.test(given)) {
        console.error(
          '✗ that is a launcher token, which opens the editor and cannot drive the MCP.\n' +
            '  Make an agent token in that instance\'s editor under My account → API tokens,\n' +
            '  or run `superbird connect --url <host>` with no --token and approve it in the browser.',
        )
        process.exit(1)
      }
      if (!/^superbird_[0-9a-f]{16,}$/.test(given)) {
        console.error(
          `✗ --token does not look like a Superbird API token (expected superbird_… ): "${given.slice(0, 12)}…"\n` +
            '  Make one in that instance\'s editor under My account → API tokens.',
        )
        process.exit(1)
      }
      minted = { token: given, email: null, agentPolicy: await remotePolicy(base, given) }
    } else {
      // No token: ask the instance to authorize this machine, and let the
      // human approve it in a browser. No clipboard, no shell history, and the
      // agent policy gets chosen in a UI that explains it.
      const granted = await authorizeDevice(base)
      minted = {
        token: granted.token,
        email: granted.email,
        agentPolicy: { ...(granted.agentPolicy ?? {}), __name: granted.projectName ?? '' },
      }
      if (granted.instance) identity.id = granted.instance
    }
  } else if (flag('--offline')) {
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

  const projectName = remote
    ? minted.agentPolicy?.__name || identity.name
    : await readProjectName(dataDir)
  const targets = clientTargets(opt('--config'))
  const sameUrlNamed = new Set()
  const writtenTo = []
  let slug = ''
  let blockedByDesktop = false
  let refusedAny = false

  for (const target of targets) {
    // Read the config BEFORE building the entry: this project is one key in
    // the shared entry's SUPERBIRD_PROJECTS map, so the other projects already in
    // it are part of what gets written back. Each client keeps its own map —
    // they were connected at different times and neither is the authority on
    // the other — so the fold, the slug and the entry are all per file.
    let config = null
    let unreadable = false
    try {
      config = JSON.parse(await readFile(target.path, 'utf8'))
    } catch (e) {
      // ENOENT is a client that was never configured — ours to create. A PARSE
      // error is someone else's file that we cannot safely rewrite: it holds
      // every other MCP server they have, and `{...null, mcpServers}` replaces
      // the lot with ours. One trailing comma, one // comment or a BOM is
      // enough to get there, and the loss is silent and total.
      unreadable = e.code !== 'ENOENT'
    }
    // ...except under --print, which writes nothing and is the escape hatch the
    // refusal below points at
    if (unreadable && !flag('--print')) {
      console.error(
        `\n✗ ${target.label === target.path ? target.path : `${target.label} (${target.path})`}` +
          ' is not valid JSON.\n' +
          '  Rewriting it would drop whatever else is in it — every other MCP server you have\n' +
          '  configured there. Fix the file (a trailing comma or a comment is usually it), or\n' +
          '  move it aside, then run `superbird connect` again. `--print` gives you the entry to\n' +
          '  paste in by hand.',
      )
      refusedAny = true
      continue
    }
    if (!config && !target.always) continue
    const servers = { ...(config?.mcpServers ?? {}) }

    /**
     * Fold every legacy per-project entry into the map.
     *
     * `superbird-<slug>` entries are what Claude Desktop launches one process each
     * for, so leaving them in place would keep raising the alerts this is meant
     * to end — and they are unambiguously ours (the key, the command and the
     * SUPERBIRD_URL all say so), unlike a sibling entry pointing at a port we cannot
     * identify. The bare `superbird` key is the one being taken over, so its own env
     * is folded in too.
     */
    const inherited = {}
    for (const [key, value] of Object.entries(servers)) {
      if (key !== ENTRY_KEY && !key.startsWith('superbird-')) continue
      const env = value?.env ?? {}
      // already a map? take every project in it
      if (typeof env.SUPERBIRD_PROJECTS === 'string' && env.SUPERBIRD_PROJECTS) {
        try {
          for (const [s, p] of Object.entries(JSON.parse(env.SUPERBIRD_PROJECTS))) {
            // either address is enough to keep an entry: `dir` for a local
            // project, `url` for a remote one
            if (p && typeof p === 'object' && (typeof p.url === 'string' || typeof p.dir === 'string')) {
              inherited[s] = p
            }
          }
        } catch {
          /* malformed map — the router drops bad entries too; do not lose the rest */
        }
        continue
      }
      if (typeof env.SUPERBIRD_URL !== 'string' || !env.SUPERBIRD_URL) continue
      const legacySlug = key === ENTRY_KEY ? projectSlug('', '') : key.slice('superbird-'.length)
      inherited[legacySlug] = {
        url: env.SUPERBIRD_URL.replace(/\/+$/, ''),
        token: env.SUPERBIRD_TOKEN ?? '',
        ...(env.SUPERBIRD_INSTANCE ? { instance: env.SUPERBIRD_INSTANCE } : {}),
        ...(env.SUPERBIRD_MCP_TARGET ? { target: env.SUPERBIRD_MCP_TARGET } : {}),
      }
    }
    const foldedIn = Object.keys(servers).filter((k) => k !== ENTRY_KEY && k.startsWith('superbird-'))
    const named = await identifyInherited(inherited)

    // This project's own key. One INSTANCE is one key: an entry already
    // carrying our id is this project under an older name — the slug it was
    // written with (a data-dir folder, before the project was named) is not
    // the slug we would choose today — so we take that key over and overwrite
    // it, instead of adding a second entry for one site. Skipping this is how
    // a reconnect manufactured the ambiguity the map exists to end: two keys,
    // one instance, both reachable, and `resolve()` refusing to guess
    // between them. `identifyInherited` above is what makes it detectable,
    // having just proved the legacy entry's identity with its own token.
    // Any further duplicates go, for the same reason.
    const mine = identity.id ? Object.keys(inherited).filter((s) => inherited[s].instance === identity.id) : []
    for (const dup of mine.slice(1)) delete inherited[dup]
    slug =
      mine[0] ??
      uniqueSlug(projectSlug(projectName, dataDir ?? hostSlug(base)), inherited, identity.id)
    const projects = {
      ...inherited,
      [slug]: {
        // The data dir is the authority on where this project is; the url is
        // a cached guess that is wrong the first time the port moves. The
        // router reads `<dir>/instance.json` for the port the server actually
        // got, so a project that restarts elsewhere is still found and the
        // entry never goes stale. Remote projects have no local dir and keep
        // url alone. → docs/instance.md
        ...(dataDir ? { dir: dataDir } : {}),
        url: base,
        token: minted.token,
        // Which project this token belongs to. `superbird mcp` compares it against
        // /api/health before presenting the token, so another project squatting
        // the port is REFUSED by name instead of answering with a 401 that reads
        // as "the token is dead".
        ...(identity.id ? { instance: identity.id } : {}),
        // Main allowed → the target is settled in the client's own config, the
        // one consent channel a prompt-injected agent cannot reach, and the agent
        // starts working instead of asking "Main or a draft?". Per PROJECT, so
        // pinning Main for a landing page does not pin it for a client's site.
        // `--target` overrides that rule outright: it is the editor saying which
        // branch is open, which the agent policy does not get a vote on — the
        // policy still refuses the WRITE server-side if Main is off.
        ...(wantTarget ? { target: wantTarget } : mainAllowed ? { target: 'main' } : {}),
        ...(projectName ? { name: projectName } : {}),
      },
    }

    const entry = {
      // Claude Desktop infers the transport; Claude Code names it, and an
      // entry written by hand there always carries it.
      ...(target.stdio ? { type: 'stdio' } : {}),
      command: process.execPath,
      args: [join(ROOT, 'bin', 'superbird.js'), 'mcp'],
      env: {
        SUPERBIRD_PROJECTS: JSON.stringify(projects),
        // Confine the tools' local-path arguments. They are a read-anything —
        // and, through the worklist writer, a write-anything — primitive the
        // moment an agent can be talked into a path, and `superbird mcp` could only
        // WARN that this was unset. The project folder is the right default: it
        // is where a payload would live, and it is already the blast radius of
        // everything else this entry can do.
        // A remote project has no local data dir, and the directory connect
        // was run from is NOT a safe answer for it — see fenceRoot.
        SUPERBIRD_MCP_FILE_ROOT: fileRoot,
        // The one signal. → docs/instance.md, docs/mcp.md (Embedded mode)
        ...(embedded ? { SUPERBIRD_MCP_EMBEDDED: '1' } : {}),
      },
    }

    // --print: emit the snippet for any MCP client, touch nothing
    if (flag('--print')) {
      console.log(
        `\nmode: ${embedded ? 'embedded (the editor\'s AI panel)' : 'external client'}` +
          `  ·  target: ${projects[slug].target ?? '(none — the agent is asked)'}`,
      )
      console.log('\nAdd this under "mcpServers" in your MCP client config:\n')
      console.log(JSON.stringify({ [ENTRY_KEY]: entry }, null, 2))
      return
    }

    // Claude Desktop flushes its in-memory config on quit, so a write made
    // while it runs is silently reverted. Claude Code re-reads its own file
    // per session and needs no quit — which is why it is written first, and
    // why a Desktop left open no longer costs that write too.
    let skip = false
    while (target.needsQuit && !flag('--force') && claudeDesktopRunning()) {
      const answer = opts.whenClaudeRunning ? await opts.whenClaudeRunning() : 'exit'
      if (answer === 'retry') continue
      if (answer === 'skip') {
        console.log(`\n${target.label} left running — its config was not written. Add this under "mcpServers" yourself:\n`)
        console.log(JSON.stringify({ [ENTRY_KEY]: entry }, null, 2))
        console.log('\nor quit it and run `npm run connect` later to write it for you.')
        skip = true
        break
      }
      console.error(
        `\n✗ ${target.label} is running. Quit it completely first (it overwrites its config\n` +
          '  on quit, which would silently undo this setup), then re-run `superbird connect`.',
      )
      blockedByDesktop = true
      skip = true
      break
    }
    if (skip) continue

    for (const key of foldedIn) delete servers[key]
    servers[ENTRY_KEY] = entry
    const next = { ...(config ?? {}), mcpServers: servers }

    // Two projects on ONE url is a real problem and still worth naming: whichever
    // instance holds the port answers for both, and only one of the two tokens
    // can be accepted. The map cannot fix that — it is a port collision, not a
    // config one.
    for (const [s, p] of Object.entries(projects)) {
      if (s === slug || p.url !== base || p.instance === identity.id) continue
      if (sameUrlNamed.has(s)) continue
      sameUrlNamed.add(s)
      console.log(
        `! project "${s}" also targets ${base} but is a different project — it cannot work\n` +
          `  while this one holds that port. Give one of them its own PORT in its .env.`,
      )
    }

    await writeJsonAtomic(target.path, next)

    // Read it back before claiming it worked. A write can be reverted between
    // the two (Claude Desktop flushing its in-memory config as it quits is the
    // one that happens), and a success line printed over a reverted write is
    // the worst outcome there is: the person goes looking for a server problem
    // for an hour because the setup said it was done.
    let landed = false
    try {
      const back = JSON.parse(await readFile(target.path, 'utf8'))
      landed = back?.mcpServers?.[ENTRY_KEY]?.env?.SUPERBIRD_PROJECTS === entry.env.SUPERBIRD_PROJECTS
    } catch {
      /* unreadable counts as not landed */
    }
    if (!landed) {
      console.error(
        `\n✗ ${target.label}'s config did not keep this write (${target.path}).\n` +
          '  It was almost certainly rewritten from memory by a running client — quit it\n' +
          '  completely and run `superbird connect` again.',
      )
      blockedByDesktop = true
      continue
    }
    writtenTo.push(target.label)
    console.log(`✓ ${target.label} config updated: ${target.path}`)
    if (named.length) {
      console.log(
        `  named ${named.length} project${named.length === 1 ? '' : 's'} that carried no instance id ` +
          `(${named.join(', ')}) — each one's own token identified it`,
      )
    }
    if (foldedIn.length) {
      console.log(
        `✓ folded ${foldedIn.length} per-project entr${foldedIn.length === 1 ? 'y' : 'ies'} into one ` +
          `(${foldedIn.join(', ')}) — ${target.label} no longer starts a process per project, so it\n` +
          '  stops reporting "could not connect" for the ones you are not running',
      )
    }
  }

  if (!writtenTo.length) {
    // Nothing was written: the only client that could be was left running, or
    // Claude Code has never run here and Desktop was skipped. Either way the
    // old single-client exit code is what a script expects.
    if (blockedByDesktop || refusedAny) process.exit(1)
    return
  }
  console.log(`\nDone. Open ${writtenTo.join(' or ')} — superbird is connected, working on "${slug}".`)
  console.log(`  Local files the agent may read: ${fileRoot} (and nothing outside it).`)
  if (writtenTo.includes('Claude Code')) {
    console.log('  A Claude Code session that is already open re-reads its config on restart.')
  }
}
