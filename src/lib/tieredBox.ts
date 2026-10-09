import { buildTailClass, parseTail } from './valueClass'

export type Tier = 'all' | 'axis' | 'sides'
export type Slot = 'all' | 'x' | 'y' | 't' | 'r' | 'b' | 'l'

export interface Scheme {
  steps: string[]
  slot(base: string, slot: Slot): string
  className(prefix: string, step: string): string
  parse(token: string, prefix: string): string | null
}

const SLOTS: Slot[] = ['all', 'x', 'y', 't', 'r', 'b', 'l']

export function getStep(scheme: Scheme, tokens: string[], prefix: string): string | null {
  for (const t of tokens) {
    const step = scheme.parse(t, prefix)
    if (step !== null) return step
  }
  return null
}

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

export function inferTier(scheme: Scheme, tokens: string[], base: string): Tier {
  const at = (s: Slot) => getStep(scheme, tokens, scheme.slot(base, s))
  if (at('t') !== null || at('r') !== null || at('b') !== null || at('l') !== null) return 'sides'
  if (at('x') !== null || at('y') !== null) return 'axis'
  return 'all'
}

function clearBase(scheme: Scheme, tokens: string[], base: string): string[] {
  return SLOTS.reduce((acc, s) => setStep(scheme, acc, scheme.slot(base, s), null), tokens)
}

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

function mostCommon(vals: (string | null)[]): string | null {
  const counts = new Map<string, number>()
  for (const v of vals) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: string | null = null
  let bestN = 0
  for (const [v, n] of counts) if (n > bestN) ((best = v), (bestN = n))
  return best
}

export const SPACING = ['0', '1', '2', '3', '4', '6', '8', '10', '12', '16', '20', '24']

export const spacingScheme: Scheme = {
  steps: SPACING,
  slot: (base, s) => (s === 'all' ? base : `${base}${s}`),
  className: (prefix, step) => buildTailClass(prefix, step),
  parse: (token, prefix) =>
    parseTail(token, prefix, { allowKeywords: prefix.startsWith('m') ? ['auto'] : [] }),
}

export const BORDER_STEPS = ['0', '1', '2', '4', '8']

export const borderWidthScheme: Scheme = {
  steps: BORDER_STEPS,
  slot: (base, s) => (s === 'all' ? base : `${base}-${s}`),
  className: (prefix, step) => (step === '1' ? prefix : buildTailClass(prefix, step)),
  parse: (token, prefix) => {
    if (token === prefix) return '1'
    return parseTail(token, prefix)
  },
}
