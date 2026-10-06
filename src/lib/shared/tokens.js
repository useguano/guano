// Design-token validation + the @theme block + title template — shared
// VERBATIM by the TS client (src/lib/settings.ts re-exports these) and the
// node exporter (server/export.mjs), which can't import TypeScript.
// Plain-JS ESM; the typed signatures live in src/lib/settings.ts.

export const TOKEN_NAME_RE = /^[a-z][a-z0-9-]*$/
export const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

// Tailwind palette names + keywords a token may not shadow.
// NOTE: the palette portion must stay in sync with TAILWIND_COLORS keys in
// src/lib/colors.ts (the client's name→hex map).
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
  return null
}

/**
 * Does this name shadow a Tailwind palette name or colour keyword?
 *
 * A token compiles to `--color-<name>`, so `blue` defines `bg-blue` — it does
 * NOT redefine `bg-blue-500`, which is a different variable. So this is a
 * legibility hazard, not a breakage: a real brand palette genuinely has colours
 * called "blue" and "orange", and forcing every one of them to be renamed (and
 * every class rewritten to `bg-brand-blue`) was friction with no safety payoff.
 * Callers warn; they no longer refuse.
 */
export function isReservedToken(name) {
  return RESERVED_TOKEN_NAMES.has(String(name))
}

/** well-formed AND not shadowing a palette name — the conservative default */
export function isValidToken(token) {
  return tokenError(token) === null && !isReservedToken(token.name)
}

/** well-formed, shadowing allowed — what actually reaches the @theme block, so
 * a deliberately-shadowing token really does render */
export function isEmittableToken(token) {
  return tokenError(token) === null
}

// fallback stacks appended after a custom family so a missing webfont still
// degrades sensibly
const MONO_STACK =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
const SERIF_STACK = "ui-serif, Georgia, Cambria, 'Times New Roman', serif"
const SANS_STACK =
  "ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'"

/** a font-family value safe to drop into CSS: only letters/digits/space/hyphen
 * survive (blocks `;`/`}`/quotes that could break out of the declaration),
 * quoted when it contains a space, with the fallback stack appended. Returns
 * null when nothing usable remains. */
export function fontFamilyValue(family, stack) {
  const clean = String(family ?? '')
    .replace(/[^A-Za-z0-9 -]/g, '')
    .trim()
  if (!clean) return null
  const quoted = clean.includes(' ') ? `'${clean}'` : clean
  return `${quoted}, ${stack}`
}

/** the @theme block fed to Tailwind (canvas runtime + static export);
 * only fully valid tokens are emitted — one bad declaration would poison
 * the shared stylesheet for every user class. Custom mono/serif families
 * (settings.fonts.monoFamily / serifFamily) become --font-mono / --font-serif
 * so `font-mono` / `font-serif` resolve to a designed face. */
export function themeBlock(settings) {
  const lines = (settings?.tokens ?? [])
    .filter(isEmittableToken)
    .map((t) => `  --color-${t.name}: ${t.value};`)
  const fonts = settings?.fonts ?? {}
  const mono = fontFamilyValue(fonts.monoFamily, MONO_STACK)
  const serif = fontFamilyValue(fonts.serifFamily, SERIF_STACK)
  // the base family rebinds --font-sans too — without this, `font-sans` on an
  // element (the handbook's own body recipe) resolved to the DEFAULT stack and
  // silently discarded the project font (run #6, B2)
  const sans = fontFamilyValue(fonts.family, SANS_STACK)
  if (sans) lines.push(`  --font-sans: ${sans};`)
  if (mono) lines.push(`  --font-mono: ${mono};`)
  if (serif) lines.push(`  --font-serif: ${serif};`)
  lines.push(...themeScaleLines(settings?.theme))
  return lines.length ? `@theme {\n${lines.join('\n')}\n}` : ''
}

// ---------- type / spacing scale overrides ----------
//
// A design system usually sets its own root size and type ramp (a 15px root
// with a 0.875rem body size is a common pairing). Without these, a project
// could only approximate its own scale — everything rendered at Tailwind's
// defaults and drifted a few percent from the design it was ported from.
//
// Values land in CSS, so they are validated rather than trusted: a length, a
// unitless number, or a clamp()/calc() built only from those.

const LENGTH_RE = /^-?\d*\.?\d+(?:px|rem|em|%|vw|vh|ch|ex|pt)?$/
const FUNC_RE = /^(?:clamp|calc|min|max)\([-+*/\s\d.a-z%(),]*\)$/i

/** a CSS length/number safe to emit into a custom property */
export function isThemeValue(value) {
  const v = String(value ?? '').trim()
  if (!v || v.length > 64) return false
  if (v.includes(';') || v.includes('}') || v.includes('{')) return false
  return LENGTH_RE.test(v) || FUNC_RE.test(v)
}

/** the theme-scale keys that may be overridden, and the variable each maps to */
const SCALE_GROUPS = {
  text: 'text',
  leading: 'leading',
  tracking: 'tracking',
  radius: 'radius',
  spacing: 'spacing',
}

/** step names accepted inside a scale group (`text: {base: '.875rem'}`) */
const STEP_RE = /^[a-z0-9][a-z0-9-]*$/

function themeScaleLines(theme) {
  const out = []
  if (!theme || typeof theme !== 'object') return out
  // `spacing` is a single value in v4 (the whole scale is calc(spacing * n))
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

/**
 * The `html { font-size }` rule for a project that sets its own root size.
 * Not a theme variable — it rescales every rem in the document, which is how a
 * design with a 15px root is reproduced faithfully instead of approximated.
 */
export function rootFontSizeCss(settings) {
  const size = settings?.theme?.rootFontSize
  return size && isThemeValue(size) ? `html{font-size:${String(size).trim()};}` : ''
}

/** '%s' in the template is the page name; empty template = just the name */
export const applyTitleTemplate = (template, pageName) => (template || '%s').replaceAll('%s', pageName)
