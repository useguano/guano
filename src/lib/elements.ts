import type { ElementNode } from '@/types/editor'

export interface ElementDef {
  /** HTML tag rendered in the canvas */
  tag: string
  /** Placeholder content until the user edits the element */
  defaultContent?: string
  /** Void elements cannot have children or text */
  void?: boolean
  /** the element type ghost-suggested as this block's first child (autocomplete) */
  suggest?: string
  /** attributes the element type IMPLIES (a :checkbox is <input type="checkbox">).
   * Emitted by every renderer, and overridable by the author's own attributes. */
  attrs?: Record<string, string>
  /** the child a brand-new element of this type is created with. A button and
   * a link are containers whose words live in a child, so an unseeded insert
   * would land an empty box — see the registry's header comment. */
  seed?: { type: string; content: string }
}

import { ELEMENTS_DATA } from './shared/elements.js'
import { isFormControl } from './shared/forms.js'
import { uid } from './shared/ids.js'

/** the element registry — data lives in the shared plain-JS module so the
 * node exporter (server/export.mjs) consumes the exact same source */
export const ELEMENTS: Record<string, ElementDef> = ELEMENTS_DATA

export function isKnownElement(type: string) {
  return type in ELEMENTS
}

/**
 * A leaf element carries text content or is void — it is ALWAYS written as
 * `:name:` and can never be opened as a block. Everything else (section,
 * div, form, list, …) is a container: `:name … name:`.
 */
export function isLeafElement(type: string): boolean {
  const def = ELEMENTS[type]
  return !!def && (def.defaultContent !== undefined || def.void === true)
}

/**
 * Does an INSTANCE address this element as one of its parts?
 *
 * Leaf-ness used to be the only test, and it is the wrong question. It made an
 * `:input` (void) a part and a `:textarea` (a container, because its value is
 * its text) not one — so a Textarea component exposed its label and hid the
 * control an agent has to name per placement, while the Input beside it
 * exposed both. And an `:link` was not a part at all, which is why a Button
 * component could not be given a destination per placement.
 *
 * The real question is whether an instance has anything of its OWN to say
 * about the element: its text or media (a leaf), its `name`/`placeholder` (a
 * form control), where it goes (a link — per-instance with a component
 * default, which is what lets one Button serve a dozen destinations), or what
 * it does when clicked (a `button`'s `type="submit"` / `"reset"`, which is per
 * placement for the same reason: a Button serving a form's submit and its
 * reset is the whole point of having one Button).
 */
export function isInstancePart(type: string): boolean {
  // `isFormControl` is the one list of what a visitor types into or picks from
  // (shared/forms.js, where the export and the endpoint read it); a second
  // copy here would be the drift this codebase keeps paying for.
  return isLeafElement(type) || isFormControl(type) || type === 'link' || type === 'button'
}

export function createNode(type: string): ElementNode {
  return { id: uid(), type, content: '', children: [] }
}

/**
 * The node a seeded container is born with, or null — so an insert lands
 * something visible instead of an empty box. One builder for both structure
 * hosts, since both insert into a tree.
 */
export function seedChildFor(type: string): ElementNode | null {
  const seed = ELEMENTS[type]?.seed
  if (!seed) return null
  return { ...createNode(seed.type), content: seed.content }
}

/**
 * Types an element can switch between (same structural shape per group).
 *
 * The pure aliases (`container`, `grid`, `heading`, `dropdown`) are absent:
 * nothing can create one any more — the v2 migration collapsed every stored
 * one, and the insert dock offers Container/Grid/Heading as PRESETS (a div or
 * an h2 plus classes) rather than as types. They stay in the registry above
 * purely so a blob the migration never saw still renders its real tag instead
 * of degrading to a bare div; that can go one release after launch.
 */
const TYPE_GROUPS: string[][] = [
  ['section', 'div', 'header', 'footer', 'article', 'nav', 'main', 'aside', 'list-item'],
  ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  ['text', 'paragraph', 'span'],
  // the seeded containers: one shape (a wrapper around its words), so they
  // retype into each other cleanly. `label` left the text group when it became
  // a container — a container can never become a leaf without losing children
  ['button', 'link', 'label'],
  ['list', 'form'],
  ['thead', 'tbody'],
  ['th', 'td'],
]

export function typeOptionsFor(type: string): string[] {
  return TYPE_GROUPS.find((group) => group.includes(type)) ?? []
}
