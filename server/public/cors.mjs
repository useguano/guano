// The PUBLIC namespace: `/_guano/*`, the only unauthenticated endpoints in the
// product, and the one place a browser on another origin is answered.
//
// WHY A SEPARATE PREFIX FROM /api: every mutating `/api` route is cookie-authed
// and same-origin-checked (index.mjs). If a public endpoint lived under the
// same prefix, one loosened guard would expose both. `/_guano/` is already the
// private-site unlock's prefix, so visitors have exactly one namespace and the
// preview server — which refuses `/api/*` wholesale — can serve its twins.
//
// Three rules the CORS answer keeps:
//
//   1. THE ALLOWED ORIGIN COMES FROM THE PUBLISHED SNAPSHOT, never the live
//      project and never the request. The live blob is writable by editors,
//      drafts, merges and agent tokens; reading the allowed origin from it
//      would let a draft open the endpoint to any domain. The visitor is on
//      the site that SHIPPED, so the shipped settings are the right source.
//   2. THE ORIGIN IS MATCHED, NEVER REFLECTED. A reflected
//      `access-control-allow-origin` is the same as no check at all.
//   3. NEVER `access-control-allow-credentials`. A submission needs no cookie,
//      and allowing credentials cross-origin is how a public endpoint becomes
//      a CSRF hole against the editor's own session.
import { readFile } from 'node:fs/promises'

/** the origins a published page may post from, derived from the snapshot */
export function allowedOrigins(publishedSettings, selfOrigin) {
  const out = new Set()
  if (selfOrigin) out.add(selfOrigin)
  const domain = String(publishedSettings?.domain ?? '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
  if (domain) {
    out.add(`https://${domain}`)
    // www is the same site to a visitor; a redirect between the two is normal
    out.add(domain.startsWith('www.') ? `https://${domain.slice(4)}` : `https://www.${domain}`)
  }
  const api = String(publishedSettings?.publishing?.apiOrigin ?? '').trim()
  if (api) {
    try {
      out.add(new URL(api).origin)
    } catch {
      /* an unparseable apiOrigin simply allows nothing extra */
    }
  }
  return out
}

/**
 * Decide the CORS answer for one public request.
 *
 * Returns `{ok, headers}`. A request with no `Origin` header (a native form
 * post from the same host, curl, a server-to-server call) is allowed with no
 * CORS headers — the endpoint is public, and the `_route` + manifest checks are
 * what actually constrain it. A request WITH an origin must match.
 */
export function corsFor(req, origins) {
  const origin = req.headers.origin
  if (!origin) return { ok: true, headers: {} }
  if (!origins.has(origin)) return { ok: false, headers: {} }
  return {
    ok: true,
    headers: {
      'access-control-allow-origin': origin,
      // the answer varies by request origin, so a shared cache must not reuse it
      vary: 'origin',
    },
  }
}

/** the preflight answer for an allowed origin */
export const preflightHeaders = (corsHeaders) => ({
  ...corsHeaders,
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, accept',
  'access-control-max-age': '600',
})

/**
 * The published snapshot's settings, cached by mtime.
 *
 * Read from disk rather than handed in, because a publish replaces the file
 * while the process runs: the cache has to notice. A missing snapshot means
 * nothing is published, so no origin is allowed beyond this instance's own.
 */
export function publishedSettingsReader(snapshotPath) {
  let cached = { at: 0, settings: null }
  return async () => {
    if (Date.now() - cached.at < 5_000) return cached.settings
    let settings = null
    try {
      const parsed = JSON.parse(await readFile(snapshotPath, 'utf8'))
      settings = parsed?.settings ?? null
    } catch {
      /* nothing published yet */
    }
    cached = { at: Date.now(), settings }
    return settings
  }
}
