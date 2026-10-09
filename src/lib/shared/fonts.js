const FORMAT_BY_MIME = {
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'truetype',
  'font/otf': 'opentype',
}

const FORMAT_BY_EXT = {
  woff2: 'woff2',
  woff: 'woff',
  ttf: 'truetype',
  otf: 'opentype',
  ttc: 'truetype',
}

export const FONT_FORMATS = ['woff2', 'woff', 'truetype', 'opentype']

export function fontFormatForMime(mime) {
  return FORMAT_BY_MIME[String(mime ?? '').toLowerCase()]
}

export function fontFormatForUrl(url) {
  const ext = String(url ?? '').toLowerCase().split(/[?#]/)[0].split('.').pop()
  return FORMAT_BY_EXT[ext]
}

export const FONT_FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 -]*$/

const WEIGHT_RE = /^(?:[1-9]00|normal|bold)(?: (?:[1-9]00))?$/

const SAFE_FONT_SRC = /^(?:\/|https:\/\/)/i

export function fontError(font, others = []) {
  const family = String(font?.family ?? '').trim()
  if (!family) return 'Family name required'
  if (!FONT_FAMILY_RE.test(family)) return 'Letters, digits, spaces and hyphens only'
  if (others.some((f) => f !== font && String(f.family ?? '').trim().toLowerCase() === family.toLowerCase() &&
      (f.weight ?? '400') === (font.weight ?? '400') && (f.style ?? 'normal') === (font.style ?? 'normal'))) {
    return 'Another font already uses this family, weight and style'
  }
  if (!font?.src) return 'Pick a font file'
  if (!SAFE_FONT_SRC.test(font.src)) return 'Font files must be a /media/… path or an https:// URL'
  if (font.weight && !WEIGHT_RE.test(String(font.weight))) return 'Weight is 100–900, or a range like "100 900"'
  return null
}

export function validFonts(settings) {
  const list = settings?.fonts?.custom ?? []
  return list.filter((f) => !fontError(f, list))
}

export function fontFaceBlock(settings, rewrite) {
  const rules = []
  for (const font of validFonts(settings)) {
    const url = rewrite ? rewrite(font.src) : font.src
    if (!url || !SAFE_FONT_SRC.test(url)) continue
    if (/["'\\)]/.test(url)) continue
    const family = String(font.family).trim()
    const format = font.format && FONT_FORMATS.includes(font.format) ? ` format('${font.format}')` : ''
    const parts = [
      `  font-family: '${family}';`,
      `  src: url('${url}')${format};`,
      `  font-weight: ${font.weight && WEIGHT_RE.test(String(font.weight)) ? font.weight : 'normal'};`,
      `  font-style: ${font.style === 'italic' ? 'italic' : 'normal'};`,
      '  font-display: swap;',
    ]
    rules.push(`@font-face {\n${parts.join('\n')}\n}`)
  }
  return rules.join('\n')
}

export function fontSrcRefs(settings) {
  return validFonts(settings).map((f) => f.src).filter(Boolean)
}

export function parseFontFaces(css) {
  const out = []
  const text = String(css ?? '')
  const blockRe = /@font-face\s*\{([^}]*)\}/gi
  let match
  while ((match = blockRe.exec(text))) {
    const body = match[1]
    const family = /font-family\s*:\s*(?:'([^']+)'|"([^"]+)"|([^;]+))/i.exec(body)
    const src = /url\(\s*(?:'([^']+)'|"([^"]+)"|([^)\s]+))\s*\)/i.exec(body)
    if (!family || !src) continue
    const name = (family[1] ?? family[2] ?? family[3] ?? '').trim()
    const url = (src[1] ?? src[2] ?? src[3] ?? '').trim()
    if (!name || !url) continue
    const format = /format\(\s*'([^']+)'|format\(\s*"([^"]+)"/i.exec(body)
    const weight = /font-weight\s*:\s*([^;]+)/i.exec(body)
    const style = /font-style\s*:\s*([^;]+)/i.exec(body)
    out.push({
      family: name,
      src: url,
      format: (format?.[1] ?? format?.[2])?.trim() || fontFormatForUrl(url),
      weight: weight?.[1]?.trim() || undefined,
      style: style?.[1]?.trim() === 'italic' ? 'italic' : undefined,
    })
  }
  return out
}

export function stripFontFaces(css) {
  return String(css ?? '')
    .replace(/@font-face\s*\{[^}]*\}/gi, '')
    .replace(/<style>\s*<\/style>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
