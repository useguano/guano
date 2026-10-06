// Reference-field resolution shared VERBATIM by the client renderers
// (via useRenderNode/ContentEditor) and the static exporter
// (server/export.mjs) — plain JS so both sides import the same file.
//
// A binding path is a field name, optionally hopping ONE reference:
//   'title'        → the scoped entry's own field
//   'author.name'  → the entry referenced by the 'author' field, its 'name'
// Reference values live only in an entry's base `values` (never locale
// overrides): reference = target entry id, multi-reference = array of ids.

/** ids stored on a reference/multi-reference field, always as an array */
export function refIds(entry, fieldName) {
  const v = entry?.values?.[fieldName]
  if (Array.isArray(v)) return v
  return typeof v === 'string' && v ? [v] : []
}

/**
 * Resolve a binding path against a collection + entry scope.
 * Returns the collection/field the value lives on and the entry to read it
 * from — `entry` is null when it can't be resolved yet (no scope entry, or a
 * dangling reference), so callers can still show a {field} placeholder.
 * Returns null when the path names no field at all.
 */
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

/** urls stored on a multi-image field, always as an array */
export function mediaUrls(entry, fieldName) {
  const v = entry?.values?.[fieldName]
  if (Array.isArray(v)) return v.filter((u) => typeof u === 'string' && u)
  return typeof v === 'string' && v ? [v] : []
}

/**
 * The scope a `multi-image` field presents to :collection-list: one synthetic
 * entry per stored url, in a synthetic collection carrying a single image field
 * named after the source field. So inside `:collection-list[gallery]` you bind
 * `:image[gallery]:` and get exactly as many <img> as the entry actually has —
 * the whole point of the type, versus fixed gallery-1…gallery-7 slots that ship
 * empty <img> tags for every image an entry doesn't have.
 *
 * The synthetic collection is not in project.collections, so it mints no entry
 * routes and `@item` inside the list stays inert — it exists only as a scope.
 */
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
 * Entries a :collection-list[arg] iterates: a collection name lists all of
 * its entries; a multi-reference field of the scoped entry lists the
 * referenced entries (dangling ids skipped, order preserved); a multi-image
 * field lists one synthetic entry per stored image url.
 * Returns { collection, entries } or null when arg names none of those.
 */
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
    // template pages render per ENTRY, not as themselves — listing them would
    // put "Post" in the nav next to the real pages
    .filter((p) => p.status === 'published' && !p.collectionId)
    .map((page) => {
      const path = page.path || '/'
      const slug = path.split('/').filter(Boolean).pop() ?? ''
      return {
        id: page.id,
        name: page.name,
        slug,
        // the route this row links to — read by entryRoutePath, so `@item`
        // resolves to the page itself rather than to a collection route
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
  // built-in sources are '@'-prefixed and resolve before collections; the
  // lexer reserves '@' in args so there is no ambiguity to resolve
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

/**
 * Applies a collection-list node's `listQuery` (node-only state, like
 * classes): filter → sort → limit.
 *   { limit?: number,
 *     sortField?: string,        // a text/date field name, or 'createdAt'
 *     sortDir?: 'asc'|'desc',    // default asc
 *     filter?: { field: string, equals?: string, notEmpty?: boolean } }
 * Field comparison uses base values (locale overrides don't reorder lists),
 * numeric-aware so '2' < '10' and ISO dates sort naturally. Malformed
 * queries fail OPEN (input returned unchanged) — a bad query must never
 * blank a published list.
 */
export function applyListQuery(entries, query, opts) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return entries
  let out = entries
  // drop the entry currently in scope (template "related posts" pattern);
  // a no-op outside entry scope, where opts.currentEntryId is absent
  if (query.excludeCurrent && opts && opts.currentEntryId) {
    out = out.filter((entry) => entry.id !== opts.currentEntryId)
  }
  // hand-picked entries (absent = all); membership only — order stays with
  // the source/sort so pick and sort compose predictably
  if (Array.isArray(query.pick)) {
    const picked = new Set(query.pick)
    out = out.filter((entry) => picked.has(entry.id))
  }
  const f = query.filter
  if (f && typeof f.field === 'string') {
    out = out.filter((entry) => {
      const v = entry.values?.[f.field]
      // `equalsCurrent` matches the entry in scope — the child-collection
      // pattern: a Conversation's page lists the Messages whose `conversation`
      // reference IS that conversation. Without it a filter could only compare
      // against a literal, so the only way to list a child collection was to
      // mirror the relation as a multi-reference on the parent and keep the two
      // sides in step by hand. A multi-reference field holds a LIST, so
      // membership counts.
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
  // offset after sort, before limit — "skip N" for slot placement
  const offset = Number(query.offset)
  if (Number.isFinite(offset) && offset > 0) out = out.slice(offset)
  const limit = Number(query.limit)
  if (Number.isFinite(limit) && limit > 0) out = out.slice(0, limit)
  return out
}

/** display text for a reference-typed field bound directly (no `.field`
 * hop): the referenced entry name(s), comma-joined */
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
