export const ACCEPTED_UNITS = ['px', 'rem', 'em', '%', 'ch', 'ex', 'fr'] as const

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const UNIT_RE = new RegExp(`^\\d*\\.?\\d+(?:${ACCEPTED_UNITS.map(esc).join('|')})$`)
const NUM_RE = /^\d+(?:\.\d+)?$/
const TAIL_RE = /^(?:\[.+\]|\d+(?:\.\d+)?)$/

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

export function buildTailClass(prefix: string, tail: string): string {
  if (tail.startsWith('-')) return `-${prefix}-${tail.slice(1)}`
  return `${prefix}-${tail}`
}

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

export function sizeTextToClass(prefix: string, text: string): string | null | false {
  const t = text.trim()
  if (t === '') return null
  if (/\s/.test(t)) return false
  if (NUM_RE.test(t)) return `${prefix}-${t}`
  if (UNIT_RE.test(t)) return `${prefix}-[${t}]`
  if (/^\[.+\]$/.test(t)) return `${prefix}-${t}`
  if (/^[\w./%-]+$/.test(t)) return `${prefix}-${t}`
  return false
}

export function sizeClassToText(prefix: string, token: string | null | undefined): string {
  if (!token || !token.startsWith(`${prefix}-`)) return ''
  const rest = token.slice(prefix.length + 1)
  return rest.startsWith('[') && rest.endsWith(']') ? rest.slice(1, -1) : rest
}

export function isSizeValue(text: string): boolean {
  return sizeTextToClass('_', text) !== false
}

export type NamedFormat = 'length' | 'line-height' | 'tracking' | 'weight'

const LEN_RE = /^\d*\.?\d+(?:px|rem|em|%)$/
const TRACK_RE = /^-?\d*\.?\d+(?:em|rem|px)$/
const WEIGHT_RE = /^(?:[1-9]\d{0,2}|1000)$/

export function matchesNamedFormat(format: NamedFormat, text: string): boolean {
  switch (format) {
    case 'length':
      return LEN_RE.test(text)
    case 'line-height':
      return /^\d*\.?\d+$/.test(text) || LEN_RE.test(text)
    case 'tracking':
      return TRACK_RE.test(text)
    case 'weight':
      return WEIGHT_RE.test(text)
  }
}

export function namedTextToClass(
  prefix: string,
  format: NamedFormat,
  known: string[],
  text: string,
): string | null | false {
  const t = text.trim()
  if (t === '') return null
  if (known.includes(`${prefix}-${t}`)) return `${prefix}-${t}`
  if (matchesNamedFormat(format, t)) return `${prefix}-[${t}]`
  return false
}

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

export function arrowStepText(
  text: string,
  dir: 1 | -1,
  opts: { steps?: string[]; bigger?: boolean; allowNegative?: boolean } = {},
): string | null {
  const cur = text.trim()
  const big = opts.bigger
  const unitM = cur.match(/^(-?)(\d*\.?\d+)([a-z%]+)$/i)
  if (unitM) {
    const val = (unitM[1] === '-' ? -1 : 1) * parseFloat(unitM[2]!)
    let n = val + dir * (big ? 10 : 1)
    if (!opts.allowNegative && n < 0) n = 0
    return `${roundVal(n)}${unitM[3]}`
  }
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
  return null
}

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
