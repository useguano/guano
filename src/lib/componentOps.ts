import type { ComponentDef, ElementNode, Page, Project, VariantAxis } from '@/types/editor'
import {
  alignHostMirrors,
  alignStructure,
  effectiveLinkChain,
  type DiscardedState,
  type LinkChain,
  cloneForMaster,
  isComponentType,
  nestedWrappers,
  normalizeComponentName,
} from './components'
import { deepClone, findNode, findParent, walkNodes } from './tree'
import { buildInstanceMap, dependencyOrder, nestedComponentNames } from './instances'
import { resolvePicks } from './shared/instances.js'
import { mergeAttributeLayers } from './shared/attributes.js'
import { effectiveClasses } from './variants'
import { uid } from './shared/ids.js'

export function setComponentMeta(
  def: ComponentDef,
  meta: { category?: string; variants?: VariantAxis[] },
): void {
  delete def.category
  delete def.variants
  const category = meta.category?.trim()
  if (category) def.category = category
  if (meta.variants?.length) {
    def.variants = meta.variants.map((axis) => ({
      name: axis.name,
      options: [...axis.options],
      default: axis.default,
    }))
  }
}

export interface ComponentUsage {
  count: number
  pages: { id: string; name: string }[]
  hosts: string[]
}

export function componentUsage(project: Project, name: string): ComponentUsage {
  let count = 0
  const pages: { id: string; name: string }[] = []
  for (const page of project.pages) {
    let onPage = 0
    walkNodes(page.elements, (n) => {
      if (n.type === name) onPage++
    })
    if (!onPage) continue
    count += onPage
    pages.push({ id: page.id, name: page.name })
  }
  const hosts = project.components
    .filter((c) => c.name !== name && nestedComponentNames(c).includes(name))
    .map((c) => c.name)
  return { count, pages, hosts }
}

export function renameComponent(project: Project, id: string, rawName: string): string | null {
  const def = project.components.find((c) => c.id === id)
  if (!def) return null
  const taken = project.components.filter((c) => c.id !== id).map((c) => c.name)
  const name = normalizeComponentName(rawName, taken)
  if (name === def.name) return name

  const old = def.name
  def.name = name
  def.root.type = name
  for (const host of project.components) {
    walkNodes(host.root.children, (node) => {
      if (node.type === old) node.type = name
    })
  }

  for (const page of project.pages) {
    walkNodes(page.elements, (node) => {
      if (node.type === old) node.type = name
    })
  }
  return name
}

export function createBlankComponent(
  project: Project,
  rawName: string,
  category?: string,
): ComponentDef {
  const name = normalizeComponentName(
    rawName,
    project.components.map((c) => c.name),
  )
  const def: ComponentDef = {
    id: uid(),
    name,
    root: { id: uid(), type: name, content: '', children: [] },
  }
  setComponentMeta(def, { category })
  project.components.push(def)
  return def
}

export function duplicateComponent(project: Project, id: string): ComponentDef | null {
  const def = project.components.find((c) => c.id === id)
  if (!def) return null
  const name = normalizeComponentName(
    `${def.name}Copy`,
    project.components.map((c) => c.name),
  )
  const { cloned } = cloneForMaster(def.root)
  cloned.type = name
  const copy: ComponentDef = { id: uid(), name, root: cloned }
  setComponentMeta(copy, { category: def.category, variants: def.variants })
  project.components.push(copy)
  return copy
}

export function setComponentCategory(project: Project, id: string, category: string): boolean {
  const def = project.components.find((c) => c.id === id)
  if (!def) return false
  setComponentMeta(def, { category, variants: def.variants })
  return true
}

interface Pair {
  node: ElementNode
  master: ElementNode

  classes: string
}

const MIRROR_KEYS = [
  'content',
  'src',
  'svg',
  'background',
  'locales',
  'hidden',
  'variants',
  'link',
] as const

function inheritFromMirrors(node: ElementNode, mirrors: ElementNode[]): void {
  for (const key of MIRROR_KEYS) {
    if (node[key] !== undefined && node[key] !== '') continue
    const from = mirrors.find((m) => m[key] !== undefined && m[key] !== '')
    if (from) (node as unknown as Record<string, unknown>)[key] = deepClone(from[key])
  }
}

function pairWithMaster(instance: ElementNode, def: ComponentDef, components: ComponentDef[]) {
  const pairs: Pair[] = []
  const masterToInstance = new Map<string, string>()
  const map = buildInstanceMap([instance], [def, ...components.filter((c) => c !== def)])
  walkNodes([instance], (node) => {
    const mapping = map.get(node.id)
    if (!mapping) return
    if (mapping.def !== def) {
      inheritFromMirrors(node, mapping.mirrors)
      return
    }
    pairs.push({
      node,
      master: mapping.master,
      classes: effectiveClasses(mapping.master, mapping.def, mapping.picks),
    })
    masterToInstance.set(mapping.master.id, node.id)
  })
  return { pairs, masterToInstance }
}

function bakeMasterState(pairs: Pair[], masterToInstance: Map<string, string>): void {
  const retarget = (targetId: string | null) =>
    targetId ? (masterToInstance.get(targetId) ?? targetId) : null
  for (const { node, master, classes } of pairs) {
    if (classes) node.classes = classes
    delete node.variants
    delete node.slot
    if (master.attributes) node.attributes = deepClone(master.attributes)
    if (master.interactions?.length) {
      node.interactions = master.interactions.map((b) => ({
        ...deepClone(b),
        id: uid(),
        targetId: retarget(b.targetId),
      }))
    }
    if (master.animations?.length) {
      node.animations = master.animations.map((b) => ({
        ...deepClone(b),
        id: uid(),
        targetId: retarget(b.targetId),
      }))
    }
    if (!node.content && master.content) node.content = master.content
    if (!node.src && master.src) node.src = master.src
    if (!node.svg && master.svg) node.svg = master.svg
    if (node.hidden === undefined && master.hidden) node.hidden = true
    else if (node.hidden === false) delete node.hidden
    if (!node.background && master.background) node.background = master.background
    if (!node.locales && master.locales) node.locales = deepClone(master.locales)
    if (node.link === undefined && master.link !== undefined) node.link = master.link
    if (!node.listQuery && master.listQuery) node.listQuery = deepClone(master.listQuery)
    if (!node.slider && master.slider) node.slider = deepClone(master.slider)
    if (!node.form && master.form) node.form = deepClone(master.form)
    if (!node.entryId && master.entryId) node.entryId = master.entryId
    if (!node.fieldAttrs && master.fieldAttrs) node.fieldAttrs = deepClone(master.fieldAttrs)
    if (node.instanceAttributes) {
      node.attributes = mergeAttributeLayers(node.attributes, node.instanceAttributes)
      delete node.instanceAttributes
    }
  }
}

function isBareWrapper(root: ElementNode): boolean {
  return !root.classes?.trim() && !root.background && !root.interactions?.length
}

function detachOne(
  page: Page,
  def: ComponentDef,
  instanceId: string,
  components: ComponentDef[],
): boolean {
  const instance = findNode(page.elements, instanceId)
  if (!instance || instance.type !== def.name) return false
  const parent = findParent(page.elements, instanceId)
  if (!parent) return false
  if (!instance.children.length && def.root.children.length) {
    alignStructure(instance, def.root)
  }

  const { pairs, masterToInstance } = pairWithMaster(instance, def, components)
  bakeMasterState(pairs, masterToInstance)

  if (!isBareWrapper(def.root)) {
    instance.type = 'div'
    return true
  }

  const at = parent.children.indexOf(instance)
  const first = instance.children[0]
  if (first) {
    if (instance.ref && !first.ref) first.ref = instance.ref
    if (instance.htmlId && !first.htmlId) first.htmlId = instance.htmlId
  }
  parent.children.splice(at, 1, ...instance.children)
  return true
}

export function detachComponentInstances(project: Project, def: ComponentDef): number {
  let detached = 0
  for (const page of project.pages) {
    const ids: string[] = []
    walkNodes(page.elements, (n) => {
      if (n.type === def.name) ids.push(n.id)
    })
    if (!ids.length) continue
    for (const id of ids) if (detachOne(page, def, id, project.components)) detached++
  }
  return detached
}

export function detachInstance(project: Project, page: Page, instanceId: string): boolean {
  const node = findNode(page.elements, instanceId)
  const def = node ? project.components.find((c) => c.name === node.type) : null
  if (!def) return false
  if (!detachOne(page, def, instanceId, project.components)) return false
  return true
}

export interface PushLoss {
  pageId: string
  page: string
  ref?: string
  type: string
  keys: string[]
}

export function pushMasterStructure(
  project: Project,
  def: ComponentDef,
  report?: { lost: PushLoss[] },
): number {
  if (!project.components.some((c) => c.id === def.id)) return 0
  const chain = effectiveLinkChain(project.components)
  alignMirrors(project.components, chain)
  let moved = 0
  for (const page of project.pages) {
    const instances: ElementNode[] = []
    walkNodes(page.elements, (n) => {
      if (n.type === def.name) instances.push(n)
    })
    if (!instances.length) continue
    for (const node of instances) {
      const lost: DiscardedState[] = report ? [] : (undefined as never)
      if (alignStructure(node, def.root, chain, report ? lost : undefined)) moved++
      if (report) {
        for (const entry of lost) {
          report.lost.push({
            pageId: page.id,
            page: page.name,
            ...(node.ref ? { ref: node.ref } : {}),
            ...entry,
          })
        }
      }
    }
  }
  return moved
}

export function alignMirrors(components: ComponentDef[], chain?: LinkChain): void {
  for (const host of dependencyOrder(components)) alignHostMirrors(host, components, chain)
}

export function deleteComponent(project: Project, id: string): boolean {
  const def = project.components.find((c) => c.id === id)
  if (!def) return false
  for (const host of dependencyOrder(project.components)) {
    if (host === def) continue
    const held = nestedWrappers(host, def.name)
    if (!held.length) continue
    for (const wrapper of held) detachInMaster(host, wrapper, def)
    pushMasterStructure(project, host)
  }
  detachComponentInstances(project, def)
  project.components = project.components.filter((c) => c.id !== id)
  return true
}

function detachInMaster(host: ComponentDef, wrapper: ElementNode, inner: ComponentDef): void {
  const parent = findParent([host.root], wrapper.id)
  if (!parent) return
  const picks = resolvePicks(inner, wrapper, []) as Record<string, string>
  const { cloned } = cloneForMaster(inner.root)

  const bake = (node: ElementNode, master: ElementNode, mirror: ElementNode | undefined, held: boolean) => {
    if (!held) {
      const classes = effectiveClasses(master, inner, picks)
      if (classes) node.classes = classes
      else delete node.classes
      delete node.variantClasses
    }
    if (mirror) inheritFromMirrors(clearForOverlay(node, mirror), [mirror])
    if (node.hidden === false) delete node.hidden
    node.children.forEach((child, i) => {
      const below = master.children[i]
      if (!below) return
      bake(child, below, mirror?.children[i], held || isComponentType(child.type))
    })
  }
  bake(cloned, inner.root, wrapper, false)
  delete cloned.variants

  const bare = !cloned.classes?.trim() && !cloned.background && !cloned.interactions?.length
  const at = parent.children.indexOf(wrapper)
  if (bare) parent.children.splice(at, 1, ...cloned.children)
  else parent.children.splice(at, 1, { ...cloned, type: 'div' })
}

function clearForOverlay(node: ElementNode, mirror: ElementNode): ElementNode {
  for (const key of MIRROR_KEYS) {
    if (mirror[key] !== undefined && mirror[key] !== '') delete node[key]
  }
  return node
}
