export const MAX_SVG_BYTES = 32 * 1024

const canonical = (names) => new Map(names.map((n) => [n.toLowerCase(), n]))

const ELEMENTS = canonical([
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop',
  'title', 'desc',
])

const TEXT_ELEMENTS = new Set(['title', 'desc'])

const ATTRIBUTES = canonical([
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points',
  'width', 'height', 'viewBox', 'transform', 'pathLength', 'preserveAspectRatio',
  'fill', 'stroke', 'opacity', 'fill-opacity', 'fill-rule', 'clip-rule',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-miterlimit', 'stroke-opacity',
  'clip-path', 'mask',
  'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform',
  'fx', 'fy', 'spreadMethod', 'clipPathUnits', 'maskUnits', 'maskContentUnits',
  'id', 'role', 'aria-hidden', 'aria-label', 'data-icon',
])

const VALUE_RE = /^[A-Za-z0-9\s.,#%()+\-_/:]*$/
const LOCAL_URL_RE = /^url\(#[A-Za-z0-9_-]+\)$/
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/
const URL_ATTRIBUTES = new Set(['fill', 'stroke', 'clip-path', 'mask'])

const TOKEN_RE = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<[^>]*>|[^<]+|</g
const TAG_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)([\s\S]*?)(\/?)>$/
const ATTR_RE = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g

const escapeText = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function cleanValue(name, raw) {
  const value = String(raw ?? '').trim()
  if (!VALUE_RE.test(value)) return undefined
  if (name === 'id') return ID_RE.test(value) ? value : undefined
  if (/url\s*\(/i.test(value)) {
    return URL_ATTRIBUTES.has(name) && LOCAL_URL_RE.test(value) ? value : undefined
  }
  if (name === 'data-icon') return /^[a-z][a-z0-9-]*:[a-z0-9-]+$/.test(value) ? value : undefined
  if (value.includes(':')) return undefined
  return value
}

function cleanAttributes(source, { recolor }) {
  const out = []
  const seen = new Set()
  for (const m of source.matchAll(ATTR_RE)) {
    const name = ATTRIBUTES.get(m[1].toLowerCase())
    if (!name || seen.has(name)) continue
    let value = cleanValue(name, m[2] ?? m[3] ?? m[4] ?? '')
    if (value === undefined) continue
    if (recolor && (name === 'fill' || name === 'stroke' || name === 'stop-color')) {
      if (value !== 'none') value = 'currentColor'
    }
    seen.add(name)
    out.push([name, value])
  }
  return out
}

const writeAttributes = (attrs) => attrs.map(([k, v]) => ` ${k}="${v}"`).join('')

export function sanitizeInlineSvg(markup, { recolor = true } = {}) {
  if (typeof markup !== 'string' || !markup || markup.length > MAX_SVG_BYTES) return ''
  const out = []
  const open = []
  let skipping = null
  let skipDepth = 0
  let closed = false

  for (const token of markup.match(TOKEN_RE) ?? []) {
    if (closed) break
    if (token[0] !== '<' || token.length === 1) {
      const parent = open[open.length - 1]
      if (!skipping && parent && TEXT_ELEMENTS.has(parent)) out.push(escapeText(token))
      continue
    }
    const tag = token.match(TAG_RE)
    if (!tag) continue
    const closing = tag[1] === '/'
    const rawName = tag[2].toLowerCase()
    const selfClosing = tag[4] === '/'

    if (skipping) {
      if (rawName !== skipping) continue
      if (closing) {
        if (--skipDepth === 0) skipping = null
      } else if (!selfClosing) skipDepth++
      continue
    }

    const name = ELEMENTS.get(rawName)
    if (!name) {
      if (!closing && !selfClosing) {
        skipping = rawName
        skipDepth = 1
      }
      continue
    }

    if (closing) {
      const at = open.lastIndexOf(name)
      if (at === -1) continue
      for (let i = open.length - 1; i >= at; i--) out.push(`</${open[i]}>`)
      open.length = at
      if (!open.length) closed = true
      continue
    }

    if (!open.length ? name !== 'svg' : name === 'svg') {
      if (!open.length) return ''
      if (!selfClosing) {
        skipping = rawName
        skipDepth = 1
      }
      continue
    }

    const attrs = cleanAttributes(tag[3], { recolor })
    if (name === 'svg') normalizeRoot(attrs, { recolor })
    if (selfClosing) {
      out.push(`<${name}${writeAttributes(attrs)}/>`)
      if (name === 'svg') closed = true
    } else {
      out.push(`<${name}${writeAttributes(attrs)}>`)
      open.push(name)
    }
  }
  for (let i = open.length - 1; i >= 0; i--) out.push(`</${open[i]}>`)
  const result = out.join('')
  return result.startsWith('<svg') ? result : ''
}

function normalizeRoot(attrs, { recolor }) {
  const get = (k) => attrs.find(([name]) => name === k)?.[1]
  if (!get('viewBox')) {
    const w = Number.parseFloat(get('width') ?? '')
    const h = Number.parseFloat(get('height') ?? '')
    if (w > 0 && h > 0) attrs.push(['viewBox', `0 0 ${w} ${h}`])
  }
  if (recolor && !get('fill')) attrs.push(['fill', 'currentColor'])
}

export function parseInlineSvg(markup) {
  if (typeof markup !== 'string') return null
  const m = markup.match(/^<svg([^>]*?)(?:\/>|>([\s\S]*)<\/svg>)$/)
  if (!m) return null
  const attrs = {}
  for (const a of m[1].matchAll(/ ([A-Za-z][A-Za-z0-9-]*)="([^"]*)"/g)) attrs[a[1]] = a[2]
  return { attrs, inner: m[2] ?? '' }
}

const LUCIDE_ROOT =
  'width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'

export function lucideSvg(name, inner) {
  return sanitizeInlineSvg(`<svg data-icon="lucide:${name}" ${LUCIDE_ROOT}>${inner}</svg>`)
}

export function lucideNameOf(markup) {
  const icon = parseInlineSvg(markup)?.attrs['data-icon']
  return icon?.startsWith('lucide:') ? icon.slice('lucide:'.length) : undefined
}

export const DEFAULT_ICON_SVG = lucideSvg('circle', '<circle cx="12" cy="12" r="10"/>')
