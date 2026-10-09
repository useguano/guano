import type { ElementNode } from '@/types/editor'

export interface ElementDef {
  tag: string
  defaultContent?: string
  void?: boolean
  suggest?: string

  attrs?: Record<string, string>

  seed?: { type: string; content: string }
}

import { ELEMENTS_DATA } from './shared/elements.js'
import { isFormControl } from './shared/forms.js'
import { uid } from './shared/ids.js'

export const ELEMENTS: Record<string, ElementDef> = ELEMENTS_DATA

export function isKnownElement(type: string) {
  return type in ELEMENTS
}

export function isLeafElement(type: string): boolean {
  const def = ELEMENTS[type]
  return !!def && (def.defaultContent !== undefined || def.void === true)
}

export function isInstancePart(type: string): boolean {
  return isLeafElement(type) || isFormControl(type) || type === 'link' || type === 'button'
}

export function createNode(type: string): ElementNode {
  return { id: uid(), type, content: '', children: [] }
}

export function seedChildFor(type: string): ElementNode | null {
  const seed = ELEMENTS[type]?.seed
  if (!seed) return null
  return { ...createNode(seed.type), content: seed.content }
}

const TYPE_GROUPS: string[][] = [
  ['section', 'div', 'header', 'footer', 'article', 'nav', 'main', 'aside', 'list-item'],
  ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  ['text', 'paragraph', 'span'],
  ['button', 'link', 'label'],
  ['list', 'form'],
  ['thead', 'tbody'],
  ['th', 'td'],
]

export function typeOptionsFor(type: string): string[] {
  return TYPE_GROUPS.find((group) => group.includes(type)) ?? []
}
