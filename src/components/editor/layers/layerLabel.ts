import { ELEMENTS } from '@/lib/elements'
import { isComponentType } from '@/lib/components'
import type { InstanceMapping } from '@/lib/instances'
import type { ElementNode } from '@/types/editor'

export type MasterLookup = (id: string) => InstanceMapping | null

function textOf(node: ElementNode, masterFor: MasterLookup): string {
  if (node.content) return node.content
  const mapping = masterFor(node.id)
  if (!mapping) return ''
  return [...mapping.mirrors, mapping.master].find((source) => source.content)?.content ?? ''
}

function seedText(node: ElementNode, masterFor: MasterLookup): string {
  if (!ELEMENTS[node.type]?.seed) return ''
  for (const child of node.children) {
    const own = textOf(child, masterFor)
    if (own) return own
  }
  return ''
}

export function layerLabel(node: ElementNode, masterFor: MasterLookup): string {
  if (node.ref) return `#${node.ref}`
  if (isComponentType(node.type)) return node.type
  const text = (textOf(node, masterFor) || seedText(node, masterFor) || '')
    .replace(/<[^>]*>/g, ' ')
    .trim()
  if (text) return text.length > 28 ? `${text.slice(0, 28)}…` : text
  if (node.arg) return `[${node.arg}]`
  return node.type
}
