// SPDX-License-Identifier: MIT — see LICENSE-EXCEPTIONS.md (embedded in exported sites; deliberately not AGPL)
// Base-vs-fired class conflict resolution for interactions, shared by the
// static exporter (which bakes an int-fxrm removal map for the site runtime)
// and the editor canvas (useRenderNode), so both surfaces toggle identically.
//
// Problem: an interaction recomputes a target's classes as base + toClasses.
// When both sets style the same property (hidden + flex, opacity-0 +
// opacity-100), the CASCADE decides the winner — and Tailwind's output order
// is arbitrary from the author's perspective (`.hidden` compiles after
// `.flex`, so a hidden→flex menu toggle silently never opens). The fix:
// while an interaction is fired, base classes that conflict with its
// toClasses are REMOVED instead of outweighed.
//
// Conflict detection is heuristic (the full style catalog is TS and can't
// ship in the 2.5 KB runtime): same variant prefix AND (both in the display
// group, or same property head — the class minus its trailing value
// segment). False negatives just fall back to today's cascade behavior.

// KEYWORD FAMILIES: the utilities whose value is a bare keyword rather than a
// `head-value` pair, so the head heuristic below cannot see that two of them
// style the same property. Each entry maps the whole base class to the ONE CSS
// property it sets.
//
// This is the shape of E6: an interaction firing `fixed` sat beside a base
// `sticky` and lost by stylesheet order, because `fixed` and `sticky` read as
// two unrelated heads. The same was true of `flex-col` vs `flex-row`,
// `items-center` vs `items-start`, `overflow-hidden` vs `overflow-auto` and
// `text-center` vs `text-left` — every one of them a toggle an author would
// expect to work.
//
// Deliberately NOT here: anything whose two values are different CSS
// properties (`overflow-x-*` vs `overflow-y-*`, `font-sans` vs `font-bold`,
// `inset-x-0` vs `left-0`). A false group is worse than a false negative: it
// REMOVES a base class that was styling something else.
const KEYWORD_PROPERTY = new Map(
  Object.entries({
    // display. Visibility is deliberately separate: grouping them would make
    // `invisible` evict `flex` and silently change the layout it was meant to
    // keep. It needs a group of its own all the same — `visible` did not evict
    // a base `invisible`, so an overlay built the animatable way (base
    // `invisible opacity-0`, fired `visible opacity-100`) came down to which
    // rule Tailwind happened to emit last. That is the recipe for any overlay
    // that fades or slides, since `hidden` → `block` cannot transition.
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

// Color-bearing families: any bg-/text-/border- value that is not one of the
// known non-color utilities is a color (palette shade, project token, or
// arbitrary), and every color in a family styles the SAME property — so
// `text-ink` must evict `text-cream` exactly like `bg-ink` evicts `bg-cream`.
// The head-of heuristic below can't see this: token-named colors have no
// value-shaped tail, so `text-cream` and `text-ink` read as unrelated heads.
const BG_NON_COLOR_RE =
  /^bg-(?:auto$|cover$|contain$|center$|top|bottom|left|right|repeat|no-repeat|fixed$|local$|scroll$|clip-|origin-|gradient-|linear-|radial-|conic-|none$|blend-|size-|position-)/
const TEXT_NON_COLOR_RE =
  /^text-(?:xs|sm|base|lg|xl|[2-9]xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/
const BORDER_NON_COLOR_RE =
  /^border(?:-(?:[xytblrse]|solid|dashed|dotted|double|hidden|none|\d+))?(?:-\d+)?$/
// arbitrary values on these families split on VALUE shape: text-[#fff] is a
// color, text-[14px] is a size; an arbitrary bg holding `url()` is an image,
// bg-[#fff] a color
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

// a trailing segment that reads as a value: number (56, 1.5), arbitrary
// ([2rem]), fraction (1/2), or a scale keyword
const VALUE_TAIL = /^(\d+(\.\d+)?|\[.*\]|\d+\/\d+|px|full|none|auto|0|screen|fit|min|max)$/

/** variant prefix ('md:hover:') and base ('flex') of a class */
function splitVariant(cls) {
  const i = cls.lastIndexOf(':')
  return i === -1 ? ['', cls] : [cls.slice(0, i + 1), cls.slice(i + 1)]
}

/** the property head a class styles: 'opacity-50' → 'opacity',
 * 'max-h-[24rem]' → 'max-h', '-translate-y-6' → '-translate-y',
 * display keywords → 'display', everything else → itself */
function headOf(base) {
  const color = colorHead(base)
  if (color) return color
  const keyword = KEYWORD_PROPERTY.get(base)
  if (keyword) return keyword
  // the transition setup is one property each: `transition-transform` and the
  // appended `transition-all` style the same transition-property, and every
  // ease-* keyword is one timing-function — without grouping these, an
  // interaction's own `transition-all duration ease` DUPLICATED next to the
  // element's authored setup and the cascade picked arbitrarily (run #6, B7)
  if (base === 'transition' || base.startsWith('transition-')) return 'transition'
  if (base.startsWith('ease-')) return 'ease'
  const at = base.lastIndexOf('-')
  const head = at > 0 && VALUE_TAIL.test(base.slice(at + 1)) ? base.slice(0, at) : base
  // signed utilities style the SAME property as their unsigned form —
  // '-rotate-135' must evict a base 'rotate-45' (and -translate-y-6 a
  // translate-y-2); keeping the sign in the head made them read as unrelated,
  // so the cascade picked the winner by stylesheet order (run #6, B1)
  return head.startsWith('-') ? head.slice(1) : head
}

/** true when two full class tokens style the same property at the same variant */
export function interactionConflict(a, b) {
  if (a === b) return false
  const [va, ba] = splitVariant(a)
  const [vb, bb] = splitVariant(b)
  return va === vb && headOf(ba) === headOf(bb)
}

/** the base tokens that must be removed while `firedClasses` applies */
export function conflictingBaseClasses(baseTokens, firedClasses) {
  const fired = String(firedClasses ?? '').split(/\s+/).filter(Boolean)
  return baseTokens.filter((t) => fired.some((f) => interactionConflict(t, f)))
}
