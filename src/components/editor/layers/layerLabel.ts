import { ELEMENTS } from '@/lib/elements'
import { isComponentType } from '@/lib/components'
import type { InstanceMapping } from '@/lib/instances'
import type { ElementNode } from '@/types/editor'

/** `useComponents().masterFor` — passed in so this stays a pure function */
export type MasterLookup = (id: string) => InstanceMapping | null

/** a node's text: its own, else what its hosts say, else its master's */
function textOf(node: ElementNode, masterFor: MasterLookup): string {
  if (node.content) return node.content
  const mapping = masterFor(node.id)
  if (!mapping) return ''
  return [...mapping.mirrors, mapping.master].find((source) => source.content)?.content ?? ''
}

/** the words of a seeded container (a button, a link) live in its child, so
 *  the row would otherwise read `button` — which says nothing on a page of them */
function seedText(node: ElementNode, masterFor: MasterLookup): string {
  if (!ELEMENTS[node.type]?.seed) return ''
  for (const child of node.children) {
    const own = textOf(child, masterFor)
    if (own) return own
  }
  return ''
}

/**
 * What to call a row. The type alone — which is all anything in the app
 * showed for a node until now — makes a page of `div` / `div` / `div`, so
 * prefer whatever the author actually wrote: its ref, its text, its binding.
 *
 * Shared with the Layers search, so a row is findable by exactly the words
 * it shows.
 */
export function layerLabel(node: ElementNode, masterFor: MasterLookup): string {
  if (node.ref) return `#${node.ref}`
  if (isComponentType(node.type)) return node.type
  // inside an instance the node's own content is empty by design — the master
  // holds it, and the master is what renders
  const text = (textOf(node, masterFor) || seedText(node, masterFor) || '')
    .replace(/<[^>]*>/g, ' ')
    .trim()
  if (text) return text.length > 28 ? `${text.slice(0, 28)}…` : text
  if (node.arg) return `[${node.arg}]`
  // the TYPE, not the tag: `heading` and `text` say more than `h2` and `div`
  return node.type
}
