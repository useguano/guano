export const KEY_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/

export const INTEGRATION_NAME_MAX = 40

export const MAX_INTEGRATIONS = 50
export const MAX_KEYS_PER_INTEGRATION = 50
export const MAX_VALUE_BYTES = 4096

export function envPrefix(integrationName) {
  return String(integrationName ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function envName(integrationName, keyName) {
  return `${envPrefix(integrationName)}_${String(keyName ?? '').toUpperCase()}`
}

export function envRef(integrationName, keyName) {
  return `{{ENV.${envName(integrationName, keyName)}}}`
}

export function envRefsIn(text) {
  const out = []
  const re = /\{\{\s*ENV\.([A-Z][A-Z0-9_]*)\s*\}\}/g
  let m
  while ((m = re.exec(String(text ?? '')))) {
    const name = m[1]
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

export function substituteEnvRefs(text, lookup) {
  const missing = []
  const secrets = []
  const out = String(text ?? '').replace(
    /\{\{\s*ENV\.([A-Z][A-Z0-9_]*)\s*\}\}/g,
    (whole, name) => {
      const hit = lookup(name)
      if (!hit) {
        if (!missing.includes(name)) missing.push(name)
        return whole
      }
      if (hit.secret) {
        if (!secrets.includes(name)) secrets.push(name)
        return whole
      }
      return String(hit.value ?? '')
    },
  )
  return { text: out, missing, secrets }
}

export function envLookup(integrations) {
  const map = new Map()
  for (const ig of integrations ?? []) {
    for (const f of ig.fields ?? []) {
      map.set(envName(ig.name, f.name), f.secret ? { secret: true } : { value: f.value ?? '' })
    }
  }
  return (name) => map.get(name) ?? null
}

export function integrationNameError(name) {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return 'an integration needs a name'
  if (trimmed.length > INTEGRATION_NAME_MAX) {
    return `names are at most ${INTEGRATION_NAME_MAX} characters`
  }
  if (!envPrefix(trimmed)) return 'the name needs at least one letter or digit'
  return null
}

export function keyNameError(name) {
  const upper = String(name ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
  if (!upper) return 'a key needs a name'
  if (!KEY_NAME_RE.test(upper)) {
    return 'keys are UPPER_SNAKE_CASE: letters, digits and underscores'
  }
  return null
}

export const normalizeKeyName = (name) =>
  String(name ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')

export function publicIntegration(ig) {
  return {
    id: ig.id,
    name: ig.name,
    env: envPrefix(ig.name),
    fields: (ig.fields ?? []).map((f) => ({
      name: f.name,
      secret: !!f.secret,
      updatedAt: f.updatedAt ?? 0,
      ...(f.secret ? {} : { value: f.value ?? '' }),
    })),
  }
}
