// SPDX-License-Identifier: MIT — see LICENSE-EXCEPTIONS.md (embedded in exported sites; deliberately not AGPL)
// Published-site motion runtime, built to server/motion-runtime.js and shipped
// as /assets/motion.js. The MATH is imported from src/lib/shared/motion.js —
// the exact module the editor uses — so a published animation is frame-for-frame
// what the canvas previewed. This file owns only the browser side: reading the
// emitted JSON, wiring triggers, and writing styles.
//
// Emitted by server/export.mjs:
//   #anim-lib   { [animationId]: Animation }        (only animations in use)
//   #anim-bp    { [key]: breakpointId[] }           (scoped bindings only)
//   #int-bp     [{ id, w }]                         (shared with interactions)
//   #site-fx    { t?: {x?, e?}, s?: {l} }           (settings.motion, site-wide)
//   data-anim   [{ k, t, a, o?, d? }] on trigger elements
//   data-atgt   "key key" on animated elements
// The page-transition timelines in #site-fx.t are ids INTO #anim-lib, so
// transitions reuse the library wire format rather than adding a second one.
// Keys are unique per component instance AND per collection-list repeat, so
// every card owns its own play and its own "already appeared" state.
import {
  compileAnimation,
  countToFor,
  sampleText,
  sampleValues,
  composeMotionStyle,
  splitByStagger,
  initialStyle,
  primeFirstFrame,
  foldReverseTime,
  motionBreakpointId,
  appearRootMargin,
  scrubProgressRaw,
  MOTION_CSS_PROPS,
  TRANSITION_DEFAULTS,
  type CompiledAnimation,
  type MotionValues,
  type MotionStyle,
  type SampleOptions,
  type StaggerSplit,
} from '@/lib/motion'
import { createLerpScroller, wheelDeltaPx, insideNestedScroller } from '@/lib/shared/scroll.js'

interface BindingMeta {
  /** binding key (unique per instance/repeat) — what `data-atgt` lists and
   *  what the breakpoint gate reads */
  k: string
  /** CLICK only: the play key, one per (animation, target), so an open button
   *  and a close button drive ONE timeline. Absent on every other trigger,
   *  which has no state to share. */
  s?: string
  /** click only: 'on' always runs it forward, 'off' always rewinds it */
  ac?: 'on' | 'off'
  t: 'load' | 'appear' | 'scrub' | 'hover' | 'click' | 'scrolled' | 'change'
  /** 'scrolled' only: the px threshold (default 50) */
  at2?: number
  /** ms the FORWARD play waits after the trigger before the timeline starts;
   *  absent = 0. A reverse never waits. Never emitted for a scrub. */
  d?: number
  /** animation id */
  a: string
  /** options: appearMode / appearAt / scrub range (+ optional smoothing) */
  o?: {
    m?: 'replay' | 'reverse'
    at?: number
    s?: { start?: number; end?: number; smooth?: number }
  }
}

type Compiled = CompiledAnimation
type Split = StaggerSplit

interface Play {
  el: HTMLElement
  compiled: Compiled
  split: Split
  time: number
  direction: 1 | -1
  running: boolean
  /** ms still to wait before `time` starts advancing — the binding's delay.
   *  While waiting the play writes frame 0, so the element holds its primed
   *  first frame instead of snapping to its natural state. */
  wait: number
  /** full run length INCLUDING the stagger tail — compiled.duration only covers
   * the element-level tracks (the compiler can't know the child count), so a
   * cascade clamped to it froze mid-flight with late children part-faded */
  total: number
  /** per-element destinations: a `count` ends on the number THIS element's
   * authored text says, not the one number the shared compiled track carries.
   * Undefined for every timeline that does not count. */
  to?: SampleOptions['to']
}

const json = <T,>(id: string, fallback: T): T => {
  const el = document.getElementById(id)
  if (!el) return fallback
  try {
    return JSON.parse(el.textContent || '') as T
  } catch {
    return fallback
  }
}

/** site-wide motion: page transitions and smooth scrolling (settings.motion) */
interface SiteFx {
  /** transitions: animation ids for the outgoing (x) and incoming (e) page */
  t?: { x?: string; e?: string }
  /** smooth scroll: the per-frame lerp factor */
  s?: { l: number }
}

const lib = json<Record<string, { id: string; name: string; steps: unknown[] }>>('anim-lib', {})
const siteFx = json<SiteFx | null>('site-fx', null)
// a page with no element animations still needs the runtime when the site has
// transitions or smooth scroll — those are settings, not per-element bindings
if (Object.keys(lib).length || siteFx) {
  const bpScope = json<Record<string, string[]>>('anim-bp', {})
  const bps = json<{ id: string; w: number }[]>('int-bp', [])

  const compiled: Record<string, Compiled> = {}
  const splits: Record<string, Split> = {}
  for (const id of Object.keys(lib)) {
    compiled[id] = compileAnimation(lib[id] as never)
    splits[id] = splitByStagger(compiled[id]!)
  }

  // ?noanim (deterministic screenshots/crawlers) and the OS reduce-motion
  // preference both mean "show the end state, never move"
  const still =
    /[?&]noanim\b/.test(location.search) ||
    (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)

  // rAF is throttled to nothing while the document is hidden
  const hiddenAtBoot =
    typeof document !== 'undefined' && document.visibilityState === 'hidden'

  // documentElement.clientWidth, NOT innerWidth: horizontal overflow inflates
  // innerWidth past the CSS viewport, desyncing the gate from Tailwind's media
  // queries (same fix as the interaction runtime's computeBp)
  const viewportWidth = () => document.documentElement.clientWidth || window.innerWidth
  let currentBp = bps.length ? motionBreakpointId(bps, viewportWidth()) : ''
  const allowed = (key: string) => {
    const scope = bpScope[key]
    return !scope || scope.indexOf(currentBp) !== -1
  }

  /** every element an animation can move, by binding key */
  const targets = new Map<string, HTMLElement[]>()
  document.querySelectorAll<HTMLElement>('[data-atgt]').forEach((el) => {
    for (const key of (el.getAttribute('data-atgt') || '').split(' ').filter(Boolean)) {
      const list = targets.get(key) || []
      list.push(el)
      targets.set(key, list)
    }
  })

  /**
   * Each element's AUTHORED text, read once and kept. A `count` ends on the
   * number the element itself says — `to` lives on the shared Animation, so
   * four stat cards driven by one master binding would otherwise all land on
   * one number. Cached because write() replaces textContent every frame: a
   * replay (appearMode 'replay', a second click, a reverse) must not read a
   * mid-tween number back as its destination.
   */
  const authored = new WeakMap<HTMLElement, string>()
  const countTo = (el: HTMLElement, c: Compiled): SampleOptions['to'] => {
    if (!authored.has(el)) authored.set(el, el.textContent || '')
    return countToFor(c, authored.get(el)!)
  }

  /** the elements a staggered part cascades over */
  const staggerTargets = (el: HTMLElement, selector: string): HTMLElement[] =>
    selector
      ? (Array.from(el.querySelectorAll(selector)) as HTMLElement[])
      : (Array.from(el.children) as HTMLElement[])

  /** a play's full length for THIS element: the compiled duration plus the
   * stagger tail (max stagger × (children − 1)), computed here because only
   * the DOM knows how many children the cascade covers */
  const playTotal = (el: HTMLElement, c: Compiled, split: Split): number => {
    if (!split.hasStagger) return c.duration
    let maxStagger = 0
    for (const track of split.staggered.tracks) {
      if (track.stagger > maxStagger) maxStagger = track.stagger
    }
    const kids = staggerTargets(el, split.selector).length
    return c.duration + maxStagger * Math.max(0, kids - 1)
  }

  const plays = new Map<string, Play>()
  let frame: number | null = null
  let last = 0

  const applyStyle = (el: HTMLElement, style: MotionStyle) => {
    for (const prop of Object.keys(style)) {
      ;(el.style as unknown as Record<string, string>)[prop] = String(style[prop])
    }
  }

  /**
   * Writes one frame. Unstaggered tracks move the element; staggered tracks
   * cascade over its children — a single timeline can do both.
   * Values from every play on the same element are merged per PROPERTY before
   * composing, so a marquee's x and an entrance's y coexist in one transform.
   */
  function write(play: Play) {
    const elementValues = sampleValues(play.split.element, play.time, { to: play.to })
    applyStyle(play.el, composeMotionStyle(mergeForElement(play.el, elementValues, play)))
    // a `count` track writes TEXT, not style. NEVER in `still` mode: the end
    // state of a count IS the authored text, and the exporter deliberately
    // never baked a first frame for it — so a reduced-motion visitor, and
    // anyone on ?noanim, reads the real number and the runtime never touches it.
    if (!still) {
      const text = sampleText(elementValues, document.documentElement.lang)
      if (text !== undefined) play.el.textContent = text
    }
    if (!play.split.hasStagger) return
    const kids = staggerTargets(play.el, play.split.selector)
    for (let i = 0; i < kids.length; i++) {
      applyStyle(kids[i]!, composeMotionStyle(sampleValues(play.split.staggered, play.time, { childIndex: i })))
    }
  }

  /** merges the other running plays targeting this element, so a marquee's x
   * and an entrance's y compose into ONE transform instead of overwriting */
  function mergeForElement(el: HTMLElement, own: MotionValues, self: Play): MotionValues {
    let merged: MotionValues = {}
    let found = false
    plays.forEach((other) => {
      if (other === self || other.el !== el) return
      found = true
      merged = { ...merged, ...sampleValues(other.split.element, other.time, { to: other.to }) }
    })
    return found ? { ...merged, ...own } : own
  }

  /** clears what a play wrote so the element returns to its authored styling */
  function clear(play: Play) {
    const els: HTMLElement[] = [play.el]
    if (play.split.hasStagger) els.push(...staggerTargets(play.el, play.split.selector))
    for (const el of els) {
      for (const prop of MOTION_CSS_PROPS) {
        ;(el.style as unknown as Record<string, string>)[prop] = ''
      }
    }
  }

  function loop(now: number) {
    const dt = last ? now - last : 16
    last = now
    let live = false
    plays.forEach((play, key) => {
      if (!play.running) return
      if (play.wait > 0) {
        play.wait -= dt
        if (play.wait > 0) {
          live = true
          write(play)
          return
        }
        // the frame that crosses the end of the wait carries its overshoot
        // into the timeline, so a delay is exact rather than rounded to a frame
        play.time = -play.wait
        play.wait = 0
      } else {
        play.time += dt * play.direction
      }
      const infinite = play.compiled.tracks.some((t) => t.repeat === Infinity)
      if (play.direction === 1 && play.time >= play.total && !infinite) {
        play.time = play.total
        play.running = false
      } else if (play.direction === -1 && play.time <= 0) {
        clear(play)
        plays.delete(key)
        return
      } else {
        live = true
      }
      write(play)
    })
    frame = live ? requestAnimationFrame(loop) : ((last = 0), null)
  }

  const ensureLoop = () => {
    if (frame === null) {
      last = 0
      frame = requestAnimationFrame(loop)
    }
  }

  const playKey = (key: string, index: number) => `${key}:${index}`
  /** the key a binding's play is held under — shared per (animation, target)
   *  for a click, per binding for everything else */
  const stateOf = (meta: BindingMeta) => meta.s || meta.k

  /** `settle: true` jumps straight to the end state without animating —
   * what `still` does, but for one binding. Used when rAF will not run. */
  function start(meta: BindingMeta, reverse = false, settle = false) {
    if (!allowed(meta.k)) return
    const c = compiled[meta.a]
    const split = splits[meta.a]
    if (!c || !split) return
    const jump = still || settle
    const els = targets.get(meta.k) || []
    els.forEach((el, index) => {
      const key = playKey(stateOf(meta), index)
      const existing = plays.get(key)
      const total = playTotal(el, c, split)
      const play: Play = {
        el,
        compiled: c,
        split,
        time: reverse ? foldReverseTime(c, existing ? existing.time : c.duration) : 0,
        direction: reverse ? -1 : 1,
        running: !jump,
        // only the forward play waits, and never when jumping to the end state
        wait: !reverse && !jump ? meta.d || 0 : 0,
        total,
        // read before the first write(), which replaces textContent
        to: existing ? existing.to : countTo(el, split.element),
      }
      plays.set(key, play)
      if (jump) {
        // sample at `total`, not compiled.duration — endStyle() at duration
        // left staggered children part-faded (their windows extend into the
        // stagger tail); write() at total lands every child on its end value
        play.time = total
        play.running = false
        write(play)
      } else {
        write(play)
      }
    })
    if (!jump) ensureLoop()
  }

  function reverseBinding(meta: BindingMeta) {
    const els = targets.get(meta.k) || []
    els.forEach((_el, index) => {
      const play = plays.get(playKey(stateOf(meta), index))
      if (!play) return
      // an infinite loop that ran for minutes must not rewind for minutes
      play.time = foldReverseTime(play.compiled, play.time)
      play.direction = -1
      // a reverse starts at once — a hover-out that waited would read as stuck
      play.wait = 0
      play.running = !still
    })
    if (!still) ensureLoop()
  }

  // ---------- page transitions ----------
  // An animation over the whole page around a same-origin navigation: the exit
  // timeline plays on <body> before the browser leaves, the enter timeline
  // plays on the page that loads. Both are ordinary library animations, so
  // nothing here knows about presets.

  /** plays a timeline on one element, outside the binding-key machinery (a
   * transition has no binding and always targets <body>). Returns its length. */
  function playElement(key: string, el: HTMLElement, animId: string): number {
    const c = compiled[animId]
    const split = splits[animId]
    if (!c || !split) return 0
    const total = playTotal(el, c, split)
    const play: Play = {
      el,
      compiled: c,
      split,
      time: 0,
      direction: 1,
      running: !still,
      wait: 0,
      total,
      to: countTo(el, split.element),
    }
    plays.set(key, play)
    if (still) play.time = total
    write(play)
    if (!still) ensureLoop()
    return total
  }

  /**
   * Drops a finished transition's inline styles. Not cosmetic: a `transform`
   * left on <body> makes it the containing block for every `position: fixed`
   * descendant, so a slide transition would permanently re-anchor fixed
   * headers. Another play still moving this element keeps its own styles.
   */
  function clearWhenDone(key: string, el: HTMLElement, total: number) {
    setTimeout(() => {
      const play = plays.get(key)
      if (!play || play.running) return
      plays.delete(key)
      let stillAnimated = false
      plays.forEach((other) => {
        if (other.el === el) stillAnimated = true
      })
      if (!stillAnimated) clear(play)
    }, total + 60)
  }

  const transitions = siteFx && siteFx.t
  if (transitions) {
    const ENTER_KEY = '__t-enter:0'
    const EXIT_KEY = '__t-exit:0'
    // the class the exporter's inline head script sets, holding the incoming
    // page on its first frame until we can write that frame inline ourselves
    const ENTER_CLASS = 'gt-enter'
    const root = document.documentElement

    function playEnter() {
      const enterId = transitions!.e
      const split = enterId ? splits[enterId] : null
      // write the first frame inline BEFORE dropping the class, so there is no
      // frame where the page paints its natural state and then jumps back
      if (split && !still) applyStyle(document.body, initialStyle(split.element))
      root.classList.remove(ENTER_CLASS)
      if (!enterId || still) return
      clearWhenDone(ENTER_KEY, document.body, playElement(ENTER_KEY, document.body, enterId))
    }
    playEnter()

    let leaving = false

    // Restored from the back/forward cache: the DOM is exactly as we left it,
    // still wearing the exit animation's inline styles — so the visitor would
    // come back to a faded-out page. Wipe them and play the entrance again.
    window.addEventListener('pageshow', (event) => {
      if (!(event as PageTransitionEvent).persisted) return
      const exit = plays.get(EXIT_KEY)
      if (exit) {
        plays.delete(EXIT_KEY)
        clear(exit)
      }
      leaving = false
      root.classList.add(ENTER_CLASS)
      playEnter()
    })

    if (transitions.x && !still) {
      // Bubble phase, not capture: a handler that already called
      // preventDefault() (custom code running its own navigation) has had its
      // say by the time the click reaches us, and we leave it alone.
      document.addEventListener('click', (event) => {
        if (leaving) {
          // exit is already running toward a destination — a second click
          // would only stack another navigation on top of it
          event.preventDefault()
          return
        }
        if (event.defaultPrevented || event.button !== 0) return
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        const target = event.target as Element | null
        const anchor = target && target.closest ? target.closest('a[href]') : null
        if (!(anchor instanceof HTMLAnchorElement)) return
        const where = anchor.getAttribute('target')
        if ((where && where !== '_self') || anchor.hasAttribute('download')) return
        let url: URL
        try {
          url = new URL(anchor.href, location.href)
        } catch {
          return
        }
        // another origin leaves the site; a hash on this very page scrolls
        // without navigating — neither is ours to animate
        if (url.origin !== location.origin) return
        if (url.hash && url.pathname === location.pathname && url.search === location.search) return
        event.preventDefault()
        leaving = true
        const total = playElement(EXIT_KEY, document.body, transitions.x!)
        // hard cap: a custom exit timeline that is very long, or loops forever,
        // must never leave the visitor stranded on the page they tried to leave
        setTimeout(
          () => location.assign(url.href),
          Math.min(total + 50, TRANSITION_DEFAULTS.exitTimeoutMs),
        )
      })
    }
  }

  // ---------- collect bindings ----------

  const scrubs: { meta: BindingMeta; el: HTMLElement }[] = []
  const appearOnce = new Set<string>()
  const appearing: { meta: BindingMeta; el: HTMLElement }[] = []
  /** appearAt value → the observer watching at that threshold */
  const observers = new Map<number, IntersectionObserver>()

  const observerFor = (at: number) => {
    let observer = observers.get(at)
    if (!observer) {
      observer = new IntersectionObserver(onAppear, { rootMargin: appearRootMargin(at) })
      observers.set(at, observer)
    }
    return observer
  }

  function onAppear(entries: IntersectionObserverEntry[]) {
    for (const entry of entries) {
      const list = JSON.parse(entry.target.getAttribute('data-anim') || '[]') as BindingMeta[]
      for (const meta of list) {
        if (meta.t !== 'appear') continue
        if (entry.isIntersecting) {
          const mode = meta.o && meta.o.m
          // the key is per-repeat, so "once" means once PER CARD
          if (!mode && appearOnce.has(meta.k)) continue
          appearOnce.add(meta.k)
          start(meta)
        } else if (meta.o && meta.o.m === 'reverse') {
          reverseBinding(meta)
        }
      }
    }
  }

  /** 'scrolled' bindings, driven by one shared listener below */
  const scrolled: BindingMeta[] = []

  document.querySelectorAll<HTMLElement>('[data-anim]').forEach((el) => {
    const list = JSON.parse(el.getAttribute('data-anim') || '[]') as BindingMeta[]
    for (const meta of list) {
      if (meta.t === 'load') {
        // A hidden tab (background load, prerender, print) does not run rAF, so
        // an entrance would sit on its primed first frame — which for the usual
        // opacity 0 → 1 is simply invisible, and stays that way until the tab is
        // focused. Land on the end state instead; the same reasoning as the 3s
        // appear fallback below.
        start(meta, false, hiddenAtBoot)
      } else if (meta.t === 'appear') {
        appearing.push({ meta, el })
        observerFor((meta.o && meta.o.at) || 0).observe(el)
      } else if (meta.t === 'scrub') {
        scrubs.push({ meta, el })
      } else if (meta.t === 'scrolled') {
        // symmetric, like its class counterpart: forward past the threshold,
        // rewound below it. The tween equivalent of a shrinking header.
        scrolled.push(meta)
      } else if (meta.t === 'change') {
        // a control's checked / non-empty state drives the timeline, so a
        // conditional field can slide in instead of merely appearing
        const onChange = (event: Event) => {
          const input = event.target as HTMLInputElement | null
          if (!input) return
          const on =
            input.type === 'checkbox' || input.type === 'radio' ? input.checked : !!input.value
          if (on) start(meta)
          else reverseBinding(meta)
        }
        el.addEventListener('change', onChange)
        el.addEventListener('input', onChange)
      } else if (meta.t === 'hover') {
        el.addEventListener('mouseenter', () => start(meta))
        el.addEventListener('mouseleave', () => reverseBinding(meta))
      } else if (meta.t === 'click') {
        // `ac` aims the click: 'on' always runs it forward, 'off' always
        // rewinds, and the default toggles. With the play keyed per
        // (animation, target), that is what makes an open button, a close
        // button and an overlay drive ONE timeline. useMotion.clickAction
        // answers a click identically, so the canvas cannot drift from here.
        el.addEventListener('click', () => {
          if (meta.ac === 'on') return start(meta)
          if (meta.ac === 'off') return reverseBinding(meta)
          const play = plays.get(playKey(stateOf(meta), 0))
          if (play && play.direction === 1) reverseBinding(meta)
          else start(meta)
        })
      }
    }
  })

  // one listener for every `scrolled` timeline, holding each one's last state so
  // a scroll event does not restart a play that is already where it belongs
  if (scrolled.length) {
    const past = new Map<BindingMeta, boolean>()
    const onScroll = () => {
      const y = window.pageYOffset || document.documentElement.scrollTop || 0
      for (const meta of scrolled) {
        const on = y > (meta.at2 || 50)
        if (past.get(meta) === on) continue
        past.set(meta, on)
        if (on) start(meta)
        else reverseBinding(meta)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
  }

  // ---------- prime first frames (no flash) ----------
  // The exporter inlines the element-level first frame, but staggered children
  // and measured targets can only be primed here. Runs before any trigger so
  // nothing paints its final state first.
  if (!still) {
    // load bindings are NOT primed when the document is hidden: they were just
    // settled on their end state above, and priming would paint frame 0 back
    // over it (this block runs after the collect loop)
    const loadToPrime = hiddenAtBoot
      ? []
      : Array.from(document.querySelectorAll<HTMLElement>('[data-anim]')).flatMap((el) =>
          (JSON.parse(el.getAttribute('data-anim') || '[]') as BindingMeta[])
            .filter((m) => m.t === 'load')
            .map((meta) => ({ meta, el })),
        )
    // Gathered PER ELEMENT first, then primed through the one shared rule
    // (primeFirstFrame: per property, the earliest-starting timeline's `from`
    // wins, start = binding delay + track offset) — applying each binding in
    // turn let the last one listed overwrite the first, so an element with an
    // entrance and a later exit was primed on the exit's `from` and sat
    // visible. The exporter bakes with the same helper.
    const perElement = new Map<HTMLElement, { el: { compiled: Compiled; delay: number }[]; kids: { split: Split; delay: number }[] }>()
    for (const { meta } of appearing.concat(loadToPrime)) {
      const split = splits[meta.a]
      if (!split || !allowed(meta.k)) continue
      for (const el of targets.get(meta.k) || []) {
        let box = perElement.get(el)
        if (!box) perElement.set(el, (box = { el: [], kids: [] }))
        box.el.push({ compiled: split.element, delay: meta.d || 0 })
        if (split.hasStagger) box.kids.push({ split, delay: meta.d || 0 })
      }
    }
    perElement.forEach((box, el) => {
      const first = primeFirstFrame(box.el)
      if (Object.keys(first).length) applyStyle(el, first)
      // staggered children: the selector decides WHICH children, so prime per
      // selector group — one timeline's children are one group
      for (const { split, delay } of box.kids) {
        const firstChild = primeFirstFrame([{ compiled: split.staggered, delay }])
        if (Object.keys(firstChild).length) {
          staggerTargets(el, split.selector).forEach((kid) => applyStyle(kid, firstChild))
        }
      }
    })
  }

  // ---------- scroll-driven ----------

  // `still` (?noanim / prefers-reduced-motion) means NO movement at all: scrub
  // bindings are skipped entirely, so scrubbed elements hold their natural
  // authored state (a parallax frozen mid-flight would be an arbitrary frame)
  /** the scrub pass, exposed so the smooth scroller can run it inside its own
   * frame — parallax that read scroll a frame late would visibly lag the page */
  let driveScrub: ((now?: number) => void) | null = null

  if (scrubs.length && !still) {
    let pending = false
    let lastT = 0
    // scrub.smooth (seconds, a time constant): the play lags its scroll target
    // by an exponential catch-up, so fast scrolling reads as eased motion
    // instead of a hard 1:1 lock. The rAF loop keeps itself alive until every
    // smoothed binding has converged on its target.
    const smoothState = new Map<BindingMeta, number>()
    const updateScrub = (now?: number) => {
      pending = false
      const t = typeof now === 'number' ? now : performance.now()
      const dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 1 / 60
      lastT = t
      let unsettled = false
      const vh = window.innerHeight
      // Several scrub bindings can tween the same property on one element
      // (chained segments, or a marker-driven tween plus the element's own).
      // write() gives the LAST-written play priority per property, so order
      // the frame's writes by distance from the active 0..1 range, farthest
      // first: the binding nearest (or inside) its range lands last and wins,
      // instead of whichever binding happens to sit last in DOM order pinning
      // the element to its clamped resting value every frame.
      const frame_ = scrubs
        .filter(({ meta }) => allowed(meta.k) && compiled[meta.a] && splits[meta.a])
        .map((entry) => {
          const scrubOpts = entry.meta.o && entry.meta.o.s
          let raw = scrubProgressRaw(entry.el.getBoundingClientRect().top, vh, scrubOpts)
          const smooth =
            scrubOpts && typeof scrubOpts.smooth === 'number' && scrubOpts.smooth > 0
              ? scrubOpts.smooth
              : 0
          if (smooth) {
            const prev = smoothState.has(entry.meta) ? smoothState.get(entry.meta)! : raw
            let eased = prev + (raw - prev) * (1 - Math.exp(-dt / smooth))
            if (Math.abs(raw - eased) > 0.001) unsettled = true
            else eased = raw
            smoothState.set(entry.meta, eased)
            raw = eased
          }
          return { entry, raw, dist: raw < 0 ? -raw : raw > 1 ? raw - 1 : 0 }
        })
        .sort((a, b) => b.dist - a.dist)
      for (const { entry, raw } of frame_) {
        const { meta } = entry
        const c = compiled[meta.a]!
        const split = splits[meta.a]!
        const p = raw < 0 ? 0 : raw > 1 ? 1 : raw
        const nodes = targets.get(meta.k) || []
        nodes.forEach((node, index) => {
          const total = playTotal(node, c, split)
          const play: Play = {
            el: node,
            compiled: c,
            split,
            // progress maps over the FULL length so a staggered scrub reaches
            // its last child's end value at p = 1
            time: p * total,
            direction: 1,
            running: false,
            wait: 0, // never emitted for a scrub; it follows the scroll
            total,
            // the WeakMap is load-bearing here: this Play is rebuilt every
            // scroll frame, and write() has already replaced the text
            to: countTo(node, split.element),
          }
          plays.set(playKey(meta.k, index), play)
          write(play)
        })
      }
      if (unsettled && !pending) {
        pending = true
        requestAnimationFrame(updateScrub)
      }
    }
    const onScroll = () => {
      if (!pending) {
        pending = true
        requestAnimationFrame(updateScrub)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    updateScrub()
    driveScrub = updateScrub
  }

  // ---------- smooth scrolling ----------
  // Wheel goes to a lerped target instead of straight to the page. Off for
  // `still` (?noanim / reduced motion) and off on touch, where the platform's
  // own momentum scrolling is already what the visitor expects — and where
  // hijacking the wheel would fight it.

  const scrollFx = siteFx && siteFx.s
  const coarsePointer =
    typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
  if (scrollFx && !still && !coarsePointer) {
    const scroller = createLerpScroller({
      get: () => window.scrollY,
      // a real scroll position, never a transform — see the note in
      // lib/shared/scroll.js and server/site-runtime.js's `scrolled` trigger
      set: (n) => window.scrollTo(0, n),
      max: () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
      lerp: scrollFx.l,
    })

    let scrollFrame: number | null = null
    let lastFrame = 0
    /** the position we last wrote, to tell our own scrolling from everyone else's */
    let ownWrite = window.scrollY

    const frameStep = (now: number) => {
      const dt = lastFrame ? now - lastFrame : 16
      lastFrame = now
      const moving = scroller.step(dt)
      ownWrite = window.scrollY
      if (driveScrub) driveScrub(now)
      scrollFrame = moving ? requestAnimationFrame(frameStep) : ((lastFrame = 0), null)
    }

    window.addEventListener(
      'wheel',
      (event) => {
        if (event.ctrlKey) return // pinch-zoom
        // A MODAL is open (site-runtime.js set the flag on <html>): stand down
        // and let the browser handle the wheel. `overflow: hidden` on <html>
        // does not stop this scroller — it writes window.scrollTo directly, so
        // the page kept moving under the panel. Standing down means the lock
        // really locks and the panel's own scroller scrolls natively.
        if (document.documentElement.hasAttribute('data-guano-modal')) return
        if (insideNestedScroller(event.target as Element | null, document.body, event.deltaY)) return
        event.preventDefault()
        scroller.wheel(wheelDeltaPx(event.deltaY, event.deltaMode, window.innerHeight))
        if (scrollFrame === null) {
          lastFrame = 0
          scrollFrame = requestAnimationFrame(frameStep)
        }
      },
      { passive: false },
    )

    // anything that moved the page without us — keyboard, scrollbar drag, a
    // hash jump, a bfcache restore — becomes the new starting point
    window.addEventListener(
      'scroll',
      () => {
        if (Math.abs(window.scrollY - ownWrite) > 1) scroller.sync()
      },
      { passive: true },
    )
  }

  // ---------- breakpoint re-gating ----------

  if (Object.keys(bpScope).length && bps.length) {
    let timer: ReturnType<typeof setTimeout> | null = null
    window.addEventListener('resize', () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const next = motionBreakpointId(bps, viewportWidth())
        if (next === currentBp) return
        currentBp = next
        // a binding that just left its breakpoint scope must stop styling
        plays.forEach((play, key) => {
          if (!allowed(key.slice(0, key.lastIndexOf(':')))) {
            clear(play)
            plays.delete(key)
          }
        })
      }, 100)
    })
  }

  // safety net, mirroring the interaction runtime: content that animates in
  // must never stay invisible if the observer never fires (hidden tab, print,
  // a crawler that ignores IntersectionObserver)
  if (appearing.length && !still) {
    setTimeout(() => {
      // still hidden when the fallback fires? rAF is not running, so animating
      // would leave the content on its invisible first frame — settle instead
      const hiddenNow = document.visibilityState === 'hidden'
      for (const { meta } of appearing) {
        if (!appearOnce.has(meta.k)) {
          appearOnce.add(meta.k)
          start(meta, false, hiddenNow)
        }
      }
    }, 3000)
  }
}
