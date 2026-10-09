import type { ElementNode } from '@/types/editor'
import { walkNodes } from '../tree'

const BASE = 8

export function shortIds(roots: ElementNode[]): Map<string, string> {
  const ids: string[] = []
  walkNodes(roots, (n) => ids.push(n.id))
  const out = new Map<string, string>()
  const taken = new Set<string>()
  for (const id of ids) {
    const flat = id.replace(/-/g, '')
    let length = Math.min(BASE, flat.length)
    let short = flat.slice(0, length)
    while (taken.has(short) && length < flat.length) short = flat.slice(0, ++length)
    if (taken.has(short)) continue
    taken.add(short)
    out.set(id, short)
  }
  return out
}

export function nodesByShortId(roots: ElementNode[]): Map<string, ElementNode> {
  const out = new Map<string, ElementNode>()
  const shorts = shortIds(roots)
  walkNodes(roots, (n) => {
    const short = shorts.get(n.id)
    if (short) out.set(short, n)
    out.set(n.id, n)
    out.set(n.id.replace(/-/g, ''), n)
  })
  return out
}
