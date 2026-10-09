import type { ComponentDef, ElementNode } from '@/types/editor'
import { cloneForMaster, createMirror, isComponentType } from './components'
import { createNode, isLeafElement, seedChildFor } from './elements'
import { findNode, findParent, walkNodes } from './tree'
import { canNest } from './instances'

export type DropPosition = 'before' | 'after' | 'inside'

export interface StructureHost {
  root: ElementNode
  def: ComponentDef | null
}

export const pageHost = (body: ElementNode): StructureHost => ({ root: body, def: null })
export const masterHost = (def: ComponentDef): StructureHost => ({ root: def.root, def })

export function acceptsChildren(node: ElementNode): boolean {
  return !isComponentType(node.type) && !isLeafElement(node.type)
}

const hostAccepts = (host: StructureHost, node: ElementNode) =>
  isHostRoot(host, node) || acceptsChildren(node)

export function isHostRoot(host: StructureHost, node: ElementNode): boolean {
  return node.id === host.root.id
}

export function enclosingInstance(host: StructureHost, id: string): ElementNode | null {
  let found: ElementNode | null = null
  const visit = (nodes: ElementNode[], instance: ElementNode | null) => {
    for (const node of nodes) {
      if (found) return
      if (node.id === id) {
        found = instance
        return
      }
      visit(node.children, node.slot ? null : (instance ?? (isComponentType(node.type) ? node : null)))
    }
  }
  visit(host.root.children, null)
  return found
}

const parentOf = (host: StructureHost, id: string) => findParent([host.root], id)
const nodeIn = (host: StructureHost, id: string) => findNode([host.root], id)

export function resolveSlot(
  host: StructureHost,
  targetId: string | null,
  position: DropPosition,
): { parent: ElementNode; index: number } | null {
  if (!targetId) return { parent: host.root, index: host.root.children.length }
  const target = nodeIn(host, targetId)
  if (!target) return null
  if (isHostRoot(host, target) || position === 'inside') {
    if (!hostAccepts(host, target)) {
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

export function insertIn(
  host: StructureHost,
  type: string,
  targetId: string | null,
  position: DropPosition,
  components: ComponentDef[] = [],

  classes?: string,
): ElementNode | null {
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
    if (host.def && !canNest(known(host, components), host.def.name, inner.name)) return null
    const node = createMirror(inner.root)
    slot.parent.children.splice(slot.index, 0, node)
    return node
  }
  const node = createNode(type)
  if (classes?.trim()) node.classes = classes.trim()
  const seed = seedChildFor(type)
  if (seed) node.children.push(seed)
  slot.parent.children.splice(slot.index, 0, node)
  return node
}

const known = (host: StructureHost, components: ComponentDef[]) =>
  !host.def || components.includes(host.def) ? components : [...components, host.def]

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

export function clearBindingsTo(host: StructureHost, removed: ElementNode[]): void {
  const gone = new Set<string>()
  for (const node of removed) walkNodes([node], (n) => gone.add(n.id))
  clearBindingsToIds(host, gone)
}

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
    const { cloned } = cloneSubtree(node)
    parent.children.splice(parent.children.indexOf(node) + 1, 0, cloned)
    made.push(cloned)
  }
  return made
}

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
  if (isComponentType(node.type) || enclosingInstance(host, id)) return false
  if (node.children.length && isLeafElement(type)) return false
  node.type = type
  return true
}

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
  if (isHostRoot(host, parent)) return null
  return { targetId: parent.id, position: dir === 'up' ? 'before' : 'after' }
}

export function cloneSubtree(node: ElementNode): { cloned: ElementNode; idMap: Map<string, string> } {
  return cloneForMaster(node)
}
