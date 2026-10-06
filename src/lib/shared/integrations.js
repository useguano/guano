// Integrations: the naming rules, shared verbatim by the editor's Settings
// panel, the server's integrations store, the exporter's `{{ENV.…}}`
// substitution and the MCP listing.
//
// ONE implementation on purpose. The panel shows an author the reference to
// type, the server validates the keys, and the exporter resolves it — three
// places that must agree on exactly which characters make which name, or an
// author copies a reference that silently never resolves.
//
// An integration is a NAMED SET OF KEYS: `{id, name, fields: [{name, value,
// secret, updatedAt}]}`. A key is either SECRET (write-once, masked, never
// returned, usable only by a server-side capability) or PLAIN (readable, and
// substituted into custom code at export). The values themselves live only in
// server/data/integrations.json — never in the project blob, which drafts,
// merges, contributors and agent tokens all write.

/** a key name: UPPER_SNAKE_CASE, starting with a letter */
export const KEY_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/

/** an integration's display name, before normalization */
export const INTEGRATION_NAME_MAX = 40

/** caps — a store this size is already far past any real project's needs, and
 * an unbounded one is a disk-fill primitive for anyone who can reach the API */
export const MAX_INTEGRATIONS = 50
export const MAX_KEYS_PER_INTEGRATION = 50
export const MAX_VALUE_BYTES = 4096

/**
 * The reference an author writes in custom code for one key: `ENV.<NAME>_<KEY>`
 * where NAME is the integration's name upper-cased with every run of
 * non-alphanumerics collapsed to a single `_`.
 *
 * Two integrations whose names normalize to the same prefix are refused at
 * write (`envPrefix` collision), because `{{ENV.MY_SMTP_HOST}}` would otherwise
 * be ambiguous between "My SMTP" and "My-SMTP".
 */
export function envPrefix(integrationName) {
  return String(integrationName ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** the full env name for one key of one integration */
export function envName(integrationName, keyName) {
  return `${envPrefix(integrationName)}_${String(keyName ?? '').toUpperCase()}`
}

/** the literal an author puts in custom code */
export function envRef(integrationName, keyName) {
  return `{{ENV.${envName(integrationName, keyName)}}}`
}

/** every `{{ENV.X}}` reference in a string, as the env names (deduped, in
 * order of first appearance). Whitespace inside the braces is tolerated so a
 * reference an editor reformatted still resolves. */
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

/**
 * Replace every `{{ENV.X}}` in `text` using `lookup(name)`.
 *
 * `lookup` returns `{value}` for a plain key, `{secret: true}` for a secret
 * one, or `null` when the name is unknown. A secret or unknown reference is
 * NOT substituted — it is collected in `missing`/`secrets` so the caller can
 * refuse. The exporter refuses: substituting a secret would print it into a
 * `<script>` on a public page, and an unknown reference is a typo the author
 * wants to hear about rather than a literal `{{ENV.TYPO}}` shipped to a visitor.
 */
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

/** the lookup `substituteEnvRefs` wants, built from a list of integrations */
export function envLookup(integrations) {
  const map = new Map()
  for (const ig of integrations ?? []) {
    for (const f of ig.fields ?? []) {
      map.set(envName(ig.name, f.name), f.secret ? { secret: true } : { value: f.value ?? '' })
    }
  }
  return (name) => map.get(name) ?? null
}

/** the reason this integration name is unusable, or null */
export function integrationNameError(name) {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return 'an integration needs a name'
  if (trimmed.length > INTEGRATION_NAME_MAX) {
    return `names are at most ${INTEGRATION_NAME_MAX} characters`
  }
  if (!envPrefix(trimmed)) return 'the name needs at least one letter or digit'
  return null
}

/** the reason this key name is unusable, or null */
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

/** a key name as it is stored (what the UI types, normalized) */
export const normalizeKeyName = (name) =>
  String(name ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')

/**
 * The public view of one integration: a secret key's VALUE is never included.
 * The server answers with this and nothing else, so no endpoint can leak a
 * secret by forgetting to strip it.
 */
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
