/**
 * Whether a field stores entry IDS rather than text — which is why a reference
 * never reads as text (`baseEntryText` returns undefined for an array) and why
 * one bound as a leaf renders the referenced entry's NAME through `refDisplay`.
 * @param {string} type
 */
export function isRefType(type) {
  return type === 'reference' || type === 'multi-reference'
}

export function refIds(entry, fieldName) {
  const v = entry?.values?.[fieldName]
  if (Array.isArray(v)) return v
  return typeof v === 'string' && v ? [v] : []
}

/**
 * A binding path split from its display FORMAT: `due|date:long` → `due` + `date:long`.
 *
 * The format travels on the `arg` rather than in a separate field because it is
 * part of the address — "this field, rendered this way" — and every reader of
 * `arg` already exists in three renderers. A second node key would have to be
 * carried by `cloneSubtree`, baked by `detach` and resolved along the instance
 * chain, for a string that never means anything without the path beside it.
 *
 * @param {string|undefined} path
 * @returns {{path: string, format: string|null}}
 */
export function splitFieldFormat(path) {
  const raw = typeof path === 'string' ? path : ''
  const bar = raw.indexOf('|')
  if (bar === -1) return { path: raw, format: null }
  return { path: raw.slice(0, bar).trim(), format: raw.slice(bar + 1).trim() || null }
}

/** `Intl.DateTimeFormat` options per named date preset */
const DATE_PRESETS = {
  numeric: { year: 'numeric', month: '2-digit', day: '2-digit' },
  short: { year: 'numeric', month: 'short', day: 'numeric' },
  medium: { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' },
  long: { year: 'numeric', month: 'long', day: 'numeric' },
  'month-day': { month: 'short', day: 'numeric' },
  'month-year': { month: 'long', year: 'numeric' },
  time: { hour: '2-digit', minute: '2-digit' },
  datetime: { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
}

/** the date presets an author may name, for a refusal that lists them */
export const DATE_FORMATS = Object.keys(DATE_PRESETS)

/**
 * Whether a `|format` suffix is one this renderer understands, given the field.
 *
 * Validated at WRITE time so an unknown format is a refusal rather than a page
 * that renders a raw ISO string, which is what "no value formatting of any
 * kind" cost: a prototype grew a `due-label` text field on two collections
 * purely to hold the words a date already contains.
 */
export function fieldFormatError(format, field) {
  if (!format) return null
  const type = field?.type ?? 'text'
  if (format === 'label') {
    if (type !== 'select') {
      return `'|label' reads a choice's label, so it only works on a select field — '${field?.name}' is a ${type}`
    }
    return null
  }
  if (format.startsWith('date:')) {
    const preset = format.slice('date:'.length)
    if (type !== 'date') {
      return `'|date:' formats a date field — '${field?.name}' is a ${type}`
    }
    if (!DATE_PRESETS[preset]) {
      return `'${preset}' is not a date format — one of ${DATE_FORMATS.join(', ')}`
    }
    return null
  }
  return `'|${format}' is not a format — use '|label' on a select, or '|date:<${DATE_FORMATS[0]}…>' on a date`
}

/**
 * One field value rendered for a reader: a date as words, a choice as its
 * label. Shared by both Vue renderers, the exporter and the state runtime, so
 * the canvas, Play and the published page cannot disagree about a date.
 *
 * Falls back to the raw stored value whenever the format cannot be applied —
 * an unparseable date, a choice with no label — because a visible wrong date is
 * better than a blank space, and the refusal that would have prevented it
 * already happened at write time.
 *
 * @param {string} value the stored value (always a string)
 * @param {{type?: string, options?: string[], optionLabels?: Record<string,string>}|null} field
 * @param {string|null} format
 * @param {string} [locale]
 */
export function formatFieldValue(value, field, format, locale) {
  const raw = value == null ? '' : String(value)
  if (!format || !raw) return raw
  if (format === 'label') {
    return field?.optionLabels?.[raw] ?? raw
  }
  if (format.startsWith('date:')) {
    const opts = DATE_PRESETS[format.slice('date:'.length)]
    if (!opts) return raw
    // a bare YYYY-MM-DD is parsed as UTC midnight, so formatting it in a
    // western timezone would render the day BEFORE. Pinning the zone to UTC
    // keeps a date-only value the day it says it is.
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw)
    if (Number.isNaN(date.getTime())) return raw
    try {
      return new Intl.DateTimeFormat(locale || 'en', { timeZone: 'UTC', ...opts }).format(date)
    } catch (e) {
      return raw
    }
  }
  return raw
}

/**
 * Resolve a binding path to its field and the entry that holds it.
 *
 * The path may carry a display FORMAT (`due|date:long`), which is stripped here
 * and handed back on the result — so every one of the three renderers resolves
 * the format in the same place it resolves the field, and none of them can
 * render a formatted value against the wrong one.
 */
export function resolveBinding(collections, collection, entry, rawPath) {
  const { path, format } = splitFieldFormat(rawPath)
  if (!collection || !path) return null
  const dot = path.indexOf('.')
  const head = dot === -1 ? path : path.slice(0, dot)
  const tail = dot === -1 ? null : path.slice(dot + 1)
  const field = collection.fields.find((f) => f.name === head)
  if (!field) return null
  if (tail === null) return { collection, field, entry: entry ?? null, format }
  if (field.type !== 'reference' || tail.includes('.')) return null
  const refCollection = collections.find((c) => c.id === field.refCollectionId) ?? null
  const refField = refCollection?.fields.find((f) => f.name === tail) ?? null
  if (!refCollection || !refField) return null
  const id = entry?.values?.[head]
  const refEntry =
    (typeof id === 'string' && refCollection.entries.find((e) => e.id === id)) || null
  return { collection: refCollection, field: refField, entry: refEntry, format }
}

export function mediaUrls(entry, fieldName) {
  const v = entry?.values?.[fieldName]
  if (Array.isArray(v)) return v.filter((u) => typeof u === 'string' && u)
  return typeof v === 'string' && v ? [v] : []
}

function mediaListScope(field, scopeEntry) {
  const urls = mediaUrls(scopeEntry, field.name)
  return {
    collection: {
      id: `media:${field.id ?? field.name}`,
      name: field.name,
      synthetic: true,
      fields: [{ id: `${field.id ?? field.name}:src`, name: field.name, type: 'image' }],
      entries: [],
    },
    entries: urls.map((url, i) => ({
      id: `${field.name}:${i}`,
      name: '',
      slug: '',
      values: { [field.name]: url },
    })),
  }
}

/**
 * The site's own published pages, as a synthetic collection.
 *
 * `:collection-list[@pages]` repeats over them, so an auto nav / footer menu is
 * DATA rather than a hand-maintained list of links — which is also what makes
 * "every page except the one you're on" expressible (`excludeCurrent`, since the
 * synthetic entry ids ARE page ids) and what lets `@item` link each row to its
 * page. The `@` prefix is reserved by the lexer, so this can never collide with
 * a collection someone actually named "pages".
 *
 * Fields: `title` (the page name), `path`, `slug` (the last path segment).
 * @param {{id: string, name: string, path: string, status?: string, collectionId?: string}[]} pages
 */
export function pagesListScope(pages) {
  const entries = (pages ?? [])
    .filter((p) => p.status === 'published' && !p.collectionId)
    .map((page) => {
      const path = page.path || '/'
      const slug = path.split('/').filter(Boolean).pop() ?? ''
      return {
        id: page.id,
        name: page.name,
        slug,
        routePath: path,
        values: { title: page.name, path, slug },
        createdAt: 0,
      }
    })
  return {
    collection: {
      id: '@pages',
      name: '@pages',
      fields: [
        { id: '@title', name: 'title', type: 'text' },
        { id: '@path', name: 'path', type: 'text' },
        { id: '@slug', name: 'slug', type: 'text' },
      ],
      entries,
    },
    entries,
  }
}

export function resolveListScope(collections, scopeCollection, scopeEntry, arg, pages) {
  if (!arg) return null
  if (arg === '@pages') return pagesListScope(pages)
  const named = collections.find((c) => c.name === arg)
  if (named) return { collection: named, entries: named.entries }
  const field = scopeCollection?.fields.find((f) => f.name === arg)
  if (!field) return null
  if (field.type === 'multi-image') return mediaListScope(field, scopeEntry)
  if (field.type !== 'multi-reference') return null
  const target = collections.find((c) => c.id === field.refCollectionId)
  if (!target) return null
  const entries = refIds(scopeEntry, arg)
    .map((id) => target.entries.find((e) => e.id === id))
    .filter(Boolean)
  return { collection: target, entries }
}

export function applyListQuery(entries, query, opts) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return entries
  let out = entries
  if (query.excludeCurrent && opts && opts.currentEntryId) {
    out = out.filter((entry) => entry.id !== opts.currentEntryId)
  }
  if (Array.isArray(query.pick)) {
    const picked = new Set(query.pick)
    out = out.filter((entry) => picked.has(entry.id))
  }
  // `filter` is the original single condition; `filters` is a list of the same
  // shape, and every one of them is ANDed. One condition could not express
  // "this project AND still to do", so a per-project kanban had to be a global
  // board — the filter was the whole gap, not the board.
  const conditions = [
    ...(query.filter ? [query.filter] : []),
    ...(Array.isArray(query.filters) ? query.filters : []),
  ]
  for (const f of conditions) {
    if (!f || typeof f.field !== 'string') continue
    out = out.filter((entry) => {
      const v = entry.values?.[f.field]
      if (f.equalsCurrent) {
        if (!opts || !opts.currentEntryId) return false
        const hit = Array.isArray(v) ? v.includes(opts.currentEntryId) : v === opts.currentEntryId
        return f.not ? !hit : hit
      }
      const s = typeof v === 'string' ? v : ''
      if (typeof f.equals === 'string') return f.not ? s !== f.equals : s === f.equals
      if (f.notEmpty) return f.not ? s === '' : s !== ''
      return true
    })
  }
  if (typeof query.sortField === 'string' && query.sortField) {
    const dir = query.sortDir === 'desc' ? -1 : 1
    const keyOf = (entry) =>
      query.sortField === 'createdAt'
        ? (entry.createdAt ?? 0)
        : query.sortField === 'name'
          ? (entry.name ?? '')
          : typeof entry.values?.[query.sortField] === 'string'
            ? entry.values[query.sortField]
            : ''
    out = [...out].sort((a, b) => {
      const ka = keyOf(a)
      const kb = keyOf(b)
      if (typeof ka === 'number' && typeof kb === 'number') return (ka - kb) * dir
      return String(ka).localeCompare(String(kb), undefined, { numeric: true }) * dir
    })
  }
  const offset = Number(query.offset)
  if (Number.isFinite(offset) && offset > 0) out = out.slice(offset)
  const limit = Number(query.limit)
  if (Number.isFinite(limit) && limit > 0) out = out.slice(0, limit)
  return out
}

export function refDisplay(collections, field, entry) {
  const target = collections.find((c) => c.id === field.refCollectionId)
  if (!target || !entry) return ''
  return refIds(entry, field.name)
    .map((id) => target.entries.find((e) => e.id === id)?.name)
    .filter(Boolean)
    .join(', ')
}

/**
 * Attribute values bound to collection fields (`node.fieldAttrs`), resolved in
 * the entry scope being rendered. Shared by both Vue renderers, the exporter and
 * the MCP validators, so the canvas, Preview and the published page agree.
 *
 * This is the only way presentation can follow DATA: a `data-status` attribute
 * drives a `data-[status=waiting]:` class, so one status pill renders a
 * different colour per entry instead of needing two components; and `value` /
 * `placeholder` on an input pre-fill an edit form from the entry it edits.
 *
 * Falls back to whatever the static `attributes` already held when there is no
 * entry, or the field is missing, or its value is empty — so a bound attribute
 * is still authorable (and visible) outside entry scope.
 *
 * @param {Record<string,string>|undefined} fieldAttrs attribute name → field name
 * @param {{fields?: {name: string}[]}|null|undefined} collection the entry's collection
 * @param {(field: {name: string}) => string} readField reads one field's value
 *   for the entry being rendered (locale-aware in every caller)
 * @param {Record<string,string>} base the already-sanitized static attributes
 * @returns {Record<string,string>} a new object; `base` is never mutated
 */
export function resolveFieldAttrs(fieldAttrs, collection, readField, base = {}) {
  const out = { ...base }
  for (const [rawName, fieldName] of Object.entries(fieldAttrs ?? {})) {
    const name = String(rawName).toLowerCase().trim()
    // a `style:--x` key is a CSS CUSTOM PROPERTY, not an attribute — it is
    // read by cssVarsFromFields and merged into the style attribute the
    // renderer already owns. Emitted here it would become an attribute
    // literally named "style:--x", which nothing reads.
    if (name.startsWith(CSS_VAR_PREFIX)) continue
    const field = (collection?.fields ?? []).find((f) => f.name === fieldName)
    if (!field) continue
    const value = readField(field)
    if (value !== undefined && value !== null && String(value) !== '') out[name] = String(value)
  }
  return out
}

/** the `fieldAttrs` key prefix that means "a CSS custom property" */
export const CSS_VAR_PREFIX = 'style:'

/** a custom-property name a field may be bound to: `--` then lowercase ident */
const CSS_VAR_RE = /^--[a-z][a-z0-9-]*$/

/** whether a `fieldAttrs` key is a well-formed CSS-variable binding */
export function isCssVarBinding(name) {
  const n = String(name).toLowerCase().trim()
  return n.startsWith(CSS_VAR_PREFIX) && CSS_VAR_RE.test(n.slice(CSS_VAR_PREFIX.length))
}

/**
 * CSS custom properties bound to collection fields, for the style attribute.
 *
 * This is the one way a NUMBER can reach a style. A `progress` field of "60"
 * bound as `{"style:--p": "progress"}` renders `--p:60`, and a class of
 * `w-[calc(var(--p)*1%)]` turns it into a bar — which no amount of
 * `data-[…]:` variants can do, since a variant matches a value it has to know
 * in advance and a measurement is a continuum.
 *
 * Deliberately a custom property rather than a direct `width`: the style
 * attribute is already owned by the background layer and by an animation's
 * primed first frame, so a bound declaration would fight them. A variable is
 * read by a class, which the cascade resolves as usual, and the actions engine
 * re-renders it like any other bound attribute.
 *
 * @param {Record<string,string>|undefined} fieldAttrs
 * @param {{fields?: {name: string}[]}|null|undefined} collection
 * @param {(field: {name: string}) => string} readField
 * @returns {Record<string,string>} custom property name → value
 */
export function cssVarsFromFields(fieldAttrs, collection, readField) {
  const out = {}
  for (const [rawName, fieldName] of Object.entries(fieldAttrs ?? {})) {
    if (!isCssVarBinding(rawName)) continue
    const name = String(rawName).toLowerCase().trim().slice(CSS_VAR_PREFIX.length)
    const field = (collection?.fields ?? []).find((f) => f.name === fieldName)
    if (!field) continue
    const value = readField(field)
    if (value === undefined || value === null || String(value) === '') continue
    // a custom property's value lands in a style attribute, so it must not be
    // able to close the declaration and start another
    const safe = String(value).replace(/[;{}<>"']/g, '')
    if (safe) out[name] = safe
  }
  return out
}

/**
 * An AGGREGATE binding: a leaf that renders a number computed over a list
 * rather than a field of one entry.
 *
 * Spelled on the `arg`, as `@count:task` / `@sum:task.points`, because it is an
 * address like any other binding and because it then inherits `listQuery`
 * wholesale — the same `filters`, `pick`, `excludeCurrent` and `limit` a
 * `collection-list` uses. A column header that says "3" is therefore the same
 * query as the column it labels, and the actions engine re-runs both.
 *
 * The `@` prefix is already reserved by the lexer (`@pages`, `@item`), so this
 * can never collide with a field someone actually named "count".
 *
 * @param {string|undefined} arg
 * @returns {{op: string, source: string, field: string|null}|null}
 */
export function parseAggregate(arg) {
  const raw = typeof arg === 'string' ? arg : ''
  const m = /^@(count|sum|avg|min|max):(.+)$/.exec(raw)
  if (!m) return null
  const op = m[1]
  const rest = m[2]
  if (op === 'count') return { op, source: rest, field: null }
  const dot = rest.lastIndexOf('.')
  if (dot <= 0 || dot === rest.length - 1) return null
  return { op, source: rest.slice(0, dot), field: rest.slice(dot + 1) }
}

/** the aggregate ops an author may name, for a refusal that lists them */
export const AGGREGATE_OPS = ['count', 'sum', 'avg', 'min', 'max']

/**
 * Compute one aggregate over already-filtered entries.
 *
 * Every value is a string, so a numeric op parses as it goes and ignores what
 * cannot be a number — a half-filled `points` field makes a sum of the rest
 * rather than NaN, which is the only answer that renders.
 *
 * @param {{values?: Record<string, unknown>}[]} entries
 * @param {string} op
 * @param {string|null} field
 * @returns {string}
 */
export function aggregateValue(entries, op, field) {
  const list = entries ?? []
  if (op === 'count') return String(list.length)
  if (!field) return ''
  const numbers = []
  for (const entry of list) {
    const raw = entry?.values?.[field]
    const n = Number(Array.isArray(raw) ? NaN : raw)
    if (Number.isFinite(n)) numbers.push(n)
  }
  if (!numbers.length) return op === 'sum' ? '0' : ''
  if (op === 'sum') return String(numbers.reduce((a, b) => a + b, 0))
  if (op === 'avg') {
    const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length
    // a mean is the one op that can be fractional; two places is enough for a
    // prototype and never renders "3.0000000000000004"
    return String(Math.round(mean * 100) / 100)
  }
  if (op === 'min') return String(Math.min(...numbers))
  if (op === 'max') return String(Math.max(...numbers))
  return ''
}

/**
 * Why an aggregate binding cannot resolve, named at write time.
 * @param {{op: string, source: string, field: string|null}} agg
 * @param {{collections?: any[], scopeCollection?: any}} at
 */
export function aggregateError(agg, at) {
  const collections = at.collections ?? []
  const named = collections.find((c) => c.name === agg.source)
  const scopeField = at.scopeCollection?.fields?.find((f) => f.name === agg.source)
  const viaRef =
    scopeField?.type === 'multi-reference'
      ? collections.find((c) => c.id === scopeField.refCollectionId)
      : null
  const target = agg.source === '@pages' ? null : (named ?? viaRef)
  if (agg.source !== '@pages' && !target) {
    return (
      `'@${agg.op}:${agg.source}' names no collection "${agg.source}" and no multi-reference ` +
      `field of the entry in scope (collections: ${collections.map((c) => c.name).join(', ')})`
    )
  }
  if (agg.field) {
    const field = (target?.fields ?? []).find((f) => f.name === agg.field)
    if (!field) {
      return `'@${agg.op}' has no field "${agg.field}" on "${target?.name ?? agg.source}"`
    }
    if (field.type !== 'number') {
      return `'@${agg.op}' adds up numbers — "${agg.field}" is a ${field.type} field`
    }
  }
  return null
}
