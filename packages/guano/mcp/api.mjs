// Thin HTTP client for a running Guano instance. The MCP server NEVER touches
// the data dir directly — every read/write goes through the authed HTTP API,
// exactly as the browser editor does. Auth is a `guano_` API-token bearer
// (create one in the editor: My account → API tokens).

const BASE = (process.env.GUANO_URL || 'http://localhost:4174').replace(/\/+$/, '')
const TOKEN = process.env.GUANO_TOKEN || ''

class ApiError extends Error {
  constructor(status, message, detail) {
    super(message)
    this.status = status
    // the server's JSON body, when it sent one — carries retryAfterSeconds on a
    // 429 so a caller can wait the exact cooldown instead of guessing
    if (detail?.retryAfterSeconds !== undefined) this.retryAfterSeconds = detail.retryAfterSeconds
  }
}

async function req(method, path, body, extraHeaders) {
  let res
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
  } catch (e) {
    throw new ApiError(0, `cannot reach Guano at ${BASE} — is the server running? (${e.message})`)
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    const msg = detail?.error ?? `request failed (${res.status})`
    throw new ApiError(res.status, msg, detail)
  }
  return res
}

/** the authenticated user, or throws (bad URL / token / role) */
export async function whoami() {
  const res = await req('GET', '/api/auth/me')
  return res.json()
}

/** raw stored string for a key, or null when absent */
export async function storeGetRaw(key) {
  const res = await req('GET', `/api/store?keys=${encodeURIComponent(key)}`)
  const map = await res.json()
  return map[key] ?? null
}

/** parsed JSON for a key, or null when absent */
export async function storeGetJson(key) {
  const raw = await storeGetRaw(key)
  return raw === null ? null : JSON.parse(raw)
}

/**
 * Write a raw string under a key.
 *
 * `ifMatch` is the sha256 of the bytes the caller believes are stored — the
 * server compares it under its own per-key lock and answers 412 rather than
 * overwriting someone else's write. That last word matters: the caller's own
 * read-then-compare cannot see a write that lands between its check and its
 * PUT, and the whole blob goes out on every write, so what is lost in that gap
 * is a whole page, not a field.
 */
export async function storePutRaw(key, raw, { ifMatch } = {}) {
  await req(
    'PUT',
    `/api/store/${encodeURIComponent(key)}`,
    raw,
    ifMatch ? { 'if-match': ifMatch } : undefined,
  )
}

/** publish (server method): editor+ only, gated server-side */
export async function publish(projectSnapshot) {
  const res = await req('POST', '/api/published?method=server', projectSnapshot)
  return res.json()
}

/**
 * Export the snapshot to the PREVIEW site and return where to look at it.
 * Nothing reaches the live origin, and the agent publish policy does not gate
 * it — seeing your own work should never require shipping it.
 */
export async function preview(projectSnapshot) {
  const res = await req('POST', '/api/preview', projectSnapshot)
  return res.json()
}

/** the forms with submissions, and one form's rows. Gated server-side on the
 *  `allowFormSubmissions` agent policy, which is OFF by default: submissions
 *  are site visitors' personal details, and an injected agent with read access
 *  could exfiltrate them through any write it can make. */
export async function formsList() {
  const res = await req('GET', '/api/forms')
  return res.json()
}

export async function formSubmissions(formId, { limit, before } = {}) {
  const params = new URLSearchParams()
  if (limit) params.set('limit', String(limit))
  if (before) params.set('before', before)
  const query = params.toString()
  const res = await req(
    'GET',
    `/api/forms/${encodeURIComponent(formId)}/submissions${query ? `?${query}` : ''}`,
  )
  return res.json()
}

/** the integrations, as NAMES only — never a value, plain or secret. An agent
 *  needs the names to write a valid {{ENV.X}} reference in custom code and
 *  nothing more. */
export async function integrationsList() {
  const res = await req('GET', '/api/integrations')
  return res.json()
}

/** the media library index: { assets, folders } */
export async function mediaIndex() {
  const res = await req('GET', '/api/media')
  return res.json()
}

/** upload raw bytes as a new library asset — the server validates mime, size
 *  caps, content sniffing and quota exactly as for browser uploads */
export async function mediaUpload({ name, folderId, mime, bytes }) {
  const params = new URLSearchParams({ name })
  if (folderId) params.set('folder', folderId)
  let res
  try {
    res = await fetch(`${BASE}/api/media?${params}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': mime },
      body: bytes,
    })
  } catch (e) {
    throw new ApiError(0, `cannot reach Guano at ${BASE} — is the server running? (${e.message})`)
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new ApiError(res.status, detail?.error ?? `upload failed (${res.status})`, detail)
  }
  return res.json()
}

export { ApiError, BASE, TOKEN }
