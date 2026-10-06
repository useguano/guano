import type { ElementNode } from '@/types/editor'
import { walkNodes } from '../tree'

/**
 * Short `data-id`s.
 *
 * A node id is a uuid. Printing 36 characters on every element of a 9,000-node
 * page costs an agent more context than the markup does, and the id only has
 * to be unique within the ONE document the agent is looking at. So the read
 * emits an 8-hex prefix, lengthened only where two ids collide, and the write
 * resolves a prefix back.
 *
 * It is the strongest adoption signal there is: an agent that echoes back the
 * ids it read keeps every node's identity — its interactions, its
 * translations, its comment anchors — whatever else it rewrites.
 */

const BASE = 8

/** node id → the shortest unique prefix, per tree */
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
    // two ids identical to the last character cannot both be addressed; the
    // second simply gets none, which costs it the id signal and nothing else
    if (taken.has(short)) continue
    taken.add(short)
    out.set(id, short)
  }
  return out
}

/** the inverse: a short id (or a full uuid) → the node it addresses */
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
