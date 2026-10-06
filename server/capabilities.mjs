// Capabilities: what a server-side feature needs from an integration.
//
// The server does not know which integration "is SMTP" — the user names theirs
// "Postmark", "Gmail" or "Mail". So a capability declares the KEYS it needs,
// an admin PICKS an integration for it (Settings → Forms), and this module
// checks the pick carries those keys. That indirection is the whole reason the
// generic integrations model works: one store, any provider, no per-provider
// build.
//
// Every consumer resolves through `resolveCapability`, so a renamed or deleted
// key fails at pick time and at send time with the same named message.
import { lookup as dnsLookup } from 'node:dns/promises'
import { findIntegration } from './integrations.mjs'
import { assertPublicUrl } from './net-guard.mjs'
import { smtpVerify } from './smtp.mjs'

/** ports a mail submission is actually accepted on. 465 is implicit TLS; the
 * rest are STARTTLS, which smtp.mjs requires before AUTH. */
export const SMTP_PORTS = [25, 465, 587, 2525]

/**
 * A mail HOST: a hostname or an IP literal, with no scheme, port or path.
 *
 * A SINGLE label is allowed on purpose. Requiring a dot rejected `localhost`
 * and a container name like `mail` — which is exactly how a self-hosted
 * instance reaches a local Postfix or a docker-compose relay, the most common
 * deployment this product has. Unlike the webhook forward, this is not an
 * SSRF surface: the host is admin-set, the protocol is SMTP, and the only
 * thing sent is the mail itself.
 */
const HOSTNAME_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$|^\d{1,3}(?:\.\d{1,3}){3}$/i

export const CAPABILITIES = {
  smtp: {
    id: 'smtp',
    label: 'Send email (SMTP)',
    needs: ['HOST', 'PORT', 'USER', 'PASSWORD', 'FROM'],
    optional: [],
    /** extra validation beyond "the key exists" */
    validate(bag) {
      if (!HOSTNAME_RE.test(bag.HOST)) return `HOST "${bag.HOST}" is not a hostname`
      const port = Number(bag.PORT)
      if (!SMTP_PORTS.includes(port)) {
        return `PORT must be one of ${SMTP_PORTS.join(', ')} (got "${bag.PORT}")`
      }
      if (!/.+@.+\..+/.test(bag.FROM)) return `FROM "${bag.FROM}" is not an email address`
      return null
    },
    async test(bag) {
      await smtpVerify({
        host: bag.HOST,
        port: Number(bag.PORT),
        user: bag.USER,
        password: bag.PASSWORD,
      })
    },
  },
  webhook: {
    id: 'webhook',
    label: 'Forward to a webhook',
    needs: ['FORWARD_URL'],
    optional: ['FORWARD_AUTH'],
    validate(bag) {
      let parsed
      try {
        parsed = new URL(bag.FORWARD_URL)
      } catch {
        return `FORWARD_URL "${bag.FORWARD_URL}" is not a URL`
      }
      if (parsed.protocol !== 'https:') return 'FORWARD_URL must be https://'
      return null
    },
    async test(bag) {
      // the same guard the forward itself uses: resolve, range-check, never
      // follow a redirect into the operator's LAN
      const parsed = new URL(bag.FORWARD_URL)
      await assertPublicUrl(parsed, dnsLookup)
      const res = await fetch(parsed, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(bag.FORWARD_AUTH ? { authorization: bag.FORWARD_AUTH } : {}),
        },
        body: JSON.stringify({ test: true, from: 'guano' }),
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      })
      if (res.status >= 500) throw new Error(`the webhook answered ${res.status}`)
    },
  },
}

/**
 * Resolve a capability against a picked integration.
 *
 * Returns `{ok: true, bag}` — key name → value, secrets included, for
 * server-side use only — or `{ok: false, missing, reason}`. The reason names
 * the missing key and the integration, because "email is not configured" sends
 * an admin hunting while "Postmark is missing PORT" does not.
 */
export async function resolveCapability(capabilityId, integrationId) {
  const cap = CAPABILITIES[capabilityId]
  if (!cap) return { ok: false, missing: [], reason: `unknown capability "${capabilityId}"` }
  if (!integrationId) {
    return { ok: false, missing: cap.needs, reason: `no integration picked for ${cap.label}` }
  }
  const ig = await findIntegration(integrationId)
  if (!ig) {
    return { ok: false, missing: cap.needs, reason: 'the picked integration no longer exists' }
  }
  const bag = {}
  for (const f of ig.fields) bag[f.name] = f.value
  const missing = cap.needs.filter((k) => !bag[k])
  if (missing.length) {
    return {
      ok: false,
      missing,
      reason: `"${ig.name}" is missing ${missing.join(', ')}`,
    }
  }
  const invalid = cap.validate?.(bag)
  if (invalid) return { ok: false, missing: [], reason: `"${ig.name}": ${invalid}` }
  return { ok: true, bag, integration: { id: ig.id, name: ig.name } }
}

/** the check without the values — what the UI and the publish warnings ask */
export async function checkCapability(capabilityId, integrationId) {
  const r = await resolveCapability(capabilityId, integrationId)
  return r.ok ? { ok: true, missing: [] } : { ok: false, missing: r.missing, reason: r.reason }
}

/**
 * The structural check PLUS the outbound guard, for the moment an admin PICKS
 * an integration.
 *
 * `checkCapability` stays cheap (no DNS) because the UI calls it on every
 * read. A pick is a once-in-a-while write, and refusing a webhook pointed at
 * the operator's own LAN while the admin is still looking at the dialog beats
 * discovering it in a delivery log weeks later.
 */
export async function verifyCapabilityPick(capabilityId, integrationId) {
  const r = await resolveCapability(capabilityId, integrationId)
  if (!r.ok) return { ok: false, reason: r.reason }
  if (capabilityId === 'webhook') {
    try {
      await assertPublicUrl(new URL(r.bag.FORWARD_URL), dnsLookup)
    } catch (err) {
      return { ok: false, reason: `"${r.integration.name}": ${err.message}` }
    }
  }
  return { ok: true }
}

/** run a capability's live test against a picked integration */
export async function testCapability(capabilityId, integrationId) {
  const r = await resolveCapability(capabilityId, integrationId)
  if (!r.ok) return { ok: false, error: r.reason }
  try {
    await CAPABILITIES[capabilityId].test(r.bag)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) }
  }
}
