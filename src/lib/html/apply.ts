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

export interface Refusal {
  path: string
  message: string
}

export interface ApplyResult {
  kept: number
  created: number
  removed: number
  refused: Refusal[]
  warnings: Refusal[]
  diagnostics: TreeDiagnostic[]

  carried: CarriedBindings[]
}

export interface CarriedBindings {
  id: string
  ref?: string
  type: string
  interactions: number
  animations: number
}

export interface ApplyOptions {
  project: Project
  def?: ComponentDef | null
  validate?: ValidateContext

  asChildren?: boolean

  resolveIcon?: (name: string) => string | null
}

const NEAR_MISS_BINDINGS = new Set([
  'data-source',
  'data-collection',
  'data-list',
  'collection',
  'field',
  'data-bind',
])

const signature = (node: { type: string; arg?: string; link?: string }) =>
  `${node.type}|${node.arg ?? ''}|${node.link ?? ''}`

const parsedSignature = (node: ParsedNode) =>
  `${node.type}|${argOf(node) ?? ''}|${node.attrs.href ?? ''}`

function argOf(node: ParsedNode): string | undefined {
  const raw = SOURCE_TYPES.has(node.type) ? node.attrs.source : node.attrs['data-field']
  return raw || undefined
}

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
    carried: [],
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

  const reportedClasses = new Set<string>()

  const name = (node: ElementNode) => (node.ref ? `${node.type}#${node.ref}` : node.type)
  const under = (parent: string, node: ElementNode) => `${parent} > ${name(node)}`

  const addressable = [root]
  walkNodes([root], (n) => {
    const mapping = mapped.get(n.id)
    if (!mapping || isInstanceWrapper(mapping)) addressable.push(n)
  })
  const byKey = nodesByShortId([root])
  const known = new Set(byKey.keys())
  for (const [key, node] of [...byKey]) if (!addressable.includes(node)) byKey.delete(key)
  const byRef = new Map<string, ElementNode>()
  for (const node of addressable) if (node.ref) byRef.set(node.ref, node)
  const claim = new Map<ParsedNode, ElementNode>()
  const claimed = new Set<ElementNode>()
  const byPosition = new Set<ParsedNode>()
  const eachParsed = (nodes: ParsedNode[], visit: (n: ParsedNode) => void) => {
    for (const node of nodes) {
      visit(node)
      eachParsed(node.children, visit)
    }
  }
  for (const pass of ['data-id', 'data-ref'] as const) {
    eachParsed(children, (node) => {
      if (claim.has(node)) return
      const key = node.attrs[pass]
      if (!key) return
      const found = pass === 'data-id' ? byKey.get(key) : byRef.get(key)
      const at = `${name(root)} > ${node.type}`
      if (!found) {
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

  if (topAttrs) {
    applyState(root, { ...bare(root.type), attrs: topAttrs }, root.type)
  }
  alignLevel(root, children, name(root))

  const after = new Set<string>()
  walkNodes([root], (n) => after.add(n.id))
  const gone = new Set<string>()
  for (const id of before) if (!after.has(id)) gone.add(id)
  result.removed = gone.size
  clearBindingsToIds(host, gone)

  result.diagnostics = validateTree(root, opts.validate ?? contextFromProject(project))
  return result

  function bare(type: string): ParsedNode {
    return { type, tag: type, attrs: {}, children: [], line: 0, col: 0 }
  }

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
        const wanted = target.node.attrs['data-ref']
        if (wanted && source.node.ref && wanted !== source.node.ref) continue
        claim.set(target.node, source.node)
        claimed.add(source.node)
        byPosition.add(target.node)
      }
    }

    const next: ElementNode[] = []
    for (const child of parsedChildren) {
      if (child.type === SLOT_FILL_TYPE) {
        refuse(
          path,
          '<slot> only fills a component instance\'s slot — write it as the ONE child of a ' +
            '<Component>, like <Shell><slot>…</slot></Shell>',
        )
        continue
      }
      let adopted = claim.get(child)
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
      if (adopted && byPosition.has(child)) {
        const interactions = node.interactions?.length ?? 0
        const animations = node.animations?.length ?? 0
        if (interactions || animations) {
          result.carried.push({
            id: node.id,
            ...(node.ref ? { ref: node.ref } : {}),
            type: node.type,
            interactions,
            animations,
          })
        }
      }
      if (isComponentType(node.type)) fillInstance(node, child, childPath)
      else if (!isLeafType(node.type)) alignLevel(node, child.children, childPath)
      next.push(node)
    }
    parent.children = next
  }

  function fillInstance(node: ElementNode, parsed: ParsedNode, path: string): void {
    const def = components.find((c) => c.name === node.type)
    if (!def) return

    if (opts.def && !canNest(components, opts.def.name, def.name)) {
      refuse(path, `<${def.name}> can't go inside <${opts.def.name}>: a component can't hold itself`)
      return
    }
    alignStructure(node, def.root)
    if (!parsed.children.length) return

    if (parsed.children.length === 1 && parsed.children[0]!.type === SLOT_FILL_TYPE) {
      const marker = parsed.children[0]!
      const slots: { instance: ElementNode; master: ElementNode }[] = []
      const findSlots = (instance: ElementNode[], master: ElementNode[]) => {
        const length = Math.min(instance.length, master.length)
        for (let i = 0; i < length; i++) {
          const below = master[i]!
          const target = instance[i]!
          if (below.slot) slots.push({ instance: target, master: below })
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
        if (below.slot) alignLevel(target, child.children, childPath)
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
          break

        case attr === 'id':
          assign(node, 'htmlId', value)
          break

        case attr === 'src':
          setSrc(node, value, path)
          break

        case attr === 'alt': {
          const attrs = { ...(node.instanceAttributes ?? {}) }
          if (value) attrs.alt = value
          else delete attrs.alt
          assignObject(node, 'instanceAttributes', attrs)
          break
        }

        case attr === 'data-hidden':
          setHidden(node, value)
          break

        case attr === 'data-slot':
          break

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
          assign(node, 'link', value)
          break
        }
        case attr === 'source':
          shared(attr, node.arg)
          break

        case attr === 'data-field':
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

    const has = (attr: string) => parsed.attrs[attr] !== undefined
    if (!has('id') && node.htmlId !== undefined) delete node.htmlId
    if (!has('src') && node.src !== undefined) delete node.src
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

  function applyState(node: ElementNode, parsed: ParsedNode, type: string, path = name(node)) {
    const isInstance = isComponentType(type)
    if (!sameType(node.type, type)) node.type = type

    const implied = impliedAttrs(type)
    for (const [attr, value] of Object.entries(parsed.attrs)) {
      switch (true) {
        case attr === 'data-id':
        case attr === 'data-type':
        case attr === 'data-interactions':
        case attr === 'data-animations':
          break

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
    if (opts.def && !has('data-slot') && node.slot !== undefined) delete node.slot
    if (!has(SOURCE_TYPES.has(node.type) ? 'source' : 'data-field') && node.arg !== undefined) {
      delete node.arg
    }
    if (isInstance) {
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

  function setClasses(node: ElementNode, value: string, path: string) {
    const tokens = value.split(/\s+/).filter(Boolean)
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

  function setHidden(node: ElementNode, value: string) {
    const next = value !== 'false'
    if (node.hidden !== next) node.hidden = next
  }

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

  function assign<
    K extends 'classes' | 'content' | 'htmlId' | 'src' | 'arg' | 'ref' | 'link' | 'channel',
  >(
    node: ElementNode,
    key: K,
    value: string,
  ) {
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

export function contextFromProject(project: Project): ValidateContext {
  return validateContext(project)
}
