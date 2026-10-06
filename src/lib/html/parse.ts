import { FORBIDDEN_TAGS, isLenientVoidTag, isLeafType, isRenderableType, typeForTag } from './tags'

/**
 * The strict reader for the agent-facing HTML subset.
 *
 * Hand-rolled, and deliberately not parse5 or any other HTML5 parser: they all
 * lowercase tag names, and a lowercased tag name cannot tell `<Card>` from
 * `<card>`, which is how a component instance is spelled.
 *
 * Lenient in, canonical out. It accepts what a model naturally writes — a void
 * tag without the self-closing slash, a lowercase component name, comments,
 * numeric entities, a `<div>` of plain text — and refuses, with `line:col`,
 * everything that would make a write silently mean something else: an unknown
 * tag, a mismatched or unclosed tag, a duplicate attribute, an unquoted value,
 * an `on*` handler, a `<script>`, text loose inside a container. The
 * discipline is JSX's, which models already follow.
 */

export interface ParsedNode {
  /** registry type, or a component name */
  type: string
  /** the tag as written, for a diagnostic that quotes the author back */
  tag: string
  /** every attribute as written, names lowercased, values entity-decoded */
  attrs: Record<string, string>
  children: ParsedNode[]
  /** a LEAF's inner markup, raw — the caller runs it through `sanitizeRich` */
  text?: string
  /** where it was written, for a diagnostic the agent can act on */
  line: number
  col: number
}

export interface ParseError {
  message: string
  line: number
  col: number
}

export interface ParseResult {
  roots: ParsedNode[]
  errors: ParseError[]
  /** things that read differently from how they were written, worth saying */
  notes: string[]
}

export const MAX_INPUT = 2_000_000
export const MAX_DEPTH = 64
const MAX_ERRORS = 20

const TAG_NAME = /^[A-Za-z][A-Za-z0-9-]*/
const ATTR_NAME = /^[A-Za-z_:][A-Za-z0-9_:.-]*/

export function parseHtml(input: string, components: string[] = []): ParseResult {
  const errors: ParseError[] = []
  const notes: string[] = []
  const roots: ParsedNode[] = []

  if (input.length > MAX_INPUT) {
    return {
      roots,
      errors: [
        {
          message:
            `input is ${input.length} bytes; the limit is ${MAX_INPUT}. ` +
            'Write one subtree at a time (edit_structure) rather than the whole page.',
          line: 1,
          col: 1,
        },
      ],
      notes,
    }
  }

  // line starts, once: an offset→line lookup per element would otherwise make
  // reading a large page quadratic
  const lineStarts = [0]
  for (let k = 0; k < input.length; k++) if (input[k] === '\n') lineStarts.push(k + 1)
  const at = (offset: number) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid]! <= offset) lo = mid
      else hi = mid - 1
    }
    return { line: lo + 1, col: offset - lineStarts[lo]! + 1 }
  }
  const fail = (offset: number, message: string) => {
    if (errors.length >= MAX_ERRORS) return
    errors.push({ message, ...at(offset) })
  }

  const stack: ParsedNode[] = []
  /** refused open tags, by name, whose matching close must be swallowed so one
   * bad tag reports once instead of cascading */
  const unknownOpen = new Map<string, number>()
  const push = (node: ParsedNode) => {
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  let i = 0
  while (i < input.length && errors.length < MAX_ERRORS) {
    const lt = input.indexOf('<', i)
    if (lt === -1) {
      reportStrayText(input.slice(i), i)
      break
    }
    if (lt > i) reportStrayText(input.slice(i, lt), i)
    i = lt

    // --- comments and declarations: read and dropped ---
    if (input.startsWith('<!--', i)) {
      const end = input.indexOf('-->', i + 4)
      if (end === -1) return bail(i, 'unterminated comment')
      i = end + 3
      continue
    }
    if (input.startsWith('<!', i)) {
      const end = input.indexOf('>', i)
      if (end === -1) return bail(i, 'unterminated declaration')
      i = end + 1
      continue
    }

    // --- a close tag ---
    if (input[i + 1] === '/') {
      const match = TAG_NAME.exec(input.slice(i + 2))
      const end = input.indexOf('>', i)
      if (!match || end === -1) return bail(i, 'malformed closing tag')
      const tag = match[0]
      // the close of a tag we already refused on the way in. Its open was
      // reported and nothing was pushed, so without this the `</figure>` of an
      // `<figure>` we just named produced a SECOND error about not closing
      // whatever block it landed in — noise on top of the one real diagnostic,
      // and in a cascade it buries it.
      const skipping = unknownOpen.get(tag)
      if (skipping) {
        if (skipping === 1) unknownOpen.delete(tag)
        else unknownOpen.set(tag, skipping - 1)
        i = end + 1
        continue
      }
      const open = stack[stack.length - 1]
      if (!open) {
        fail(i, `</${tag}> closes nothing`)
        i = end + 1
        continue
      }
      if (open.tag !== tag) {
        return bail(i, `</${tag}> does not close <${open.tag}>, opened on line ${open.line}`)
      }
      stack.pop()
      i = end + 1
      continue
    }

    // --- an open tag ---
    const start = i
    const nameMatch = TAG_NAME.exec(input.slice(i + 1))
    if (!nameMatch) return bail(i, "'<' does not start a tag — write a literal one as &lt;")
    const tag = nameMatch[0]
    i += 1 + tag.length

    const head = readAttrs(tag, start)
    if (!head) return { roots, errors, notes }
    const { attrs, selfClosed } = head
    i = head.after

    /** a refused open tag whose close must be swallowed rather than reported */
    const refuseTag = (message: string) => {
      fail(start, message)
      if (!selfClosed && !isLenientVoidTag(tag)) {
        unknownOpen.set(tag, (unknownOpen.get(tag) ?? 0) + 1)
      }
    }

    if (FORBIDDEN_TAGS.has(tag.toLowerCase())) {
      refuseTag(`<${tag}> is never allowed; script and style belong in the project's custom code`)
      continue
    }

    const resolved = typeForTag(tag, attrs, components)
    if (!resolved || !isRenderableType(resolved.type)) {
      refuseTag(`unknown element <${tag}>`)
      continue
    }
    if (resolved.note && !notes.includes(resolved.note)) notes.push(resolved.note)

    const node: ParsedNode = {
      type: resolved.type,
      tag,
      attrs,
      children: [],
      ...at(start),
    }

    if (stack.length >= MAX_DEPTH) return bail(start, `nesting deeper than ${MAX_DEPTH} elements`)
    push(node)

    if (selfClosed || isLenientVoidTag(tag)) continue

    // A `<div>` of plain text is the text block, written the short way. Only
    // PLAIN text promotes: the moment there is markup inside, the element
    // could just as well be a container holding a `<span>`, and guessing would
    // be the kind of silent reinterpretation this format exists to avoid. The
    // explicit spelling (`<div data-type="text">`) always works, and is what
    // the canonical output emits.
    if (node.type === 'div') {
      const nextTag = input.indexOf('<', i)
      const inner = nextTag === -1 ? input.slice(i) : input.slice(i, nextTag)
      if (inner.trim() && input.startsWith(`</${tag}`, nextTag)) node.type = 'text'
    }

    // --- a leaf's inner markup is its CONTENT: taken raw, never parsed ---
    // rich copy carries <strong>/<a>/<br>, which are not elements of this
    // format; handing them to the tokenizer would refuse the write.
    if (isLeafType(node.type)) {
      const end = input.indexOf(`</${tag}`, i)
      if (end === -1) return bail(start, `<${tag}> is never closed`)
      node.text = input.slice(i, end)
      const gt = input.indexOf('>', end)
      i = gt === -1 ? input.length : gt + 1
      continue
    }

    stack.push(node)
  }

  for (const open of stack) {
    if (errors.length >= MAX_ERRORS) break
    errors.push({
      message: `<${open.tag}> is never closed`,
      line: open.line,
      col: open.col,
    })
  }

  return { roots, errors, notes }

  // ---- helpers ----

  /** a structural error leaves the rest of the input meaningless: stop, so the
   *  report is the one real problem rather than its echoes */
  function bail(offset: number, message: string): ParseResult {
    fail(offset, message)
    return { roots, errors, notes }
  }

  /** text outside an element: whitespace is layout, anything else would render
   *  nowhere */
  function reportStrayText(text: string, offset: number) {
    if (!text.trim()) return
    const parent = stack[stack.length - 1]
    const quoted = text.trim().slice(0, 40)
    // point at the TEXT, not at the newline and indentation in front of it
    fail(
      offset + (text.length - text.trimStart().length),
      parent
        ? `"${quoted}" sits directly inside <${parent.tag}>, which is a container. ` +
            'Put text in a text element: <p>, <span>, <h2>, or <div data-type="text">.'
        : `"${quoted}" is outside any element`,
    )
  }

  function readAttrs(
    tag: string,
    tagStart: number,
  ): { attrs: Record<string, string>; selfClosed: boolean; after: number } | null {
    const attrs: Record<string, string> = {}
    let k = i
    for (;;) {
      while (k < input.length && /\s/.test(input[k]!)) k++
      if (k >= input.length) {
        fail(tagStart, `<${tag}> is not closed with '>'`)
        return null
      }
      if (input[k] === '>') return { attrs, selfClosed: false, after: k + 1 }
      if (input[k] === '/' && input[k + 1] === '>') {
        return { attrs, selfClosed: true, after: k + 2 }
      }
      const nameMatch = ATTR_NAME.exec(input.slice(k))
      if (!nameMatch) {
        fail(k, `<${tag}>: '${input[k]}' does not start an attribute name`)
        return null
      }
      const name = nameMatch[0].toLowerCase()
      const nameAt = k
      k += nameMatch[0].length
      if (name.startsWith('on')) {
        fail(nameAt, `<${tag}>: '${name}' event handlers are never allowed`)
        return null
      }
      if (name in attrs) {
        fail(nameAt, `<${tag}>: '${name}' is written twice`)
        return null
      }
      while (k < input.length && /\s/.test(input[k]!)) k++
      if (input[k] !== '=') {
        // a bare attribute: its presence is the value (`<a download>`)
        attrs[name] = ''
        continue
      }
      k++
      while (k < input.length && /\s/.test(input[k]!)) k++
      const quote = input[k]
      if (quote !== '"' && quote !== "'") {
        fail(k, `<${tag}>: the value of '${name}' must be quoted`)
        return null
      }
      const end = input.indexOf(quote, k + 1)
      if (end === -1) {
        fail(k, `<${tag}>: the value of '${name}' is not closed`)
        return null
      }
      attrs[name] = decodeEntities(input.slice(k + 1, end))
      k = end + 1
    }
  }
}

/** the five XML entities plus numeric ones — what a model writes, and all this
 *  format promises to understand */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
