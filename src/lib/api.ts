import { onUnauthorized } from './store'

/**
 * The JSON-in / JSON-out shape every authed `/api` composable uses: sets the
 * content-type only when there is a body, bounces to login on a dead session,
 * and turns a non-2xx into an Error carrying the server's own `error` string.
 *
 * `src/lib/store.ts` (the project blob) and `useMedia` deliberately keep their
 * own fetch paths — the store queues and retries writes rather than throwing,
 * and both park on 401 (`await new Promise(() => {})`) instead of surfacing an
 * error while the navigation is already taking over.
 */
export async function apiJson(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  })
  if (res.status === 401) onUnauthorized() // dead session — back to login
  const detail = await res.json().catch(() => null)
  if (!res.ok) throw new Error(detail?.error ?? `request failed (${res.status})`)
  return detail
}
