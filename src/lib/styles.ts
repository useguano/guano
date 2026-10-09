import { TAILWIND_COLORS, TAILWIND_SHADES, isPaletteColor } from './colors'
import { SPACING, borderWidthScheme, type Slot } from './tieredBox'
import { derivePrefix, parseTail, isNamedValueClass, type NamedFormat } from './valueClass'
import { STYLE_SECTIONS } from './styleCatalog'

export type Control =
  | { kind: 'select'; options: { label: string; class: string }[] }
  | { kind: 'color'; prefix: string }
  | {
      kind: 'slider'
      prefix?: string
      stops?: string[]
      classes?: string[]
      labels?: string[]
      custom?: { prefix: string; format: NamedFormat }
    }
  | { kind: 'input'; prefix: string; placeholder?: string }
  | { kind: 'icons'; options: { label: string; class: string; icon: string }[] }

type Slider = Extract<Control, { kind: 'slider' }>

export function sliderClasses(c: Slider): string[] {
  return c.classes ?? c.stops!.map((s) => `${c.prefix}-${s}`)
}
export function sliderLabels(c: Slider): string[] {
  return c.labels ?? c.stops ?? c.classes ?? []
}

export function sliderPrefix(c: Slider): string | null {
  return c.custom?.prefix ?? c.prefix ?? (c.classes ? derivePrefix(c.classes) : null)
}

export function sliderAllowNegative(c: Slider): boolean {
  return !!c.classes?.some((cls) => cls.startsWith('-'))
}

export interface StyleProperty {
  id: string
  label: string
  control: Control
  needsDisplay?: boolean
  default?: string
  relevance?: Relevance
}

export interface StyleSection {
  id: string
  label: string
  properties: StyleProperty[]
}

export type Relevance =
  | { when: 'positioned' }
  | { when: 'display'; values: string[] }
  | { when: 'parentDisplay'; values: string[] }
  | { when: 'transition' }
  | { when: 'mediaElement' }
  | { when: 'mediaOrBackground' }

export interface RelevanceContext {
  display?: string
  position?: string
  parentDisplay?: string
  hasTransition?: boolean
  isMedia?: boolean
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
  'current',
  'group-current',
]

function buildVocabulary(): string[] {
  const out = new Set<string>()
  for (const section of STYLE_SECTIONS) {
    for (const prop of section.properties) {
      const control = prop.control
      if (control.kind === 'select') control.options.forEach((o) => out.add(o.class))
      if (control.kind === 'icons') control.options.forEach((o) => out.add(o.class))
      if (control.kind === 'slider') sliderClasses(control).forEach((c) => out.add(c))
    }
  }
  const spacing = ['p', 'px', 'py', 'pt', 'pb', 'pl', 'pr', 'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr', 'gap', 'gap-x', 'gap-y']
  const SPACING_VALID = [...SPACING, '5', '14', '28', '32']
  for (const prefix of spacing) for (const stop of SPACING_VALID) out.add(`${prefix}-${stop}`)
  const SIZE_STOPS = ['0', '1', '2', '3', '4', '5', '6', '8', '10', '12', '14', '16', '20', '24', '28', '32', '36', '40', '44', '48', '52', '56', '60', '64', '72', '80', '96']
  for (const prefix of ['w', 'h', 'size']) for (const stop of SIZE_STOPS) out.add(`${prefix}-${stop}`)
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
  for (const prefix of ['top', 'right', 'bottom', 'left', 'inset', 'inset-x', 'inset-y', 'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr']) {
    for (const stop of SPACING) if (stop !== '0') out.add(`-${prefix}-${stop}`)
  }
  for (const prefix of ['m', 'mx', 'my', 'mt', 'mb', 'ml', 'mr']) out.add(`${prefix}-auto`)
  for (const prefix of ['inset', 'inset-x', 'inset-y', 'top', 'right', 'bottom', 'left']) out.add(`${prefix}-auto`)
  for (const prefix of ['top', 'right', 'bottom', 'left', 'inset', 'inset-x', 'inset-y']) {
    for (const value of ['full', '1/2', '1/3', '2/3', '1/4', '3/4']) {
      out.add(`${prefix}-${value}`)
      out.add(`-${prefix}-${value}`)
    }
  }
  for (const n of ['1', '2', '3', '4', '5', '6', 'none']) out.add(`line-clamp-${n}`)
  for (const s of ['all', 'x', 'y', 't', 'r', 'b', 'l'] as Slot[]) {
    const prefix = borderWidthScheme.slot('border', s)
    for (const step of borderWidthScheme.steps) out.add(borderWidthScheme.className(prefix, step))
  }
  for (const prefix of ['bg', 'text', 'border', 'outline', 'ring', 'accent', 'decoration', 'divide']) {
    for (const color of Object.keys(TAILWIND_COLORS)) {
      for (const shade of TAILWIND_SHADES) out.add(`${prefix}-${color}-${shade}`)
    }
  }
  for (const axis of ['x', 'y']) {
    out.add(`divide-${axis}`)
    out.add(`divide-${axis}-reverse`)
    for (const w of ['0', '2', '4', '8']) out.add(`divide-${axis}-${w}`)
  }
  for (const kw of ['solid', 'dashed', 'dotted', 'double', 'none', 'white', 'black', 'transparent', 'current']) {
    out.add(`divide-${kw}`)
  }
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
    'sr-only', 'not-sr-only',
  ]
  focusExtras.forEach((c) => out.add(c))
  const common = [
    'bg-white', 'bg-black', 'bg-transparent', 'text-white', 'text-black',
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
    'contents', 'flow-root',
    'whitespace-normal', 'whitespace-nowrap', 'whitespace-pre', 'whitespace-pre-line',
    'whitespace-pre-wrap', 'break-words', 'break-all',
    'group', 'peer', 'h-px', 'w-px', 'inset-0', 'inset-x-0', 'inset-y-0',
    'appearance-none', 'appearance-auto',
    'resize', 'resize-none', 'resize-x', 'resize-y',
    'animate-none', 'animate-spin', 'animate-pulse', 'animate-bounce', 'animate-ping',
    'table-auto', 'table-fixed', 'border-collapse', 'border-separate',
    'caption-top', 'caption-bottom',
    'align-top', 'align-middle', 'align-bottom', 'align-baseline',
    'align-text-top', 'align-text-bottom', 'align-sub', 'align-super',
    'prose',
    'visible', 'invisible', 'collapse',
    'grayscale', 'grayscale-0', 'blur-sm', 'blur-md', 'blur-none',
    'backdrop-blur-none', 'backdrop-blur-sm', 'backdrop-blur', 'backdrop-blur-md',
    'backdrop-blur-lg', 'backdrop-blur-xl',
    'underline-offset-1', 'underline-offset-2', 'underline-offset-4', 'underline-offset-8',
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
    'text-wrap', 'text-nowrap', 'text-balance', 'text-pretty',
    'aspect-auto',
    'isolate', 'isolation-auto',
    'mix-blend-normal', 'mix-blend-multiply', 'mix-blend-screen', 'mix-blend-overlay',
    'mix-blend-darken', 'mix-blend-lighten', 'mix-blend-difference', 'mix-blend-exclusion',
    'mix-blend-luminosity', 'mix-blend-plus-lighter',
    'will-change-auto', 'will-change-scroll', 'will-change-contents', 'will-change-transform',
    'scroll-auto', 'scroll-smooth',
    'snap-none', 'snap-x', 'snap-y', 'snap-both', 'snap-mandatory', 'snap-proximity',
    'snap-start', 'snap-center', 'snap-end', 'snap-align-none', 'snap-normal', 'snap-always',
    'overscroll-auto', 'overscroll-contain', 'overscroll-none',
    'touch-auto', 'touch-none', 'touch-pan-x', 'touch-pan-y', 'touch-manipulation',
    'touch-pinch-zoom',
    'hyphens-none', 'hyphens-manual', 'hyphens-auto',
    'normal-nums', 'ordinal', 'slashed-zero', 'lining-nums', 'oldstyle-nums',
    'proportional-nums', 'tabular-nums',
    'bg-linear-to-t', 'bg-linear-to-tr', 'bg-linear-to-r', 'bg-linear-to-br',
    'bg-linear-to-b', 'bg-linear-to-bl', 'bg-linear-to-l', 'bg-linear-to-tl',
    'bg-gradient-to-t', 'bg-gradient-to-tr', 'bg-gradient-to-r', 'bg-gradient-to-br',
    'bg-gradient-to-b', 'bg-gradient-to-bl', 'bg-gradient-to-l', 'bg-gradient-to-tl',
    'bg-radial', 'bg-conic', 'bg-none',
    'bg-fixed', 'bg-local', 'bg-scroll',
  ]
  common.forEach((c) => out.add(c))
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

let TOKEN_CLASSES: string[] = []

export function setStyleTokens(names: string[]) {
  propForBaseCache.clear()
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

export function matchClass(prop: StyleProperty, classes: string[]): string | undefined {
  const control = prop.control
  switch (control.kind) {
    case 'select':
    case 'icons':
      return classes.find((cls) => control.options.some((o) => o.class === cls))
    case 'color':
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
      if (control.custom) {
        const { prefix, format } = control.custom
        return classes.find((cls) => isNamedValueClass(prefix, format, known, cls))
      }
      const prefix = sliderPrefix(control)
      if (prefix) return classes.find((cls) => parseTail(cls, prefix) !== null)
      return undefined
    }
    case 'input':
      return classes.find((cls) => cls.startsWith(`${control.prefix}-`))
  }
}

const VOCAB_SET = new Set(VOCABULARY)
const VARIANT_SET = new Set(VARIANTS)

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

export function isStateClass(cls: string): boolean {
  return splitClassVariants(cls).variants.some((v) => STATE_VARIANTS.has(v))
}

function splitVariant(cls: string): { variant: string; base: string } {
  const { variants, base } = splitClassVariants(cls)
  return { variant: variants.length ? `${variants.join(':')}:` : '', base }
}

const ARBITRARY_VARIANT_RE = /^\[&[^{};]{0,80}\]$/

const PARAM_VARIANT_RE = /^(?:data|aria|has|not|group-has|peer-has|supports|nth|nth-last)-\[[^{};]{1,80}\]$/

const GROUP_PEER_RE = /^(?:group|peer)-[a-z][a-z-]*$/

const NAMED_SCREEN_VARIANT_RE = /^(?:min|max)-(?:sm|md|lg|xl|2xl)$/

const ACCEPTED_VARIANTS = new Set([
  'open', 'enabled', 'read-only', 'read-write', 'optional', 'default',
  'indeterminate', 'placeholder-shown', 'autofill', 'in-range', 'out-of-range',
  'user-valid', 'user-invalid', 'inert', 'target',
  'aria-busy', 'aria-checked', 'aria-disabled', 'aria-expanded', 'aria-hidden',
  'aria-pressed', 'aria-readonly', 'aria-required', 'aria-selected',
  'first-child', 'last-child', 'only-of-type', 'nth-child', 'noscript',
  'details-content', 'starting',
  'first-letter', 'first-line', 'placeholder', 'backdrop',
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

const FLEX_NUMERIC_RE = /^flex-\d+(?:\.\d+)?$/

const DISPLAY_CLASSES = new Set([
  'block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid',
  'hidden', 'contents', 'flow-root',
])

export function hasDisplayClass(tokens: string[]): boolean {
  return tokens.some((t) => DISPLAY_CLASSES.has(splitVariant(t).base))
}

function backgroundKey(base: string): string | undefined {
  if (!base.startsWith('bg-')) return undefined
  const value = base.slice(3)
  if (value.startsWith('[')) {
    const hint = /^\[([a-z-]+):/.exec(value)?.[1]
    if (hint === 'size' || hint === 'length') return 'background-size'
    if (hint === 'position') return 'background-position'
    if (hint === 'image' || hint === 'url') return 'background-image'
    if (hint === 'color') return 'background-color'
    if (/^\[(?:url\(|(?:repeating-)?(?:linear|radial|conic)-gradient\(|image\(|image-set\()/.test(value))
      return 'background-image'
    return 'background-color'
  }
  if (/^(?:auto|cover|contain)$/.test(value) || value.startsWith('size-')) return 'background-size'
  if (BG_POSITION_RE.test(base) || value.startsWith('position-')) return 'background-position'
  if (/^(?:fixed|local|scroll)$/.test(value)) return 'background-attachment'
  if (/^(?:none$|linear-to-|linear$|linear-|radial|conic|gradient-to-)/.test(value)) return 'background-image'
  if (/^(?:repeat|no-repeat)/.test(value)) return 'background-repeat'
  if (value.startsWith('clip-')) return 'background-clip'
  if (value.startsWith('origin-')) return 'background-origin'
  if (value.startsWith('blend-')) return 'background-blend-mode'
  return 'background-color'
}

const FONT_FAMILY_RE = /^font-(?:sans|serif|mono)$/
const FONT_ARBITRARY_FAMILY_RE = /^font-\[[^\]]*[A-Za-z][^\]]*\]$/

const SPACING_PREFIX =
  '(?:p[xytblr]?|m[xytblr]?|gap(?:-[xy])?|space-[xy]|w|h|size|min-w|min-h|max-w|max-h|basis|' +
  'top|right|bottom|left|inset(?:-[xy])?|translate-[xy]|scroll-m[xytblr]?|scroll-p[xytblr]?)'
const SPACING_NUMERIC_RE = new RegExp(`^-?${SPACING_PREFIX}-\\d+(?:\\.\\d+)?$`)

const SPACING_FRACTION_RE = new RegExp(`^-?${SPACING_PREFIX}-\\d+\\/\\d+$`)

const SIZE_KEYWORDS = ['full', 'auto', 'min', 'max', 'fit', 'none', 'screen', 'prose', 'px']
const SIZE_KEYWORD_RE = new RegExp(
  `^(?:w|h|size|min-w|min-h|max-w|max-h|basis)-(?:${SIZE_KEYWORDS.join('|')})$`,
)

const SIZE_TSHIRT_RE =
  /^(?:w|h|size|min-w|min-h|max-w|max-h|basis)-(?:3xs|2xs|xs|sm|md|lg|xl|[2-7]xl)$/

const DYNAMIC_NUMERIC_RE =
  /^-?(?:scale|scale-x|scale-y|rotate|skew-x|skew-y|z|opacity|order|grow|shrink|columns|leading)-\d+(?:\.\d+)?$/

const ROUNDED_RE =
  /^rounded(?:-(t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee))?(?:-(?:none|xs|sm|md|lg|xl|[2-4]xl|full))?$/

const BG_POSITION_RE =
  /^bg-(?:center|top|bottom|left|right|top-left|top-right|bottom-left|bottom-right|left-top|left-bottom|right-top|right-bottom)$/

const ORIGIN_RE =
  /^origin-(?:center|top|top-right|right|bottom-right|bottom|bottom-left|left|top-left)$/

const VISIBILITY_CLASSES = new Set(['visible', 'invisible', 'collapse'])

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

const ARBITRARY_PROPERTY_RE = /^\[([a-z][a-z-]*):[^{};]+\]$/

const OPACITY_MODIFIER_RE =
  /^((?:bg|text|border|ring|outline|divide|shadow|from|via|to|decoration|caret|accent|placeholder|fill|stroke)-.+)\/(?:\d{1,3}|\[[^\]]+\])$/

export function isValidClass(cls: string): boolean {
  const { variants: segments, base } = splitClassVariants(cls)
  if (!base) return false
  if (segments.some((v) => !isKnownVariant(v))) return false
  if (/-\[.+\]$/.test(base)) return true
  if (ARBITRARY_PROPERTY_RE.test(base)) return true
  const opacity = OPACITY_MODIFIER_RE.exec(base)
  if (opacity) return isValidClass(opacity[1]!)
  if (FLEX_NUMERIC_RE.test(base)) return true
  if (SPACING_NUMERIC_RE.test(base)) return true
  if (SPACING_FRACTION_RE.test(base)) return true
  if (SIZE_KEYWORD_RE.test(base)) return true
  if (SIZE_TSHIRT_RE.test(base)) return true
  if (DYNAMIC_NUMERIC_RE.test(base)) return true
  if (ROUNDED_RE.test(base)) return true
  if (BG_POSITION_RE.test(base)) return true
  if (ORIGIN_RE.test(base)) return true
  if (VISIBILITY_CLASSES.has(base)) return true
  return VOCAB_SET.has(base) || TOKEN_CLASSES.includes(base)
}

const SIZE_FAMILIES = ['min-w', 'min-h', 'max-w', 'max-h', 'basis', 'size', 'w', 'h']
function sizeFamily(base: string): string | undefined {
  for (const family of SIZE_FAMILIES) {
    if (base.startsWith(`${family}-`) && base.length > family.length + 1) return `size:${family}`
  }
  return undefined
}

const OFFSET_FAMILIES = ['inset-x', 'inset-y', 'inset', 'top', 'right', 'bottom', 'left']
const OFFSET_VALUE_RE = /^(?:\d+(?:\.\d+)?|\d+\/\d+|full|auto|px|\[[^\]]+\])$/
function offsetFamily(base: string): string | undefined {
  const bare = base.startsWith('-') ? base.slice(1) : base
  for (const family of OFFSET_FAMILIES) {
    if (!bare.startsWith(`${family}-`)) continue
    const value = bare.slice(family.length + 1)
    return OFFSET_VALUE_RE.test(value) ? `offset:${family}` : undefined
  }
  return undefined
}

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

function propKey(base: string): StyleProperty | string | undefined {
  if (FLEX_NUMERIC_RE.test(base) || ['flex-auto', 'flex-initial', 'flex-none', 'flex-1'].includes(base))
    return 'flex-grow-shorthand'
  if (DISPLAY_CLASSES.has(base)) return 'display'
  if (VISIBILITY_CLASSES.has(base)) return 'visibility'
  const size = sizeFamily(base)
  if (size) return size
  const offset = offsetFamily(base)
  if (offset) return offset
  if (base === 'truncate' || base.startsWith('line-clamp-')) return 'line-clamp'
  for (const [re, prop] of PANEL_LESS_GROUPS) if (re.test(base)) return prop
  const arbitraryProp = ARBITRARY_PROPERTY_RE.exec(base)
  if (arbitraryProp) return `arbitrary:${arbitraryProp[1]}`
  const background = backgroundKey(base)
  if (background) return background
  if (FONT_FAMILY_RE.test(base) || FONT_ARBITRARY_FAMILY_RE.test(base)) return 'font-family'
  if (ORIGIN_RE.test(base)) return 'transform-origin'
  if (base.startsWith('leading-')) return 'line-height'
  const rounded = ROUNDED_RE.exec(base)
  if (rounded) return `border-radius:${rounded[1] ?? 'all'}`
  const dynamic = /^-?([a-z-]+?)-\d+(?:\.\d+)?$/.exec(base)
  if (dynamic && DYNAMIC_NUMERIC_RE.test(base)) return `dynamic:${dynamic[1]}`
  return propForBase(base)
}

function conflictingToken(cls: string, tokens: string[]): string | undefined {
  const { variant, base } = splitVariant(cls)
  const key = propKey(base)
  if (!key) return undefined
  return tokens.find((t) => {
    const s = splitVariant(t)
    return s.variant === variant && s.base !== base && propKey(s.base) === key
  })
}

function prerequisiteFor(cls: string, tokens: string[]): string | undefined {
  const { variant, base } = splitVariant(cls)
  const r = propForBase(base)?.relevance
  if (!r || r.when !== 'display') return undefined
  if (hasDisplayClass(tokens)) return undefined
  const preferred = r.values.includes('flex') ? 'flex' : r.values[0]!
  return `${variant}${preferred}`
}

export function sameProperty(a: string, b: string): boolean {
  if (a === b) return true
  const ka = propKey(a)
  return ka !== undefined && ka === propKey(b)
}

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

function paintFamily(base: string): string | undefined {
  const dash = base.indexOf('-')
  if (dash === -1) return undefined
  const prefix = base.slice(0, dash)
  const not = NOT_A_PAINT[prefix]
  if (!not || not.test(base.slice(dash + 1))) return undefined
  return `${prefix}:paint`
}

const NAME_TAILS = new Set(['x', 'y', 't', 'r', 'b', 'l', 's', 'e', 'inset', 'reverse'])

function headOf(base: string): string {
  const bare = base.startsWith('-') ? base.slice(1) : base
  if (/^flex-(?:no)?wrap/.test(bare)) return 'flex-wrap'
  const bracket = bare.endsWith(']') ? bare.lastIndexOf('-[') : -1
  const at = bracket !== -1 ? bracket : bare.lastIndexOf('-')
  if (at <= 0) return bare
  return NAME_TAILS.has(bare.slice(at + 1)) ? bare : bare.slice(0, at)
}

export function sameLayerProperty(a: string, b: string): boolean {
  if (a === b) return true
  const pa = paintFamily(a)
  const pb = paintFamily(b)
  if (pa || pb) return pa === pb
  const ka = propKey(a)
  const kb = propKey(b)
  if (ka !== undefined && kb !== undefined) return ka === kb
  return headOf(a) === headOf(b)
}

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

const ARBITRARY_CAPABLE =
  /^(?:p[xytblr]?|m[xytblr]?|gap(?:-[xy])?|w|h|size|min-w|min-h|max-w|max-h|basis|top|right|bottom|left|inset(?:-[xy])?|translate-[xy]|scale|scale-[xy]|rotate|z|opacity|leading|tracking|text|bg|border|rounded|blur|duration|delay|grid-cols|grid-rows|col-span|row-span|aspect|shadow|outline|ring)$/

function unknownClassHint(value: string): string {
  const { variants, base } = splitClassVariants(value)
  const variant = variants.length ? `${variants.join(':')}:` : ''
  const parts: string[] = []

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
