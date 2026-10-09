import type { CommentAnchor } from '@/types/editor'

const FRAME_SELECTOR = '[data-breakpoint-id]'

function scopeFor(anchor: CommentAnchor, root: HTMLElement): HTMLElement | null {
  if (!anchor.breakpointId) return root
  const frame = root.querySelector(
    `${FRAME_SELECTOR}[data-breakpoint-id="${CSS.escape(anchor.breakpointId)}"]`,
  ) as HTMLElement | null
  return frame ?? root
}

export function anchorFromPoint(
  clientX: number,
  clientY: number,
  root: HTMLElement,
): CommentAnchor | null {
  const hit = document.elementFromPoint(clientX, clientY) as HTMLElement | null
  const nodeEl = hit?.closest?.('[data-node-id]') as HTMLElement | null
  if (!nodeEl || !root.contains(nodeEl)) return null
  const rect = nodeEl.getBoundingClientRect()
  const frame = nodeEl.closest(FRAME_SELECTOR) as HTMLElement | null
  const breakpointId = frame?.dataset.breakpointId
  return {
    nodeId: nodeEl.dataset.nodeId!,
    rx: rect.width ? (clientX - rect.left) / rect.width : 0.5,
    ry: rect.height ? (clientY - rect.top) / rect.height : 0.5,
    ...(breakpointId ? { breakpointId } : {}),
  }
}

export function anchorScreenPos(
  anchor: CommentAnchor,
  root: HTMLElement,
): { x: number; y: number } | null {
  const scope = scopeFor(anchor, root)
  if (!scope) return null
  const nodeEl = scope.querySelector(
    `[data-node-id="${CSS.escape(anchor.nodeId)}"]`,
  ) as HTMLElement | null
  if (!nodeEl) return null
  const rect = nodeEl.getBoundingClientRect()
  return { x: rect.left + anchor.rx * rect.width, y: rect.top + anchor.ry * rect.height }
}
