import { computed, effectScope, reactive, ref, shallowRef, toRaw, watch } from 'vue'
import { usePage } from './usePage'
import { findNode, walkNodes } from '@/lib/tree'
import type { ElementNode } from '@/types/editor'
import { isChannelName } from '@/lib/shared/interactionKeys.js'
import { isComponentType } from '@/lib/components'
import { useProject } from './useProject'

// one definition of where a drop lands, shared with the structure ops
export type { DropPosition } from '@/lib/treeOps'
import type { DropPosition } from '@/lib/treeOps'

const selectedElementId = ref<string | null>(null)

// The trees a selection resolves against. Normally the active page; the
// components board swaps in the component masters while it is on the canvas,
// so the panels edit a master node exactly as they edit a page node. A getter
// (not a list) so the computeds below track whatever it reads.
const selectionScope = shallowRef<(() => ElementNode[]) | null>(null)

/** point selection at other trees (null = back to the active page) */
export function setSelectionScope(roots: (() => ElementNode[]) | null) {
  selectionScope.value = roots
  selectedElementId.value = null
  selectionAnchorId.value = null
  syncSet(highlightedIds, [])
}

// the fixed end of a multi-selection; the focus (selectedElementId) moves with
// Cmd+Shift+↑/↓. Together they define a contiguous run of siblings.
const selectionAnchorId = ref<string | null>(null)

// --- per-id marks: what a canvas element asks about ITSELF ---
//
// Every rendered element (× breakpoint frames) and every Layers row asks "am I
// selected / highlighted / the drop target?". Asked against one shared ref,
// each is a dependency of that ref, so hovering a Layers row — which writes
// the highlight twice per row crossed — re-evaluated a computed in every
// element on the page: ~15 ms a change on a 5,000-element page before any
// real render work, felt as the canvas lagging behind the pointer. A reactive
// Set/Map tracks `has`/`get` PER KEY, so a change reaches only the element
// leaving the state and the one entering it. Write them only through
// `syncSet` / the watchers below — `clear()` notifies every key again.
const highlightedIds = reactive(new Set<string>())
const selectedIds = reactive(new Set<string>())
/** the body when nothing is picked — the canvas outlines it, the tree does not */
const defaultSelectedIds = reactive(new Set<string>())
const dropTargets = reactive(new Map<string, DropPosition>())

function syncSet(set: Set<string>, next: Iterable<string>) {
  const want = new Set(next)
  for (const id of [...toRaw(set)]) if (!want.has(id)) set.delete(id)
  for (const id of want) if (!set.has(id)) set.add(id)
}

// bumped to ask the Layers tree to bring the current selection into view
// (e.g. after inserting from the ⌘E dock)
const revealTick = ref(0)

// shared drag state so the canvas, the Layers tree and palette drags stay in
// sync ('inside' comes from tree drags and palette insert-drags — the canvas
// drag only ever offers before/after)
const draggingId = ref<string | null>(null)
const dropTarget = ref<{ id: string; position: DropPosition } | null>(null)

watch(dropTarget, (target) => {
  for (const id of [...toRaw(dropTargets).keys()]) if (id !== target?.id) dropTargets.delete(id)
  if (target) dropTargets.set(target.id, target.position)
})

// the selection marks derive from per-caller computeds, so they are kept in
// step by ONE watcher in a detached scope — created inside a component's
// setup it would die with that component (the `useThemeTokens` lesson)
let selectionMarksStarted = false
function startSelectionMarks() {
  if (selectionMarksStarted) return
  selectionMarksStarted = true
  effectScope(true).run(() => {
    const { selectedElementIds, bodyElement } = useElement()
    watch(
      [selectedElementIds, () => bodyElement.value?.id ?? null],
      ([ids, bodyId]) => {
        syncSet(selectedIds, ids)
        syncSet(defaultSelectedIds, ids.length === 0 && bodyId ? [bodyId] : [])
      },
      { immediate: true },
    )
  })
}

export function useElement() {
  startSelectionMarks()
  const { activePage } = usePage()

  const elements = computed(() =>
    selectionScope.value ? selectionScope.value() : (activePage.value?.elements ?? []),
  )

  const bodyElement = computed(() => elements.value.find((n) => n.type === 'body') ?? null)

  // the page body is the default selection — styling with nothing
  // picked styles the body, like any other element
  const selectedElement = computed(
    () =>
      (selectedElementId.value ? findNode(elements.value, selectedElementId.value) : null) ??
      bodyElement.value,
  )

  function getElement(id: string): ElementNode | null {
    return findNode(elements.value, id)
  }

  function updateElement(id: string, patch: Partial<Omit<ElementNode, 'id' | 'children'>>) {
    const node = findNode(elements.value, id)
    if (node) Object.assign(node, patch)
  }

  /** a valid client ref: same charset as an element name */
  const REF_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/

  /**
   * Sets or clears an element's `#ref` — its stable client-side address.
   *
   * Refs are page-scope and must be unique, so a collision is refused rather
   * than silently creating an ambiguous pair (an agent addressing by one could
   * not be told which element it meant). The body has no ref: it is the page
   * root and is already addressable. Returns whether it wrote, so the Layers
   * row can say why a rename was refused.
   */
  function setElementRef(id: string, ref: string | null): boolean {
    const page = activePage.value
    const node = page ? findNode(page.elements, id) : null
    if (!page || !node || node.type === 'body') return false
    if (ref !== null && !REF_RE.test(ref)) return false
    if (ref !== null && ref !== node.ref) {
      let taken = false
      walkNodes(page.elements, (n) => {
        if (n.id !== id && n.ref === ref) taken = true
      })
      if (taken) return false
    }
    if (ref) node.ref = ref
    else delete node.ref
    return true
  }

  /**
   * Declare (or clear) the CHANNEL an element listens on — a site-wide effect
   * target, so a binding anywhere in the project aimed at `@<name>` lands here.
   *
   * Takes the NODE, not an id: on the components board the selection is a
   * master node, and inside an instance the caller passes the master (a
   * channel is shared state, like classes — every instance listens).
   *
   * Returns whether it wrote, like `setElementRef`: the caller surfaces the
   * reason rather than the field silently keeping a value nothing can reach.
   * Refused for a bad name, a second listener in the same tree, an instance
   * wrapper (it emits no element) and a node inside a repeat (it would open
   * once per row) — the same rules `validateTree` reports.
   */
  function setElementChannel(target: ElementNode, channel: string | null): boolean {
    if (!target) return false
    if (!channel) {
      delete target.channel
      return true
    }
    if (!isChannelName(channel) || isComponentType(target.type)) return false
    const { project } = useProject()
    const trees: ElementNode[][] = [
      ...project.value.pages.map((p) => p.elements),
      ...project.value.components.map((c) => [c.root]),
    ]
    for (const tree of trees) {
      let holds = false
      let taken = false
      let inRepeat = false
      const visit = (nodes: ElementNode[], repeat: boolean) => {
        for (const n of nodes) {
          if (n === target) {
            holds = true
            inRepeat = repeat
          } else if (n.channel === channel) {
            taken = true
          }
          visit(
            n.children,
            repeat || n.type === 'collection-list' || (n.type === 'slider' && !!n.arg),
          )
        }
      }
      visit(tree, false)
      if (!holds) continue
      if (taken || inRepeat) return false
      target.channel = channel
      return true
    }
    return false
  }

  function selectElement(id: string | null) {
    selectedElementId.value = id
    selectionAnchorId.value = id // a plain select collapses any multi-selection
  }

  // a transient "preview" highlight, independent of selection — e.g. hovering an
  // interaction's Target button or a Layers row outlines the element on the
  // canvas without changing the real selection (which would swap the panel)
  function highlightElement(id: string | null) {
    syncSet(highlightedIds, id ? [id] : [])
  }

  /** is this element the transient highlight? Tracks only this id. */
  function isHighlighted(id: string): boolean {
    return highlightedIds.has(id)
  }

  /** is this element in the selection? `withDefault` counts the body that
   *  stands in when nothing is picked (the canvas does, the tree doesn't). */
  function isSelected(id: string, withDefault = false): boolean {
    return selectedIds.has(id) || (withDefault && defaultSelectedIds.has(id))
  }

  /** where a drag would land relative to this element, if it is the target */
  function dropPositionFor(id: string): DropPosition | null {
    return dropTargets.get(id) ?? null
  }

  /** ask the Layers tree to scroll the selection's row into view */
  function requestReveal() {
    revealTick.value++
  }

  // --- multi-selection: a contiguous run of siblings (anchor..focus) ---

  /** the sibling list (children array) holding `id`, and its index within it */
  function siblingsOf(id: string): { list: ElementNode[]; index: number } | null {
    let found: { list: ElementNode[]; index: number } | null = null
    const visit = (list: ElementNode[]) => {
      if (found) return
      const index = list.findIndex((n) => n.id === id)
      if (index !== -1) {
        found = { list, index }
        return
      }
      for (const n of list) visit(n.children)
    }
    visit(elements.value)
    return found
  }

  /** contiguous sibling ids from the anchor to the focus (selectedElementId) */
  const selectedElementIds = computed<string[]>(() => {
    const focus = selectedElementId.value
    if (!focus) return []
    const anchor = selectionAnchorId.value ?? focus
    if (anchor === focus) return [focus]
    const f = siblingsOf(focus)
    const a = siblingsOf(anchor)
    if (!f || !a || f.list !== a.list) return [focus] // not siblings → just the focus
    const lo = Math.min(f.index, a.index)
    const hi = Math.max(f.index, a.index)
    return f.list.slice(lo, hi + 1).map((n) => n.id)
  })

  const isMultiSelect = computed(() => selectedElementIds.value.length > 1)

  /** grow/shrink the selection to the previous/next sibling of the focus */
  function extendSelection(dir: 'up' | 'down') {
    const focus = selectedElementId.value
    if (!focus) return
    const f = siblingsOf(focus)
    if (!f) return
    const next = f.list[f.index + (dir === 'down' ? 1 : -1)]
    if (!next || next.type === 'body') return
    if (!selectionAnchorId.value) selectionAnchorId.value = focus
    selectedElementId.value = next.id // focus moves; anchor stays → range recomputes
  }

  return {
    elements,
    bodyElement,
    selectedElement,
    selectedElementIds,
    isMultiSelect,
    extendSelection,
    draggingId,
    dropTarget,
    getElement,
    updateElement,
    setElementRef,
    setElementChannel,
    selectElement,
    siblingsOf,
    highlightElement,
    isHighlighted,
    isSelected,
    dropPositionFor,
    revealTick,
    requestReveal,
  }
}
