export interface GhostRect {
  top: number
  left: number
  width: number
  height: number
}

export function reducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function rectOf(el: Element): GhostRect {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

export function styleGhostBase(
  clone: HTMLElement,
  { top, left, width, height, transform = 'translate(0px, 0px)' }: GhostRect & { transform?: string },
) {
  Object.assign(clone.style, {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    height: `${height}px`,
    margin: '0',
    pointerEvents: 'none',
    zIndex: '2147483647',
    transformOrigin: '0 0',
    transform,
    transition: 'none',
    willChange: 'transform',
  })
}

export function slideGhost(clone: HTMLElement, toTransform: string, duration = 180): () => void {
  document.body.appendChild(clone)
  void clone.offsetHeight

  let done = false
  let timer: ReturnType<typeof setTimeout>
  const remove = () => {
    if (done) return
    done = true
    clearTimeout(timer)
    clone.remove()
  }

  clone.style.transition = `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`
  clone.style.transform = toTransform
  clone.addEventListener('transitionend', remove, { once: true })
  timer = setTimeout(remove, duration + 80)
  return remove
}
