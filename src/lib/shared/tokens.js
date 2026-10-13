export const TOKEN_NAME_RE = /^[a-z][a-z0-9-]*$/
export const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

export const RESERVED_TOKEN_NAMES = new Set([
  'slate', 'gray', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
  'neutral', 'stone', 'zinc', 'white', 'black', 'transparent', 'current', 'inherit',
])

/**
 * Why a token is malformed, or null. Shadowing a palette name is NOT malformed —
 * see isReservedToken.
 * @returns {string|null}
 */
export function tokenError(token) {
  if (!TOKEN_NAME_RE.test(token?.name ?? '')) {
    return 'token names are kebab-case ([a-z][a-z0-9-]*)'
  }
  if (!HEX_RE.test(token?.value ?? '')) return 'token values are #hex colours'
  // the dark value is optional; absent means this colour is the same in both
  // modes, which is the right answer for a brand colour
  if (token.dark !== undefined && token.dark !== '' && !HEX_RE.test(token.dark)) {
    return 'a token dark value is a #hex colour'
  }
  return null
}

/** the token's dark-mode value, or null when it has none */
export function tokenDark(token) {
  return token && typeof token.dark === 'string' && HEX_RE.test(token.dark) ? token.dark : null
}

export function isReservedToken(name) {
  return RESERVED_TOKEN_NAMES.has(String(name))
}

export function isValidToken(token) {
  return tokenError(token) === null && !isReservedToken(token.name)
}

/**
 * Deliberately NOT `tokenError(token) === null`: a malformed `dark` must cost
 * the dark half and nothing else. A blob can arrive by import, merge or agent
 * without passing a writer, and dropping the whole token would take the light
 * value with it — every class naming it would render as no colour at all.
 */
export function isEmittableToken(token) {
  return TOKEN_NAME_RE.test(token?.name ?? '') && HEX_RE.test(token?.value ?? '')
}

const MONO_STACK =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
const SERIF_STACK = "ui-serif, Georgia, Cambria, 'Times New Roman', serif"
const SANS_STACK =
  "ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'"

export function fontFamilyValue(family, stack) {
  const clean = String(family ?? '')
    .replace(/[^A-Za-z0-9 -]/g, '')
    .trim()
  if (!clean) return null
  const quoted = clean.includes(' ') ? `'${clean}'` : clean
  return `${quoted}, ${stack}`
}

export function themeBlock(settings) {
  const lines = (settings?.tokens ?? [])
    .filter(isEmittableToken)
    .map((t) => `  --color-${t.name}: ${t.value};`)
  const fonts = settings?.fonts ?? {}
  const mono = fontFamilyValue(fonts.monoFamily, MONO_STACK)
  const serif = fontFamilyValue(fonts.serifFamily, SERIF_STACK)
  const sans = fontFamilyValue(fonts.family, SANS_STACK)
  if (sans) lines.push(`  --font-sans: ${sans};`)
  if (mono) lines.push(`  --font-mono: ${mono};`)
  if (serif) lines.push(`  --font-serif: ${serif};`)
  lines.push(...themeScaleLines(settings?.theme))
  return lines.length ? `@theme {\n${lines.join('\n')}\n}` : ''
}

/**
 * The dark half of every token that has one: the SAME custom properties, with
 * their dark values, under the `dark` marker class — so `bg-background` needs
 * no `dark:` counterpart anywhere and a retheme stays one token edit. A
 * `light` island re-asserts the light values, which is what makes `light` an
 * escape rather than just a class that happens to cancel `dark:` utilities.
 *
 * Custom properties INHERIT, so the marker only has to land on an ancestor —
 * the site root for a whole-site toggle, a section for one dark band.
 *
 * `scope` prefixes both selectors (the editor scopes the whole palette to
 * `[data-site-scope]`, so the chrome is never restyled by the project's
 * tokens); the export passes nothing.
 */
export function modeTokensCss(settings, scope = '') {
  const pairs = (settings?.tokens ?? []).filter(isEmittableToken).filter(tokenDark)
  if (!pairs.length) return ''
  const rule = (marker, pick) => {
    const decls = pairs.map((t) => `  --color-${t.name}: ${pick(t)};`).join('\n')
    const sel = scope
      ? `${scope}:where(${marker}), ${scope} :where(${marker})`
      : `:where(${marker})`
    return `${sel} {\n${decls}\n}`
  }
  return [rule('.dark', (t) => tokenDark(t)), rule('.light', (t) => t.value)].join('\n')
}

const LENGTH_RE = /^-?\d*\.?\d+(?:px|rem|em|%|vw|vh|ch|ex|pt)?$/
const FUNC_RE = /^(?:clamp|calc|min|max)\([-+*/\s\d.a-z%(),]*\)$/i

export function isThemeValue(value) {
  const v = String(value ?? '').trim()
  if (!v || v.length > 64) return false
  if (v.includes(';') || v.includes('}') || v.includes('{')) return false
  return LENGTH_RE.test(v) || FUNC_RE.test(v)
}

const SCALE_GROUPS = {
  text: 'text',
  leading: 'leading',
  tracking: 'tracking',
  radius: 'radius',
  spacing: 'spacing',
}

const STEP_RE = /^[a-z0-9][a-z0-9-]*$/

function themeScaleLines(theme) {
  const out = []
  if (!theme || typeof theme !== 'object') return out
  if (theme.spacing !== undefined && isThemeValue(theme.spacing)) {
    out.push(`  --spacing: ${String(theme.spacing).trim()};`)
  }
  for (const [group, prefix] of Object.entries(SCALE_GROUPS)) {
    if (group === 'spacing') continue
    const steps = theme[group]
    if (!steps || typeof steps !== 'object') continue
    for (const [step, value] of Object.entries(steps)) {
      if (!STEP_RE.test(step) || !isThemeValue(value)) continue
      out.push(`  --${prefix}-${step}: ${String(value).trim()};`)
    }
  }
  return out
}

export function rootFontSizeCss(settings) {
  const size = settings?.theme?.rootFontSize
  return size && isThemeValue(size) ? `html{font-size:${String(size).trim()};}` : ''
}

export const applyTitleTemplate = (template, pageName) => (template || '%s').replaceAll('%s', pageName)
