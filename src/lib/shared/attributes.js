const ATTR_ALLOW = new Set([
  'target', 'rel', 'download', 'title', 'role', 'type', 'name', 'value',
  'placeholder', 'alt', 'loading', 'tabindex', 'lang', 'dir', 'hidden',
  'sizes',
  'disabled', 'open', 'for', 'required', 'readonly', 'checked', 'selected',
  'multiple', 'autofocus', 'autocomplete', 'min', 'max', 'step', 'rows',
  'cols', 'maxlength', 'minlength', 'pattern', 'inputmode', 'accept',
  'translate',
])

export const BOOLEAN_ATTRS = new Set([
  'download', 'hidden', 'disabled', 'open', 'required', 'readonly',
  'checked', 'selected', 'multiple', 'autofocus',
])

export function isBooleanAttribute(name) {
  return BOOLEAN_ATTRS.has(String(name).toLowerCase().trim())
}

const ATTR_PREFIXES = ['data-', 'aria-']

const RESERVED_DATA_ATTRS = new Set([
  'data-form',
  'data-form-redirect',
  'data-form-success',
  'data-form-error',
  'data-form-fallback',
  'data-int',
  'data-anim',
  'data-tgt',
  'data-atgt',
  'data-slider',
  'data-channel',
  'data-node-id',
  'data-id',
  'data-ref',
  'data-type',
  'data-source',
])

const RESERVED_DATA_PREFIXES = ['data-sl-', 'data-form-']

const LINK_ATTRS = new Set([
  'target',
  'rel',
  'download',
  'title',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-current',
])

/**
 * Split sanitized attributes into the ones that belong on a generated `<a>`
 * wrapper and the ones that stay on the element itself. Callers that render a
 * real `<a>` (ELEMENTS[type].tag === 'a') keep everything on the one tag.
 * @param {Record<string,string>} record already-sanitized attributes
 * @returns {{link: Record<string,string>, element: Record<string,string>}}
 */
export function splitLinkAttributes(record) {
  /** @type {Record<string,string>} */
  const link = {}
  /** @type {Record<string,string>} */
  const element = {}
  for (const [name, value] of Object.entries(record ?? {})) {
    if (LINK_ATTRS.has(name)) link[name] = value
    else element[name] = value
  }
  return { link, element }
}

/**
 * `target="_blank"` without `rel` lets the opened page reach back through
 * window.opener. Every surface adds the guard, so an author can't ship the hole
 * by forgetting it. An explicit `rel` is left exactly as authored.
 * @param {Record<string,string>} record
 * @returns {Record<string,string>} a new object when a rel was added
 */
export function withSafeRel(record) {
  if (record?.target !== '_blank' || record.rel) return record
  return { ...record, rel: 'noopener noreferrer' }
}

const NAME_RE = /^[a-z][a-z0-9-]*$/

export function isReservedAttribute(name) {
  const n = String(name).toLowerCase().trim()
  return RESERVED_DATA_ATTRS.has(n) || RESERVED_DATA_PREFIXES.some((p) => n.startsWith(p))
}

export function isAllowedAttribute(name) {
  const n = String(name).toLowerCase().trim()
  if (!NAME_RE.test(n)) return false
  if (isReservedAttribute(n)) return false
  if (ATTR_ALLOW.has(n)) return true
  return ATTR_PREFIXES.some((p) => n.startsWith(p) && n.length > p.length)
}

export function sanitizeAttributes(record) {
  /** @type {Record<string, string>} */
  const out = {}
  if (!record || typeof record !== 'object' || Array.isArray(record)) return out
  for (const [rawName, rawValue] of Object.entries(record)) {
    const name = String(rawName).toLowerCase().trim()
    if (!isAllowedAttribute(name)) continue
    if (rawValue === false) continue
    const value = rawValue == null || rawValue === true ? '' : String(rawValue)
    out[name] = value
  }
  return out
}

/**
 * Serialize one sanitized attribute for static HTML. Boolean attributes with an
 * empty value emit bare; everything else emits `name="value"`, including an
 * explicit empty value.
 * @param {string} name
 * @param {string} value
 * @param {(s: string) => string} escape
 * @returns {string}
 */
export function serializeAttribute(name, value, escape) {
  return value === '' && isBooleanAttribute(name) ? name : `${name}="${escape(value)}"`
}

export const LOCALIZABLE_ATTRS = [
  'placeholder',
  'aria-label',
  'alt',
  'title',
  'data-prev-label',
  'data-next-label',
  'data-dots-label',
  'data-dot-label',
]

export function isLocalizableAttribute(name) {
  return LOCALIZABLE_ATTRS.includes(String(name).toLowerCase().trim())
}

export function mergeAttributeLayers(shared, instance, localeAttrs) {
  const out = { ...(shared ?? {}) }
  for (const [name, value] of Object.entries(instance ?? {})) out[name] = value
  for (const [name, value] of Object.entries(localeAttrs ?? {})) {
    if (isLocalizableAttribute(name) && String(value) !== '') out[name] = value
  }
  return out
}

/**
 * The attributes a node renders, resolved along the WHOLE instance chain.
 *
 * `mergeAttributeLayers` knows two layers, which is right for a node placed
 * directly on a page: the master's shared set, then this placement's own. It is
 * not enough once components NEST. A host holds a mirror of the component it
 * nests, and that mirror is where the host says what it has to say about that
 * placement — a Card's two `OptionCard` radios each needing their own `name`,
 * which is the only way they form separate radio groups.
 *
 * Every reader took `node.instanceAttributes` and the master's and stopped, so
 * a write to a mirror was stored, read back, and rendered NOWHERE: the tool
 * answered `{saved: true, edited: 4}` and every radio on the published page
 * still carried the component's default name, which quietly made four
 * questions one radio group. Same bug class as a class on an instance wrapper,
 * and the same fix: resolve where the renderers resolve everything else.
 *
 * Weakest first: the master's shared set, each host mirror from least to most
 * specific (`mapping.mirrors` runs most-specific first), this node's own
 * placement layer, then the locale's text overrides.
 *
 * @param {object} node the page (or master) node being rendered
 * @param {{master: object, mirrors: object[]}|null|undefined} mapping
 * @param {Record<string,string>|undefined} localeAttrs already narrowed to the
 *        locale being rendered (absent on the default locale)
 */
export function resolveNodeAttributes(node, mapping, localeAttrs) {
  if (!mapping) return mergeAttributeLayers(node?.attributes, node?.instanceAttributes, localeAttrs)
  const out = { ...(mapping.master?.attributes ?? {}) }
  for (let i = (mapping.mirrors?.length ?? 0) - 1; i >= 0; i--) {
    for (const [name, value] of Object.entries(mapping.mirrors[i]?.instanceAttributes ?? {})) {
      out[name] = value
    }
  }
  return mergeAttributeLayers(out, node?.instanceAttributes, localeAttrs)
}
