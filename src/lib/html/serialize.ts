import type { ComponentDef, ElementNode, Page, Project } from '@/types/editor'
import { buildInstanceMap, isInstanceWrapper, type InstanceMapping } from '../instances'
import { isRich } from '../shared/richtext.js'
import { isComponentType } from '../components'
import { findNode } from '../tree'
import { shortIds } from './ids'
import { impliedAttrs, isLeafType, SOURCE_TYPES, tagForType } from './tags'

/**
 * The tree as HTML, for an agent to read.
 *
 * Canonical and deterministic: two-space indentation, one element per line,
 * and a fixed attribute order (`data-id`, `data-ref`, `class`, then
 * alphabetical). That matters beyond tidiness — the page `version` an agent
 * writes against is a hash of this output, so a stable spelling is what keeps
 * a write from being rejected for a difference nobody made.
 *
 * What is NOT here is as deliberate as what is: interactions, animations,
 * translations, slider config, form config, `listQuery`, `entryId` and
 * `instanceAttributes`
 * all stay node state, edited by the tools that own them, and a write
 * preserves them on every node it adopts. Printing them would double the
 * size of a read and tempt an agent into editing them as text.
 */

export type HtmlMode = 'full' | 'structure'

export interface SerializeOptions {
  /** emit `data-id` — on by default, because echoing it back is what carries
   *  node identity through a rewrite */
  ids?: boolean
  /**
   * Emit the read-only `data-interactions` / `data-animations` names — on by
   * default, because seeing what fires on an element saves a second call.
   *
   * The page VERSION turns it off. An effect is node state the HTML reports but
   * does not carry, so it survives every write by construction and can never
   * make a pending one unsafe — and a version that moved when a binding
   * changed is exactly the spurious `stale-version` the marker sync used to
   * cause.
   */
  effects?: boolean
  /** `structure` drops content and classes: the shape of a big page, for an
   *  agent that only needs to find its way around */
  mode?: HtmlMode
  /** render only this subtree (a `#ref` or a short/full id) */
  subtree?: string
}

const INDENT = '  '

const escapeText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** a `data:` URL is megabytes of base64 nobody can read or edit — the read
 *  shows that it is one, and a write preserves whatever the node already had */
export const ELIDED_DATA_URL = 'data:…(elided)'
const showSrc = (src: string) => (src.startsWith('data:') ? ELIDED_DATA_URL : src)

interface Ctx {
  mode: HtmlMode
  ids: boolean
  effects: boolean
  /** when a MASTER is being read, its own root — which is component-typed but
   *  is the component itself, not an instance of it. Without this its children
   *  read as "inside an instance" and their classes, which are exactly what a
   *  component read is for, are suppressed. */
  masterRootId?: string
  shorts: Map<string, string>
  /** the instance pairing, so an instance's interior reads as content only */
  map: Map<string, InstanceMapping>
  components: ComponentDef[]
  /** interaction/animation names, for the read-only info attributes */
  effectNames: (node: ElementNode) => { interactions: string[]; animations: string[] }
}

/** the attributes one node writes, in canonical order */
function attrsFor(node: ElementNode, ctx: Ctx, inInstance: boolean): string[] {
  // a `:Name` wrapper renders no element of its own: its classes and
  // attributes are the master's, so printing the node's would invite an edit
  // that lands nowhere
  const mapping = ctx.map.get(node.id)
  const shared = inInstance || (!!mapping && isInstanceWrapper(mapping))
  const out: [string, string | true][] = []
  const short = ctx.shorts.get(node.id)
  if (ctx.ids && short) out.push(['data-id', short])
  if (node.ref) out.push(['data-ref', node.ref])
  if (!shared && ctx.mode === 'full' && node.classes?.trim()) {
    out.push(['class', node.classes.trim()])
  }

  const rest: [string, string | true][] = []
  // the attributes the TYPE implies (`checkbox` is `<input type="checkbox">`):
  // part of the element's identity, and how the reader picks the type back out
  for (const [name, value] of Object.entries(impliedAttrs(node.type))) rest.push([name, value])
  if (node.htmlId) rest.push(['id', node.htmlId])
  if (node.arg) rest.push([SOURCE_TYPES.has(node.type) ? 'source' : 'data-field', node.arg])
  if (node.link) rest.push(['href', node.link])
  if (node.src) rest.push(['src', showSrc(node.src)])
  if (node.type === 'icon') rest.push(['data-icon', iconName(node)])
  if (node.type === 'text') rest.push(['data-type', 'text'])
  if (node.hidden !== undefined) rest.push(['data-hidden', String(node.hidden)])
  // the channel this element listens on. A CARRIED attribute, not a read-only
  // annotation like the effect names: a write can change it, so it is inside
  // the version hash.
  if (node.channel) rest.push(['data-channel', node.channel])
  // a slot: on a master read it is what declares one; inside an instance it
  // marks where the page's own structure begins
  if (node.slot) rest.push(['data-slot', true])
  const implied = impliedAttrs(node.type)
  for (const [name, value] of Object.entries(node.attributes ?? {})) {
    if (!shared && implied[name] === undefined) rest.push([name, value])
  }
  for (const [attr, field] of Object.entries(node.fieldAttrs ?? {})) {
    rest.push([`data-bind-${attr}`, field])
  }
  for (const [axis, option] of Object.entries(node.variants ?? {})) {
    rest.push([`data-variant-${axis}`, option])
  }
  if (ctx.mode === 'full' && ctx.effects) {
    const effects = ctx.effectNames(node)
    if (effects.interactions.length) rest.push(['data-interactions', effects.interactions.join(', ')])
    if (effects.animations.length) rest.push(['data-animations', effects.animations.join(', ')])
  }

  rest.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return [...out, ...rest].map(([name, value]) =>
    value === true ? ` ${name}` : ` ${name}="${escapeAttr(String(value))}"`,
  )
}

/** which bundled icon a node's svg is, or `custom` for hand-written markup */
const iconName = (node: ElementNode) =>
  node.svg?.match(/data-icon="([a-z0-9:_-]+)"/)?.[1] ?? (node.svg ? 'custom' : '')

function emit(node: ElementNode, depth: number, ctx: Ctx, inInstance: boolean, out: string[]): void {
  const pad = INDENT.repeat(depth)
  const tag = tagForType(node.type)
  const attrs = attrsFor(node, ctx, inInstance).join('')
  const isInstance = isComponentType(node.type) && node.id !== ctx.masterRootId

  if (isLeafType(node.type)) {
    const text = ctx.mode === 'full' ? (node.content ?? '') : ''
    if (!text) {
      out.push(`${pad}<${tag}${attrs} />`)
      return
    }
    // a leaf's inner markup IS its content: rich copy keeps its own tags,
    // plain text is escaped — and the reader decodes exactly what this
    // escaped, so both directions round-trip. A custom-code block is ALWAYS
    // escaped: its content is markup that must not be read as elements.
    const raw = isRich(text) && node.type !== 'custom-code'
    out.push(`${pad}<${tag}${attrs}>${raw ? text : escapeText(text)}</${tag}>`)
    return
  }

  if (!node.children.length) {
    out.push(`${pad}<${tag}${attrs} />`)
    return
  }
  out.push(`${pad}<${tag}${attrs}>`)
  for (const child of node.children) {
    // under a slot the children are the holder's own again: full attributes
    emit(child, depth + 1, ctx, (inInstance || isInstance) && !node.slot, out)
  }
  out.push(`${pad}</${tag}>`)
}

function contextFor(
  project: Project,
  roots: ElementNode[],
  /** what the instance pairing walks — a master's OWN root is not an instance
   *  of itself, so reading a component walks its children instead */
  mapRoots: ElementNode[],
  opts: SerializeOptions,
): Ctx {
  const components = project.components ?? []
  const byId = new Map<string, string>()
  for (const effect of project.interactions ?? []) byId.set(effect.id, effect.name)
  for (const anim of project.animations ?? []) byId.set(anim.id, anim.name)
  const map = buildInstanceMap(mapRoots, components)
  return {
    mode: opts.mode ?? 'full',
    ids: opts.ids !== false,
    effects: opts.effects !== false,
    shorts: shortIds(roots),
    map,
    components,
    effectNames: (node) => {
      // inside an instance the bindings are the master's; show what will
      // actually fire, which is what the mapped node resolves to
      const mapping = map.get(node.id)
      const owner = mapping && !isInstanceWrapper(mapping) ? mapping.master : node
      return {
        interactions: (owner.interactions ?? []).map((b) => byId.get(b.interactionId) ?? '?'),
        animations: (owner.animations ?? []).map((b) => byId.get(b.animationId) ?? '?'),
      }
    },
  }
}

/** one page's body as HTML */
export function pageToHtml(page: Page, project: Project, opts: SerializeOptions = {}): string {
  const body = page.elements.find((n) => n.type === 'body')
  if (!body) return '<body />'
  const ctx = contextFor(project, page.elements, page.elements, opts)
  const root = opts.subtree ? resolveSubtree(page.elements, opts.subtree, ctx) : body
  if (!root) return ''
  const out: string[] = []
  const mapping = ctx.map.get(root.id)
  emit(root, 0, ctx, !!mapping && !isInstanceWrapper(mapping), out)
  return out.join('\n')
}

/** a component master as HTML — its root element IS the component */
export function masterToHtml(def: ComponentDef, project: Project, opts: SerializeOptions = {}): string {
  const ctx = { ...contextFor(project, [def.root], def.root.children, opts), masterRootId: def.root.id }
  const out: string[] = []
  emit(def.root, 0, ctx, false, out)
  return out.join('\n')
}

function resolveSubtree(roots: ElementNode[], key: string, ctx: Ctx): ElementNode | null {
  for (const [id, short] of ctx.shorts) {
    if (short === key) return findNode(roots, id)
  }
  const byId = findNode(roots, key)
  if (byId) return byId
  let byRef: ElementNode | null = null
  const visit = (nodes: ElementNode[]) => {
    for (const node of nodes) {
      if (byRef) return
      if (node.ref === key) byRef = node
      else visit(node.children)
    }
  }
  visit(roots)
  return byRef
}
