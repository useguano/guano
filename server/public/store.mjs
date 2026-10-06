// Submission storage: one append-only JSONL file per form.
//
// JSONL rather than a JSON array because every write is an APPEND — a public
// endpoint must not read, parse and rewrite a growing file on each submission,
// and a crash mid-write then costs one line rather than the whole list.
//
// Three properties worth keeping:
//
//   * Appends are SERIALIZED per form through a promise chain. Two visitors
//     submitting at once would otherwise interleave their bytes and produce
//     one corrupt line each.
//   * There are HARD CAPS. A public write with no ceiling is a disk-fill
//     attack on the whole instance (the editor's own store shares the disk).
//     Past the cap the endpoint answers 503 and the admin view says so — it
//     never silently drops a real lead.
//   * Files are 0600 and live outside the published site, so a misconfigured
//     static handler cannot serve other people's leads.
import { appendFile, mkdir, readFile, rename, writeFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

/** per-form ceilings. Both are generous for a real site and small enough that
 *  filling the disk takes deliberate, sustained effort against the limiter. */
export const MAX_FORM_BYTES = 20 * 1024 * 1024
export const MAX_FORM_RECORDS = 10_000

const FORM_ID_RE = /^[A-Za-z0-9-]{1,64}$/

export function createSubmissionStore(dir) {
  /** formId → the tail of its append chain */
  const chains = new Map()
  /** formId → { count, bytes } once known, so the cap check is not a read */
  const sizes = new Map()
  /** formId → how many submissions were dropped as spam this process */
  const spam = new Map()

  const fileFor = (id) => {
    if (!FORM_ID_RE.test(id)) throw new Error('invalid form id')
    return join(dir, `${id}.jsonl`)
  }

  async function measure(id) {
    if (sizes.has(id)) return sizes.get(id)
    let value = { count: 0, bytes: 0 }
    try {
      const text = await readFile(fileFor(id), 'utf8')
      value = { count: text.split('\n').filter(Boolean).length, bytes: Buffer.byteLength(text) }
    } catch {
      /* no file yet */
    }
    sizes.set(id, value)
    return value
  }

  return {
    /** append one record, or refuse with a reason the endpoint can answer */
    async append(id, record) {
      const current = await measure(id)
      if (current.count >= MAX_FORM_RECORDS || current.bytes >= MAX_FORM_BYTES) {
        return { error: 'this form is not accepting submissions right now', status: 503 }
      }
      const line = JSON.stringify(record) + '\n'
      const prior = chains.get(id) ?? Promise.resolve()
      const next = prior.then(async () => {
        await mkdir(dir, { recursive: true, mode: 0o700 })
        await appendFile(fileFor(id), line, { mode: 0o600 })
      })
      // keep the chain alive even if one write fails, or every later append
      // for that form would inherit the rejection
      chains.set(
        id,
        next.catch(() => {}),
      )
      try {
        await next
      } catch (err) {
        return { error: 'could not store the submission', status: 500, detail: err.message }
      }
      sizes.set(id, { count: current.count + 1, bytes: current.bytes + line.length })
      return { ok: true }
    },

    countSpam(id) {
      spam.set(id, (spam.get(id) ?? 0) + 1)
    },


    /** every record for one form, newest first */
    async read(id, { limit = 50, before = null } = {}) {
      let text = ''
      try {
        text = await readFile(fileFor(id), 'utf8')
      } catch {
        return { records: [], total: 0 }
      }
      const rows = []
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        try {
          rows.push(JSON.parse(line))
        } catch {
          // one torn line never costs the rest of the list
        }
      }
      rows.reverse()
      const from = before ? rows.findIndex((r) => r.id === before) + 1 : 0
      return { records: rows.slice(from, from + limit), total: rows.length }
    },

    /** the forms that have submissions on disk — including ones no longer on
     *  the site, whose leads are still someone's to read */
    async list() {
      try {
        const files = await readdir(dir)
        return files.filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -'.jsonl'.length))
      } catch {
        return []
      }
    },

    async summary(id) {
      const { records, total } = await this.read(id, { limit: 1 })
      const s = await measure(id)
      return {
        count: total,
        bytes: s.bytes,
        latestAt: records[0]?.at ?? 0,
        spamDropped: spam.get(id) ?? 0,
        storageFull: s.count >= MAX_FORM_RECORDS || s.bytes >= MAX_FORM_BYTES,
      }
    },

    /** delete one record, or all of them */
    async remove(id, recordId) {
      const { records } = await this.read(id, { limit: Number.MAX_SAFE_INTEGER })
      if (!recordId) {
        await rm(fileFor(id), { force: true })
        sizes.delete(id)
        return { ok: true, removed: records.length }
      }
      const kept = records.filter((r) => r.id !== recordId)
      if (kept.length === records.length) return { error: 'unknown submission' }
      await rewrite(fileFor(id), kept)
      sizes.delete(id)
      return { ok: true, removed: 1 }
    },

    /**
     * Drop records older than `days`. Called at boot and daily.
     *
     * Retention is a real obligation, not a nicety: these are other people's
     * names and email addresses, kept on someone else's server.
     */
    async prune(days) {
      if (!days || days <= 0) return { pruned: 0 }
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
      let pruned = 0
      for (const id of await this.list()) {
        const { records } = await this.read(id, { limit: Number.MAX_SAFE_INTEGER })
        const kept = records.filter((r) => (r.at ?? 0) >= cutoff)
        if (kept.length === records.length) continue
        pruned += records.length - kept.length
        await rewrite(fileFor(id), kept)
        sizes.delete(id)
      }
      return { pruned }
    },
  }
}

/** replace a form's file atomically from a newest-first record list */
async function rewrite(file, newestFirst) {
  const text = [...newestFirst].reverse().map((r) => JSON.stringify(r)).join('\n')
  const tmp = `${file}.tmp`
  await writeFile(tmp, text ? text + '\n' : '', { mode: 0o600 })
  await rename(tmp, file)
}
