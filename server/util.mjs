// Shared server helpers — single home for the response + atomic-write
// primitives that index.mjs, auth.mjs and media.mjs previously each
// hand-rolled.
import { timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './log.mjs'

// Runtime data location, single source for index/auth/media/export-media.
// GUANO_DATA_DIR wins (SB_DATA_DIR is the deprecated pre-rename name —
// index.mjs warns). An npm-installed package must never write user data
// inside node_modules (wiped on reinstall), so when this file lives under
// one the default is <cwd>/data; a repo clone keeps server/data. Absolute
// either way — the exporter's write-path backstop rejects relative dirs.
const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url))
export const DATA_DIR =
  process.env.GUANO_DATA_DIR ||
  process.env.SB_DATA_DIR ||
  (PKG_ROOT.split(sep).includes('node_modules')
    ? join(process.cwd(), 'data')
    : join(PKG_ROOT, 'server', 'data'))

export function send(res, status, body, type = 'application/json', headers = {}) {
  res.writeHead(status, { 'content-type': type, ...headers })
  res.end(body)
}

/** constant-time string equality (length-safe — differing lengths return false
 * without leaking via an early exit) */
export function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export const fail = (res, status, error) => send(res, status, JSON.stringify({ error }))

// fsync costs a few ms per write and buys durability across a power loss or a
// VM kill: without it the rename can land pointing at a file whose bytes never
// left the page cache, i.e. a zero-length project. Autosave is debounced, so
// the cost is paid at most twice a second. GUANO_FSYNC=0 opts out for anyone
// who would rather have the throughput.
const FSYNC = process.env.GUANO_FSYNC !== '0'

// A per-process counter, because two overlapping writers sharing one
// `${file}.tmp` meant the loser's rename hit a path the winner had already
// renamed away — an ENOENT swallowed by the caller's `.catch(() => {})`. Two
// logins writing sessions.json at once is the case that hit this.
let tmpSeq = 0

/** write via tmp file + rename so readers never see a partial write.
 * Data files carry secrets (sessions, invite tokens, smtp creds, the GitHub
 * token), so the tmp file is created 0600 and rename carries the mode over —
 * owner-only on shared hosts. Data dirs likewise 0700. */
export async function writeAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp-${process.pid}-${++tmpSeq}`
  const fh = await open(tmp, 'w', 0o600)
  try {
    await fh.writeFile(data)
    if (FSYNC) await fh.sync()
  } finally {
    await fh.close()
  }
  await rename(tmp, file)
  // the rename itself is only durable once the DIRECTORY entry is flushed.
  // Best-effort: some platforms refuse to open a directory for sync, and a
  // failure here costs durability, never correctness.
  if (FSYNC) {
    try {
      const dir = await open(dirname(file), 'r')
      try {
        await dir.sync()
      } finally {
        await dir.close()
      }
    } catch {
      // not fatal — the file's own bytes are already on disk
    }
  }
}

/** replace `live` with `staged`: move live aside, staged in, drop the old.
 *
 * The rollback is the point. Without it a failing second rename leaves NO live
 * directory at all — a publish that threw halfway served "Nothing published
 * yet" to every visitor until the next successful one. The `rm(old)` is
 * deliberately NOT in a `finally`: a finally would run after the rollback
 * rename and delete the directory it had just restored. */
export async function swapDir(live, staged) {
  const old = `${live}.old-${Date.now()}`
  let moved = false
  if (existsSync(live)) {
    await rename(live, old)
    moved = true
  }
  try {
    await rename(staged, live)
  } catch (err) {
    if (moved) await rename(old, live).catch(() => {})
    await rm(staged, { recursive: true, force: true }).catch(() => {})
    throw err
  }
  // a failed cleanup must never mask a successful swap — the boot sweep
  // collects whatever is left behind
  await rm(old, { recursive: true, force: true }).catch(() => {})
}

/** build into `${target}.tmp-<ts>`, then swap it into place.
 *
 * The `finally` is a no-op on the happy path (swapDir already renamed the
 * staging dir away, and rm with `force` on a missing path does nothing) and is
 * exactly what the stranded `data/site.tmp-…` directories needed: the old
 * hand-rolled version cleaned up only on success, so any throw between mkdir
 * and the swap leaked a full copy of the site forever. */
export async function withStagingDir(target, fn) {
  const tmp = `${target}.tmp-${Date.now()}`
  await mkdir(tmp, { recursive: true })
  try {
    const result = await fn(tmp)
    await swapDir(target, tmp)
    return result
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

/** how old a staging directory must be before a boot sweep will remove it */
export const STALE_AGE_MS = Number(process.env.GUANO_STALE_AGE_MS) || 60 * 60 * 1000

/** embedded `Date.now()` from a `<base>.tmp-<ts>` name, else the dir's mtime,
 * else 0 (meaning "ancient", so it gets swept) */
async function ageOf(full, stamp) {
  const ts = Number(stamp)
  if (Number.isFinite(ts) && ts > 0) return Date.now() - ts
  try {
    return Date.now() - (await stat(full)).mtimeMs
  } catch {
    return 0
  }
}

/** remove stale `<base>.tmp-<ts>` / `<base>.old-<ts>` directories left behind
 * by a swap that was killed mid-flight.
 *
 * AGE-GATED, and that is not an optimisation. Two guano processes CAN share one
 * data dir — it is the documented port-walk scenario (see the PORT WAS BUSY
 * warning in index.mjs), where an older instance keeps serving from its own
 * heap. An unconditional sweep would delete the staging directory of a publish
 * the other process is halfway through. An hour-old staging dir is dead; a
 * minute-old one may be someone's export.
 *
 * `bases` is an exact list on purpose. Never loosen it to a prefix match:
 * `store.pre-v2` is the ONLY way back from the one-way schema migration, and
 * `store.*` would eat it. */
export async function sweepStaleDirs(dir, bases, maxAgeMs = STALE_AGE_MS) {
  const pattern = new RegExp(`^(${bases.join('|')})\\.(tmp|old)-(\\d+)$`)
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  let swept = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const match = pattern.exec(entry.name)
    if (!match) continue
    const full = join(dir, entry.name)
    if ((await ageOf(full, match[3])) < maxAgeMs) continue
    try {
      await rm(full, { recursive: true, force: true })
      swept++
    } catch (err) {
      log.warn(`boot: could not remove ${entry.name}: ${err.message}`)
    }
  }
  return swept
}

// `${file}.tmp` is the legacy writeAtomic name, `${file}.tmp-<pid>-<n>` the
// current one, and `<id>.jsonl.tmp` is the submission store's own hand-rolled
// rewrite. All three end the same way.
const TMP_FILE_RE = /\.tmp(-\d+-\d+)?$/

/** remove orphan tmp FILES from an interrupted writeAtomic.
 *
 * Non-recursive per directory, deliberately: a recursive walk would descend
 * into `media/files`, whose names are content hashes that must never be
 * guessed at, and would cost real time at every boot on a large library. */
export async function sweepOrphanTmpFiles(dirs, maxAgeMs = STALE_AGE_MS) {
  let swept = 0
  for (const dir of dirs) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile() || !TMP_FILE_RE.test(entry.name)) continue
      const full = join(dir, entry.name)
      try {
        if (Date.now() - (await stat(full)).mtimeMs < maxAgeMs) continue
        await rm(full, { force: true })
        swept++
      } catch (err) {
        log.warn(`boot: could not remove ${basename(full)}: ${err.message}`)
      }
    }
  }
  return swept
}

/** recursively read every file under `dir` → [{ path, data }] with
 * forward-slash relative paths. Returns [] when the dir is missing. Shared by
 * the zip publish method and the GitHub push. */
export async function readDirFiles(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true })
  } catch {
    return []
  }
  const out = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const full = join(entry.parentPath ?? entry.path, entry.name)
    out.push({ path: relative(dir, full).split('\\').join('/'), data: await readFile(full) })
  }
  return out
}

/** depth-first visit of every node in an element tree (mirrors src/lib/tree.ts) */
export function walkNodes(nodes, visit) {
  for (const node of nodes) {
    visit(node)
    walkNodes(node.children ?? [], visit)
  }
}
