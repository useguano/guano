import { computed, ref } from 'vue'
import { useProject } from './useProject'
import { usePage } from './usePage'
import { useAuth } from './useAuth'
import { slugify } from '@/lib/shared/slug.js'
import { createBody } from '@/lib/factories'
import { createNode } from '@/lib/elements'
import { entrySlug, entryRoutePath } from '@/lib/shared/slug.js'
import { deepClone, walkNodes } from '@/lib/tree'
import type { Collection, CollectionEntry, CollectionField, Page } from '@/types/editor'
import { uid } from '@/lib/shared/ids.js'

/** entry loaded into the template canvas for editing */
const activeEntryId = ref<string | null>(null)

export function useCollections() {
  const { project } = useProject()
  const { activePage, setActivePage, homePage } = usePage()
  const { name: authName, email: authEmail } = useAuth()
  const actor = () => authName.value || authEmail.value || 'Someone'

  const collections = computed(() => project.value.collections)

  function collectionByName(name: string): Collection | null {
    return collections.value.find((c) => c.name === name) ?? null
  }

  function collectionById(id: string): Collection | null {
    return collections.value.find((c) => c.id === id) ?? null
  }

  /** the collection whose template is the active page, if any */
  const activeCollection = computed(() =>
    activePage.value.collectionId ? collectionById(activePage.value.collectionId) : null,
  )

  const activeEntry = computed(
    () => activeCollection.value?.entries.find((e) => e.id === activeEntryId.value) ?? null,
  )

  function createCollection(rawName: string): Collection | null {
    const name = rawName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (!name || collectionByName(name)) return null

    const label = name.charAt(0).toUpperCase() + name.slice(1)
    // the template scaffold: a section holding the entry's title, so the page
    // renders something the moment the collection exists
    const title = createNode('h1')
    title.arg = 'title'
    const section = createNode('section')
    section.children.push(title)
    const body = createBody(name)
    body.children.push(section)
    const now = Date.now()
    const page: Page = {
      id: uid(),
      name: label,
      path: `/${name}`,
      status: 'published',
      elements: [body],
      collectionId: '',
      createdAt: now,
      updatedAt: now,
      createdBy: actor(),
      updatedBy: actor(),
    }
    const collection: Collection = {
      id: uid(),
      name,
      fields: [{ id: uid(), name: 'title', type: 'text' }],
      templatePageId: page.id,
      entries: [],
    }
    page.collectionId = collection.id
    project.value.pages.push(page)
    project.value.collections.push(collection)
    setActivePage(page.id)
    return collection
  }

  function addField(collection: Collection, name = 'field') {
    let unique = name
    let n = 2
    while (collection.fields.some((f) => f.name === unique)) unique = `${name}${n++}`
    collection.fields.push({ id: uid(), name: unique, type: 'text' })
  }

  function removeField(collection: Collection, fieldId: string) {
    collection.fields = collection.fields.filter((f) => f.id !== fieldId)
  }

  function addEntry(collection: Collection): CollectionEntry {
    const n = collection.entries.length + 1
    const name = `${collection.name} ${n}`
    let slug = slugify(name)
    let i = n
    while (collection.entries.some((e) => e.slug === slug)) slug = `${slugify(collection.name)}-${++i}`
    const now = Date.now()
    const entry: CollectionEntry = {
      id: uid(),
      name,
      slug,
      values: {},
      status: 'published',
      createdAt: now,
      updatedAt: now,
      createdBy: actor(),
      updatedBy: actor(),
    }
    collection.entries.push(entry)
    return entry
  }

  /** full route path of an entry: /<collection>/<slug> */
  /** the entry's site path, or null for a data-only collection (no detail
   * routes) — callers render the element unlinked rather than linking nowhere */
  function entryPath(collection: Collection, entry: CollectionEntry): string | null {
    return entryRoutePath(collection, entry)
  }

  function duplicateEntry(collection: Collection, entryId: string): CollectionEntry | null {
    const source = collection.entries.find((e) => e.id === entryId)
    if (!source) return null
    let slug = `${source.slug}-copy`
    let n = 2
    while (collection.entries.some((e) => e.slug === slug)) slug = `${source.slug}-copy-${n++}`
    const now = Date.now()
    const entry: CollectionEntry = {
      id: uid(),
      name: `${source.name} copy`,
      slug,
      values: { ...source.values },
      locales: source.locales ? deepClone(source.locales) : undefined,
      status: source.status ?? 'published',
      seo: source.seo ? { ...source.seo } : undefined,
      createdAt: now,
      updatedAt: now,
      createdBy: actor(),
      updatedBy: actor(),
    }
    collection.entries.push(entry)
    return entry
  }

  function removeEntry(collection: Collection, entryId: string) {
    collection.entries = collection.entries.filter((e) => e.id !== entryId)
    if (activeEntryId.value === entryId) activeEntryId.value = null
  }

  /** duplicates a collection: fields, template page (fresh node ids), and entries */
  function duplicateCollection(collection: Collection): Collection | null {
    const template = project.value.pages.find((p) => p.id === collection.templatePageId)
    if (!template) return null

    let name = `${collection.name}-copy`
    let n = 2
    while (collectionByName(name)) name = `${collection.name}-copy-${n++}`
    const label = name.charAt(0).toUpperCase() + name.slice(1)

    const page = deepClone(template) as Page
    page.id = uid()
    walkNodes(page.elements, (node) => {
      node.id = uid()
      if (node.type === 'body') node.arg = name // rebind :body[name] to the copy
    })
    page.name = `${label} template`
    page.path = `/${name}`
    page.createdAt = page.updatedAt = Date.now()
    page.createdBy = page.updatedBy = actor()

    // entries get fresh ids, so self-references must follow them (fields
    // pointing at OTHER collections keep targeting the originals)
    const entryIdMap = new Map(collection.entries.map((e) => [e.id, uid()]))
    const copyId = uid()
    const selfRefFields = collection.fields.filter(
      (f) =>
        (f.type === 'reference' || f.type === 'multi-reference') &&
        f.refCollectionId === collection.id,
    )
    const copy: Collection = {
      id: copyId,
      name,
      fields: collection.fields.map((f) => ({
        ...f,
        id: uid(),
        refCollectionId: f.refCollectionId === collection.id ? copyId : f.refCollectionId,
      })),
      templatePageId: page.id,
      entries: collection.entries.map((e) => {
        const values = { ...e.values }
        for (const f of selfRefFields) {
          const v = values[f.name]
          if (Array.isArray(v)) values[f.name] = v.map((id) => entryIdMap.get(id) ?? id)
          else if (typeof v === 'string' && v) values[f.name] = entryIdMap.get(v) ?? v
        }
        return {
          ...e,
          id: entryIdMap.get(e.id)!,
          values,
          locales: e.locales ? deepClone(e.locales) : undefined,
        }
      }),
    }
    page.collectionId = copy.id
    project.value.pages.push(page)
    project.value.collections.push(copy)
    return copy
  }

  /** deletes a collection with its template page and entries */
  function removeCollection(collection: Collection) {
    const onTemplate = activePage.value.id === collection.templatePageId
    project.value.pages = project.value.pages.filter((p) => p.id !== collection.templatePageId)
    project.value.collections = project.value.collections.filter((c) => c.id !== collection.id)
    if (collection.entries.some((e) => e.id === activeEntryId.value)) activeEntryId.value = null
    if (onTemplate) setActivePage(homePage.value.id)
  }

  /** edit an entry's identity fields (name/slug/status). Slug is slugified to
   * match the code-editor write-back path. Stamps updatedAt/updatedBy. */
  function updateEntryMeta(
    collection: Collection,
    entryId: string,
    patch: { name?: string; slug?: string; status?: string },
  ) {
    const entry = collection.entries.find((e) => e.id === entryId)
    if (!entry) return
    if (patch.name !== undefined) entry.name = patch.name
    if (patch.slug !== undefined) entry.slug = slugify(patch.slug)
    if (patch.status !== undefined) entry.status = patch.status
    entry.updatedAt = Date.now()
    entry.updatedBy = actor()
  }

  /**
   * Open the collection's template with this entry loaded for editing.
   *
   * A DATA-ONLY collection (`detailRoutes: false`) stores `templatePageId: ''`
   * — there is no page to navigate to, and `setActivePage('')` would silently
   * land on `pages[0]` (usePage's activePage falls back to the first page), so
   * clicking such an entry used to jump the canvas to an unrelated page with
   * `activeEntryId` set while `activeEntry` stayed null. Bail instead, and
   * leave `activeEntryId` alone: `activeEntry` resolves null either way, and
   * setting it would make useHeaderNav claim entry context and blank out every
   * page row. Returns whether the canvas actually moved.
   */
  function openEntry(collection: Collection, entryId: string): boolean {
    const template = project.value.pages.find((p) => p.id === collection.templatePageId)
    if (!template) return false
    setActivePage(template.id)
    activeEntryId.value = entryId
    return true
  }

  /** field of a collection matched by an element's arg */
  function fieldFor(collection: Collection | null, arg?: string): CollectionField | null {
    if (!collection || !arg) return null
    return collection.fields.find((f) => f.name === arg) ?? null
  }

  return {
    collections,
    collectionByName,
    collectionById,
    activeCollection,
    activeEntryId,
    activeEntry,
    createCollection,
    addField,
    removeField,
    addEntry,
    duplicateEntry,
    removeEntry,
    updateEntryMeta,
    duplicateCollection,
    removeCollection,
    openEntry,
    fieldFor,
    entrySlug,
    entryPath,
  }
}
