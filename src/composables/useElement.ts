import { computed, effectScope, reactive, ref, shallowRef, toRaw, watch } from 'vue'
import { usePage } from './usePage'
import { findNode, walkNodes } from '@/lib/tree'
import type { ElementNode } from '@/types/editor'
import { isChannelName } from '@/lib/shared/interactionKeys.js'
import { isComponentType } from '@/lib/components'
import { useProject } from './useProject'

export type { DropPosition } from '@/lib/treeOps'
import type { DropPosition } from '@/lib/treeOps'

const selectedElementId = ref<string | null>(null)

const selectionScope = shallowRef<(() => ElementNode[]) | null>(null)

export function setSelectionScope(roots: (() => ElementNode[]) | null) {
  selectionScope.value = roots
  selectedElementId.value = null
  selectionAnchorId.value = null
  syncSet(highlightedIds, [])
}

const selectionAnchorId = ref<string | null>(null)

const highlightedIds = reactive(new Set<string>())
const selectedIds = reactive(new Set<string>())
const defaultSelectedIds = reactive(new Set<string>())
const dropTargets = reactive(new Map<string, DropPosition>())

function syncSet(set: Set<string>, next: Iterable<string>) {
  const want = new Set(next)
  for (const id of [...toRaw(set)]) if (!want.has(id)) set.delete(id)
  for (const id of want) if (!set.has(id)) set.add(id)
}

const revealTick = ref(0)

const draggingId = ref<string | null>(null)
const dropTarget = ref<{ id: string; position: DropPosition } | null>(null)

watch(dropTarget, (target) => {
  for (const id of [...toRaw(dropTargets).keys()]) if (id !== target?.id) dropTargets.delete(id)
  if (target) dropTargets.set(target.id, target.position)
})

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

  const REF_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/

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
    selectionAnchorId.value = id
  }

  function highlightElement(id: string | null) {
    syncSet(highlightedIds, id ? [id] : [])
  }

  function isHighlighted(id: string): boolean {
    return highlightedIds.has(id)
  }

  function isSelected(id: string, withDefault = false): boolean {
    return selectedIds.has(id) || (withDefault && defaultSelectedIds.has(id))
  }

  function dropPositionFor(id: string): DropPosition | null {
    return dropTargets.get(id) ?? null
  }

  function requestReveal() {
    revealTick.value++
  }

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

  const selectedElementIds = computed<string[]>(() => {
    const focus = selectedElementId.value
    if (!focus) return []
    const anchor = selectionAnchorId.value ?? focus
    if (anchor === focus) return [focus]
    const f = siblingsOf(focus)
    const a = siblingsOf(anchor)
    if (!f || !a || f.list !== a.list) return [focus]
    const lo = Math.min(f.index, a.index)
    const hi = Math.max(f.index, a.index)
    return f.list.slice(lo, hi + 1).map((n) => n.id)
  })

  const isMultiSelect = computed(() => selectedElementIds.value.length > 1)

  function extendSelection(dir: 'up' | 'down') {
    const focus = selectedElementId.value
    if (!focus) return
    const f = siblingsOf(focus)
    if (!f) return
    const next = f.list[f.index + (dir === 'down' ? 1 : -1)]
    if (!next || next.type === 'body') return
    if (!selectionAnchorId.value) selectionAnchorId.value = focus
    selectedElementId.value = next.id
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
