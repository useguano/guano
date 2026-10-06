// Rich-text sanitizer shared VERBATIM by the editor, the SPA preview and
// the static exporter — plain JS, no DOM, so it runs identically in the
// browser and in Node (server/export.mjs).
//
// Content is user-authored HTML restricted to a tiny inline subset. The
// sanitizer is allowlist-based: allowed tags are re-emitted in canonical
// form (all attributes dropped except a validated href), disallowed tags
// are stripped (their text kept), text is entity-escaped, and open tags
// are balanced so a fragment can never break out of its element.

import { SAFE_HREF } from './urls.js'

// Inline marks plus the BLOCK tags long-form copy is actually made of.
// Without p/h2-h4/blockquote, an imported article lost every paragraph break —
// the text survived but the structure did not, so the usual workaround was
// <br><br> soup. The `prose` utility (shared/prose.js) styles these.
const ALLOWED = {
  b: {},
  strong: {},
  i: {},
  em: {},
  u: {},
  mark: {},
  code: {},
  sup: {},
  sub: {},
  br: { void: true },
  hr: { void: true },
  p: {},
  h2: {},
  h3: {},
  h4: {},
  blockquote: {},
  ul: {},
  ol: {},
  li: {},
  a: { href: true },
}

const escapeText = (s) => s.replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const escapeAttr = (s) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')

/** true when a string uses any of the allowed rich tags */
export function isRich(value) {
  return (
    typeof value === 'string' &&
    /<\/?(b|strong|i|em|u|mark|code|sup|sub|a|ul|ol|li|br|hr|p|h2|h3|h4|blockquote)[\s>/]/i.test(value)
  )
}

/** every `href`/`src` URL appearing in a rich-text fragment. The exporter has to
 * know about these: a `/media/<id>` link inside body copy only this server can
 * answer, so it must be extracted and rewritten like any other asset. */
export function mediaRefsInRich(html) {
  if (typeof html !== 'string' || !html) return []
  const out = []
  for (const m of html.matchAll(/(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const value = (m[1] ?? m[2] ?? '').trim()
    if (value) out.push(value)
  }
  return out
}

/**
 * Rewrite the `href`/`src` URLs in a rich-text fragment through `rewrite`
 * (media extraction's dataUrl|/media/<id> → hashed path map). Applied AFTER
 * sanitizeRich, so only already-validated URLs are touched. A rewrite that
 * returns undefined (a dropped asset) leaves the original in place rather than
 * emitting `href="undefined"`.
 */
export function rewriteRichMedia(html, rewrite) {
  if (typeof html !== 'string' || !html || typeof rewrite !== 'function') return html
  return html.replace(
    /(href|src)(\s*=\s*)"([^"]*)"/gi,
    (whole, name, eq, value) => {
      const next = rewrite(value)
      return typeof next === 'string' && next ? `${name}${eq}"${escapeAttr(next)}"` : whole
    },
  )
}

/** sanitize a rich-text fragment to the allowed subset (idempotent) */
export function sanitizeRich(html) {
  if (typeof html !== 'string' || !html) return ''
  const out = []
  const open = []
  for (const token of html.match(/<[^>]*>|[^<]+|</g) ?? []) {
    if (token[0] !== '<' || token.length === 1) {
      out.push(escapeText(token))
      continue
    }
    // real tags have no space before the name — '< b and c >' is prose
    const match = token.match(/^<(\/?)([a-zA-Z0-9]+)([^>]*)>$/)
    if (!match) {
      out.push(escapeText(token))
      continue
    }
    const closing = match[1] === '/'
    const tag = match[2].toLowerCase()
    const spec = ALLOWED[tag]
    if (!spec) continue // disallowed tag stripped, inner text survives
    if (spec.void) {
      if (!closing) out.push(`<${tag}>`)
      continue
    }
    if (closing) {
      // close intervening unclosed tags so nesting stays valid
      const at = open.lastIndexOf(tag)
      if (at === -1) continue // stray close — drop
      for (let i = open.length - 1; i >= at; i--) out.push(`</${open[i]}>`)
      open.length = at
      continue
    }
    if (tag === 'a') {
      const href = match[3].match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
      const raw = (href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim()
      const safe = SAFE_HREF.test(raw) ? raw : ''
      out.push(safe ? `<a href="${escapeAttr(safe)}" rel="noopener">` : '<a>')
    } else {
      out.push(`<${tag}>`)
    }
    open.push(tag)
  }
  for (let i = open.length - 1; i >= 0; i--) out.push(`</${open[i]}>`)
  return out.join('')
}
