import type { CommentAnchor } from '@/types/editor'

/**
 * Element-anchored comment positioning. A comment stores the node it was
 * dropped on plus a fractional offset within that node's box, so the pin
 * reflows/scales and resolves in any view that renders the node (the editor
 * canvas and the content preview both tag elements with data-node-id).
 *
 * It also stores which breakpoint FRAME it was dropped in, because the canvas
 * renders every frame from the same tree: one node id appears once per frame,
 * and a bare `querySelector` answered with whichever came first in the DOM. So
 * a comment left on the tablet layout was drawn on the desktop one, at the
 * same fractional offset — which read both as "comments are per page, not per
 * breakpoint" and as "the pin is not where I clicked". A frame is found by
 * `data-breakpoint-id` (set by CanvasEditor); the Play surface has no frames,
 * so an anchor there carries no breakpoint and resolves document-wide.
 */

const FRAME_SELECTOR = '[data-breakpoint-id]'

/** the element to search a node inside: the anchor's own frame, else `root` */
function scopeFor(anchor: CommentAnchor, root: HTMLElement): HTMLElement | null {
  if (!anchor.breakpointId) return root
  const frame = root.querySelector(
    `${FRAME_SELECTOR}[data-breakpoint-id="${CSS.escape(anchor.breakpointId)}"]`,
  ) as HTMLElement | null
  // the frame may be gone (the breakpoint was deleted) — fall back to any
  // render of the node rather than dropping the comment off the canvas
  return frame ?? root
}

/** the node + fractional offset under a screen point, within `root` */
export function anchorFromPoint(
  clientX: number,
  clientY: number,
  root: HTMLElement,
): CommentAnchor | null {
  const hit = document.elementFromPoint(clientX, clientY) as HTMLElement | null
  // `closest` from the hit gives the DEEPEST element carrying a node id, so a
  // click on a heading pins to the heading, not to the section around it
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

/** current screen position of an anchored pin, or null if the node isn't shown */
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
