import { nextTick } from 'vue'
import { reducedMotion, rectOf, slideGhost, styleGhostBase } from '@/lib/flip'

/**
 * Wraps a structural move so the moved canvas element visibly slides from its
 * old position to its new one — otherwise a reorder just re-renders in place
 * and, among many similar elements, it's unclear what moved.
 *
 * It takes the move as a callback rather than performing one itself: the move
 * belongs to `useStructure` (which also decides whether it lands on the page or
 * on a component master), and importing that here would be a cycle.
 */
export function useReorderAnimation() {
  const nodeEl = (id: string): HTMLElement | null =>
    document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)

  function withReorderAnimation(dragId: string, move: () => void) {
    const el = nodeEl(dragId)
    if (!el || reducedMotion()) {
      move()
      return
    }

    const from = rectOf(el)
    const clone = el.cloneNode(true) as HTMLElement
    clone.removeAttribute('id')
    clone.removeAttribute('data-node-id')
    // the canvas is zoomed; the clone renders at natural size, so scale it to
    // match the on-screen size the original had (derived from the element, no
    // camera dependency)
    const scale = el.offsetWidth ? from.width / el.offsetWidth : 1
    styleGhostBase(clone, {
      top: from.top,
      left: from.left,
      width: el.offsetWidth,
      height: el.offsetHeight,
      transform: `scale(${scale})`,
    })

    move()

    nextTick(() => {
      const now = nodeEl(dragId)
      if (!now) return
      const to = rectOf(now)
      if (to.top === from.top && to.left === from.left) return // nothing moved
      // show only the sliding ghost until it lands, then reveal the settled node
      now.style.visibility = 'hidden'
      const reveal = () => {
        now.style.visibility = ''
      }
      slideGhost(clone, `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${scale})`, 360)
      clone.addEventListener('transitionend', reveal, { once: true })
      setTimeout(reveal, 440)
    })
  }

  return { withReorderAnimation }
}
