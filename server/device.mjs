// Device authorization for `guano connect --url <remote>`.
//
// WHY IT EXISTS. The local connect flow proves it may mint a token by writing
// a nonce into the data dir, which `/api/auth/connect` reads back — filesystem
// access IS ownership — and that route is loopback-only besides. Neither is
// possible from another machine, so a VPS could not be connected at all. The
// remote stand-in for "I hold the data dir" is "I can sign in to this
// instance's /admin as an admin", which is exactly what a device flow asks
// for: the CLI shows a short code, the human approves it in a browser where
// they are already signed in, and the CLI collects the token.
//
// It replaces copy-pasting a token out of the editor, which works (and remains
// the `--token` escape hatch, and the only option for a headless CI runner)
// but puts a credential through a clipboard and a shell history.
//
// IN MEMORY, DELIBERATELY. A pending authorization lives for ten minutes and is
// single-use, so there is nothing worth persisting — and keeping it off disk
// means no file to sweep, no retention policy, and nothing for the boot sweep
// or a snapshot to carry. A restart simply loses the pending codes, and the CLI
// reports the expiry it would have reported anyway.
import { randomBytes, timingSafeEqual } from 'node:crypto'

/** ten minutes: long enough to find the browser window, short enough that a
 *  code left on a screen stops meaning anything */
const TTL_MS = 10 * 60 * 1000
/** what the CLI is told to wait between polls, and what is enforced */
export const POLL_INTERVAL_S = 2
/** A cap, so an unauthenticated endpoint cannot grow the map without bound.
 *  Small on purpose: these are minted one human at a time. */
const MAX_PENDING = 12
/**
 * ...and a cap per ADDRESS, because the global one alone is a denial of
 * service: the start endpoint is unauthenticated, so two hosts on the network
 * (or one, over two minutes) could hold all twelve slots indefinitely and
 * every real `guano connect --url` got a 429. One human starts one
 * authorization at a time; two allows for a mistyped code.
 */
const MAX_PENDING_PER_IP = 2
/** No 0/O/1/I/5/S — the code is read off one screen and typed into another. */
const ALPHABET = 'ACDEFGHJKLMNPQRTUVWXYZ2346789'

const pending = new Map() // userCode -> record

const now = () => Date.now()

function sweep() {
  for (const [code, rec] of pending) if (rec.expiresAt <= now()) pending.delete(code)
}

function userCode() {
  const pick = () =>
    Array.from(randomBytes(4), (b) => ALPHABET[b % ALPHABET.length]).join('')
  for (let i = 0; i < 20; i++) {
    const code = `${pick()}-${pick()}`
    if (!pending.has(code)) return code
  }
  return null
}

/** constant-time compare for the device code, which is the actual secret */
function sameSecret(a, b) {
  const x = Buffer.from(String(a ?? ''))
  const y = Buffer.from(String(b ?? ''))
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Start an authorization. Unauthenticated — the CLI has no credential yet,
 * which is the whole point — so it is rate-limited by the caller and capped
 * here.
 */
export function startDevice({ name, ip, kind } = {}) {
  sweep()
  if (pending.size >= MAX_PENDING) {
    return { error: 'too many pending authorizations — wait for them to expire and try again' }
  }
  const from = String(ip ?? '?')
  let mine = 0
  for (const rec of pending.values()) if (rec.ip === from) mine++
  if (mine >= MAX_PENDING_PER_IP) {
    return { error: 'too many pending authorizations from your address — wait for them to expire' }
  }
  const code = userCode()
  if (!code) return { error: 'could not allocate a code — try again' }
  const deviceCode = randomBytes(32).toString('hex')
  pending.set(code, {
    deviceCode,
    // WHICH KIND of token this authorization will mint, decided by the client
    // that started it and carried through to the consent screen — because
    // "Guano Launcher wants builder access" and "Claude wants to work on this
    // site" are different sentences, and a human approving one must not be
    // approving the other. Anything but the launcher is an agent, so an older
    // CLI that sends no kind is unchanged.
    kind: kind === 'launcher' ? 'launcher' : 'agent',
    name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : 'guano connect',
    // The name is the REQUESTER's to choose, so it is a label and never
    // evidence. The address is ours, and it is what lets the admin tell their
    // own terminal apart from somebody else's on the same network.
    ip: from,
    createdAt: now(),
    expiresAt: now() + TTL_MS,
    lastPolledAt: 0,
    // filled in by approve(); until then a poll answers "pending"
    granted: null,
  })
  return { userCode: code, deviceCode, expiresInSeconds: Math.floor(TTL_MS / 1000) }
}

/** what the consent screen shows. Never the device code — that is the CLI's. */
export function describeDevice(code) {
  sweep()
  const rec = pending.get(String(code ?? '').toUpperCase())
  if (!rec) return null
  return {
    userCode: String(code).toUpperCase(),
    name: rec.name,
    kind: rec.kind ?? 'agent',
    ip: rec.ip,
    createdAt: rec.createdAt,
    expiresAt: rec.expiresAt,
    approved: !!rec.granted,
  }
}

/**
 * Approve it. The caller has already checked that this is an admin with a
 * SESSION — that check is the entire proof of authority, so it does not belong
 * in here where it could be forgotten.
 */
export function approveDevice(code, grant) {
  sweep()
  const key = String(code ?? '').toUpperCase()
  const rec = pending.get(key)
  if (!rec) return { error: 'that code has expired or was never issued' }
  if (rec.granted) return { error: 'that code has already been used' }
  rec.granted = grant
  return { ok: true }
}

export function denyDevice(code) {
  const key = String(code ?? '').toUpperCase()
  const had = pending.delete(key)
  return { ok: had }
}

/**
 * The CLI's poll. Single-use: a granted record is deleted as it is handed over,
 * so the token crosses this boundary exactly once.
 */
export function pollDevice(deviceCode) {
  sweep()
  for (const [key, rec] of pending) {
    if (!sameSecret(rec.deviceCode, deviceCode)) continue
    const since = now() - rec.lastPolledAt
    if (since < POLL_INTERVAL_S * 1000) {
      return { slowDown: true, retryAfterSeconds: POLL_INTERVAL_S }
    }
    rec.lastPolledAt = now()
    if (!rec.granted) return { status: 'pending' }
    pending.delete(key)
    return { status: 'granted', ...rec.granted }
  }
  return { error: 'unknown or expired device code — run `guano connect` again' }
}

/** for tests and for the shutdown path: nothing here outlives the process */
export function clearDevices() {
  pending.clear()
}
