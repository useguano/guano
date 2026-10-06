// @ts-check
/**
 * Structured data (schema.org JSON-LD) for the published site — the block
 * Google reads for the site name, logo and social profiles in rich results.
 * Shared verbatim by the exporter (the tag on every route), the settings panel
 * (the live preview) and the MCP validators, so what the panel shows IS what
 * the page carries.
 *
 * `settings.seo.schema` is the authored half:
 *   { type, sameAs?: string[], custom?: string }
 * The identity's name is `seo.siteName` and its logo `seo.logo`.
 * `custom` is raw JSON-LD an advanced user pastes (one object or an array);
 * it is appended to the generated graph, never merged into it.
 */

export const SCHEMA_TYPES = /** @type {const} */ (['Organization', 'Person', 'LocalBusiness'])

const SAFE_URL = /^https?:\/\/[^\s<>"']+$/i

/** validates the `custom` JSON-LD text; null when it is fine, else the reason */
export function customSchemaError(/** @type {unknown} */ text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return 'Not valid JSON' + (e instanceof Error ? `: ${e.message}` : '')
  }
  const items = Array.isArray(parsed) ? parsed : [parsed]
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Each entry must be a JSON object'
    if (typeof item['@type'] !== 'string') return 'Each entry needs a string "@type"'
  }
  return null
}

/**
 * The graph for one route. `site` is the absolute site origin (https://domain)
 * or '' when no domain is set — then no url fields are emitted, since relative
 * urls mean nothing to a crawler reading JSON-LD.
 * @param {object} args
 * @param {any} args.seo              project.settings.seo (locale-merged)
 * @param {string} args.site          'https://example.com' or ''
 * @param {string} args.path          '/' or '/about/'
 * @param {string} args.locale
 * @param {string} args.title
 * @param {string} args.description
 * @param {(rel: any) => any} [args.absolute]  turns a media path into an absolute url
 * @returns {Record<string, unknown>[]}
 */
export function buildStructuredData({ seo, site, path, locale, title, description, absolute }) {
  const schema = seo?.schema
  /** @type {Record<string, any>[]} */
  const graph = []
  // opt-in: a project that never turned structured data on emits nothing
  if (!schema || typeof schema !== 'object') return graph
  const siteName = String(seo?.siteName ?? '').trim()
  const siteUrl = site ? `${site}/` : undefined
  const pageUrl = site ? `${site}${path || '/'}` : undefined

  if (SCHEMA_TYPES.includes(schema.type)) {
    const name = siteName
    if (name) {
      /** @type {Record<string, any>} */
      const node = { '@type': schema.type, '@id': site ? `${site}/#identity` : '#identity', name }
      if (siteUrl) node.url = siteUrl
      const logo = absolute ? absolute(seo.logo) : seo.logo
      if (logo && SAFE_URL.test(logo)) node[schema.type === 'Person' ? 'image' : 'logo'] = logo
      const sameAs = /** @type {unknown[]} */ (schema.sameAs ?? []).map((s) => String(s).trim()).filter((s) => SAFE_URL.test(s))
      if (sameAs.length) node.sameAs = sameAs
      graph.push(node)
    }
  }

  if (siteName) {
    /** @type {Record<string, any>} */
    const node = { '@type': 'WebSite', '@id': site ? `${site}/#website` : '#website', name: siteName }
    if (siteUrl) node.url = siteUrl
    if (locale) node.inLanguage = locale
    if (graph[0]) node.publisher = { '@id': graph[0]['@id'] }
    graph.push(node)
  }

  if (title) {
    /** @type {Record<string, any>} */
    const node = { '@type': 'WebPage', name: title }
    if (pageUrl) {
      node['@id'] = pageUrl
      node.url = pageUrl
    }
    if (description) node.description = description
    if (locale) node.inLanguage = locale
    const website = graph.find((n) => n['@type'] === 'WebSite')
    if (website) node.isPartOf = { '@id': website['@id'] }
    graph.push(node)
  }

  if (schema.custom && !customSchemaError(schema.custom)) {
    const parsed = JSON.parse(String(schema.custom).trim())
    graph.push(...(Array.isArray(parsed) ? parsed : [parsed]))
  }

  return graph
}

/** the JSON text of a graph — what the panel previews and the tag carries */
export function structuredDataJson(/** @type {Record<string, unknown>[]} */ graph, pretty = false) {
  if (!graph.length) return ''
  const doc = { '@context': 'https://schema.org', '@graph': graph }
  return JSON.stringify(doc, null, pretty ? 2 : 0)
}

/** the head tag; `<` is escaped so pasted custom JSON can never close the script */
export function structuredDataTag(/** @type {Record<string, unknown>[]} */ graph) {
  const json = structuredDataJson(graph)
  if (!json) return ''
  return `<script type="application/ld+json">${json.replaceAll('<', '\\u003c')}</script>`
}
