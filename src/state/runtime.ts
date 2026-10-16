import {
  createStore,
  applyOp,
  applyDiff,
  storeDiff,
  readField,
  fieldOf,
  coerceFieldValue,
  isTruthyValue,
  stateStorage,
  sameValue,
  refListOf,
  STATE_ATTR,
  STATE_ACTION_ATTR,
  STATE_AGG_ATTR,
  STATE_DRAFT_ATTR,
  STATE_DRAFT_FIELD_ATTR,
  STATE_LIST_ATTR,
  STATE_ROW_ATTR,
  STATE_ROW_ENTRY_ATTR,
  STATE_EMPTY_ATTR,
  STATE_STORAGE_KEY,
  BIND_TEXT,
  BIND_ATTR,
  BIND_VALUE,
} from '@/lib/shared/state.js'
import { applyListQuery, formatFieldValue, aggregateValue } from '@/lib/shared/fields.js'
import { isRich, sanitizeRich } from '@/lib/shared/richtext.js'
import { uid } from '@/lib/shared/ids.js'
import { FX_GLOBAL } from '@/lib/shared/fxWire.js'

interface Read {
  f: string
  k: string
  n?: string
  /** a reference hop: this read's entry is not the row's, so never re-point it */
  h?: number
  /** the display format from the binding path (`due|date:long`) */
  fmt?: string
  /** a select's option labels, carried for a `|label` read */
  lbl?: Record<string, string>
}

interface AggDesc {
  op: string
  /** index into `co` — the collection it counts */
  c: number
  /** the numeric field for sum/avg/min/max; absent for count */
  f?: string
  q?: Record<string, unknown>
  /** index of the entry `excludeCurrent` / `equalsCurrent` compare against */
  cur?: number
}

interface ListDesc {
  /** index into `co`; -1 for a source the store cannot re-query */
  c: number
  /** how many top-level elements one row is */
  k: number
  q?: Record<string, unknown>
  /** the entry index each rendered row carries, in order */
  o?: number[]
  /** a multi-reference source: the field on the current entry holding the ids */
  rf?: string
  /** index of the entry `excludeCurrent` / `equalsCurrent` compare against */
  cur?: number
}

interface ActionMeta {
  t: string
  e?: number
  o: Record<string, unknown>[]
  b?: string[]
}

interface DsWire {
  co: { id: string; n: string; f: Record<string, string> }[]
  en: { id: string; c: number; v: Record<string, string | string[]>; n?: string; ct?: number }[]
  rs: Read[][]
  b: number[][]
  a?: ActionMeta[][]
  l?: ListDesc[]
  g?: AggDesc[]
  p?: 'none' | 'session' | 'local'
}

/** one element's reads, resolved to the entry each one points at */
interface Bound {
  el: Element
  reads: { read: Read; entryId: string; base: string | null }[]
}

const win = window as unknown as Record<string, unknown>
const manifest = win[FX_GLOBAL] as { ds?: DsWire } | undefined
const wire = manifest?.ds

if (wire) start(wire)

function start(ds: DsWire) {
  const store = createStore({ collections: ds.co, entries: ds.en })

  // The published baseline, copied BEFORE anything can extend `en`.
  //
  // `slotFor` pushes a created entry onto `ds.en` so its DOM markers resolve,
  // which would make it part of the baseline a diff is measured against — and
  // a created entry recorded as "an existing entry with some fields changed"
  // is dropped on the next load, because the fresh store has no such entry to
  // apply a delta to. The task appeared, survived until reload, and vanished.
  const baseline = { entries: ds.en.map((e) => ({ id: e.id, v: { ...e.v } })) }

  // `?resetstate` is the author's affordance for every remembered thing on the
  // published site — a persisted toggle and a persisted entry alike — so a
  // prototype demoed twice starts from the same place both times.
  const reset = /[?&]resetstate\b/.test(location.search)
  const storage = stateStorage(ds.p ?? 'session', window)
  if (reset && storage) {
    try {
      storage.removeItem(STATE_STORAGE_KEY)
    } catch (e) {
      /* blocked storage — nothing remembered to forget */
    }
  }

  const bound = indexBound(ds)
  const byEntry = new Map<string, Bound[]>()
  for (const item of bound) track(item)

  function track(item: Bound) {
    for (const { entryId } of item.reads) {
      const list = byEntry.get(entryId)
      if (list) {
        if (list.indexOf(item) === -1) list.push(item)
      } else byEntry.set(entryId, [item])
    }
  }

  function untrack(root: Element) {
    for (const [entryId, list] of byEntry) {
      const kept = list.filter((item) => !root.contains(item.el) && item.el !== root)
      if (kept.length) byEntry.set(entryId, kept)
      else byEntry.delete(entryId)
    }
  }

  /** what applyListQuery needs beyond field values: the name and the date */
  const meta = new Map<string, { name: string; createdAt: number }>()
  for (const e of ds.en) meta.set(e.id, { name: e.n ?? '', createdAt: e.ct ?? 0 })

  /** entry id → its index in `en`, extended as `create` adds entries */
  const slotOf = new Map<string, number>()
  ds.en.forEach((e, i) => slotOf.set(e.id, i))

  /**
   * Give an entry the store learned about at runtime a slot of its own.
   *
   * Every marker in the DOM is an INDEX into `en`, so an entry with no slot
   * stamps `data-ds-e="-1"` — and the next reconcile reads that back as "no
   * entry", drops the row it just built and the created task vanishes one
   * click later. A created entry sorts last by `createdAt`, which is what puts
   * a new row at the end of its list.
   */
  function slotFor(entryId: string) {
    const found = slotOf.get(entryId)
    if (found !== undefined) return found
    const collectionId = store.collectionOf.get(entryId) ?? ''
    const index = ds.en.length
    ds.en.push({
      id: entryId,
      c: ds.co.findIndex((c) => c.id === collectionId),
      v: {},
      n: '',
      ct: Date.now(),
    })
    slotOf.set(entryId, index)
    meta.set(entryId, { name: '', createdAt: Date.now() })
    return index
  }

  // A saved diff is applied before anything is wired, and only the elements it
  // actually moved are re-rendered. The published HTML already carries the
  // baked values, so a route loaded with an empty diff touches no DOM at all —
  // which is the common case and has to stay free.
  //
  // TRADE-OFF: this is a deferred script, so it runs once the document is
  // parsed, and a browser may already have painted the baked value. Applying it
  // earlier would mean a blocking script in <head> on every stateful route,
  // which costs every visitor a round trip to spare a one-frame flash on the
  // routes that have a diff at all.
  /**
   * Restore a saved diff.
   *
   * Run LAST, once the lists are indexed, because restoring is not only a
   * re-render: a status changed on another route moves a card to another
   * column, and a task created on another route has no row on this one at all.
   * Called before the lists were indexed, it repainted the bound leaves and
   * left every row where the export put it — so a board loaded fresh showed
   * the old columns with the new labels.
   */
  function restore() {
    if (reset || !storage) return
    let saved = null
    try {
      saved = JSON.parse(storage.getItem(STATE_STORAGE_KEY) || 'null')
    } catch (e) {
      saved = null
    }
    if (!saved) return
    const touched = applyDiff(store, saved)
    if (!touched.length) return
    // seed the sort keys BEFORE anything re-queries: candidatesFor reads `meta`,
    // and a restored entry missing from it sorts as the oldest in its collection
    for (const [id, entry] of Object.entries(
      (saved.n ?? {}) as Record<string, { ct?: number }>,
    )) {
      if (store.values.has(id)) meta.set(id, { name: '', createdAt: entry.ct ?? 0 })
    }
    renderEntries(touched)
    relist()
    reaggregate()
  }

  function renderEntries(ids: string[]) {
    const seen = new Set<Bound>()
    for (const id of ids) {
      for (const item of byEntry.get(id) ?? []) {
        if (seen.has(item)) continue
        seen.add(item)
        renderBound(item)
      }
    }
    if (seen.size) rescan()
  }

  function renderBound(item: Bound) {
    for (const { read, entryId, base } of item.reads) {
      const value = readField(store, entryId, read.f)
      const raw = Array.isArray(value) ? value.join(', ') : (value ?? '')
      // the same formatter the first paint used — a `status|label` pill must
      // not flip to its raw value the moment an action changes it
      const text = read.fmt
        ? formatFieldValue(
            raw,
            { type: fieldOfRead(read)?.type, optionLabels: read.lbl },
            read.fmt,
            document.documentElement.lang || undefined,
          )
        : raw
      if (read.k === BIND_TEXT) {
        // the SAME sanitizer the initial render used: an entry value is written
        // by a site user, so a re-render is no more trusted than a publish.
        // Plain text goes through textContent, which cannot parse markup at all.
        if (isRich(text)) item.el.innerHTML = sanitizeRich(text)
        else item.el.textContent = text
      } else if (read.k === BIND_ATTR && read.n) {
        // an empty field falls back to whatever the element was published with,
        // exactly as resolveFieldAttrs does — the static value is the author's
        // fallback, not a leftover
        if (text) item.el.setAttribute(read.n, text)
        else if (base !== null) item.el.setAttribute(read.n, base)
        else item.el.removeAttribute(read.n)
      } else if (read.k === BIND_VALUE) {
        writeControl(item.el, read, text)
      }
    }
  }

  function writeControl(el: Element, read: Read, text: string) {
    const input = el as HTMLInputElement
    const type = (input.getAttribute('type') || '').toLowerCase()
    if (type === 'checkbox' || type === 'radio') {
      const field = fieldOfRead(read)
      input.checked =
        field?.type === 'boolean' ? isTruthyValue(text) : input.value === text
      return
    }
    if (input.value !== text) input.value = text
  }

  function fieldOfRead(read: Read) {
    for (const col of ds.co) if (col.f[read.f]) return { name: read.f, type: col.f[read.f] }
    return null
  }

  /** hand re-created and restyled rows back to the interaction runtime */
  function rescan() {
    const hook = win.__guanoFxRescan
    if (typeof hook === 'function') (hook as () => void)()
  }

  function persist() {
    if (!storage) return
    try {
      storage.setItem(STATE_STORAGE_KEY, JSON.stringify(storeDiff(store, baseline, (id) => meta.get(id)?.createdAt ?? 0)))
    } catch (e) {
      /* quota — the prototype still works, it just forgets */
    }
  }

  // ---------- draft scopes ----------
  //
  // An input inside `data-ds-draft` is bound to a field of a collection with no
  // entry yet, so there is nothing in the store to write. Its value is held
  // here until a `create` op names the scope and commits it.
  const drafts = new Map<string, Map<string, string>>()
  const draftInputs = new Map<string, Element[]>()

  function draftScopeOf(el: Element): string | null {
    const host = el.closest(`[${STATE_DRAFT_ATTR}]`)
    return host ? host.getAttribute(STATE_DRAFT_ATTR) : null
  }

  function readDraft(name: string) {
    return Object.fromEntries(drafts.get(name) ?? [])
  }

  function clearDraft(name: string) {
    drafts.delete(name)
    for (const el of draftInputs.get(name) ?? []) {
      const input = el as HTMLInputElement
      if (input.type === 'checkbox' || input.type === 'radio') input.checked = false
      else input.value = ''
    }
  }

  // ---------- two-way controls ----------
  for (const item of bound) {
    for (const entry of item.reads) {
      if (entry.read.k !== BIND_VALUE) continue
      wireControl(item.el, entry.read, entry.entryId)
    }
  }
  // a control in a draft scope has no entry, so it never reaches `bound` —
  // it is found by its own binding attribute instead
  document.querySelectorAll(`[${STATE_DRAFT_ATTR}] [${STATE_DRAFT_FIELD_ATTR}]`).forEach((el) => {
    const name = draftScopeOf(el)
    const field = el.getAttribute(STATE_DRAFT_FIELD_ATTR)
    if (!name || !field) return
    const list = draftInputs.get(name)
    if (list) list.push(el)
    else draftInputs.set(name, [el])
    const read = () => {
      const input = el as HTMLInputElement
      const value =
        input.type === 'checkbox' ? (input.checked ? 'true' : 'false') : input.value
      const map = drafts.get(name) ?? new Map()
      map.set(field, value)
      drafts.set(name, map)
    }
    el.addEventListener('input', read)
    el.addEventListener('change', read)
  })

  function wireControl(el: Element, read: Read, entryId: string) {
    const write = () => {
      const input = el as HTMLInputElement
      const raw =
        input.type === 'checkbox' ? (input.checked ? 'true' : 'false') : input.value
      const field = fieldOf(store, entryId, read.f)
      const next = coerceFieldValue(field, raw)
      const values = store.values.get(entryId)
      if (!values || sameValue(values[read.f], next)) return
      values[read.f] = next as string
      changed([entryId])
    }
    el.addEventListener('change', write)
  }

  // ---------- actions ----------
  const actions = ds.a ?? []
  function wireActionsIn(root: ParentNode | Element) {
    const found = Array.prototype.slice.call(
      root.querySelectorAll(`[${STATE_ACTION_ATTR}]`),
    ) as Element[]
    if ((root as Element).getAttribute?.(STATE_ACTION_ATTR) !== null && (root as Element).hasAttribute?.(STATE_ACTION_ATTR)) {
      found.unshift(root as Element)
    }
    for (const el of found) {
      const list = actions[Number(el.getAttribute(STATE_ACTION_ATTR))]
      if (!list) continue
      for (const meta of list) wireAction(el, meta)
    }
  }
  wireActionsIn(document)

  function wireAction(el: Element, meta: ActionMeta) {
    // The row WINS over the index baked at export.
    //
    // A row the runtime builds is a clone of the template, so its trigger
    // carries the template's `data-ds-act` — whose entry is whichever entry
    // the template happened to be rendered from. Resolved from that index, a
    // card that migrated columns would write the FIRST card's entry: the move
    // appeared to work once and then rewrote someone else's task. The row's
    // own `data-ds-e` is the live truth, and it is re-stamped on every build.
    //
    // Read at FIRE time, not here: a row can be moved, and re-stamped, between
    // wiring and the click.
    const rowEntry = () => {
      const row = el.closest(`[${STATE_ROW_ENTRY_ATTR}]`)
      if (row) {
        const found = ds.en[Number(row.getAttribute(STATE_ROW_ENTRY_ATTR))]
        if (found) return found.id
      }
      return meta.e === undefined || meta.e < 0 ? null : (ds.en[meta.e]?.id ?? null)
    }
    const run = () => {
      if (!allowedAt(meta.b)) return
      const touched: string[] = []
      for (const op of meta.o) {
        const name = (op as { from?: string }).from
        const result = applyOp(store, op as never, {
          entryId: rowEntry(),
          draft: name ? readDraft(name) : null,
          newId: uid,
        })
        for (const id of result.changed) touched.push(id)
        if (result.created && name) clearDraft(name)
      }
      if (touched.length) changed(touched)
    }
    if (meta.t === 'click') el.addEventListener('click', run)
    else if (meta.t === 'change') el.addEventListener('change', run)
    else if (meta.t === 'hover') el.addEventListener('mouseenter', run)
    else if (meta.t === 'load') run()
  }

  /** breakpoint gating, read off the same width→id map the other runtimes use */
  function allowedAt(ids: string[] | undefined) {
    if (!ids || !ids.length) return true
    const bps = ((manifest as { bp?: { id: string; w: number }[] } | undefined)?.bp ?? [])
      .slice()
      .sort((a, b) => a.w - b.w)
    if (!bps.length) return true
    const w = document.documentElement.clientWidth || window.innerWidth
    let current = bps[bps.length - 1]!.id
    for (const bp of bps) {
      if (w <= bp.w) {
        current = bp.id
        break
      }
    }
    return ids.indexOf(current) !== -1
  }

  function changed(ids: string[]) {
    renderEntries(ids)
    relist()
    reaggregate()
    persist()
  }

  // ---------- lists ----------
  //
  // A list re-runs its own `listQuery` against the store and reconciles its
  // rows: a task whose status changed migrates to the column whose filter now
  // matches it, a created subtask appears at the end, a deleted one goes.
  //
  // Rows are MOVED where they exist and built from the `<template>` only where
  // they do not, which is what keeps an input's focus, a row's open accordion
  // and its already-played entrance intact when a sibling changes. Rebuilding
  // the whole list would be two lines shorter and would reset all three.
  interface ListHost {
    el: Element
    d: ListDesc
    tpl: HTMLTemplateElement | null
    empty: Element | null
  }
  const hosts: ListHost[] = []
  for (const el of Array.prototype.slice.call(
    document.querySelectorAll(`[${STATE_LIST_ATTR}]`),
  ) as Element[]) {
    const d = (ds.l ?? [])[Number(el.getAttribute(STATE_LIST_ATTR))]
    if (!d) continue
    hosts.push({
      el,
      d,
      tpl: el.querySelector(`template[${STATE_ROW_ATTR}]`),
      empty: el.querySelector(`[${STATE_EMPTY_ATTR}]`),
    })
  }

  // The initial stamp. The exporter ships each list's row order rather than an
  // attribute per row, so this is where a rendered row learns which entry it
  // is — once, before anything can reconcile.
  for (const host of hosts) {
    const order = host.d.o ?? []
    rowsOf(host).forEach((row, i) => {
      const slot = order[i]
      if (slot === undefined || slot < 0 || !row.els.length) return
      row.els[0]!.setAttribute(STATE_ROW_ENTRY_ATTR, String(slot))
    })
  }

  /** the entries a list could render, as objects applyListQuery understands */
  function candidatesFor(d: ListDesc) {
    const collectionId = d.c >= 0 ? ds.co[d.c]?.id : null
    if (!collectionId) return null
    let ids: string[]
    if (d.rf) {
      // a multi-reference source is the current entry's own id list, re-read
      // from the store so appending to it shows up
      const cur = d.cur === undefined ? null : (ds.en[d.cur]?.id ?? null)
      ids = cur ? refListOf(readField(store, cur, d.rf)) : []
    } else {
      ids = []
      for (const [id, c] of store.collectionOf) if (c === collectionId) ids.push(id)
    }
    const out = []
    for (const id of ids) {
      const values = store.values.get(id)
      if (!values) continue
      const m = meta.get(id) ?? { name: '', createdAt: 0 }
      out.push({ id, name: m.name, createdAt: m.createdAt, values })
    }
    return out
  }

  /** the row each top-level element belongs to, grouped k elements at a time */
  function rowsOf(host: ListHost) {
    const rows: { entryId: string; els: Element[] }[] = []
    const kids = Array.prototype.slice.call(host.el.children) as Element[]
    const own: Element[] = []
    for (const el of kids) {
      if (el === host.tpl || el === host.empty) continue
      own.push(el)
    }
    const k = Math.max(1, host.d.k || 1)
    for (let i = 0; i < own.length; i += k) {
      const els = own.slice(i, i + k)
      const mark = els[0]!.getAttribute(STATE_ROW_ENTRY_ATTR)
      const id = mark === null ? '' : (ds.en[Number(mark)]?.id ?? '')
      rows.push({ entryId: id, els })
    }
    return rows
  }

  function buildRow(host: ListHost, entryId: string) {
    if (!host.tpl) return null
    const frag = host.tpl.content.cloneNode(true) as DocumentFragment
    const els = Array.prototype.slice.call(frag.children) as Element[]
    if (!els.length) return null
    // the row's identity, which is what re-points every binding under it
    const marked = els[0]!
    marked.setAttribute(STATE_ROW_ENTRY_ATTR, String(slotFor(entryId)))
    return { els, entryId }
  }

  /** re-point a row's bindings at the entry it now renders, and render them */
  function adoptRow(els: Element[], entryId: string) {
    for (const root of els) {
      const found = Array.prototype.slice.call(
        root.querySelectorAll(`[${STATE_ATTR}]`),
      ) as Element[]
      if (root.hasAttribute(STATE_ATTR)) found.unshift(root)
      for (const el of found) {
        const bind = ds.b[Number(el.getAttribute(STATE_ATTR))]
        if (!bind || bind[0] === undefined) continue
        const shape: Read[] = ds.rs[bind[0]] ?? []
        const item: Bound = {
          el,
          reads: shape.map((read, i) => ({
            read,
            // a hop read keeps the entry it was published against; everything
            // else follows the row
            entryId: read.h ? (ds.en[bind[i + 1] ?? -1]?.id ?? '') : entryId,
            base: read.n ? el.getAttribute(read.n) : null,
          })),
        }
        item.reads = item.reads.filter((r: { entryId: string }) => r.entryId)
        if (!item.reads.length) continue
        bound.push(item)
        track(item)
        renderBound(item)
        for (const read of item.reads) {
          if (read.read.k === BIND_VALUE) wireControl(item.el, read.read, read.entryId)
        }
      }
      // the row's own writes: without this a card could be moved once (by the
      // trigger the export rendered) and never again
      wireActionsIn(root)
    }
  }

  // ---------- aggregates ----------
  //
  // A number over a LIST, so it is recomputed whenever ANY entry changes
  // rather than tracked per entry — which is what makes a kanban column header
  // follow the card that just left it.
  const aggEls: { el: Element; d: AggDesc }[] = []
  for (const el of Array.prototype.slice.call(
    document.querySelectorAll(`[${STATE_AGG_ATTR}]`),
  ) as Element[]) {
    const d = (ds.g ?? [])[Number(el.getAttribute(STATE_AGG_ATTR))]
    if (d) aggEls.push({ el, d })
  }

  function reaggregate() {
    for (const { el, d } of aggEls) {
      const candidates = candidatesFor({ c: d.c, k: 1, q: d.q, cur: d.cur })
      if (!candidates) continue
      const kept = applyListQuery(candidates, d.q, {
        currentEntryId: d.cur === undefined ? undefined : ds.en[d.cur]?.id,
      }) as { values?: Record<string, unknown> }[]
      el.textContent = aggregateValue(kept, d.op, d.f ?? null)
    }
  }

  function relist() {
    let built = false
    for (const host of hosts) {
      const candidates = candidatesFor(host.d)
      if (!candidates) continue
      const wanted = applyListQuery(candidates, host.d.q, {
        currentEntryId: host.d.cur === undefined ? undefined : ds.en[host.d.cur]?.id,
      }) as { id: string }[]
      const rows = rowsOf(host)
      const have = new Map<string, Element[]>()
      for (const row of rows) if (row.entryId) have.set(row.entryId, row.els)

      // rows that are no longer wanted go, and their bindings with them
      const keep = new Set(wanted.map((e) => e.id))
      for (const row of rows) {
        if (row.entryId && keep.has(row.entryId)) continue
        for (const el of row.els) {
          untrack(el)
          el.remove()
        }
      }

      // then place every wanted row in order, building the ones that are new
      let anchor: Element | null = null
      for (const entry of wanted) {
        let els = have.get(entry.id)
        if (!els) {
          const made = buildRow(host, entry.id)
          if (!made) continue
          els = made.els
          for (const el of els) {
            if (anchor) anchor.after(el)
            else host.el.insertBefore(el, null)
            anchor = el
          }
          adoptRow(els, entry.id)
          built = true
          continue
        }
        for (const el of els) {
          if (anchor) {
            if (anchor.nextElementSibling !== el) anchor.after(el)
          } else if (host.el.firstElementChild !== el) {
            host.el.insertBefore(el, host.el.firstElementChild)
          }
          anchor = el
        }
      }

      // the empty block is the complement of having any row at all
      if (host.empty) (host.empty as HTMLElement).hidden = wanted.length > 0
    }
    // a built row is a new DOM node wearing an old `data-fx`: hand it back to
    // the interaction runtime or its triggers are never wired
    if (built) rescan()
  }

  restore()

  function indexBound(ds: DsWire): Bound[] {
    const out: Bound[] = []
    document.querySelectorAll(`[${STATE_ATTR}]`).forEach((el) => {
      const bind = ds.b[Number(el.getAttribute(STATE_ATTR))]
      if (!bind || bind[0] === undefined) return
      const shape: Read[] = ds.rs[bind[0]] ?? []
      const reads = shape.map((read, i) => ({
        read,
        entryId: ds.en[bind[i + 1] ?? -1]?.id ?? '',
        base: read.n ? el.getAttribute(read.n) : null,
      }))
      out.push({ el, reads: reads.filter((r) => r.entryId) })
    })
    return out.filter((item) => item.reads.length)
  }
}
