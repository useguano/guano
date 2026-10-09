/**
 * normalizes a string into a url slug segment
 * @param {string} value
 * @returns {string}
 */
export function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * an entry's own slug, or one derived from its name (older entries)
 * @param {{ slug?: string, name: string }} entry
 * @returns {string}
 */
export const entrySlug = (entry) => entry.slug || slugify(entry.name)

/**
 * The path prefix a collection's entry routes live under.
 *
 * Defaults to the collection's own name (`/post/<slug>`). A collection may set
 * `routeBase` to move them — `''` puts entries at the site root (`/<slug>`,
 * the WordPress-style layout a real port often has to reproduce). The base is
 * slugified, so it can never escape the output directory.
 * @param {{ name: string, routeBase?: string }} collection
 * @returns {string} '' for root-level, else a slug segment path with no slashes at the edges
 */
export function collectionRouteBase(collection) {
  const raw = collection?.routeBase
  if (raw === undefined || raw === null) return slugify(collection?.name ?? '')
  return String(raw)
    .split('/')
    .map(slugify)
    .filter(Boolean)
    .join('/')
}

/**
 * Does this collection publish a page per entry at all?
 *
 * `detailRoutes: false` is a data-only collection — a board roster, an FAQ set:
 * content that is rendered INSIDE other pages and has no page of its own. Before
 * this existed, every collection claimed routes whether or not anything linked
 * to them, so a data-only collection had to keep a draft template page and live
 * with a publish warning about 404s that could not happen.
 * @param {{ detailRoutes?: boolean }} collection
 * @returns {boolean}
 */
export function hasDetailRoutes(collection) {
  return collection?.detailRoutes !== false
}

/**
 * The site path of one entry, or null when its collection has no detail routes.
 * @param {{ name: string, routeBase?: string, detailRoutes?: boolean }} collection
 * @param {{ slug?: string, name: string }} entry
 * @returns {string|null}
 */
export function entryRoutePath(collection, entry) {
  if (entry?.routePath) return entry.routePath
  if (!hasDetailRoutes(collection)) return null
  const base = collectionRouteBase(collection)
  return `/${base ? `${base}/` : ''}${entrySlug(entry)}`
}
