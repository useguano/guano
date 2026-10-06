import { computed, inject, onBeforeUnmount, onMounted, provide, watch, type InjectionKey, type Ref } from 'vue'
import { useElement, type DropPosition } from '@/composables/useElement'
import { useStructure } from '@/composables/useStructure'
import { useInsertDrag } from '@/composables/useInsertDrag'
import { usePanel } from '@/composables/usePanel'
import { findNode } from '@/lib/tree'
import { useLayerState } from './layerState'
import type { ElementNode } from '@/types/editor'

/**
 * Everything a surface showing layer rows needs beyond rendering them: row
 * drags, the ⌘E dock's drop target, the keyboard, and keeping the selection in
 * view. One per surface — the Pages drawer's Layers view, the Components
 * drawer's expanded rows — however many trees that surface happens to show.
 *
 * Rows reach it through provide/inject rather than an emit chain: a row is
 * recursive, and re-emitting a pointerdown up through every level of a deep
 * tree is noise.
 */

interface LayerSurface {
  onRowPointerDown: (e: PointerEvent, id: string) => void
}

const LAYER_SURFACE: InjectionKey<LayerSurface> = Symbol('layer-surface')

export const useLayerSurfaceRow = () => inject(LAYER_SURFACE, null)

const DRAG_THRESHOLD = 4

export function useLayerSurface(opts: {
  /** the focusable element holding the rows; carries `data-insert-surface` */
  surface: Ref<HTMLElement | undefined>
  /** the trees on this surface, in display order */
  roots: () => ElementNode[]
  /** refs are page-scope, so only a page surface renames */
  canRename: () => boolean
  /** called before a node is revealed, to open whatever contains its tree */
  beforeReveal?: (id: string) => void
}) {
  const {
    selectedElement, selectElement, extendSelection,
    draggingId, dropTarget, getElement, revealTick,
  } = useElement()
  const { backend } = useStructure()
  const { registerDropResolver } = useInsertDrag()
  const { activePanelId, openPanel, closePanel } = usePanel()
  const { reveal, isCollapsed, setCollapsed, editingRefId } = useLayerState()

  // the visible rows, in order: what ↑/↓ walk
  const visibleRows = computed<ElementNode[]>(() => {
    const out: ElementNode[] = []
    const walk = (nodes: ElementNode[]) => {
      for (const node of nodes) {
        out.push(node)
        if (node.children.length && !isCollapsed(node.id)) walk(node.children)
      }
    }
    walk(opts.roots())
    return out
  })

  /** ids from a root down to `id`, excluding it */
  function ancestorsOf(id: string): string[] {
    const path: string[] = []
    const walk = (nodes: ElementNode[], trail: string[]): boolean => {
      for (const node of nodes) {
        if (node.id === id) {
          path.push(...trail)
          return true
        }
        if (walk(node.children, [...trail, node.id])) return true
      }
      return false
    }
    walk(opts.roots(), [])
    return path
  }

  const rowEl = (id: string) =>
    opts.surface.value?.querySelector<HTMLElement>(`[data-layer-row="${CSS.escape(id)}"]`) ?? null

  // an explicit reveal (Escape out of a panel, a canvas click, a dock insert)
  // also takes keyboard focus, so the tree's keys work without a click
  watch(revealTick, () => opts.surface.value?.focus({ preventScroll: true }))

  // a selection made anywhere else — the canvas, a shortcut, the interactions
  // panel's target picker — has to become visible here
  watch(
    [() => selectedElement.value?.id, revealTick],
    async ([id]) => {
      if (!id) return
      opts.beforeReveal?.(id)
      if (!findNode(opts.roots(), id)) return
      reveal(ancestorsOf(id))
      await new Promise(requestAnimationFrame)
      rowEl(id)?.scrollIntoView({ block: 'nearest' })
    },
    { immediate: true },
  )

  /**
   * Which row is under this pointer Y, and where in it: the top and bottom
   * quarters mean before/after, the middle means inside — but only for a node
   * that can actually take children, otherwise a drop on a leaf's middle would
   * silently become something else.
   */
  function resolveAt(clientY: number): { id: string; position: DropPosition } | null {
    const box = opts.surface.value?.getBoundingClientRect()
    if (!box) return null
    const el = document
      .elementFromPoint(box.left + box.width / 2, clientY)
      ?.closest<HTMLElement>('[data-layer-row]')
    if (!el) return null
    const id = el.dataset.layerRow!
    const node = getElement(id)
    if (!node) return null
    const rect = el.getBoundingClientRect()
    const frac = (clientY - rect.top) / rect.height
    if (backend.value.isContainer(node)) {
      if (frac < 0.25) return { id, position: 'before' }
      if (frac > 0.75) return { id, position: 'after' }
      return { id, position: 'inside' }
    }
    return { id, position: frac < 0.5 ? 'before' : 'after' }
  }

  onMounted(() => registerDropResolver(resolveAt))
  onBeforeUnmount(() => registerDropResolver(null))

  function onRowPointerDown(e: PointerEvent, id: string) {
    if (e.button !== 0 || editingRefId.value) return
    const start = { x: e.clientX, y: e.clientY }
    let active = false

    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) <= DRAG_THRESHOLD) return
        // the row being dragged becomes the selection first: on the components
        // board that is what decides WHICH component the structure ops act on
        selectElement(id)
        const node = getElement(id)
        if (!node || !backend.value.can(node, 'move')) return cleanup()
        active = true
        // the shared refs: the canvas paints its own drop feedback off them,
        // so dragging in the tree highlights the element out there too
        draggingId.value = id
        document.body.style.cursor = 'grabbing'
      }
      const hit = resolveAt(ev.clientY)
      dropTarget.value =
        hit && hit.id !== id && backend.value.canDrop([id], hit.id, hit.position) ? hit : null
    }

    const end = () => {
      const target = dropTarget.value
      const dropped = active
      cleanup()
      if (dropped && target) backend.value.move([id], target.id, target.position)
    }

    const cancel = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      cleanup()
    }

    function cleanup() {
      draggingId.value = null
      dropTarget.value = null
      document.body.style.cursor = ''
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('keydown', cancel, true)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('keydown', cancel, true)
  }

  provide(LAYER_SURFACE, { onRowPointerDown })

  function onKeydown(e: KeyboardEvent) {
    // a key typed into a field on this surface (the inline ref input, a search
    // box) is that field's business — and it arrives here on the way up, AFTER
    // the field has closed itself, so testing `editingRefId` alone would let
    // Enter immediately re-open what it just committed
    if (editingRefId.value || e.target !== opts.surface.value) return
    const current = selectedElement.value
    const rows = visibleRows.value
    const at = current ? rows.findIndex((n) => n.id === current.id) : -1

    // Shift+↑/↓ MOVES the element; ⌘⇧↑/↓ extends the selection; plain ↑/↓ walk
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const dir = e.key === 'ArrowUp' ? 'up' : 'down'
      if (e.shiftKey && !e.metaKey && !e.ctrlKey) {
        // the app keymap owns Shift+↑/↓; leave it to bubble there
        return
      }
      if (e.shiftKey && (e.metaKey || e.ctrlKey)) {
        extendSelection(dir)
        e.preventDefault()
        return
      }
      const next = rows[Math.min(rows.length - 1, Math.max(0, at + (dir === 'up' ? -1 : 1)))]
      if (next) selectElement(next.id)
      e.preventDefault()
      return
    }

    if (!current || at === -1) return

    if (e.key === 'ArrowRight') {
      if (current.children.length && isCollapsed(current.id)) setCollapsed(current.id, false)
      else if (current.children.length) selectElement(current.children[0]!.id)
      e.preventDefault()
      return
    }
    if (e.key === 'ArrowLeft') {
      if (current.children.length && !isCollapsed(current.id)) setCollapsed(current.id, true)
      else {
        const parent = ancestorsOf(current.id).slice(-1)[0]
        if (parent) selectElement(parent)
      }
      e.preventDefault()
      return
    }
    // the keyboard route into the panels, scoped to the focused surface so the
    // keys can never fire while typing somewhere else. The panel opens with its
    // primary input focused; Escape closes it and hands focus back here.
    const panelKey = { s: 'style', d: 'data', i: 'interactions' }[e.key.toLowerCase()]
    if (panelKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (activePanelId.value === panelKey) closePanel()
      else openPanel(panelKey, { focus: true })
      e.preventDefault()
      return
    }
    if (e.key === 'Enter' && opts.canRename() && backend.value.can(current, 'ref')) {
      editingRefId.value = current.id
      e.preventDefault()
    }
  }

  return { onKeydown, visibleRows }
}
