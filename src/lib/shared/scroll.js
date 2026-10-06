// SPDX-License-Identifier: MIT — see LICENSE-EXCEPTIONS.md (embedded in exported sites; deliberately not AGPL)
// Inertia ("smooth") scrolling, shared by the published site runtime
// (src/motion/runtime.ts, scrolling the window) and the editor's Preview
// surface (SitePreview.vue, scrolling its own overflow container).
//
// The scroller moves the REAL scroll position rather than transforming a
// wrapper. That constraint is load-bearing on the published site: the
// interaction runtime's `scrolled` trigger reads window.pageYOffset
// (server/site-runtime.js), and a transformed wrapper would become the
// containing block for every `position: fixed` descendant. Both break silently
// under a transform-based scroller, so this one only ever calls a `set`
// callback the caller wires to a real scroll position.
//
// The DOM enters only through the caller's get/set/max callbacks and the one
// hit-test helper at the bottom; the motion itself is pure arithmetic.

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n)

/** below this, the remaining distance is a sub-pixel and the scroll has landed */
const SETTLE_PX = 0.5
/** the frame length the lerp factor is expressed in, so 120Hz feels like 60Hz */
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
    /** queue a wheel movement, in pixels. Deltas accumulate onto the target,
     * so spinning the wheel twice travels twice as far even mid-flight. */
    wheel(deltaPx) {
      target = clamp(target + deltaPx, 0, opts.max())
      settled = false
    },
    /** re-seat on the true position — after a scrollbar drag, a keyboard
     * scroll, a hash jump, or anything else that moved the page for us */
    sync() {
      target = opts.get()
      settled = true
    },
    /** advance by `dt` ms. Returns true while there is still distance to close. */
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
      // frame-rate corrected: the same visual easing at 60Hz and 144Hz
      opts.set(current + remaining * (1 - Math.pow(1 - lerp, dt / BASE_FRAME_MS)))
      return true
    },
    get settled() {
      return settled
    },
  }
}

/** a wheel event's vertical movement in pixels, whatever unit it reports in */
export function wheelDeltaPx(deltaY, deltaMode, viewportHeight) {
  if (deltaMode === 1) return deltaY * 16 // lines
  if (deltaMode === 2) return deltaY * viewportHeight // pages
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
