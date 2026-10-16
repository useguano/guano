/**
 * Client-side entry state — the ONE definition of what an action does, read by
 * the exporter, both Vue renderers, the MCP validators and the published state
 * runtime.
 *
 * The CMS is baked into the published HTML, so a prototype's "Mark as done"
 * could change classes and never data. This module is the data half: a route
 * carries the entries it rendered as a STORE, an action's ops mutate that
 * store, and every element bound to a field re-reads from it.
 *
 * Three rules are load-bearing.
 *
 * **Every value is a string**, exactly as `lib/collectionFields.ts` stores it —
 * `number` is "12" and `boolean` is "true"/"false". One storage shape is what
 * lets a bound attribute, a `data-[…]:` variant and the numeric-aware sort read
 * the same thing, and an op that wrote a real number would restyle a
 * `data-[done=true]:` pill into nothing.
 *
 * **The store is an OVERLAY, never a replacement.** It holds only the fields a
 * route binds (plus what a `listQuery` reads), so a read falls back to the
 * baked value and an unbound field stays absent rather than empty. That is also
 * what keeps the persisted diff small enough to live in `sessionStorage`.
 *
 * **A target entry is resolved from the binding's OWN entry scope**, which is
 * the same rule `shared/entryScope.js` applies to an interaction's state key: a
 * "Done" checkbox inside a `collection-list` row targets THAT row's entry, and
 * one outside every repeat targets the route's own entry. Keyed off anything
 * else, every row's checkbox would write the same entry.
 */

/** `data-ds` on a bound element — an index into the manifest's `ds.b` */
export const STATE_ATTR = 'data-ds'
/** `data-ds-list` on a `collection-list` / bound `slider` — an index into `ds.l` */
export const STATE_LIST_ATTR = 'data-ds-list'
/** the `<template>` holding a list's row markup, for a row the runtime creates */
export const STATE_ROW_ATTR = 'data-ds-row'
/** `data-ds-e` on a row's top-level element — which entry the row renders */
export const STATE_ROW_ENTRY_ATTR = 'data-ds-e'
/** `data-ds-empty` on a list's empty block, so the runtime can show it back */
export const STATE_EMPTY_ATTR = 'data-ds-empty'
/** `data-ds-agg` on a leaf — an index into the manifest's `ds.g` */
export const STATE_AGG_ATTR = 'data-ds-agg'
/** `data-ds-act` on a trigger — an index into the manifest's `ds.a` */
export const STATE_ACTION_ATTR = 'data-ds-act'
/** a draft scope's container — its inputs write nowhere until a `create` commits */
export const STATE_DRAFT_ATTR = 'data-ds-draft'
/** the field a control inside a draft scope collects — it has no entry to bind */
export const STATE_DRAFT_FIELD_ATTR = 'data-ds-draft-field'

/** every op an action can run. `create`/`delete` take no field. */
export const STATE_OPS = ['set', 'toggle', 'increment', 'create', 'delete']

/** the sentinel meaning "the entry in scope where the binding sits" */
export const CURRENT_ENTRY = '@current'

/** how a bound element reads its value: text content, or one attribute */
export const BIND_TEXT = 't'
export const BIND_ATTR = 'a'
/** a two-way control: reads the field AND writes it back on change */
export const BIND_VALUE = 'v'
/** an AGGREGATE over a list — re-evaluated whenever the store changes, because
 *  the number it shows is a property of the whole list and not of one entry */
export const BIND_AGG = 'g'

/**
 * A field's value coerced to the ONE storage shape, so an op can never write a
 * value the CMS could not have stored.
 *
 * `boolean` normalizes anything truthy-looking to "true"/"false" rather than
 * storing the raw text: a checkbox hands us "on", and a `data-[done=true]:`
 * variant matches the literal "true" alone.
 *
 * A `multi-` field keeps its ARRAY, because that is the shape the CMS stores
 * and the shape `applyListQuery`'s `equalsCurrent` tests with `.includes` — a
 * comma string would read as one id nothing matches, and the list it filters
 * would silently come back empty.
 *
 * @param {{type?: string}|null|undefined} field
 * @param {unknown} value
 * @returns {string|string[]}
 */
export function coerceFieldValue(field, value) {
  const type = field?.type ?? 'text'
  if (type === 'boolean') return isTruthyValue(value) ? 'true' : 'false'
  if (type === 'number') {
    const n = Number(value)
    return Number.isFinite(n) ? String(n) : ''
  }
  if (type.startsWith('multi-')) return refListOf(value)
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v).join(',')
  return value === undefined || value === null ? '' : String(value)
}

/**
 * Whether two stored values are the same, array shapes included — an op that
 * rewrote a `multi-` field to an equal array would otherwise read as a change
 * and re-render every list on the route.
 */
export function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = refListOf(a)
    const y = refListOf(b)
    return x.length === y.length && x.every((v, i) => v === y[i])
  }
  return a === b
}

/** what a `boolean` field counts as true — "on" is what a checkbox posts */
export function isTruthyValue(value) {
  if (typeof value === 'boolean') return value
  const s = String(value ?? '')
    .trim()
    .toLowerCase()
  return s === 'true' || s === '1' || s === 'on' || s === 'yes'
}

/**
 * A multi-reference value as a list of ids. Mirrors `shared/fields.refIds`,
 * which reads an ENTRY; this reads a store value that may already be a string.
 * @param {unknown} value
 * @returns {string[]}
 */
export function refListOf(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v)
  if (typeof value !== 'string' || !value) return []
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * The store a route starts from: entry id → its baked field values.
 *
 * Built at export from the entries the route rendered, and rehydrated in the
 * browser from the manifest. `collectionOf` is kept beside the values because
 * an op needs the FIELD's type to coerce, and a `create` needs the collection's
 * field list — neither is recoverable from a value alone.
 *
 * @typedef {{id: string, c?: number, v?: Record<string, string|string[]>, n?: string, ct?: number}} WireEntry
 * @typedef {{id: string, n?: string, name?: string, f?: Record<string,string>, fields?: Record<string,string>}} WireCollection
 *
 * @param {{entries?: WireEntry[], collections?: WireCollection[]}} wire
 * @returns {{values: Map<string, Record<string,string>>, collectionOf: Map<string,string>, collections: Map<string, {id: string, name: string, fields: Record<string,string>}>}}
 */
export function createStore(wire) {
  const collections = new Map()
  // the WIRE's short keys (`n` name, `f` fields), because this is the wire's
  // reader — spelled-out keys here meant `create` looked up `c.name` on an
  // object that only ever carried `c.n`, found no collection by that name and
  // returned "nothing changed" with every tool reporting success
  for (const c of wire?.collections ?? []) {
    collections.set(c.id, { id: c.id, name: c.n ?? c.name, fields: c.f ?? c.fields ?? {} })
  }
  const values = new Map()
  const collectionOf = new Map()
  const list = wire?.entries ?? []
  for (const entry of list) {
    values.set(entry.id, { ...(entry.v ?? {}) })
    const collection = (wire?.collections ?? [])[entry.c ?? 0]
    if (collection) collectionOf.set(entry.id, collection.id)
  }
  return { values, collectionOf, collections }
}

/**
 * One field's current value, or `undefined` when the store does not carry it —
 * which is the signal to fall back to whatever the page was published with.
 * @param {ReturnType<typeof createStore>} store
 */
export function readField(store, entryId, fieldName) {
  return store.values.get(entryId)?.[fieldName]
}

/** the field descriptor an op coerces against, resolved through the entry */
export function fieldOf(store, entryId, fieldName) {
  const collectionId = store.collectionOf.get(entryId)
  const type = collectionId ? store.collections.get(collectionId)?.fields?.[fieldName] : undefined
  return type ? { name: fieldName, type } : null
}

/**
 * Run one op against the store.
 *
 * Returns the entry ids it changed, so a caller re-renders exactly those
 * bindings and the lists whose query reads a field that moved — never the whole
 * route. An op that cannot land returns an empty list rather than throwing:
 * every refusal this engine has is raised at BIND time, where it can name the
 * fix, and a published page that silently does nothing is better than one whose
 * runtime dies mid-click and takes every other action with it.
 *
 * @param {ReturnType<typeof createStore>} store
 * @param {{op: string, field?: string, value?: string, by?: number, collection?: string, values?: Record<string,string>, from?: string, entry?: string}} op
 * @param {{entryId?: string|null, draft?: Record<string,string>|null, newId?: () => string}} at
 * @returns {{changed: string[], created?: string, deleted?: string}}
 */
export function applyOp(store, op, at) {
  const kind = op?.op
  if (kind === 'create') return createEntry(store, op, at)
  const entryId = op?.entry && op.entry !== CURRENT_ENTRY ? op.entry : at?.entryId
  if (!entryId) return { changed: [] }
  if (kind === 'delete') {
    if (!store.values.has(entryId)) return { changed: [] }
    store.values.delete(entryId)
    store.collectionOf.delete(entryId)
    return { changed: [entryId], deleted: entryId }
  }
  const name = op?.field
  if (!name) return { changed: [] }
  const values = store.values.get(entryId)
  if (!values) return { changed: [] }
  const field = fieldOf(store, entryId, name)
  const before = values[name]
  let next
  if (kind === 'set') {
    next = coerceFieldValue(field, op.value)
  } else if (kind === 'toggle') {
    next = isTruthyValue(before) ? 'false' : 'true'
  } else if (kind === 'increment') {
    const by = Number(op.by ?? 1)
    next = String((Number(before) || 0) + (Number.isFinite(by) ? by : 1))
  } else {
    return { changed: [] }
  }
  if (sameValue(next, before)) return { changed: [] }
  values[name] = next
  return { changed: [entryId] }
}

/**
 * `create`: a new entry in the store, from literal `values` plus whatever a
 * draft scope's inputs collected.
 *
 * A reference field written `"@current"` resolves to the entry in scope, and a
 * collection with exactly ONE reference field pointing at the current entry's
 * collection gets it filled automatically — that is what makes "add a subtask"
 * one op instead of an op plus a hidden input.
 */
function createEntry(store, op, at) {
  const target = [...store.collections.values()].find((c) => c.name === op?.collection)
  if (!target) return { changed: [] }
  const id = (at?.newId ?? fallbackId)()
  const values = {}
  const write = (name, raw) => {
    const type = target.fields?.[name]
    if (!type) return
    const resolved = raw === CURRENT_ENTRY ? (at?.entryId ?? '') : raw
    values[name] = coerceFieldValue({ name, type }, resolved)
  }
  for (const [name, raw] of Object.entries(at?.draft ?? {})) write(name, raw)
  for (const [name, raw] of Object.entries(op?.values ?? {})) write(name, raw)
  const back = backReference(store, target, at?.entryId)
  if (back && !values[back]) values[back] = at.entryId
  store.values.set(id, values)
  store.collectionOf.set(id, target.id)
  return { changed: [id], created: id }
}

/**
 * The one reference field on `target` pointing at the scope entry's collection,
 * or null when there is none or more than one — ambiguity is left to the author
 * rather than guessed at, since filling the wrong reference files a subtask
 * under the wrong task and nothing says so.
 */
function backReference(store, target, entryId) {
  if (!entryId) return null
  const scopeCollection = store.collectionOf.get(entryId)
  if (!scopeCollection) return null
  const hits = Object.entries(target.fields ?? {}).filter(
    ([, type]) => type === `reference:${scopeCollection}`,
  )
  return hits.length === 1 ? hits[0][0] : null
}

/** only ever reached when a caller passes no id source; `uid()` is the real one */
function fallbackId() {
  return 'ds' + Date.now().toString(36) + Math.abs(Date.now() % 97757).toString(36)
}

/**
 * The entries whose values differ from what the route was published with — the
 * only thing persistence stores.
 *
 * Keyed by REAL entry id and field name, deliberately: the fx wire interns
 * every effect key to a route-local ordinal because a key's only job there is
 * to match a trigger to its listener, but an entry id means something OUTSIDE
 * the file — it is the identity the store, this diff and a `create`'s reference
 * field all share. Interned, a diff written on `/task/x` could never be applied
 * on `/board`, which is the one thing cross-route state has to do.
 *
 * @param {ReturnType<typeof createStore>} store
 * A created entry carries its `createdAt` (`ct`) as well as its values,
 * because `applyListQuery` sorts by it and the store does not hold it: without
 * it a task created on one route came back sorting as if it were the oldest
 * entry in the collection, so it reappeared at the TOP of the list it had been
 * appended to.
 *
 * @param {{entries?: WireEntry[]}} wire the baseline
 * @param {(id: string) => number} [createdAt]
 * @returns {{v: Record<string, Record<string,string>>, n: Record<string, {c: string, v: Record<string,string>, ct?: number}>, d: string[]}}
 */
export function storeDiff(store, wire, createdAt) {
  const baseline = new Map((wire?.entries ?? []).map((e) => [e.id, e.v ?? {}]))
  const changed = {}
  const created = {}
  const deleted = []
  for (const [id, values] of store.values) {
    const base = baseline.get(id)
    if (!base) {
      created[id] = { c: store.collectionOf.get(id) ?? '', v: { ...values } }
      const at = createdAt?.(id)
      if (at) created[id].ct = at
      continue
    }
    const delta = {}
    for (const [name, value] of Object.entries(values)) {
      if (!sameValue(base[name], value)) delta[name] = value
    }
    if (Object.keys(delta).length) changed[id] = delta
  }
  for (const id of baseline.keys()) if (!store.values.has(id)) deleted.push(id)
  return { v: changed, n: created, d: deleted }
}

/**
 * Apply a saved diff back onto a freshly hydrated store.
 *
 * An entry the diff knows and this route does not is still adopted — that is
 * how a task created on `/board` shows up in the list on `/project/x` — but
 * only when the route carries its collection, or there would be no field types
 * to coerce against and no list that could ever render it.
 */
export function applyDiff(store, diff) {
  const changed = new Set()
  for (const [id, delta] of Object.entries(diff?.v ?? {})) {
    const values = store.values.get(id)
    if (!values) continue
    for (const [name, value] of Object.entries(delta)) values[name] = value
    changed.add(id)
  }
  for (const [id, entry] of Object.entries(diff?.n ?? {})) {
    if (!store.collections.has(entry?.c)) continue
    store.values.set(id, { ...(entry.v ?? {}) })
    store.collectionOf.set(id, entry.c)
    changed.add(id)
  }
  for (const id of diff?.d ?? []) {
    if (!store.values.delete(id)) continue
    store.collectionOf.delete(id)
    changed.add(id)
  }
  return [...changed]
}

/**
 * Where a diff is remembered. ONE key for the whole site, not one per route:
 * the store's identity is the entry id, so a change made on `/task/x` has to be
 * readable on `/board`. `?resetstate` already clears every `guano-` key, so a
 * persisted toggle and a persisted entry are forgotten by the same affordance.
 */
export const STATE_STORAGE_KEY = 'guano-ds:v1'

/** @param {'none'|'session'|'local'|undefined} mode */
export function stateStorage(mode, win) {
  if (mode !== 'session' && mode !== 'local') return null
  try {
    return mode === 'local' ? win.localStorage : win.sessionStorage
  } catch (e) {
    return null
  }
}

/**
 * The collection whose entry is in scope at a node — what `"@current"` means
 * there, and the collection an action's `field` has to belong to.
 *
 * Resolved by walking DOWN from the page body and remembering the nearest
 * entry-scope root above the node (`shared/entryScope.js` decides what counts
 * as one), falling back to the template page's own collection. That is the same
 * walk a renderer makes, which is the point: a refusal computed any other way
 * would refuse writes that render perfectly well, and accept ones that do not.
 *
 * @param {{collections?: any[], pages?: any[]}} project
 * @param {{elements?: any[], collectionId?: string}} page
 * @param {string} nodeId
 * @returns {{collection: any, root: any}|null}
 */
export function scopeCollectionFor(project, page, nodeId) {
  const collections = project?.collections ?? []
  let found = null
  const walk = (nodes, scope) => {
    for (const node of nodes ?? []) {
      if (found) return
      if (node.id === nodeId) {
        found = scope
        return
      }
      let next = scope
      if (node.type === 'collection-list' || (node.type === 'slider' && node.arg)) {
        const named = collections.find((c) => c.name === node.arg)
        if (named) next = { collection: named, root: node }
        else if (scope?.collection) {
          // a multi-reference source repeats the REFERENCED collection
          const field = scope.collection.fields?.find((f) => f.name === node.arg)
          const target =
            field?.type === 'multi-reference'
              ? collections.find((c) => c.id === field.refCollectionId)
              : null
          next = target ? { collection: target, root: node } : next
        }
      } else if (node.type === 'collection-item' && node.arg) {
        const named = collections.find((c) => c.name === node.arg)
        if (named) next = { collection: named, root: node }
      }
      walk(node.children, next)
    }
  }
  const own = page?.collectionId ? collections.find((c) => c.id === page.collectionId) : null
  walk(page?.elements ?? [], own ? { collection: own, root: null } : null)
  return found
}

/**
 * Why an action binding cannot land, named so the message carries its own fix.
 *
 * Every refusal this engine has is raised HERE, at bind time, rather than in
 * the browser: a published page whose button silently does nothing is the one
 * outcome the interaction engine already learned to refuse, and it cost two
 * releases to find each time. The runtime's own ops are deliberately
 * forgiving for the same reason — by the time they run, this has passed.
 *
 * @param {{trigger?: string, ops?: any[]}} bind
 * @param {{collection?: any, collections?: any[], triggers: string[]}} at
 * @returns {string|null}
 */
export function actionBindingError(bind, at) {
  if (!at.triggers.includes(bind?.trigger)) {
    return `trigger must be one of ${at.triggers.join(', ')}`
  }
  const ops = bind?.ops
  if (!Array.isArray(ops) || !ops.length) {
    return 'an action needs at least one op — see get_guide {section: "state"}'
  }
  for (const op of ops) {
    const kind = op?.op
    if (!STATE_OPS.includes(kind)) {
      return `unknown op "${kind}" — one of ${STATE_OPS.join(', ')}`
    }
    if (kind === 'create') {
      const target = (at.collections ?? []).find((c) => c.name === op.collection)
      if (!target) {
        return `create refused: no collection named "${op.collection}" (use list_collections)`
      }
      if (!op.from && !op.values) {
        return (
          `create refused: it would make an empty "${op.collection}" entry. Give it \`values\`, ` +
          'or `from: "<draft name>"` naming a container you set `draft` on, whose inputs supply them.'
        )
      }
      const unknown = Object.keys(op.values ?? {}).find(
        (name) => !target.fields?.some((f) => f.name === name),
      )
      if (unknown) return `create refused: "${op.collection}" has no field "${unknown}"`
      continue
    }
    if (kind === 'delete') continue
    if (!op.field) return `${kind} refused: it needs a \`field\``
    if (kind === 'set' && typeof op.value !== 'string') {
      return 'set refused: `value` must be a string — every entry value is one ("12", "true")'
    }
    // the entry an op writes: an explicit id, or the one in scope where the
    // binding sits. Neither, and the write has nowhere to land.
    if (!op.entry && !at.collection) {
      return (
        `${kind} refused: there is no entry in scope here, so "@current" resolves to nothing. ` +
        'Bind this inside a collection-list row or on a collection template page, or name an ' +
        'entry with `entry: "<id>"`.'
      )
    }
    const collection = op.entry ? null : at.collection
    if (collection && !collection.fields?.some((f) => f.name === op.field)) {
      return (
        `${kind} refused: "${collection.name}" has no field "${op.field}" ` +
        `(get_collection {collectionId: "${collection.id}"} lists them)`
      )
    }
    const field = collection?.fields?.find((f) => f.name === op.field)
    if (field && kind === 'toggle' && field.type !== 'boolean') {
      return `toggle refused: "${op.field}" is a ${field.type} field — toggle flips a boolean`
    }
    if (field && kind === 'increment' && field.type !== 'number') {
      return `increment refused: "${op.field}" is a ${field.type} field — increment adds to a number`
    }
    if (field && kind === 'set' && field.type === 'select') {
      const options = field.options ?? []
      if (options.length && !options.includes(op.value)) {
        return (
          `set refused: "${op.value}" is not an option of "${op.field}" ` +
          `(${options.join(', ')}). A page matches on the VALUE, so an unknown one styles as nothing.`
        )
      }
    }
  }
  return null
}
