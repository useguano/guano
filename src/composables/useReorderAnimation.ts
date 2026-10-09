import { nextTick } from 'vue'
import { reducedMotion, rectOf, slideGhost, styleGhostBase } from '@/lib/flip'

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
      if (to.top === from.top && to.left === from.left) return
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
