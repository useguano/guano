// Forms: the field rules, shared VERBATIM by the editor's Data panel, the
// exporter's manifest, the public endpoint's validation and the MCP publish
// warnings. Plain JS so the node server can import it (like slider.js).
//
// The point of one implementation: the server validates a submission against
// what the EXPORT declared, and the Data panel tells the author what that will
// be. If those two readings of a form's subtree ever disagree, a field the
// author can see is a field the server discards.

/** per-kind caps, in characters. A textarea is the long one by design. */
export const FIELD_CAPS = {
  text: 1000,
  email: 254, // RFC 5321's practical maximum
  tel: 40,
  url: 2048,
  number: 40,
  textarea: 10_000,
  select: 200,
  checkbox: 200,
  radio: 200,
}

/** which element types are form controls, and the kind each defaults to */
const CONTROL_KINDS = {
  input: 'text',
  textarea: 'textarea',
  select: 'select',
  dropdown: 'select',
  checkbox: 'checkbox',
  radio: 'radio',
}

/** an `<input type="…">` the browser validates, mapped to our kinds.
 *
 * `radio` and `checkbox` are here as well as being element types of their own:
 * the registry bakes the attribute for `:radio`/`:checkbox`, but a plain
 * `:input` can carry `type="radio"` through the Attributes rows, and reading
 * that as text would lose the value grouping AND the option allowlist the
 * endpoint checks against. */
const INPUT_TYPE_KINDS = {
  email: 'email',
  tel: 'tel',
  url: 'url',
  number: 'number',
  text: 'text',
  search: 'text',
  password: 'text',
  radio: 'radio',
  checkbox: 'checkbox',
}

/** the state blocks, which are never submitted and never repeated */
export const FORM_STATE_TYPES = ['form-success', 'form-error']

/** is this node a form control that could carry a name? */
export const isFormControl = (type) => Object.hasOwn(CONTROL_KINDS, type)

/**
 * Every named field of one form, plus the controls that have no name.
 *
 * `resolve(node)` gives the effective attributes of a node — the caller passes
 * the one that knows about component instances (a control inside a `<Field>`
 * reads its name from the master, and its per-placement override from
 * `instanceAttributes`). Without that indirection a form built from components
 * would report no fields at all.
 *
 * `opts.hidden(node)` marks a subtree that is not rendered — a part an
 * instance hides, resolved along the instance chain. Those controls are not
 * emitted on the page and cannot be submitted, so counting them produced the
 * nonsense "N control(s) have no usable name" for a Field component whose
 * optional textarea was hidden, and put a field the page never shows into the
 * manifest's allowlist.
 *
 * `opts.content(node)` is the matching read for an element's TEXT, used for a
 * `<select>`'s option values. Omitted = the node's own.
 *
 * Returns `{fields, unnamed, duplicates}`. `fields` is what the manifest
 * stores and the endpoint allowlists against.
 */
export function collectFormFields(formNode, resolve, opts) {
  const fields = []
  const unnamed = []
  const seen = new Map()

  const attrsOf = (node) => (resolve ? resolve(node) ?? {} : node.attributes ?? {})
  const contentOf = (node) =>
    (opts && opts.content ? opts.content(node) : undefined) ?? node.content ?? ''

  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    // a nested form is its own (invalid) thing; its controls are not ours
    if (node !== formNode && node.type === 'form') return
    // success/error blocks are chrome, never submitted
    if (FORM_STATE_TYPES.includes(node.type)) return
    // a hidden part renders nowhere, so it submits nothing
    if (node !== formNode && opts && opts.hidden && opts.hidden(node)) return

    if (isFormControl(node.type)) {
      const attrs = attrsOf(node)
      const name = String(attrs.name ?? '').trim()
      if (!name) {
        unnamed.push({ id: node.id, type: node.type })
      } else if (name.startsWith('_')) {
        // reserved: the WHOLE `_` space is the runtime's (`_hp`, `_t`,
        // `_route`, `_entry`), so the prefix is the rule rather than a list
        unnamed.push({ id: node.id, type: node.type, reserved: true, name })
      } else {
        const kind = kindFor(node, attrs)
        const field = {
          name,
          kind,
          required: attrs.required === '' || attrs.required === 'required' || attrs.required === 'true',
          maxLength: capFor(kind, attrs.maxlength),
        }
        if (kind === 'select') field.options = optionValues(node, attrsOf, contentOf)
        if (kind === 'radio' || kind === 'checkbox') {
          field.value = String(attrs.value ?? 'on')
        }
        const prior = seen.get(name)
        if (prior) {
          // radios sharing a name are ONE field with several values; anything
          // else sharing a name is an authoring mistake worth reporting
          if (prior.kind === 'radio' && kind === 'radio') {
            prior.options = [...new Set([...(prior.options ?? []), field.value])]
          } else {
            prior.duplicate = true
          }
        } else {
          if (kind === 'radio') field.options = [field.value]
          seen.set(name, field)
          fields.push(field)
        }
      }
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(formNode)

  return {
    fields,
    unnamed,
    duplicates: fields.filter((f) => f.duplicate).map((f) => f.name),
  }
}

function kindFor(node, attrs) {
  const base = CONTROL_KINDS[node.type] ?? 'text'
  if (node.type !== 'input') return base
  const type = String(attrs.type ?? 'text').toLowerCase()
  return INPUT_TYPE_KINDS[type] ?? 'text'
}

function capFor(kind, maxlength) {
  const ceiling = FIELD_CAPS[kind] ?? FIELD_CAPS.text
  const own = Number(maxlength)
  // the author's own cap wins only when it is TIGHTER — a maxlength of 90000
  // on a text input must not raise the storage ceiling
  return Number.isFinite(own) && own > 0 ? Math.min(own, ceiling) : ceiling
}

/**
 * The values a `<select>` offers, from its option children.
 *
 * `attrsOf`/`contentOf` are the caller's resolvers, the same ones the rest of
 * this walk uses — an `<option>` inside a component INSTANCE carries no value
 * and no text of its own, both come from the master. Reading the raw node
 * recorded `options: ["", ""]` in the manifest, and the endpoint then refused
 * every value the page actually offers: a visitor picking "Designer" got a 400
 * saying "role is not one of the offered values".
 */
function optionValues(node, attrsOf, contentOf) {
  const out = []
  for (const child of node.children ?? []) {
    if (child.type !== 'option') continue
    const attrs = attrsOf(child)
    const value = attrs.value ?? contentOf(child)
    out.push(String(value ?? ''))
  }
  return out
}

// ---------- submission validation (the endpoint's half) ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const TEL_RE = /^[\d\s+().-]{4,40}$/

/** strip control characters except tab/newline, and normalize to NFC */
export function cleanValue(raw) {
  return String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .normalize('NFC')
    .trim()
}

/**
 * Validate one submission against a manifest's field list.
 *
 * Returns `{values}` or `{error, field}`. The allowlist is the manifest, so a
 * name the form never declared is DISCARDED rather than refused: a bot adding
 * junk keys must not be able to make a real visitor's submission fail, and a
 * stale cached page posting one extra field should still go through.
 */
export function validateSubmission(fields, params) {
  const values = {}
  for (const field of fields) {
    const kind = field.kind
    if (kind === 'checkbox') {
      // an unchecked box submits nothing at all
      const present = params.getAll(field.name).filter((v) => v !== '')
      if (field.required && !present.length) {
        return { error: `${field.name} is required`, field: field.name }
      }
      values[field.name] = present.length > 0
      continue
    }
    const all = params.getAll(field.name).map(cleanValue).filter((v) => v !== '')
    const raw = all[0] ?? ''
    if (!raw) {
      if (field.required) return { error: `${field.name} is required`, field: field.name }
      continue
    }
    if (raw.length > field.maxLength) {
      return { error: `${field.name} is too long`, field: field.name }
    }
    if (kind === 'email' && !EMAIL_RE.test(raw)) {
      return { error: `${field.name} is not an email address`, field: field.name }
    }
    if (kind === 'tel' && !TEL_RE.test(raw)) {
      return { error: `${field.name} is not a phone number`, field: field.name }
    }
    if (kind === 'url') {
      try {
        const url = new URL(raw)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme')
      } catch {
        return { error: `${field.name} is not a URL`, field: field.name }
      }
    }
    if (kind === 'number' && !Number.isFinite(Number(raw))) {
      return { error: `${field.name} is not a number`, field: field.name }
    }
    if ((kind === 'select' || kind === 'radio') && field.options?.length) {
      if (!field.options.includes(raw)) {
        return { error: `${field.name} is not one of the offered values`, field: field.name }
      }
    }
    values[field.name] = raw
  }
  return { values }
}

// ---------- the node's own config ----------

/** a redirect must be an internal route: a root-relative path, nothing else */
export function isInternalRoute(value) {
  const text = String(value ?? '')
  if (!text) return true // empty = show the success block
  if (!text.startsWith('/')) return false
  if (text.startsWith('//')) return false // protocol-relative — another origin
  if (/[\\]/.test(text)) return false
  try {
    // a scheme anywhere, or a backslash trick, is not a route
    if (new URL(text, 'https://x.invalid').origin !== 'https://x.invalid') return false
  } catch {
    return false
  }
  return true
}

/** the reason this form config is unusable, or null */
export function formConfigError(config) {
  if (!config || typeof config !== 'object') return null
  if (config.redirect && !isInternalRoute(config.redirect)) {
    return 'redirect must be a path on this site, like /thanks'
  }
  if (config.name !== undefined && String(config.name).length > 80) {
    return 'a form name is at most 80 characters'
  }
  if (config.externalAction) {
    if (config.enabled) {
      return 'a form cannot both accept submissions here and post to another service'
    }
    try {
      if (new URL(config.externalAction).protocol !== 'https:') {
        return 'the external action must be an https:// URL'
      }
    } catch {
      return 'the external action must be an https:// URL'
    }
  }
  return null
}

/** does this form take submissions on this instance? */
export const formEnabled = (config) => !!config && config.enabled === true

/** the label a form is listed under */
export const formName = (config) => {
  const name = String(config?.name ?? '').trim()
  return name || 'Form'
}

/** the class the honeypot wears. Off-screen, NOT display:none — some bots
 *  skip hidden inputs, which is exactly the signal we want them to trip. */
export const HONEYPOT_CLASS = 'gf-hp'
export const HONEYPOT_CSS =
  '.gf-hp{position:absolute!important;left:-9999px!important;width:1px!important;' +
  'height:1px!important;overflow:hidden!important;opacity:0!important}'

/** the minimum time a human takes to fill a form, in ms */
export const MIN_FILL_MS = 1500
