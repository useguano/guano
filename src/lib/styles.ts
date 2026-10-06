import { TAILWIND_COLORS, TAILWIND_SHADES, isPaletteColor } from './colors'
import { SPACING, borderWidthScheme, type Slot } from './tieredBox'
import { derivePrefix, parseTail, isNamedValueClass, type NamedFormat } from './valueClass'
import { STYLE_SECTIONS } from './styleCatalog'

export type Control =
  | { kind: 'select'; options: { label: string; class: string }[] }
  | { kind: 'color'; prefix: string }
  // a slider is either `prefix`+`stops` (class = `prefix-stop`) or an explicit
  // `classes` list with matching `labels` (for bare/named/signed classes)
  | {
      kind: 'slider'
      prefix?: string
      stops?: string[]
      classes?: string[]
      labels?: string[]
      /** named-scale sliders whose value field maps keywords + arbitrary values */
      custom?: { prefix: string; format: NamedFormat }
    }
  | { kind: 'input'; prefix: string; placeholder?: string }
  // `icon` is a lucide icon *name* (e.g. 'AlignCenter'); the UI resolves it to a
  // component via STYLE_ICONS (styleCatalogIcons.ts). Kept as a string so the
  // catalog stays node-safe for the MCP runtime bundle.
  | { kind: 'icons'; options: { label: string; class: string; icon: string }[] }

type Slider = Extract<Control, { kind: 'slider' }>

/** the ordered tailwind classes a slider steps through */
export function sliderClasses(c: Slider): string[] {
  return c.classes ?? c.stops!.map((s) => `${c.prefix}-${s}`)
}
/** the readout label shown for each slider stop */
export function sliderLabels(c: Slider): string[] {
  return c.labels ?? c.stops ?? c.classes ?? []
}

/** the class prefix a slider's custom-value input writes to, or null if none */
export function sliderPrefix(c: Slider): string | null {
  return c.custom?.prefix ?? c.prefix ?? (c.classes ? derivePrefix(c.classes) : null)
}

/** signed sliders (classes include a `-`-prefixed one) accept negative input */
export function sliderAllowNegative(c: Slider): boolean {
  return !!c.classes?.some((cls) => cls.startsWith('-'))
}

export interface StyleProperty {
  id: string
  label: string
  control: Control
  /** only meaningful on flex/grid parents — adding it auto-adds a display class */
  needsDisplay?: boolean
  /** overrides the class applied when the property is first added */
  default?: string
  /** when absent the property is always shown; otherwise gated on context */
  relevance?: Relevance
}

export interface StyleSection {
  id: string
  label: string
  properties: StyleProperty[]
}

// --- relevance: which properties are worth showing for the current element ---

export type Relevance =
  | { when: 'positioned' } // position ∈ relative/absolute/fixed/sticky
  | { when: 'display'; values: string[] } // the element's own display class
  | { when: 'parentDisplay'; values: string[] } // the parent element's display class
  | { when: 'transition' } // a transition (≠ none) is set
  | { when: 'mediaElement' } // element is an image/video
  | { when: 'mediaOrBackground' } // media element, or any element with a background

export interface RelevanceContext {
  /** the element's own display class token, e.g. 'flex' */
  display?: string
  /** the element's position class token, e.g. 'absolute' */
  position?: string
  /** the parent element's display class token */
  parentDisplay?: string
  /** a transition class other than transition-none is set */
  hasTransition?: boolean
  /** the selected element renders media (img/video) */
  isMedia?: boolean
  /** the element has a background media set */
  hasBackground?: boolean
}

const POSITIONED = ['relative', 'absolute', 'fixed', 'sticky']

export function isPropertyRelevant(prop: StyleProperty, ctx: RelevanceContext): boolean {
  const r = prop.relevance
  if (!r) return true
  switch (r.when) {
    case 'positioned':
      return POSITIONED.includes(ctx.position ?? '')
    case 'display':
      return r.values.includes(ctx.display ?? '')
    case 'parentDisplay':
      return r.values.includes(ctx.parentDisplay ?? '')
    case 'transition':
      return !!ctx.hasTransition
    case 'mediaElement':
      return !!ctx.isMedia
    case 'mediaOrBackground':
      return !!ctx.isMedia || !!ctx.hasBackground
  }
}


// --- class suggestions ---

/** state/breakpoint prefixes the class input understands (typed as `hover:`) */
const VARIANTS = [
  'hover',
  'focus',
  'focus-visible',
  'focus-within',
  'active',
  'visited',
  'disabled',
  'checked',
  'required',
  'invalid',
  'group-hover',
  'group-focus',
  'peer-hover',
  'peer-focus',
  'peer-checked',
  'first',
  'last',
  'only',
  'odd',
  'even',
  'empty',
  'first-of-type',
  'last-of-type',
  // pseudo-ELEMENTS: decorative bullets/arrows, selection colours and input
  // placeholders were all unreachable without these — every one of them had to
  // be faked with literal characters or dropped entirely
  'before',
  'after',
  'marker',
  'selection',
  'placeholder',
  'first-line',
  'first-letter',
  'file',
  'backdrop',
  'sm',
  'md',
  'lg',
  'xl',
  '2xl',
  'dark',
  'print',
  'motion-safe',
  'motion-reduce',
  'rtl',
  'ltr',
  // project-defined (see shared/prose.js CUSTOM_VARIANTS): the link pointing at
  // the page being rendered
  'current',
  'group-current',
]

function buildVocabulary(): string[] {
  const out = new Set<string>()
  // everything the visual controls know is suggestible
  for (const section of STYLE_SECTIONS) {
    for (const prop of section.properties) {
      const control = prop.control
      if (control.kind === 'select') control.options.forEach((o) => out.add(o.class))
      if (control.kind === 'icons') control.options.forEach((o) => out.add(o.class))
      if (control.kind === 'slider') sliderClasses(control).forEach((c) => out.add(c))
    }
  }
  const spacing = ['p', 'px', 'py', 'pt', 'pb', 'pl', 'pr', 'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr', 'gap', 'gap-x', 'gap-y']
  // the validator accepts the in-between steps too ('5', '14') — the visual
  // stepper keeps the coarse SPACING scale, but rejecting px-5 as a typed
  // class was pure friction
  const SPACING_VALID = [...SPACING, '5', '14', '28', '32']
  for (const prefix of spacing) for (const stop of SPACING_VALID) out.add(`${prefix}-${stop}`)
  // width/height sizing runs far past the spacing scale (h-56 hero bands …)
  const SIZE_STOPS = ['0', '1', '2', '3', '4', '5', '6', '8', '10', '12', '14', '16', '20', '24', '28', '32', '36', '40', '44', '48', '52', '56', '60', '64', '72', '80', '96']
  for (const prefix of ['w', 'h', 'size']) for (const stop of SIZE_STOPS) out.add(`${prefix}-${stop}`)
  // signed translate utilities across the full size scale — the slider catalog
  // only covers ±1…8, which made `-translate-x-24` a surprise rejection
  for (const prefix of ['translate-x', 'translate-y']) {
    for (const stop of SIZE_STOPS) {
      out.add(`${prefix}-${stop}`)
      if (stop !== '0') out.add(`-${prefix}-${stop}`)
    }
    for (const frac of ['full', '1/2']) {
      out.add(`${prefix}-${frac}`)
      out.add(`-${prefix}-${frac}`)
    }
  }
  // negative offsets and margins (-bottom-6, -mt-4 …) — signed transform
  // utilities already validate via the slider catalog; these did not
  for (const prefix of ['top', 'right', 'bottom', 'left', 'inset', 'inset-x', 'inset-y', 'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr']) {
    for (const stop of SPACING) if (stop !== '0') out.add(`-${prefix}-${stop}`)
  }
  // `auto` is valid CSS only where margins and offsets collapse to it
  for (const prefix of ['m', 'mx', 'my', 'mt', 'mb', 'ml', 'mr']) out.add(`${prefix}-auto`)
  for (const prefix of ['inset', 'inset-x', 'inset-y', 'top', 'right', 'bottom', 'left']) out.add(`${prefix}-auto`)
  // offset KEYWORDS and fractions (`top-full`, `-left-1/2`, `inset-x-1/2` …).
  // The spacing scale above covers the numeric stops, and the size controls
  // offer `full`/fractions for w/h — but an offset only had numbers, so
  // `top-full`, which is how a dropdown is parked under its trigger, came back
  // "not a known class" and had to be written `top-[100%]`.
  for (const prefix of ['top', 'right', 'bottom', 'left', 'inset', 'inset-x', 'inset-y']) {
    for (const value of ['full', '1/2', '1/3', '2/3', '1/4', '3/4']) {
      out.add(`${prefix}-${value}`)
      out.add(`-${prefix}-${value}`)
    }
  }
  // multi-line truncation. `truncate` (one line) was the only clamp available,
  // so every list preview that wanted two lines got one.
  for (const n of ['1', '2', '3', '4', '5', '6', 'none']) out.add(`line-clamp-${n}`)
  // border-width classes (bare `border`, `border-2`, `border-x`, `border-t`, …)
  // now that they're driven by SpacingBoxControl, not a slider property
  for (const s of ['all', 'x', 'y', 't', 'r', 'b', 'l'] as Slot[]) {
    const prefix = borderWidthScheme.slot('border', s)
    for (const step of borderWidthScheme.steps) out.add(borderWidthScheme.className(prefix, step))
  }
  for (const prefix of ['bg', 'text', 'border', 'outline', 'ring', 'accent', 'decoration', 'divide']) {
    for (const color of Object.keys(TAILWIND_COLORS)) {
      for (const shade of TAILWIND_SHADES) out.add(`${prefix}-${color}-${shade}`)
    }
  }
  // divide utilities (borders between children) — refused while the arbitrary
  // [&>*]:border-b equivalent passed, which read as a vocabulary hole
  for (const axis of ['x', 'y']) {
    out.add(`divide-${axis}`)
    out.add(`divide-${axis}-reverse`)
    for (const w of ['0', '2', '4', '8']) out.add(`divide-${axis}-${w}`)
  }
  for (const kw of ['solid', 'dashed', 'dotted', 'double', 'none', 'white', 'black', 'transparent', 'current']) {
    out.add(`divide-${kw}`)
  }
  // focus styling (outline/ring) and form accents — everyday a11y utilities the
  // catalog never listed, which left focus-visible: with no valid target
  for (const w of ['0', '1', '2', '4', '8']) {
    out.add(`outline-${w}`)
    out.add(`outline-offset-${w}`)
    out.add(`ring-${w}`)
    out.add(`ring-offset-${w}`)
  }
  const focusExtras = [
    'outline', 'outline-hidden', 'outline-dashed', 'outline-dotted', 'outline-double', 'outline-solid',
    'ring', 'ring-inset',
    'outline-white', 'outline-black', 'outline-transparent', 'outline-current',
    'ring-white', 'ring-black', 'ring-transparent', 'ring-current',
    'accent-auto', 'accent-white', 'accent-black', 'accent-current',
    // the standard visually-hidden label pattern
    'sr-only', 'not-sr-only',
  ]
  focusExtras.forEach((c) => out.add(c))
  const common = [
    'bg-white', 'bg-black', 'bg-transparent', 'text-white', 'text-black',
    // the non-palette colour keywords on `border-` too: the full palette was
    // already generated below, but `border-white` / `border-black` were not,
    // which read as an arbitrary exclusion next to `bg-white` / `text-white`
    'border-white', 'border-black', 'border-transparent', 'border-current',
    'text-transparent', 'text-current', 'bg-current',
    'relative', 'absolute', 'fixed', 'sticky',
    'flex-wrap', 'flex-1', 'shrink-0', 'grow',
    'w-full', 'w-auto', 'w-screen', 'w-fit', 'h-full', 'h-auto', 'h-screen', 'h-fit',
    'min-h-screen', 'max-w-sm', 'max-w-md', 'max-w-lg', 'max-w-xl', 'max-w-2xl', 'max-w-4xl', 'max-w-6xl', 'mx-auto',
    'italic', 'underline', 'uppercase', 'lowercase', 'capitalize', 'truncate',
    'leading-tight', 'leading-normal', 'leading-relaxed', 'tracking-tight', 'tracking-wide',
    'rounded', 'shadow', 'shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl',
    'opacity-0', 'opacity-50', 'opacity-75', 'opacity-100',
    'overflow-hidden', 'overflow-auto', 'overflow-x-auto', 'overflow-y-auto',
    'overflow-x-hidden', 'overflow-y-hidden', 'overflow-x-scroll', 'overflow-y-scroll',
    'overflow-clip', 'overflow-x-clip', 'overflow-y-clip',
    'transition-all', 'transition-colors', 'duration-150', 'duration-300', 'duration-500',
    'ease-in', 'ease-out', 'ease-in-out',
    'cursor-pointer', 'select-none', 'pointer-events-none',
    'z-0', 'z-10', 'z-20', 'z-50',
    'grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4', 'grid-cols-6', 'grid-cols-12',
    'object-cover', 'object-contain', 'aspect-square', 'aspect-video',
    'antialiased', 'col-span-full', 'col-auto', 'row-span-full',
    'inline', 'inline-block', 'inline-flex', 'inline-grid', 'outline-none',
    // the two display values the conflict group already knew (DISPLAY_CLASSES)
    // and the validator refused. `contents` is how a wrapper takes part in the
    // tree — holding a click binding, say — without adding a box
    'contents', 'flow-root',
    'whitespace-normal', 'whitespace-nowrap', 'whitespace-pre', 'whitespace-pre-line',
    'whitespace-pre-wrap', 'break-words', 'break-all',
    // `group` marks a hover scope — without it every documented group-hover:
    // variant was dead on arrival. `peer` is the sibling equivalent, and the
    // only way to style a label from its own checkbox's checked state
    'group', 'peer', 'h-px', 'w-px', 'inset-0', 'inset-x-0', 'inset-y-0',
    // form-control resets: a switch or a styled checkbox has to drop the
    // native control's own chrome before it can look like anything
    'appearance-none', 'appearance-auto',
    'resize', 'resize-none', 'resize-x', 'resize-y',
    // the built-in keyframes — a spinner and a skeleton are nothing without
    // them, and the arbitrary `animate-[spin_1s_linear_infinite]` escape hatch
    // was the only spelling that passed
    'animate-none', 'animate-spin', 'animate-pulse', 'animate-bounce', 'animate-ping',
    // real tables (:table … :td) landed with the element registry. The `table`
    // DISPLAY values are deliberately not here: a <table> tag already has them,
    // and adding them to the display group is a separate call
    'table-auto', 'table-fixed', 'border-collapse', 'border-separate',
    'caption-top', 'caption-bottom',
    'align-top', 'align-middle', 'align-bottom', 'align-baseline',
    'align-text-top', 'align-text-bottom', 'align-sub', 'align-super',
    // the rich-text container class (shared/prose.js ships its CSS in every
    // export) — the handbook documented it while the validator refused it
    'prose',
    'visible', 'invisible', 'collapse',
    'grayscale', 'grayscale-0', 'blur-sm', 'blur-md', 'blur-none',
    'backdrop-blur-none', 'backdrop-blur-sm', 'backdrop-blur', 'backdrop-blur-md',
    'backdrop-blur-lg', 'backdrop-blur-xl',
    'underline-offset-1', 'underline-offset-2', 'underline-offset-4', 'underline-offset-8',
    // Utilities with no Style-panel control, which the validator refused — so
    // every write carrying one came back "kept, but the Style panel has no
    // control for it", once per element: sixteen identical lines in a single
    // response. They render like any other class (every renderer uses
    // node.classes verbatim), so refusing to recognise them bought nothing but
    // noise, and rewriting `grid place-items-center` as
    // `flex items-center justify-center` to silence it is a worse page.
    'place-items-start', 'place-items-end', 'place-items-center', 'place-items-baseline',
    'place-items-stretch',
    'place-content-start', 'place-content-end', 'place-content-center', 'place-content-between',
    'place-content-around', 'place-content-evenly', 'place-content-baseline',
    'place-content-stretch',
    'place-self-auto', 'place-self-start', 'place-self-end', 'place-self-center',
    'place-self-stretch',
    'justify-items-start', 'justify-items-end', 'justify-items-center', 'justify-items-stretch',
    'justify-items-normal',
    'justify-self-auto', 'justify-self-start', 'justify-self-end', 'justify-self-center',
    'justify-self-stretch',
    // how a headline breaks: `text-balance` is the one-class fix for a widow on
    // a two-line title, `text-pretty` the same for body copy
    'text-wrap', 'text-nowrap', 'text-balance', 'text-pretty',
    'aspect-auto',
    'isolate', 'isolation-auto',
    'mix-blend-normal', 'mix-blend-multiply', 'mix-blend-screen', 'mix-blend-overlay',
    'mix-blend-darken', 'mix-blend-lighten', 'mix-blend-difference', 'mix-blend-exclusion',
    'mix-blend-luminosity', 'mix-blend-plus-lighter',
    'will-change-auto', 'will-change-scroll', 'will-change-contents', 'will-change-transform',
    // scroll snapping: the slider's own chrome is built from these, so the
    // class input refused classes a renderer of ours emits
    'scroll-auto', 'scroll-smooth',
    'snap-none', 'snap-x', 'snap-y', 'snap-both', 'snap-mandatory', 'snap-proximity',
    'snap-start', 'snap-center', 'snap-end', 'snap-align-none', 'snap-normal', 'snap-always',
    'overscroll-auto', 'overscroll-contain', 'overscroll-none',
    'touch-auto', 'touch-none', 'touch-pan-x', 'touch-pan-y', 'touch-manipulation',
    'touch-pinch-zoom',
    'hyphens-none', 'hyphens-manual', 'hyphens-auto',
    'normal-nums', 'ordinal', 'slashed-zero', 'lining-nums', 'oldstyle-nums',
    'proportional-nums', 'tabular-nums',
  ]
  common.forEach((c) => out.add(c))
  // grid placement — spans and explicit start/end lines
  for (let n = 1; n <= 12; n++) {
    out.add(`col-span-${n}`)
    out.add(`col-start-${n}`)
    out.add(`col-end-${n}`)
  }
  for (let n = 1; n <= 6; n++) {
    out.add(`row-span-${n}`)
    out.add(`row-start-${n}`)
    out.add(`row-end-${n}`)
  }
  return [...out]
}

const VOCABULARY = buildVocabulary()

// project design-token classes (bg-brand …) — synced by useSettings;
// suggested ahead of the static vocabulary
let TOKEN_CLASSES: string[] = []

export function setStyleTokens(names: string[]) {
  propForBaseCache.clear()
  // every color-consuming family, so a token works wherever a palette color
  // does (outline-<token> / ring-<token> / accent-<token> used to be refused
  // while bg-<token> passed — an arbitrary exclusion)
  TOKEN_CLASSES = names.flatMap((n) => [
    `bg-${n}`,
    `text-${n}`,
    `border-${n}`,
    `outline-${n}`,
    `ring-${n}`,
    `accent-${n}`,
    `decoration-${n}`,
    `divide-${n}`,
  ])
}

/**
 * Suggests classes for the query, honouring variant prefixes:
 * "hover:bg-r" suggests "hover:bg-red-500". While a variant itself is
 * being typed ("hov"), the prefix completion ("hover:") is offered.
 */
export function suggestClasses(query: string, limit = 8): string[] {
  const split = splitClassVariants(query.trim())
  const prefix = split.variants.length ? `${split.variants.join(':')}:` : ''
  const base = split.base.toLowerCase()
  if (!base && !prefix) return []

  const results: string[] = []
  if (!prefix && base) {
    for (const variant of VARIANTS) {
      if (variant.startsWith(base)) results.push(`${variant}:`)
    }
  }
  const pool = [...TOKEN_CLASSES, ...VOCABULARY]
  // rank: exact match, then prefix matches (shortest = closest) preserving pool
  // order among equal lengths, then substring matches
  const starts = pool
    .filter((c) => c.startsWith(base))
    .sort((a, b) => (a === base ? -1 : b === base ? 1 : a.length - b.length))
  const contains = base.length > 1 ? pool.filter((c) => !c.startsWith(base) && c.includes(base)) : []
  for (const cls of [...starts, ...contains]) {
    if (results.length >= limit) break
    results.push(prefix + cls)
  }
  return results.slice(0, limit)
}

/**
 * Finds the class token in a class list that this property controls,
 * so the visual editor can read its state straight from the classes
 * string (the single source of truth).
 */
export function matchClass(prop: StyleProperty, classes: string[]): string | undefined {
  const control = prop.control
  switch (control.kind) {
    case 'select':
    case 'icons':
      return classes.find((cls) => control.options.some((o) => o.class === cls))
    case 'color':
      // arbitrary hex (`bg-[#ff0000]`), palette (`bg-slate-100`), or named
      return classes.find((cls) => {
        if (!cls.startsWith(`${control.prefix}-`)) return false
        const value = cls.slice(control.prefix.length + 1)
        return (
          value.startsWith('[#') ||
          isPaletteColor(value) ||
          ['white', 'black', 'transparent'].includes(value)
        )
      })
    case 'slider': {
      const known = sliderClasses(control)
      const exact = classes.find((cls) => known.includes(cls))
      if (exact) return exact
      // named-scale slider: match only in-format arbitrary values so text-[18px]
      // (size) is caught but text-[#fff] (color) is not
      if (control.custom) {
        const { prefix, format } = control.custom
        return classes.find((cls) => isNamedValueClass(prefix, format, known, cls))
      }
      // custom arbitrary / off-scale value typed into the field (e.g. z-[999], p-[4em])
      const prefix = sliderPrefix(control)
      if (prefix) return classes.find((cls) => parseTail(cls, prefix) !== null)
      return undefined
    }
    case 'input':
      return classes.find((cls) => cls.startsWith(`${control.prefix}-`))
  }
}

// --- class-input validation (free-form Classes field) ---

const VOCAB_SET = new Set(VOCABULARY)
const VARIANT_SET = new Set(VARIANTS)

// interaction-state variants (as opposed to responsive/theme breakpoints);
// used to visually flag state classes like `hover:bg-red-500` in the UI
const STATE_VARIANTS = new Set([
  'hover',
  'focus',
  'focus-visible',
  'active',
  'disabled',
  'group-hover',
  'first',
  'last',
])

/** true when a class carries a state variant, e.g. `hover:…`, `focus:…` */
export function isStateClass(cls: string): boolean {
  return splitClassVariants(cls).variants.some((v) => STATE_VARIANTS.has(v))
}

/** splits `hover:md:bg-red-500` into its variant prefix and base class.
 * Bracket-aware, so `[&_a]:underline` and an arbitrary bg value holding
 * `url(https://x)` both split where they actually should. (Written the long
 * way round on purpose: a bracketed class spelled out in a comment is a class
 * Tailwind's source scan extracts, and an unresolvable `url()` in the emitted
 * stylesheet is a build warning.) */
function splitVariant(cls: string): { variant: string; base: string } {
  const { variants, base } = splitClassVariants(cls)
  return { variant: variants.length ? `${variants.join(':')}:` : '', base }
}

/** true when a variant segment is known — a fixed variant, or an arbitrary
 *  min/max-width breakpoint variant like `max-[767px]` / `min-[48rem]` */
/** an arbitrary variant: `[&_a]`, `[&>*]`, `[&_li]:` — a raw selector with `&`.
 * Length-capped and brace-free because it lands in a stylesheet. */
const ARBITRARY_VARIANT_RE = /^\[&[^{};]{0,80}\]$/

/** the bracketed-parameter variants: data-[...], aria-[...], has-[...], … */
const PARAM_VARIANT_RE = /^(?:data|aria|has|not|group-has|peer-has|supports|nth|nth-last)-\[[^{};]{1,80}\]$/

/** `group-*` / `peer-*` with a named state (`group-focus-visible`, `peer-invalid`) */
const GROUP_PEER_RE = /^(?:group|peer)-[a-z][a-z-]*$/

/** the NAMED screen variants in both directions: `md:` is in VARIANTS, and
 * `max-md:` — the one a mobile override is naturally written with — was not,
 * so a perfectly ordinary `max-sm:hidden` came back "not a known class" and
 * the hint then suggested a different BASE class. `min-md:` is the explicit
 * spelling of `md:` and reads clearer next to a `max-` sibling. */
const NAMED_SCREEN_VARIANT_RE = /^(?:min|max)-(?:sm|md|lg|xl|2xl)$/

/**
 * v4 variants that are ACCEPTED but not suggested.
 *
 * `VARIANTS` is the suggestion list — what the Classes field offers while you
 * type — and padding it with two dozen rare pseudo-classes would bury the ones
 * anyone reaches for. These are real Tailwind v4 variants all the same, and
 * refusing them made the editor the thing standing between an author and valid
 * CSS.
 */
const ACCEPTED_VARIANTS = new Set([
  // form and widget state
  'open', 'enabled', 'read-only', 'read-write', 'optional', 'default',
  'indeterminate', 'placeholder-shown', 'autofill', 'in-range', 'out-of-range',
  'user-valid', 'user-invalid', 'inert', 'target',
  // the aria-state shorthands (the bracketed form is already accepted)
  'aria-busy', 'aria-checked', 'aria-disabled', 'aria-expanded', 'aria-hidden',
  'aria-pressed', 'aria-readonly', 'aria-required', 'aria-selected',
  // structural
  'first-child', 'last-child', 'only-of-type', 'nth-child', 'noscript',
  'details-content', 'starting',
  // the remaining pseudo-elements
  'first-letter', 'first-line', 'placeholder', 'backdrop',
  // direct children / all descendants (`*:` and `**:`)
  '*', '**',
])

function isKnownVariant(v: string): boolean {
  return (
    VARIANT_SET.has(v) ||
    ACCEPTED_VARIANTS.has(v) ||
    NAMED_SCREEN_VARIANT_RE.test(v) ||
    /^(?:min|max)-\[[0-9.]+(?:px|rem|em)\]$/.test(v) ||
    ARBITRARY_VARIANT_RE.test(v) ||
    PARAM_VARIANT_RE.test(v) ||
    GROUP_PEER_RE.test(v)
  )
}

/**
 * Split a class into its variant segments and base, respecting brackets.
 *
 * A plain `split(':')` breaks every class whose brackets contain a colon —
 * `[&_a:hover]:underline`, an arbitrary bg value holding `url(https://…)`
 * — which is most of what
 * descendant styling is for. Depth tracking is the difference between those
 * being expressible and being rejected as malformed.
 */
export function splitClassVariants(cls: string): { variants: string[]; base: string } {
  const variants: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < cls.length; i++) {
    const ch = cls[i]
    if (ch === '[' || ch === '(') depth++
    else if (ch === ']' || ch === ')') depth--
    else if (ch === ':' && depth === 0) {
      variants.push(cls.slice(start, i))
      start = i + 1
    }
  }
  return { variants, base: cls.slice(start) }
}

/** numeric flex shorthand Tailwind v4 accepts on its scale: `flex-2`, `flex-0.5` */
const FLEX_NUMERIC_RE = /^flex-\d+(?:\.\d+)?$/

/** every display utility — one conflict group, whether or not the visual
 * catalog lists it (it omits the inline-* forms), so `inline-flex` replaces
 * `flex` instead of coexisting with it and losing to stylesheet order */
const DISPLAY_CLASSES = new Set([
  'block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid',
  'hidden', 'contents', 'flow-root',
])

/** does the class list already set a display, at any variant? Wider than
 * matching the Style panel's Display property, whose catalog omits the
 * inline-* forms: `inline-flex` IS a display, and treating it as absent makes
 * callers add a second one beside it. */
export function hasDisplayClass(tokens: string[]): boolean {
  return tokens.some((t) => DISPLAY_CLASSES.has(splitVariant(t).base))
}

/** bg-* utilities that are NOT background-color (size/position/repeat/…) —
 * everything else groups as one color property so `bg-paper` replaces
 * `bg-[#f5f3edee]` and vice versa (arbitrary values are outside the catalog,
 * so without this they never conflicted with anything) */
const NON_COLOR_BG_RE =
  /^bg-(?:auto$|cover$|contain$|center$|top|bottom|left|right|repeat|no-repeat|fixed$|local$|scroll$|clip-|origin-|gradient-|linear-|radial-|conic-|none$|blend-|size-|position-)/

/** font-family utilities — the keyword forms AND an arbitrary family
 * (`font-[Instrument_Serif]`, letters in the value). One conflict group so
 * `font-mono` and `font-[JetBrains_Mono]` replace each other instead of
 * coexisting (both set font-family; the last emitted would otherwise win at
 * random, leaving the arbitrary face silently inert) */
const FONT_FAMILY_RE = /^font-(?:sans|serif|mono)$/
const FONT_ARBITRARY_FAMILY_RE = /^font-\[[^\]]*[A-Za-z][^\]]*\]$/

/** Tailwind v4 spacing/size utilities take ANY numeric step (the scale is
 * `calc(var(--spacing) * n)`, so `h-11`, `h-13`, `p-7` are all valid) plus a
 * few keywords — the old enumerated scale rejected the in-between steps
 * (`h-11` failed while `h-10`/`h-12` passed). Signed for the offset/margin/
 * translate families. */
const SPACING_PREFIX =
  '(?:p[xytblr]?|m[xytblr]?|gap(?:-[xy])?|space-[xy]|w|h|size|min-w|min-h|max-w|max-h|basis|' +
  'top|right|bottom|left|inset(?:-[xy])?|translate-[xy]|scroll-m[xytblr]?|scroll-p[xytblr]?)'
const SPACING_NUMERIC_RE = new RegExp(`^-?${SPACING_PREFIX}-\\d+(?:\\.\\d+)?$`)

/** fraction sizing — `basis-1/2`, `w-2/3`, `max-w-1/2`, `-translate-x-1/3`.
 * Tailwind resolves any n/d on these families, and they are everyday classes;
 * the numeric-only rule above rejected them, which read as "not a real class"
 * when it only meant "not enumerated". */
const SPACING_FRACTION_RE = new RegExp(`^-?${SPACING_PREFIX}-\\d+\\/\\d+$`)

/** the keyword sizing values (`max-w-full`, `basis-auto`, `min-w-fit`, …) —
 * same families, same everyday status, also missing from the enumerated vocab */
const SIZE_KEYWORDS = ['full', 'auto', 'min', 'max', 'fit', 'none', 'screen', 'prose', 'px']
const SIZE_KEYWORD_RE = new RegExp(
  `^(?:w|h|size|min-w|min-h|max-w|max-h|basis)-(?:${SIZE_KEYWORDS.join('|')})$`,
)

/** the t-shirt sizing scale on the same families. `max-w-4xl` used to pass only
 * because it happened to be hand-listed in `common` while `max-w-3xl` and
 * `max-w-7xl` were not — an enumeration gap that read as "not a real class".
 * Folds into the `size:<family>` conflict group via sizeFamily(). */
const SIZE_TSHIRT_RE =
  /^(?:w|h|size|min-w|min-h|max-w|max-h|basis)-(?:3xs|2xs|xs|sm|md|lg|xl|[2-7]xl)$/

/** Tailwind v4 resolves these families from any number, so the enumerated
 * sliders in the catalog (scale 0–150 in steps, z 0/10/20/50) were rejecting
 * perfectly ordinary values like `scale-140` and `z-2`. */
const DYNAMIC_NUMERIC_RE =
  /^-?(?:scale|scale-x|scale-y|rotate|skew-x|skew-y|z|opacity|order|grow|shrink|columns|leading)-\d+(?:\.\d+)?$/

/** the whole border-radius family incl. v4's `rounded-4xl` and the per-corner /
 * logical-side forms, none of which the icon-group catalog lists */
const ROUNDED_RE =
  /^rounded(?:-(t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee))?(?:-(?:none|xs|sm|md|lg|xl|[2-4]xl|full))?$/

/** background-position keywords — the natural companion of `background` media
 * (`bg-center`, `bg-top`, v4's `bg-top-left` plus the legacy `bg-left-top`
 * order). The catalog covers bg-size and bg-repeat but never listed these, so
 * `bg-center` read as "not a real class" while `bg-cover` passed. One conflict
 * group: a background has one position. */
const BG_POSITION_RE =
  /^bg-(?:center|top|bottom|left|right|top-left|top-right|bottom-left|bottom-right|left-top|left-bottom|right-top|right-bottom)$/

/** transform-origin keywords (`origin-top-left` …). Authored as whole tokens, so
 * the generic "use the arbitrary form" hint used to suggest the INVALID
 * `origin-top-[…]` by splitting at the last dash. */
const ORIGIN_RE =
  /^origin-(?:center|top|top-right|right|bottom-right|bottom|bottom-left|left|top-left)$/

/** visibility — a property of its own, NOT part of the display group: `invisible`
 * must not evict `flex` (it hides the box without changing its layout role) */
const VISIBILITY_CLASSES = new Set(['visible', 'invisible', 'collapse'])

/** the conflict groups for the utilities the Style panel has no control for
 *  (see the vocabulary block): one key per CSS property, longest prefix first
 *  so `place-self-*` is never read as a `place-*` of another kind */
const PANEL_LESS_GROUPS: [RegExp, string][] = [
  [/^place-items-/, 'place-items'],
  [/^place-content-/, 'place-content'],
  [/^place-self-/, 'place-self'],
  [/^justify-items-/, 'justify-items'],
  [/^justify-self-/, 'justify-self'],
  [/^text-(?:wrap|nowrap|balance|pretty)$/, 'text-wrap'],
  [/^aspect-/, 'aspect-ratio'],
  [/^(?:isolate|isolation-auto)$/, 'isolation'],
  [/^mix-blend-/, 'mix-blend-mode'],
  [/^will-change-/, 'will-change'],
  [/^scroll-(?:auto|smooth)$/, 'scroll-behavior'],
  [/^snap-(?:none|x|y|both)$/, 'scroll-snap-type'],
  [/^snap-(?:start|center|end|align-none)$/, 'scroll-snap-align'],
  [/^overscroll-(?:auto|contain|none)$/, 'overscroll-behavior'],
  [/^hyphens-/, 'hyphens'],
]

/**
 * A class is valid if every variant segment is known and the base is either
 * an arbitrary-value class (`p-[13px]`), a numeric flex (`flex-2`), in our
 * vocabulary, or a design token.
 */
/** colour families an opacity modifier is meaningful on. `/50` on anything else
 * is either a fraction (`w-1/2`, handled by SPACING_FRACTION_RE) or nonsense, so
 * the stem is only re-checked for these. */
const OPACITY_MODIFIER_RE =
  /^((?:bg|text|border|ring|outline|divide|shadow|from|via|to|decoration|caret|accent|placeholder|fill|stroke)-.+)\/(?:\d{1,3}|\[[^\]]+\])$/

export function isValidClass(cls: string): boolean {
  const { variants: segments, base } = splitClassVariants(cls)
  if (!base) return false
  if (segments.some((v) => !isKnownVariant(v))) return false
  if (/-\[.+\]$/.test(base)) return true // arbitrary value
  // `bg-black/50`, `text-white/70`, `border-border/50` — Tailwind's opacity
  // modifier, everyday syntax that was rejected outright. The slider's own
  // chrome uses it, so the renderers emitted classes an author could not type,
  // and a translucent overlay had to be written `bg-[rgba(0,0,0,0.5)]`.
  const opacity = OPACITY_MODIFIER_RE.exec(base)
  if (opacity) return isValidClass(opacity[1]!)
  if (FLEX_NUMERIC_RE.test(base)) return true // flex-2, flex-0.5, …
  if (SPACING_NUMERIC_RE.test(base)) return true // h-11, p-7, -mt-13, gap-9 … (v4 dynamic scale)
  if (SPACING_FRACTION_RE.test(base)) return true // basis-1/2, w-2/3, -translate-x-1/3
  if (SIZE_KEYWORD_RE.test(base)) return true // max-w-full, basis-auto, min-w-fit …
  if (SIZE_TSHIRT_RE.test(base)) return true // max-w-3xl, max-w-7xl, min-w-xs …
  if (DYNAMIC_NUMERIC_RE.test(base)) return true // scale-140, z-2, opacity-85, rotate-7
  if (ROUNDED_RE.test(base)) return true // rounded-4xl, rounded-t-2xl, rounded
  if (BG_POSITION_RE.test(base)) return true // bg-center, bg-top, bg-top-left …
  if (ORIGIN_RE.test(base)) return true // origin-top-left …
  if (VISIBILITY_CLASSES.has(base)) return true // visible, invisible, collapse
  return VOCAB_SET.has(base) || TOKEN_CLASSES.includes(base)
}

/** the sizing family a class belongs to (`max-w-full` → "max-w", `w-1/2` → "w"),
 * longest prefix first so `max-w-*` never reads as `w-*`. One conflict group per
 * family, so the fraction/keyword forms replace the enumerated ones instead of
 * coexisting — without this `w-1/2` would simply stack onto `w-full`. */
const SIZE_FAMILIES = ['min-w', 'min-h', 'max-w', 'max-h', 'basis', 'size', 'w', 'h']
function sizeFamily(base: string): string | undefined {
  for (const family of SIZE_FAMILIES) {
    // every utility on these prefixes sets that one dimension, whatever the
    // value shape (scale step, fraction, keyword, t-shirt size, arbitrary) —
    // so the whole family is one group, and `max-w-2xl` from the catalog and
    // `max-w-full` from the keyword rule land on the SAME key
    if (base.startsWith(`${family}-`) && base.length > family.length + 1) return `size:${family}`
  }
  return undefined
}

/** Offsets are one group per side, like SIZE_FAMILIES — the catalog lists only
 * the numeric stops, so `top-full` used to stack onto `top-0` and the winner was
 * whichever Tailwind emitted last. The value shape is checked rather than the
 * prefix alone, or v4's `inset-ring-*` / `inset-shadow-*` would be read as
 * offsets. Longest prefix first, so `inset-x-0` is not an `inset`. */
const OFFSET_FAMILIES = ['inset-x', 'inset-y', 'inset', 'top', 'right', 'bottom', 'left']
const OFFSET_VALUE_RE = /^(?:\d+(?:\.\d+)?|\d+\/\d+|full|auto|px|\[[^\]]+\])$/
function offsetFamily(base: string): string | undefined {
  const bare = base.startsWith('-') ? base.slice(1) : base
  for (const family of OFFSET_FAMILIES) {
    if (!bare.startsWith(`${family}-`)) continue
    const value = bare.slice(family.length + 1)
    // not a continue: `inset-ring-2` is an inset-* class that is NOT an offset
    return OFFSET_VALUE_RE.test(value) ? `offset:${family}` : undefined
  }
  return undefined
}

/** the catalog property a bare class belongs to, if any.
 *
 * Memoized: this scans the whole catalog, and `mergeClassLayers` asks it for
 * every class of every element carrying variant overrides — on a canvas
 * rendering a few thousand Buttons across three frames that was the second
 * largest cost of opening a page. The answer depends only on the class and
 * the token vocabulary, so `setStyleTokens` is what clears it. */
const propForBaseCache = new Map<string, StyleProperty | undefined>()
function propForBase(base: string): StyleProperty | undefined {
  if (propForBaseCache.has(base)) return propForBaseCache.get(base)
  let found: StyleProperty | undefined
  outer: for (const section of STYLE_SECTIONS) {
    for (const prop of section.properties) {
      if (matchClass(prop, [base]) === base) {
        found = prop
        break outer
      }
    }
  }
  propForBaseCache.set(base, found)
  return found
}

/**
 * A stable identity for the CSS property a bare class controls, used to detect
 * conflicts. Prefers the catalog property; falls back to pattern-based groups
 * (e.g. every `flex-*` shorthand shares one identity) so a typed `flex-2`
 * replaces the icon-picked `flex-1`.
 */
function propKey(base: string): StyleProperty | string | undefined {
  // all flex-grow shorthands (flex-1, flex-2, flex-auto, flex-none…) share one
  // identity — checked before the catalog so the icon-picked flex-1 collides
  // with a typed flex-2
  if (FLEX_NUMERIC_RE.test(base) || ['flex-auto', 'flex-initial', 'flex-none', 'flex-1'].includes(base))
    return 'flex-grow-shorthand'
  // pattern groups run before the catalog so classes the catalog doesn't
  // list (inline-flex, bg-[#…]) still conflict with the ones it does
  if (DISPLAY_CLASSES.has(base)) return 'display'
  // visibility is its own property — grouping it with display would make
  // `invisible` evict `flex`, silently changing the layout it was meant to keep
  if (VISIBILITY_CLASSES.has(base)) return 'visibility'
  const size = sizeFamily(base)
  if (size) return size
  const offset = offsetFamily(base)
  if (offset) return offset
  // one line-clamp at a time, and `truncate` is the one-line form of the same
  // thing — they cannot both apply, so adding one evicts the other
  if (base === 'truncate' || base.startsWith('line-clamp-')) return 'line-clamp'
  // the panel-less families (added to the vocabulary above): grouped ONLY
  // where the values are mutually exclusive, so adding one replaces the other
  // instead of stacking. The ones that legitimately combine — `ordinal
  // tabular-nums`, `touch-pan-x touch-pinch-zoom`, a snap axis beside a snap
  // strictness — are deliberately left ungrouped.
  for (const [re, prop] of PANEL_LESS_GROUPS) if (re.test(base)) return prop
  if (BG_POSITION_RE.test(base) || base.startsWith('bg-position-')) return 'background-position'
  if (base.startsWith('bg-') && !NON_COLOR_BG_RE.test(base)) return 'background-color'
  if (FONT_FAMILY_RE.test(base) || FONT_ARBITRARY_FAMILY_RE.test(base)) return 'font-family'
  if (ORIGIN_RE.test(base)) return 'transform-origin'
  // line-height spans a keyword scale AND a numeric one — one group, or
  // `leading-6` would stack onto `leading-tight` and the winner would be
  // whichever Tailwind happened to emit last
  if (base.startsWith('leading-')) return 'line-height'
  // the rounded family is one group whatever the value shape, so `rounded-4xl`
  // replaces `rounded-lg` instead of stacking; per-corner forms are distinct
  // properties and keep their own key
  const rounded = ROUNDED_RE.exec(base)
  if (rounded) return `border-radius:${rounded[1] ?? 'all'}`
  // the dynamic numeric families conflict with their enumerated catalog
  // counterparts (a typed `scale-140` must replace an icon-picked `scale-110`)
  const dynamic = /^-?([a-z-]+?)-\d+(?:\.\d+)?$/.exec(base)
  if (dynamic && DYNAMIC_NUMERIC_RE.test(base)) return `dynamic:${dynamic[1]}`
  return propForBase(base)
}

/** an existing token on the same property + variant that `cls` would collide with */
function conflictingToken(cls: string, tokens: string[]): string | undefined {
  const { variant, base } = splitVariant(cls)
  const key = propKey(base)
  if (!key) return undefined
  return tokens.find((t) => {
    const s = splitVariant(t)
    return s.variant === variant && s.base !== base && propKey(s.base) === key
  })
}

/**
 * The prerequisite class `cls` needs (matched to its own variant) when it maps
 * to a display-gated property and no matching display is present yet — e.g.
 * `flex-row` → `flex`, `grid-cols-3` → `grid`, `hover:flex-row` → `hover:flex`.
 */
function prerequisiteFor(cls: string, tokens: string[]): string | undefined {
  const { variant, base } = splitVariant(cls)
  const r = propForBase(base)?.relevance
  if (!r || r.when !== 'display') return undefined
  // any explicit display class — at ANY variant — means the author controls
  // display: bare `grid` satisfies `md:grid-cols-2`, `md:flex` satisfies
  // `items-center`, and `hidden` + `md:flex` is a deliberate responsive
  // pattern an auto-added base `flex` would silently fight
  if (hasDisplayClass(tokens)) return undefined
  const preferred = r.values.includes('flex') ? 'flex' : r.values[0]!
  return `${variant}${preferred}`
}

/** true when two bare classes control the same CSS property (e.g. `flex-row`
 * and `flex-col`, or `p-2` and `p-4`) — used to resolve per-breakpoint overrides */
export function sameProperty(a: string, b: string): boolean {
  if (a === b) return true
  const ka = propKey(a)
  return ka !== undefined && ka === propKey(b)
}

// --- layering (variants) ---

/**
 * What `prefix-…` means when it is NOT a colour, per prefix that doubles as
 * one. Defined by the non-colours because those are a closed set, while a
 * colour is a palette name, a project token, a keyword or an arbitrary value —
 * and a project's tokens are not known to every caller of this module.
 */
const NOT_A_PAINT: Record<string, RegExp> = {
  text: /^(?:xs|sm|base|lg|xl|\dxl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|\[[\d.].*\])$/,
  border: /^(?:\d+|[xytrblse](?:-\d+)?|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing-.*|\[[\d.].*\])$/,
  ring: /^(?:\d+|inset|offset-.*|\[[\d.].*\])$/,
  outline: /^(?:\d+|none|hidden|solid|dashed|dotted|double|offset-.*|\[[\d.].*\])$/,
  decoration: /^(?:\d+|auto|from-font|solid|double|dotted|dashed|wavy|slice|clone)$/,
  divide: /^(?:[xy](?:-\d+|-reverse)?|solid|dashed|dotted|double|none)$/,
  stroke: /^(?:\d+|\[[\d.].*\])$/,
  fill: /^$/,
  accent: /^$/,
  caret: /^$/,
}

/** `text:paint` for a colour class on a prefix that doubles as one, else undefined */
function paintFamily(base: string): string | undefined {
  const dash = base.indexOf('-')
  if (dash === -1) return undefined
  const prefix = base.slice(0, dash)
  const not = NOT_A_PAINT[prefix]
  if (!not || not.test(base.slice(dash + 1))) return undefined
  return `${prefix}:paint`
}

/** sides and modes that are part of a utility's NAME, not its value: `border-t`
 * is a different property from `border`, where `border-2` is the same one */
const NAME_TAILS = new Set(['x', 'y', 't', 'r', 'b', 'l', 's', 'e', 'inset', 'reverse'])

/** a class minus its value: `px-4` → `px`, `underline-offset-2` →
 * `underline-offset`, `-mt-4` → `mt`, `border-t` → `border-t` */
function headOf(base: string): string {
  const bare = base.startsWith('-') ? base.slice(1) : base
  // `flex-wrap` shares a prefix with direction and grow, and none of its values
  if (/^flex-(?:no)?wrap/.test(bare)) return 'flex-wrap'
  const bracket = bare.endsWith(']') ? bare.lastIndexOf('-[') : -1
  const at = bracket !== -1 ? bracket : bare.lastIndexOf('-')
  if (at <= 0) return bare
  return NAME_TAILS.has(bare.slice(at + 1)) ? bare : bare.slice(0, at)
}

/**
 * Do two bare classes set the same property, for the purpose of LAYERING one
 * class string over another?
 *
 * Wider than `sameProperty`, which answers from the style catalog and so has
 * no answer for what the catalog does not list — side spacing (`px-4`), rings,
 * outlines, token colours on `text-`. There that is harmless: a class it
 * cannot place is simply added. Here a missed conflict leaves `px-4 px-3` on
 * one element, and which of the two wins is decided by stylesheet order.
 *
 * So: colours first (by prefix), then the catalog where it knows BOTH classes,
 * then the class's own name.
 */
export function sameLayerProperty(a: string, b: string): boolean {
  if (a === b) return true
  const pa = paintFamily(a)
  const pb = paintFamily(b)
  // `bg-` is not in the table: the catalog already groups it, arbitrary values
  // included
  if (pa || pb) return pa === pb
  const ka = propKey(a)
  const kb = propKey(b)
  if (ka !== undefined && kb !== undefined) return ka === kb
  return headOf(a) === headOf(b)
}

/**
 * Layer class strings, later wins per property: `mergeClassLayers('h-9 px-4
 * bg-primary', 'h-8 px-3')` is `bg-primary h-8 px-3`.
 *
 * A base class an override replaces is REMOVED, not left beside it. Two
 * Tailwind classes on one property do not resolve by their order in the class
 * attribute but by their order in the stylesheet — so `h-9 h-8` is whichever
 * Tailwind happened to emit last, which is not a thing to build variants on.
 *
 * Conflicts are per variant, like everywhere else here: `hover:bg-accent` does
 * not evict `bg-primary`. NOT the published runtime's heuristic
 * (shared/interactionClasses.js), which cannot tell `rounded-lg` from
 * `rounded-md` or `text-sm` from `text-xs` — exactly what a size axis changes.
 */
export function mergeClassLayers(base: string, ...layers: (string | undefined)[]): string {
  let tokens = base.split(/\s+/).filter(Boolean)
  for (const layer of layers) {
    for (const cls of (layer ?? '').split(/\s+/).filter(Boolean)) {
      const { variant, base: bare } = splitVariant(cls)
      tokens = tokens.filter((t) => {
        const s = splitVariant(t)
        return !(s.variant === variant && sameLayerProperty(s.base, bare))
      })
      tokens.push(cls)
    }
  }
  return tokens.join(' ')
}

/** families where an off-scale value really is expressible as `prefix-[value]`.
 * The old hint split ANY class at its last dash and offered the arbitrary form,
 * which produced invalid advice for keyword utilities — `origin-top-left` became
 * "use origin-top-[…]", a class that does not exist. */
const ARBITRARY_CAPABLE =
  /^(?:p[xytblr]?|m[xytblr]?|gap(?:-[xy])?|w|h|size|min-w|min-h|max-w|max-h|basis|top|right|bottom|left|inset(?:-[xy])?|translate-[xy]|scale|scale-[xy]|rotate|z|opacity|leading|tracking|text|bg|border|rounded|blur|duration|delay|grid-cols|grid-rows|col-span|row-span|aspect|shadow|outline|ring)$/

/**
 * Why a class was rejected and what to try instead: the arbitrary form when the
 * family supports one, plus the nearest real classes from the vocabulary. Both
 * halves matter — "not a known class" alone leaves a caller guessing, and a
 * fabricated arbitrary form sends them somewhere that silently does nothing.
 */
function unknownClassHint(value: string): string {
  const { variants, base } = splitClassVariants(value)
  const variant = variants.length ? `${variants.join(':')}:` : ''
  const parts: string[] = []

  // when the VARIANT is the unknown part, say so. Suggesting a different base
  // class for `max-sm:overflow-hidden` ("did you mean max-sm:overflow-x-hidden?")
  // is advice that cannot work: the base was fine and the prefix is what was
  // rejected, so every suggestion carries the same broken prefix.
  const badVariants = variants.filter((v) => !isKnownVariant(v))
  if (badVariants.length) {
    return (
      ` — ${badVariants.map((v) => `"${v}:"`).join(', ')} ` +
      `${badVariants.length === 1 ? 'is not a' : 'are not'} known variant` +
      `${badVariants.length === 1 ? '' : 's'}. Responsive: a named screen ` +
      '("md:", "max-md:") or an arbitrary width ("max-[767px]:"). State: "hover:", ' +
      '"focus-visible:", "group-hover:", "data-[open]:". Descendants: "[&>li]:".'
    )
  }

  // `bg-line` when no token "line" exists reads like a vocabulary bug — name
  // the real cause (the token isn't saved yet) instead of "not a known class"
  const tokenish = /^(?:bg|text|border|outline|ring|accent|decoration|divide)-([a-z][a-z0-9-]*)$/.exec(base)
  if (tokenish && !TOKEN_CLASSES.includes(base)) {
    parts.push(
      `if "${tokenish[1]}" is meant to be a design token, no token with that name exists yet — save it in the project settings first`,
    )
  }

  const dash = base.lastIndexOf('-')
  const prefix = dash > 0 ? base.slice(0, dash) : ''
  if (prefix && ARBITRARY_CAPABLE.test(prefix)) {
    parts.push(`for an off-scale value use the arbitrary form "${variant}${prefix}-[…]"`)
  }
  const near = suggestClasses(base, 3).filter((c) => c !== base && !c.endsWith(':'))
  if (near.length) parts.push(`did you mean ${near.map((c) => `"${variant}${c}"`).join(', ')}?`)

  return parts.length ? ` — ${parts.join('; ')}` : ''
}

export type ApplyClassResult = { tokens: string[] } | { error: string }

/**
 * Validates a typed class against the current token list and returns the
 * resulting tokens (conflict replaced, prerequisite auto-added) or an error.
 * `prerequisites: false` skips the flex/grid prerequisite injection — used by
 * fields (e.g. an interaction's to-state) where a display class shouldn't be
 * added implicitly.
 */
export function applyClass(
  cls: string,
  tokens: string[],
  opts: { prerequisites?: boolean } = {},
): ApplyClassResult {
  const value = cls.trim()
  if (!value) return { error: '' }
  if (!isValidClass(value)) {
    return { error: `"${value}" is not a known class${unknownClassHint(value)}` }
  }
  if (tokens.includes(value)) return { error: `${value} is already added` }

  let next = [...tokens]
  const conflict = conflictingToken(value, next)
  if (conflict) next = next.filter((t) => t !== conflict)
  next.push(value)

  if (opts.prerequisites !== false) {
    const prereq = prerequisiteFor(value, next)
    if (prereq && !next.includes(prereq)) next.unshift(prereq)
  }

  return { tokens: next }
}
