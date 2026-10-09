export function refIds(entry, fieldName) {
  const v = entry?.values?.[fieldName]
  if (Array.isArray(v)) return v
  return typeof v === 'string' && v ? [v] : []
}

export function resolveBinding(collections, collection, entry, path) {
  if (!collection || !path) return null
  const dot = path.indexOf('.')
  const head = dot === -1 ? path : path.slice(0, dot)
  const tail = dot === -1 ? null : path.slice(dot + 1)
  const field = collection.fields.find((f) => f.name === head)
  if (!field) return null
  if (tail === null) return { collection, field, entry: entry ?? null }
  if (field.type !== 'reference' || tail.includes('.')) return null
  const refCollection = collections.find((c) => c.id === field.refCollectionId) ?? null
  const refField = refCollection?.fields.find((f) => f.name === tail) ?? null
  if (!refCollection || !refField) return null
  const id = entry?.values?.[head]
  const refEntry =
    (typeof id === 'string' && refCollection.entries.find((e) => e.id === id)) || null
  return { collection: refCollection, field: refField, entry: refEntry }
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
  const f = query.filter
  if (f && typeof f.field === 'string') {
    out = out.filter((entry) => {
      const v = entry.values?.[f.field]
      if (f.equalsCurrent) {
        if (!opts || !opts.currentEntryId) return false
        return Array.isArray(v) ? v.includes(opts.currentEntryId) : v === opts.currentEntryId
      }
      const s = typeof v === 'string' ? v : ''
      if (typeof f.equals === 'string') return s === f.equals
      if (f.notEmpty) return s !== ''
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
    const field = (collection?.fields ?? []).find((f) => f.name === fieldName)
    if (!field) continue
    const value = readField(field)
    if (value !== undefined && value !== null && String(value) !== '') out[name] = String(value)
  }
  return out
}
