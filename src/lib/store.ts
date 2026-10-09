import { ref } from 'vue'
import { beginDeliberateNavigation } from '@/composables/navigationIntent'

const cache = new Map<string, string>()
const hydratedKeys = new Set<string>()

let bouncing = false
export function onUnauthorized() {
  if (bouncing) return
  bouncing = true
  beginDeliberateNavigation()
  window.location.assign('/admin/login')
}

export const storeError = ref<string | null>(null)
export const pendingWrites = ref(0)

export interface StoreFailure {
  key: string
  message: string
  status: number | null
  retryable: boolean
}
export const storeFailure = ref<StoreFailure | null>(null)

interface Op {
  method: 'PUT' | 'DELETE'
  value?: string
  seq: number
}

const queues = new Map<string, { inflight: boolean; next: Op | null }>()

const enqueued = new Map<string, number>()
const acked = new Map<string, number>()

export const storeAck = ref(0)

export function ackedSeq(key: string): number {
  return acked.get(key) ?? 0
}

function countPending() {
  let n = 0
  for (const q of queues.values()) if (q.inflight || q.next) n++
  pendingWrites.value = n
}

export function storeGet(key: string): string | null {
  return cache.get(key) ?? null
}

export function storeSet(key: string, value: string): number {
  cache.set(key, value)
  return enqueue(key, { method: 'PUT', value, seq: 0 })
}

export function storeRemove(key: string): number {
  cache.delete(key)
  return enqueue(key, { method: 'DELETE', seq: 0 })
}

function enqueue(key: string, op: Op): number {
  let q = queues.get(key)
  if (!q) {
    q = { inflight: false, next: null }
    queues.set(key, q)
  }
  op.seq = (enqueued.get(key) ?? 0) + 1
  enqueued.set(key, op.seq)
  q.next = op
  countPending()
  if (!q.inflight) void flush(key)
  return op.seq
}

const isRetryable = (status: number | null) =>
  status === null || status >= 500 || status === 429 || status === 412

async function flush(key: string) {
  const q = queues.get(key)!
  q.inflight = true
  countPending()
  while (q.next) {
    const op = q.next
    q.next = null
    try {
      const res = await fetch(`/api/store/${encodeURIComponent(key)}`, {
        method: op.method,
        body: op.value,
      })
      if (res.status === 401) {
        q.next = null
        q.inflight = false
        countPending()
        storeError.value = 'your session expired — sign in again'
        storeFailure.value = { key, message: storeError.value, status: 401, retryable: false }
        onUnauthorized()
        return
      }
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null
        throw Object.assign(new Error(detail?.error ?? `save failed (${res.status})`), {
          status: res.status,
        })
      }
      acked.set(key, op.seq)
      storeAck.value++
      storeError.value = null
      storeFailure.value = null
    } catch (e) {
      const status = (e as { status?: number }).status ?? null
      const message = e instanceof Error ? e.message : 'save failed'
      const retryable = isRetryable(status)
      if (retryable) q.next ??= op
      storeError.value = message
      storeFailure.value = { key, message, status, retryable }
      break
    }
  }
  q.inflight = false
  countPending()
}

export async function hydrateStore(keys: string[]): Promise<void> {
  const missing = keys.filter((k) => !hydratedKeys.has(k))
  if (!missing.length) return
  const res = await fetch(`/api/store?keys=${missing.map(encodeURIComponent).join(',')}`)
  if (res.status === 401) {
    onUnauthorized()
    await new Promise(() => {})
  }
  if (!res.ok) throw new Error(`store fetch failed (${res.status})`)
  const data = (await res.json()) as Record<string, string | null>
  for (const [key, value] of Object.entries(data)) {
    hydratedKeys.add(key)
    const q = queues.get(key)
    if (q && (q.inflight || q.next)) continue
    if (value === null) cache.delete(key)
    else cache.set(key, value)
  }
}

export async function storeGetFresh(key: string): Promise<string | null> {
  const res = await fetch(`/api/store?keys=${encodeURIComponent(key)}`)
  if (res.status === 401) {
    onUnauthorized()
    await new Promise(() => {})
  }
  if (!res.ok) throw new Error(`store fetch failed (${res.status})`)
  const data = (await res.json()) as Record<string, string | null>
  return data[key] ?? null
}

export async function rehydrateStore(keys: string[]): Promise<void> {
  for (const k of keys) hydratedKeys.delete(k)
  await hydrateStore(keys)
}

export async function flushStore(): Promise<void> {
  while ([...queues.values()].some((q) => q.inflight || q.next)) {
    await new Promise((r) => setTimeout(r, 50))
    if (storeError.value) return
  }
}
