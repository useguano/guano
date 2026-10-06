import type { Interaction, InteractionBinding, Project } from '@/types/editor'
import { slugify } from './shared/slug.js'
import { migrateProject } from './migrate'
import { defaultSettings } from './settings'
import { walkNodes } from './tree'
import { storeGet } from './store'
import { uid } from './shared/ids.js'

/**
 * One-time split of the old inline interaction model (trigger + classes +
 * timing all on the node) into the shared library + per-element bindings.
 * An old entry has `toClasses` but no `interactionId`; each becomes one
 * library Interaction plus a binding that references it.
 */
function migrateInlineInteractions(project: Project) {
  project.interactions ??= []
  if (project.interactions.length) return // already migrated
  let n = 0
  const trees = [
    ...project.pages.map((p) => p.elements),
    ...(project.components ?? []).map((c) => [c.root]),
  ]
  for (const tree of trees) {
    walkNodes(tree, (node) => {
      if (!node.interactions?.length) return
      node.interactions = node.interactions.map((raw): InteractionBinding => {
        const old = raw as InteractionBinding & Partial<Interaction>
        if (old.interactionId) return old // already a binding
        const animation: Interaction = {
          id: uid(),
          name: `Interaction ${++n}`,
          toClasses: old.toClasses ?? '',
          duration: old.duration ?? 'duration-300',
          easing: old.easing ?? 'ease-out',
        }
        project.interactions.push(animation)
        return {
          id: old.id,
          interactionId: animation.id,
          trigger: old.trigger ?? 'hover',
          targetId: old.targetId ?? null,
        }
      })
    })
  }
}

/** reads and validates a stored project; null on missing/corrupt data.
 * Reads the server-backed store cache — callers hydrate the key first. */
export function readStoredProject(key: string): Project | null {
  try {
    const raw = storeGet(key)
    if (!raw) return null
    return migrateStoredProject(JSON.parse(raw) as Project)
  } catch {
    return null
  }
}

/** validates + backfills a parsed project (localStorage or fetched snapshot) */
export function migrateStoredProject(parsed: Project): Project | null {
  try {
    if (!Array.isArray(parsed.pages) || !parsed.pages.length) return null
    // backfill fields added after a project was first saved
    parsed.components ??= []
    parsed.collections ??= []
    parsed.comments ??= []
    parsed.animations ??= []
    migrateInlineInteractions(parsed)
    for (const comment of parsed.comments) {
      comment.author ||= 'You'
      for (const reply of comment.replies ?? []) reply.author ||= 'You'
    }
    for (const collection of parsed.collections) {
      const multiValue = collection.fields.filter(
        (f) => f.type === 'multi-reference' || f.type === 'multi-image',
      )
      for (const entry of collection.entries) {
        entry.slug ||= slugify(entry.name)
        // multi-reference/multi-image values must be arrays (defensive: a
        // field's type may have changed after values were written)
        for (const field of multiValue) {
          const v = entry.values[field.name]
          if (v !== undefined && !Array.isArray(v)) entry.values[field.name] = v ? [v] : []
        }
      }
    }
    // settings backfills (deep, for forward-compat with older saves)
    const defaults = defaultSettings()
    parsed.settings ??= defaults
    parsed.settings.seo ??= defaults.seo
    parsed.settings.tokens ??= []
    parsed.settings.customCode ??= defaults.customCode
    parsed.settings.fonts ??= defaults.fonts
    // projects saved before custom webfonts existed have no list
    parsed.settings.fonts.custom ??= []
    parsed.settings.domain ??= ''
    parsed.settings.publishing ??= defaults.publishing
    parsed.settings.publishing.github ??= { repo: '', branch: 'main' }
    parsed.settings.publishing.apiOrigin ??= ''
    // `settings.smtp` / `settings.integrations` are deliberately NOT backfilled:
    // both are deprecated, the server deletes them from every blob at boot, and
    // re-adding them here would put them straight back.
    // locale backfills (list before pages: the migration reads it)
    parsed.defaultLocale ||= 'en'
    parsed.locales ??= [parsed.defaultLocale]
    if (!parsed.locales.includes(parsed.defaultLocale)) parsed.locales.unshift(parsed.defaultLocale)
    // '@entry' was the early spelling of the current-entry link sentinel
    for (const page of parsed.pages) {
      walkNodes(page.elements, (node) => {
        if (node.link === '@entry') node.link = '@item'
      })
    }
    // the v2 schema: the tree is the only source of truth. Idempotent, so this
    // is a no-op for anything the server already migrated at boot — it is here
    // for a snapshot that arrived some other way (an import, a merge base read
    // straight out of the store).
    migrateProject(parsed)
    return parsed
  } catch {
    return null
  }
}
