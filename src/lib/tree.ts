import type { ElementNode } from '@/types/editor'

/** structural deep clone via JSON round-trip — for plain serializable data
 * (pages, nodes, entries, the project itself) */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** depth-first visit of every node in the element tree */
export function walkNodes(nodes: ElementNode[], visit: (node: ElementNode) => void) {
  for (const node of nodes) {
    visit(node)
    walkNodes(node.children, visit)
  }
}

/** finds a node anywhere in the tree by id */
export function findNode(nodes: ElementNode[], id: string): ElementNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const match = findNode(node.children, id)
    if (match) return match
  }
  return null
}

/** finds the parent of a node by id (null for roots / not found) */
export function findParent(nodes: ElementNode[], id: string): ElementNode | null {
  for (const node of nodes) {
    if (node.children.some((child) => child.id === id)) return node
    const match = findParent(node.children, id)
    if (match) return match
  }
  return null
}

/** true when the node with `id` has an ancestor of the given type */
export function hasAncestorOfType(nodes: ElementNode[], id: string, type: string): boolean {
  for (const node of nodes) {
    if (node.type === type && findNode(node.children, id)) return true
    if (hasAncestorOfType(node.children, id, type)) return true
  }
  return false
}
