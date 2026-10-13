// 301 redirects: a path the site used to answer on, and where it goes now.
//
// The point of the feature is that a slug change does not have to cost the
// links other people made. So the one thing it must never do is cost a PAGE:
// a redirect whose source is a route that actually shipped is dropped at
// publish and reported, never served. That ordering is what lets the server
// answer a redirect BEFORE looking for a file (which is what makes it a real
// 301 rather than a meta-refresh page), with no way for a stale redirect to
// shadow a live page.
//
// Shared verbatim by the exporter (which writes the manifest and the static
// stubs), the server (which answers the 301), the Settings panel and the MCP
// tools, so what the editor accepts is what the site serves.

export const REDIRECT_CODE = 301

const MAX_PATH = 512

/** a root-relative path, no query, no hash, no traversal */
const PATH_RE = /^\/(?:[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*)$/
/** an absolute destination: https anywhere, http only for a local host */
const ABSOLUTE_RE = /^https:\/\/[^\s/?#]+[^\s]*$/
const LOCAL_HTTP_RE = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s]*)?$/

/**
 * One spelling for a source path: a leading slash, no trailing slash, no
 * query or hash. `/About/` and `About` both mean `/About`, so a typed value
 * and a path built from a page's slug compare equal.
 */
export function normalizeRedirectPath(value) {
  let v = String(value ?? '').trim()
  if (!v) return ''
  v = v.split('#')[0].split('?')[0]
  if (!v.startsWith('/')) v = `/${v}`
  v = v.replace(/\/{2,}/g, '/')
  if (v.length > 1) v = v.replace(/\/+$/, '')
  return v
}

/** the destination as stored: a path is normalized, an absolute URL is left alone */
export function normalizeRedirectTarget(value) {
  const v = String(value ?? '').trim()
  if (!v) return ''
  return isAbsoluteTarget(v) ? v : normalizeRedirectPath(v)
}

/** a scheme we will not send a visitor to, typed as if it were a destination */
const FOREIGN_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

export function isAbsoluteTarget(value) {
  const v = String(value ?? '').trim()
  return ABSOLUTE_RE.test(v) || LOCAL_HTTP_RE.test(v)
}

/**
 * Why a redirect is malformed, or null. `others` are the redirects it has to
 * coexist with — two rules for one source is not a redirect, it is a coin toss.
 * @returns {string|null}
 */
export function redirectError(redirect, others = []) {
  const from = normalizeRedirectPath(redirect?.from)
  const to = normalizeRedirectTarget(redirect?.to)
  if (!from) return 'a redirect needs the old path'
  if (!to) return 'a redirect needs somewhere to go'
  if (from.length > MAX_PATH || to.length > MAX_PATH) return 'a redirect path is too long'
  if (from === '/') {
    return 'the home page cannot redirect away — change what it shows instead'
  }
  if (!PATH_RE.test(from) || from.includes('..')) {
    return 'the old path is a root-relative path, like /old-pricing'
  }
  if (!isAbsoluteTarget(to)) {
    // a scheme that is not https (or local http) would be forced into a path
    // (`javascript:…` → `/javascript:…`), which is safe but reads as accepted
    const typed = String(redirect?.to ?? '').trim()
    if (FOREIGN_SCHEME_RE.test(typed) && !typed.startsWith('/')) {
      return 'the destination is a root-relative path (/pricing) or an https:// URL'
    }
    if (!PATH_RE.test(to) || to.includes('..')) {
      return 'the destination is a root-relative path (/pricing) or an https:// URL'
    }
  }
  if (from === to) return 'a redirect to itself does nothing'
  const clash = others.find(
    (o) => o !== redirect && normalizeRedirectPath(o?.from) === from,
  )
  if (clash) return `${from} already redirects to ${normalizeRedirectTarget(clash.to)}`
  return null
}

export function isValidRedirect(redirect, others = []) {
  return redirectError(redirect, others) === null
}

/** the locale prefix a path carries, or '' */
function localeOf(path, locales, defaultLocale) {
  const first = path.split('/')[1] ?? ''
  return first && first !== defaultLocale && locales.includes(first) ? first : ''
}

/**
 * What the site actually serves, from what the project stores.
 *
 * - every valid rule, PLUS its per-locale twin: a slug is shared across
 *   locales (the path is the same, prefixed), so `/about → /contact` has to
 *   answer on `/fr/about` too, or a rename breaks every translated route. A
 *   source that already names a locale is taken literally instead.
 * - a source that a published route answers on is SHADOWED and dropped: the
 *   page wins, always.
 * - a destination that is neither a published route nor an absolute URL is
 *   reported as `dangling` — a 301 into a 404 is worse than no redirect, but
 *   it is the author's call (a route may exist behind a reverse proxy), so it
 *   still ships.
 * - a destination that is itself a source is a CHAIN: reported, and resolved
 *   to its final target so a visitor never pays two round trips.
 *
 * @param {Array} list        settings.redirects
 * @param {object} site       { routes: Set<string>, locales: string[], defaultLocale: string }
 * @returns {{live: {from: string, to: string}[], shadowed: string[], dangling: string[], chained: string[]}}
 */
export function resolveRedirects(list, site = {}) {
  const routes = site.routes instanceof Set ? site.routes : new Set(site.routes ?? [])
  const locales = site.locales ?? []
  const defaultLocale = site.defaultLocale ?? ''
  const valid = []
  for (const r of list ?? []) {
    if (redirectError(r, list ?? []) === null) {
      valid.push({ from: normalizeRedirectPath(r.from), to: normalizeRedirectTarget(r.to) })
    }
  }

  // follow a chain to its end before anything else looks at it, so both the
  // manifest and the stubs point at the final destination
  const bySource = new Map(valid.map((r) => [r.from, r.to]))
  const chained = []
  const resolveTarget = (from, to) => {
    const seen = new Set([from])
    let target = to
    // stop at a real route: a page always wins over a rule, so a chain that
    // runs THROUGH a published path ends there. Following it anyway sent
    // `/old-pricing` past the live `/pricing` to wherever a stale
    // `/pricing → …` rule pointed, which is the one outcome a redirect must
    // never produce.
    while (!routes.has(target) && bySource.has(target) && !seen.has(target)) {
      seen.add(target)
      chained.push(from)
      target = bySource.get(target)
    }
    return target
  }

  const live = []
  const shadowed = []
  const dangling = []
  const taken = new Set()
  for (const r of valid) {
    const before = chained.length
    const to = resolveTarget(r.from, r.to)
    // a chain on a rule that never ships is not worth reporting
    if (routes.has(r.from)) chained.length = before
    // and neither is a dangling destination on one — reported only for what
    // a visitor can actually reach
    if (!routes.has(r.from) && !isAbsoluteTarget(to) && !routes.has(to)) dangling.push(r.from)
    const sources = [r.from]
    if (!localeOf(r.from, locales, defaultLocale) && !isAbsoluteTarget(to)) {
      for (const code of locales) {
        if (code === defaultLocale) continue
        sources.push(`/${code}${r.from}`)
      }
    }
    for (const from of sources) {
      if (routes.has(from)) {
        shadowed.push(from)
        continue
      }
      if (taken.has(from)) continue
      taken.add(from)
      const prefix = localeOf(from, locales, defaultLocale)
      live.push({ from, to: prefix && from !== r.from ? `/${prefix}${to}` : to })
    }
  }
  return { live, shadowed, dangling, chained: [...new Set(chained)] }
}

/** where a redirect's static stub is written: `/old-pricing` → `old-pricing/index.html` */
export function redirectStubPath(from) {
  const clean = normalizeRedirectPath(from).slice(1)
  return `${clean}/index.html`
}

/**
 * The stub a STATIC host serves, since a zip or a GitHub Pages site cannot
 * answer a 301 of its own. A meta refresh at 0s plus a canonical is what
 * crawlers read as a move, and the visible link is what a visitor gets if
 * neither runs. The `server` method never reads these — it answers the real
 * 301 before it ever looks for a file — but `site/` IS what the zip ships, so
 * the directory has to carry them.
 */
export function redirectStubHtml(to, escape = (s) => s) {
  const href = escape(to)
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    `<meta http-equiv="refresh" content="0; url=${href}">` +
    `<link rel="canonical" href="${href}">` +
    '<meta name="robots" content="noindex">' +
    '<title>Moved</title></head>' +
    `<body><p>This page has moved to <a href="${href}">${href}</a>.</p></body></html>`
  )
}
