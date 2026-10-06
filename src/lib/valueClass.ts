// Shared value ⇄ Tailwind-class conversion for the editable slider/stepper
// inputs. A bare number maps to the scale class (`4` → `p-4`); a number with an
// accepted unit maps to an arbitrary value (`4em` → `p-[4em]`). Negatives are
// only honored where the caller allows them (inset, margin) and Tailwind places
// the sign before the prefix (`-mt-4`, `-top-[4px]`).

export const ACCEPTED_UNITS = ['px', 'rem', 'em', '%', 'ch', 'ex', 'fr'] as const

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const UNIT_RE = new RegExp(`^\\d*\\.?\\d+(?:${ACCEPTED_UNITS.map(esc).join('|')})$`)
const NUM_RE = /^\d+(?:\.\d+)?$/
// a class fragment we recognise as a value: bracketed arbitrary, or a number
const TAIL_RE = /^(?:\[.+\]|\d+(?:\.\d+)?)$/

/**
 * The class "tail" (the part after `${prefix}-`) for the typed text, carrying a
 * leading '-' for negatives: `'4' | '1.5' | '[4em]' | '-4' | '-[4px]'`.
 * `null` = unset (empty), `false` = invalid (reject).
 * Keywords in `allowKeywords` (e.g. `auto`) pass through as a bare tail.
 */
export function textToTail(
  text: string,
  opts: { allowNegative?: boolean; allowKeywords?: readonly string[] } = {},
): string | null | false {
  const t = text.trim()
  if (t === '') return null
  if (opts.allowKeywords?.includes(t.toLowerCase())) return t.toLowerCase()
  let neg = false
  let body = t
  if (body.startsWith('-')) {
    if (!opts.allowNegative) return false
    neg = true
    body = body.slice(1).trim()
  }
  if (NUM_RE.test(body)) return neg ? `-${body}` : body
  if (UNIT_RE.test(body)) return neg ? `-[${body}]` : `[${body}]`
  return false
}

/** inverse of {@link textToTail}: the tail as human-facing text */
export function tailToText(tail: string | null | undefined): string {
  if (tail == null) return ''
  let neg = ''
  let body = tail
  if (body.startsWith('-')) {
    neg = '-'
    body = body.slice(1)
  }
  if (body.startsWith('[') && body.endsWith(']')) body = body.slice(1, -1)
  return neg + body
}

/** build the class token for a prefix + tail (sign moves before the prefix) */
export function buildTailClass(prefix: string, tail: string): string {
  if (tail.startsWith('-')) return `-${prefix}-${tail.slice(1)}`
  return `${prefix}-${tail}`
}

/** parse a token into its tail for `prefix` (incl. leading '-'), or null */
export function parseTail(
  token: string,
  prefix: string,
  opts: { allowKeywords?: readonly string[] } = {},
): string | null {
  let neg = false
  let rest: string
  if (token.startsWith(`-${prefix}-`)) {
    neg = true
    rest = token.slice(prefix.length + 2)
  } else if (token.startsWith(`${prefix}-`)) {
    rest = token.slice(prefix.length + 1)
  } else {
    return null
  }
  if (!neg && opts.allowKeywords?.includes(rest)) return rest
  if (!TAIL_RE.test(rest)) return null
  return neg ? `-${rest}` : rest
}

/** display text for the value of `prefix` in a token, '' if none/negative-disallowed */
export function classToText(
  prefix: string,
  token: string | null | undefined,
  opts: { allowNegative?: boolean; allowKeywords?: readonly string[] } = {},
): string {
  if (!token) return ''
  const tail = parseTail(token, prefix, opts)
  if (tail === null) return ''
  if (tail.startsWith('-') && !opts.allowNegative) return ''
  return tailToText(tail)
}

/** build a class token from typed text; `null` = unset, `false` = invalid */
export function textToClass(
  prefix: string,
  text: string,
  opts: { allowNegative?: boolean; allowKeywords?: readonly string[] } = {},
): string | null | false {
  const tail = textToTail(text, opts)
  if (tail === null) return null
  if (tail === false) return false
  return buildTailClass(prefix, tail)
}

// --- size values (width/height): number scale, arbitrary units, plus keywords
// and fractions a slider can't express (full, screen, auto, 1/2, 2xl, …) ---

/** build a size class from typed text; `null` = unset, `false` = invalid */
export function sizeTextToClass(prefix: string, text: string): string | null | false {
  const t = text.trim()
  if (t === '') return null
  if (/\s/.test(t)) return false
  if (NUM_RE.test(t)) return `${prefix}-${t}` // scale number → w-64
  if (UNIT_RE.test(t)) return `${prefix}-[${t}]` // accepted unit → w-[300px]
  if (/^\[.+\]$/.test(t)) return `${prefix}-${t}` // already arbitrary → w-[…]
  if (/^[\w./%-]+$/.test(t)) return `${prefix}-${t}` // keyword / fraction → w-full, w-1/2
  return false
}

/** the size value text for a token, '' if none (`w-[300px]`→'300px', `w-full`→'full') */
export function sizeClassToText(prefix: string, token: string | null | undefined): string {
  if (!token || !token.startsWith(`${prefix}-`)) return ''
  const rest = token.slice(prefix.length + 1)
  return rest.startsWith('[') && rest.endsWith(']') ? rest.slice(1, -1) : rest
}

/** whether typed text is an acceptable size value (empty counts as valid/unset) */
export function isSizeValue(text: string): boolean {
  return sizeTextToClass('_', text) !== false
}

// --- named-scale sliders (font-size, weight, line-height, letter-spacing):
// keyword typing writes the named class (bold → font-bold); numeric/unit typing
// writes an arbitrary value, guarded per property so e.g. text-[18px] (size) is
// distinguished from text-[#fff] (color). ---

export type NamedFormat = 'length' | 'line-height' | 'tracking' | 'weight'

const LEN_RE = /^\d*\.?\d+(?:px|rem|em|%)$/
const TRACK_RE = /^-?\d*\.?\d+(?:em|rem|px)$/
const WEIGHT_RE = /^(?:[1-9]\d{0,2}|1000)$/

/** whether free-form text is a valid arbitrary value for a named-scale format */
export function matchesNamedFormat(format: NamedFormat, text: string): boolean {
  switch (format) {
    case 'length':
      return LEN_RE.test(text)
    case 'line-height':
      return /^\d*\.?\d+$/.test(text) || LEN_RE.test(text) // unitless (1.5) or length
    case 'tracking':
      return TRACK_RE.test(text) // negative allowed, inside the bracket
    case 'weight':
      return WEIGHT_RE.test(text)
  }
}

/** build a named-scale class: keyword → `prefix-kw`, else arbitrary `prefix-[v]` */
export function namedTextToClass(
  prefix: string,
  format: NamedFormat,
  known: string[],
  text: string,
): string | null | false {
  const t = text.trim()
  if (t === '') return null
  if (known.includes(`${prefix}-${t}`)) return `${prefix}-${t}` // keyword
  if (matchesNamedFormat(format, t)) return `${prefix}-[${t}]` // arbitrary
  return false
}

/** whether a token is a value for this named-scale prop (known class or in-format arbitrary) */
export function isNamedValueClass(
  prefix: string,
  format: NamedFormat,
  known: string[],
  token: string,
): boolean {
  if (known.includes(token)) return true
  if (!token.startsWith(`${prefix}-`)) return false
  return matchesNamedFormat(format, sizeClassToText(prefix, token))
}

const roundVal = (n: number) => Math.round(n * 1000) / 1000

/**
 * Nudge a typed value for keyboard ↑/↓. Bare numbers walk `steps` when given
 * (else ±1, ±0.1 for fractional); unit-bearing values (`12px`) step the number
 * and keep the unit; keywords / fractions are left alone (returns null).
 * `bigger` (Shift) takes a larger jump.
 */
export function arrowStepText(
  text: string,
  dir: 1 | -1,
  opts: { steps?: string[]; bigger?: boolean; allowNegative?: boolean } = {},
): string | null {
  const cur = text.trim()
  const big = opts.bigger
  // number + unit → step the number, keep the unit
  const unitM = cur.match(/^(-?)(\d*\.?\d+)([a-z%]+)$/i)
  if (unitM) {
    const val = (unitM[1] === '-' ? -1 : 1) * parseFloat(unitM[2]!)
    let n = val + dir * (big ? 10 : 1)
    if (!opts.allowNegative && n < 0) n = 0
    return `${roundVal(n)}${unitM[3]}`
  }
  // bare number → scale step (if a scale is given) or plain ±step
  if (cur === '' || /^-?\d*\.?\d+$/.test(cur)) {
    if (opts.steps?.length) {
      const idx = nearestStepIndex(opts.steps, cur === '' ? '0' : cur)
      let next = idx === -1 ? 0 : idx + dir * (big ? 4 : 1)
      next = Math.max(0, Math.min(opts.steps.length - 1, next))
      return opts.steps[next]!
    }
    const base = cur === '' ? 0 : parseFloat(cur)
    const inc = big ? 10 : cur.includes('.') ? 0.1 : 1
    let n = base + dir * inc
    if (!opts.allowNegative && n < 0) n = 0
    return `${roundVal(n)}`
  }
  return null // fractions (1/2), keywords (auto, full), unknown
}

/** nearest scale index for a slider/stepper thumb given free-form text; -1 if none */
export function nearestStepIndex(steps: string[], text: string): number {
  const n = parseFloat(text)
  if (Number.isNaN(n)) return -1
  const target = Math.abs(n)
  let best = 0
  let bestD = Infinity
  steps.forEach((s, i) => {
    const d = Math.abs(parseFloat(s) - target)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

/**
 * Derive a numeric class prefix from an explicit-class slider's class list
 * (e.g. `['grid-cols-1', …]` → `'grid-cols'`, signed `['-rotate-1', …]` →
 * `'rotate'`). Returns null when the varying tail isn't numeric (named classes
 * like `tracking-tight`), meaning custom input doesn't apply.
 */
export function derivePrefix(classes: string[]): string | null {
  if (!classes.length) return null
  const parts = classes.map((c) => {
    const stripped = c.replace(/^-/, '')
    const i = stripped.lastIndexOf('-')
    return i === -1 ? null : ([stripped.slice(0, i), stripped.slice(i + 1)] as const)
  })
  if (parts.some((p) => p === null)) return null
  const pre = parts[0]![0]
  if (!parts.every((p) => p![0] === pre)) return null
  if (!parts.every((p) => /^\d+(?:\.\d+)?$/.test(p![1]))) return null
  return pre
}
