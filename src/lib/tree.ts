import type { ElementNode } from '@/types/editor'

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function walkNodes(nodes: ElementNode[], visit: (node: ElementNode) => void) {
  for (const node of nodes) {
    visit(node)
    walkNodes(node.children, visit)
  }
}

export function findNode(nodes: ElementNode[], id: string): ElementNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const match = findNode(node.children, id)
    if (match) return match
  }
  return null
}

export function findParent(nodes: ElementNode[], id: string): ElementNode | null {
  for (const node of nodes) {
    if (node.children.some((child) => child.id === id)) return node
    const match = findParent(node.children, id)
    if (match) return match
  }
  return null
}

export function hasAncestorOfType(nodes: ElementNode[], id: string, type: string): boolean {
  for (const node of nodes) {
    if (node.type === type && findNode(node.children, id)) return true
    if (hasAncestorOfType(node.children, id, type)) return true
  }
  return false
}
