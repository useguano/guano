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

export const PER_VIEW_BASE = 'base'

const SLIDER_KEYS = ['arrows', 'dots', 'perView', 'gap', 'autoplay', 'delay', 'loop', 'drag']

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

function descending(breakpoints) {
  return [...(breakpoints ?? [])].sort((a, b) => b.width - a.width)
}

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

export function basePerView(resolved, breakpoints = []) {
  return overridesOf(resolved, breakpoints).base
}

export function perViewForWidth(config, breakpoints, width) {
  const resolved = resolveSliderConfig(config, breakpoints)
  const { base, narrower } = overridesOf(resolved, breakpoints)
  let value = base
  for (const { bp, n } of narrower) if (width <= bp.width) value = n
  return value
}

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
  for (const { bp, n } of narrower)
    out.push(`max-[${bp.width + 0.02}px]:[--sl-pv:${n}]`)
  return out.join(' ')
}

export const SLIDER_SLIDE_CLASSES =
  'min-w-0 shrink-0 grow-0 snap-start basis-[calc((100%-(var(--sl-pv)-1)*var(--sl-gap))/var(--sl-pv))]'

export const SLIDER_ARROW_CLASSES =
  'absolute top-1/2 z-10 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white transition-opacity hover:bg-black/60 aria-disabled:pointer-events-none aria-disabled:opacity-30'
export const SLIDER_PREV_CLASS = 'left-3'
export const SLIDER_NEXT_CLASS = 'right-3'
export const SLIDER_DOTS_CLASSES = 'mt-3 flex justify-center gap-1.5'
const SLIDER_DOT_BASE = 'size-2 rounded-full bg-current transition-opacity'
export const SLIDER_DOT_CLASSES = `${SLIDER_DOT_BASE} opacity-30`
export const SLIDER_DOT_ACTIVE_CLASSES = `${SLIDER_DOT_BASE} opacity-100`

export const SLIDER_LABELS = {
  prev: 'Previous slide',
  next: 'Next slide',
  dots: 'Slides',
  dot: 'Go to slide {n}',
}

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

export function sliderDotLabel(pattern, i) {
  return String(pattern || SLIDER_LABELS.dot).replace('{n}', String(i + 1))
}

export const SLIDER_PREV_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>'
export const SLIDER_NEXT_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'

const POSITIONED = /(?:^|\s)(?:static|relative|absolute|fixed|sticky)(?:$|\s)/

export function sliderHostExtraClass(nodeClasses) {
  return POSITIONED.test(nodeClasses ?? '') ? '' : 'relative'
}

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

export function sliderWireData(config, labels) {
  const r = resolveSliderConfig(config, [])
  const data = {}
  if (r.autoplay) data.au = 1
  if (r.autoplay && r.delay !== SLIDER_DEFAULTS.delay) data.de = r.delay
  if (r.loop) data.lp = 1
  if (!r.drag) data.dr = 0
  if (!r.arrows) data.ar = 0
  if (!r.dots) data.dt = 0
  if (labels && labels.dot && labels.dot !== SLIDER_LABELS.dot) data.dl = labels.dot
  return data
}

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
  const behavior = still ? 'instant' : 'smooth'

  const cleanups = []
  const on = (el, type, fn, options) => {
    if (!el) return
    el.addEventListener(type, fn, options)
    cleanups.push(() => el.removeEventListener(type, fn, options))
  }

  const slides = () => Array.from(track.querySelectorAll('[data-sl-slide]'))

  function step() {
    const first = slides()[0]
    if (!first) return track.clientWidth || 1
    const gap = parseFloat(getComputedStyle(track).columnGap || '0') || 0
    return (first.getBoundingClientRect().width || 1) + gap
  }

  const maxScroll = () => Math.max(0, track.scrollWidth - track.clientWidth)
  const indexAt = () => Math.round(track.scrollLeft / step())

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

  const arrowClick = (direction) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    pauseAutoplay()
    advance(direction)
  }
  on(prev, 'click', arrowClick(-1))
  on(next, 'click', arrowClick(1))

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
      if (track.setPointerCapture) {
        try {
          track.setPointerCapture(e.pointerId)
          captured = e.pointerId
        } catch {
          captured = null
        }
      }
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
        }
        captured = null
      }
      suppressClick = moved > 3
      moved = 0
      setTimeout(() => {
        suppressClick = false
      }, 0)
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
