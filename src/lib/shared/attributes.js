// Custom HTML attribute allowlist, shared VERBATIM by the client renderers
// (via useRenderNode), the static exporter (server/export.mjs), the Data
// panel, and the MCP edit_elements tool — plain JS so every side sanitizes
// the same way. Attributes the renderer already manages (id/class/style/
// src/href) and anything executable (on* handlers) are refused so custom
// attributes can't shadow editor state or inject script into the export.

/** attribute names allowed verbatim */
const ATTR_ALLOW = new Set([
  'target', 'rel', 'download', 'title', 'role', 'type', 'name', 'value',
  'placeholder', 'alt', 'loading', 'tabindex', 'lang', 'dir', 'hidden',
  // `sizes` tells the browser how WIDE an image will render, which is the one
  // thing the export cannot know: it emits the srcset, the layout decides the
  // slot. A plain descriptor string, no security surface.
  'sizes',
  'disabled', 'open', 'for', 'required', 'readonly', 'checked', 'selected',
  'multiple', 'autofocus', 'autocomplete', 'min', 'max', 'step', 'rows',
  'cols', 'maxlength', 'minlength', 'pattern', 'inputmode', 'accept',
  // translate="no" marks content that must never be localized (code samples,
  // brand names) — browsers/translators honour it, and the MCP translation
  // worklist excludes the whole subtree
  'translate',
])

/**
 * Attributes whose PRESENCE is the value: `download`, `hidden`, `required`.
 * An empty string is the canonical way to express them, so they must survive
 * sanitization, and they serialize BARE (`<a download>` not `<a download="">`)
 * — `download="false"` would still download, and `hidden=""` vs `hidden` are the
 * same to the parser but only the bare form reads as intended.
 */
export const BOOLEAN_ATTRS = new Set([
  'download', 'hidden', 'disabled', 'open', 'required', 'readonly',
  'checked', 'selected', 'multiple', 'autofocus',
])

/** true when `name` serializes as a bare attribute with an empty value */
export function isBooleanAttribute(name) {
  return BOOLEAN_ATTRS.has(String(name).toLowerCase().trim())
}

/** allowed name prefixes (data-*, aria-*) */
const ATTR_PREFIXES = ['data-', 'aria-']

/**
 * `data-*` names the RENDERERS own, refused as custom attributes.
 *
 * `data-` is an open prefix, so without this an authored attribute can collide
 * with the wiring a renderer emits — and because a duplicate attribute in HTML
 * resolves to the FIRST occurrence, the authored one SHADOWS the renderer's.
 *
 * That was a real hole: `data-form-redirect` carries the post-submission
 * navigation, validated at write AND at export as an internal route
 * (`isInternalRoute`), and the published runtime calls `location.assign` on it.
 * Set as a custom attribute it bypassed both checks, which bought an
 * unconditional open redirect and — because `location.assign` honours a
 * `javascript:` URL — script execution on the published origin. Under the
 * `server` publish method that origin is the one serving `/admin` and `/api`,
 * and setting an attribute is not gated by the agent policy's
 * `allowCustomCode`, so a prompt-injected agent with publish rights could ship
 * it.
 *
 * Matched by exact name or by prefix for the families (`data-sl-*`). Nothing an
 * author could usefully want is in here: every one of these is a channel
 * between the exporter and its own runtime.
 */
const RESERVED_DATA_ATTRS = new Set([
  // forms: the endpoint, the redirect, the state blocks, the fallback message
  'data-form',
  'data-form-redirect',
  'data-form-success',
  'data-form-error',
  'data-form-fallback',
  // interactions / animations: the state wiring the site runtime reads
  'data-int',
  'data-anim',
  'data-tgt',
  'data-atgt',
  // the carousel's config blob and its chrome
  'data-slider',
  // which channel an element listens on (lib/shared/channels.js)
  'data-channel',
  // identity the editor and the agent format address nodes by
  'data-node-id',
  'data-id',
  'data-ref',
  'data-type',
  'data-source',
])

/** reserved FAMILIES — a prefix the renderer owns outright */
const RESERVED_DATA_PREFIXES = ['data-sl-', 'data-form-']

/**
 * Attributes that belong to the LINK, not to the element carrying it.
 *
 * A non-anchor element with a link is wrapped in a generated `<a>` (see
 * linkWrap in server/export.mjs). These attributes were landing on the inner
 * element, where they do nothing: `target="_blank"` on a `<div>` never opens a
 * new tab, and `aria-label` on a non-interactive div is not announced as the
 * link's name. They hoist onto the generated anchor instead.
 */
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

/** a syntactically valid attribute name (lowercase, no colons/uppercase) */
const NAME_RE = /^[a-z][a-z0-9-]*$/

/** does the renderer own this `data-*` name? (see RESERVED_DATA_ATTRS) */
export function isReservedAttribute(name) {
  const n = String(name).toLowerCase().trim()
  return RESERVED_DATA_ATTRS.has(n) || RESERVED_DATA_PREFIXES.some((p) => n.startsWith(p))
}

/** is `name` an allowed custom attribute? */
export function isAllowedAttribute(name) {
  const n = String(name).toLowerCase().trim()
  if (!NAME_RE.test(n)) return false
  // a renderer-owned name is refused even though `data-` is an open prefix:
  // an authored duplicate shadows the renderer's own value
  if (isReservedAttribute(n)) return false
  if (ATTR_ALLOW.has(n)) return true
  return ATTR_PREFIXES.some((p) => n.startsWith(p) && n.length > p.length)
}

/**
 * Keep only allowed attributes, lowercased names with string values. Returns a
 * fresh object (never mutates the input).
 *
 * EMPTY VALUES ARE KEPT. They used to be dropped, which made `alt=""` (the
 * correct markup for a decorative image) and every boolean attribute
 * (`download`, `hidden`, `required`) unexpressible — and because callers infer
 * the rejection reason by diffing key names, the loss was reported as
 * "attribute not allowed", pointing at the wrong thing entirely.
 *
 * `true` coerces to the empty string (so an agent can pass a real boolean) and
 * `false` drops the attribute (absence IS false for booleans).
 */
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

/**
 * Attributes whose value is TEXT A VISITOR READS, and so can be translated.
 * `type`, `role` and `name` are structural and never localized; these four are
 * copy, and on a multilingual site they used to render in the default language
 * on every locale route with no way to change it.
 */
export const LOCALIZABLE_ATTRS = [
  'placeholder',
  'aria-label',
  'alt',
  'title',
  // the carousel chrome's own words (SLIDER_LABEL_ATTRS in shared/slider.js).
  // Renderer-invented, so they are in no tree and nothing translated them: a
  // French route shipped "Previous slide" on every slider while the worklist
  // reported `missingTranslatable: 0`. Consumed by the slider renderers, never
  // emitted as attributes.
  'data-prev-label',
  'data-next-label',
  'data-dots-label',
  'data-dot-label',
]

/** true when `name` carries text worth translating */
export function isLocalizableAttribute(name) {
  return LOCALIZABLE_ATTRS.includes(String(name).toLowerCase().trim())
}

/**
 * The attributes an element renders: the component master's, with this
 * placement's own overrides on top, then the active locale's text overrides.
 *
 * Shared by both Vue renderers and the exporter so the canvas, Preview and the
 * published page agree. `localeAttrs` is already narrowed to the locale being
 * rendered (absent on the default locale).
 */
export function mergeAttributeLayers(shared, instance, localeAttrs) {
  const out = { ...(shared ?? {}) }
  for (const [name, value] of Object.entries(instance ?? {})) out[name] = value
  for (const [name, value] of Object.entries(localeAttrs ?? {})) {
    // a locale override only applies to copy, and only when it says something
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
