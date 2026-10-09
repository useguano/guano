export const FIELD_CAPS = {
  text: 1000,
  email: 254,
  tel: 40,
  url: 2048,
  number: 40,
  textarea: 10_000,
  select: 200,
  checkbox: 200,
  radio: 200,
}

const CONTROL_KINDS = {
  input: 'text',
  textarea: 'textarea',
  select: 'select',
  dropdown: 'select',
  checkbox: 'checkbox',
  radio: 'radio',
}

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

export const FORM_STATE_TYPES = ['form-success', 'form-error']

export const isFormControl = (type) => Object.hasOwn(CONTROL_KINDS, type)

export function collectFormFields(formNode, resolve, opts) {
  const fields = []
  const unnamed = []
  const seen = new Map()

  const attrsOf = (node) => (resolve ? resolve(node) ?? {} : node.attributes ?? {})
  const contentOf = (node) =>
    (opts && opts.content ? opts.content(node) : undefined) ?? node.content ?? ''

  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node !== formNode && node.type === 'form') return
    if (FORM_STATE_TYPES.includes(node.type)) return
    if (node !== formNode && opts && opts.hidden && opts.hidden(node)) return

    if (isFormControl(node.type)) {
      const attrs = attrsOf(node)
      const name = String(attrs.name ?? '').trim()
      if (!name) {
        unnamed.push({ id: node.id, type: node.type })
      } else if (name.startsWith('_')) {
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
  return Number.isFinite(own) && own > 0 ? Math.min(own, ceiling) : ceiling
}

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const TEL_RE = /^[\d\s+().-]{4,40}$/

export function cleanValue(raw) {
  return String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .normalize('NFC')
    .trim()
}

export function validateSubmission(fields, params) {
  const values = {}
  for (const field of fields) {
    const kind = field.kind
    if (kind === 'checkbox') {
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

export function isInternalRoute(value) {
  const text = String(value ?? '')
  if (!text) return true
  if (!text.startsWith('/')) return false
  if (text.startsWith('//')) return false
  if (/[\\]/.test(text)) return false
  try {
    if (new URL(text, 'https://x.invalid').origin !== 'https://x.invalid') return false
  } catch {
    return false
  }
  return true
}

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

export const formEnabled = (config) => !!config && config.enabled === true

export const formName = (config) => {
  const name = String(config?.name ?? '').trim()
  return name || 'Form'
}

export const HONEYPOT_CLASS = 'gf-hp'
export const HONEYPOT_CSS =
  '.gf-hp{position:absolute!important;left:-9999px!important;width:1px!important;' +
  'height:1px!important;overflow:hidden!important;opacity:0!important}'

export const MIN_FILL_MS = 1500
