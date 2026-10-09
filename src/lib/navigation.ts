import type { Collection, CollectionEntry, Page, Project } from '@/types/editor'
import { entrySlug, collectionRouteBase, hasDetailRoutes } from './shared/slug.js'

export type ResolvedRoute =
  | { kind: 'page'; page: Page; locale: string }
  | { kind: 'entry'; page: Page; collection: Collection; entry: CollectionEntry; locale: string }
  | { kind: 'notfound'; locale: string }

export function resolveSitePath(project: Project, rawPath: string): ResolvedRoute {
  let segments = rawPath.split('/').filter(Boolean)

  let locale = project.defaultLocale
  if (segments.length && project.locales.includes(segments[0]!) && segments[0] !== project.defaultLocale) {
    locale = segments[0]!
    segments = segments.slice(1)
  }

  const path = '/' + segments.join('/')

  const page = project.pages.find((p) => p.path === path) ?? null
  if (page) return { kind: 'page', page, locale }

  for (const collection of project.collections) {
    if (!hasDetailRoutes(collection)) continue
    const base = collectionRouteBase(collection)
    const prefix = base ? `/${base}/` : '/'
    if (!path.startsWith(prefix)) continue
    const slug = path.slice(prefix.length)
    if (!slug || slug.includes('/')) continue
    const template = project.pages.find((p) => p.id === collection.templatePageId) ?? null
    const entry = collection.entries.find((e) => entrySlug(e) === slug) ?? null
    if (template && entry) return { kind: 'entry', page: template, collection, entry, locale }
  }

  return { kind: 'notfound', locale }
}
