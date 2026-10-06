// Integrations: the server-side credential store.
//
// An integration is a NAMED SET OF KEYS — `SMTP {HOST, PORT, USER, FROM,
// PASSWORD}`, `Zapier {FORWARD_URL, FORWARD_AUTH}` — rather than one fixed
// group per provider, so a user can wire up whatever their site needs and call
// it whatever they call it.
//
// WHY THE WHOLE INTEGRATION LIVES HERE, not just its secrets: the project blob
// is written by editors, by drafts, by a 3-way merge, by contributors and by
// agent tokens, and a `guano-base:*` snapshot is a whole copy of it. While the
// SMTP *host* sat in the blob and only the password sat server-side, anyone who
// could write the blob could point the host at their own machine and read the
// password off the first AUTH. With the whole integration here that class of
// bug is gone, plain keys included.
//
// Two further rules this file enforces:
//   1. A SECRET value never leaves the process. Reads answer with
//      `publicIntegration` (shared/integrations.js), which has no branch that
//      can include one. A secret is usable only by a server-side capability
//      (capabilities.mjs) — SMTP send, webhook forward.
//   2. WRITES are admin + session cookie only. A `guano_` token may LIST
//      (an agent needs key names to write a valid `{{ENV.X}}` reference) and
//      can never create, change, delete or read a secret. Same contract as
//      /api/agent-policy and the GitHub token: a credential able to mint
//      credentials would guard nothing.
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { DATA_DIR, writeAtomic } from './util.mjs'
import {
  MAX_INTEGRATIONS,
  MAX_KEYS_PER_INTEGRATION,
  MAX_VALUE_BYTES,
  envPrefix,
  integrationNameError,
  keyNameError,
  normalizeKeyName,
  publicIntegration,
} from '../src/lib/shared/integrations.js'

const FILE = join(DATA_DIR, 'integrations.json')

/** in-memory copy, invalidated on write (the siteGateCache pattern) */
let cache = null

/** every integration, normalized. Never throws: a missing or corrupt file is
 * an empty store, not a dead server. */
export async function readIntegrations() {
  if (cache) return cache
  let parsed = null
  try {
    parsed = JSON.parse(await readFile(FILE, 'utf8'))
  } catch {
    /* absent or corrupt — an empty store */
  }
  const rows = Array.isArray(parsed?.integrations) ? parsed.integrations : []
  cache = rows
    .filter((ig) => ig && typeof ig.id === 'string' && typeof ig.name === 'string')
    .map((ig) => ({
      id: ig.id,
      name: ig.name,
      fields: (Array.isArray(ig.fields) ? ig.fields : [])
        .filter((f) => f && typeof f.name === 'string')
        .map((f) => ({
          name: f.name,
          value: typeof f.value === 'string' ? f.value : '',
          secret: !!f.secret,
          updatedAt: Number(f.updatedAt) || 0,
        })),
    }))
  return cache
}

async function writeIntegrations(rows) {
  await writeAtomic(FILE, JSON.stringify({ integrations: rows }, null, 2))
  cache = rows
}

/** test seam + the import/restore path: forget the cached copy */
export function resetIntegrationsCache() {
  cache = null
}

/** one integration by id, or null */
export async function findIntegration(id) {
  return (await readIntegrations()).find((ig) => ig.id === id) ?? null
}

/** `{[ENV_NAME]: {value} | {secret:true}}` for the exporter's substitution */
export async function integrationEnv() {
  return await readIntegrations()
}

/**
 * Seed the store from the legacy per-provider shape, once.
 *
 * v1 kept `settings.smtp` (host/port/user/from) in the PROJECT BLOB and the
 * three secrets (`stripe.secretKey`, `mailing.apiKey`, `smtp.password`) in
 * publish.json. Both are gone; this carries what was configured across so an
 * upgrade doesn't silently lose a working mail setup.
 *
 * Idempotent: it only ever runs when the file does not exist yet, and it
 * reports by NAME what it created — never a value.
 */
export async function seedLegacyIntegrations({ legacySecrets, legacySmtp }) {
  const existing = await readIntegrations()
  if (existing.length) return []
  const rows = []
  const now = Date.now()
  const add = (name, fields) => {
    const kept = fields.filter((f) => f.value)
    if (!kept.length) return
    rows.push({
      id: randomUUID(),
      name,
      fields: kept.map((f) => ({ ...f, updatedAt: now })),
    })
  }
  add('SMTP', [
    { name: 'HOST', value: String(legacySmtp?.host ?? '').trim(), secret: false },
    { name: 'PORT', value: String(legacySmtp?.port ?? '').trim(), secret: false },
    { name: 'USER', value: String(legacySmtp?.user ?? '').trim(), secret: false },
    { name: 'FROM', value: String(legacySmtp?.from ?? '').trim(), secret: false },
    { name: 'PASSWORD', value: String(legacySecrets?.smtp?.password ?? '').trim(), secret: true },
  ])
  add('Stripe', [
    {
      name: 'PUBLISHABLE_KEY',
      value: String(legacySmtp?.stripePublishableKey ?? '').trim(),
      secret: false,
    },
    { name: 'SECRET_KEY', value: String(legacySecrets?.stripe?.secretKey ?? '').trim(), secret: true },
  ])
  add('Mailing', [
    { name: 'PROVIDER', value: String(legacySmtp?.mailingProvider ?? '').trim(), secret: false },
    { name: 'API_KEY', value: String(legacySecrets?.mailing?.apiKey ?? '').trim(), secret: true },
  ])
  if (!rows.length) return []
  await writeIntegrations(rows)
  return rows.map((r) => ({ name: r.name, keys: r.fields.map((f) => f.name) }))
}

// ---------- mutations, each returning {error} or {rows} ----------

const nameTaken = (rows, name, exceptId) =>
  rows.some(
    (ig) =>
      ig.id !== exceptId &&
      (ig.name.toLowerCase() === name.toLowerCase() || envPrefix(ig.name) === envPrefix(name)),
  )

async function mutate(fn) {
  const rows = (await readIntegrations()).map((ig) => ({ ...ig, fields: ig.fields.map((f) => ({ ...f })) }))
  const result = fn(rows)
  if (result?.error) return result
  await writeIntegrations(rows)
  return { rows, created: result?.created }
}

export function createIntegration(name) {
  return mutate((rows) => {
    const trimmed = String(name ?? '').trim()
    const bad = integrationNameError(trimmed)
    if (bad) return { error: bad }
    if (rows.length >= MAX_INTEGRATIONS) {
      return { error: `at most ${MAX_INTEGRATIONS} integrations` }
    }
    if (nameTaken(rows, trimmed)) {
      // the env prefix half matters as much as the display name: "My SMTP" and
      // "My-SMTP" both normalize to MY_SMTP, which would make every
      // {{ENV.MY_SMTP_*}} reference ambiguous
      return { error: `"${trimmed}" collides with an existing integration` }
    }
    const row = { id: randomUUID(), name: trimmed, fields: [] }
    rows.push(row)
    return { created: row }
  })
}

export function renameIntegration(id, name) {
  return mutate((rows) => {
    const ig = rows.find((r) => r.id === id)
    if (!ig) return { error: 'unknown integration' }
    const trimmed = String(name ?? '').trim()
    const bad = integrationNameError(trimmed)
    if (bad) return { error: bad }
    if (nameTaken(rows, trimmed, id)) {
      return { error: `"${trimmed}" collides with an existing integration` }
    }
    ig.name = trimmed
    return {}
  })
}

export function deleteIntegration(id) {
  return mutate((rows) => {
    const at = rows.findIndex((r) => r.id === id)
    if (at < 0) return { error: 'unknown integration' }
    rows.splice(at, 1)
    return {}
  })
}

export function setIntegrationKey(id, keyName, { value, secret }) {
  return mutate((rows) => {
    const ig = rows.find((r) => r.id === id)
    if (!ig) return { error: 'unknown integration' }
    const name = normalizeKeyName(keyName)
    const bad = keyNameError(name)
    if (bad) return { error: bad }
    const text = String(value ?? '')
    if (!text) return { error: 'a key needs a value' }
    if (Buffer.byteLength(text) > MAX_VALUE_BYTES) {
      return { error: `values are at most ${MAX_VALUE_BYTES} bytes` }
    }
    if (/[\0\r\n]/.test(text)) return { error: 'values cannot contain newlines' }
    const existing = ig.fields.find((f) => f.name === name)
    if (!existing && ig.fields.length >= MAX_KEYS_PER_INTEGRATION) {
      return { error: `at most ${MAX_KEYS_PER_INTEGRATION} keys per integration` }
    }
    const wantSecret = secret === undefined ? existing?.secret ?? true : !!secret
    if (existing && existing.secret && !wantSecret) {
      // A secret was promised "never shown again". Flipping it to plain would
      // publish it to every editor's panel AND substitute it into custom code
      // on a public page. Delete and re-add instead, which is a deliberate act.
      return {
        error: `${name} is secret — delete it and add it again to make it readable`,
      }
    }
    if (existing) Object.assign(existing, { value: text, secret: wantSecret, updatedAt: Date.now() })
    else ig.fields.push({ name, value: text, secret: wantSecret, updatedAt: Date.now() })
    return {}
  })
}

export function deleteIntegrationKey(id, keyName) {
  return mutate((rows) => {
    const ig = rows.find((r) => r.id === id)
    if (!ig) return { error: 'unknown integration' }
    const name = normalizeKeyName(keyName)
    const at = ig.fields.findIndex((f) => f.name === name)
    if (at < 0) return { error: 'unknown key' }
    ig.fields.splice(at, 1)
    return {}
  })
}

/** the read shape, secrets stripped by construction */
export async function listIntegrationsPublic() {
  return (await readIntegrations()).map(publicIntegration)
}
