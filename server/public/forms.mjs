// POST /_guano/forms/:formId — the only unauthenticated WRITE in the product.
//
// Everything about this file is shaped by that sentence. It is reachable by
// anyone on the internet, it stores what they send, and it can make the
// instance send mail and make an outbound request. So:
//
//   * It lives OUTSIDE /api. Every mutating /api route is cookie-authed and
//     same-origin-checked; sharing a prefix would mean one loosened guard
//     exposes both. /_guano/ is already the private-site unlock's namespace.
//   * It validates against the MANIFEST, never against the request and never
//     against the live project. The visitor submitted the page that was
//     PUBLISHED; Main may have moved on, and a draft may not be published at
//     all. Field names are allowlisted, `_route` and `_entry` are checked
//     against what actually shipped.
//   * It refuses in the cheapest order, so a flood is rejected before it can
//     cost a parse, a disk read or a DNS lookup.
//   * It reads nothing from the project store. The module takes its manifest
//     path and its delivery hooks as arguments, so the whole public surface
//     could be lifted into a standalone service without a rewrite.
//   * It never echoes a submitted value, and never logs a body.
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { validateSubmission, MIN_FILL_MS } from '../../src/lib/shared/forms.js'

/** a form id is a node id: our own alphabet, never a path */
const FORM_ID_RE = /^[A-Za-z0-9-]{1,64}$/

/** 32 KB. A urlencoded body of real form fields is a few KB at most; the
 *  10 MB /api cap would let one request tie up memory for nothing. */
const BODY_CAP = 32 * 1024

/** the same answer for an unknown form and a disabled one, so probing cannot
 *  enumerate which ids exist */
const NOT_FOUND = 'no such form'

/**
 * Read the body with a hard cap, tearing the socket down past it.
 *
 * Returns `{ text }`, or `{ tooLarge: true }`. The caller sends its 413 first
 * and the connection dies after, so the client actually receives the status
 * instead of a bare reset (same approach as media.mjs' uploader).
 */
async function readCapped(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_CAP) {
      req.pause()
      return { tooLarge: true }
    }
    chunks.push(chunk)
  }
  return { text: Buffer.concat(chunks).toString('utf8') }
}

/** cached manifest, re-read when the file's content changes */
export function manifestReader(file) {
  let cached = { at: 0, data: null }
  return async () => {
    if (Date.now() - cached.at < 5_000) return cached.data
    let data = null
    try {
      data = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      /* nothing published yet, or no form on the site */
    }
    cached = { at: Date.now(), data }
    return data
  }
}

/**
 * The handler.
 *
 * @param {object} deps
 * @param {() => Promise<object|null>} deps.manifest   the published manifest
 * @param {(id, record) => Promise<{ok:true}|{error:string,status?:number}>} deps.store
 * @param {(id, entry, record) => void} deps.deliver   notify + forward, fire and forget
 * @param {(req) => string} deps.clientIp
 * @param {object} deps.limits  { perIpMinute, perIpHour, perForm, site } limiters
 * @param {(req) => Promise<{ok:boolean, headers:object}>|{ok:boolean, headers:object}} deps.cors
 * @param {boolean} [deps.dryRun]  preview: validate, answer, store nothing
 */
export function createFormsHandler(deps) {
  return async function handleFormPost(req, res, path) {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        ...headers,
      })
      res.end(JSON.stringify(body))
    }

    // 1. CORS first: a preflight costs nothing, and a disallowed origin must
    //    not reach the rate limiter (where it could spend someone else's
    //    budget) let alone the manifest.
    // awaited: the live rule reads the published snapshot from disk. Called
    // synchronously it returned a Promise, whose `.ok` is undefined — which
    // refused every single submission as a cross-origin request.
    const cors = await deps.cors(req)
    if (req.method === 'OPTIONS') {
      if (!cors.ok) return send(403, { error: 'origin not allowed' })
      res.writeHead(204, {
        ...cors.headers,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type, accept',
        'access-control-max-age': '600',
      })
      res.end()
      return
    }
    if (req.method !== 'POST') return send(405, { error: 'POST only' }, cors.headers)
    if (!cors.ok) return send(403, { error: 'origin not allowed' })

    const wantsJson = String(req.headers.accept ?? '').includes('application/json')
    const H = cors.headers

    // 2. the id, before anything touches disk
    const id = decodeURIComponent(path.slice('/_guano/forms/'.length))
    if (!FORM_ID_RE.test(id)) return send(404, { error: NOT_FOUND }, H)

    // 3. rate limits. Per IP first (the cheapest refusal that stops a flood),
    //    then per form and site-wide so a distributed one cannot fill the disk
    //    or the inbox either.
    const ip = deps.clientIp(req)
    for (const [limiter, key] of [
      [deps.limits.perIpMinute, ip],
      [deps.limits.perIpHour, ip],
      [deps.limits.perForm, id],
      [deps.limits.site, 'site'],
    ]) {
      const gate = limiter(key)
      if (!gate.ok) {
        return send(
          429,
          { error: 'too many submissions — try again shortly', retryAfterSeconds: gate.retryAfterSeconds },
          { ...H, 'retry-after': String(gate.retryAfterSeconds) },
        )
      }
    }

    // 4. the manifest
    const manifest = await deps.manifest()
    const entry = manifest?.forms?.[id]
    if (!entry) return send(404, { error: NOT_FOUND }, H)

    // 5. content type. Multipart is refused outright in v1 — file uploads are
    //    a different storage and scanning problem.
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    if (type !== 'application/x-www-form-urlencoded') {
      return send(415, { error: 'send application/x-www-form-urlencoded' }, H)
    }

    // 6. the body, capped
    const body = await readCapped(req)
    if (body.tooLarge) {
      // `connection: close` and a destroy only AFTER the response has flushed,
      // matching media.mjs' failTooLarge. Destroying the socket outright sent
      // the 413 and then reset the connection, so a client reusing it (every
      // keep-alive client does) saw ECONNRESET on its NEXT, unrelated request.
      res.writeHead(413, { 'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close', ...H })
      res.end(JSON.stringify({ error: 'submission too large' }))
      res.once('finish', () => req.destroy())
      return
    }
    const params = new URLSearchParams(body.text ?? '')

    // 7. the spam checks, answered as SUCCESS. A bot that learns it was caught
    //    adapts; one that is told "thank you" does not. Counted, so the number
    //    is visible in the admin view rather than invisible.
    const honeypot = (params.get('_hp') ?? '').trim()
    const elapsed = Number(params.get('_t'))
    const tooFast = Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_FILL_MS
    if (honeypot || tooFast) {
      deps.countSpam?.(id)
      return send(200, { ok: true }, H)
    }

    // 8. the route it claims to be on must be one this form actually shipped
    //    on. Without this, one form id accepts submissions attributed to any
    //    page on the site — which is how a lead list becomes unreadable.
    const route = params.get('_route') ?? '/'
    if (!entry.routes?.includes(route)) {
      return send(400, { error: 'that form is not on this page' }, H)
    }
    const claimedEntry = params.get('_entry')
    if (claimedEntry && !(entry.entries ?? []).includes(claimedEntry)) {
      return send(400, { error: 'unknown entry' }, H)
    }

    // 9. the fields, allowlisted against the manifest
    const checked = validateSubmission(entry.fields ?? [], params)
    if (checked.error) {
      return send(400, { error: checked.error, field: checked.field }, H)
    }

    const record = {
      id: randomUUID(),
      at: Date.now(),
      route,
      ...(claimedEntry ? { entry: claimedEntry } : {}),
      values: checked.values,
      // deliberately NO ip and NO user agent: personal data we have no use
      // for. Abuse triage uses the in-memory limiter instead.
    }

    // 10. the preview server validates exactly the same way and stops here —
    //     looking at your own work must never put a row in the real list or
    //     mail in the real inbox
    if (deps.dryRun) return send(200, { ok: true, preview: true }, H)

    const stored = await deps.store(id, record)
    if (stored.error) {
      return send(stored.status ?? 500, { error: stored.error }, H)
    }

    // delivery never blocks the answer, and a failed send never fails the
    // submission: the lead is already safely on disk
    deps.deliver(id, entry, record)

    if (wantsJson) return send(200, { ok: true }, H)
    // the no-JS path: back to the SITE, not to a bare JSON body
    const to = entry.redirect || `${route}${route.includes('?') ? '&' : '?'}form=sent`
    res.writeHead(303, { location: to, 'cache-control': 'no-store', ...H })
    res.end()
  }
}
