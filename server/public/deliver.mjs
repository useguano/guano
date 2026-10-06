// Delivery: what happens after a submission is safely on disk.
//
// Two capabilities, both optional, both resolved through an integration an
// admin picked (capabilities.mjs):
//
//   NOTIFY   — SMTP mail to the site's recipients.
//   FORWARD  — POST the validated submission as JSON to a webhook. This is the
//              universal path: Zapier, Make, Airtable, a CRM, a newsletter
//              provider's subscribe endpoint. One mechanism instead of a
//              per-provider build, which is what makes "any integration they
//              might need" true without a plugin system.
//
// Everything here is best-effort and never blocks the visitor's response: the
// lead is stored before this runs, so a mail server being down costs a
// notification, not the submission. Failures are remembered per form and
// surfaced in the admin view, because a silently broken notification is how a
// month of leads goes unread.
import { lookup as dnsLookup } from 'node:dns/promises'
import { resolveCapability } from '../capabilities.mjs'
import { assertPublicUrl } from '../net-guard.mjs'
import { sendMail } from '../smtp.mjs'
import { log } from '../log.mjs'

/** site-wide ceiling on notification mail, so a flood cannot turn the
 *  instance into a spam source (or exhaust a provider's quota). Past it, one
 *  digest per hour instead of one mail per lead. */
const MAIL_PER_HOUR = 60

export function createDeliverer({ readConfig, adminUrl }) {
  /** formId → the last result of each channel, for the admin view */
  const status = new Map()
  /** rolling timestamps of mail sent this hour */
  let sent = []
  /** formId → submissions suppressed since the last digest */
  const pending = new Map()
  /** one SMTP conversation at a time */
  let queue = Promise.resolve()

  const note = (id, channel, value) => {
    const row = status.get(id) ?? {}
    row[channel] = value
    status.set(id, row)
    // also to the log. The admin view shows this too, but a notification that
    // silently stopped working is how a month of leads goes unread — and the
    // operator reads logs long before they open the submissions modal.
    if (!value.ok) log.warn(`forms: ${channel} failed for ${id}: ${value.error}`)
  }

  function mailBudgetLeft() {
    const now = Date.now()
    sent = sent.filter((t) => now - t < 3_600_000)
    return sent.length < MAIL_PER_HOUR
  }

  async function notify(id, entry, record) {
    const cfg = await readConfig()
    const to = cfg.forms?.notifyTo ?? []
    if (!to.length) {
      note(id, 'notify', { ok: false, error: 'no recipients set', at: Date.now() })
      return
    }
    const cap = await resolveCapability('smtp', cfg.forms?.mailer)
    if (!cap.ok) {
      note(id, 'notify', { ok: false, error: cap.reason, at: Date.now() })
      return
    }
    if (!mailBudgetLeft()) {
      // hold it for the digest rather than dropping it on the floor
      pending.set(id, (pending.get(id) ?? 0) + 1)
      note(id, 'notify', { ok: false, error: 'mail budget reached — digesting', at: Date.now() })
      return
    }

    // where to read them. The studio's own public origin is the only address
    // the server knows at send time — a request's Host header is long gone by
    // now — and it is exactly what `publishing.apiOrigin` records.
    const where = (await adminUrl?.()) ?? ''
    const held = pending.get(id) ?? 0
    pending.delete(id)
    const lines = Object.entries(record.values).map(([key, value]) => `${key}: ${value}`)
    // Reply-To is the ONLY place a visitor's address goes, and only after it
    // passed the email check — `From` is always the configured address, which
    // is also what keeps SPF/DKIM aligned. smtp.mjs throws on a CR/LF in any
    // header value rather than stripping it.
    const replyTo = firstEmail(entry.fields ?? [], record.values)
    const body = [
      `A new submission to "${entry.name}".`,
      '',
      ...lines,
      '',
      `Route: ${record.route}`,
      `Received: ${new Date(record.at).toISOString()}`,
      ...(held ? ['', `(${held} earlier submission(s) were not mailed — see the editor.)`] : []),
      ...(where ? ['', `All submissions: ${where}`] : []),
    ].join('\n')

    sent.push(Date.now())
    try {
      await sendMail(
        {
          host: cap.bag.HOST,
          port: cap.bag.PORT,
          user: cap.bag.USER,
          password: cap.bag.PASSWORD,
          from: cap.bag.FROM,
        },
        {
          to,
          subject: `New submission: ${entry.name}`,
          text: body,
          ...(replyTo ? { replyTo } : {}),
        },
      )
      note(id, 'notify', { ok: true, at: Date.now() })
    } catch (err) {
      note(id, 'notify', { ok: false, error: err.message, at: Date.now() })
    }
  }

  async function forward(id, entry, record, attempt = 0) {
    const cfg = await readConfig()
    const cap = await resolveCapability('webhook', cfg.forms?.webhook)
    if (!cap.ok) {
      note(id, 'forward', { ok: false, error: cap.reason, at: Date.now() })
      return
    }
    let url
    try {
      url = new URL(cap.bag.FORWARD_URL)
      // resolved and range-checked every time, not once at configuration: DNS
      // can change under a URL that was public when it was saved
      await assertPublicUrl(url, dnsLookup)
    } catch (err) {
      note(id, 'forward', { ok: false, error: err.message, at: Date.now() })
      return
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(cap.bag.FORWARD_AUTH ? { authorization: cap.bag.FORWARD_AUTH } : {}),
        },
        // only the allowlisted values — never `_hp`, `_t`, `_route` as fields,
        // and never anything the manifest did not declare
        body: JSON.stringify({
          form: { id, name: entry.name },
          route: record.route,
          ...(record.entry ? { entry: record.entry } : {}),
          at: record.at,
          values: record.values,
        }),
        // a redirect would take the request (and the Authorization header) to
        // a host that was never range-checked
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      })
      if (res.status >= 300) throw new Error(`the webhook answered ${res.status}`)
      note(id, 'forward', { ok: true, at: Date.now() })
    } catch (err) {
      if (attempt === 0) {
        // one retry, well after the fact: a webhook restarting should not cost
        // a lead its delivery
        setTimeout(() => void forward(id, entry, record, 1), 30_000).unref?.()
        return
      }
      note(id, 'forward', { ok: false, error: err.message, at: Date.now() })
    }
  }

  return {
    /** fire and forget: called after the record is stored */
    deliver(id, entry, record) {
      if (entry.notify) {
        queue = queue.then(() => notify(id, entry, record)).catch(() => {})
      }
      if (entry.forward) void forward(id, entry, record)
    },
    /** the per-form delivery status the admin view shows */
    statusFor: (id) => status.get(id) ?? {},
  }
}

/** the first email-kind field whose value passed validation */
function firstEmail(fields, values) {
  for (const field of fields) {
    if (field.kind !== 'email') continue
    const value = values[field.name]
    if (typeof value === 'string' && value) return value
  }
  return null
}
