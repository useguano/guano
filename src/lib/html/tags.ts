import { ELEMENTS, isKnownElement, isLeafElement } from '../elements'
import { isComponentType } from '../components'

const TAG_OF: Record<string, string> = {
  body: 'body',
  paragraph: 'p',
  link: 'a',
  list: 'ul',
  'list-item': 'li',
  image: 'img',
  icon: 'svg',
  text: 'div',
  checkbox: 'input',
  radio: 'input',
  'collection-list': 'collection-list',
  'collection-item': 'collection-item',
  'list-empty': 'list-empty',
  slider: 'slider',
  'form-success': 'form-success',
  'form-error': 'form-error',
  'custom-code': 'custom-code',
}

export const ALIAS_OF: Record<string, string> = {
  container: 'div',
  grid: 'div',
  heading: 'h2',
  dropdown: 'select',
}

export const SLOT_FILL_TYPE = '@slot'

export function tagForType(type: string): string {
  if (isComponentType(type)) return type
  const canonical = ALIAS_OF[type] ?? type
  return TAG_OF[canonical] ?? canonical
}

const TYPE_OF_TAG: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  for (const type of Object.keys(ELEMENTS)) {
    if (ALIAS_OF[type]) continue
    const tag = tagForType(type)
    if (out[tag] === undefined) out[tag] = type
  }
  out.div = 'div'
  out.input = 'input'
  out.select = 'select'
  return out
})()

export function sameType(a: string, b: string): boolean {
  if (a === b) return true
  return (ALIAS_OF[a] ?? a) === (ALIAS_OF[b] ?? b)
}

export interface TagResolution {
  type: string
  note?: string
}

export function typeForTag(
  tag: string,
  attrs: Record<string, string>,
  components: string[],
): TagResolution | null {
  if (isComponentType(tag)) return { type: tag }

  if (tag === 'input') {
    const kind = attrs.type
    if (kind === 'checkbox' || kind === 'radio') return { type: kind }
    return { type: 'input' }
  }
  if (tag === 'div' && attrs['data-type'] === 'text') return { type: 'text' }
  if (tag === 'slot') return { type: SLOT_FILL_TYPE }

  const known = TYPE_OF_TAG[tag]
  if (known) return { type: known }

  const matches = components.filter((name) => name.toLowerCase() === tag.toLowerCase())
  if (matches.length === 1) {
    return {
      type: matches[0]!,
      note: `<${tag}> read as the component <${matches[0]}> — component tags are capitalized`,
    }
  }
  return null
}

const VOID_TAGS = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source'])

export const isLenientVoidTag = (tag: string) => !isComponentType(tag) && VOID_TAGS.has(tag)

export const FORBIDDEN_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'base'])

export const isLeafType = (type: string) => !isComponentType(type) && isLeafElement(type)

export const isRenderableType = (type: string) =>
  type === SLOT_FILL_TYPE || isComponentType(type) || isKnownElement(type)

export const SOURCE_TYPES = new Set(['collection-list', 'collection-item', 'slider', 'body'])

export const impliedAttrs = (type: string): Record<string, string> =>
  (!isComponentType(type) && ELEMENTS[type]?.attrs) || {}
