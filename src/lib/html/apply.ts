import type { ComponentDef, ElementNode, Project } from '@/types/editor'
import { alignStructure, isComponentType } from '../components'
import { createNode, isLeafElement } from '../elements'
import { findNode, walkNodes } from '../tree'
import { buildInstanceMap, canNest, isInstanceWrapper, type InstanceMapping } from '../instances'
import { isValidClass } from '../styles'
import { isAllowedAttribute, sanitizeAttributes } from '../shared/attributes.js'
import { isRich, sanitizeRich } from '../shared/richtext.js'
import { SAFE_SRC } from '../shared/urls.js'
import { isChannelName } from '../shared/interactionKeys.js'
import {
  validateContext,
  validateTree,
  type TreeDiagnostic,
  type ValidateContext,
} from '../validateTree'
import { clearBindingsToIds, pageHost, masterHost, type StructureHost } from '../treeOps'
import { decodeEntities, type ParsedNode } from './parse'
import { nodesByShortId } from './ids'
import { ELIDED_DATA_URL } from './serialize'
import { impliedAttrs, isLeafType, sameType, SLOT_FILL_TYPE, SOURCE_TYPES } from './tags'

/**
 * Writing HTML back onto the tree.
 *
 * This is the one place node identity is still MATCHED rather than simply
 * kept, and it is the reason `reconcile` existed: an agent hands back a
 * document, and every node it did not mean to replace has to survive with its
 * id, its interactions, its translations and its comment anchors. The order is
 * `data-id`, then `data-ref`, then a tree LCS — mostly keyed by ids the agent
 * echoed back, which makes it far simpler than the text heuristics it
 * replaces, and it runs only for agents, never on a drag.
 *
 * Everything the HTML does not carry (interactions, animations, `locales`,
 * slider config, form config, `listQuery`, `entryId`, `instanceAttributes`) is
 * preserved on
 * every adopted node, because the node OBJECT itself is reused.
 *
 * A refusal is never silent. Reporting success for a write that renders
 * nowhere is the bug class this format exists to remove, so anything that
 * cannot land — a class inside a component instance, an invalid class token,
 * an unusable `src`, structure where a part was expected — comes back named.
 */

export interface Refusal {
  /** a readable path to the element: `section > Card#promo > span` */
  path: string
  message: string
}

export interface ApplyResult {
  kept: number
  created: number
  removed: number
  /** what did NOT land, and why */
  refused: Refusal[]
  /** what landed but is worth saying out loud */
  warnings: Refusal[]
  diagnostics: TreeDiagnostic[]
}

export interface ApplyOptions {
  project: Project
  /** the component, when the root being written is a master */
  def?: ComponentDef | null
  /** validation context; omitted = derived from the project */
  validate?: ValidateContext
  /**
   * `parsed` is the root's CHILDREN, always — never the root element itself.
   *
   * For a caller writing into a throwaway holder (edit_structure's insert and
   * wrap ops), the single-root shortcut below is a trap: the holder is typed
   * after the real parent, so a `<div>` going into a `<div>` was adopted onto
   * the holder and the holder is discarded. The wrap op's wrapper came out
   * undefined and an insert lost the element it was asked to place.
   */
  asChildren?: boolean
  /**
   * Resolve a bundled icon NAME to its sanitized `<svg>` markup, so
   * `data-icon="mail"` works as a write form and not only as an echo.
   *
   * Injected, never imported: the Lucide table is ~330 KB and must stay out of
   * the browser bundle and out of the MCP runtime bundle, so the caller (which
   * already loads it lazily) supplies the lookup. Without it a changed
   * `data-icon` is refused, which is what every writer used to do — and
   * `set_page_html` accepted the echoed `lucide:…` form while
   * `create_component` refused the plain one, so the guide's own example
   * (`<svg data-icon="mail" />`) worked in one writer and not the other (E21).
   */
  resolveIcon?: (name: string) => string | null
}

/**
 * Attribute names an agent reaches for instead of `source` / `data-field`.
 *
 * `data-*` is otherwise authorable, so without this a plausible near miss
 * lands as a custom DOM attribute and binds NOTHING, reported as success. The
 * only clue was a downstream "Unknown collection" diagnostic on a list, and on
 * a leaf there was none at all.
 */
const NEAR_MISS_BINDINGS = new Set([
  'data-source',
  'data-collection',
  'data-list',
  'collection',
  'field',
  'data-bind',
])

/** a node's shallow identity for the LCS: what its own tag encodes */
const signature = (node: { type: string; arg?: string; link?: string }) =>
  `${node.type}|${node.arg ?? ''}|${node.link ?? ''}`

const parsedSignature = (node: ParsedNode) =>
  `${node.type}|${argOf(node) ?? ''}|${node.attrs.href ?? ''}`

function argOf(node: ParsedNode): string | undefined {
  const raw = SOURCE_TYPES.has(node.type) ? node.attrs.source : node.attrs['data-field']
  return raw || undefined
}

/**
 * Longest-common-subsequence alignment of two signature lists → a map from
 * b-index to the a-index it matches. The same primitive the component adoption
 * and the instance realign use, so identity is carried the same way
 * everywhere: a removed sibling no longer shifts the survivors onto each
 * other's nodes.
 */
function lcsAlign(a: string[], b: string[]): Map<number, number> {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const map = new Map<number, number>()
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      map.set(j, i)
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++
    else j++
  }
  return map
}

/**
 * Apply a parsed document to an existing root.
 *
 * `parsed` is either the root element itself (a `<body>`, or a component's own
 * tag) or just its children — the root element is optional on input, because
 * an agent writing a page body naturally writes the elements and nothing
 * around them. Written out, the root's own attributes are applied too; left
 * out, they are left alone.
 */
export function applyHtml(
  root: ElementNode,
  parsed: ParsedNode[],
  opts: ApplyOptions,
): ApplyResult {
  const result: ApplyResult = {
    kept: 0,
    created: 0,
    removed: 0,
    refused: [],
    warnings: [],
    diagnostics: [],
  }
  const project = opts.project
  const components = project.components ?? []
  const host: StructureHost = opts.def ? masterHost(opts.def) : pageHost(root)

  let topAttrs: Record<string, string> | null = null
  let children = parsed
  if (!opts.asChildren && parsed.length === 1 && sameType(parsed[0]!.type, root.type)) {
    topAttrs = parsed[0]!.attrs
    children = parsed[0]!.children
  }

  const before = new Set<string>()
  walkNodes([root], (n) => before.add(n.id))

  const mapped: Map<string, InstanceMapping> = buildInstanceMap(
    [root],
    opts.def ? [opts.def, ...components.filter((c) => c !== opts.def)] : components,
  )
  const refuse = (path: string, message: string) => result.refused.push({ path, message })
  const warn = (path: string, message: string) => result.warnings.push({ path, message })

  /** classes already reported in THIS write — see setClasses */
  const reportedClasses = new Set<string>()

  /** a readable address for a refusal: the element, with its ref when it has one */
  const name = (node: ElementNode) => (node.ref ? `${node.type}#${node.ref}` : node.type)
  const under = (parent: string, node: ElementNode) => `${parent} > ${name(node)}`

  // --- the claims, document-wide and BEFORE any LCS ---
  //
  // An agent may MOVE a node to another parent; it is still the same node, so
  // a `data-id` or `data-ref` claim is resolved across the whole document
  // first. Doing it per level would let one level's LCS take a node that a
  // deeper level addressed by id, which is the one thing an echoed id must
  // never lose to a guess.
  //
  // A node INSIDE an instance is deliberately not in the index. Its structure
  // is the master's, and it is addressed positionally as a part — letting a
  // `data-id` pull one out to another parent would both contradict the format
  // and leave it in two places at once, because `fillInstance` does not rebuild
  // the children array it came from.
  const addressable = [root]
  walkNodes([root], (n) => {
    const mapping = mapped.get(n.id)
    if (!mapping || isInstanceWrapper(mapping)) addressable.push(n)
  })
  const byKey = nodesByShortId([root])
  // every id in the tree, addressable or not: a node INSIDE an instance is a
  // positional part and carries its id in the read, so echoing it back is
  // normal and must stay silent. Only an id that names nothing at all is
  // worth reporting.
  const known = new Set(byKey.keys())
  for (const [key, node] of [...byKey]) if (!addressable.includes(node)) byKey.delete(key)
  const byRef = new Map<string, ElementNode>()
  for (const node of addressable) if (node.ref) byRef.set(node.ref, node)
  const claim = new Map<ParsedNode, ElementNode>()
  const claimed = new Set<ElementNode>()
  const eachParsed = (nodes: ParsedNode[], visit: (n: ParsedNode) => void) => {
    for (const node of nodes) {
      visit(node)
      eachParsed(node.children, visit)
    }
  }
  //
  // A claim that cannot be honoured is REPORTED, never dropped quietly. It
  // used to `return` on all three conditions, and the duplicate was the one
  // that bit: echo one id onto two elements — what copy-pasting a block during
  // a restructure looks like — and the FIRST in document order took the node,
  // so an overlay's close binding silently moved onto a new trigger wrapper
  // while the response said `kept: 3, created: 1, refused: []`. `kept` counts
  // an LCS pairing exactly as it counts a claim, so nothing downstream could
  // tell "adopted the node you named" from "adopted a different one".
  for (const pass of ['data-id', 'data-ref'] as const) {
    eachParsed(children, (node) => {
      if (claim.has(node)) return
      const key = node.attrs[pass]
      if (!key) return
      const found = pass === 'data-id' ? byKey.get(key) : byRef.get(key)
      const at = `${name(root)} > ${node.type}`
      if (!found) {
        // an id that names a node the write cannot address by id — a part
        // inside an instance — is the ordinary round-trip and says nothing.
        // An id that names NOTHING is a stale or foreign read, and the element
        // it is on carries none of the identity the agent meant to keep.
        if (pass === 'data-id' && !known.has(key)) {
          warn(
            at,
            `data-id="${key}" matches nothing here, so it carried no identity: this element ` +
              'was matched by position, or created new. Check it against your last read.',
          )
        }
        return
      }
      if (claimed.has(found)) {
        refuse(
          at,
          `${pass}="${key}" is on two elements in this write. One id is one node: honouring ` +
            'the first would silently move that node — with its interactions and its ' +
            'translations — onto whichever element you listed first. Give the new element no ' +
            `${pass} and it is created fresh.`,
        )
        return
      }
      if (!sameType(found.type, node.type)) {
        // a legitimate retype (a div becoming a section) is written WITHOUT the
        // old id; echoing it asks for two incompatible things at once
        warn(
          at,
          `${pass}="${key}" names a <${found.type}>, not a <${node.type}> — the id is ignored ` +
            'and this element is matched by position instead. To change an element\'s type, ' +
            'write it without the id (it is a new node), or keep the type and the id together.',
        )
        return
      }
      claim.set(node, found)
      claimed.add(found)
    })
  }

  // the root itself: its own state, never its structure
  if (topAttrs) {
    applyState(root, { ...bare(root.type), attrs: topAttrs }, root.type)
  }
  alignLevel(root, children, name(root))

  // --- what went, goes properly ---
  const after = new Set<string>()
  walkNodes([root], (n) => after.add(n.id))
  const gone = new Set<string>()
  for (const id of before) if (!after.has(id)) gone.add(id)
  result.removed = gone.size
  clearBindingsToIds(host, gone)

  result.diagnostics = validateTree(root, opts.validate ?? contextFromProject(project))
  return result

  // ---------------------------------------------------------------- helpers

  function bare(type: string): ParsedNode {
    return { type, tag: type, attrs: {}, children: [], line: 0, col: 0 }
  }

  /**
   * Pair this level's parsed children with the existing ones, then recurse.
   *
   * The claims are already in; what is left is aligned by an LCS on the
   * shallow signature (type, binding, link), then by type alone for whatever
   * that left over. Anything still unpaired is new.
   */
  function alignLevel(parent: ElementNode, parsedChildren: ParsedNode[], path: string): void {
    const existing = parent.children
    const freeOld = existing
      .map((node, i) => ({ node, i }))
      .filter(({ node }) => !claimed.has(node))
    const freeNew = parsedChildren
      .map((node, i) => ({ node, i }))
      .filter(({ node }) => !claim.has(node))

    for (const signatures of [
      () =>
        [
          freeOld.map(({ node }) => signature(node)),
          freeNew.map(({ node }) => parsedSignature(node)),
        ] as const,
      () =>
        [freeOld.map(({ node }) => node.type), freeNew.map(({ node }) => node.type)] as const,
    ]) {
      const [a, b] = signatures()
      for (const [nj, oj] of lcsAlign(a, b)) {
        const target = freeNew[nj]
        const source = freeOld[oj]
        if (!target || !source) continue
        if (claim.has(target.node) || claimed.has(source.node)) continue
        if (!sameType(source.node.type, target.node.type)) continue
        claim.set(target.node, source.node)
        claimed.add(source.node)
      }
    }

    const next: ElementNode[] = []
    for (const child of parsedChildren) {
      // `<slot>` is a marker, not an element: it means something only as a
      // component instance's single child (see fillInstance). Anywhere else it
      // would be stored as structure that renders nothing, so it is refused by
      // name rather than created.
      if (child.type === SLOT_FILL_TYPE) {
        refuse(
          path,
          '<slot> only fills a component instance\'s slot — write it as the ONE child of a ' +
            '<Component>, like <Shell><slot>…</slot></Shell>',
        )
        continue
      }
      let adopted = claim.get(child)
      // a claim must never make a node its own ancestor. An agent can write a
      // document that nests an element inside its own subtree, and a cycle in
      // the tree is unrecoverable — every walk loops forever.
      if (adopted && (adopted === parent || !!findNode([adopted], parent.id))) {
        refuse(
          `${path} > ${name(adopted)}`,
          `<${child.tag}> is written inside its own subtree; it is kept where it was and a new ` +
            'element is created here',
        )
        claim.delete(child)
        adopted = undefined
      }
      const node = adopted ?? createNode(child.type)
      if (adopted) result.kept++
      else {
        result.created++
        claim.set(child, node)
        claimed.add(node)
      }
      const childPath = under(path, node)
      applyState(node, child, child.type, childPath)
      if (isComponentType(node.type)) fillInstance(node, child, childPath)
      else if (!isLeafType(node.type)) alignLevel(node, child.children, childPath)
      next.push(node)
    }
    parent.children = next
  }

  /**
   * A component instance.
   *
   * Self-closed (`<Card />`) means "this instance, as the component defines
   * it": the subtree is realigned to the master, which fills a fresh instance
   * and leaves an existing one's per-instance content exactly as it was.
   *
   * Written out (`<Card>…</Card>`) fills its PARTS: the structure has to match
   * the master, and only content, media and `alt` are taken. That is what
   * makes a page of eight filled-in Cards ONE write. Classes or a different
   * element inside are refused by name, because every renderer reads a mapped
   * node's classes from the master — one written here would render nowhere
   * while the write reported success.
   */
  function fillInstance(node: ElementNode, parsed: ParsedNode, path: string): void {
    const def = components.find((c) => c.name === node.type)
    if (!def) return // validateTree reports the unknown component, with its id

    // a master may never end up holding itself, at any distance
    if (opts.def && !canNest(components, opts.def.name, def.name)) {
      refuse(path, `<${def.name}> can't go inside <${opts.def.name}>: a component can't hold itself`)
      return
    }
    alignStructure(node, def.root)
    if (!parsed.children.length) return

    // `<Name><slot>…</slot></Name>`: fill the component's SLOT and leave every
    // other part exactly as it was.
    //
    // Without it, an instance's interior has to match its master node for
    // node, so putting page-specific content into a slot three levels down
    // meant re-typing the whole shell — header, progress bar, footer — on
    // every page, nine times for one funnel, and every copy stale the moment
    // the shell changed. The alternative was two calls and an id lookup per
    // page. The slot's own children are ordinary page structure (the resolver
    // leaves them unmapped), so they are adopted by id/ref/LCS like any other
    // level, which is what carries their identity across rewrites.
    if (parsed.children.length === 1 && parsed.children[0]!.type === SLOT_FILL_TYPE) {
      const marker = parsed.children[0]!
      const slots: { instance: ElementNode; master: ElementNode }[] = []
      const findSlots = (instance: ElementNode[], master: ElementNode[]) => {
        const length = Math.min(instance.length, master.length)
        for (let i = 0; i < length; i++) {
          const below = master[i]!
          const target = instance[i]!
          if (below.slot) slots.push({ instance: target, master: below })
          // never DOWN into a component this one holds: that slot belongs to
          // the nested instance, and filling it from out here would be the
          // positional guess this format exists to avoid
          else if (!isComponentType(below.type)) findSlots(target.children, below.children)
        }
      }
      findSlots(node.children, def.root.children)
      if (slots.length !== 1) {
        refuse(
          path,
          slots.length === 0
            ? `<${def.name}> has no slot, so <slot> has nothing to fill here. Write its parts ` +
                `out, or mark a container in the component as a slot ` +
                `(edit_elements {componentId, slot: true}).`
            : `<${def.name}> has ${slots.length} slots, and <slot> cannot say which one. Write ` +
                'its parts out so each one is addressed by position.',
        )
        return
      }
      const slot = slots[0]!
      alignLevel(slot.instance, marker.children, under(path, slot.instance))
      return
    }

    //
    // `owner` is the component whose parts THIS level belongs to — the host at
    // the top, and the nested component once the walk steps into one. It used
    // to be `def.name` all the way down, so a `<Button>` inside a `<Card>` that
    // had to be written out was reported as "<Card> has 1 part here", naming a
    // component the agent had written correctly.
    const fill = (
      instance: ElementNode[],
      master: ElementNode[],
      written: ParsedNode[],
      at: string,
      owner: string,
    ) => {
      if (written.length !== master.length) {
        refuse(
          at,
          `<${owner}> has ${master.length} part${master.length === 1 ? '' : 's'} here and ` +
            `${written.length} ${written.length === 1 ? 'was' : 'were'} written. Write ` +
            `<${owner} /> to leave its parts alone, or change the component itself with ` +
            'update_component.',
        )
        return
      }
      written.forEach((child, i) => {
        const target = instance[i]
        const below = master[i]
        if (!target || !below) return
        const childPath = under(at, target)
        if (child.type === SLOT_FILL_TYPE) {
          // the shorthand is all-or-nothing: mixed with written-out parts there
          // is no way to tell which level it belongs to
          refuse(
            childPath,
            `<slot> cannot sit beside written-out parts of <${owner}> — either write <slot> as ` +
              `the one child of <${owner}>, or address this slot by position with its own tag`,
          )
          return
        }
        if (!sameType(target.type, child.type)) {
          refuse(
            childPath,
            `part ${i + 1} of <${owner}> is a <${target.type}>, not a <${child.tag}>`,
          )
          return
        }
        fillPart(target, child, owner, childPath)
        // a slot's children are this instance's own structure: written like
        // any other level of the page, adopted by id/ref/LCS
        if (below.slot) alignLevel(target, child.children, childPath)
        // stepping into a nested instance hands ownership to IT: its parts are
        // the inner component's, and so is the name a refusal has to say
        else {
          fill(
            target.children,
            below.children,
            child.children,
            childPath,
            isComponentType(below.type) ? below.type : owner,
          )
        }
      })
    }
    fill(node.children, def.root.children, parsed.children, path, def.name)
  }

  /**
   * One part of an instance.
   *
   * What an instance owns is its CONTENT, its media, its per-placement `alt`,
   * its hidden flag, its field-bound attributes and its `htmlId` — a per-page
   * anchor. Everything else on a mapped node (its classes, its binding, its
   * link, its shared attributes) is the master's: every renderer reads those
   * from there, so one written here would render nowhere. Writing back what
   * the read showed is therefore a no-op, and CHANGING it is refused with the
   * tool that can actually do it.
   */
  function fillPart(node: ElementNode, parsed: ParsedNode, component: string, path: string): void {
    const shared = (attr: string, current: string | undefined) => {
      if ((parsed.attrs[attr] ?? '') === (current ?? '')) return
      refuse(
        path,
        `'${attr}' inside <${component}> is the component's, not this instance's — ` +
          'change it with update_component',
      )
    }
    const implied = impliedAttrs(node.type)

    for (const [attr, value] of Object.entries(parsed.attrs)) {
      switch (true) {
        case attr === 'data-id':
        case attr === 'data-type':
        case attr === 'data-interactions':
        case attr === 'data-animations':
          break

        case implied[attr] !== undefined:
          break // part of the element's identity, not state

        case attr === 'id':
          assign(node, 'htmlId', value)
          break

        case attr === 'src':
          setSrc(node, value, path)
          break

        case attr === 'alt': {
          // per-placement attribute text: what lets one component serve
          // "Search contacts" and "Your email" without copying its classes
          const attrs = { ...(node.instanceAttributes ?? {}) }
          if (value) attrs.alt = value
          else delete attrs.alt
          assignObject(node, 'instanceAttributes', attrs)
          break
        }

        case attr === 'data-hidden':
          setHidden(node, value)
          break

        // the slot flag is the component's; reading it back is a no-op
        case attr === 'data-slot':
          break

        // …and so is the channel: it is declared once, on the master, and
        // every instance listens. A per-instance override would mean two
        // listeners for one overlay.
        case attr === 'data-channel':
          if ((value || '') !== (node.channel || '')) {
            refuse(
              path,
              `the channel is <${component}>'s, not this instance's — change it with ` +
                'update_component',
            )
          }
          break

        case attr === 'data-icon':
          setIcon(node, value, path)
          break

        case attr.startsWith('data-bind-'):
          setFieldAttr(node, attr.slice('data-bind-'.length), value, path)
          break

        case attr === 'data-ref':
          refuse(
            path,
            'a ref inside a component instance would be duplicated on every instance — put it ' +
              `on the <${component}> element instead`,
          )
          break

        case attr === 'class':
          refuse(
            path,
            `a class inside <${component}> renders nowhere: a mapped node wears the component's. ` +
              'Style the component instead.',
          )
          break

        case attr === 'href': {
          // THIS placement's destination, not the component's. Every renderer
          // already resolves a link own-first (`node.link ?? master.link`), so
          // a per-instance href renders correctly; it was refused here, and
          // copied back over by the push, which is what made a Button
          // component unable to be a link.
          //
          // Written as given, NOT normalized against what it inherits: the
          // old copy-down left every instance holding a copy of its master's
          // link, and deleting those here would make a plain round-trip
          // rewrite the stored tree. `adoptCodeOwned` drops a redundant copy
          // on the next push, where changing the data is the point.
          // `href=""` clears an override back to the master's.
          assign(node, 'link', value)
          break
        }
        case attr === 'source':
          shared(attr, node.arg)
          break

        case attr === 'data-field':
          // the generic shared-attribute advice ("change it with
          // update_component") is actively wrong for a binding: putting the
          // field on the component's own part binds EVERY instance of it to
          // that one field, which is never what a per-entry value wants.
          if ((parsed.attrs['data-field'] ?? '') !== (node.arg ?? '')) {
            refuse(
              path,
              `'data-field' inside <${component}> would bind EVERY <${component}> on the site ` +
                'to that field — a binding is the component\'s, not this instance\'s. Draw the ' +
                'per-entry value with an element the page (or the surrounding component) owns, ' +
                `beside the <${component}> rather than inside it.`,
            )
          }
          break

        case NEAR_MISS_BINDINGS.has(attr):
          refuse(path, `'${attr}' binds nothing — a field binding is 'data-field'`)
          break

        default:
          shared(attr, node.attributes?.[attr])
      }
    }

    // an attribute the agent dropped is a removal here too, for the keys this
    // placement owns
    const has = (attr: string) => parsed.attrs[attr] !== undefined
    if (!has('id') && node.htmlId !== undefined) delete node.htmlId
    if (!has('src') && node.src !== undefined) delete node.src
    // a dropped href means "this placement adds nothing", i.e. back to the
    // master's link — the same thing an absent href means on the way in
    if (!has('href') && node.link !== undefined) delete node.link
    if (!has('data-hidden') && node.hidden !== undefined) delete node.hidden
    if (!has('alt') && node.instanceAttributes?.alt !== undefined) {
      const attrs = { ...node.instanceAttributes }
      delete attrs.alt
      assignObject(node, 'instanceAttributes', attrs)
    }
    const fields: Record<string, string> = {}
    for (const [attr, field] of Object.entries(node.fieldAttrs ?? {})) {
      if (has(`data-bind-${attr}`)) fields[attr] = field
    }
    assignObject(node, 'fieldAttrs', fields)

    if (parsed.text !== undefined && isLeafType(node.type)) setContent(node, parsed, path)
  }

  // ---------------------------------------------------------------- state

  function applyState(node: ElementNode, parsed: ParsedNode, type: string, path = name(node)) {
    const isInstance = isComponentType(type)
    // an alias keeps its own type: `container` and `div` render identically, so
    // rewriting one as the other would be churn with no effect
    if (!sameType(node.type, type)) node.type = type

    const implied = impliedAttrs(type)
    for (const [attr, value] of Object.entries(parsed.attrs)) {
      switch (true) {
        // addressing, and read-only information
        case attr === 'data-id':
        case attr === 'data-type':
        case attr === 'data-interactions':
        case attr === 'data-animations':
          break

        // `type="checkbox"` IS the element, not an attribute on it
        case implied[attr] !== undefined:
          break

        case attr === 'data-ref':
          setRef(node, value, path)
          break

        case attr === 'data-slot':
          setSlot(node, parsed, path)
          break

        case attr === 'data-channel':
          setChannel(node, value, isInstance, parsed.tag, path)
          break

        case attr === 'class':
          if (isInstance) {
            refuse(
              path,
              `a class on <${parsed.tag}> renders nowhere: an instance wrapper emits no element ` +
                "of its own, and its look is the component's. Style the component instead.",
            )
          } else setClasses(node, value, path)
          break

        case attr === 'id':
          assign(node, 'htmlId', value)
          break

        case attr === 'source':
          if (!SOURCE_TYPES.has(type)) {
            refuse(path, `<${parsed.tag}> takes no 'source'; a field binding is 'data-field'`)
          } else assign(node, 'arg', value)
          break

        case attr === 'data-field':
          if (SOURCE_TYPES.has(type)) {
            refuse(path, `<${parsed.tag}> binds a whole collection with 'source', not 'data-field'`)
          } else if (isInstance) {
            refuse(path, `<${parsed.tag}> emits no element, so it has nothing to bind`)
          } else assign(node, 'arg', value)
          break

        case attr === 'href':
          if (isInstance) refuse(path, `<${parsed.tag}> emits no element, so it has no link`)
          else assign(node, 'link', value)
          break

        case attr === 'src':
          setSrc(node, value, path)
          break

        case attr === 'data-hidden':
          setHidden(node, value)
          break

        case attr === 'data-icon':
          setIcon(node, value, path)
          break

        case NEAR_MISS_BINDINGS.has(attr):
          refuse(
            path,
            SOURCE_TYPES.has(type)
              ? `'${attr}' binds nothing — <${parsed.tag}> takes a whole collection as 'source'`
              : `'${attr}' binds nothing — a field binding is 'data-field'`,
          )
          break

        case attr.startsWith('data-bind-'):
          setFieldAttr(node, attr.slice('data-bind-'.length), value, path)
          break

        case attr.startsWith('data-variant-'):
          if (!isInstance) {
            refuse(path, `only a component instance wears a variant; <${parsed.tag}> does not`)
          } else setVariant(node, attr.slice('data-variant-'.length), value)
          break

        default:
          if (isInstance) {
            refuse(
              path,
              `'${attr}' on <${parsed.tag}> belongs to the component — change it with ` +
                'update_component, or use edit_elements {instanceAttributes} for this placement',
            )
          } else if (!isAllowedAttribute(attr)) {
            refuse(path, `'${attr}' is not an allowed attribute`)
          } else setAttr(node, attr, value)
      }
    }

    // an attribute the agent DROPPED is a removal: the document it wrote is
    // the whole truth for everything the format carries, or an attribute could
    // never be taken off again
    pruneAbsent(node, parsed, isInstance, () => path)
    if (!isInstance && isLeafType(type) && parsed.text !== undefined) {
      setContent(node, parsed, path)
    }
  }

  function pruneAbsent(
    node: ElementNode,
    parsed: ParsedNode,
    isInstance: boolean,
    pathFor: (n: ElementNode) => string,
  ) {
    const has = (attr: string) => parsed.attrs[attr] !== undefined
    if (!has('data-ref') && node.ref !== undefined) delete node.ref
    if (!has('id') && node.htmlId !== undefined) delete node.htmlId
    if (!has('data-hidden') && node.hidden !== undefined) delete node.hidden
    if (!has('data-channel') && node.channel !== undefined) delete node.channel
    // only a master write may take a slot away; on a page the flag is the
    // component's, and the serializer prints it, so an echo keeps it
    if (opts.def && !has('data-slot') && node.slot !== undefined) delete node.slot
    if (!has(SOURCE_TYPES.has(node.type) ? 'source' : 'data-field') && node.arg !== undefined) {
      delete node.arg
    }
    if (isInstance) {
      // the wrapper carries only its picks; everything else is the component's.
      // Existing axes keep their key ORDER: `computeMerge` compares a whole
      // object's JSON, so re-ordering two picks would read as a conflict.
      const written = new Map<string, string>()
      for (const [attr, value] of Object.entries(parsed.attrs)) {
        if (attr.startsWith('data-variant-')) written.set(attr.slice('data-variant-'.length), value)
      }
      const picks: Record<string, string> = {}
      for (const axis of Object.keys(node.variants ?? {})) {
        const value = written.get(axis)
        if (value) picks[axis] = value
        written.delete(axis)
      }
      for (const [axis, value] of written) if (value) picks[axis] = value
      assignObject(node, 'variants', picks)
      return
    }
    if (node.variants !== undefined) delete node.variants
    if (!has('href') && node.link !== undefined) delete node.link
    if (!has('class') && node.classes !== undefined) {
      // The document is the whole truth, so an absent `class` CLEARS the
      // classes — which is right, and is also the easiest way to wipe a
      // component's styling by writing its structure out from memory. Named,
      // not silent: a deliberate removal is written as `class=""` or by listing
      // what remains, so an unmentioned `class` on a styled element is almost
      // always an accident.
      if (node.classes.trim()) {
        warn(
          pathFor(node),
          `had classes ("${node.classes.trim()}") and the markup gives it none, so they are ` +
            'gone. Write `class=""` if that was deliberate; otherwise echo the classes back.',
        )
      }
      delete node.classes
    }
    if (!has('src') && node.src !== undefined) delete node.src
    const implied = impliedAttrs(node.type)
    const attrs: Record<string, string> = {}
    for (const [attr, value] of Object.entries(node.attributes ?? {})) {
      if (has(attr) || implied[attr] !== undefined) attrs[attr] = value
    }
    assignObject(node, 'attributes', attrs)
    const fields: Record<string, string> = {}
    for (const [attr, field] of Object.entries(node.fieldAttrs ?? {})) {
      if (has(`data-bind-${attr}`)) fields[attr] = field
    }
    assignObject(node, 'fieldAttrs', fields)
  }

  function setRef(node: ElementNode, value: string, path: string) {
    const ref = value.trim()
    if (!ref) {
      delete node.ref
      return
    }
    if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(ref)) {
      refuse(path, `'${ref}' is not a valid ref — letters, digits and '-', starting with a letter`)
      return
    }
    if (node.type === 'body') {
      refuse(path, '<body> carries no ref: it is the page root and is already addressable')
      return
    }
    const mapping = mapped.get(node.id)
    if (mapping && !isInstanceWrapper(mapping)) {
      refuse(
        path,
        'a ref inside a component instance would be duplicated on every instance — put it on ' +
          `the <${mapping.def.name}> element instead`,
      )
      return
    }
    assign(node, 'ref', ref)
    byRef.set(ref, node)
  }

  /**
   * The `class` attribute is the WHOLE list, so a token the style catalog does
   * not model is KEPT and reported — every renderer and the exporter use
   * `node.classes` verbatim, so dropping one would change the published page.
   * What it costs is that the Style panel cannot show it as a control, which
   * is what the warning says.
   */
  function setClasses(node: ElementNode, value: string, path: string) {
    const tokens = value.split(/\s+/).filter(Boolean)
    // ONE warning per CLASS per write, naming the first element it appeared
    // on. It used to be one per element, and a utility the catalog does not
    // model is exactly the kind that appears on every second element of a
    // page: a single write came back with sixteen copies of the same sentence,
    // which is a tax on the context budget the guide tells agents to husband.
    // The second occurrence of a class says nothing the first did not.
    const unmodelled = tokens.filter((t) => !isValidClass(t) && !reportedClasses.has(t))
    if (unmodelled.length) {
      for (const t of unmodelled) reportedClasses.add(t)
      warn(
        path,
        `${unmodelled.map((t) => `'${t}'`).join(', ')} ` +
          `${unmodelled.length === 1 ? 'is' : 'are'} kept, but the Style panel has no control ` +
          `for ${unmodelled.length === 1 ? 'it' : 'them'}`,
      )
    }
    assign(node, 'classes', tokens.join(' '))
  }

  function setSrc(node: ElementNode, value: string, path: string) {
    // the read elides a `data:` URL (megabytes of base64 nobody can edit);
    // writing the marker back can only honestly mean "unchanged"
    if (value === ELIDED_DATA_URL) return
    if (value && !SAFE_SRC.test(value)) {
      refuse(path, `'${value}' is not a usable media URL — upload one with upload_media`)
      return
    }
    assign(node, 'src', value)
  }

  function setAttr(node: ElementNode, attr: string, value: string) {
    assignObject(
      node,
      'attributes',
      sanitizeAttributes({ ...(node.attributes ?? {}), [attr]: value }),
    )
  }

  function setFieldAttr(node: ElementNode, attr: string, field: string, path: string) {
    if (isComponentType(node.type)) {
      refuse(path, 'an instance wrapper emits no element, so an attribute has nowhere to land')
      return
    }
    if (!isAllowedAttribute(attr)) {
      refuse(path, `'${attr}' is not an allowed attribute, so it can't be bound to a field`)
      return
    }
    const next = { ...(node.fieldAttrs ?? {}) }
    if (field) next[attr] = field
    else delete next[attr]
    assignObject(node, 'fieldAttrs', next)
  }

  function setVariant(node: ElementNode, axis: string, option: string) {
    const next = { ...(node.variants ?? {}) }
    if (option) next[axis] = option
    else delete next[axis]
    assignObject(node, 'variants', next)
  }

  function setContent(node: ElementNode, parsed: ParsedNode, path: string) {
    const raw = parsed.text ?? ''
    // rich copy keeps its markup (sanitized); plain text is decoded, undoing
    // exactly what the serializer escaped. A custom-code block is raw HTML by
    // definition and is never sanitized: a read prints it escaped, so an echo
    // carries no `<` and is decoded; a write with real tags inside is taken
    // as written. (Whether the writer may ship it at all is the server's
    // call — protectedWriteDenial — not the parser's.)
    const text =
      node.type === 'custom-code'
        ? raw.includes('<')
          ? raw
          : decodeEntities(raw)
        : isRich(raw)
          ? sanitizeRich(raw)
          : decodeEntities(raw)
    if (!isLeafElement(node.type) && text.trim()) {
      refuse(path, `<${parsed.tag}> is a container — its words go in a child element`)
      return
    }
    assign(node, 'content', text)
  }

  /**
   * `data-slot` declares a SLOT on a component's master: a container whose
   * children are each instance's own. Only a master write can set one — on a
   * page the flag is the component's and arrives as an echo of the read.
   */
  function setSlot(node: ElementNode, parsed: ParsedNode, path: string) {
    if (!opts.def) return
    if (node === root) {
      refuse(path, "the component's own element can't be a slot — mark a container inside it")
      return
    }
    if (isComponentType(node.type) || isLeafType(node.type)) {
      refuse(
        path,
        `<${parsed.tag}> can't be a slot: a slot is a container of this component's own ` +
          '(a <div>, a <section>…) whose children each instance fills',
      )
      return
    }
    if (!node.slot) node.slot = true
  }

  /**
   * `data-channel` declares that this element LISTENS on a channel: every
   * binding in the project whose target is `@<name>` drives it, wherever it
   * was declared. Site-wide by definition, so the name is the address and a
   * malformed one reaches nothing.
   *
   * Refused on an instance wrapper for the same reason a class is: the wrapper
   * emits no element of its own, so the effect's classes would land nowhere
   * while the write reported success.
   */
  function setChannel(
    node: ElementNode,
    value: string,
    isInstance: boolean,
    tag: string,
    path: string,
  ) {
    if (isInstance) {
      refuse(
        path,
        `<${tag}> emits no element of its own, so it cannot listen on a channel — declare it ` +
          `on an element inside ${tag} with update_component`,
      )
      return
    }
    if (value === '') {
      delete node.channel
      return
    }
    if (!isChannelName(value)) {
      refuse(
        path,
        `'${value}' is not a channel name — lowercase letters, digits and hyphens, starting ` +
          'with a letter, at most 40 characters',
      )
      return
    }
    assign(node, 'channel', value)
  }

  /** `data-hidden` is the editor's hide, not the HTML `hidden` attribute: a
   *  bare one means true, and an explicit `false` is how an instance SHOWS a
   *  part its component hides */
  function setHidden(node: ElementNode, value: string) {
    const next = value !== 'false'
    if (node.hidden !== next) node.hidden = next
  }

  /**
   * `data-icon` names a bundled icon. Echoing back what the node already has
   * is a no-op (that is the round-trip); a DIFFERENT name sets the icon, when
   * the caller supplied a resolver for the table.
   *
   * `custom` is the serializer's word for "this svg is not a bundled icon", so
   * it is never a name to resolve — writing it back means "leave the markup
   * alone", which is exactly what an unchanged round-trip of a custom icon does.
   */
  function setIcon(node: ElementNode, value: string, path: string) {
    const name = value.trim()
    if (!name || name === iconNameOf(node) || name === 'custom') return
    const markup = opts.resolveIcon?.(name)
    if (markup) {
      node.svg = markup
      return
    }
    refuse(
      path,
      opts.resolveIcon
        ? `no bundled icon named "${name}" — find one with list_icons, or set custom markup with edit_elements {svg}`
        : `an icon's markup is not in the HTML here — set it with edit_elements {icon: "${name}"}`,
    )
  }

  /** write only a real change, and let an empty value DELETE the key — which
   *  is what makes a round-trip of an unchanged document byte-identical */
  function assign<
    K extends 'classes' | 'content' | 'htmlId' | 'src' | 'arg' | 'ref' | 'link' | 'channel',
  >(
    node: ElementNode,
    key: K,
    value: string,
  ) {
    // `content` is the one field whose empty string is the canonical absence
    // (`createNode` writes it), so it is assigned rather than deleted
    const next = key === 'content' ? value : value.trim()
    if (!next && key !== 'content') {
      if (node[key] !== undefined) delete node[key]
      return
    }
    if (node[key] !== next) node[key] = next
  }

  function assignObject<K extends 'attributes' | 'fieldAttrs' | 'variants' | 'instanceAttributes'>(
    node: ElementNode,
    key: K,
    value: Record<string, string>,
  ) {
    if (!Object.keys(value).length) {
      if (node[key] !== undefined) delete node[key]
      return
    }
    if (JSON.stringify(node[key]) !== JSON.stringify(value)) node[key] = value
  }
}

const iconNameOf = (node: ElementNode) =>
  node.svg?.match(/data-icon="([a-z0-9:_-]+)"/)?.[1] ?? (node.svg ? 'custom' : '')

/** the validation context a project implies */
export function contextFromProject(project: Project): ValidateContext {
  return validateContext(project)
}
