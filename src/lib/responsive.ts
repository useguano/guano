import { sameProperty } from './styles'

export function breakpointVariant(width: number): string {
  return `max-[${width}px]:`
}

export function breakpointMinVariant(width: number): string {
  return `min-[${width}px]:`
}

const NAMED_SCREENS: Record<string, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
}
const NAMED_ALT = Object.keys(NAMED_SCREENS)
  .sort((a, b) => b.length - a.length)
  .join('|')
const NAMED_TOKEN_RE = new RegExp(`^(max-)?(${NAMED_ALT}):(.+)$`)

export function isBreakpointToken(token: string): boolean {
  if (/^(?:min|max)-\[[0-9.]+(?:px|rem|em)\]:/.test(token)) return true
  const m = token.match(NAMED_TOKEN_RE)
  return m !== null && m[2]! in NAMED_SCREENS
}

export function breakpointIdForWidth(
  breakpoints: { id: string; width: number }[],
  width: number,
): string | null {
  if (!breakpoints.length) return null
  const asc = [...breakpoints].sort((a, b) => a.width - b.width)
  return (asc.find((b) => width <= b.width) ?? asc[asc.length - 1]!).id
}

const UNIT_PX: Record<string, number> = { px: 1, rem: 16, em: 16 }

function parseBreakpointToken(
  token: string,
): { px: number; bound: 'min' | 'max'; bare: string } | null {
  const m = token.match(/^(min|max)-\[([0-9.]+)(px|rem|em)\]:(.+)$/)
  if (m) return { bound: m[1] as 'min' | 'max', px: parseFloat(m[2]!) * UNIT_PX[m[3]!]!, bare: m[4]! }
  const n = token.match(NAMED_TOKEN_RE)
  if (n && n[2]! in NAMED_SCREENS) {
    const threshold = NAMED_SCREENS[n[2]!]!
    return n[1]
      ? { bound: 'max', px: threshold - 0.02, bare: n[3]! }
      : { bound: 'min', px: threshold, bare: n[3]! }
  }
  return null
}

function tokenParts(token: string): { variant: string; base: string } {
  const i = token.lastIndexOf(':')
  return i === -1 ? { variant: '', base: token } : { variant: token.slice(0, i + 1), base: token.slice(i + 1) }
}

interface Entry {
  token: string
  own: boolean
}

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

function cascadeEntries(all: string[], width: number): Entry[] {
  let entries: Entry[] = all.filter((t) => !isBreakpointToken(t)).map((token) => ({ token, own: false }))
  const overrides = all
    .map(parseBreakpointToken)
    .filter((o): o is NonNullable<typeof o> => o !== null)
    .filter((o) => (o.bound === 'max' ? width <= o.px : width >= o.px))
    .sort((a, b) => (a.bound === 'max' ? b.px - a.px : a.px - b.px))
  for (const o of overrides) {
    entries = replaceOrAppendEntry(entries, { token: o.bare, own: o.bound === 'max' && o.px === width })
  }
  return entries
}

export function resolveClassesForWidth(classString: string, width: number): string {
  return cascadeEntries(classString.split(/\s+/).filter(Boolean), width)
    .map((e) => e.token)
    .join(' ')
}

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

export function applyBreakpointEdit(
  all: string[],
  activeWidth: number | null,
  next: string[],
  baseWidth: number,
): string[] {
  if (activeWidth === null) {
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
  const inherited = breakpointView([...base, ...others], activeWidth, baseWidth).tokens
  const ownOverrides = next.filter((t) => !inherited.includes(t)).map((t) => variant + t)
  return [...base, ...others, ...ownOverrides]
}

export function removeInheritedToken(
  all: string[],
  cls: string,
  keepAboveWidth: number,
): string[] | null {
  if (isBreakpointToken(cls) || !all.includes(cls)) return null
  return [...all.filter((t) => t !== cls), breakpointMinVariant(keepAboveWidth) + cls]
}
