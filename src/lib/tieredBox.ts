// Generic All / X·Y / Sides "box" control logic (padding, margin, border width…).
// Pure functions over the element's class token array, parameterized by a Scheme
// so each property family plugs in its own class naming. Tiers are mutually
// exclusive: only one set of classes exists at a time, migrated on switch.

import { buildTailClass, parseTail } from './valueClass'

export type Tier = 'all' | 'axis' | 'sides'
export type Slot = 'all' | 'x' | 'y' | 't' | 'r' | 'b' | 'l'

export interface Scheme {
  /** ordered steps the stepper walks (coarse → fine), incl. the '0'/none step */
  steps: string[]
  /** class prefix for a base + slot, e.g. ('p','x')→'px', ('border','t')→'border-t' */
  slot(base: string, slot: Slot): string
  /** build the class for a prefix + step */
  className(prefix: string, step: string): string
  /** parse a token into its step for the given prefix, or null */
  parse(token: string, prefix: string): string | null
}

const SLOTS: Slot[] = ['all', 'x', 'y', 't', 'r', 'b', 'l']

/** the step present for `prefix` in tokens, or null */
export function getStep(scheme: Scheme, tokens: string[], prefix: string): string | null {
  for (const t of tokens) {
    const step = scheme.parse(t, prefix)
    if (step !== null) return step
  }
  return null
}

/** replace / add / remove the class for `prefix`; returns new tokens */
export function setStep(
  scheme: Scheme,
  tokens: string[],
  prefix: string,
  step: string | null,
): string[] {
  const next = tokens.filter((t) => scheme.parse(t, prefix) === null)
  if (step !== null) next.push(scheme.className(prefix, step))
  return next
}

/** per-side effective step, resolving precedence side > axis > all */
export function effectiveSides(
  scheme: Scheme,
  tokens: string[],
  base: string,
): Record<'t' | 'r' | 'b' | 'l', string | null> {
  const at = (s: Slot) => getStep(scheme, tokens, scheme.slot(base, s))
  const all = at('all')
  const x = at('x')
  const y = at('y')
  return {
    t: at('t') ?? y ?? all,
    r: at('r') ?? x ?? all,
    b: at('b') ?? y ?? all,
    l: at('l') ?? x ?? all,
  }
}

/** which tier's classes are present (default 'all') */
export function inferTier(scheme: Scheme, tokens: string[], base: string): Tier {
  const at = (s: Slot) => getStep(scheme, tokens, scheme.slot(base, s))
  if (at('t') !== null || at('r') !== null || at('b') !== null || at('l') !== null) return 'sides'
  if (at('x') !== null || at('y') !== null) return 'axis'
  return 'all'
}

function clearBase(scheme: Scheme, tokens: string[], base: string): string[] {
  return SLOTS.reduce((acc, s) => setStep(scheme, acc, scheme.slot(base, s), null), tokens)
}

/** switch a base to `tier`, seeding from the current effective sides + clearing others */
export function migrateTier(scheme: Scheme, tokens: string[], base: string, tier: Tier): string[] {
  const sides = effectiveSides(scheme, tokens, base)
  let next = clearBase(scheme, tokens, base)
  const put = (slot: Slot, step: string | null) => (next = setStep(scheme, next, scheme.slot(base, slot), step))
  if (tier === 'all') {
    const vals = [sides.t, sides.r, sides.b, sides.l]
    const uniq = new Set(vals)
    put('all', uniq.size === 1 ? [...uniq][0]! : mostCommon(vals))
  } else if (tier === 'axis') {
    put('x', sides.l ?? sides.r)
    put('y', sides.t ?? sides.b)
  } else {
    put('t', sides.t)
    put('r', sides.r)
    put('b', sides.b)
    put('l', sides.l)
  }
  return next
}

/** the non-null value shared by the most sides (used collapsing to 'all') */
function mostCommon(vals: (string | null)[]): string | null {
  const counts = new Map<string, number>()
  for (const v of vals) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: string | null = null
  let bestN = 0
  for (const [v, n] of counts) if (n > bestN) ((best = v), (bestN = n))
  return best
}

// ---------------------------------------------------------------------------
// Schemes
// ---------------------------------------------------------------------------

/** Tailwind spacing steps (padding/margin) */
export const SPACING = ['0', '1', '2', '3', '4', '6', '8', '10', '12', '16', '20', '24']


/** padding / margin — base 'p' | 'm'; slot suffix concatenated (px, pt).
 * Values round-trip through the shared tail helpers so custom units
 * (`p-[4em]`) and negative margins (`-mt-4`) are recognised alongside the scale. */
export const spacingScheme: Scheme = {
  steps: SPACING,
  slot: (base, s) => (s === 'all' ? base : `${base}${s}`),
  className: (prefix, step) => buildTailClass(prefix, step),
  // margins collapse to `auto`; padding never does, so only recognise the
  // keyword on m-prefixed slots (`m-auto`, `mx-auto`, `mt-auto`)
  parse: (token, prefix) =>
    parseTail(token, prefix, { allowKeywords: prefix.startsWith('m') ? ['auto'] : [] }),
}

/** border width — base 'border'; slot suffix dash-joined (border-x, border-t).
 * '1' is the bare class (`border`), and only 0/2/4/8 take a numeric suffix. */
export const BORDER_STEPS = ['0', '1', '2', '4', '8']

export const borderWidthScheme: Scheme = {
  steps: BORDER_STEPS,
  slot: (base, s) => (s === 'all' ? base : `${base}-${s}`),
  // '1' is the bare class (`border`); scale/custom widths dash-join (border-2,
  // border-[3px]); custom values round-trip via the shared tail helpers
  className: (prefix, step) => (step === '1' ? prefix : buildTailClass(prefix, step)),
  parse: (token, prefix) => {
    if (token === prefix) return '1'
    return parseTail(token, prefix)
  },
}
