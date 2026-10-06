// Custom webfonts: the @font-face block, shared VERBATIM by the editor/preview
// (useThemeTokens injects it into the document head) and the static exporter
// (server/export.mjs emits it into every page head).
//
// This exists because fonts used to be hand-written into
// settings.customCode.head, which ONLY the exporter emits — so a site with
// custom fonts rendered them on the published page and silently fell back to
// system faces in the editor and the preview. Registered fonts live in
// settings.fonts.custom and render identically on every surface.
//
// Font FILES stay in the media library (`/media/<id>`); a font entry just
// points at one.

/** how a media mime maps to the @font-face `format()` hint */
const FORMAT_BY_MIME = {
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'truetype',
  'font/otf': 'opentype',
}

/** …and the same by file extension, for https URLs that never went through
 *  the library (the mime isn't knowable without fetching) */
const FORMAT_BY_EXT = {
  woff2: 'woff2',
  woff: 'woff',
  ttf: 'truetype',
  otf: 'opentype',
  ttc: 'truetype',
}

export const FONT_FORMATS = ['woff2', 'woff', 'truetype', 'opentype']

/** the `format()` hint for an asset mime, or undefined when unknown —
 *  the hint is optional, so an unknown format still loads (browsers sniff) */
export function fontFormatForMime(mime) {
  return FORMAT_BY_MIME[String(mime ?? '').toLowerCase()]
}

/** the `format()` hint guessed from a URL's extension, or undefined */
export function fontFormatForUrl(url) {
  const ext = String(url ?? '').toLowerCase().split(/[?#]/)[0].split('.').pop()
  return FORMAT_BY_EXT[ext]
}

/** family names are interpolated into CSS, so they are restricted to the same
 *  safe character set as settings.fonts.family — letters, digits, spaces and
 *  hyphens. Anything else could close the declaration and inject rules. */
export const FONT_FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 -]*$/

/** a weight the CSS accepts: 100–900, or a variable-font range ("100 900") */
const WEIGHT_RE = /^(?:[1-9]00|normal|bold)(?: (?:[1-9]00))?$/

/** only same-origin media paths and https URLs may be fetched as fonts —
 *  mirrors SAFE_SRC's intent, minus the data:/mailto:/tel: cases that make no
 *  sense for a font file */
const SAFE_FONT_SRC = /^(?:\/|https:\/\/)/i

/** human-readable reason a font entry is unusable, or null when it is fine */
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

/** entries that are safe to emit (invalid ones are skipped rather than
 *  poisoning the stylesheet for every other font) */
export function validFonts(settings) {
  const list = settings?.fonts?.custom ?? []
  return list.filter((f) => !fontError(f, list))
}

/**
 * The @font-face CSS for every registered custom font.
 * `rewrite` maps a media reference to its exported path (the static export
 * copies library files to hashed names); omit it in the editor, where
 * `/media/<id>` is served directly.
 */
export function fontFaceBlock(settings, rewrite) {
  const rules = []
  for (const font of validFonts(settings)) {
    const url = rewrite ? rewrite(font.src) : font.src
    if (!url || !SAFE_FONT_SRC.test(url)) continue
    // the URL is quoted, so a quote or backslash inside it would break out
    if (/["'\\)]/.test(url)) continue
    const family = String(font.family).trim()
    const format = font.format && FONT_FORMATS.includes(font.format) ? ` format('${font.format}')` : ''
    const parts = [
      `  font-family: '${family}';`,
      `  src: url('${url}')${format};`,
      `  font-weight: ${font.weight && WEIGHT_RE.test(String(font.weight)) ? font.weight : 'normal'};`,
      `  font-style: ${font.style === 'italic' ? 'italic' : 'normal'};`,
      // swap keeps text visible while the file loads instead of blanking it
      '  font-display: swap;',
    ]
    rules.push(`@font-face {\n${parts.join('\n')}\n}`)
  }
  return rules.join('\n')
}

/** every `/media/<id>` (or https) URL the registered fonts reference — the
 *  exporter interns these so the published site carries its own font files */
export function fontSrcRefs(settings) {
  return validFonts(settings).map((f) => f.src).filter(Boolean)
}

// ---------- legacy import ----------

/**
 * Font entries recovered from hand-written `@font-face` CSS — the pattern the
 * old handbook told people (and agents) to paste into settings.customCode.head.
 * Deliberately forgiving: it only needs family + url, and skips anything it
 * cannot read rather than guessing.
 */
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

/** strip the `@font-face` rules (and a `<style>` wrapper left holding nothing
 *  but whitespace) from hand-written head HTML, for the post-import cleanup */
export function stripFontFaces(css) {
  return String(css ?? '')
    .replace(/@font-face\s*\{[^}]*\}/gi, '')
    .replace(/<style>\s*<\/style>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
