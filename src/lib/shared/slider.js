// SPDX-License-Identifier: MIT — see LICENSE-EXCEPTIONS.md (embedded in exported sites; deliberately not AGPL)
// The :slider (carousel) engine, shared VERBATIM by every surface: the Build
// canvas and Preview renderers, the static exporter (server/export.mjs), the
// published runtime (src/slider/runtime.ts) and the MCP validators. Plain-JS
// ESM so the Node exporter can import it directly.
//
// Two halves:
//   - pure: config defaults/validation/resolution + the class strings that make
//     up the DOM shape. No DOM access, safe in Node.
//   - behavior: initSlider(), which needs a browser. Preview and the published
//     site call the SAME function, so a carousel cannot drift between them.
//
// The track is a real overflow-x scroller with CSS scroll snapping. That is
// load-bearing: it gives native touch swipe for free, it keeps the canvas track
// usable with no JS at all, and — crucially — the slider never writes
// `transform`. Animations write inline styles (see shared/motion.js) and a
// transformed ancestor becomes the containing block for `position: fixed`
// descendants; a transform-based track would collide with both.

/** slides visible at once is capped so a typo can't emit a 10000-column track */
const PER_VIEW_MIN = 1
const PER_VIEW_MAX = 8
const GAP_MAX = 500
const DELAY_MIN = 500
const DELAY_MAX = 60000

export const SLIDER_DEFAULTS = {
  arrows: true,
  dots: true,
  gap: 0,
  autoplay: false,
  delay: 4000,
  loop: false,
  drag: true,
}

/** the perView key for the widest breakpoint — the value that applies everywhere
 * until a narrower breakpoint overrides it (desktop-first, like the class cascade) */
export const PER_VIEW_BASE = 'base'

const SLIDER_KEYS = ['arrows', 'dots', 'perView', 'gap', 'autoplay', 'delay', 'loop', 'drag']

// ---------- validation (shared by the editor and the MCP) ----------

const fail = (error) => ({ ok: false, error })

const isBool = (v) => typeof v === 'boolean'
const isNum = (v) => typeof v === 'number' && isFinite(v)

/**
 * @param {any} config
 * @param {{breakpointIds?: string[]}} [ctx] when given, perView keys are checked
 *   against the project's real breakpoints (the MCP path — the editor only ever
 *   writes keys it just read off the project)
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateSliderConfig(config, ctx = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return fail('slider must be an object')
  }
  for (const key of Object.keys(config)) {
    if (!SLIDER_KEYS.includes(key)) {
      return fail(`unknown slider option '${key}' — use one of: ${SLIDER_KEYS.join(', ')}`)
    }
  }
  for (const key of ['arrows', 'dots', 'autoplay', 'loop', 'drag']) {
    if (config[key] !== undefined && !isBool(config[key])) {
      return fail(`slider ${key} must be true or false`)
    }
  }
  if (config.gap !== undefined && (!isNum(config.gap) || config.gap < 0 || config.gap > GAP_MAX)) {
    return fail(`slider gap must be a number of pixels between 0 and ${GAP_MAX}`)
  }
  if (
    config.delay !== undefined &&
    (!isNum(config.delay) || config.delay < DELAY_MIN || config.delay > DELAY_MAX)
  ) {
    return fail(`slider delay must be a number of milliseconds between ${DELAY_MIN} and ${DELAY_MAX}`)
  }
  if (config.perView !== undefined) {
    const pv = config.perView
    if (!pv || typeof pv !== 'object' || Array.isArray(pv)) {
      return fail(`slider perView must be an object keyed by '${PER_VIEW_BASE}' and breakpoint ids`)
    }
    for (const [key, value] of Object.entries(pv)) {
      if (key !== PER_VIEW_BASE && ctx.breakpointIds && !ctx.breakpointIds.includes(key)) {
        return fail(
          `slider perView key '${key}' is not a breakpoint — use '${PER_VIEW_BASE}'` +
            (ctx.breakpointIds.length ? ` or one of: ${ctx.breakpointIds.join(', ')}` : ''),
        )
      }
      if (!isNum(value) || !Number.isInteger(value) || value < PER_VIEW_MIN || value > PER_VIEW_MAX) {
        return fail(
          `slider perView '${key}' must be a whole number of slides between ${PER_VIEW_MIN} and ${PER_VIEW_MAX}`,
        )
      }
    }
  }
  return { ok: true }
}

// ---------- resolution ----------

/**
 * A fully-defaulted config. Deliberately TOLERANT where the validator is
 * strict: a perView key for a breakpoint the user has since deleted is dropped
 * rather than failing, so a stale config never breaks a render.
 *
 * @param {any} config node.slider, possibly undefined
 * @param {{id: string, width: number}[]} [breakpoints] project.breakpoints
 */
export function resolveSliderConfig(config, breakpoints = []) {
  const c = config && typeof config === 'object' ? config : {}
  const known = new Set(breakpoints.map((b) => b.id))
  const perView = {}
  for (const [key, value] of Object.entries(c.perView ?? {})) {
    if (key !== PER_VIEW_BASE && !known.has(key)) continue
    if (!isNum(value)) continue
    perView[key] = Math.min(PER_VIEW_MAX, Math.max(PER_VIEW_MIN, Math.round(value)))
  }
  return {
    arrows: isBool(c.arrows) ? c.arrows : SLIDER_DEFAULTS.arrows,
    dots: isBool(c.dots) ? c.dots : SLIDER_DEFAULTS.dots,
    gap: isNum(c.gap) ? Math.max(0, Math.min(GAP_MAX, c.gap)) : SLIDER_DEFAULTS.gap,
    autoplay: isBool(c.autoplay) ? c.autoplay : SLIDER_DEFAULTS.autoplay,
    delay: isNum(c.delay)
      ? Math.max(DELAY_MIN, Math.min(DELAY_MAX, c.delay))
      : SLIDER_DEFAULTS.delay,
    loop: isBool(c.loop) ? c.loop : SLIDER_DEFAULTS.loop,
    drag: isBool(c.drag) ? c.drag : SLIDER_DEFAULTS.drag,
    perView,
  }
}

/** breakpoints widest → narrowest, the order the desktop-first cascade reads in */
function descending(breakpoints) {
  return [...(breakpoints ?? [])].sort((a, b) => b.width - a.width)
}

/** the widest breakpoint IS the base — a `max-[width]:` variant for it would
 * stop applying above its own width, so a value keyed by its id has to fold
 * into the base instead (the panel only ever writes 'base', but an agent can
 * name the id, and the canvas and the site must not disagree about it) */
function overridesOf(resolved, breakpoints) {
  const list = descending(breakpoints)
  const widest = list[0]
  const base =
    (widest && resolved.perView[widest.id] !== undefined
      ? resolved.perView[widest.id]
      : resolved.perView[PER_VIEW_BASE]) ?? PER_VIEW_MIN
  const narrower = list
    .slice(1)
    .map((bp) => ({ bp, n: resolved.perView[bp.id] }))
    .filter((o) => o.n !== undefined)
  return { base, narrower }
}

/** slides-per-view at the widest breakpoint — the value with no media query */
export function basePerView(resolved, breakpoints = []) {
  return overridesOf(resolved, breakpoints).base
}

/**
 * The slides-per-view that applies at a concrete viewport width, walking the
 * desktop-first cascade: the base, overridden by every breakpoint whose width
 * still covers this viewport, narrowest winning.
 *
 * The canvas needs this because its frames are fixed-width elements — real
 * `max-[…]:` media queries key off the window and can't fire there.
 */
export function perViewForWidth(config, breakpoints, width) {
  const resolved = resolveSliderConfig(config, breakpoints)
  const { base, narrower } = overridesOf(resolved, breakpoints)
  let value = base
  for (const { bp, n } of narrower) if (width <= bp.width) value = n
  return value
}

// ---------- the DOM shape (class strings shared by all three renderers) ----------

/**
 * The track's classes. Slides-per-view and gap ride CSS custom properties so
 * one `basis:calc(…)` on every slide covers every breakpoint — the per-view
 * overrides are `max-[Npx]:` variants setting just the variable.
 *
 * Every string produced here must also be registered in the exporter's
 * collectCandidates, or Tailwind won't compile it into the published stylesheet.
 *
 * @param {{width?: number}} [opts] when given, emit the flat value for that
 *   frame width instead of media-query variants (the fixed-width canvas frames)
 */
export function sliderTrackClasses(config, breakpoints = [], opts = {}) {
  const resolved = resolveSliderConfig(config, breakpoints)
  const out = [
    'flex',
    'overflow-x-auto',
    'snap-x',
    'snap-mandatory',
    // deliberately NO scroll-smooth: ScrollToOptions' 'auto' defers to the CSS
    // scroll-behavior, so a smooth track would animate the jumps we ask to be
    // instant for a reduced-motion visitor. initSlider passes it explicitly.
    '[scrollbar-width:none]',
    '[&::-webkit-scrollbar]:hidden',
    'gap-[var(--sl-gap)]',
    `[--sl-gap:${resolved.gap}px]`,
  ]
  if (typeof opts.width === 'number') {
    out.push(`[--sl-pv:${perViewForWidth(config, breakpoints, opts.width)}]`)
    return out.join(' ')
  }
  const { base, narrower } = overridesOf(resolved, breakpoints)
  out.push(`[--sl-pv:${base}]`)
  // INCLUSIVE at the breakpoint's own width, like every other breakpoint
  // comparison in the project (perViewForWidth below, site-runtime's computeBp,
  // breakpointIdForWidth). Tailwind compiles `max-[768px]` to
  // `not all and (min-width: 768px)`, i.e. width < 768 — so a viewport at
  // exactly 768 kept the base value while the canvas frame of that breakpoint,
  // which resolves the number in JS, showed the override. The sub-pixel margin
  // makes the media query cover its own width without reaching the next one.
  for (const { bp, n } of narrower)
    out.push(`max-[${bp.width + 0.02}px]:[--sl-pv:${n}]`)
  return out.join(' ')
}

/** one slide: never shrink, snap to the start, and divide the track by --sl-pv
 * accounting for the gaps between the visible slides */
export const SLIDER_SLIDE_CLASSES =
  'min-w-0 shrink-0 grow-0 snap-start basis-[calc((100%-(var(--sl-pv)-1)*var(--sl-gap))/var(--sl-pv))]'

export const SLIDER_ARROW_CLASSES =
  'absolute top-1/2 z-10 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white transition-opacity hover:bg-black/60 aria-disabled:pointer-events-none aria-disabled:opacity-30'
export const SLIDER_PREV_CLASS = 'left-3'
export const SLIDER_NEXT_CLASS = 'right-3'
// Dots sit BELOW the track, in flow. Absolutely positioned over it they
// covered the last rows of every slide, and the host had to be padded by hand
// to get out from under them.
export const SLIDER_DOTS_CLASSES = 'mt-3 flex justify-center gap-1.5'
// The dots take the HOST's text colour (`bg-current`), so `text-primary` on the
// :slider styles them. They were `bg-white`, which is invisible on any light UI
// and assumed a dark image underneath — nothing in the editor said so, and a
// project's own palette could not reach them.
//
// The two states REPLACE each other's opacity rather than stacking: they are the
// same property at the same specificity, so which one won would come down to
// their order in the compiled stylesheet, not the order in the attribute.
const SLIDER_DOT_BASE = 'size-2 rounded-full bg-current transition-opacity'
export const SLIDER_DOT_CLASSES = `${SLIDER_DOT_BASE} opacity-30`
export const SLIDER_DOT_ACTIVE_CLASSES = `${SLIDER_DOT_BASE} opacity-100`

/**
 * The chrome's own WORDS. Renderer-invented, like its Tailwind classes — which
 * means they live in no tree, nothing ever translated them, and a French route
 * shipped "Previous slide" on every carousel while the worklist reported
 * `missingTranslatable: 0`. They were also invisible to the
 * `untranslated-attributes` publish warning for the same reason.
 *
 * Overridden per slider AND per locale through the node's ordinary localizable
 * attributes (SLIDER_LABEL_ATTRS below), which is the mechanism
 * `node.locales[code].attributes` already provides for placeholder/alt/title —
 * resolved in all three renderers, enumerated by the worklist, written by
 * set_translations. No second translation mechanism, and no schema change.
 */
export const SLIDER_LABELS = {
  prev: 'Previous slide',
  next: 'Next slide',
  dots: 'Slides',
  /** `{n}` is the 1-based slide number */
  dot: 'Go to slide {n}',
}

/**
 * Which attribute sets which label. Plain `data-*` names, so they are ordinary
 * authored attributes an agent and the Data panel can already write — NOT under
 * the reserved `data-sl-` prefix, which exists to stop an authored name
 * shadowing a value the renderer owns. Here the renderer WANTS the authored
 * value, so the opposite rule applies. They are consumed, never emitted.
 */
export const SLIDER_LABEL_ATTRS = {
  'data-prev-label': 'prev',
  'data-next-label': 'next',
  'data-dots-label': 'dots',
  'data-dot-label': 'dot',
}

/**
 * The chrome's words for this slider: authored attributes over the defaults.
 * @param {Record<string,string>} [attributes] the node's RESOLVED attributes
 *   (layered master → placement → locale), i.e. what the renderer would emit
 * @returns {{prev: string, next: string, dots: string, dot: string}}
 */
export function resolveSliderLabels(attributes) {
  const out = { ...SLIDER_LABELS }
  for (const name of Object.keys(SLIDER_LABEL_ATTRS)) {
    const value = attributes ? attributes[name] : undefined
    if (typeof value === 'string' && value.trim()) out[SLIDER_LABEL_ATTRS[name]] = value
  }
  return out
}

/**
 * The resolved labels back as attribute names — what the translation worklist
 * lists, so an unauthored slider still offers its four English defaults to
 * translate instead of being silently absent.
 * @param {Record<string,string>} [attributes]
 * @param {{arrows?: boolean, dots?: boolean}} [config] only the chrome that renders
 */
export function sliderLabelAttributes(attributes, config) {
  const labels = resolveSliderLabels(attributes)
  const out = {}
  for (const name of Object.keys(SLIDER_LABEL_ATTRS)) {
    const key = SLIDER_LABEL_ATTRS[name]
    if (config) {
      if ((key === 'prev' || key === 'next') && !config.arrows) continue
      if ((key === 'dots' || key === 'dot') && !config.dots) continue
    }
    out[name] = labels[key]
  }
  return out
}

/** one dot's label: the pattern with `{n}` filled in (i is 0-based) */
export function sliderDotLabel(pattern, i) {
  return String(pattern || SLIDER_LABELS.dot).replace('{n}', String(i + 1))
}

export const SLIDER_PREV_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>'
export const SLIDER_NEXT_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'

const POSITIONED = /(?:^|\s)(?:static|relative|absolute|fixed|sticky)(?:$|\s)/

/** the arrows and dots are absolutely positioned, so the host needs a
 * positioning context — unless the author already gave it one */
export function sliderHostExtraClass(nodeClasses) {
  return POSITIONED.test(nodeClasses ?? '') ? '' : 'relative'
}

/** every class string a slider can emit, for the exporter's Tailwind scan */
export function sliderCandidateClasses(config, breakpoints = []) {
  return [
    sliderTrackClasses(config, breakpoints),
    SLIDER_SLIDE_CLASSES,
    SLIDER_ARROW_CLASSES,
    SLIDER_PREV_CLASS,
    SLIDER_NEXT_CLASS,
    SLIDER_DOTS_CLASSES,
    SLIDER_DOT_CLASSES,
    SLIDER_DOT_ACTIVE_CLASSES,
    'relative',
  ].join(' ')
}

// ---------- the wire format ----------

/**
 * What the published runtime needs, as compactly as possible. perView is
 * deliberately NOT on the wire: the runtime measures a slide's real width from
 * the DOM, so it tracks the CSS cascade for free and never needs the breakpoint
 * table shipped (nor invalidating when a breakpoint is renamed or resized).
 */
export function sliderWireData(config, labels) {
  const r = resolveSliderConfig(config, [])
  const data = {}
  if (r.autoplay) data.au = 1
  if (r.autoplay && r.delay !== SLIDER_DEFAULTS.delay) data.de = r.delay
  if (r.loop) data.lp = 1
  if (!r.drag) data.dr = 0
  if (!r.arrows) data.ar = 0
  if (!r.dots) data.dt = 0
  // the DOT labels are built in the browser (only the runtime knows the
  // reachable count), so the pattern has to travel — otherwise every locale's
  // dots said "Go to slide 3" however the arrows were translated. Omitted when
  // it is the default, so an untranslated slider's wire is byte-identical.
  if (labels && labels.dot && labels.dot !== SLIDER_LABELS.dot) data.dl = labels.dot
  return data
}

// ---------- behavior (browser only; Preview and the published site share it) ----------

const rafThrottle = (fn) => {
  let queued = false
  return () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      fn()
    })
  }
}

/**
 * Wire up a rendered slider. The DOM is already in place (every renderer emits
 * the same shape) — this only adds behavior.
 *
 * @param {HTMLElement} host the element carrying data-slider
 * @param {{au?: number, de?: number, lp?: number, dr?: number, ar?: number, dt?: number}} data
 * @param {{still?: boolean}} [opts] `still` = prefers-reduced-motion or ?noanim:
 *   no smooth scrolling, and autoplay never starts (WCAG 2.2.2)
 * @returns {() => void} teardown
 */
export function initSlider(host, data, opts = {}) {
  const track = host.querySelector('[data-sl-track]')
  if (!track) return () => {}

  const still = !!opts.still
  const loop = !!data.lp
  const autoplay = !!data.au && !still
  const delay = data.de ?? SLIDER_DEFAULTS.delay
  const drag = data.dr !== 0
  const prev = host.querySelector('[data-sl-prev]')
  const next = host.querySelector('[data-sl-next]')
  const dotsHost = host.querySelector('[data-sl-dots]')
  // 'instant', not 'auto': 'auto' means "whatever CSS scroll-behavior says",
  // which is exactly the wrong answer for a reduced-motion visitor
  const behavior = still ? 'instant' : 'smooth'

  const cleanups = []
  const on = (el, type, fn, options) => {
    if (!el) return
    el.addEventListener(type, fn, options)
    cleanups.push(() => el.removeEventListener(type, fn, options))
  }

  const slides = () => Array.from(track.querySelectorAll('[data-sl-slide]'))

  /** one slide plus the gap after it — how far a single advance travels */
  function step() {
    const first = slides()[0]
    if (!first) return track.clientWidth || 1
    const gap = parseFloat(getComputedStyle(track).columnGap || '0') || 0
    return (first.getBoundingClientRect().width || 1) + gap
  }

  const maxScroll = () => Math.max(0, track.scrollWidth - track.clientWidth)
  const indexAt = () => Math.round(track.scrollLeft / step())
  /** the last index that can sit at the start of the track — with N per view,
   * the final page shows the last N slides, so scrolling stops short of the end */
  const lastIndex = () => Math.max(0, Math.round(maxScroll() / step()))

  function goTo(index, how = behavior) {
    track.scrollTo({ left: index * step(), behavior: how })
  }

  function advance(direction) {
    const at = indexAt()
    const last = lastIndex()
    let target = at + direction
    if (target > last) target = loop ? 0 : last
    else if (target < 0) target = loop ? last : 0
    goTo(target)
  }

  // ---- dots: one per reachable position, not one per slide ----
  let dotButtons = []
  function buildDots() {
    if (!dotsHost) return
    const count = lastIndex() + 1
    if (dotButtons.length === count) return
    dotsHost.textContent = ''
    dotButtons = []
    if (count <= 1) return
    for (let i = 0; i < count; i++) {
      const dot = document.createElement('button')
      dot.type = 'button'
      dot.className = SLIDER_DOT_CLASSES
      dot.setAttribute('role', 'tab')
      dot.setAttribute('aria-label', sliderDotLabel(data.dl, i))
      dot.addEventListener('click', (e) => {
        // the whole slider may sit inside a link — paging it must never
        // navigate away (the editor hides the Link field for a slider, but
        // the code's '@target' suffix and the MCP still reach it)
        e.preventDefault()
        e.stopPropagation()
        pauseAutoplay()
        goTo(i)
      })
      dotsHost.appendChild(dot)
      dotButtons.push(dot)
    }
  }

  function syncChrome() {
    const at = indexAt()
    const last = lastIndex()
    dotButtons.forEach((dot, i) => {
      const active = i === at
      dot.className = active ? SLIDER_DOT_ACTIVE_CLASSES : SLIDER_DOT_CLASSES
      dot.setAttribute('aria-selected', active ? 'true' : 'false')
    })
    if (!loop) {
      if (prev) prev.setAttribute('aria-disabled', at <= 0 ? 'true' : 'false')
      if (next) next.setAttribute('aria-disabled', at >= last ? 'true' : 'false')
    }
  }

  const onScroll = rafThrottle(syncChrome)
  on(track, 'scroll', onScroll, { passive: true })

  // preventDefault/stopPropagation for the same reason as the dots: an arrow
  // inside a linked slider must page it, not follow the link
  const arrowClick = (direction) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    pauseAutoplay()
    advance(direction)
  }
  on(prev, 'click', arrowClick(-1))
  on(next, 'click', arrowClick(1))

  // ---- autoplay ----
  let timer = null
  function startAutoplay() {
    if (!autoplay || timer !== null) return
    timer = setInterval(() => {
      if (document.hidden) return
      advance(1)
    }, delay)
  }
  function pauseAutoplay() {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }
  if (autoplay) {
    on(host, 'pointerenter', pauseAutoplay)
    on(host, 'pointerleave', startAutoplay)
    on(host, 'focusin', pauseAutoplay)
    on(host, 'focusout', startAutoplay)
    startAutoplay()
  }

  // ---- mouse drag (touch already scrolls the track natively) ----
  if (drag) {
    let dragging = false
    let startX = 0
    let startLeft = 0
    let moved = 0
    let captured = null
    let suppressClick = false

    on(track, 'pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      dragging = true
      moved = 0
      startX = e.clientX
      startLeft = track.scrollLeft
      pauseAutoplay()
      // keep receiving moves once the pointer leaves the track, so a drag that
      // wanders off the edge keeps working instead of stopping dead
      if (track.setPointerCapture) {
        try {
          track.setPointerCapture(e.pointerId)
          captured = e.pointerId
        } catch {
          captured = null
        }
      }
      // snapping fights a free drag — restored on release
      track.style.scrollSnapType = 'none'
      track.style.cursor = 'grabbing'
    })
    on(track, 'pointermove', (e) => {
      if (!dragging) return
      const dx = e.clientX - startX
      moved = Math.max(moved, Math.abs(dx))
      track.scrollLeft = startLeft - dx
      if (moved > 3) e.preventDefault()
    })
    const endDrag = () => {
      if (!dragging) return
      dragging = false
      if (captured !== null && track.releasePointerCapture) {
        try {
          track.releasePointerCapture(captured)
        } catch {
          // the pointer is already gone; nothing to release
        }
        captured = null
      }
      // the click that completes a real drag must not also navigate. It fires
      // right after this pointerup, so the flag is cleared on the next tick —
      // leaving it set would swallow an unrelated later activation (a keyboard
      // Enter on a link, which has no pointerdown to reset it).
      suppressClick = moved > 3
      moved = 0
      setTimeout(() => {
        suppressClick = false
      }, 0)
      // read where the drag landed BEFORE restoring snapping: putting
      // scroll-snap back re-snaps the track immediately, so measuring after it
      // reads the browser's guess instead of the user's
      const target = indexAt()
      track.style.scrollSnapType = ''
      track.style.cursor = ''
      goTo(target)
      startAutoplay()
    }
    on(track, 'pointerup', endDrag)
    on(track, 'pointercancel', endDrag)
    on(
      track,
      'click',
      (e) => {
        if (!suppressClick) return
        e.preventDefault()
        e.stopPropagation()
      },
      true,
    )
  }

  // ---- keep the chrome honest as the track resizes ----
  let observer = null
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(
      rafThrottle(() => {
        buildDots()
        syncChrome()
      }),
    )
    observer.observe(track)
  }

  buildDots()
  syncChrome()

  return function destroy() {
    pauseAutoplay()
    if (observer) observer.disconnect()
    cleanups.forEach((fn) => fn())
    cleanups.length = 0
    if (dotsHost) dotsHost.textContent = ''
  }
}
