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

/**
 * Whole-project operations on components — rename, duplicate, categorize,
 * detach, delete.
 *
 * These live here rather than in `useComponents` because every one of them
 * spans ALL pages, while the composable's `masterMap` / `detachComponent` are
 * bound to the active page. Editing ONE tree — a master, or a page — is
 * `lib/treeOps`; this is what the rest of the project then has to be told.
 * `pushMasterStructure` and the detach verbs are re-exported into the committed
 * MCP runtime bundle, so the agent path runs this code rather than a copy of
 * it: rebuild the bundle (`npm run build:mcp-runtime`) after changing them.
 *
 * All of it is pure: a `Project` in, mutations out, no Vue. That is what makes
 * it testable headlessly.
 */

/**
 * The ONE writer of the optional keys, so their JSON key order is the same
 * everywhere. `computeMerge` compares whole-object `JSON.stringify`, which is
 * key-order sensitive: a def built `{id,name,category,root}` and one built
 * `{id,name,root,category}` are equal in every way that matters and would
 * still read as a conflict. Deleting them all and re-adding them puts them
 * last, in one order, always.
 *
 * `meta` is the WHOLE set: a key left out is a key removed. Pass what the def
 * already has for the ones that are not changing.
 */
export function setComponentMeta(
  def: ComponentDef,
  meta: { category?: string; variants?: VariantAxis[] },
): void {
  delete def.category
  delete def.variants
  const category = meta.category?.trim()
  if (category) def.category = category
  if (meta.variants?.length) {
    // rebuilt key by key: an axis object's own key order is part of the signature
    def.variants = meta.variants.map((axis) => ({
      name: axis.name,
      options: [...axis.options],
      default: axis.default,
    }))
  }
}

export interface ComponentUsage {
  /** instances across every page */
  count: number
  pages: { id: string; name: string }[]
  /** the components that hold an instance of it in their own master */
  hosts: string[]
}

/** where a component is actually used — the number the delete confirm quotes */
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

/**
 * Renames a component, every instance of it, and every mirror of it.
 *
 * Returns the name actually used (normalized and de-duplicated), or null when
 * the id doesn't resolve.
 */
export function renameComponent(project: Project, id: string, rawName: string): string | null {
  const def = project.components.find((c) => c.id === id)
  if (!def) return null
  // the component itself is excluded from `taken`, or renaming 'Card' to
  // 'Card' (or just recasing it) would collide with itself and yield 'Card2'
  const taken = project.components.filter((c) => c.id !== id).map((c) => c.name)
  const name = normalizeComponentName(rawName, taken)
  if (name === def.name) return name

  const old = def.name
  // the def FIRST, and its root type with it: an instance is paired to its
  // master BY NAME, in the editor (masterMap) and in the exporter alike. Leave
  // either lagging and every instance on every page pairs with nothing.
  def.name = name
  def.root.type = name
  // …and every master holding an instance of it: a mirror is typed by the
  // component it mirrors, at any depth
  for (const host of project.components) {
    walkNodes(host.root.children, (node) => {
      if (node.type === old) node.type = name
    })
  }

  // …and every instance on every page. A type assignment and nothing else:
  // no reparse, so every node id survives, which matters because comment
  // anchors and interaction targetIds address page nodes by id.
  for (const page of project.pages) {
    walkNodes(page.elements, (node) => {
      if (node.type === old) node.type = name
    })
  }
  return name
}

/** An independent copy under a new name. Creates no instances. */
export function duplicateComponent(project: Project, id: string): ComponentDef | null {
  const def = project.components.find((c) => c.id === id)
  if (!def) return null
  const name = normalizeComponentName(
    `${def.name}Copy`,
    project.components.map((c) => c.name),
  )
  // cloneForMaster rather than a bare deep clone: it mints fresh master ids AND
  // rewrites the bindings that pointed inside the tree onto them. A plain copy
  // would leave the duplicate's own interactions aiming at the ORIGINAL's
  // nodes, which resolve globally — so firing one would animate the other.
  const { cloned } = cloneForMaster(def.root)
  cloned.type = name
  const copy: ComponentDef = { id: uid(), name, root: cloned }
  // the category carries over; `source` deliberately does not — a copy made to
  // be edited is no longer the library entry it came from
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

// --- detaching ---------------------------------------------------------

interface Pair {
  node: ElementNode
  master: ElementNode
  /** what the node WEARS: the master's classes with this instance's variant
   * options layered on */
  classes: string
}

/** what a host says about a nested instance — the state a mirror carries */
const MIRROR_KEYS = [
  'content',
  'src',
  'svg',
  'background',
  'locales',
  'hidden',
  'variants',
  // `link` is per-instance with a component default (see adoptCodeOwned), so
  // what a HOST says about the instance it holds is a mirror value like any
  // other. Without it the key was stored by the write and skipped by every
  // renderer — a Row whose Button points at `@item` shipped with no href at
  // all, and both edit_elements and publish reported success.
  'link',
] as const

/** `node` takes, for each key it does not set itself, the first mirror's value */
function inheritFromMirrors(node: ElementNode, mirrors: ElementNode[]): void {
  for (const key of MIRROR_KEYS) {
    if (node[key] !== undefined && node[key] !== '') continue
    const from = mirrors.find((m) => m[key] !== undefined && m[key] !== '')
    if (from) (node as unknown as Record<string, unknown>)[key] = deepClone(from[key])
  }
}

/**
 * One instance's nodes with their masters — the shared pairing
 * (lib/instances), over any page rather than only the active one, plus the
 * master → instance direction a detach needs to retarget bindings.
 *
 * Only the nodes that belong to THIS component are paired. An instance nested
 * inside it stays an instance when its host is detached, so its nodes are not
 * baked — they only take over what the host's master said about them, which
 * is about to stop being reachable.
 */
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

/** Copies the master's shared state onto the page nodes that were inheriting it. */
function bakeMasterState(pairs: Pair[], masterToInstance: Map<string, string>): void {
  const retarget = (targetId: string | null) =>
    targetId ? (masterToInstance.get(targetId) ?? targetId) : null
  for (const { node, master, classes } of pairs) {
    // the look this instance HAD, variants resolved: a detached element has no
    // component left to pick an option on
    if (classes) node.classes = classes
    delete node.variants
    // the boundary meant something only while a component stood behind it
    delete node.slot
    if (master.attributes) node.attributes = deepClone(master.attributes)
    // fresh binding ids: the master's bindings keep running on the instances
    // that are still attached, and two bindings sharing an id would key the
    // same breakpoint/session state
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
    // Content, media and translations follow the renderers' own-then-master
    // precedence, so they are inherited exactly where the instance has none of
    // its own. Skipping them is what used to make detaching lose a component's
    // text and images — the nodes were stripped at extraction and never got
    // them back.
    if (!node.content && master.content) node.content = master.content
    if (!node.src && master.src) node.src = master.src
    if (!node.svg && master.svg) node.svg = master.svg
    // a part the component hides stays hidden; one this instance chose to show
    // (`false`) has nothing left to override, so the flag goes
    if (node.hidden === undefined && master.hidden) node.hidden = true
    else if (node.hidden === false) delete node.hidden
    if (!node.background && master.background) node.background = master.background
    if (!node.locales && master.locales) node.locales = deepClone(master.locales)
    // every OTHER value `resolveInstanceValue` resolves own-first with a
    // component default. Each of these was simply dropped: a detached sidebar
    // of nine links lost all nine destinations, a list extracted into a
    // component lost its filter, and a detached slider lost its config — all
    // of it silently, because the key lived on the master and nothing read it
    // once the mapping was gone.
    if (node.link === undefined && master.link !== undefined) node.link = master.link
    if (!node.listQuery && master.listQuery) node.listQuery = deepClone(master.listQuery)
    if (!node.slider && master.slider) node.slider = deepClone(master.slider)
    if (!node.form && master.form) node.form = deepClone(master.form)
    if (!node.entryId && master.entryId) node.entryId = master.entryId
    if (!node.fieldAttrs && master.fieldAttrs) node.fieldAttrs = deepClone(master.fieldAttrs)
    // the per-PLACEMENT attribute layer folds into the shared set: after a
    // detach there is only one placement, so keeping two layers would leave a
    // key that reads as an override of nothing
    if (node.instanceAttributes) {
      node.attributes = mergeAttributeLayers(node.attributes, node.instanceAttributes)
      delete node.instanceAttributes
    }
  }
}

/**
 * The exporter's own test (`server/export.mjs`, renderNode): a `:Name` wrapper
 * with nothing of its own emits NO element at all — its children render
 * inline. Such a wrapper has to be UNWRAPPED on detach, not retyped: a `:div`
 * in its place would add a box the published page never had, and with it
 * whatever `space-y-*` / `divide-*` / `first:` rules the real parent applies
 * to its children.
 */
function isBareWrapper(root: ElementNode): boolean {
  return !root.classes?.trim() && !root.background && !root.interactions?.length
}

/** Detaches one instance. */
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
  // an instance that was never materialized (a stored `:Card:` leaf) has no
  // nodes to bake onto — give it the master's structure first
  if (!instance.children.length && def.root.children.length) {
    alignStructure(instance, def.root)
  }

  const { pairs, masterToInstance } = pairWithMaster(instance, def, components)
  bakeMasterState(pairs, masterToInstance)

  if (!isBareWrapper(def.root)) {
    // a styled/interactive wrapper is a real box on the published page, and it
    // just took the master's classes — it stays, as a plain div
    instance.type = 'div'
    return true
  }

  // bare: the wrapper renders no element at all, so it goes and its children
  // take its place. Its addresses move onto the first of them, so a ref or a
  // comment anchor aimed at this block still resolves to something.
  const at = parent.children.indexOf(instance)
  const first = instance.children[0]
  if (first) {
    if (instance.ref && !first.ref) first.ref = instance.ref
    if (instance.htmlId && !first.htmlId) first.htmlId = instance.htmlId
  }
  parent.children.splice(at, 1, ...instance.children)
  return true
}

/**
 * Turns every instance of a component, on every page, back into plain
 * elements that look exactly the same. Returns how many were detached.
 */
export function detachComponentInstances(project: Project, def: ComponentDef): number {
  let detached = 0
  for (const page of project.pages) {
    const ids: string[] = []
    walkNodes(page.elements, (n) => {
      if (n.type === def.name) ids.push(n.id)
    })
    if (!ids.length) continue
    // ids, not nodes: unwrapping one instance can re-parent the next (an
    // instance nested in a bare wrapper), so each is re-found as we reach it
    for (const id of ids) if (detachOne(page, def, id, project.components)) detached++
  }
  return detached
}

/** Detaches a single instance — the canvas context menu's "Detach". */
export function detachInstance(project: Project, page: Page, instanceId: string): boolean {
  const node = findNode(page.elements, instanceId)
  const def = node ? project.components.find((c) => c.name === node.type) : null
  if (!def) return false
  if (!detachOne(page, def, instanceId, project.components)) return false
  return true
}

// --- pushing a master's structure out ----------------------------------
//
// A structural change to a master is made on its own tree (lib/treeOps, over
// `masterHost(def)`) and then PUSHED to every instance of it, on every page.

/**
 * Pushes a master's current structure out to every instance of it, on every
 * page. Returns how many instance subtrees it had to move.
 *
 * Realigning (rather than rebuilding) is what carries per-instance state
 * across: every node that survives the match IS the same node object, so its
 * id, text, media, translations, hidden flag, variant picks and htmlId come
 * with it, and a subtree that was already in step comes out byte-identical. A
 * push that found everything current therefore reads as no edit at all.
 *
 * "Every instance" includes the ones NESTED in other components: the mirrors
 * those components hold in their own masters are brought back in step first —
 * inner components before the hosts that mirror them — and the blocks on the
 * pages follow at any depth.
 *
 * An instance that was never materialized (a `:Card:` leaf in stored code) is
 * simply one whose children do not match yet, so it is filled in here with no
 * special case.
 */
/** where a push discarded per-instance state, for a caller to report */
export interface PushLoss {
  pageId: string
  page: string
  /** the instance's ref, when it has one — the address an agent would re-edit by */
  ref?: string
  /** the element that went away */
  type: string
  /** the per-instance keys it was carrying */
  keys: string[]
}

export function pushMasterStructure(
  project: Project,
  def: ComponentDef,
  report?: { lost: PushLoss[] },
): number {
  // a library preview is not in the project; instances match by NAME, so
  // pushing one would rewrite blocks belonging to a real component of the
  // same name
  if (!project.components.some((c) => c.id === def.id)) return 0
  // What a page copy of a link is redundant WITH — computed once, before the
  // mirrors move, because a redundant copy equals the inner default either way
  // (see effectiveLinkChain). Without it a page node holding a nested
  // component's own default was never normalized away and shadowed, forever,
  // whatever link the host later set on its mirror.
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
      // A master node that changed DEPTH has no positional counterpart on the
      // instances, so their nodes are recreated and whatever they carried is
      // gone (see collectDiscarded). The caller gets told which placement lost
      // what, because `updatedInstances` is a count and `removed` counts MASTER
      // elements — neither could tell "realigned, nothing lost" from "rebuilt
      // nine subtrees and dropped their icons".
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

/**
 * Bring every mirror in step with the component it mirrors, inner components
 * first so a host two levels up mirrors an already-current structure.
 */
export function alignMirrors(components: ComponentDef[], chain?: LinkChain): void {
  for (const host of dependencyOrder(components)) alignHostMirrors(host, components, chain)
}

/**
 * Deletes a component, detaching every instance first so no page loses its
 * content. Interactions and design tokens the component used stay in the
 * project — they are shared libraries, and the detached elements still use
 * them.
 */
export function deleteComponent(project: Project, id: string): boolean {
  const def = project.components.find((c) => c.id === id)
  if (!def) return false
  // the components HOLDING it first: each bakes it into its own master and
  // pushes that out, which turns the nested blocks on the pages into plain
  // elements too — the per-instance text on them carried across by the push's
  // line alignment. Inner hosts before outer ones, so a host two levels up
  // mirrors a master that has already let go of it.
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

/**
 * Turns one nested instance, in a host's MASTER, into plain elements that look
 * the same: the inner component's structure and look, with what the host said
 * about it on top. The tree-form twin of `detachOne`, same bare-wrapper rule.
 */
function detachInMaster(host: ComponentDef, wrapper: ElementNode, inner: ComponentDef): void {
  const parent = findParent([host.root], wrapper.id)
  if (!parent) return
  const picks = resolvePicks(inner, wrapper, []) as Record<string, string>
  // fresh ids, and the inner master's own bindings re-aimed inside the copy
  const { cloned } = cloneForMaster(inner.root)

  const bake = (node: ElementNode, master: ElementNode, mirror: ElementNode | undefined, held: boolean) => {
    // inside an instance the inner component itself holds, the copy STAYS an
    // instance: what the inner master said about it becomes what the host
    // says, and nothing is baked
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

/** what the mirror sets wins over what the clone inherited from the master */
function clearForOverlay(node: ElementNode, mirror: ElementNode): ElementNode {
  for (const key of MIRROR_KEYS) {
    if (mirror[key] !== undefined && mirror[key] !== '') delete node[key]
  }
  return node
}
