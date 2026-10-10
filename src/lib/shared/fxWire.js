/**
 * The published page's effects wire format — the ONE definition of what the
 * exporter writes and the two site runtimes read.
 *
 * It is a COMPILED form, not a serialization of the editor's data model. The
 * editor keys every effect by uuid (`interactionId:targetId@scope`,
 * `bindingId@scope`) because those keys have to mean something across pages,
 * components, undo and a 3-way merge. On a published route a key's only job is
 * to match a trigger to its listener, so every one of them is interned to a
 * short ordinal per route. Serializing the uuids instead cost 23.5% of the
 * exported HTML in identifier characters alone (1,049 occurrences of 389
 * distinct uuids on one real page), and made every attribute unreadable.
 *
 * Two shapes, and they are the whole format:
 *
 * 1. `data-fx="<n>"` on every element that triggers or receives an effect — an
 *    index into the manifest's `els`. It replaces `data-int`, `data-tgt`,
 *    `data-anim` and `data-atgt`, which carried escaped JSON per element: 2,700
 *    `&quot;` sequences on that same page, and the same payload repeated once
 *    per component instance.
 *
 * 2. One **sidecar file** per route, `assets/fx-<hash>.js`, replacing seven
 *    inline islands. It is a `.js` that assigns `window.__guanoFx`, loaded with
 *    `defer` BEFORE the runtimes — deliberately not a `.json` the runtime
 *    fetches. A deferred script is discovered when the document is parsed and
 *    fetched in PARALLEL with `script.js`/`motion.js`, and `defer` guarantees
 *    it executes before them, so the data arrives no later than the runtime
 *    that needs it. A `fetch()` would be serial: nothing could play until it
 *    came back. The name is a content hash, so the file lands on the exported
 *    site's `immutable` cache tier and two routes with identical effects share
 *    one copy. Top-level names are spelled out because each appears once; the
 *    repeated parts inside `els` are single letters because they do not.
 *
 * ```
 * {
 *   els: [                      // indexed by data-fx
 *     {
 *       c: [classTrigger, …],   // this element FIRES these class effects
 *       m: [motionTrigger, …],  // …and these timelines
 *       t: [stateKey, …],       // its class list is driven by these states
 *       a: [bindingKey, …],     // these timelines land on it
 *     },
 *   ],
 *   fx:     { stateKey: "classes to add while fired" },
 *   rm:     { stateKey: "base classes to remove while fired" },
 *   fxbp:   { stateKey: [bpId, …] },     // breakpoint-scoped states
 *   modal:  [stateKey, …],               // states that make their target a dialog
 *   lib:    { animId: {steps} },         // only the timelines this route plays
 *   animbp: { bindingKey: [bpId, …] },
 *   bp:     [{ id: bpId, w: width }],    // every breakpoint, in project order
 *   site:   { t: {x, e}, s: {l} },       // page transitions, smooth scroll
 * }
 * ```
 *
 * A trigger meta keeps the field names it always had (`t` trigger, `k` binding
 * key, `s` state/play key, …) so the runtimes' hot paths are unchanged — only
 * the VALUES are now interned ids.
 *
 * `server/site-runtime.js` is served raw and imports nothing, so it repeats the
 * two literals below. If either changes, change it there too.
 */

export const FX_ATTR = 'data-fx'
/** the global the sidecar assigns, read by both runtimes */
export const FX_GLOBAL = '__guanoFx'

/**
 * The sidecar's content and its content-addressed name. One assignment and no
 * semicolon-sensitive wrapping: the file is a plain statement, so two of them
 * could never interact even if a route somehow loaded both.
 * @param {object} manifest
 * @param {(text: string) => string} hash content hash → hex
 */
export function fxSidecar(manifest, hash) {
  const body = `window.${FX_GLOBAL}=${JSON.stringify(manifest)}`
  return { name: `assets/fx-${hash(body).slice(0, 8)}.js`, body }
}

/** id namespaces — a prefix per kind, so two kinds can never share an id.
 * That matters for `s`/`k`: the motion runtime keys a play by `meta.s || meta.k`,
 * so a play key colliding with a binding key would merge two timelines. */
export const FX_KIND = {
  state: 's',
  binding: 'k',
  play: 'p',
  group: 'g',
  animation: 'a',
  breakpoint: 'b',
}

/**
 * Per-route string → short id. Memoized, so the trigger side and the listener
 * side get the same id however far apart they are emitted, and a channel
 * listener in another tree still matches.
 * @returns {(kind: string, key: string) => string}
 */
export function createInternTable() {
  const seen = new Map()
  const counters = new Map()
  return function intern(kind, key) {
    const slot = kind + '\u0000' + key
    const found = seen.get(slot)
    if (found !== undefined) return found
    const n = (counters.get(kind) ?? -1) + 1
    counters.set(kind, n)
    const id = kind + n.toString(36)
    seen.set(slot, id)
    return id
  }
}

/**
 * A timeline reduced to the fields `compileAnimation` actually reads. The
 * stored shape carries `id` and `name` on the animation and an `id` on every
 * step, none of which the compiler looks at — on a page using 70 timelines
 * (one of them a ten-step odometer) that is kilobytes of uuid the browser
 * parses and throws away.
 *
 * Defaults are omitted rather than written, because `compileAnimation` resolves
 * an absent field to exactly the same value: `num(x, 0)` for offset/stagger/
 * repeat, `!!step.yoyo`, and `''` for staggerSelector. `duration` and `easing`
 * are always written — an absent easing resolves to `ease-out`, which is a real
 * authored value too, so leaving it out would change a timeline that wanted it.
 * @param {any} animation
 */
export function stripTimeline(animation) {
  const steps = []
  for (const step of (animation && animation.steps) || []) {
    const out = { duration: step.duration, easing: step.easing }
    if (step.offset) out.offset = step.offset
    if (step.stagger) {
      out.stagger = step.stagger
      if (step.staggerSelector) out.staggerSelector = step.staggerSelector
    }
    if (step.repeat) out.repeat = step.repeat
    if (step.yoyo) out.yoyo = true
    out.tracks = ((step.tracks || []).map((track) => {
      const t = { prop: track.prop }
      // `to` is optional (a count track takes its destination from the
      // element's own text) and `from`/`to` are legitimately 0, so these test
      // for undefined rather than truthiness
      if (track.from !== undefined) t.from = track.from
      if (track.to !== undefined) t.to = track.to
      if (track.format) t.format = track.format
      return t
    }))
    steps.push(out)
  }
  return { steps }
}
