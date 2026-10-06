import { ELEMENTS, isKnownElement, isLeafElement } from '../elements'
import { isComponentType } from '../components'

/**
 * The element registry ↔ the agent-facing HTML subset.
 *
 * Agents read and write pages as HTML because it is a format every model
 * already knows; the registry is what the app actually renders. This module is
 * the one place the two are reconciled, in both directions.
 *
 * Tag names are CASE-SENSITIVE here. That is what lets `<Card>` mean a
 * component instance, and it is why the parser is hand-rolled rather than
 * parse5 or any other HTML5 parser: they all lowercase tag names.
 */

/** registry types whose HTML tag is not their own name */
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
  // the behaviour elements have no HTML equivalent, so they keep their own
  // names as custom tags
  'collection-list': 'collection-list',
  'collection-item': 'collection-item',
  'list-empty': 'list-empty',
  slider: 'slider',
  'form-success': 'form-success',
  'form-error': 'form-error',
  // raw HTML: its content is ESCAPED on the way out and decoded on the way
  // in, so a <script> inside it never reaches the tokenizer as a tag
  'custom-code': 'custom-code',
}

/**
 * Pure aliases: a type whose tag AND shape are another type's.
 *
 * They serialize as the target's tag, so reading one back has to resolve to
 * the target — and `sameType` has to treat the pair as equal, or every write
 * would re-mint the node for a difference that renders nowhere. The Phase 4
 * migration collapses them in the stored data; until then this keeps the
 * round-trip exact.
 */
export const ALIAS_OF: Record<string, string> = {
  container: 'div',
  grid: 'div',
  heading: 'h2',
  dropdown: 'select',
}

/**
 * `<slot>` — the write-only shorthand for "fill this instance's slot".
 *
 * Not an element and never stored: it is a parse-time marker that `applyHtml`
 * consumes (see fillInstance). It exists because an instance's interior has to
 * match its master node for node, so filling a slot three levels down meant
 * re-typing the component's whole skeleton on every page that used it — nine
 * times for one funnel shell, each copy stale the moment the shell changed.
 *
 * The type is deliberately unspellable as an element (`@` is not a valid
 * element type, and component names are capitalized), so it can never collide
 * with a real one.
 */
export const SLOT_FILL_TYPE = '@slot'

/** the HTML tag a node of this type is written as */
export function tagForType(type: string): string {
  if (isComponentType(type)) return type
  const canonical = ALIAS_OF[type] ?? type
  return TAG_OF[canonical] ?? canonical
}

/** the registry type a tag reads back as — the reverse of `tagForType`, with
 *  each ambiguous tag resolved to its canonical type */
const TYPE_OF_TAG: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  for (const type of Object.keys(ELEMENTS)) {
    if (ALIAS_OF[type]) continue // an alias never wins the reverse mapping
    const tag = tagForType(type)
    // `div` is claimed by `div` itself (text/collection-list/… are
    // distinguished by their own tag or by data-type), `input` by `input`
    if (out[tag] === undefined) out[tag] = type
  }
  out.div = 'div'
  out.input = 'input'
  out.select = 'select'
  return out
})()

/** do these two types mean the same element? (an alias and its target do) */
export function sameType(a: string, b: string): boolean {
  if (a === b) return true
  return (ALIAS_OF[a] ?? a) === (ALIAS_OF[b] ?? b)
}

export interface TagResolution {
  type: string
  /** a note for the agent when the tag was not written canonically */
  note?: string
}

/**
 * Which element a tag means.
 *
 * `attrs` disambiguates the two tags that carry more than one type: `<input>`
 * splits on its `type` (checkbox/radio are the registry's own types so an
 * author never has to remember the attribute), and `<div data-type="text">` is
 * the text block.
 *
 * `components` lets a lowercase `<card>` resolve to `Card` when exactly one
 * component matches — models lowercase tag names out of habit, and refusing
 * the whole write over it would be the format's most common papercut.
 */
export function typeForTag(
  tag: string,
  attrs: Record<string, string>,
  components: string[],
): TagResolution | null {
  // a capitalized tag is a component instance whether the project has one or
  // not: an unknown one reads better as a `validateTree` diagnostic on the node
  // than as a parse error with no address
  if (isComponentType(tag)) return { type: tag }

  if (tag === 'input') {
    const kind = attrs.type
    if (kind === 'checkbox' || kind === 'radio') return { type: kind }
    return { type: 'input' }
  }
  if (tag === 'div' && attrs['data-type'] === 'text') return { type: 'text' }
  // the slot-fill marker, legal only as a component instance's single child —
  // applyHtml refuses it anywhere else, by name
  if (tag === 'slot') return { type: SLOT_FILL_TYPE }

  const known = TYPE_OF_TAG[tag]
  if (known) return { type: known }

  // a component written in lowercase, which is how a model's habit spells it
  const matches = components.filter((name) => name.toLowerCase() === tag.toLowerCase())
  if (matches.length === 1) {
    return {
      type: matches[0]!,
      note: `<${tag}> read as the component <${matches[0]}> — component tags are capitalized`,
    }
  }
  return null
}

/**
 * Void tags that may be written without the self-closing slash.
 *
 * Matched CASE-SENSITIVELY, and never against a component: a component called
 * `Input` or `Link` is not `<input>`, and lowercasing the tag first made
 * `<Input>` a void element, so its closing tag read as a mismatch and its
 * children landed on whatever contained it.
 */
const VOID_TAGS = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source'])

export const isLenientVoidTag = (tag: string) => !isComponentType(tag) && VOID_TAGS.has(tag)

/** tags that are never content, whatever they claim to be */
export const FORBIDDEN_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'base'])

/** does this element carry text rather than children? Registry-driven. */
export const isLeafType = (type: string) => !isComponentType(type) && isLeafElement(type)

/** is this a type the app can render at all? (the slot-fill marker is not an
 *  element, but the PARSER must let it through for applyHtml to act on) */
export const isRenderableType = (type: string) =>
  type === SLOT_FILL_TYPE || isComponentType(type) || isKnownElement(type)

/**
 * `source` carries the collection an element iterates or embeds; `data-field`
 * carries an ordinary element's field binding. Both land on `node.arg` — two
 * names because they read as two different things, and an agent that confuses
 * them is told so rather than silently binding the wrong way.
 */
export const SOURCE_TYPES = new Set(['collection-list', 'collection-item', 'slider', 'body'])

/**
 * The attributes an element type IMPLIES — `checkbox` is `<input type="checkbox">`.
 *
 * They are part of the element's identity, not state: the registry carries
 * them, every renderer emits them, and the reader uses them to pick the type
 * back out of the tag. So the writer emits them and the reader consumes them,
 * rather than storing them as custom attributes (which would make the type and
 * the attribute two places to disagree).
 */
export const impliedAttrs = (type: string): Record<string, string> =>
  (!isComponentType(type) && ELEMENTS[type]?.attrs) || {}
