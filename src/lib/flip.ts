// Ghost-slide helpers for reorder feedback: a detached DOM clone is placed at
// the moved element's old on-screen position and transitions to its new one, so
// the move is visible even among many identical elements. The clone is
// `position: fixed` — it lives in viewport space, immune to any ancestor
// transform (e.g. the canvas's scale/zoom), so no zoom math is needed.

export interface GhostRect {
  top: number
  left: number
  width: number
  height: number
}

/** honor the OS "reduce motion" setting — callers skip the animation when true */
export function reducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** viewport rect of an element, as a plain object */
export function rectOf(el: Element): GhostRect {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

/**
 * Pins `clone` at `top/left` with `width/height`, ready to be slid. `transform`
 * is the base transform the slide animates FROM (default none; the canvas passes
 * a `scale(z)` so the clone's natural-size content matches the zoomed original).
 */
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

/**
 * Appends `clone` to the body and transitions its transform to `toTransform`,
 * removing it when the slide ends. Returns a `cancel()` that removes it
 * immediately (used to drop a still-running ghost when a new move starts).
 */
export function slideGhost(clone: HTMLElement, toTransform: string, duration = 180): () => void {
  document.body.appendChild(clone)
  // commit the base transform before changing it, so the browser animates the
  // delta instead of jumping straight to the target
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
  timer = setTimeout(remove, duration + 80) // fallback if transitionend never fires
  return remove
}
