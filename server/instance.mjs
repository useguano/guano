// Instance identity — which Superbird project this data dir IS.
//
// Several projects on one machine all default to port 4174, so the port alone
// names nothing: whichever instance boots first owns the address, and every
// client configured by it (the Vite proxy, an open tab, the MCP server's
// SUPERBIRD_URL) keeps talking to whatever is squatting there. An API token is
// minted into ONE data dir, so a client that reaches the wrong instance is
// answered with a 401 that is indistinguishable from a revoked token — which
// is how "the token is active but the MCP is not connected" happens, with
// nothing anywhere naming the real cause.
//
// This file is the missing name. `id` is an opaque random string minted once
// per data dir and never changed: `superbird connect` writes it into the client
// config as SUPERBIRD_INSTANCE, `/api/health` reports it, and `superbird mcp` compares
// the two at boot so a mismatch is REFUSED with both project names in the
// message instead of failing mutely. It is deliberately opaque — /api/health
// is the one unauthenticated route, and an id carries no path and no secret,
// while the human-readable `name` is served only to an authed caller.
//
// `port` is the second half: the port this project landed on last time. An
// unset PORT prefers it over the 4174 default, so a project keeps its address
// across restarts and two projects stop trading one port back and forth
// depending on boot order. (There was a `previewPort` beside it until the
// preview moved onto this server under /_superbird/preview — a record of a second
// listener that no longer exists.)
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { DATA_DIR, writeAtomic } from './util.mjs'

const INSTANCE_FILE = join(DATA_DIR, 'instance.json')

/** Shape: { id, name, port, createdAt } */
function sanitize(parsed) {
  if (!parsed || typeof parsed !== 'object') return null
  const id = typeof parsed.id === 'string' && /^[0-9a-f]{8,64}$/.test(parsed.id) ? parsed.id : null
  if (!id) return null
  const portOf = (v) => (Number.isInteger(v) && v > 0 && v < 65536 ? v : null)
  return {
    id,
    name: typeof parsed.name === 'string' ? parsed.name : '',
    port: portOf(parsed.port),
    createdAt: Number.isFinite(parsed.createdAt) ? parsed.createdAt : null,
  }
}

/** the record on disk, or null when absent/corrupt. Never throws. */
export async function readInstance() {
  try {
    return sanitize(JSON.parse(await readFile(INSTANCE_FILE, 'utf8')))
  } catch {
    return null
  }
}

/**
 * The record, minting one on first call. Called from boot() before the socket
 * accepts anything, so every later reader can treat the id as a constant.
 *
 * A corrupt or hand-edited file is replaced rather than repaired: the id's only
 * job is to be stable, and a fresh one costs exactly one `superbird connect`.
 */
export async function ensureInstance() {
  const found = await readInstance()
  if (found) return found
  const fresh = {
    id: randomBytes(16).toString('hex'),
    name: '',
    port: null,
    createdAt: Date.now(),
  }
  await writeAtomic(INSTANCE_FILE, JSON.stringify(fresh))
  return fresh
}

/**
 * Merge `patch` into the record and persist it. Returns the merged record.
 *
 * The ports are written AFTER listen resolves, because the port a project owns
 * is the one it actually got — recording the one it asked for would remember a
 * number that was already taken. `name` is filled in when the project is
 * seeded or renamed, so the refusal message can say "landing" instead of a
 * hex string.
 */
export async function updateInstance(patch) {
  const current = (await readInstance()) ?? (await ensureInstance())
  const next = sanitize({ ...current, ...patch })
  if (!next) return current
  await writeAtomic(INSTANCE_FILE, JSON.stringify(next))
  return next
}
