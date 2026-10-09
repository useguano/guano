import type { Interaction, InteractionBinding, Project } from '@/types/editor'
import { slugify } from './shared/slug.js'
import { migrateProject } from './migrate'
import { defaultSettings } from './settings'
import { walkNodes } from './tree'
import { storeGet } from './store'
import { uid } from './shared/ids.js'

function migrateInlineInteractions(project: Project) {
  project.interactions ??= []
  if (project.interactions.length) return
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
        if (old.interactionId) return old
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

export function readStoredProject(key: string): Project | null {
  try {
    const raw = storeGet(key)
    if (!raw) return null
    return migrateStoredProject(JSON.parse(raw) as Project)
  } catch {
    return null
  }
}

export function migrateStoredProject(parsed: Project): Project | null {
  try {
    if (!Array.isArray(parsed.pages) || !parsed.pages.length) return null
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
        for (const field of multiValue) {
          const v = entry.values[field.name]
          if (v !== undefined && !Array.isArray(v)) entry.values[field.name] = v ? [v] : []
        }
      }
    }
    const defaults = defaultSettings()
    parsed.settings ??= defaults
    parsed.settings.seo ??= defaults.seo
    parsed.settings.tokens ??= []
    parsed.settings.customCode ??= defaults.customCode
    parsed.settings.fonts ??= defaults.fonts
    parsed.settings.fonts.custom ??= []
    parsed.settings.domain ??= ''
    parsed.settings.publishing ??= defaults.publishing
    parsed.settings.publishing.github ??= { repo: '', branch: 'main' }
    parsed.settings.publishing.apiOrigin ??= ''
    parsed.defaultLocale ||= 'en'
    parsed.locales ??= [parsed.defaultLocale]
    if (!parsed.locales.includes(parsed.defaultLocale)) parsed.locales.unshift(parsed.defaultLocale)
    for (const page of parsed.pages) {
      walkNodes(page.elements, (node) => {
        if (node.link === '@entry') node.link = '@item'
      })
    }
    migrateProject(parsed)
    return parsed
  } catch {
    return null
  }
}
