import type { ComponentDef, ElementNode } from '@/types/editor'
import { cloneForMaster, createMirror, isComponentType } from './components'
import { createNode, isLeafElement, seedChildFor } from './elements'
import { findNode, findParent, walkNodes } from './tree'
import { canNest } from './instances'

/**
 * Structural editing, over a tree.
 *
 * There are two things with structure in this app, and they used to be shaped
 * very differently: a PAGE, whose authority was an indentation-DSL document
 * (every change a text splice plus an identity-carrying reparse), and a
 * component MASTER, a plain `ElementNode` tree. Two backends, two sets of bugs,
 * and the page one could only fail silently — fine for a text editor where you
 * see the result, unusable for a Layers tree that has to grey out a drop target
 * before the mouse is released.
 *
 * The tree is the source of truth for both, so there is one implementation,
 * parameterized by a HOST: the root node everything lives inside — a page's
 * body, or a component's own wrapper — plus, when that root is a master, the
 * component it belongs to.
 *
 * All of it is pure: nodes in, mutations out, no Vue. `useStructure` wires the
 * policy (which host is live, where an edit inside a page instance is
 * redirected to, when a master's new shape is pushed out).
 */

export type DropPosition = 'before' | 'after' | 'inside'

export interface StructureHost {
  /** everything editable lives inside this node; it is never itself edited */
  root: ElementNode
  /** the component this root is the master of, or null for a page body */
  def: ComponentDef | null
}

export const pageHost = (body: ElementNode): StructureHost => ({ root: body, def: null })
export const masterHost = (def: ComponentDef): StructureHost => ({ root: def.root, def })

/**
 * Can this node hold children? Registry-driven, NOT child-count based: a
 * childless `div` is still a container, while a leaf would silently swallow
 * anything put inside it (nothing renders a leaf's children).
 *
 * A component instance takes nothing *here*: what sits inside it is another
 * component's structure. On a page that is not a refusal but a redirect — the
 * edit is applied to the master — which `useStructure` resolves before calling
 * anything in this module.
 */
export function acceptsChildren(node: ElementNode): boolean {
  return !isComponentType(node.type) && !isLeafElement(node.type)
}

/** the host root is the one node that always takes children (a `:body`, and a
 *  master wrapper, is a container whatever its type says) */
const hostAccepts = (host: StructureHost, node: ElementNode) =>
  isHostRoot(host, node) || acceptsChildren(node)

/** the root is the page / the component itself: renamed, never restructured */
export function isHostRoot(host: StructureHost, node: ElementNode): boolean {
  return node.id === host.root.id
}

/**
 * The component instance a node sits INSIDE, or null. Such a node is part of a
 * mirror: its structure belongs to another component.
 */
export function enclosingInstance(host: StructureHost, id: string): ElementNode | null {
  let found: ElementNode | null = null
  const visit = (nodes: ElementNode[], instance: ElementNode | null) => {
    for (const node of nodes) {
      if (found) return
      if (node.id === id) {
        found = instance
        return
      }
      // what sits under a slot is the holder's own, whatever instance the slot is in
      visit(node.children, node.slot ? null : (instance ?? (isComponentType(node.type) ? node : null)))
    }
  }
  visit(host.root.children, null)
  return found
}

const parentOf = (host: StructureHost, id: string) => findParent([host.root], id)
const nodeIn = (host: StructureHost, id: string) => findNode([host.root], id)

/** where an insert or a move lands: the parent list plus the index within it */
export function resolveSlot(
  host: StructureHost,
  targetId: string | null,
  position: DropPosition,
): { parent: ElementNode; index: number } | null {
  if (!targetId) return { parent: host.root, index: host.root.children.length }
  const target = nodeIn(host, targetId)
  if (!target) return null
  // the root only ever takes children, and so does a before/after on it: it
  // has no siblings to sit beside
  if (isHostRoot(host, target) || position === 'inside') {
    if (!hostAccepts(host, target)) {
      // a leaf can't hold it — land after the leaf instead of refusing, which
      // is what a drag onto the middle of a leaf row means
      const parent = parentOf(host, target.id)
      if (!parent) return null
      return { parent, index: parent.children.indexOf(target) + 1 }
    }
    return { parent: target, index: target.children.length }
  }
  const parent = parentOf(host, target.id)
  if (!parent) return null
  const at = parent.children.indexOf(target)
  return { parent, index: position === 'before' ? at : at + 1 }
}

/** does `ancestorId`'s subtree contain `id`? A node never moves into itself. */
function isWithin(root: ElementNode, ancestorId: string, id: string): boolean {
  const ancestor = findNode([root], ancestorId)
  return !!ancestor && ancestor.id !== id && !!findNode(ancestor.children, id)
}

export function canDropIn(
  host: StructureHost,
  ids: string[],
  targetId: string,
  position: DropPosition,
): boolean {
  const target = nodeIn(host, targetId)
  if (!target) return false
  if (position === 'inside' && !hostAccepts(host, target)) return false
  if (isHostRoot(host, target) && position !== 'inside') return false
  // nothing lands inside a component instance, and nothing leaves one
  if (enclosingInstance(host, targetId)) return false
  for (const id of ids) {
    if (id === targetId) return false
    const node = nodeIn(host, id)
    if (!node || isHostRoot(host, node)) return false
    if (enclosingInstance(host, id)) return false
    if (isWithin(host.root, id, targetId)) return false
  }
  return true
}

/**
 * Inserts a fresh element — or, given a component's name, an instance of it.
 * `components` is what the name resolves against and what the cycle check
 * reads; a component that would end up holding itself is refused.
 */
export function insertIn(
  host: StructureHost,
  type: string,
  targetId: string | null,
  position: DropPosition,
  components: ComponentDef[] = [],
  /** classes the new element lands with — what makes an insert dock entry a
   *  PRESET (Container, Grid) rather than an element type of its own */
  classes?: string,
): ElementNode | null {
  // a target inside an instance cannot take it: land after that instance
  const instance = targetId ? enclosingInstance(host, targetId) : null
  if (instance) {
    targetId = instance.id
    position = 'after'
  }
  const slot = resolveSlot(host, targetId, position)
  if (!slot) return null
  if (isComponentType(type)) {
    const inner = components.find((c) => c.name === type)
    if (!inner) return null
    // only a MASTER can hold itself; a page has no name to cycle through
    if (host.def && !canNest(known(host, components), host.def.name, inner.name)) return null
    // the instance's subtree is the inner component's structure, carrying none
    // of its state — the same shape a mirror in a master has
    const node = createMirror(inner.root)
    slot.parent.children.splice(slot.index, 0, node)
    return node
  }
  const node = createNode(type)
  if (classes?.trim()) node.classes = classes.trim()
  // a seeded container (button, link, label) is born holding its words, so an
  // insert lands something visible rather than an empty box
  const seed = seedChildFor(type)
  if (seed) node.children.push(seed)
  slot.parent.children.splice(slot.index, 0, node)
  return node
}

/** what a component name resolves to while editing this host — the project's
 *  components, plus the host's own def when it is still a library preview */
const known = (host: StructureHost, components: ComponentDef[]) =>
  !host.def || components.includes(host.def) ? components : [...components, host.def]

/** Detaches nodes and returns them. Skips the root and anything inside an
 *  instance, so a caller can pass a selection without pre-filtering it. */
function detachNodes(host: StructureHost, ids: string[]): ElementNode[] {
  const taken: ElementNode[] = []
  for (const id of ids) {
    const node = nodeIn(host, id)
    if (!node || isHostRoot(host, node) || enclosingInstance(host, id)) continue
    const parent = parentOf(host, id)
    if (!parent) continue
    const at = parent.children.indexOf(node)
    if (at === -1) continue
    parent.children.splice(at, 1)
    taken.push(node)
  }
  return taken
}

/** Interaction/animation bindings anywhere in the host that pointed into a
 *  removed subtree would dangle, so drop them. */
export function clearBindingsTo(host: StructureHost, removed: ElementNode[]): void {
  const gone = new Set<string>()
  for (const node of removed) walkNodes([node], (n) => gone.add(n.id))
  clearBindingsToIds(host, gone)
}

/**
 * The same, by id.
 *
 * An HTML write can move a node OUT of a subtree it is removing, so "every id
 * under the removed roots" is the wrong set there — what went is exactly the
 * ids the document had and no longer has.
 */
export function clearBindingsToIds(host: StructureHost, gone: Set<string>): void {
  if (!gone.size) return
  walkNodes([host.root], (n) => {
    if (n.interactions?.length) {
      n.interactions = n.interactions.filter((b) => !b.targetId || !gone.has(b.targetId))
      if (!n.interactions.length) delete n.interactions
    }
    if (n.animations?.length) {
      n.animations = n.animations.filter((b) => !b.targetId || !gone.has(b.targetId))
      if (!n.animations.length) delete n.animations
    }
  })
}

/**
 * Removes nodes, and returns what the selection should move to: the nearest
 * surviving sibling above the first removal, else its parent. Null when nothing
 * was removed.
 *
 * The neighbour is read BEFORE the splice — afterwards there is nothing left to
 * read it from — so that deleting a row leaves the selection where the user was
 * looking instead of falling back to the whole page body.
 */
export function removeFrom(host: StructureHost, ids: string[]): ElementNode | null {
  let next: ElementNode | null = null
  const anchor = ids
    .map((id) => nodeIn(host, id))
    .find((n): n is ElementNode => !!n && !isHostRoot(host, n) && !enclosingInstance(host, n.id))
  if (anchor) {
    const parent = parentOf(host, anchor.id)
    if (parent) {
      const before = parent.children.slice(0, parent.children.indexOf(anchor))
      for (const sibling of before) if (!ids.includes(sibling.id)) next = sibling
      next ??= parent
    }
  }
  const removed = detachNodes(host, ids)
  if (!removed.length) return null
  clearBindingsTo(host, removed)
  return next
}

export function moveIn(
  host: StructureHost,
  ids: string[],
  targetId: string,
  position: DropPosition,
): boolean {
  if (!canDropIn(host, ids, targetId, position)) return false
  // resolve the slot BEFORE detaching: pulling the nodes out shifts the index
  // the target sits at
  const slot = resolveSlot(host, targetId, position)
  if (!slot) return false
  const anchor = slot.parent.children[slot.index] ?? null
  const moved = detachNodes(host, ids)
  if (!moved.length) return false
  const at = anchor ? slot.parent.children.indexOf(anchor) : slot.parent.children.length
  slot.parent.children.splice(at === -1 ? slot.parent.children.length : at, 0, ...moved)
  return true
}

export function duplicateIn(host: StructureHost, ids: string[]): ElementNode[] {
  const made: ElementNode[] = []
  for (const id of ids) {
    const node = nodeIn(host, id)
    if (!node || isHostRoot(host, node) || enclosingInstance(host, id)) continue
    const parent = parentOf(host, id)
    if (!parent) continue
    // fresh ids with internal binding targets remapped onto them, so the copy's
    // own interactions drive the copy rather than the original
    const { cloned } = cloneSubtree(node)
    parent.children.splice(parent.children.indexOf(node) + 1, 0, cloned)
    made.push(cloned)
  }
  return made
}

/** Wraps a contiguous run of siblings in a new `:div`. */
export function wrapIn(host: StructureHost, ids: string[]): ElementNode | null {
  const nodes = ids
    .map((id) => nodeIn(host, id))
    .filter(
      (n): n is ElementNode => !!n && !isHostRoot(host, n) && !enclosingInstance(host, n.id),
    )
  if (!nodes.length) return null
  const parent = parentOf(host, nodes[0]!.id)
  if (!parent || nodes.some((n) => parentOf(host, n.id) !== parent)) return null
  const at = parent.children.indexOf(nodes[0]!)
  const wrapper = createNode('div')
  for (const node of nodes) parent.children.splice(parent.children.indexOf(node), 1)
  wrapper.children = nodes
  parent.children.splice(at, 0, wrapper)
  return wrapper
}

export function retypeIn(host: StructureHost, id: string, type: string): boolean {
  const node = nodeIn(host, id)
  if (!node || isHostRoot(host, node) || isComponentType(type)) return false
  // an instance is what it is, and so is everything inside one
  if (isComponentType(node.type) || enclosingInstance(host, id)) return false
  // turning a container into a leaf would orphan its children
  if (node.children.length && isLeafElement(type)) return false
  node.type = type
  return true
}

/**
 * Where a keyboard move of `ids` one visual slot would land.
 *
 * Mirrors a drag: it descends into an adjacent container, escapes its parent at
 * a boundary, or swaps with a sibling. A component instance is opaque (it
 * accepts no children), so the walk swaps past one instead of entering it.
 *
 * `ids` is a contiguous run of siblings — a single element is a run of one, so
 * the single and group moves are the same walk.
 */
export function nudgeTarget(
  host: StructureHost,
  ids: string[],
  dir: 'up' | 'down',
): { targetId: string; position: DropPosition } | null {
  const edge = nodeIn(host, dir === 'up' ? ids[0]! : ids[ids.length - 1]!)
  if (!edge || isHostRoot(host, edge)) return null
  const parent = parentOf(host, edge.id)
  if (!parent) return null
  const at = parent.children.indexOf(edge)
  const sibling = parent.children[dir === 'up' ? at - 1 : at + 1]

  if (sibling) {
    if (acceptsChildren(sibling) && sibling.children.length) {
      const inner =
        dir === 'up' ? sibling.children[sibling.children.length - 1]! : sibling.children[0]!
      return { targetId: inner.id, position: dir === 'up' ? 'after' : 'before' }
    }
    if (acceptsChildren(sibling)) return { targetId: sibling.id, position: 'inside' }
    return { targetId: sibling.id, position: dir === 'up' ? 'before' : 'after' }
  }
  // at a boundary: escape the parent, unless the parent is the host itself
  if (isHostRoot(host, parent)) return null
  return { targetId: parent.id, position: dir === 'up' ? 'before' : 'after' }
}

/**
 * Deep-clone a subtree with fresh ids, remapping interaction/animation
 * `targetId`s that pointed INSIDE it onto the copies — `cloneForMaster` under
 * another name, used here for duplicate and for the element clipboard, which
 * need exactly the same thing. (It also drops `ref`: a ref is a page-unique
 * address, so a copy may never carry the original's.)
 */
export function cloneSubtree(node: ElementNode): { cloned: ElementNode; idMap: Map<string, string> } {
  return cloneForMaster(node)
}
