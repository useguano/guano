import type { Collection, CollectionEntry, Page, Project } from '@/types/editor'
import { entrySlug, collectionRouteBase, hasDetailRoutes } from './shared/slug.js'

export type ResolvedRoute =
  | { kind: 'page'; page: Page; locale: string }
  | { kind: 'entry'; page: Page; collection: Collection; entry: CollectionEntry; locale: string }
  | { kind: 'notfound'; locale: string }

/**
 * Resolves a site path (as typed in a link or URL) to a page or collection
 * entry against the project — Preview's in-preview navigation (drafts
 * included; the published site is static HTML with real links). Also strips
 * a leading non-default locale segment and reports the resolved locale.
 */
export function resolveSitePath(project: Project, rawPath: string): ResolvedRoute {
  let segments = rawPath.split('/').filter(Boolean)

  // locale strip: /fr/... → 'fr' when registered and non-default
  let locale = project.defaultLocale
  if (segments.length && project.locales.includes(segments[0]!) && segments[0] !== project.defaultLocale) {
    locale = segments[0]!
    segments = segments.slice(1)
  }

  const path = '/' + segments.join('/')

  // page by exact path ('/' home, plain pages, bare collection templates)
  const page = project.pages.find((p) => p.path === path) ?? null
  if (page) return { kind: 'page', page, locale }

  // collection entry: <routeBase>/<slug>, where routeBase defaults to the
  // collection name and may be '' (root-level entry slugs). Matched by trying
  // each collection's own base rather than assuming a two-segment path, so a
  // nested base ('blog/archive') and a root-level one both resolve.
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
