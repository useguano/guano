import { onUnauthorized } from './store'

export async function apiJson(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  })
  if (res.status === 401) onUnauthorized()
  const detail = await res.json().catch(() => null)
  if (!res.ok) throw new Error(detail?.error ?? `request failed (${res.status})`)
  return detail
}
