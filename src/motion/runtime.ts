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
  mouseProgressRaw,
  approach,
  MOUSE_DEFAULTS,
  MOUSE_REST,
  MOTION_CSS_PROPS,
  TRANSITION_DEFAULTS,
  type CompiledAnimation,
  type MotionValues,
  type MotionStyle,
  type SampleOptions,
  type StaggerSplit,
} from '@/lib/motion'
import { createLerpScroller, wheelDeltaPx, insideNestedScroller } from '@/lib/shared/scroll.js'
import { FX_ATTR, FX_GLOBAL } from '@/lib/shared/fxWire.js'

interface BindingMeta {
  k: string

  s?: string
  ac?: 'on' | 'off'
  t: 'load' | 'appear' | 'scrub' | 'mouse' | 'hover' | 'click' | 'scrolled' | 'change'
  at2?: number

  d?: number
  a: string
  o?: {
    m?: 'replay' | 'reverse'
    at?: number
    s?: { start?: number; end?: number; smooth?: number }
    mo?: { axis?: 'x' | 'y'; area?: 'element' | 'page'; smooth?: number }
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

  wait: number

  total: number

  to?: SampleOptions['to']
}

interface SiteFx {
  t?: { x?: string; e?: string }
  s?: { l: number }
}

interface FxEntry {
  c?: unknown[]
  m?: BindingMeta[]
  t?: string[]
  a?: string[]
}

interface FxManifest {
  els?: FxEntry[]
  lib?: Record<string, { steps: unknown[] }>
  animbp?: Record<string, string[]>
  bp?: { id: string; w: number }[]
  site?: SiteFx
}

// the sidecar is a deferred script that ran before this one (document order),
// so the global is already set — see src/lib/shared/fxWire.js
const manifest = ((window as unknown as Record<string, FxManifest>)[FX_GLOBAL] ??
  {}) as FxManifest

const lib = manifest.lib ?? {}
const siteFx = manifest.site ?? null
if (Object.keys(lib).length || siteFx) {
  const els = manifest.els ?? []
  const bpScope = manifest.animbp ?? {}
  const bps = manifest.bp ?? []
  /** the bindings this element triggers, from the manifest rather than an
   *  escaped JSON attribute */
  const metasOf = (el: Element): BindingMeta[] => els[+(el.getAttribute(FX_ATTR) || -1)]?.m ?? []

  const compiled: Record<string, Compiled> = {}
  const splits: Record<string, Split> = {}
  for (const id of Object.keys(lib)) {
    compiled[id] = compileAnimation(lib[id] as never)
    splits[id] = splitByStagger(compiled[id]!)
  }

  const still =
    /[?&]noanim\b/.test(location.search) ||
    (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)

  const hiddenAtBoot =
    typeof document !== 'undefined' && document.visibilityState === 'hidden'

  const viewportWidth = () => document.documentElement.clientWidth || window.innerWidth
  let currentBp = bps.length ? motionBreakpointId(bps, viewportWidth()) : ''
  const allowed = (key: string) => {
    const scope = bpScope[key]
    return !scope || scope.indexOf(currentBp) !== -1
  }

  const targets = new Map<string, HTMLElement[]>()
  const wired = Array.from(document.querySelectorAll<HTMLElement>(`[${FX_ATTR}]`))
  wired.forEach((el) => {
    for (const key of els[+(el.getAttribute(FX_ATTR) || -1)]?.a ?? []) {
      const list = targets.get(key) || []
      list.push(el)
      targets.set(key, list)
    }
  })

  const authored = new WeakMap<HTMLElement, string>()
  const countTo = (el: HTMLElement, c: Compiled): SampleOptions['to'] => {
    if (!authored.has(el)) authored.set(el, el.textContent || '')
    return countToFor(c, authored.get(el)!)
  }

  const staggerTargets = (el: HTMLElement, selector: string): HTMLElement[] =>
    selector
      ? (Array.from(el.querySelectorAll(selector)) as HTMLElement[])
      : (Array.from(el.children) as HTMLElement[])

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

  function write(play: Play) {
    const elementValues = sampleValues(play.split.element, play.time, { to: play.to })
    applyStyle(play.el, composeMotionStyle(mergeForElement(play.el, elementValues, play)))
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

  /**
   * The pre-play frame of every timeline aimed at an element, filled in by the
   * priming pass below. `clear` puts it back, because the resting state of an
   * element is its earliest `from` and not its natural value: a hover tween
   * rewinding to t=0 deletes its inline styles, which left a 0 → 1 fade
   * VISIBLE again the moment the pointer left.
   */
  const primedFrames = new Map<HTMLElement, MotionStyle>()

  function clear(play: Play, restore = true) {
    const els: HTMLElement[] = [play.el]
    if (play.split.hasStagger) els.push(...staggerTargets(play.el, play.split.selector))
    for (const el of els) {
      for (const prop of MOTION_CSS_PROPS) {
        ;(el.style as unknown as Record<string, string>)[prop] = ''
      }
      const back = restore && primedFrames.get(el)
      if (back) applyStyle(el, back)
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

  const stateOf = (meta: BindingMeta) => meta.s || meta.k

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
        wait: !reverse && !jump ? meta.d || 0 : 0,
        total,
        to: existing ? existing.to : countTo(el, split.element),
      }
      plays.set(key, play)
      if (jump) {
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
      play.time = foldReverseTime(play.compiled, play.time)
      play.direction = -1
      play.wait = 0
      play.running = !still
    })
    if (!still) ensureLoop()
  }

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
    const ENTER_CLASS = 'gt-enter'
    const root = document.documentElement

    function playEnter() {
      const enterId = transitions!.e
      const split = enterId ? splits[enterId] : null
      if (split && !still) applyStyle(document.body, initialStyle(split.element))
      root.classList.remove(ENTER_CLASS)
      if (!enterId || still) return
      clearWhenDone(ENTER_KEY, document.body, playElement(ENTER_KEY, document.body, enterId))
    }
    playEnter()

    let leaving = false

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
      document.addEventListener('click', (event) => {
        if (leaving) {
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
        if (url.origin !== location.origin) return
        if (url.hash && url.pathname === location.pathname && url.search === location.search) return
        event.preventDefault()
        leaving = true
        const total = playElement(EXIT_KEY, document.body, transitions.x!)
        setTimeout(
          () => location.assign(url.href),
          Math.min(total + 50, TRANSITION_DEFAULTS.exitTimeoutMs),
        )
      })
    }
  }

  const scrubs: { meta: BindingMeta; el: HTMLElement }[] = []
  const mice: { meta: BindingMeta; el: HTMLElement }[] = []
  const appearOnce = new Set<string>()
  const appearing: { meta: BindingMeta; el: HTMLElement }[] = []
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
      for (const meta of metasOf(entry.target)) {
        if (meta.t !== 'appear') continue
        if (entry.isIntersecting) {
          const mode = meta.o && meta.o.m
          if (!mode && appearOnce.has(meta.k)) continue
          appearOnce.add(meta.k)
          start(meta)
        } else if (meta.o && meta.o.m === 'reverse') {
          reverseBinding(meta)
        }
      }
    }
  }

  const scrolled: BindingMeta[] = []

  wired.forEach((el) => {
    for (const meta of metasOf(el)) {
      if (meta.t === 'load') {
        start(meta, false, hiddenAtBoot)
      } else if (meta.t === 'appear') {
        appearing.push({ meta, el })
        observerFor((meta.o && meta.o.at) || 0).observe(el)
      } else if (meta.t === 'scrub') {
        scrubs.push({ meta, el })
      } else if (meta.t === 'mouse') {
        mice.push({ meta, el })
      } else if (meta.t === 'scrolled') {
        scrolled.push(meta)
      } else if (meta.t === 'change') {
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

  if (!still) {
    // every trigger is primed, not just the entrances: a track's `from` is the
    // value the element holds until that timeline runs, so a hover tweening
    // opacity 0 → 1 sits at 0 until the pointer arrives. Anything that already
    // started during setup is skipped below rather than filtered here.
    const toPrime = wired.flatMap((el) => metasOf(el).map((meta) => ({ meta, el })))
    const perElement = new Map<
      HTMLElement,
      {
        el: { compiled: Compiled; delay: number; entrance: boolean; mid: boolean }[]
        kids: { split: Split; delay: number; entrance: boolean; mid: boolean }[]
      }
    >()
    for (const { meta } of toPrime) {
      const split = splits[meta.a]
      if (!split || !allowed(meta.k)) continue
      ;(targets.get(meta.k) || []).forEach((el, index) => {
        // a binding that already started during setup owns the element's
        // frame. `load` started at t=0 (the same values this would write) or,
        // with the tab hidden at boot, settled straight to its end state; and
        // `scrolled` runs its handler once at boot, so a page loaded past the
        // threshold is already playing. Priming the `from` over either would
        // paint a frame it has gone past.
        if (plays.has(playKey(stateOf(meta), index))) return
        let box = perElement.get(el)
        if (!box) perElement.set(el, (box = { el: [], kids: [] }))
        const entrance = meta.t === 'load' || meta.t === 'appear'
        const mid = meta.t === 'mouse'
        box.el.push({ compiled: split.element, delay: meta.d || 0, entrance, mid })
        if (split.hasStagger) box.kids.push({ split, delay: meta.d || 0, entrance, mid })
      })
    }
    perElement.forEach((box, el) => {
      const first = primeFirstFrame(box.el)
      if (Object.keys(first).length) {
        applyStyle(el, first)
        primedFrames.set(el, first)
      }
      for (const { split, delay, entrance, mid } of box.kids) {
        const firstChild = primeFirstFrame([{ compiled: split.staggered, delay, entrance, mid }])
        if (Object.keys(firstChild).length) {
          staggerTargets(el, split.selector).forEach((kid) => {
            applyStyle(kid, firstChild)
            primedFrames.set(kid, firstChild)
          })
        }
      }
    })
  }

  const coarsePointer =
    typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

  function holdAt(meta: BindingMeta, p: number) {
    const c = compiled[meta.a]!
    const split = splits[meta.a]!
    const clamped = p < 0 ? 0 : p > 1 ? 1 : p
    const nodes = targets.get(meta.k) || []
    nodes.forEach((node, index) => {
      const total = playTotal(node, c, split)
      const play: Play = {
        el: node,
        compiled: c,
        split,
        time: clamped * total,
        direction: 1,
        running: false,
        wait: 0,
        total,
        to: countTo(node, split.element),
      }
      plays.set(playKey(meta.k, index), play)
      write(play)
    })
  }

  let driveScrub: ((now?: number) => void) | null = null

  if (scrubs.length && !still) {
    let pending = false
    let lastT = 0
    const smoothState = new Map<BindingMeta, number>()
    const updateScrub = (now?: number) => {
      pending = false
      const t = typeof now === 'number' ? now : performance.now()
      const dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 1 / 60
      lastT = t
      let unsettled = false
      const vh = window.innerHeight
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
      for (const { entry, raw } of frame_) holdAt(entry.meta, raw)
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


  // --- mouse follow: continuous progress like scrub, driven by the pointer ---
  // The REST position is 0.5, not the track's `from`: a follow is authored as
  // -n → n, so the middle is where the element sits before the pointer has
  // moved. Priming (above) left it at `from`, i.e. shifted hard to one side,
  // so each binding is held at the centre here and eases away from there.
  if (mice.length && !still && !coarsePointer) {
    const CENTRE = MOUSE_REST
    let pending = false
    let lastT = 0
    let px = 0
    let py = 0
    let seen = false
    const smoothed = new Map<BindingMeta, number>()

    const schedule = () => {
      if (pending) return
      pending = true
      requestAnimationFrame(updateMouse)
    }

    function updateMouse(now?: number) {
      pending = false
      if (!seen) return
      const t = typeof now === 'number' ? now : performance.now()
      const dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 1 / 60
      lastT = t
      let unsettled = false
      const vw = document.documentElement.clientWidth || window.innerWidth
      const vh = window.innerHeight
      for (const { meta, el } of mice) {
        if (!allowed(meta.k) || !compiled[meta.a] || !splits[meta.a]) continue
        const opts = (meta.o && meta.o.mo) || {}
        const box =
          opts.area === 'page'
            ? { left: 0, top: 0, width: vw, height: vh }
            : el.getBoundingClientRect()
        const raw = mouseProgressRaw({ x: px, y: py }, box, opts.axis)
        if (raw === null) continue
        const smooth = typeof opts.smooth === 'number' ? opts.smooth : MOUSE_DEFAULTS.smooth
        let p = raw
        if (smooth > 0) {
          const prev = smoothed.has(meta) ? smoothed.get(meta)! : CENTRE
          p = approach(prev, raw, dt, smooth)
          if (p !== raw) unsettled = true
        }
        smoothed.set(meta, p)
        holdAt(meta, p)
      }
      if (unsettled) schedule()
    }

    for (const { meta } of mice) {
      if (!allowed(meta.k) || !compiled[meta.a] || !splits[meta.a]) continue
      smoothed.set(meta, CENTRE)
      holdAt(meta, CENTRE)
    }

    window.addEventListener(
      'pointermove',
      (event: PointerEvent) => {
        px = event.clientX
        py = event.clientY
        seen = true
        schedule()
      },
      { passive: true },
    )
    // the element's box moves under a still pointer, so both of these change
    // progress for an `element`-area binding
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
  }

  const scrollFx = siteFx && siteFx.s
  if (scrollFx && !still && !coarsePointer) {
    const scroller = createLerpScroller({
      get: () => window.scrollY,
      set: (n) => window.scrollTo(0, n),
      max: () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
      lerp: scrollFx.l,
    })

    let scrollFrame: number | null = null
    let lastFrame = 0
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
        if (event.ctrlKey) return
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

    window.addEventListener(
      'scroll',
      () => {
        if (Math.abs(window.scrollY - ownWrite) > 1) scroller.sync()
      },
      { passive: true },
    )
  }

  if (Object.keys(bpScope).length && bps.length) {
    let timer: ReturnType<typeof setTimeout> | null = null
    window.addEventListener('resize', () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const next = motionBreakpointId(bps, viewportWidth())
        if (next === currentBp) return
        currentBp = next
        plays.forEach((play, key) => {
          if (!allowed(key.slice(0, key.lastIndexOf(':')))) {
            // a binding that just left its breakpoint scope: back to the
            // natural value, never to a `from` that no longer applies here
            clear(play, false)
            plays.delete(key)
          }
        })
      }, 100)
    })
  }

  if (appearing.length && !still) {
    setTimeout(() => {
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
