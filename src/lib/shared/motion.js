// SPDX-License-Identifier: MIT — see LICENSE-EXCEPTIONS.md (embedded in exported sites; deliberately not AGPL)
// The motion engine's pure math, shared VERBATIM by three consumers:
//   - the editor canvas + preview (via src/lib/motion.ts → useMotion)
//   - the published-site runtime (src/motion/runtime.ts → assets/motion.js)
//   - the MCP server's validators (via src/lib/mcp-runtime.ts)
// Plain-JS ESM so the node exporter and the browser bundle can both consume it
// directly, and DOM-free so identical input always produces identical output on
// every surface — that equivalence is the whole point of this file living here.
// Types live in src/lib/motion.ts.
//
// The model: an Animation is an ordered list of steps; each step tweens a set
// of property tracks over a duration with an easing. compileAnimation() flattens
// that into absolute-timed tracks; sampleValues() turns a time into per-property
// values; composeMotionStyle() turns those into CSS. Nothing here touches an
// element — the caller applies the result.
//
// Values may carry a unit ("110%", "1em", -50) so a move can be relative to the
// element or the viewport, which is what makes marquees and percentage slides
// resolution-independent. The unit travels with the value into the CSS, where
// the browser resolves it natively.

/**
 * Every tweenable property: how it reaches CSS, its default unit, the units it
 * accepts, and the neutral value used when a track omits `from` and the caller
 * can't measure one. `kind` groups properties that compose into one CSS
 * declaration.
 */
const LENGTH_UNITS = ['px', '%', 'em', 'rem', 'vw', 'vh']

export const MOTION_PROPS = {
  x: { kind: 'transform', unit: 'px', units: LENGTH_UNITS, def: 0, label: 'Move X' },
  y: { kind: 'transform', unit: 'px', units: LENGTH_UNITS, def: 0, label: 'Move Y' },
  scale: { kind: 'transform', unit: '', units: [], def: 1, label: 'Scale' },
  rotate: { kind: 'transform', unit: 'deg', units: ['deg'], def: 0, label: 'Rotate' },
  opacity: { kind: 'opacity', unit: '', units: [], def: 1, label: 'Opacity' },
  blur: { kind: 'filter', unit: 'px', units: ['px', 'em', 'rem'], def: 0, label: 'Blur' },
  brightness: { kind: 'filter', unit: '', units: [], def: 1, label: 'Brightness' },
  saturate: { kind: 'filter', unit: '', units: [], def: 1, label: 'Saturate' },
  bgColor: { kind: 'color', css: 'backgroundColor', unit: '', units: [], def: '#00000000', label: 'Background' },
  textColor: { kind: 'color', css: 'color', unit: '', units: [], def: '#00000000', label: 'Text color' },
  borderColor: { kind: 'color', css: 'borderColor', unit: '', units: [], def: '#00000000', label: 'Border color' },
  width: { kind: 'size', css: 'width', unit: 'px', units: LENGTH_UNITS, def: 0, label: 'Width' },
  height: { kind: 'size', css: 'height', unit: 'px', units: LENGTH_UNITS, def: 0, label: 'Height' },
  // clip-path inset: how far each edge is pulled IN, as a percentage of the box.
  // clipBottom 100 → 0 is the classic wipe-up reveal.
  clipTop: { kind: 'clip', unit: '%', units: ['%', 'px'], def: 0, label: 'Clip top' },
  clipRight: { kind: 'clip', unit: '%', units: ['%', 'px'], def: 0, label: 'Clip right' },
  clipBottom: { kind: 'clip', unit: '%', units: ['%', 'px'], def: 0, label: 'Clip bottom' },
  clipLeft: { kind: 'clip', unit: '%', units: ['%', 'px'], def: 0, label: 'Clip left' },
  // The ONE track that writes TEXT rather than style: a number counting up to
  // the value the element already says. `kind: 'text'` is what keeps it out of
  // composeMotionStyle, initialStyle and endStyle — see sampleText for why the
  // last two matter more than they look.
  count: { kind: 'text', unit: '', units: [], def: 0, label: 'Count' },
}

/** stable property order so composed transform/filter strings never jitter */
const TRANSFORM_ORDER = ['x', 'y', 'rotate', 'scale']
const FILTER_ORDER = ['blur', 'brightness', 'saturate']
const CLIP_ORDER = ['clipTop', 'clipRight', 'clipBottom', 'clipLeft']
const COLOR_PROPS = ['bgColor', 'textColor', 'borderColor']
const SIZE_PROPS = ['width', 'height']

const c1 = 1.70158
const c3 = c1 + 1
const c4 = (2 * Math.PI) / 3

/** Easing functions, all f(0)=0 f(1)=1. Keys are what a step stores. */
export const EASINGS = {
  linear: (t) => t,
  'ease-in': (t) => t * t * t,
  'ease-out': (t) => 1 - Math.pow(1 - t, 3),
  'ease-in-out': (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  'quad-in': (t) => t * t,
  'quad-out': (t) => 1 - (1 - t) * (1 - t),
  'quart-in': (t) => t * t * t * t,
  'quart-out': (t) => 1 - Math.pow(1 - t, 4),
  'quart-in-out': (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  'back-out': (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  'elastic-out': (t) =>
    t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1,
  'bounce-out': (t) => {
    const n1 = 7.5625
    const d1 = 2.75
    if (t < 1 / d1) return n1 * t * t
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
    return n1 * (t -= 2.625 / d1) * t + 0.984375
  },
}

export const EASING_KEYS = Object.keys(EASINGS)

/** the key a binding fires under; `@scope` isolates component instances and
 * collection-list repeats (the scope string may compose several parts) */
export function animationBindingKey(bindingId, scope) {
  return scope ? `${bindingId}@${scope}` : bindingId
}

/**
 * The key a CLICK animation's play is held under: one per (animation, target)
 * within a scope, so an "open" button and a "close" button drive ONE timeline
 * and agree on where it is. The exact counterpart of `interactionStateKey`
 * (lib/shared/interactionKeys.js) — the same reasoning, the other engine.
 *
 * ONLY `click` uses it. `load`, `appear` and `scrub` have no state for a second
 * trigger to join. `hover` is deliberately excluded too: it is symmetric, so
 * sharing one play would make hovering a second trigger RESTART the timeline
 * from zero under the first one's pointer, and leaving either would rewind it
 * while the other is still hovered. Independent plays per hover trigger are the
 * correct reading of a symmetric gesture.
 *
 * @param {string} animationId
 * @param {string} targetId the node the timeline moves (never null — callers
 *   resolve `binding.targetId ?? ownerId` first)
 * @param {string} [scope] component instance + collection-list repeat isolation
 * @returns {string}
 */
export function animationStateKey(animationId, targetId, scope) {
  const base = `${animationId}:${targetId}`
  return scope ? `${base}@${scope}` : base
}

/** what a click does to the play it drives. `toggle` is the default. */
export const ANIMATION_ACTIONS = ['toggle', 'on', 'off']

/**
 * The play key for a binding, whichever kind it is — the ONE place the choice
 * is made, shared by the editor, the exporter and the published runtime so a
 * click bound in the canvas and the same click on the site cannot disagree.
 * @param {{id: string, animationId: string, trigger: string}} binding
 * @param {string} targetId resolved target (`binding.targetId ?? ownerId`)
 * @param {string} [scope]
 * @returns {string}
 */
export function animationPlayKey(binding, targetId, scope) {
  return binding.trigger === 'click'
    ? animationStateKey(binding.animationId, targetId, scope)
    : animationBindingKey(binding.id, scope)
}

/**
 * Desktop-first breakpoint resolution — the tightest breakpoint still covering
 * `width`, else the widest. Mirrors breakpointIdForWidth in src/lib/responsive.ts
 * (canonical); duplicated here so the site runtime needs no TS import.
 * @param {{id: string, w: number}[]} bps
 * @param {number} width
 * @returns {string}
 */
export function motionBreakpointId(bps, width) {
  if (!bps || !bps.length) return ''
  const asc = bps.slice().sort((a, b) => a.w - b.w)
  for (let i = 0; i < asc.length; i++) if (width <= asc[i].w) return asc[i].id
  return asc[asc.length - 1].id
}

// ---------- values and units ----------

const NUMBER_UNIT_RE = /^\s*(-?\d+(?:\.\d+)?)\s*([a-z%]*)\s*$/i

/**
 * Splits a track value into a number and a unit. Numbers adopt the property's
 * default unit; strings carry their own. Returns null when unparseable.
 * @param {number|string} value
 * @param {string} prop
 * @returns {{n: number, unit: string}|null}
 */
export function parseTrackValue(value, prop) {
  const meta = MOTION_PROPS[prop]
  if (!meta) return null
  if (typeof value === 'number') {
    return isFinite(value) ? { n: value, unit: meta.unit } : null
  }
  if (typeof value !== 'string') return null
  const m = NUMBER_UNIT_RE.exec(value)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!isFinite(n)) return null
  const unit = m[2] || meta.unit
  // a unitless property never accepts one; others must use an allowed unit
  if (!meta.units.length) return m[2] ? null : { n, unit: '' }
  return meta.units.indexOf(unit) === -1 ? null : { n, unit }
}

/**
 * The number an element's authored TEXT says — a `count` track's REAL
 * destination. The inverse of sampleText, so `format` decides how it reads:
 * with `decimals`, the LAST separator is the decimal point and every earlier
 * one is grouping; without, every separator is grouping.
 *
 * Why this exists: `to` lives on the shared Animation in project.animations,
 * so ONE compiled track serves every binding and every component instance. A
 * count bound on a component master therefore ended all four stat cards on the
 * master's number (12 / 12 / 12 / 12 instead of 12 / 99 / 11 / 140) while the
 * exported HTML held the right numbers — initialStyle never bakes a count, so
 * the markup was correct and the first frame overwrote it. The element's own
 * text is the only per-instance value there is.
 *
 * DELIBERATELY STRICT: anything that is not part of a formatted number makes
 * this return null, and the authored `track.to` stands. Stripping stray words
 * would silently reinterpret "12 months" as 12 and a container's concatenated
 * text as whatever digit came first; falling back keeps today's behaviour for
 * every text this cannot read with certainty. A text that holds a number the
 * track disagrees with is reported instead — see countTargetError.
 *
 * @param {string} text the element's authored content
 * @param {{decimals?: number, group?: boolean, prefix?: string, suffix?: string}} [format]
 * @returns {number|null} null when the text holds no readable number
 */
export function parseCountText(text, format) {
  if (typeof text !== 'string') return null
  const f = format || {}
  let s = text.trim()
  const prefix = typeof f.prefix === 'string' ? f.prefix : ''
  const suffix = typeof f.suffix === 'string' ? f.suffix : ''
  if (prefix && s.slice(0, prefix.length) === prefix) s = s.slice(prefix.length)
  if (suffix && suffix.length <= s.length && s.slice(s.length - suffix.length) === suffix) {
    s = s.slice(0, s.length - suffix.length)
  }
  // Intl writes U+2212 for a minus and groups with a space in several locales
  // (U+00A0 in fr-FR, U+202F in fr-CA, U+2009 in some others) — all noise here
  s = s.replace(/−/g, '-').replace(/[\s   ']/g, '')
  if (!s || /[^\d.,-]/.test(s)) return null
  const decimals = typeof f.decimals === 'number' && f.decimals > 0 ? Math.min(20, f.decimals) : 0
  const cut = decimals > 0 ? Math.max(s.lastIndexOf('.'), s.lastIndexOf(',')) : -1
  s =
    cut === -1
      ? s.replace(/[.,]/g, '')
      : `${s.slice(0, cut).replace(/[.,]/g, '')}.${s.slice(cut + 1).replace(/[.,]/g, '')}`
  if (!/^-?(?:\d+|\d*\.\d+)$/.test(s)) return null
  const n = parseFloat(s)
  return isFinite(n) ? n : null
}

/**
 * The per-element `to` override a compiled timeline needs on an element whose
 * text reads `text`: `{count: n}`, or undefined when the timeline holds no
 * count or the text holds no number (then the authored `to` stands).
 *
 * Pass the result as `sampleValues(..., {to})`. Every surface does: the
 * published runtime reads the element's textContent once, the canvas and Play
 * use the per-instance resolved content they already hold.
 *
 * @param {{tracks: any[]}} compiled
 * @param {string} text
 * @returns {Record<string, number>|undefined}
 */
export function countToFor(compiled, text) {
  if (!compiled || !compiled.tracks) return undefined
  let out
  for (const track of compiled.tracks) {
    const meta = MOTION_PROPS[track.prop]
    if (!meta || meta.kind !== 'text') continue
    const n = parseCountText(text, track.format)
    if (n === null) continue
    out = out || {}
    out[track.prop] = n
  }
  return out
}

const round = (n) => Math.round(n * 1000) / 1000

// ---------- color ----------

/** '#rgb' | '#rrggbb' | '#rrggbbaa' → [r,g,b,a] (a in 0..1); null if unparseable */
export function parseColor(value) {
  if (typeof value !== 'string') return null
  const hex = value.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null
  if (hex.length === 3) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
      1,
    ]
  }
  if (hex.length === 6 || hex.length === 8) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    ]
  }
  return null
}

/**
 * interpolates two colors, premultiplying nothing — plain channel lerp.
 * Falls back to the destination when either side is unparseable.
 * @returns {string} an rgba() string
 */
export function lerpColor(from, to, t) {
  const a = parseColor(from)
  const b = parseColor(to)
  if (!a || !b) return typeof to === 'string' ? to : ''
  const mix = (i) => Math.round(a[i] + (b[i] - a[i]) * t)
  const alpha = a[3] + (b[3] - a[3]) * t
  return `rgba(${mix(0)}, ${mix(1)}, ${mix(2)}, ${round(alpha)})`
}

// ---------- compile ----------

const num = (v, fallback) => (typeof v === 'number' && isFinite(v) ? v : fallback)

/**
 * Flattens an Animation's steps into absolute-timed tracks.
 * A step starts at the previous step's END plus its `offset` (negative
 * overlaps). `duration` is the timeline length ignoring infinite repeats, so
 * scrub mapping stays finite.
 *
 * @param {{steps?: any[]}} animation
 * @returns {{tracks: any[], duration: number}}
 */
export function compileAnimation(animation) {
  const tracks = []
  let cursor = 0
  let end = 0
  const steps = (animation && animation.steps) || []
  for (let s = 0; s < steps.length; s++) {
    const step = steps[s]
    const duration = Math.max(0, num(step.duration, 0))
    const start = Math.max(0, cursor + num(step.offset, 0))
    const repeat = num(step.repeat, 0)
    const iterations = repeat < 0 ? Infinity : repeat + 1
    // one iteration's worth of time, used for scrub/finite length
    const span = duration * (repeat < 0 ? 1 : iterations)
    const easing = EASINGS[step.easing] ? step.easing : 'ease-out'
    const stagger = Math.max(0, num(step.stagger, 0))
    for (const track of step.tracks || []) {
      if (!MOTION_PROPS[track.prop]) continue
      tracks.push({
        prop: track.prop,
        from: track.from,
        to: track.to,
        format: track.format,
        start,
        duration,
        easing,
        stagger,
        // a selector narrows a staggered track to matching descendants
        staggerSelector: stagger > 0 ? step.staggerSelector || '' : '',
        repeat: iterations,
        yoyo: !!step.yoyo,
        stepIndex: s,
      })
    }
    cursor = start + duration
    end = Math.max(end, start + span)
  }
  return { tracks, duration: end }
}

/**
 * Splits a compiled timeline into the part that moves the ELEMENT and the part
 * that cascades over its children. Without this, one staggered step would drag
 * every other step onto the children too.
 * @param {{tracks: any[], duration: number}} compiled
 * @returns {{element: object, staggered: object, hasStagger: boolean, selector: string}}
 */
export function splitByStagger(compiled) {
  const element = []
  const staggered = []
  let selector = ''
  for (const track of compiled.tracks) {
    if (track.stagger > 0) {
      staggered.push(track)
      if (!selector && track.staggerSelector) selector = track.staggerSelector
    } else {
      element.push(track)
    }
  }
  return {
    element: { tracks: element, duration: compiled.duration },
    staggered: { tracks: staggered, duration: compiled.duration },
    hasStagger: staggered.length > 0,
    selector,
  }
}

/** true when the timeline never ends on its own */
export function hasInfinite(compiled) {
  return compiled.tracks.some((t) => t.repeat === Infinity)
}

/**
 * The time to rewind from. An infinite loop that ran for minutes must not play
 * backwards for minutes — fold it into the current cycle first.
 * @param {{tracks: any[], duration: number}} compiled
 * @param {number} t
 * @returns {number}
 */
export function foldReverseTime(compiled, t) {
  if (t <= 0) return 0
  const span = compiled.duration
  if (span <= 0) return 0
  if (hasInfinite(compiled)) return t % span
  return t > span ? span : t
}

/** local progress 0..1 of one track at absolute time `t`, or null when the
 * track hasn't started (so earlier values don't leak) */
function trackProgress(track, t, childIndex) {
  const start = track.start + track.stagger * childIndex
  if (t < start) return null
  if (track.duration <= 0) return 1
  const elapsed = t - start
  const total = track.duration * track.repeat
  // finished: settle on the final iteration's end value
  if (elapsed >= total) {
    const lastIsReverse = track.yoyo && track.repeat !== Infinity && track.repeat % 2 === 0
    return lastIsReverse ? 0 : 1
  }
  const iteration = Math.floor(elapsed / track.duration)
  const local = (elapsed % track.duration) / track.duration
  return track.yoyo && iteration % 2 === 1 ? 1 - local : local
}

/**
 * Samples a compiled animation at time `t` (ms) into per-property VALUES —
 * `{n, unit}` for numerics, `{color}` for colors. Keeping values separate from
 * CSS lets a caller merge several plays per property before composing, so a
 * marquee's x and an entrance's y can share one element.
 *
 * `current` supplies measured values for tracks that omit `from`.
 *
 * `to` supplies per-ELEMENT destinations, which is what `current` is for the
 * other end of the tween. One compiled timeline serves every binding and every
 * component instance, so a `count` — whose destination is the number each
 * element already says — has nowhere else to come from (see countToFor).
 *
 * @param {{tracks: any[], duration: number}} compiled
 * @param {number} t
 * @param {{childIndex?: number, current?: Record<string, any>, to?: Record<string, number>}} [opts]
 * @returns {Record<string, {n?: number, unit?: string, color?: string}>}
 */
export function sampleValues(compiled, t, opts) {
  const childIndex = (opts && opts.childIndex) || 0
  const current = (opts && opts.current) || {}
  const override = (opts && opts.to) || {}
  const values = {}
  for (const track of compiled.tracks) {
    const p = trackProgress(track, t, childIndex)
    if (p === null) continue
    const meta = MOTION_PROPS[track.prop]
    const eased = EASINGS[track.easing](p)
    if (meta.kind === 'color') {
      const from =
        track.from !== undefined && track.from !== null
          ? track.from
          : current[track.prop] !== undefined
            ? current[track.prop]
            : meta.def
      values[track.prop] = { color: lerpColor(from, track.to, eased) }
      continue
    }
    // the destination decides the unit; `from` is read in the same unit. A
    // per-element override (a count's own text) wins over the shared track.
    const rawTo = override[track.prop] !== undefined ? override[track.prop] : track.to
    const to = parseTrackValue(rawTo, track.prop) || { n: meta.def, unit: meta.unit }
    let fromVal
    if (track.from !== undefined && track.from !== null) {
      fromVal = parseTrackValue(track.from, track.prop)
    } else if (current[track.prop] !== undefined) {
      fromVal = parseTrackValue(current[track.prop], track.prop)
    }
    // a measured/absent `from` in a different unit can't be interpolated —
    // fall back to the property's neutral value in the destination's unit
    const fromN = fromVal && fromVal.unit === to.unit ? fromVal.n : fromVal ? fromVal.n : meta.def
    values[track.prop] = { n: fromN + (to.n - fromN) * eased, unit: to.unit }
    // the formatting rides with the value so every surface renders the same
    // separators from the same sample
    if (meta.kind === 'text' && track.format) values[track.prop].format = track.format
  }
  return values
}

/**
 * Turns sampled values into a CSS style object (camelCase keys). Composing is
 * separate from sampling so several plays can be merged per property first.
 * @param {Record<string, any>} values
 * @returns {Record<string, string|number>}
 */
export function composeMotionStyle(values) {
  const style = {}
  const txt = (prop) => {
    const v = values[prop]
    return `${round(v.n)}${v.unit || ''}`
  }

  const transforms = []
  for (const prop of TRANSFORM_ORDER) {
    if (values[prop] === undefined) continue
    if (prop === 'x') transforms.push(`translateX(${txt('x')})`)
    else if (prop === 'y') transforms.push(`translateY(${txt('y')})`)
    else if (prop === 'rotate') transforms.push(`rotate(${txt('rotate')})`)
    else transforms.push(`scale(${txt('scale')})`)
  }
  if (transforms.length) style.transform = transforms.join(' ')

  const filters = []
  for (const prop of FILTER_ORDER) {
    if (values[prop] === undefined) continue
    filters.push(`${prop}(${txt(prop)})`)
  }
  if (filters.length) style.filter = filters.join(' ')

  if (values.opacity !== undefined) style.opacity = round(values.opacity.n)
  for (const prop of COLOR_PROPS) {
    if (values[prop] !== undefined) style[MOTION_PROPS[prop].css] = values[prop].color
  }
  for (const prop of SIZE_PROPS) {
    if (values[prop] !== undefined) style[MOTION_PROPS[prop].css] = txt(prop)
  }
  // any clip edge in play means the whole inset() must be written; untouched
  // edges read 0 so the box is only cropped where the animation asks
  if (CLIP_ORDER.some((p) => values[p] !== undefined)) {
    const edges = CLIP_ORDER.map((p) => (values[p] === undefined ? '0%' : txt(p)))
    style.clipPath = `inset(${edges.join(' ')})`
  }
  return style
}

/**
 * The TEXT a `count` track writes at this sample, or undefined when nothing
 * counts. Separate from composeMotionStyle because text is not style: the
 * caller writes `textContent`, not an inline declaration.
 *
 * `format` rides on the track (decimals, grouping, prefix, suffix) and reaches
 * here through the sampled value, so the exporter, the canvas and the
 * published runtime all format identically.
 *
 * @param {Record<string, any>} values
 * @param {string} [locale] BCP-47; the route's language decides the separators
 * @returns {string|undefined}
 */
export function sampleText(values, locale) {
  const v = values && values.count
  if (!v || typeof v.n !== 'number') return undefined
  const f = v.format || {}
  const decimals = typeof f.decimals === 'number' && f.decimals >= 0 ? Math.min(20, f.decimals) : 0
  let body
  try {
    body = new Intl.NumberFormat(locale || undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: !!f.group,
    }).format(v.n)
  } catch {
    // an unusable locale tag must not take the number down with it
    body = v.n.toFixed(decimals)
  }
  return `${f.prefix || ''}${body}${f.suffix || ''}`
}

/**
 * Samples a compiled animation at time `t` into a style object.
 * @returns {Record<string, string|number>}
 */
export function sampleAnimation(compiled, t, opts) {
  return composeMotionStyle(sampleValues(compiled, t, opts))
}

/** the style at the animation's end — what reduced-motion and ?noanim apply */
export function endStyle(compiled, opts) {
  return sampleAnimation(compiled, compiled.duration, opts)
}

/**
 * The state BEFORE anything plays: each property's earliest explicit `from`.
 * Tracks that omit `from` (measured at play time) contribute nothing, since
 * their starting value is whatever the element already renders.
 *
 * The exporter bakes this into the HTML so an appear/load element never paints
 * its final state before the runtime boots.
 *
 * @param {{tracks: any[], duration: number}} compiled
 * @returns {Record<string, string|number>}
 */
export function initialStyle(compiled) {
  const earliest = {}
  const values = {}
  for (const track of compiled.tracks) {
    if (track.from === undefined || track.from === null) continue
    if (earliest[track.prop] !== undefined && earliest[track.prop] <= track.start) continue
    earliest[track.prop] = track.start
    const meta = MOTION_PROPS[track.prop]
    // NEVER bake a count's `from` into the HTML. The exporter writes this into
    // the markup so an entrance does not flash its final state — which for a
    // number would ship `0` as the text that a visitor without JavaScript, and
    // every visitor with reduced motion, reads forever. The authored text IS
    // the final value; the runtime writes the first frame.
    if (meta.kind === 'text') continue
    if (meta.kind === 'color') {
      values[track.prop] = { color: lerpColor(track.from, track.from, 0) }
    } else {
      const v = parseTrackValue(track.from, track.prop)
      if (v) values[track.prop] = v
    }
  }
  return composeMotionStyle(values)
}

/** the CSS properties this engine can write — what a caller must clear */
export const MOTION_CSS_PROPS = [
  'transform',
  'filter',
  'opacity',
  'backgroundColor',
  'color',
  'borderColor',
  'width',
  'height',
  'clipPath',
]

// ---------- validation (shared by the editor and the MCP) ----------

const TRIGGERS = ['load', 'appear', 'scrub', 'hover', 'click', 'scrolled', 'change']
/** `once` is explicit; a binding that omits appearMode inherits the site
 * default (settings.motion.appearMode) — see effectiveAppearMode */
export const APPEAR_MODES = ['once', 'replay', 'reverse']
// conservative: enough for tag/class/id/descendant/attribute selectors, no
// commas-with-parens tricks, and capped so a pathological selector can't ship
const SELECTOR_RE = /^[\w\s.#>~*:+\-[\]="',()]{1,120}$/

const fail = (error) => ({ ok: false, error })

/**
 * @param {any} animation
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateAnimation(animation) {
  if (!animation || typeof animation !== 'object') return fail('animation must be an object')
  if (typeof animation.name !== 'string' || !animation.name.trim()) {
    return fail('animation needs a name')
  }
  if (!Array.isArray(animation.steps) || !animation.steps.length) {
    return fail('animation needs at least one step')
  }
  for (let i = 0; i < animation.steps.length; i++) {
    const step = animation.steps[i]
    const at = `step ${i + 1}`
    if (!step || typeof step !== 'object') return fail(`${at} must be an object`)
    if (!Array.isArray(step.tracks) || !step.tracks.length) {
      return fail(`${at} needs at least one property`)
    }
    if (typeof step.duration !== 'number' || !isFinite(step.duration) || step.duration < 0) {
      return fail(`${at} duration must be a non-negative number of milliseconds`)
    }
    if (typeof step.easing !== 'string' || !EASINGS[step.easing]) {
      return fail(`${at} easing must be one of: ${EASING_KEYS.join(', ')}`)
    }
    if (step.repeat !== undefined && (typeof step.repeat !== 'number' || step.repeat < -1)) {
      return fail(`${at} repeat must be a number (-1 for infinite)`)
    }
    if (step.stagger !== undefined && (typeof step.stagger !== 'number' || step.stagger < 0)) {
      return fail(`${at} stagger must be a non-negative number of milliseconds`)
    }
    if (step.staggerSelector !== undefined) {
      if (typeof step.staggerSelector !== 'string' || !SELECTOR_RE.test(step.staggerSelector)) {
        return fail(`${at} staggerSelector must be a simple CSS selector (max 120 chars)`)
      }
      if (!step.stagger) return fail(`${at} has a staggerSelector but no stagger`)
    }
    for (const track of step.tracks) {
      if (!track || !MOTION_PROPS[track.prop]) {
        return fail(
          `${at} has an unknown property "${track && track.prop}" — use one of: ${Object.keys(MOTION_PROPS).join(', ')}`,
        )
      }
      const meta = MOTION_PROPS[track.prop]
      if (track.to === undefined || track.to === null || track.to === '') {
        return fail(`${at} property "${track.prop}" needs a "to" value`)
      }
      if (meta.kind === 'color') {
        if (!parseColor(track.to)) return fail(`${at} property "${track.prop}" needs a hex color`)
        if (track.from !== undefined && !parseColor(track.from)) {
          return fail(`${at} property "${track.prop}" "from" must be a hex color`)
        }
        continue
      }
      if (meta.kind === 'text') {
        // a staggered step moves the CHILDREN, and a child has no number of
        // its own to count — the track would write the same text into every
        // one of them
        if (step.stagger) {
          return fail(`${at} cannot stagger "${track.prop}" — a staggered step moves the children, which have no number to count`)
        }
        // a number that counts up and then back down is not what anyone means
        // by a counter, and the end state would be the START value
        if (step.yoyo) {
          return fail(`${at} cannot yoyo "${track.prop}" — it would count back down and end on the starting number`)
        }
        if (track.format !== undefined) {
          const f = track.format
          if (typeof f !== 'object' || f === null || Array.isArray(f)) {
            return fail(`${at} property "${track.prop}" format must be an object`)
          }
          if (f.decimals !== undefined && (typeof f.decimals !== 'number' || f.decimals < 0 || f.decimals > 20)) {
            return fail(`${at} property "${track.prop}" format.decimals must be 0–20`)
          }
          if (f.group !== undefined && typeof f.group !== 'boolean') {
            return fail(`${at} property "${track.prop}" format.group must be true or false`)
          }
          for (const k of ['prefix', 'suffix']) {
            if (f[k] !== undefined && (typeof f[k] !== 'string' || f[k].length > 16)) {
              return fail(`${at} property "${track.prop}" format.${k} must be a string of at most 16 characters`)
            }
          }
          for (const k of Object.keys(f)) {
            if (['decimals', 'group', 'prefix', 'suffix'].indexOf(k) === -1) {
              return fail(`${at} property "${track.prop}" format has an unknown key "${k}"`)
            }
          }
        }
      }
      const units = meta.units.length ? ` (units: ${meta.units.join(', ')})` : ' (no unit)'
      const to = parseTrackValue(track.to, track.prop)
      if (!to) return fail(`${at} property "${track.prop}" has an invalid "to" value${units}`)
      if (track.from !== undefined && track.from !== null) {
        const from = parseTrackValue(track.from, track.prop)
        if (!from) return fail(`${at} property "${track.prop}" has an invalid "from" value${units}`)
        // mixing units inside one tween can't be interpolated numerically
        if (typeof track.from === 'string' && typeof track.to === 'string' && from.unit !== to.unit) {
          return fail(
            `${at} property "${track.prop}" mixes units ("${from.unit}" → "${to.unit}") — use the same unit on both sides`,
          )
        }
      }
    }
  }
  return { ok: true }
}

/** does this animation write TEXT — i.e. hold a `count` track? */
export function animationWritesText(animation) {
  for (const step of (animation && animation.steps) || []) {
    for (const track of step.tracks || []) {
      const meta = MOTION_PROPS[track && track.prop]
      if (meta && meta.kind === 'text') return true
    }
  }
  return false
}

/**
 * Where a `count` may land: a LEAF that carries text, not one whose text comes
 * from a collection field, and — when it already says something — a text the
 * track can actually read back.
 *
 * A container has no text of its own to replace — the write would wipe its
 * children — and a field-bound element re-renders from the entry, so the two
 * would fight. Checked at every bind site rather than at play time, because a
 * binding that quietly does nothing is the bug class this whole layer exists
 * to stop.
 *
 * The third check is the `format` one. The element's own text is the
 * destination (parseCountText → sampleValues `to`), so a `format` that cannot
 * read that text back silently falls through to the authored `track.to` and the
 * number lands on something the author never wrote. Comparing the rendered END
 * STATE with the authored text catches both halves of that in one go: a format
 * that does not round-trip, and a text that holds no number at all. Skipped
 * when the element has no text yet, because binding before writing the copy is
 * an ordinary order of work.
 *
 * @param {any} animation the library timeline being bound
 * @param {{type?: string, isLeaf?: boolean, isBound?: boolean, text?: string,
 *   locale?: string}|null} target the element the animation MOVES (the
 *   binding's target, not its trigger)
 * @returns {string|null} the refusal, or null
 */
export function countTargetError(animation, target) {
  if (!animationWritesText(animation)) return null
  if (!target) return null // a channel target: no one element to check
  if (!target.isLeaf) {
    return (
      `a 'count' track writes the element's TEXT, and '${target.type || 'this element'}' is a ` +
      'container — bind it to a leaf that carries words (a span, a heading, a paragraph)'
    )
  }
  if (target.isBound) {
    return (
      "a 'count' track writes the element's TEXT, but this element's text comes from a " +
      'collection field — the two would fight. Count a plain element beside it.'
    )
  }
  const text = typeof target.text === 'string' ? target.text.trim() : ''
  if (text) {
    const compiled = compileAnimation(animation)
    const end = sampleText(
      sampleValues(compiled, compiled.duration, { to: countToFor(compiled, text) }),
      target.locale || undefined,
    )
    // Compared with the separators normalized, exactly as parseCountText reads
    // them: Intl groups with U+202F/U+00A0 and writes U+2212 for a minus, and
    // nobody types those. A space-for-space difference is not a bug worth
    // refusing a bind over — a different NUMBER is.
    const norm = (s) => s.replace(/−/g, '-').replace(/[\s   ]/g, '')
    if (end !== undefined && norm(end) !== norm(text)) {
      return (
        `a 'count' track would end on "${end}", but this element says "${text}" — the element's ` +
        'own text is what it counts up to, so make the track\'s "to" and "format" ' +
        `(decimals, group, prefix, suffix) read "${text}" back, or fix the text`
      )
    }
  }
  return null
}

/**
 * @param {any} binding
 * @param {{animationIds?: string[]}} [ctx]
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateBinding(binding, ctx) {
  if (!binding || typeof binding !== 'object') return fail('binding must be an object')
  if (typeof binding.animationId !== 'string' || !binding.animationId) {
    return fail('binding needs an animationId')
  }
  const known = ctx && ctx.animationIds
  if (known && known.indexOf(binding.animationId) === -1) {
    return fail(`no animation "${binding.animationId}" in the library`)
  }
  if (TRIGGERS.indexOf(binding.trigger) === -1) {
    return fail(`trigger must be one of: ${TRIGGERS.join(', ')}`)
  }
  if (binding.scrollAt !== undefined) {
    if (binding.trigger !== 'scrolled') return fail("scrollAt only applies to the 'scrolled' trigger")
    if (typeof binding.scrollAt !== 'number' || binding.scrollAt < 0) {
      return fail('scrollAt must be a number of pixels')
    }
  }
  if (binding.appearMode !== undefined && APPEAR_MODES.indexOf(binding.appearMode) === -1) {
    return fail(`appearMode must be one of: ${APPEAR_MODES.join(', ')}`)
  }
  if (binding.action !== undefined) {
    if (ANIMATION_ACTIONS.indexOf(binding.action) === -1) {
      return fail(`action must be one of: ${ANIMATION_ACTIONS.join(', ')}`)
    }
    // only a discrete gesture can be aimed. hover rewinds on leave and
    // load/appear/scrub have no second direction to force, so an action there
    // would be a silent no-op that reads like a bug.
    if (binding.action !== 'toggle' && binding.trigger !== 'click') {
      return fail(
        `action is only meaningful on a click trigger ('${binding.trigger}' has no state to aim at)`,
      )
    }
  }
  if (binding.appearAt !== undefined) {
    if (typeof binding.appearAt !== 'number' || binding.appearAt < 0 || binding.appearAt > 1) {
      return fail('appearAt must be a number between 0 and 1 (viewport fraction)')
    }
  }
  if (binding.scrub !== undefined) {
    if (typeof binding.scrub !== 'object' || binding.scrub === null) {
      return fail('scrub must be an object with start/end')
    }
    for (const k of ['start', 'end']) {
      const v = binding.scrub[k]
      if (v !== undefined && (typeof v !== 'number' || !isFinite(v))) {
        return fail(`scrub.${k} must be a number`)
      }
    }
    // optional scroll smoothing: seconds the play lags its scroll target
    // (exponential catch-up). Capped so a typo can't park the site mid-tween.
    const smooth = binding.scrub.smooth
    if (smooth !== undefined && (typeof smooth !== 'number' || !isFinite(smooth) || smooth < 0 || smooth > 3)) {
      return fail('scrub.smooth must be a number of seconds between 0 and 3')
    }
  }
  return { ok: true }
}

/** scrub defaults, in one place so the editor and runtime agree */
export const SCRUB_DEFAULTS = { start: 1, end: 0.25 }

/** appear fires as soon as any pixel enters unless the binding asks for more */
export const APPEAR_AT_DEFAULT = 0

/**
 * The IntersectionObserver rootMargin that makes `appear` wait until the
 * element's top has travelled `appearAt` down the viewport (0.8 ≈ "top 80%").
 * @param {number|undefined} appearAt
 * @returns {string}
 */
export function appearRootMargin(appearAt) {
  const at = typeof appearAt === 'number' ? Math.max(0, Math.min(1, appearAt)) : APPEAR_AT_DEFAULT
  if (!at) return '0px'
  return `0px 0px -${round((1 - at) * 100)}% 0px`
}

/**
 * Progress 0..1 for a scrub binding given the element's viewport position.
 * `top` is getBoundingClientRect().top, `vh` the viewport height. Progress is
 * 0 while the element's top sits at `start * vh` and 1 at `end * vh`.
 */
export function scrubProgress(top, vh, scrub) {
  const p = scrubProgressRaw(top, vh, scrub)
  return p < 0 ? 0 : p > 1 ? 1 : p
}

/**
 * Same mapping WITHOUT the 0..1 clamp. When several scrub bindings tween the
 * same property on one element, the runtime uses the unclamped value to rank
 * them — the binding nearest its active range wins the frame — so chained
 * segments compose instead of the last binding overwriting every frame with
 * its clamped resting value.
 */
export function scrubProgressRaw(top, vh, scrub) {
  const start = (scrub && typeof scrub.start === 'number' ? scrub.start : SCRUB_DEFAULTS.start) * vh
  const end = (scrub && typeof scrub.end === 'number' ? scrub.end : SCRUB_DEFAULTS.end) * vh
  if (start === end) return top <= end ? 1 : 0
  return (start - top) / (start - end)
}

// ---------- site-wide motion (settings.motion) ----------
// Three project-level knobs, all optional and all off by default: the default
// appear replay mode, page enter/exit transitions, and inertia smooth scroll.
// Resolution lives here so the exporter, the editor preview and the MCP
// validators can't disagree about what a given settings object means.

/**
 * A binding's own appearMode wins; omitted means "inherit the site default".
 * Everything unrecognised settles on 'once' — the behaviour before the site
 * default existed.
 * @param {string|undefined} bindingMode
 * @param {string|undefined} siteDefault
 * @returns {'once'|'replay'|'reverse'}
 */
export function effectiveAppearMode(bindingMode, siteDefault) {
  const mode = bindingMode || siteDefault
  return APPEAR_MODES.indexOf(mode) === -1 ? 'once' : mode
}

/** shared constants — never re-spell these as literals in a consumer */
export const TRANSITION_DEFAULTS = {
  preset: 'fade',
  /** enter duration, ms */
  duration: 500,
  easing: 'ease-out',
  /** leaving should feel quicker than arriving */
  exitRatio: 0.75,
  /** hard cap on how long a click may wait for the exit timeline: a broken or
   * infinite custom animation must never strand the visitor on the old page */
  exitTimeoutMs: 1500,
  maxDuration: 5000,
}

/** reserved ids the exporter registers preset timelines under, inside the
 * existing #anim-lib tag — so transitions need no second wire format */
export const TRANSITION_EXIT_ID = '__t-exit'
export const TRANSITION_ENTER_ID = '__t-enter'

/**
 * The built-in exit/enter track pairs, played on the page `body`.
 * Offsets are deliberately small: any transform or filter on body makes it the
 * containing block for `position: fixed` descendants, so a fixed header rides
 * along for the duration of the transition. `fade` avoids that entirely and is
 * the default for exactly that reason.
 */
export const TRANSITION_PRESETS = {
  fade: {
    label: 'Fade',
    exit: [{ prop: 'opacity', from: 1, to: 0 }],
    enter: [{ prop: 'opacity', from: 0, to: 1 }],
  },
  'slide-up': {
    label: 'Slide up',
    exit: [
      { prop: 'y', from: 0, to: -32 },
      { prop: 'opacity', from: 1, to: 0 },
    ],
    enter: [
      { prop: 'y', from: 32, to: 0 },
      { prop: 'opacity', from: 0, to: 1 },
    ],
  },
  'slide-down': {
    label: 'Slide down',
    exit: [
      { prop: 'y', from: 0, to: 32 },
      { prop: 'opacity', from: 1, to: 0 },
    ],
    enter: [
      { prop: 'y', from: -32, to: 0 },
      { prop: 'opacity', from: 0, to: 1 },
    ],
  },
  'slide-left': {
    label: 'Slide left',
    exit: [
      { prop: 'x', from: 0, to: -48 },
      { prop: 'opacity', from: 1, to: 0 },
    ],
    enter: [
      { prop: 'x', from: 48, to: 0 },
      { prop: 'opacity', from: 0, to: 1 },
    ],
  },
  'slide-right': {
    label: 'Slide right',
    exit: [
      { prop: 'x', from: 0, to: 48 },
      { prop: 'opacity', from: 1, to: 0 },
    ],
    enter: [
      { prop: 'x', from: -48, to: 0 },
      { prop: 'opacity', from: 0, to: 1 },
    ],
  },
  zoom: {
    label: 'Zoom',
    exit: [
      { prop: 'scale', from: 1, to: 0.97 },
      { prop: 'opacity', from: 1, to: 0 },
    ],
    enter: [
      { prop: 'scale', from: 1.03, to: 1 },
      { prop: 'opacity', from: 0, to: 1 },
    ],
  },
  blur: {
    label: 'Blur',
    exit: [
      { prop: 'blur', from: 0, to: 8 },
      { prop: 'opacity', from: 1, to: 0 },
    ],
    enter: [
      { prop: 'blur', from: 8, to: 0 },
      { prop: 'opacity', from: 0, to: 1 },
    ],
  },
}

export const TRANSITION_PRESET_IDS = Object.keys(TRANSITION_PRESETS)

/** smooth scroll: how far the viewport closes on its target each 60fps frame */
export const SCROLL_LERP_DEFAULT = 0.1
export const SCROLL_LERP_MIN = 0.02
export const SCROLL_LERP_MAX = 0.4

const clampNum = (v, lo, hi, fallback) =>
  typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback

/**
 * Builds one side of a preset transition as a real Animation, so it flows
 * through compileAnimation/sampleValues like any library timeline.
 * @returns {{id: string, name: string, steps: any[]}|null}
 */
export function buildTransitionAnimation(presetId, dir, duration, easing) {
  const preset = TRANSITION_PRESETS[presetId]
  if (!preset || (dir !== 'exit' && dir !== 'enter')) return null
  const ms = Math.round(dir === 'exit' ? duration * TRANSITION_DEFAULTS.exitRatio : duration)
  return {
    id: dir === 'exit' ? TRANSITION_EXIT_ID : TRANSITION_ENTER_ID,
    name: `${preset.label} ${dir}`,
    steps: [
      {
        id: `${dir}-1`,
        tracks: preset[dir].map((t) => ({ prop: t.prop, from: t.from, to: t.to })),
        duration: ms,
        easing: EASINGS[easing] ? easing : TRANSITION_DEFAULTS.easing,
      },
    ],
  }
}

/**
 * Resolves settings.motion.transitions into the two timelines to play, whether
 * they come from a preset or the project's animation library.
 * @param {any} motion — settings.motion
 * @param {Record<string, any>} [animationsById] — the project animation library
 * @returns {{exit: any|null, enter: any|null}|null} null when disabled/empty
 */
export function resolveTransition(motion, animationsById) {
  const t = motion && motion.transitions
  if (!t || !t.enabled) return null
  const preset = t.preset || TRANSITION_DEFAULTS.preset
  if (preset === 'custom') {
    const lib = animationsById || {}
    const exit = (t.exitAnimationId && lib[t.exitAnimationId]) || null
    const enter = (t.enterAnimationId && lib[t.enterAnimationId]) || null
    return exit || enter ? { exit, enter } : null
  }
  if (!TRANSITION_PRESETS[preset]) return null
  const duration = clampNum(t.duration, 0, TRANSITION_DEFAULTS.maxDuration, TRANSITION_DEFAULTS.duration)
  const easing = t.easing || TRANSITION_DEFAULTS.easing
  return {
    exit: buildTransitionAnimation(preset, 'exit', duration, easing),
    enter: buildTransitionAnimation(preset, 'enter', duration, easing),
  }
}

/** the lerp factor to actually scroll with, clamped; null when disabled */
export function resolveScrollLerp(motion) {
  const s = motion && motion.scroll
  if (!s || !s.enabled) return null
  return clampNum(s.lerp, SCROLL_LERP_MIN, SCROLL_LERP_MAX, SCROLL_LERP_DEFAULT)
}

/**
 * @param {any} motion — a candidate settings.motion
 * @param {{animationIds?: string[]}} [ctx]
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateMotionSettings(motion, ctx) {
  if (motion === undefined || motion === null) return { ok: true }
  if (typeof motion !== 'object' || Array.isArray(motion)) return fail('motion must be an object')
  if (motion.appearMode !== undefined && APPEAR_MODES.indexOf(motion.appearMode) === -1) {
    return fail(`motion.appearMode must be one of: ${APPEAR_MODES.join(', ')}`)
  }
  const t = motion.transitions
  if (t !== undefined && t !== null) {
    if (typeof t !== 'object' || Array.isArray(t)) return fail('motion.transitions must be an object')
    if (typeof t.enabled !== 'boolean') return fail('motion.transitions.enabled must be a boolean')
    if (t.preset !== undefined && t.preset !== 'custom' && !TRANSITION_PRESETS[t.preset]) {
      return fail(`motion.transitions.preset must be "custom" or one of: ${TRANSITION_PRESET_IDS.join(', ')}`)
    }
    if (
      t.duration !== undefined &&
      (typeof t.duration !== 'number' ||
        !isFinite(t.duration) ||
        t.duration < 0 ||
        t.duration > TRANSITION_DEFAULTS.maxDuration)
    ) {
      return fail(`motion.transitions.duration must be between 0 and ${TRANSITION_DEFAULTS.maxDuration} ms`)
    }
    if (t.easing !== undefined && !EASINGS[t.easing]) {
      return fail(`motion.transitions.easing must be one of: ${EASING_KEYS.join(', ')}`)
    }
    const known = ctx && ctx.animationIds
    for (const key of ['exitAnimationId', 'enterAnimationId']) {
      const id = t[key]
      if (id === undefined || id === null) continue
      if (typeof id !== 'string' || !id) return fail(`motion.transitions.${key} must be an animation id`)
      if (known && known.indexOf(id) === -1) return fail(`no animation "${id}" in the library`)
    }
  }
  const s = motion.scroll
  if (s !== undefined && s !== null) {
    if (typeof s !== 'object' || Array.isArray(s)) return fail('motion.scroll must be an object')
    if (typeof s.enabled !== 'boolean') return fail('motion.scroll.enabled must be a boolean')
    if (
      s.lerp !== undefined &&
      (typeof s.lerp !== 'number' ||
        !isFinite(s.lerp) ||
        s.lerp < SCROLL_LERP_MIN ||
        s.lerp > SCROLL_LERP_MAX)
    ) {
      return fail(`motion.scroll.lerp must be between ${SCROLL_LERP_MIN} and ${SCROLL_LERP_MAX}`)
    }
  }
  return { ok: true }
}
