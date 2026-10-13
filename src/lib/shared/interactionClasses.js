const KEYWORD_PROPERTY = new Map(
  Object.entries({
    display:
      'block inline-block inline flex inline-flex grid inline-grid table contents flow-root hidden',
    visibility: 'visible invisible collapse',
    position: 'static relative absolute fixed sticky',
    overflow: 'overflow-auto overflow-hidden overflow-clip overflow-visible overflow-scroll',
    'overflow-x':
      'overflow-x-auto overflow-x-hidden overflow-x-clip overflow-x-visible overflow-x-scroll',
    'overflow-y':
      'overflow-y-auto overflow-y-hidden overflow-y-clip overflow-y-visible overflow-y-scroll',
    'flex-direction': 'flex-row flex-row-reverse flex-col flex-col-reverse',
    'flex-wrap': 'flex-wrap flex-wrap-reverse flex-nowrap',
    'align-items': 'items-start items-end items-center items-baseline items-stretch',
    'justify-content':
      'justify-normal justify-start justify-end justify-center justify-between justify-around justify-evenly justify-stretch',
    'text-align': 'text-left text-center text-right text-justify text-start text-end',
    'font-style': 'italic not-italic',
    'text-transform': 'uppercase lowercase capitalize normal-case',
    'text-decoration-line': 'underline overline line-through no-underline',
    'white-space':
      'whitespace-normal whitespace-nowrap whitespace-pre whitespace-pre-line whitespace-pre-wrap whitespace-break-spaces',
  }).flatMap(([prop, list]) => list.split(' ').map((cls) => [cls, prop])),
)

const BG_NON_COLOR_RE =
  /^bg-(?:auto$|cover$|contain$|center$|top|bottom|left|right|repeat|no-repeat|fixed$|local$|scroll$|clip-|origin-|gradient-|linear-|radial-|conic-|none$|blend-|size-|position-)/
const TEXT_NON_COLOR_RE =
  /^text-(?:xs|sm|base|lg|xl|[2-9]xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/
const BORDER_NON_COLOR_RE =
  /^border(?:-(?:[xytblrse]|solid|dashed|dotted|double|hidden|none|\d+))?(?:-\d+)?$/
const ARBITRARY_COLOR_RE = /^\[(?:#|rgb|hsl|oklch|oklab|color\(|var\()/

function colorHead(base) {
  for (const family of ['bg', 'text', 'border']) {
    if (!base.startsWith(`${family}-`)) continue
    const nonColor =
      family === 'bg' ? BG_NON_COLOR_RE : family === 'text' ? TEXT_NON_COLOR_RE : BORDER_NON_COLOR_RE
    if (nonColor.test(base)) return null
    const value = base.slice(family.length + 1)
    if (value.startsWith('[') && !ARBITRARY_COLOR_RE.test(value)) return null
    return `${family}:color`
  }
  return null
}

const VALUE_TAIL = /^(\d+(\.\d+)?|\[.*\]|\d+\/\d+|px|full|none|auto|0|screen|fit|min|max)$/

/**
 * `[color-scheme:dark]` or `[--bg:#08090b]` — an arbitrary property, whose
 * conflict group is its PROPERTY NAME. Two of them with the same name replace
 * each other, which is the rule `styles.ts` (`propKey`) applies when the Style
 * panel writes a class, and therefore the rule an interaction has to apply
 * when it evicts a base class.
 */
const ARBITRARY_PROPERTY_RE = /^\[(--[a-z0-9-]+|[a-z][a-z-]*):[^{};]+\]$/

/** `scheme-dark`, `scheme-light-dark`, … — all one property */
const SCHEME_RE = /^scheme-(?:normal|light|dark|light-dark|only-dark|only-light)$/

/**
 * The variant prefix and the bare utility. The split is on the last colon at
 * bracket DEPTH 0: `lastIndexOf(':')` split `[color-scheme:light]` into the
 * variant `[color-scheme:` and the base `light]`, so two arbitrary properties
 * with the same name compared as different utilities under the same (nonsense)
 * variant — an interaction toggling `[color-scheme:dark]` left the base
 * `[color-scheme:light]` in the class list, the stylesheet resolved them by
 * source order, and the published toggle did nothing while every tool
 * reported success.
 */
function splitVariant(cls) {
  let depth = 0
  let at = -1
  for (let i = 0; i < cls.length; i++) {
    const ch = cls[i]
    if (ch === '[' || ch === '(') depth++
    else if (ch === ']' || ch === ')') depth--
    else if (ch === ':' && depth === 0) at = i
  }
  return at === -1 ? ['', cls] : [cls.slice(0, at + 1), cls.slice(at + 1)]
}

function headOf(base) {
  const arbitrary = ARBITRARY_PROPERTY_RE.exec(base)
  if (arbitrary) return `arbitrary:${arbitrary[1]}`
  if (SCHEME_RE.test(base)) return 'color-scheme'
  if (base === 'dark' || base === 'light') return 'color-mode'
  const color = colorHead(base)
  if (color) return color
  const keyword = KEYWORD_PROPERTY.get(base)
  if (keyword) return keyword
  if (base === 'transition' || base.startsWith('transition-')) return 'transition'
  if (base.startsWith('ease-')) return 'ease'
  const at = base.lastIndexOf('-')
  const head = at > 0 && VALUE_TAIL.test(base.slice(at + 1)) ? base.slice(0, at) : base
  return head.startsWith('-') ? head.slice(1) : head
}

export function interactionConflict(a, b) {
  if (a === b) return false
  const [va, ba] = splitVariant(a)
  const [vb, bb] = splitVariant(b)
  return va === vb && headOf(ba) === headOf(bb)
}

export function conflictingBaseClasses(baseTokens, firedClasses) {
  const fired = String(firedClasses ?? '').split(/\s+/).filter(Boolean)
  return baseTokens.filter((t) => fired.some((f) => interactionConflict(t, f)))
}
