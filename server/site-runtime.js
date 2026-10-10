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

  // every element the manifest has anything to say about, resolved once
  var entries = []
  document.querySelectorAll('[data-fx]').forEach(function (el) {
    var entry = els[+el.getAttribute('data-fx')]
    if (entry) entries.push({ el: el, fx: entry })
  })

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
  entries.forEach(function (e) {
    if (!e.fx.t) return
    targets.push({
      el: e.el,
      base: classOf(e.el).split(/\s+/).filter(Boolean),
      keys: e.fx.t,
    })
  })

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

  // every target element counts as "inside" its own state keys, so clicking
  // within an open menu doesn't dismiss it
  targets.forEach(function (t) {
    t.keys.forEach(function (k) {
      addInside(k, t.el)
    })
  })

  // ---------- triggers ----------

  var appear = new IntersectionObserver(function (entries) {
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
  entries.forEach(function (e) {
    ;(e.fx.c || []).forEach(function (i) {
      addInside(i.s, e.el)
      collectOptions(i)
      triggers.push({ el: e.el, i: i })
    })
  })

  // PASS 2 — restore remembered states, then wire the listeners. Restoring first
  // means a dismissed popup never flashes open.
  Object.keys(onceFor).forEach(function (key) {
    var was = recall(onceFor[key], key)
    if (was !== null) set(key, was)
  })

  triggers.forEach(function (entry) {
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
      appearMetas.push(i)
      appear.observe(el)
    } else if (i.t === 'load') {
      // on as soon as the page renders, and never off — appear without the
      // wait, for a state the page simply starts in
      set(i.s, true)
    } else if (i.t === 'scrolled') {
      scrolledMetas.push(i)
    } else if (i.t === 'change') {
      var onChange = function (e) {
        var t = e.target
        set(i.s, t.type === 'checkbox' || t.type === 'radio' ? t.checked : !!t.value)
      }
      el.addEventListener('change', onChange)
      el.addEventListener('input', onChange)
    }
  })

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
  // (hidden tab, print, prerender, a crawler that ignores IO) it would stay
  // invisible. Force every appear state on with ?noanim, and otherwise after a
  // 3s fallback timeout — content is in the DOM either way, this only
  // guarantees it actually renders (and makes screenshots deterministic).
  var revealAll = function () {
    appearMetas.forEach(function (i) {
      set(i.s, true)
    })
  }
  if (noanim) revealAll()
  else if (appearMetas.length) setTimeout(revealAll, 3000)

  apply()
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
