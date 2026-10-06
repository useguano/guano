import { ref } from 'vue'
import type { Component } from 'vue'
import { useElement, type DropPosition } from './useElement'
import { useComponents } from './useComponents'
import { useStructure } from './useStructure'
import type { ElementNode } from '@/types/editor'

/** what a palette card puts on the drag: a built-in type or a component */
export type InsertPayload =
  | { kind: 'element'; type: string; label: string; icon: Component }
  | { kind: 'component'; name: string }
  /** a library entry the project hasn't added yet — using it adds it */

/** the floating chip's content; null = no drag in flight */
const payload = ref<InsertPayload | null>(null)
const pointer = ref({ x: 0, y: 0 })
/** set for one tick after a drop so open popovers ignore the release click */
const suppressNextClick = ref(false)

/** a surface with its own geometry (the Layers tree's rows) resolves its own
 *  drop target from the pointer's Y */
type DropResolver = (clientY: number) => { id: string; position: DropPosition } | null
let surfaceResolver: DropResolver | null = null

// a drag begins on pointerdown but only activates after a small move,
// so plain clicks on palette cards stay inert
const DRAG_THRESHOLD = 4

export function useInsertDrag() {
  const { dropTarget, getElement, bodyElement } = useElement()
  const { masterFor } = useComponents()
  const { backend } = useStructure()

  function canvasTarget(
    node: ElementNode,
    hit: HTMLElement,
    y: number,
  ): { id: string; position: DropPosition } | null {
    if (node.type === 'body') return { id: node.id, position: 'inside' }

    // component instances never accept interior drops — reshaping the
    // master from a palette drag would mutate every instance. Retarget
    // to the instance root, before/after only.
    const mapping = masterFor(node.id)
    if (mapping) {
      const root = getElement(mapping.instanceId)
      if (!root) return null
      const rootEl = hit.closest(`[data-node-id="${CSS.escape(mapping.instanceId)}"]`) ?? hit
      const rect = rootEl.getBoundingClientRect()
      return { id: root.id, position: y <= rect.top + rect.height / 2 ? 'before' : 'after' }
    }

    const rect = hit.getBoundingClientRect()
    // screen-space edge zone: ratio keeps it zoom-stable, px clamps keep
    // before/after reachable on tiny frames and sane on huge ones
    const edge = Math.min(Math.max(rect.height * 0.25, 3), 24)
    if (y < rect.top + edge) return { id: node.id, position: 'before' }
    if (y > rect.bottom - edge) return { id: node.id, position: 'after' }
    // a container takes children through its middle (registry-driven: a
    // childless :div is still one)
    const container = backend.value.isContainer(node)
    if (container && rect.height >= edge * 3) return { id: node.id, position: 'inside' }
    return { id: node.id, position: y <= rect.top + rect.height / 2 ? 'before' : 'after' }
  }

  function resolveAt(x: number, y: number): { id: string; position: DropPosition } | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    if (!el) return null
    if (el.closest('[data-insert-surface]')) return surfaceResolver?.(y) ?? null
    // collection-item interiors render template-page nodes whose ids
    // aren't in this page — climb until an id resolves
    let marker = el.closest<HTMLElement>('[data-node-id]')
    while (marker) {
      const node = getElement(marker.dataset.nodeId!)
      if (node) return canvasTarget(node, marker, y)
      marker = marker.parentElement?.closest<HTMLElement>('[data-node-id]') ?? null
    }
    if (el.closest('[data-frame-drop]')) {
      const body = bodyElement.value
      return body ? { id: body.id, position: 'inside' } : null
    }
    if (el.closest('[data-board-card-surface]')) {
      const root = backend.value.roots.value[0]
      return root ? { id: root.id, position: 'inside' } : null
    }
    return null
  }

  function insert(p: InsertPayload, target: { id: string; position: DropPosition }) {
    const payload =
      p.kind === 'element'
        ? ({ kind: 'element', type: p.type } as const)
        : ({ kind: 'component', name: p.name } as const)
    backend.value.insert(payload, target.id, target.position)
  }

  /** swallow the click the browser fires after the drag's pointerup, so
   * the popover stays open and canvas click handlers don't run */
  function suppressReleaseClick() {
    suppressNextClick.value = true
    const swallow = (e: MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
    }
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => {
      window.removeEventListener('click', swallow, { capture: true })
      suppressNextClick.value = false
    }, 0)
  }

  function startInsertDrag(p: InsertPayload, e: PointerEvent) {
    if (e.button !== 0) return
    const source = e.currentTarget as HTMLElement
    const startX = e.clientX
    const startY = e.clientY
    let active = false

    source.setPointerCapture(e.pointerId)

    const cleanup = () => {
      payload.value = null
      dropTarget.value = null
      if (source.hasPointerCapture(e.pointerId)) source.releasePointerCapture(e.pointerId)
      source.removeEventListener('pointermove', onMove)
      source.removeEventListener('pointerup', onUp)
      source.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKeydown, { capture: true })
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    const onMove = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= DRAG_THRESHOLD) return
        active = true
        payload.value = p
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
      }
      pointer.value = { x: ev.clientX, y: ev.clientY }
      dropTarget.value = resolveAt(ev.clientX, ev.clientY)
    }

    const onUp = () => {
      const target = dropTarget.value
      const dropped = active
      cleanup()
      if (!dropped) return
      suppressReleaseClick()
      if (target) insert(p, target)
    }

    const onCancel = () => cleanup()

    const onKeydown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      cleanup()
    }

    source.addEventListener('pointermove', onMove)
    source.addEventListener('pointerup', onUp)
    source.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKeydown, { capture: true })
  }

  /** a surface claims the drop resolution for its own region. One slot: only
   *  one such surface is ever mounted at a time. */
  function registerDropResolver(fn: DropResolver | null) {
    surfaceResolver = fn
  }

  return { payload, pointer, suppressNextClick, startInsertDrag, registerDropResolver }
}
