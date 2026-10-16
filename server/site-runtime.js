// SPDX-License-Identifier: MIT — see LICENSE-EXCEPTIONS.md (embedded in exported sites; deliberately not AGPL)
// Guano static-site runtime (~4 KB): interactions.
//
// Interactions replay the editor's triggers by toggling Tailwind classes.
// Semantics mirror src/composables/useInteraction.ts + useRenderNode.ts; key
// identity mirrors src/lib/shared/interactionKeys.js.
//
// STATE IS KEYED BY EFFECT, NOT BY TRIGGER. A state key is
// `interactionId:targetId[@scope]`, so an "open" button, a "close" button and an
// overlay all drive ONE boolean. Keyed by binding id (as this used to be), each
// trigger flipped its own independent flag — so a close button could never undo
// what an open button did, and the to-classes were applied twice. That is what
// made modals unbuildable.
//
// Each element with a `t` list in the manifest has its class list fully
// recomputed from its captured base + the toClasses of every fired state
// targeting it (never token add/remove — shared tokens would clobber).
//
// ONE manifest and ONE attribute: the per-route sidecar `assets/fx-<hash>.js`
// carries everything seven inline islands used to, and `data-fx` is an index
// into its `els`, replacing the escaped JSON that `data-int`/`data-tgt` carried
// per element. Every key in it is a route-local short id. The format is defined
// in src/lib/shared/fxWire.js — this file is served raw and imports nothing, so
// it repeats the global's name.
//
// The sidecar is a DEFERRED script emitted ahead of this one, so by the time
// this runs the global is set; a `fetch` would have made it serial.
;(function () {
  // ---------- interactions ----------
  var man = window.__guanoFx
  if (!man) return
  var els = man.els || []
  var fx = man.fx
  if (!fx) return

  var fired = new Set()
  var noanim = /[?&]noanim\b/.test(location.search)
  // `?resetstate` forgets every remembered `once` state, for the author rather
  // than the visitor: a persisted toggle is restored on load, so the first
  // click of the next session turns it OFF and reads as a broken toggle. The
  // keys are route-local ordinals (see `remember`), so there is no key worth
  // documenting to clear by hand.
  var resetState = /[?&]resetstate\b/.test(location.search)

  // breakpoint-scoped interactions: width→breakpoint map + per-state scope.
  // Absent when nothing is scoped, so gating is a no-op then.
  var bps = (man.bp || []).slice()
  bps.sort(function (a, b) {
    return a.w - b.w
  })
  var fxbp = man.fxbp || {}

  // state key → base classes to REMOVE from the target while fired
  // (same-property conflicts precomputed at export: hidden+flex etc. —
  // without this the cascade picks an arbitrary winner and toggles break)
  var fxrm = man.rm || {}

  // state keys whose effect is a MODAL: while one is on, page scroll is locked,
  // focus is moved into the target and trapped there, and aria-modal is set.
  // Built from classes like every other overlay — a native <dialog> renders
  // nothing until opened, centres itself against the `fixed inset-0 flex`
  // classes every existing overlay is made of, and would need the exclusive
  // group / closeOn model all over again.
  var modalKeys = {}
  ;(man.modal || []).forEach(function (k) {
    modalKeys[k] = 1
  })

  // state keys whose effect draws a dimming BACKDROP behind its target. An
  // overlay built from classes has no backdrop of its own, and the only way to
  // add one was a second element, a second interaction and a second binding
  // aimed at the same state — three things to keep in step for a rectangle.
  // The classes come down the wire (man.scrimc) so this file does not repeat
  // them and shared/interactionClasses.js stays the one definition.
  var scrimKeys = {}
  ;(man.scrim || []).forEach(function (k) {
    scrimKeys[k] = 1
  })
  var scrimc = man.scrimc || {}

  // Every element the manifest has anything to say about.
  //
  // Collected INCREMENTALLY rather than once, because a row the state runtime
  // re-creates from a <template> is a new DOM node carrying an old `data-fx`:
  // built once at load, its trigger would never be wired and its class list
  // would never be recomputed, so a created subtask row came back inert while
  // every other row on the page worked. `seen` is what keeps a rescan from
  // wiring an element twice.
  var seen = new WeakSet()
  var collect = function (root) {
    var found = []
    var scope = root && root.querySelectorAll ? root : document
    var nodes = scope.querySelectorAll('[data-fx]')
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i]
      if (seen.has(el)) continue
      var entry = els[+el.getAttribute('data-fx')]
      if (!entry) continue
      seen.add(el)
      found.push({ el: el, fx: entry })
    }
    return found
  }

  // current breakpoint id for the viewport (mirrors breakpointIdForWidth in
  // src/lib/responsive.ts): tightest bp still covering this width, else widest
  var curBp = ''
  var computeBp = function () {
    if (!bps.length) return ''
    // documentElement.clientWidth, NOT innerWidth: any horizontal overflow
    // inflates innerWidth past the CSS viewport, so a mobile-scoped binding
    // went inert while Tailwind's md: CSS still showed its trigger
    var w = document.documentElement.clientWidth || window.innerWidth
    for (var i = 0; i < bps.length; i++) if (w <= bps[i].w) return bps[i].id
    return bps[bps.length - 1].id
  }
  var allowed = function (k) {
    var set = fxbp[k]
    return !set || set.indexOf(curBp) !== -1
  }

  // getAttribute('class'), never `.className`: on an SVG element `className` is
  // a read-only SVGAnimatedString, so `.split` threw — INSIDE this loop, which
  // killed the whole target list and with it every interaction on the route.
  // An :icon is a void leaf rendering <svg>, so "flip a chevron" was enough.
  var classOf = function (el) {
    return el.getAttribute('class') || ''
  }
  var targets = []
  var collectTargets = function (list) {
    list.forEach(function (e) {
      if (!e.fx.t) return
      var t = {
        el: e.el,
        base: classOf(e.el).split(/\s+/).filter(Boolean),
        keys: e.fx.t,
      }
      targets.push(t)
      // every target element counts as "inside" its own state keys, so clicking
      // within an open menu doesn't dismiss it
      t.keys.forEach(function (k) {
        addInside(k, t.el)
      })
    })
  }

  var apply = function () {
    curBp = computeBp()
    targets.forEach(function (t) {
      var extra = ''
      var rm = null
      t.keys.forEach(function (k) {
        if (fired.has(k) && fx[k] && allowed(k)) {
          extra += ' ' + fx[k]
          if (fxrm[k]) {
            rm = rm || {}
            fxrm[k].split(' ').forEach(function (c) {
              rm[c] = 1
            })
          }
        }
      })
      var base = rm
        ? t.base.filter(function (c) {
            return !rm[c]
          })
        : t.base
      t.el.setAttribute('class', base.join(' ') + extra)
    })
  }

  // resize can move the viewport across breakpoints — re-gate applied classes
  if (Object.keys(fxbp).length) {
    var fxPending = null
    window.addEventListener('resize', function () {
      clearTimeout(fxPending)
      fxPending = setTimeout(apply, 100)
    })
  }

  // ---------- state, groups, dismissal, persistence ----------

  // group key → the one state key currently open in that exclusive group
  var openGroups = {}
  // state keys currently open AND dismissable (value = the closeOn modes)
  var dismissable = {}
  // state key → elements that count as "inside" it (its triggers + its targets)
  var insideEls = {}

  // Per-EFFECT options, collected from every binding that drives a state key.
  // These belong to the effect, not to the trigger that happens to declare
  // them: a close button can carry `closeOn`, and an overlay can carry the
  // group, while the effect they drive is the same one an open button fires.
  // Reading them off the firing trigger's own meta meant a dismissal declared on
  // an `action: "off"` button was never armed — that button never turns the
  // effect ON, which is when dismissal has to be registered.
  var closeOnFor = {} // state key → array of modes
  var groupFor = {} // state key → group key
  var onceFor = {} // state key → 'session' | 'local'

  var collectOptions = function (i) {
    if (i.c && i.c.length) {
      var into = closeOnFor[i.s] || (closeOnFor[i.s] = [])
      for (var n = 0; n < i.c.length; n++) {
        if (into.indexOf(i.c[n]) === -1) into.push(i.c[n])
      }
    }
    if (i.g && !groupFor[i.s]) groupFor[i.s] = i.g
    if (i.o && !onceFor[i.s]) onceFor[i.s] = i.o
  }

  var addInside = function (key, el) {
    ;(insideEls[key] = insideEls[key] || []).push(el)
  }

  // `once`: remember a state so a dismissal sticks. Published site only — the
  // editor always shows the element so it stays authorable.
  var storageFor = function (where) {
    try {
      return where === 'local' ? window.localStorage : window.sessionStorage
    } catch (e) {
      return null // private mode / blocked storage — degrade to not remembering
    }
  }
  var forgetAll = function () {
    var stores = [storageFor('local'), storageFor('session')]
    for (var s = 0; s < stores.length; s++) {
      var store = stores[s]
      if (!store) continue
      try {
        var doomed = []
        for (var i = 0; i < store.length; i++) {
          var k = store.key(i)
          if (k && k.indexOf('guano-int:') === 0) doomed.push(k)
        }
        for (var d = 0; d < doomed.length; d++) store.removeItem(doomed[d])
      } catch (e) {
        /* blocked storage — nothing remembered to forget */
      }
    }
  }
  if (resetState) forgetAll()

  var remember = function (where, key, on) {
    var store = storageFor(where)
    if (store) {
      try {
        store.setItem('guano-int:' + key, on ? '1' : '0')
      } catch (e) {
        /* quota — nothing to do */
      }
    }
  }
  var recall = function (where, key) {
    var store = storageFor(where)
    if (!store) return null
    try {
      var v = store.getItem('guano-int:' + key)
      return v === null ? null : v === '1'
    } catch (e) {
      return null
    }
  }

  // ---------- modal behaviour ----------

  var FOCUSABLE =
    'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),' +
    'select:not([disabled]),textarea:not([disabled]),iframe,object,embed,' +
    '[contenteditable],[tabindex]:not([tabindex="-1"])'
  var openModals = []            // state keys, most recent LAST
  var openerFor = {}             // state key → the element focus returns to
  var addedAria = {}             // state key → the attributes WE set, to undo
  var htmlStyle = null           // the inline overflow/paddingRight we replaced
  var trapInstalled = false

  var modalTargets = function (key) {
    var els = []
    targets.forEach(function (t) {
      if (t.keys.indexOf(key) !== -1) els.push(t.el)
    })
    return els
  }
  var focusablesIn = function (el) {
    var out = []
    el.querySelectorAll(FOCUSABLE).forEach(function (n) {
      if (n.offsetWidth || n.offsetHeight || n.getClientRects().length) out.push(n)
    })
    return out
  }
  var installTrap = function () {
    if (trapInstalled) return
    trapInstalled = true
    // ONE capture-phase listener for every modal: Tab cycles inside the
    // topmost open one, so a background link can never be reached
    document.addEventListener(
      'keydown',
      function (e) {
        if (e.key !== 'Tab' || !openModals.length) return
        var el = modalTargets(openModals[openModals.length - 1])[0]
        if (!el) return
        var items = focusablesIn(el)
        if (!items.length) {
          e.preventDefault()
          return
        }
        var first = items[0]
        var last = items[items.length - 1]
        if (!el.contains(document.activeElement)) {
          e.preventDefault()
          first.focus()
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      },
      true,
    )
  }
  var lockScroll = function () {
    var h = document.documentElement
    if (htmlStyle === null) {
      htmlStyle = { overflow: h.style.overflow, paddingRight: h.style.paddingRight }
      // the scrollbar's width, paid back as padding so the layout does not jump
      var gap = window.innerWidth - h.clientWidth
      h.style.overflow = 'hidden'
      if (gap > 0) h.style.paddingRight = gap + 'px'
    }
    // the attribute is both the state the motion runtime's wheel handler reads
    // (its inertia scroller writes window.scrollTo, so overflow:hidden alone
    // leaves the page moving under the panel) and a CSS hook for authors
    h.setAttribute('data-guano-modal', '')
  }
  var unlockScroll = function () {
    var h = document.documentElement
    if (htmlStyle) {
      h.style.overflow = htmlStyle.overflow
      h.style.paddingRight = htmlStyle.paddingRight
      htmlStyle = null
    }
    h.removeAttribute('data-guano-modal')
  }
  var openModal = function (key) {
    if (openModals.indexOf(key) !== -1) return
    openModals.push(key)
    openerFor[key] = document.activeElement
    lockScroll()
    installTrap()
    var el = modalTargets(key)[0]
    if (!el) return
    var added = []
    if (!el.getAttribute('role')) {
      el.setAttribute('role', 'dialog')
      added.push('role')
    }
    if (!el.getAttribute('aria-modal')) {
      el.setAttribute('aria-modal', 'true')
      added.push('aria-modal')
    }
    if (!el.hasAttribute('tabindex')) {
      el.setAttribute('tabindex', '-1')
      added.push('tabindex')
    }
    addedAria[key] = added
    // the classes land in the same frame; focus after it so the panel is
    // laid out and its first control is really focusable
    requestAnimationFrame(function () {
      var items = focusablesIn(el)
      ;(items[0] || el).focus()
    })
  }
  var closeModal = function (key) {
    var at = openModals.indexOf(key)
    if (at === -1) return
    openModals.splice(at, 1)
    var el = modalTargets(key)[0]
    if (el && addedAria[key]) {
      addedAria[key].forEach(function (name) {
        el.removeAttribute(name)
      })
    }
    delete addedAria[key]
    var opener = openerFor[key]
    delete openerFor[key]
    if (!openModals.length) unlockScroll()
    if (opener && document.contains(opener) && typeof opener.focus === 'function') opener.focus()
  }

  // ---------- the scrim ----------
  //
  // ONE element for every scrim'd effect, created on first use and reused: two
  // overlays open at once share a backdrop, which is what a visitor expects and
  // also what keeps the z-order sane.
  var scrimEl = null
  var scrimOpen = []
  var scrimFor = function () {
    if (scrimEl) return scrimEl
    scrimEl = document.createElement('div')
    scrimEl.setAttribute('data-guano-scrim', '')
    scrimEl.setAttribute('class', (scrimc.base || '') + ' ' + (scrimc.off || ''))
    // a click on the backdrop closes whatever it is behind — the behaviour
    // every visitor already expects of a dimmed page
    scrimEl.addEventListener('click', function () {
      var doomed = scrimOpen.slice()
      for (var i = doomed.length - 1; i >= 0; i--) closeKey(doomed[i])
    })
    document.body.appendChild(scrimEl)
    return scrimEl
  }
  var syncScrim = function () {
    if (!scrimOpen.length) {
      if (scrimEl) scrimEl.setAttribute('class', (scrimc.base || '') + ' ' + (scrimc.off || ''))
      return
    }
    var el = scrimFor()
    // the target sits ABOVE the backdrop: move the scrim to just before the
    // topmost open target, so an author needs no z-index of their own
    var top = modalTargets(scrimOpen[scrimOpen.length - 1])[0]
    if (top && top.parentNode && top.previousElementSibling !== el) {
      top.parentNode.insertBefore(el, top)
    }
    // the off class is on for one frame so the opacity transition has
    // something to move from — set directly, it would simply appear
    requestAnimationFrame(function () {
      el.setAttribute('class', (scrimc.base || '') + ' ' + (scrimc.on || ''))
    })
  }
  var setScrim = function (key, on) {
    var at = scrimOpen.indexOf(key)
    if (on && at === -1) scrimOpen.push(key)
    else if (!on && at !== -1) scrimOpen.splice(at, 1)
    else return
    syncScrim()
  }

  var set = function (key, on) {
    // bookkeeping runs even when the state is unchanged (a second trigger
    // pointing at an already-open effect still has to register its dismissal
    // and claim its group slot); only the class recompute is skipped
    var changed = on !== fired.has(key)
    if (on) fired.add(key)
    else fired.delete(key)

    var group = groupFor[key]
    if (group) {
      if (on) {
        var open = openGroups[group]
        if (open && open !== key) {
          // exclusive group: close whatever else is open in it
          fired.delete(open)
          delete dismissable[open]
          if (modalKeys[open]) closeModal(open)
          if (scrimKeys[open]) setScrim(open, false)
        }
        openGroups[group] = key
      } else if (openGroups[group] === key) {
        delete openGroups[group]
      }
    }

    var modes = closeOnFor[key]
    if (modes) {
      if (on) {
        dismissable[key] = modes
        installDismiss()
      } else {
        delete dismissable[key]
      }
    }

    if (onceFor[key] && changed) remember(onceFor[key], key, on)
    if (changed) apply()
    // AFTER apply(), so the panel already wears its open classes when focus
    // moves into it — focusing a `display: none` element silently does nothing
    if (modalKeys[key]) {
      if (on) openModal(key)
      else closeModal(key)
    }
    if (scrimKeys[key]) setScrim(key, on)
  }

  // --- outside-click / Escape dismissal: one pair of capture-phase listeners,
  // installed the first time a dismissable effect opens ---
  var dismissInstalled = false
  var closeKey = function (key) {
    delete dismissable[key]
    fired.delete(key)
    var group = groupFor[key]
    if (group && openGroups[group] === key) delete openGroups[group]
    if (onceFor[key]) remember(onceFor[key], key, false)
    apply()
    // a dismissal is a close: Escape and an outside click have to give the
    // scroll lock, the aria attributes and the focus back too
    if (modalKeys[key]) closeModal(key)
    if (scrimKeys[key]) setScrim(key, false)
  }
  var installDismiss = function () {
    if (dismissInstalled) return
    dismissInstalled = true
    document.addEventListener(
      'pointerdown',
      function (e) {
        Object.keys(dismissable).forEach(function (key) {
          if (dismissable[key].indexOf('outside') === -1) return
          var els = insideEls[key] || []
          for (var i = 0; i < els.length; i++) {
            if (els[i].contains(e.target)) return // inside the menu/trigger
          }
          closeKey(key)
        })
      },
      true,
    )
    document.addEventListener(
      'keydown',
      function (e) {
        if (e.key !== 'Escape') return
        Object.keys(dismissable).forEach(function (key) {
          if (dismissable[key].indexOf('escape') !== -1) closeKey(key)
        })
      },
      true,
    )
  }


  // ---------- triggers ----------

  // no IntersectionObserver at all: `new IntersectionObserver` throws, which
  // took every other trigger on the page down with it, and the trigger cannot
  // exist anyway — so an appear state simply starts on
  var hasIO = typeof IntersectionObserver !== 'undefined'
  var appear =
    hasIO &&
    new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return
        appear.unobserve(entry.target)
        ;(els[+entry.target.getAttribute('data-fx')].c || []).forEach(function (i) {
          if (i.t === 'appear') set(i.s, true) // fire once, never unfires
        })
      })
    })

  var appearMetas = []
  var scrolledMetas = []
  var triggers = []

  // PASS 1 — collect every trigger and fold its per-effect options together.
  // Options have to be known for ALL bindings before any of them fires, or a
  // `closeOn`/`group`/`once` declared on one trigger would be invisible to the
  // effect when a different trigger opens it.
  var collectTriggers = function (list) {
    var found = []
    list.forEach(function (e) {
      ;(e.fx.c || []).forEach(function (i) {
        addInside(i.s, e.el)
        collectOptions(i)
        var t = { el: e.el, i: i }
        triggers.push(t)
        found.push(t)
      })
    })
    return found
  }

  // PASS 2 — restore remembered states, then wire the listeners. Restoring first
  // means a dismissed popup never flashes open.
  var restoreRemembered = function () {
    Object.keys(onceFor).forEach(function (key) {
      var was = recall(onceFor[key], key)
      if (was !== null) set(key, was)
    })
  }

  // `instant` wires an APPEAR trigger as already-fired instead of observing it.
  // That is what a re-created row needs: the entrance already played for this
  // list, and replaying it per re-render would flash every card on every write.
  // A row whose effect was already fired gets its classes back from apply()
  // for free, since the state key survives the DOM node.
  var wire = function (list, instant) {
    list.forEach(function (entry) {
    var el = entry.el
    var i = entry.i
    if (i.t === 'hover') {
      el.addEventListener('mouseenter', function () {
        set(i.s, true)
      })
      el.addEventListener('mouseleave', function () {
        set(i.s, false)
      })
    } else if (i.t === 'click') {
      el.addEventListener('click', function () {
        // action: 'on' / 'off' force a direction, otherwise toggle. This plus
        // the shared state key is what makes open/close button pairs work.
        set(i.s, i.a === 'on' ? true : i.a === 'off' ? false : !fired.has(i.s))
      })
    } else if (i.t === 'appear') {
      if (instant) {
        set(i.s, true)
      } else {
        appearMetas.push({ i: i, el: el })
        if (hasIO) appear.observe(el)
        else set(i.s, true)
      }
    } else if (i.t === 'load') {
      // on as soon as the page renders, and never off — appear without the
      // wait, for a state the page simply starts in
      set(i.s, true)
    } else if (i.t === 'scrolled') {
      scrolledMetas.push(i)
    } else if (i.t === 'change') {
      var stateOf = function (t) {
        return t.type === 'checkbox' || t.type === 'radio' ? t.checked : !!t.value
      }
      var onChange = function (e) {
        set(i.s, stateOf(e.target))
      }
      el.addEventListener('change', onChange)
      el.addEventListener('input', onChange)
      // A change binding reflects its control's STATE, so read it once NOW and
      // not only when something moves: a radio that ships `checked` fired
      // nothing until you clicked elsewhere, so radio-driven tabs opened with
      // every panel closed. Only when it is already on — turning one OFF here
      // would undo a remembered `once` state restored moments ago.
      if (stateOf(el)) set(i.s, true)
    }
    })
  }

  var initial = collect(document)
  collectTargets(initial)
  var initialTriggers = collectTriggers(initial)
  restoreRemembered()
  wire(initialTriggers, false)

  // 'scrolled': on while the page is scrolled past the threshold — header
  // shrink, back-to-top reveal, sticky-bar states
  if (scrolledMetas.length) {
    var onScroll = function () {
      var y = window.pageYOffset || document.documentElement.scrollTop || 0
      scrolledMetas.forEach(function (i) {
        set(i.s, y > (i.at || 50))
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
  }

  // safety net: appear content starts at its base state (often opacity-0).
  // The observer reveals it on scroll, but if the element never intersects
  // (hidden tab, print, prerender, a browser whose IO misses the initial
  // notification) it would stay invisible. Content is in the DOM either way;
  // this only guarantees it actually renders.
  //
  // The 3s timeout reveals ONLY what is in the viewport already — the set the
  // observer should have reported, and the only set that can be stuck
  // invisible in front of someone. It used to reveal every appear state on the
  // page, so on a long page they all fired at t=3s without a scroll and every
  // reveal below the fold was over before a visitor reached it. ?noanim and
  // printing still reveal the whole document, since neither scrolls it past
  // the observer.
  var revealAll = function (onlyInView) {
    var vh = window.innerHeight
    var vw = window.innerWidth
    // measure first, then set: `set` writes classes, so reading the next rect
    // in the same pass forces a layout per binding
    var due = []
    appearMetas.forEach(function (m) {
      if (onlyInView) {
        var r = m.el.getBoundingClientRect()
        // every edge 0 means no box at all (display:none), which can never
        // intersect — so the observer will never report it and this net is the
        // only thing that will ever turn it on. The common `hidden` → `flex`
        // reveal is exactly that, and cannot be scroll-triggered.
        var boxless = !r.top && !r.bottom && !r.left && !r.right
        if (!boxless && !(r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0)) return
      }
      due.push(m.i.s)
    })
    due.forEach(function (key) {
      set(key, true)
    })
  }
  if (noanim) revealAll(false)
  else if (appearMetas.length && hasIO) {
    setTimeout(function () {
      revealAll(true)
    }, 3000)
    window.addEventListener('beforeprint', function () {
      revealAll(false)
    })
  }

  apply()

  // The hook the state runtime calls after it has moved, created or removed a
  // list row. Nothing else in the published site needs it, and it is set even
  // when no state runtime ships — one assignment is cheaper than the gate.
  //
  // A row is a NEW DOM node wearing an old `data-fx`, so without this its
  // trigger is unwired and its class list is never recomputed: the reason this
  // file's index became incremental at all. `collect` skips what it has already
  // seen, so a rescan over an unchanged page does nothing.
  window.__guanoFxRescan = function () {
    var fresh = collect(document)
    if (fresh.length) {
      collectTargets(fresh)
      wire(collectTriggers(fresh), true)
    }
    // unconditionally: a row that MOVED is an element we have seen, and its
    // class list still has to be recomputed against the states now fired
    apply()
  }
})()

// ---------- forms ----------
//
// Its own IIFE: the interactions block above returns early when a page has no
// `#guano-fx` manifest (or none with an `fx` table), and a page can carry a
// form with no interactions at all.
//
// PROGRESSIVE ENHANCEMENT is the point. The markup already posts natively, so
// a visitor without JS gets a real submission and a 303 back to the site with
// `?form=sent`. This block upgrades that to a fetch, so the page does not
// reload and the values survive an error.
;(function () {
  // A form the author never enabled posts NOWHERE, and the export marks it
  // `data-form-inert` with method="dialog" so the browser abandons the submit
  // with no script at all. This is the belt to those braces, for wherever the
  // runtime ships anyway: an inert form's submit is cancelled outright, so a
  // questionnaire built as a visual mock can never put its answers in the
  // address bar. Before the window's own listener, and before the early
  // return below, which only looks at ENABLED forms.
  var inert = document.querySelectorAll('form[data-form-inert]')
  for (var n = 0; n < inert.length; n++) {
    inert[n].addEventListener('submit', function (e) {
      e.preventDefault()
    })
  }

  var forms = document.querySelectorAll('form[data-form]')
  var landed = /[?&]form=sent\b/.test(location.search)
  if (!forms.length) return

  // how long the visitor had the page open when they submitted. A bot that
  // posts the instant it parses the HTML trips the server's minimum; a
  // constant embedded token could not tell the two apart, because a static
  // page can only ever carry a constant.
  var openedAt = Date.now()

  var show = function (form, which) {
    var block = form.querySelector('[data-form-' + which + ']')
    if (block) block.hidden = false
    return block
  }
  var hideFields = function (form) {
    // everything except the state blocks: the visitor has submitted, so the
    // fields are no longer the thing on screen
    var kids = form.children
    for (var i = 0; i < kids.length; i++) {
      var kid = kids[i]
      if (!kid.hasAttribute('data-form-success') && !kid.hasAttribute('data-form-error')) {
        kid.hidden = true
      }
    }
  }

  Array.prototype.forEach.call(forms, function (form) {
    // a native post that already succeeded comes back as ?form=sent, so the
    // visitor lands on the SITE rather than on a bare JSON response
    if (landed) {
      hideFields(form)
      show(form, 'success')
    }

    form.addEventListener('submit', function (e) {
      if (!window.fetch || !window.FormData) return // let the native post run
      e.preventDefault()
      if (typeof form.reportValidity === 'function' && !form.reportValidity()) return

      var button = form.querySelector('button[type=submit], button:not([type]), input[type=submit]')
      if (button) button.disabled = true
      var errorBlock = form.querySelector('[data-form-error]')
      if (errorBlock) errorBlock.hidden = true

      var body = new URLSearchParams(new FormData(form))
      body.set('_t', String(Date.now() - openedAt))

      fetch(form.getAttribute('action'), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        // no cookie is needed or wanted: the endpoint is public, and sending
        // credentials cross-origin is how a public route becomes a CSRF hole
        credentials: 'omit',
        mode: 'cors',
      })
        .then(function (res) {
          return res.json().then(
            function (data) {
              return { ok: res.ok, status: res.status, data: data }
            },
            function () {
              return { ok: res.ok, status: res.status, data: {} }
            },
          )
        })
        .then(function (r) {
          if (button) button.disabled = false
          if (r.ok && r.data && r.data.ok) {
            // Only ever a ROOT-RELATIVE path. The exporter validates this as an
            // internal route too, but this runtime is served from static hosts
            // we do not control, so it does not trust its own markup: a
            // `javascript:` value would execute here, and an absolute one is an
            // open redirect off the back of a successful submission.
            var to = form.getAttribute('data-form-redirect')
            if (to && to.charAt(0) === '/' && to.charAt(1) !== '/' && to.indexOf('\\') === -1) {
              location.assign(to)
              return
            }
            hideFields(form)
            show(form, 'success')
            return
          }
          // a named field error goes on the field itself, which is where the
          // visitor is looking; everything else shows the error block
          var named = r.data && r.data.field ? form.elements[r.data.field] : null
          if (named && typeof named.setCustomValidity === 'function') {
            named.setCustomValidity(r.data.error || 'Please check this field')
            named.addEventListener(
              'input',
              function () {
                named.setCustomValidity('')
              },
              { once: true },
            )
            if (typeof form.reportValidity === 'function') form.reportValidity()
            return
          }
          var block = show(form, 'error')
          if (!block) {
            // no error block authored: say something rather than nothing, or a
            // failed submission looks exactly like no click at all
            var fallback = document.createElement('p')
            fallback.setAttribute('data-form-fallback', '')
            fallback.textContent =
              r.status === 429
                ? 'Too many submissions — please try again in a minute.'
                : (r.data && r.data.error) || 'Something went wrong. Please try again.'
            form.appendChild(fallback)
          }
        })
        .catch(function () {
          if (button) button.disabled = false
          show(form, 'error')
        })
    })
  })
})()
