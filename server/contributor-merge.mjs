// Server-authoritative content merge for CONTRIBUTOR project writes.
//
// A contributor's editor sends the whole project blob on autosave/publish, but
// their role may only change CONTENT — text, media (foreground + background),
// translations, comments, CMS entries, per-page/entry SEO + publish status.
// This module rebuilds the
// blob so that ALL structure comes from the stored copy and only the content
// allowlist is copied from the contributor's incoming blob. Structural edits
// are silently ignored (never rejected), so a legit autosave never loses work
// and a hand-crafted blob simply has its structural parts dropped.
//
// It reuses the exact sanitizers the static exporter applies at render, so
// stored content can never carry script the export would have stripped anyway
// (defense-in-depth: the canvas/preview may v-html rich content on load).

import { isRich, sanitizeRich } from '../src/lib/shared/richtext.js'
import { SAFE_SRC } from '../src/lib/shared/urls.js'

function parseOrNull(str) {
  if (typeof str !== 'string') return null
  try {
    return JSON.parse(str)
  } catch {
    return null
  }
}

/** id → item map over an array; skips items without a string id */
function indexById(arr) {
  const out = new Map()
  if (!Array.isArray(arr)) return out
  for (const it of arr) if (it && typeof it.id === 'string') out.set(it.id, it)
  return out
}

/** recursive id → node map over `.children` */
function indexNodes(nodes, out = new Map()) {
  if (!Array.isArray(nodes)) return out
  for (const n of nodes) {
    if (n && typeof n.id === 'string') out.set(n.id, n)
    indexNodes(n?.children, out)
  }
  return out
}

// ---- field sanitizers (all guard types, never throw) --------------------

/** rich text emits its sanitized subset; plain text passes through unchanged.
 * `''` is a legitimate value (clears the content); a non-string is "absent". */
function cleanContent(v) {
  if (typeof v !== 'string') return undefined
  return isRich(v) ? sanitizeRich(v) : v
}

/** a media src: `''` clears it, a SAFE_SRC value passes, anything else
 * (javascript:, etc.) is dropped → the stored value is kept. */
function cleanSrc(v) {
  if (typeof v !== 'string') return undefined
  if (v === '') return ''
  return SAFE_SRC.test(v) ? v : undefined
}

/** node.locales: Record<code, {content?, src?}> — cleaned + empties pruned.
 * Returns undefined when the incoming value isn't an object ("absent" → keep
 * stored); returns a (possibly empty) map otherwise, so clears are honored. */
function sanitizeNodeLocales(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined
  const out = {}
  for (const [code, val] of Object.entries(obj)) {
    if (typeof code !== 'string' || !val || typeof val !== 'object') continue
    const entry = {}
    const c = cleanContent(val.content)
    if (c !== undefined) entry.content = c
    const s = cleanSrc(val.src)
    if (s !== undefined) entry.src = s
    if (Object.keys(entry).length) out[code] = entry
  }
  return out
}

/** {title?, description?} — coerced to strings, only defined keys kept.
 * Returns undefined when the incoming value isn't an object. */
function cleanSeo(seo) {
  if (!seo || typeof seo !== 'object' || Array.isArray(seo)) return undefined
  const out = {}
  if (typeof seo.title === 'string') out.title = seo.title
  if (typeof seo.description === 'string') out.description = seo.description
  return out
}

/** entry.values: Record<field, string | string[]>. Rich strings sanitized;
 * string[] kept as strings; other value types dropped. */
function sanitizeValues(values) {
  const out = {}
  if (!values || typeof values !== 'object' || Array.isArray(values)) return out
  for (const [field, val] of Object.entries(values)) {
    if (typeof field !== 'string') continue
    if (Array.isArray(val)) {
      out[field] = val.filter((v) => typeof v === 'string')
    } else if (typeof val === 'string') {
      out[field] = isRich(val) ? sanitizeRich(val) : val
    }
  }
  return out
}

/** entry.locales: Record<code, Record<field, string>> — rich-cleaned + pruned */
function sanitizeEntryLocales(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined
  const out = {}
  for (const [code, fields] of Object.entries(obj)) {
    if (typeof code !== 'string' || !fields || typeof fields !== 'object') continue
    const clean = {}
    for (const [field, val] of Object.entries(fields)) {
      if (typeof field !== 'string' || typeof val !== 'string') continue
      clean[field] = isRich(val) ? sanitizeRich(val) : val
    }
    if (Object.keys(clean).length) out[code] = clean
  }
  return out
}

/** full CRUD: the entries array is taken from incoming, each coerced to the
 * known CollectionEntry shape. Entries without a string id are dropped. */
function sanitizeEntries(arr) {
  const out = []
  if (!Array.isArray(arr)) return out
  for (const e of arr) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string') continue
    const entry = {
      id: e.id,
      name: typeof e.name === 'string' ? e.name : '',
      slug: typeof e.slug === 'string' ? e.slug : '',
      values: sanitizeValues(e.values),
      createdAt: typeof e.createdAt === 'number' ? e.createdAt : Date.now(),
    }
    const loc = sanitizeEntryLocales(e.locales)
    if (loc && Object.keys(loc).length) entry.locales = loc
    if (typeof e.status === 'string') entry.status = e.status
    const seo = cleanSeo(e.seo)
    if (seo && Object.keys(seo).length) entry.seo = seo
    if (typeof e.updatedAt === 'number') entry.updatedAt = e.updatedAt
    if (typeof e.createdBy === 'string') entry.createdBy = e.createdBy
    if (typeof e.updatedBy === 'string') entry.updatedBy = e.updatedBy
    out.push(entry)
  }
  return out
}

/** comments render as text, so no HTML sanitize — just coerce to the known
 * shape (they are shared across branches; keep other roles' editor safe). */
function sanitizeComments(arr) {
  const out = []
  if (!Array.isArray(arr)) return out
  for (const c of arr) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string') continue
    const comment = {
      id: c.id,
      pageId: typeof c.pageId === 'string' ? c.pageId : '',
      text: typeof c.text === 'string' ? c.text : '',
      author: typeof c.author === 'string' ? c.author : '',
      resolved: !!c.resolved,
      createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
      replies: [],
    }
    if (typeof c.authorId === 'string') comment.authorId = c.authorId
    if (c.anchor && typeof c.anchor === 'object' && typeof c.anchor.nodeId === 'string') {
      comment.anchor = {
        nodeId: c.anchor.nodeId,
        rx: Number(c.anchor.rx) || 0,
        ry: Number(c.anchor.ry) || 0,
      }
      // which canvas frame the pin was dropped in. Dropping it would move the
      // comment to whichever frame renders first, which is the bug this field
      // exists to fix — so it has to survive the contributor merge too.
      if (typeof c.anchor.breakpointId === 'string') {
        comment.anchor.breakpointId = c.anchor.breakpointId
      }
    }
    if (typeof c.breakpointId === 'string' || c.breakpointId === null) {
      comment.breakpointId = c.breakpointId
    }
    if (typeof c.x === 'number') comment.x = c.x
    if (typeof c.y === 'number') comment.y = c.y
    if (Array.isArray(c.replies)) {
      for (const r of c.replies) {
        if (!r || typeof r !== 'object' || typeof r.id !== 'string') continue
        comment.replies.push({
          id: r.id,
          text: typeof r.text === 'string' ? r.text : '',
          author: typeof r.author === 'string' ? r.author : '',
          ...(typeof r.authorId === 'string' ? { authorId: r.authorId } : {}),
          createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
        })
      }
    }
    out.push(comment)
  }
  return out
}

/** clone a stored node, overlaying content/src/locales from the incoming node
 * with the same id; recurse over STORED children only (never incoming). */
function overlayNode(node, incById) {
  if (!node || typeof node !== 'object') return node
  const out = { ...node }
  const inc = typeof node.id === 'string' ? incById.get(node.id) : undefined
  // a custom-code block's content is raw HTML the exporter emits verbatim —
  // the one leaf whose text is code, not copy — so it is not content a
  // contributor may write; the stored value stays (protectedWriteDenial
  // refuses the write out loud before this runs)
  if (inc && node.type !== 'custom-code') {
    const c = cleanContent(inc.content)
    if (c !== undefined) out.content = c
    const s = cleanSrc(inc.src)
    if (s !== undefined) out.src = s
    const bg = cleanSrc(inc.background)
    if (bg !== undefined) out.background = bg
    const loc = sanitizeNodeLocales(inc.locales)
    if (loc !== undefined) out.locales = loc
  }
  if (Array.isArray(node.children)) {
    out.children = node.children.map((ch) => overlayNode(ch, incById))
  }
  return out
}

/**
 * Build the blob to persist for a contributor's project write.
 * @param {string|null} storedStr  the current blob for this key (null = new draft)
 * @param {string|null} mainStr    guano-project:main blob (baseline for a new draft)
 * @param {string} incomingStr     the contributor's raw PUT/publish body
 * @returns {{ ok: true, merged: string } | { error: string }}
 */
export function mergeContributorProject(storedStr, mainStr, incomingStr) {
  const incoming = parseOrNull(incomingStr)
  if (!incoming || typeof incoming !== 'object') {
    return { error: 'invalid project snapshot' }
  }

  // structure comes from the stored copy; a new draft falls back to Main (a
  // contributor may only ever hold a copy of Main). Fail closed if both gone.
  const baseStr = parseOrNull(storedStr) ? storedStr : parseOrNull(mainStr) ? mainStr : null
  if (!baseStr) return { error: 'contributors cannot create a project' }
  const merged = JSON.parse(baseStr) // fresh deep clone — the structural truth

  const incPages = indexById(incoming.pages)
  const incCollections = indexById(incoming.collections)

  if (Array.isArray(merged.pages)) {
    for (const page of merged.pages) {
      const inc = page && typeof page.id === 'string' ? incPages.get(page.id) : undefined
      if (!inc) continue
      const byId = indexNodes(inc.elements)
      if (Array.isArray(page.elements)) {
        page.elements = page.elements.map((n) => overlayNode(n, byId))
      }
      const seo = cleanSeo(inc.seo)
      if (seo !== undefined) page.seo = seo
      if (typeof inc.status === 'string') page.status = inc.status
      if (typeof inc.updatedAt === 'number') page.updatedAt = inc.updatedAt
      if (typeof inc.updatedBy === 'string') page.updatedBy = inc.updatedBy
    }
  }

  if (Array.isArray(merged.collections)) {
    for (const col of merged.collections) {
      const inc = col && typeof col.id === 'string' ? incCollections.get(col.id) : undefined
      if (!inc || !Array.isArray(inc.entries)) continue
      col.entries = sanitizeEntries(inc.entries)
    }
  }

  if (Array.isArray(incoming.comments)) {
    merged.comments = sanitizeComments(incoming.comments)
  }

  return { ok: true, merged: JSON.stringify(merged) }
}

/**
 * Build the blob to persist for a REVIEWER's project write: the stored copy,
 * whole, with only `comments` taken from theirs. A reviewer reads the site and
 * leaves comments — no content, no entries, no page status, nothing a
 * contributor may touch — so the allowlist is one key. Comments are shared
 * across drafts and never merged, which is why this needs no Main fallback:
 * a reviewer holds no drafts, and a write to a key with nothing stored is
 * refused rather than creating one.
 * @param {string|null} storedStr  the current blob for this key
 * @param {string} incomingStr     the reviewer's raw PUT body
 * @returns {{ ok: true, merged: string } | { error: string }}
 */
export function mergeReviewerProject(storedStr, incomingStr) {
  const incoming = parseOrNull(incomingStr)
  if (!incoming || typeof incoming !== 'object') return { error: 'invalid project snapshot' }
  if (!parseOrNull(storedStr)) return { error: 'reviewers can only add comments' }
  const merged = JSON.parse(storedStr)
  if (Array.isArray(incoming.comments)) merged.comments = sanitizeComments(incoming.comments)
  return { ok: true, merged: JSON.stringify(merged) }
}

/**
 * Strip server-side secrets from a project blob before returning it to a
 * contributor on read (S4). Safe precisely because contributor WRITES ignore
 * incoming `settings` entirely, so a redacted round-trip can never blank the
 * real values. Returns the input unchanged when it can't be parsed (it's the
 * contributor's own draft; nothing is exposed that Main didn't already gate).
 * @param {string} str  a stored project blob
 * @returns {string}
 */
export function redactSecretsForContributor(str) {
  const project = parseOrNull(str)
  if (!project || typeof project !== 'object') return str
  if (project.settings && typeof project.settings === 'object') {
    // Both are DEPRECATED and deleted from every blob by the boot migration
    // (server/index.mjs migrateIntegrations) — integrations live entirely
    // server-side now. This stays as the defence for a blob that arrived some
    // other way (an import, a restore) before that boot ran. `delete`, not
    // `= null`: a contributor write ignores `settings` wholesale, so the key
    // simply must not be there.
    delete project.settings.smtp
    delete project.settings.integrations
  }
  return JSON.stringify(project)
}

/**
 * Server-authoritative merge for the DRAFT INDEX (`guano-branches`) on a
 * contributor write.
 *
 * Why this exists. The store's PUT path ran the content merge only for project
 * blob keys; every other key was written verbatim. `guano-branches` is the
 * blob that records who created each draft, and `ownsDraft` — the gate on
 * DELETE — trusts it. So a contributor could PUT that index with their own id
 * stamped on somebody else's draft and then delete it. The index is UI state
 * with an authorization field inside it, which is the whole problem.
 *
 * The rule here mirrors `ownsDraft` exactly, including its legacy case: an
 * entry with no `createdBy` predates ownership tracking and stays shared, so
 * an upgrade does not strand anyone's work. An entry owned by someone else is
 * protected — it must come back unchanged, and an attempt to alter or drop it
 * is REFUSED BY NAME rather than quietly reverted, because a silent revert
 * reads as success and nobody learns something tried.
 *
 * `createdBy` on anything incoming is forced to the writer, so a contributor
 * cannot plant another person's id on a draft they are creating.
 *
 * Returns `{ merged }` or `{ error }`.
 */
export function mergeBranchesMeta(storedStr, incomingStr, userId) {
  const incoming = parseOrNull(incomingStr)
  if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.branches)) {
    return { error: 'invalid draft index' }
  }
  const stored = parseOrNull(storedStr)
  const storedBranches = Array.isArray(stored?.branches) ? stored.branches : []

  // owned by someone else = protected. No createdBy = legacy, shared.
  const guarded = new Map(
    storedBranches
      .filter((b) => b?.id && b.createdBy && b.createdBy !== userId)
      .map((b) => [b.id, b]),
  )
  const incomingById = new Map(incoming.branches.filter((b) => b?.id).map((b) => [b.id, b]))

  for (const [id, mine] of guarded) {
    const theirs = incomingById.get(id)
    if (!theirs) {
      return { error: `cannot discard a draft you do not own (${mine.name || id})` }
    }
    if (JSON.stringify(theirs) !== JSON.stringify(mine)) {
      return { error: `cannot change a draft you do not own (${mine.name || id})` }
    }
  }

  const branches = incoming.branches
    .filter((b) => b?.id)
    .map((b) => (guarded.has(b.id) ? guarded.get(b.id) : { ...b, createdBy: userId }))

  return { merged: JSON.stringify({ activeId: incoming.activeId ?? 'main', branches }) }
}
