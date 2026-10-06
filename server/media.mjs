// Media library: uploaded assets stored on disk, referenced by stable id URLs.
//   GET    /api/media                     🔒 index (assets + folders)
//   POST   /api/media?name=&folder=       🔒 upload (raw body, Content-Type = mime)
//   POST   /api/media/:id/replace         🔒 editor+ — swap bytes, keep id/URL
//   PATCH  /api/media/:id                 🔒 {name?, alt?, folderId?}
//   DELETE /api/media/:id                 🔒 editor+
//   GET    /api/media/:id/usage           🔒 reference count across all branch blobs
//   POST/PATCH/DELETE /api/media/folders  🔒 editor+
//
// Role split: contributors browse, upload and re-caption; replacing bytes,
// deleting assets and restructuring folders are editor+ (they change shared
// library state every page renders from).
//   GET    /media/:id, /media/thumb/:id   🌐 bytes only (published site needs them)
//
// Layout: server/data/media/{index.json, files/<id>, thumbs/<id>.webp}
// Files are stored extensionless under server-generated ids — the client
// filename is metadata only and never touches a filesystem path. Content-Type
// on serve always comes from the index, never from sniffing or the request.

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './log.mjs'
import sharp from 'sharp'
import { DATA_DIR, fail, send, writeAtomic } from './util.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MEDIA_DIR = join(DATA_DIR, 'media')
const FILES_DIR = join(MEDIA_DIR, 'files')
const THUMBS_DIR = join(MEDIA_DIR, 'thumbs')
const INDEX_FILE = join(MEDIA_DIR, 'index.json')
const STORE_DIR = join(DATA_DIR, 'store')

const ID_RE = /^[a-f0-9]{16}$/
const QUOTA = Number(process.env.MEDIA_QUOTA) || 2 * 1024 * 1024 * 1024
const THUMB_SIZE = 480
// pixel-bomb guard: sharp refuses images whose decoded size exceeds this
const MAX_PIXELS = 268402689 // ~16k × 16k

// mime allowlist — anything not listed is rejected with 415, no matter what
// the request claims. text/html, javascript and generic xml are the classic
// upload→stored-XSS vectors and are deliberately absent.
const ALLOWED = {
  'image/png': { kind: 'image', ext: '.png' },
  'image/jpeg': { kind: 'image', ext: '.jpg' },
  'image/gif': { kind: 'image', ext: '.gif' },
  'image/webp': { kind: 'image', ext: '.webp' },
  'image/avif': { kind: 'image', ext: '.avif' },
  'image/svg+xml': { kind: 'image', ext: '.svg' },
  'video/mp4': { kind: 'video', ext: '.mp4' },
  'video/webm': { kind: 'video', ext: '.webm' },
  'audio/mpeg': { kind: 'audio', ext: '.mp3' },
  'audio/wav': { kind: 'audio', ext: '.wav' },
  'audio/ogg': { kind: 'audio', ext: '.ogg' },
  'application/pdf': { kind: 'document', ext: '.pdf' },
  'font/woff2': { kind: 'font', ext: '.woff2' },
  'font/woff': { kind: 'font', ext: '.woff' },
  'font/ttf': { kind: 'font', ext: '.ttf' },
  'font/otf': { kind: 'font', ext: '.otf' },
}

const SIZE_CAPS = {
  image: 20 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  audio: 200 * 1024 * 1024,
  document: 25 * 1024 * 1024,
  font: 25 * 1024 * 1024,
}

// ---------- request guards ----------

/** cross-origin mutations are rejected; same-origin and non-browser
 *  clients (no Origin header) pass — defense-in-depth over SameSite=Lax */
export function originAllowed(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/** streams the body up to `limit` bytes; returns null the moment the cap is
 *  crossed (never buffers an oversized upload). The caller sends its error
 *  response first, then the connection is torn down — so the client actually
 *  receives the 413 instead of a bare socket reset. */
async function readBodyRaw(req, limit) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      size += chunk.length
      if (size > limit) {
        req.pause()
        return null
      }
      chunks.push(chunk)
    }
  } catch {
    return null
  }
  return Buffer.concat(chunks)
}

/** 413 that survives an in-flight body: respond, then drop the connection */
function failTooLarge(req, res) {
  res.writeHead(413, { 'content-type': 'application/json', connection: 'close' })
  res.end(JSON.stringify({ error: 'file too large' }))
  res.once('finish', () => req.destroy())
}

// light per-user upload rate limit (sliding minute window). It exists to stop a
// runaway loop, not to size legitimate work — actual disk use is bounded by
// QUOTA — so the cap is generous enough for a bulk import (an agent migrating a
// site sends dozens of assets at once) and every refusal says when to retry.
const UPLOAD_WINDOW_MS = 60_000
export const UPLOAD_LIMIT_PER_WINDOW = 120
const uploadTimes = new Map()
/** { ok: true } or { ok: false, retryAfterSeconds } — seconds until the oldest
 *  call in the window ages out and a slot frees */
function uploadAllowed(userId) {
  const now = Date.now()
  const times = (uploadTimes.get(userId) ?? []).filter((t) => now - t < UPLOAD_WINDOW_MS)
  if (times.length >= UPLOAD_LIMIT_PER_WINDOW) {
    uploadTimes.set(userId, times)
    const freesAt = times[0] + UPLOAD_WINDOW_MS
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((freesAt - now) / 1000)) }
  }
  times.push(now)
  uploadTimes.set(userId, times)
  return { ok: true }
}

/** the 429 payload, shared by the HTTP routes and the agent adapter, so a
 *  caller never has to guess the cooldown */
function rateLimited(gate) {
  return {
    error: `too many uploads — retry in ${gate.retryAfterSeconds}s ` +
      `(limit ${UPLOAD_LIMIT_PER_WINDOW} uploads per minute)`,
    status: 429,
    retryAfterSeconds: gate.retryAfterSeconds,
  }
}

// ---------- content validation (never trust the declared Content-Type) ----------

const sig = (buf, offset, text) =>
  buf.length >= offset + text.length &&
  buf.subarray(offset, offset + text.length).equals(Buffer.from(text, 'latin1'))

/** magic-byte check: does the buffer actually look like the declared mime? */
function matchesMime(buf, mime) {
  if (buf.length < 12) return false
  switch (mime) {
    case 'image/png':
      return buf[0] === 0x89 && sig(buf, 1, 'PNG')
    case 'image/jpeg':
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
    case 'image/gif':
      return sig(buf, 0, 'GIF8')
    case 'image/webp':
      return sig(buf, 0, 'RIFF') && sig(buf, 8, 'WEBP')
    case 'image/avif':
      return sig(buf, 4, 'ftyp')
    case 'image/svg+xml':
      return isSvg(buf)
    case 'video/mp4':
      return sig(buf, 4, 'ftyp')
    case 'video/webm':
      return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3
    case 'audio/mpeg':
      return sig(buf, 0, 'ID3') || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
    case 'audio/wav':
      return sig(buf, 0, 'RIFF') && sig(buf, 8, 'WAVE')
    case 'audio/ogg':
      return sig(buf, 0, 'OggS')
    case 'application/pdf':
      return sig(buf, 0, '%PDF')
    case 'font/woff2':
      return sig(buf, 0, 'wOF2')
    case 'font/woff':
      return sig(buf, 0, 'wOFF')
    case 'font/ttf':
      return (buf[0] === 0 && buf[1] === 1 && buf[2] === 0 && buf[3] === 0) || sig(buf, 0, 'true')
    case 'font/otf':
      return sig(buf, 0, 'OTTO')
    default:
      return false
  }
}

function isSvg(buf) {
  const head = buf.subarray(0, 4096).toString('utf8').replace(/^﻿/, '')
  // xml decl / comments / doctype allowed before the <svg root, nothing else
  return /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(head)
}

/** strips script vectors from an SVG before it ever hits disk. Regex-based —
 *  imperfect against exotic XML tricks, which is why serving also sends a
 *  no-script CSP + nosniff; this is the first of two layers, not the only one. */
export function sanitizeSvg(text) {
  return (
    text
      .replace(/<script[\s\S]*?(?:<\/script\s*>|$)/gi, '')
      .replace(/<foreignObject[\s\S]*?(?:<\/foreignObject\s*>|$)/gi, '')
      // on* event handler attributes (quoted or bare values)
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      // script-scheme and non-image data: href/src targets; fragments,
      // http(s) links and data:image refs stay (harmless in <img>, and
      // direct navigation is covered by the serving CSP)
      .replace(
        /\s(href|xlink:href|src)\s*=\s*(["'])\s*(?:javascript:|vbscript:|data:(?!image\/))[^"']*\2/gi,
        '',
      )
  )
}

/** the download filename is echoed in a Content-Disposition header —
 *  strip control chars and quotes so it can't inject headers */
const cleanName = (v) =>
  String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f"\\;]/g, '')
    .slice(0, 128)
    .trim()

// ---------- index ----------

let index = null // { assets: [], folders: [] } — in-memory, single source

async function loadIndex() {
  if (index) return index
  try {
    const parsed = JSON.parse(await readFile(INDEX_FILE, 'utf8'))
    index = {
      assets: Array.isArray(parsed.assets) ? parsed.assets : [],
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
    }
  } catch {
    index = { assets: [], folders: [] }
  }
  return index
}

async function writeIndex() {
  await writeAtomic(INDEX_FILE, JSON.stringify(index, null, 2))
}

/** drop the in-memory index so the next request re-reads it from disk. Called
 * after a project import swaps the media dir under us — without this the server
 * would keep serving the pre-import asset list until a restart. */
export function resetMediaIndexCache() {
  index = null
}

// mutations run one at a time — files + index always change together
let chain = Promise.resolve()
function enqueue(fn) {
  const run = () => fn()
  const p = chain.then(run, run)
  chain = p.catch(() => {})
  return p
}

const newId = () => randomBytes(8).toString('hex')
const assetById = (id) => index.assets.find((a) => a.id === id)
const usedBytes = () => index.assets.reduce((sum, a) => sum + (a.size || 0), 0)

/** ids of every folder nested (transitively) under `rootId` — used to reject a
 *  re-parent that would form a cycle (moving a folder into its own subtree) */
function folderDescendants(idx, rootId) {
  const out = new Set()
  const stack = [rootId]
  while (stack.length) {
    const cur = stack.pop()
    for (const f of idx.folders) {
      if (f.parentId === cur && !out.has(f.id)) {
        out.add(f.id)
        stack.push(f.id)
      }
    }
  }
  return out
}

// ---------- thumbnails ----------

async function makeThumb(id, buf) {
  try {
    await mkdir(THUMBS_DIR, { recursive: true })
    const image = sharp(buf, { limitInputPixels: MAX_PIXELS })
    const meta = await image.metadata()
    await image
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 70 })
      .toFile(join(THUMBS_DIR, `${id}.webp`))
    return { hasThumb: true, width: meta.width, height: meta.height }
  } catch (err) {
    log.error(`media: thumbnail failed for ${id}:`, err.message)
    return { hasThumb: false }
  }
}

/** validate + normalize an upload; returns {error,status} or the stored parts */
async function intakeUpload(req, res) {
  const mime = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  const type = ALLOWED[mime]
  if (!type) {
    fail(res, 415, 'unsupported file type')
    return null
  }
  let buf = await readBodyRaw(req, SIZE_CAPS[type.kind])
  if (buf === null) {
    failTooLarge(req, res)
    return null
  }
  if (!buf.length || !matchesMime(buf, mime)) {
    fail(res, 415, 'file content does not match its type')
    return null
  }
  if (mime === 'image/svg+xml') buf = Buffer.from(sanitizeSvg(buf.toString('utf8')), 'utf8')
  if (usedBytes() + buf.length > QUOTA) {
    fail(res, 507, 'media library is full')
    return null
  }
  return { buf, mime, kind: type.kind }
}

async function storeFile(id, buf, mime, kind) {
  await mkdir(FILES_DIR, { recursive: true })
  await writeFile(join(FILES_DIR, id), buf)
  // svg never goes through sharp (it would rasterize; also not a raster decoder path)
  if (kind === 'image' && mime !== 'image/svg+xml') return makeThumb(id, buf)
  await rm(join(THUMBS_DIR, `${id}.webp`), { force: true })
  return { hasThumb: false }
}

/** store a validated buffer as a new asset — the shared tail of the HTTP
 *  upload and replace branches */
function addAsset({ name, folderId, buf, mime, kind, userId }) {
  return enqueue(async () => {
    const id = newId()
    const extra = await storeFile(id, buf, mime, kind)
    const asset = {
      id,
      name,
      filename: name,
      mime,
      kind,
      size: buf.length,
      ...extra,
      alt: undefined,
      folderId: folderId && index.folders.some((f) => f.id === folderId) ? folderId : undefined,
      createdAt: new Date().toISOString(),
      uploadedBy: userId,
    }
    index.assets.push(asset)
    await writeIndex()
    return asset
  })
}

// ---------- usage scan ----------

/** counts "/media/<id>" occurrences in every branch's project blob — covers
 *  node src, locale overrides, entry values, favicon and ogImage without
 *  understanding the document shape */
async function scanUsage(id) {
  const needle = `/media/${id}`
  const branches = []
  let total = 0
  let files = []
  try {
    files = (await readdir(STORE_DIR)).filter(
      (f) => f.startsWith('guano-project__') && f.endsWith('.json'),
    )
  } catch {
    /* no store yet */
  }
  for (const file of files) {
    try {
      const text = await readFile(join(STORE_DIR, file), 'utf8')
      const count = text.split(needle).length - 1
      if (count > 0) {
        branches.push({ branchId: file.slice('guano-project__'.length, -'.json'.length), count })
        total += count
      }
    } catch {
      /* unreadable blob — skip */
    }
  }
  return { total, branches }
}

// ---------- 🔒 /api/media ----------

/** `user` is resolved by the caller (session cookie OR `guano_` bearer token —
 *  index.mjs passes requestUser) so the MCP server can reach the library too */
export async function handleMedia(req, res, path, query, user) {
  if (!user) return fail(res, 401, 'unauthorized')
  const mutating = req.method !== 'GET'
  if (mutating && !originAllowed(req)) return fail(res, 403, 'cross-origin request rejected')
  await loadIndex()

  // contributors may browse (GET), upload their own media (POST /api/media) and
  // edit metadata (PATCH /api/media/:id) — but NOT replace bytes, delete assets,
  // or restructure folders: those change shared library state site-wide, so a
  // semi-trusted user could vandalise every page at once (S5).
  const isContributor = user.role === 'contributor'

  if (path === '/api/media' && req.method === 'GET') {
    return send(res, 200, JSON.stringify(index))
  }
  // a reviewer browses the library and nothing more: every mutation below
  // changes what other people's pages show
  if (user.role === 'reviewer' && mutating) return fail(res, 403, 'forbidden')

  if (path === '/api/media' && req.method === 'POST') {
    const gate = uploadAllowed(user.id)
    if (!gate.ok) return send(res, 429, JSON.stringify(rateLimited(gate)))
    const intake = await intakeUpload(req, res)
    if (!intake) return
    const asset = await addAsset({
      name: cleanName(query.get('name')) || 'untitled',
      folderId: query.get('folder') || undefined,
      buf: intake.buf,
      mime: intake.mime,
      kind: intake.kind,
      userId: user.id,
    })
    return send(res, 200, JSON.stringify(asset))
  }

  // ----- folders -----
  if (path === '/api/media/folders' && req.method === 'POST') {
    if (isContributor) return fail(res, 403, 'forbidden')
    const body = await readBodyRaw(req, 4096)
    let name, parentId
    try {
      ;({ name, parentId } = JSON.parse(body?.toString('utf8') ?? ''))
    } catch {
      return fail(res, 400, 'invalid request')
    }
    name = cleanName(name).slice(0, 64)
    if (!name) return fail(res, 400, 'folder name required')
    return enqueue(async () => {
      // a parent must exist, else the folder is created at the root
      const parent = parentId && index.folders.some((f) => f.id === parentId) ? parentId : undefined
      const folder = { id: newId(), name, ...(parent ? { parentId: parent } : {}) }
      index.folders.push(folder)
      await writeIndex()
      return send(res, 200, JSON.stringify(folder))
    })
  }
  if (path.startsWith('/api/media/folders/')) {
    if (isContributor) return fail(res, 403, 'forbidden')
    const id = path.slice('/api/media/folders/'.length)
    if (!ID_RE.test(id)) return fail(res, 404, 'not found')
    if (req.method === 'PATCH') {
      const body = await readBodyRaw(req, 4096)
      let patch
      try {
        patch = JSON.parse(body?.toString('utf8') ?? '')
      } catch {
        return fail(res, 400, 'invalid request')
      }
      return enqueue(async () => {
        const folder = index.folders.find((f) => f.id === id)
        if (!folder) return fail(res, 404, 'not found')
        if (typeof patch.name === 'string') {
          const name = cleanName(patch.name).slice(0, 64)
          if (!name) return fail(res, 400, 'folder name required')
          folder.name = name
        }
        if ('parentId' in patch) {
          const next = patch.parentId
          if (next == null) {
            delete folder.parentId // move to root
          } else if (
            typeof next === 'string' &&
            next !== id &&
            index.folders.some((f) => f.id === next) &&
            !folderDescendants(index, id).has(next)
          ) {
            folder.parentId = next
          } else {
            return fail(res, 400, 'invalid parent folder')
          }
        }
        await writeIndex()
        return send(res, 200, JSON.stringify(folder))
      })
    }
    if (req.method === 'DELETE') {
      return enqueue(async () => {
        const folder = index.folders.find((f) => f.id === id)
        if (!folder) return fail(res, 404, 'not found')
        // non-destructive: promote this folder's child folders and its assets up
        // one level (to its own parent, or the root) rather than deleting them
        const up = folder.parentId
        for (const f of index.folders) {
          if (f.parentId === id) {
            if (up) f.parentId = up
            else delete f.parentId
          }
        }
        for (const a of index.assets) if (a.folderId === id) a.folderId = up
        index.folders = index.folders.filter((f) => f.id !== id)
        await writeIndex()
        return send(res, 200, JSON.stringify({ ok: true, parentId: up ?? null }))
      })
    }
    return fail(res, 404, 'not found')
  }

  // ----- per-asset: /api/media/<id>[/replace|/usage] -----
  const tail = path.slice('/api/media/'.length)
  const [id, action] = tail.split('/')
  if (!ID_RE.test(id)) return fail(res, 404, 'not found')

  if (action === 'usage' && req.method === 'GET') {
    if (!assetById(id)) return fail(res, 404, 'not found')
    return send(res, 200, JSON.stringify(await scanUsage(id)))
  }

  if (action === 'replace' && req.method === 'POST') {
    if (isContributor) return fail(res, 403, 'forbidden')
    if (!assetById(id)) return fail(res, 404, 'not found')
    const gate = uploadAllowed(user.id)
    if (!gate.ok) return send(res, 429, JSON.stringify(rateLimited(gate)))
    const intake = await intakeUpload(req, res)
    if (!intake) return
    return enqueue(async () => {
      const asset = assetById(id)
      if (!asset) return fail(res, 404, 'not found')
      const extra = await storeFile(id, intake.buf, intake.mime, intake.kind)
      Object.assign(asset, {
        mime: intake.mime,
        kind: intake.kind,
        size: intake.buf.length,
        width: undefined,
        height: undefined,
        ...extra,
      })
      await writeIndex()
      return send(res, 200, JSON.stringify(asset))
    })
  }

  if (!action && req.method === 'PATCH') {
    const body = await readBodyRaw(req, 8192)
    let patch
    try {
      patch = JSON.parse(body?.toString('utf8') ?? '')
    } catch {
      return fail(res, 400, 'invalid request')
    }
    return enqueue(async () => {
      const asset = assetById(id)
      if (!asset) return fail(res, 404, 'not found')
      if (typeof patch.name === 'string') asset.name = cleanName(patch.name) || asset.name
      if (typeof patch.alt === 'string') asset.alt = patch.alt.slice(0, 512) || undefined
      if ('folderId' in patch) {
        asset.folderId =
          patch.folderId && index.folders.some((f) => f.id === patch.folderId)
            ? patch.folderId
            : undefined
      }
      await writeIndex()
      return send(res, 200, JSON.stringify(asset))
    })
  }

  if (!action && req.method === 'DELETE') {
    if (isContributor) return fail(res, 403, 'forbidden')
    return enqueue(async () => {
      if (!assetById(id)) return fail(res, 404, 'not found')
      index.assets = index.assets.filter((a) => a.id !== id)
      await writeIndex()
      await rm(join(FILES_DIR, id), { force: true })
      await rm(join(THUMBS_DIR, `${id}.webp`), { force: true })
      return send(res, 200, JSON.stringify({ ok: true }))
    })
  }

  return fail(res, 404, 'not found')
}

// ---------- 🌐 /media/<id> and /media/thumb/<id> ----------

/** serves library bytes; returns false (untouched response) when the path
 *  isn't a library asset so the caller can fall through to the exported site */
export async function handleMediaFile(req, res, path, query) {
  const thumb = path.startsWith('/media/thumb/')
  const id = path.slice(thumb ? '/media/thumb/'.length : '/media/'.length)
  if (!ID_RE.test(id)) return false
  await loadIndex()
  const asset = assetById(id)
  if (!asset) return false
  if (thumb && !asset.hasThumb) return false

  const file = thumb ? join(THUMBS_DIR, `${id}.webp`) : join(FILES_DIR, id)
  let info
  try {
    info = await stat(file)
  } catch {
    return false
  }
  // the URL is stable across replace-in-place, so revalidate every time
  const etag = `"${info.size}-${Math.floor(info.mtimeMs)}"`
  const headers = {
    etag,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    // even a hostile file that survived intake can't run script on our origin
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
  }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers)
    res.end()
    return true
  }
  if (!thumb && query?.get('download') === '1') {
    headers['content-disposition'] = `attachment; filename="${cleanName(asset.filename)}"`
  }
  const data = await readFile(file)
  send(res, 200, data, thumb ? 'image/webp' : asset.mime, headers)
  return true
}
