// Per-breakpoint style editing. Desktop (the widest breakpoint) is the base:
// its classes are unprefixed and apply everywhere. Editing a smaller breakpoint
// writes Tailwind arbitrary max-width variants (`max-[767px]:hidden`) that
// override the base below that width — correct on the exported site, whose real
// viewport drives the media query.
//
// The Style panel edits one breakpoint at a time. It works on a cascaded
// "effective view": the value that actually applies at that breakpoint's width
// (base overridden by every larger breakpoint down to this one — so Mobile
// inherits Tablet, not just Desktop), prefixes stripped. Editing writes back
// only what differs from what this breakpoint inherits.

import { sameProperty } from './styles'

/** the variant prefix for a breakpoint of `width`, e.g. `max-[767px]:` */
export function breakpointVariant(width: number): string {
  return `max-[${width}px]:`
}

/** the min-width variant prefix for `width`, e.g. `min-[768px]:` — used to
 * scope a class so it only applies from a breakpoint up (i.e. removed below it) */
export function breakpointMinVariant(width: number): string {
  return `min-[${width}px]:`
}

/** Tailwind's default named screens (min-width thresholds, in px). Authored
 * directly in the DSL as `md:flex` (min-width) or `max-md:hidden` (max-width). */
const NAMED_SCREENS: Record<string, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
}
// widest names first so `2xl` is tried before `xl` in the alternation
const NAMED_ALT = Object.keys(NAMED_SCREENS)
  .sort((a, b) => b.length - a.length)
  .join('|')
/** matches a leading named-screen variant: `md:` (min) or `max-md:` (max) */
const NAMED_TOKEN_RE = new RegExp(`^(max-)?(${NAMED_ALT}):(.+)$`)

/** a token carrying a min/max arbitrary-width variant, or a named Tailwind
 * screen variant (`md:`, `max-md:`) */
export function isBreakpointToken(token: string): boolean {
  if (/^(?:min|max)-\[[0-9.]+(?:px|rem|em)\]:/.test(token)) return true
  const m = token.match(NAMED_TOKEN_RE)
  return m !== null && m[2]! in NAMED_SCREENS
}

/**
 * The breakpoint a concrete viewport `width` falls in, under the desktop-first
 * (max-width) model: the tightest breakpoint whose width still covers this
 * viewport (smallest width >= `width`), or the widest (base) when the viewport
 * is larger than every breakpoint. Mirrored in server/site-runtime.js — keep in
 * sync. Returns null only when there are no breakpoints.
 */
export function breakpointIdForWidth(
  breakpoints: { id: string; width: number }[],
  width: number,
): string | null {
  if (!breakpoints.length) return null
  const asc = [...breakpoints].sort((a, b) => a.width - b.width)
  return (asc.find((b) => width <= b.width) ?? asc[asc.length - 1]!).id
}

const UNIT_PX: Record<string, number> = { px: 1, rem: 16, em: 16 }

/** parse a breakpoint token into its threshold (px), bound, and the bare class
 * (variant prefix stripped), or null when it isn't a breakpoint token */
function parseBreakpointToken(
  token: string,
): { px: number; bound: 'min' | 'max'; bare: string } | null {
  const m = token.match(/^(min|max)-\[([0-9.]+)(px|rem|em)\]:(.+)$/)
  if (m) return { bound: m[1] as 'min' | 'max', px: parseFloat(m[2]!) * UNIT_PX[m[3]!]!, bare: m[4]! }
  // named Tailwind screens: `md:` is min-width; `max-md:` is max-width (applies
  // just below the threshold, so use an epsilon under it for the cascade test)
  const n = token.match(NAMED_TOKEN_RE)
  if (n && n[2]! in NAMED_SCREENS) {
    const threshold = NAMED_SCREENS[n[2]!]!
    return n[1]
      ? { bound: 'max', px: threshold - 0.02, bare: n[3]! }
      : { bound: 'min', px: threshold, bare: n[3]! }
  }
  return null
}

/** split a token into its variant prefix (incl. trailing ':') and base class */
function tokenParts(token: string): { variant: string; base: string } {
  const i = token.lastIndexOf(':')
  return i === -1 ? { variant: '', base: token } : { variant: token.slice(0, i + 1), base: token.slice(i + 1) }
}

interface Entry {
  token: string
  /** true when this value comes from the breakpoint being edited (not inherited) */
  own: boolean
}

/** replace the same-variant, same-property entry in `list`, else append */
function replaceOrAppendEntry(list: Entry[], entry: Entry): Entry[] {
  const p = tokenParts(entry.token)
  const idx = list.findIndex((e) => {
    const q = tokenParts(e.token)
    return q.variant === p.variant && sameProperty(q.base, p.base)
  })
  if (idx === -1) return [...list, entry]
  const next = [...list]
  next[idx] = entry
  return next
}

/**
 * The cascaded value at `width`: base (non-breakpoint) tokens overridden by
 * every breakpoint override that applies at `width`, tightest winning. Each
 * resulting entry is flagged `own` when it comes from the breakpoint whose
 * threshold is exactly `width` (the one being edited) rather than inherited.
 */
function cascadeEntries(all: string[], width: number): Entry[] {
  let entries: Entry[] = all.filter((t) => !isBreakpointToken(t)).map((token) => ({ token, own: false }))
  const overrides = all
    .map(parseBreakpointToken)
    .filter((o): o is NonNullable<typeof o> => o !== null)
    .filter((o) => (o.bound === 'max' ? width <= o.px : width >= o.px))
    // apply widest max (and smallest min) first so the tightest override wins last
    .sort((a, b) => (a.bound === 'max' ? b.px - a.px : a.px - b.px))
  for (const o of overrides) {
    entries = replaceOrAppendEntry(entries, { token: o.bare, own: o.bound === 'max' && o.px === width })
  }
  return entries
}

/**
 * Resolve a class string for a concrete frame width, dropping the responsive
 * variant prefixes. Used to preview per-breakpoint styles in the multi-frame
 * canvas, where real CSS media queries can't (they key off the window, not the
 * fixed-width frame). The published site keeps the prefixed variants.
 */
export function resolveClassesForWidth(classString: string, width: number): string {
  return cascadeEntries(classString.split(/\s+/).filter(Boolean), width)
    .map((e) => e.token)
    .join(' ')
}

/**
 * The panel view for the breakpoint at `activeWidth` (null = base): the cascaded
 * tokens that actually apply there, plus which of them are inherited (not this
 * breakpoint's own override) so the UI can dim them.
 *
 * The base (widest) view is the cascade at `baseWidth` so `min-[…]:` tokens
 * (classes scoped to "this breakpoint up" by removing them on a smaller one)
 * still surface on Desktop, where they apply and can be managed. With no such
 * tokens this is exactly the unprefixed base tokens, as before. Nothing is
 * inherited at the base — it's the top of the cascade.
 */
export function breakpointView(
  all: string[],
  activeWidth: number | null,
  baseWidth: number,
): { tokens: string[]; inherited: string[] } {
  if (activeWidth === null) {
    return { tokens: cascadeEntries(all, baseWidth).map((e) => e.token), inherited: [] }
  }
  const entries = cascadeEntries(all, activeWidth)
  return {
    tokens: entries.map((e) => e.token),
    inherited: entries.filter((e) => !e.own).map((e) => e.token),
  }
}

/**
 * Fold an edited panel view back into the full stored token list. Base tokens
 * and other breakpoints' overrides are preserved; only what differs from what
 * this breakpoint *inherits* (base + larger breakpoints) becomes its override,
 * so touching an inherited value doesn't freeze it and reverting an override
 * falls back to the inherited value.
 */
export function applyBreakpointEdit(
  all: string[],
  activeWidth: number | null,
  next: string[],
  baseWidth: number,
): string[] {
  if (activeWidth === null) {
    // base edit. `next` is the new base view, which may include the bare values
    // of `min-[…]:` tokens that apply at the widest width (a class scoped to
    // "this breakpoint up"). Keep such a token in its scoped form while it's
    // still present; drop it when removed here; anything else in `next` is a
    // plain unprefixed base token. Non-base breakpoint tokens pass through.
    const scoped = all.filter((t) => {
      const p = parseBreakpointToken(t)
      return p !== null && p.bound === 'min' && baseWidth >= p.px
    })
    const keptScoped = scoped.filter((t) => next.includes(parseBreakpointToken(t)!.bare))
    const keptBares = new Set(keptScoped.map((t) => parseBreakpointToken(t)!.bare))
    const baseTokens = next.filter((t) => !keptBares.has(t))
    const others = all.filter((t) => isBreakpointToken(t) && !scoped.includes(t))
    return [...baseTokens, ...keptScoped, ...others]
  }
  const variant = breakpointVariant(activeWidth)
  const base = all.filter((t) => !isBreakpointToken(t))
  const others = all.filter((t) => isBreakpointToken(t) && !t.startsWith(variant))
  // what this breakpoint inherits, WITHOUT its own overrides (base + larger)
  const inherited = breakpointView([...base, ...others], activeWidth, baseWidth).tokens
  const ownOverrides = next.filter((t) => !inherited.includes(t)).map((t) => variant + t)
  return [...base, ...others, ...ownOverrides]
}

/**
 * Remove an inherited class at the breakpoint being edited so it no longer
 * applies there or at any smaller width, while larger breakpoints keep it.
 * Only the common case is handled: a value inherited straight from the base
 * (unprefixed) token. It's rewritten as a `min-[keepAboveWidth]:` variant —
 * `keepAboveWidth` being the next breakpoint width up — so the class survives
 * only from there up. Returns null when `cls` isn't a plain base token (e.g. it
 * was overridden by a larger non-base breakpoint), which the caller leaves
 * unremovable for now.
 */
export function removeInheritedToken(
  all: string[],
  cls: string,
  keepAboveWidth: number,
): string[] | null {
  if (isBreakpointToken(cls) || !all.includes(cls)) return null
  return [...all.filter((t) => t !== cls), breakpointMinVariant(keepAboveWidth) + cls]
}
