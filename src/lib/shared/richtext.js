import { SAFE_HREF } from './urls.js'

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

export function isRich(value) {
  return (
    typeof value === 'string' &&
    /<\/?(b|strong|i|em|u|mark|code|sup|sub|a|ul|ol|li|br|hr|p|h2|h3|h4|blockquote)[\s>/]/i.test(value)
  )
}

export function mediaRefsInRich(html) {
  if (typeof html !== 'string' || !html) return []
  const out = []
  for (const m of html.matchAll(/(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const value = (m[1] ?? m[2] ?? '').trim()
    if (value) out.push(value)
  }
  return out
}

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

export function sanitizeRich(html) {
  if (typeof html !== 'string' || !html) return ''
  const out = []
  const open = []
  for (const token of html.match(/<[^>]*>|[^<]+|</g) ?? []) {
    if (token[0] !== '<' || token.length === 1) {
      out.push(escapeText(token))
      continue
    }
    const match = token.match(/^<(\/?)([a-zA-Z0-9]+)([^>]*)>$/)
    if (!match) {
      out.push(escapeText(token))
      continue
    }
    const closing = match[1] === '/'
    const tag = match[2].toLowerCase()
    const spec = ALLOWED[tag]
    if (!spec) continue
    if (spec.void) {
      if (!closing) out.push(`<${tag}>`)
      continue
    }
    if (closing) {
      const at = open.lastIndexOf(tag)
      if (at === -1) continue
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
