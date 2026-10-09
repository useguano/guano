import type { ComponentDef, ElementNode, Page, Project } from '@/types/editor'
import { buildInstanceMap, isInstanceWrapper, type InstanceMapping } from '../instances'
import { isRich } from '../shared/richtext.js'
import { isComponentType } from '../components'
import { findNode } from '../tree'
import { shortIds } from './ids'
import { impliedAttrs, isLeafType, SOURCE_TYPES, tagForType } from './tags'

export type HtmlMode = 'full' | 'structure'

export interface SerializeOptions {
  ids?: boolean

  effects?: boolean

  mode?: HtmlMode
  subtree?: string
}

const INDENT = '  '

const escapeText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const ELIDED_DATA_URL = 'data:…(elided)'
const showSrc = (src: string) => (src.startsWith('data:') ? ELIDED_DATA_URL : src)

interface Ctx {
  mode: HtmlMode
  ids: boolean
  effects: boolean

  masterRootId?: string
  shorts: Map<string, string>
  map: Map<string, InstanceMapping>
  components: ComponentDef[]
  effectNames: (node: ElementNode) => { interactions: string[]; animations: string[] }
}

function attrsFor(node: ElementNode, ctx: Ctx, inInstance: boolean): string[] {
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
  for (const [name, value] of Object.entries(impliedAttrs(node.type))) rest.push([name, value])
  if (node.htmlId) rest.push(['id', node.htmlId])
  if (node.arg) rest.push([SOURCE_TYPES.has(node.type) ? 'source' : 'data-field', node.arg])
  if (node.link) rest.push(['href', node.link])
  if (node.src) rest.push(['src', showSrc(node.src)])
  if (node.type === 'icon') rest.push(['data-icon', iconName(node)])
  if (node.type === 'text') rest.push(['data-type', 'text'])
  if (node.hidden !== undefined) rest.push(['data-hidden', String(node.hidden)])
  if (node.channel) rest.push(['data-channel', node.channel])
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
    emit(child, depth + 1, ctx, (inInstance || isInstance) && !node.slot, out)
  }
  out.push(`${pad}</${tag}>`)
}

function contextFor(
  project: Project,
  roots: ElementNode[],

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
      const mapping = map.get(node.id)
      const owner = mapping && !isInstanceWrapper(mapping) ? mapping.master : node
      return {
        interactions: (owner.interactions ?? []).map((b) => byId.get(b.interactionId) ?? '?'),
        animations: (owner.animations ?? []).map((b) => byId.get(b.animationId) ?? '?'),
      }
    },
  }
}

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
