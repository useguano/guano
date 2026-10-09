const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n)

const SETTLE_PX = 0.5
const BASE_FRAME_MS = 1000 / 60

/**
 * A lerped scroller over a surface the caller owns.
 *
 * @param {{
 *   get: () => number,      // current scroll position
 *   set: (n: number) => void,
 *   max: () => number,      // furthest scrollable position
 *   lerp: number,           // fraction of the remaining distance per 60fps frame
 * }} opts
 */
export function createLerpScroller(opts) {
  const lerp = clamp(typeof opts.lerp === 'number' ? opts.lerp : 0.1, 0.01, 1)
  let target = opts.get()
  let settled = true

  return {
    wheel(deltaPx) {
      target = clamp(target + deltaPx, 0, opts.max())
      settled = false
    },

    sync() {
      target = opts.get()
      settled = true
    },
    step(dt) {
      if (settled) return false
      target = clamp(target, 0, opts.max())
      const current = opts.get()
      const remaining = target - current
      if (Math.abs(remaining) < SETTLE_PX) {
        settled = true
        opts.set(target)
        return false
      }
      opts.set(current + remaining * (1 - Math.pow(1 - lerp, dt / BASE_FRAME_MS)))
      return true
    },
    get settled() {
      return settled
    },
  }
}

export function wheelDeltaPx(deltaY, deltaMode, viewportHeight) {
  if (deltaMode === 1) return deltaY * 16
  if (deltaMode === 2) return deltaY * viewportHeight
  return deltaY
}

/**
 * True when the wheel landed inside a scrollable region of its own that can
 * still move in this direction — a code block, a modal body, a map. Hijacking
 * those would trap the visitor, so the caller leaves the event alone.
 *
 * @param {Element|null} target — event.target
 * @param {Element|null} root — stop climbing here (the scroller's own surface)
 * @param {number} deltaY
 */
export function insideNestedScroller(target, root, deltaY) {
  let el = target
  while (el && el !== root && el.nodeType === 1) {
    const style = getComputedStyle(el)
    const overflow = `${style.overflowY} ${style.overflow}`
    if (/(auto|scroll|overlay)/.test(overflow) && el.scrollHeight > el.clientHeight + 1) {
      const atTop = el.scrollTop <= 0
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
      if (!(deltaY < 0 ? atTop : atBottom)) return true
    }
    el = el.parentElement
  }
  return false
}
