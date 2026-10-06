import type { ElementNode } from '@/types/editor'
import { createNode, isKnownElement } from '../elements'
import { isComponentType } from '../components'

/**
 * LEGACY: the indentation DSL's parser, kept for ONE purpose.
 *
 * Until the v2 schema migration, a page carried both a tree (`elements`) and
 * the DSL text it was derived from (`code`). The tree is what every renderer
 * read, so the tree is what the migration keeps — re-deriving from the text
 * would be a chance to change the published site, and over the corpus it
 * demonstrably did (one fixture page carries a `link` its line never had).
 *
 * What is left is the SALVAGE case: a stored page with code but no usable
 * tree. That should not exist — the editor kept the two in sync for as long as
 * both existed — but "should not exist" is not a thing to bet a one-way
 * migration on, so the parser stays until a release has passed with no
 * salvage logged. Nothing else may import this.
 *
 * Reduced to what salvage needs: no `adopt` callback (there is no previous
 * tree to carry identity from), no reconcile, no validation, no markers.
 */

const REF = '(?:#(?<ref>[a-zA-Z][a-zA-Z0-9-]?[a-zA-Z0-9-]*)?)?'
const NAME = '[a-zA-Z][a-zA-Z0-9-]*'
const ARG = '(?:\\[(?<arg>[a-z0-9.@+-]*)\\]?)?'
const MARKERS = '(?:\\(\\+?\\)?)?(?:\\{\\+?\\}?)?'
const LINK = '(?:@(?<link>\\S+))?'

// slot order: ':' name '#ref' '[arg]' '(+)' '{+}' ':'(leaf) '@link'
const LEAF = new RegExp(`^:(?<name>${NAME})${REF}${ARG}${MARKERS}:${LINK}$`)
const OPEN = new RegExp(`^:(?<name>${NAME})${REF}${ARG}${MARKERS}${LINK}$`)
const CLOSE = /^([a-zA-Z][a-zA-Z0-9-]*):$/

const slots = (m: RegExpMatchArray) => {
  const g = m.groups as Record<string, string | undefined>
  return { name: g.name!, ref: g.ref, arg: g.arg, link: g.link }
}

/** splits a line into its tokens, including glued ones (`:div:h1:`) */
function lexLine(text: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < text.length) {
    let j = i
    if (text[j] === ':') {
      j++
      while (j < text.length && /[a-zA-Z0-9-]/.test(text[j]!)) j++
      if (text[j] === '#') {
        j++
        while (j < text.length && /[a-zA-Z0-9-]/.test(text[j]!)) j++
      }
      if (text[j] === '[') {
        j++
        while (j < text.length && text[j] !== ']') j++
        if (text[j] === ']') j++
      }
      while (text[j] === '(' || text[j] === '{' || text[j] === '+' || text[j] === ')' || text[j] === '}') j++
      if (text[j] === ':') {
        // a leaf close, unless it starts the next token
        const next = text[j + 1]
        if (!next || !/[a-zA-Z]/.test(next)) j++
        else if (text.slice(j).match(/^:[a-zA-Z][a-zA-Z0-9-]*[:[(@{]/)) {
          // the ':' opens the next token
        } else j++
      }
      if (text[j] === '@') {
        j++
        while (j < text.length && !/\s/.test(text[j]!)) j++
      }
    } else {
      while (j < text.length && /[a-zA-Z0-9-]/.test(text[j]!)) j++
      if (text[j] === ':') j++
    }
    if (j === i) j++
    tokens.push(text.slice(i, j))
    i = j
  }
  return tokens
}

/** Parse a stored page document into a tree. Salvage only. */
export function parseLegacyCode(code: string): ElementNode[] {
  const root: ElementNode[] = []
  const stack: ElementNode[] = []
  const append = (node: ElementNode) => {
    const parent = stack[stack.length - 1]
    ;(parent ? parent.children : root).push(node)
  }
  const make = (name: string, m: RegExpMatchArray) => {
    const { ref, arg, link } = slots(m)
    const node = createNode(name)
    if (arg && arg !== '+') node.arg = arg
    if (ref) node.ref = ref
    if (link) node.link = link === 'item' ? '@item' : link
    return node
  }

  for (const line of code.split('\n')) {
    for (const token of lexLine(line.trim())) {
      const leaf = token.match(LEAF)
      if (leaf) {
        const { name } = slots(leaf)
        if (isKnownElement(name) || isComponentType(name)) append(make(name, leaf))
        continue
      }
      const open = token.match(OPEN)
      if (open) {
        const { name } = slots(open)
        if (isKnownElement(name) || isComponentType(name)) {
          const node = make(name, open)
          append(node)
          stack.push(node)
        }
        continue
      }
      const close = token.match(CLOSE)
      if (close) {
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i]!.type === close[1]) {
            stack.length = i
            break
          }
        }
      }
    }
  }
  return root
}
