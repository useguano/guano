import { ref } from 'vue'
import { beginDeliberateNavigation } from '@/composables/navigationIntent'

/**
 * Write-through store: the editor's persistence lives on the server
 * (authed /api/store endpoints), fronted by a synchronous in-memory
 * cache so all existing persistence code keeps its sync signatures.
 * Reads hit the cache; writes update the cache immediately and flush to
 * the server through a per-key serialized queue (latest wins — never
 * out-of-order PUTs). Only boot needs to await hydration.
 */

const cache = new Map<string, string>()
const hydratedKeys = new Set<string>()

/** the session is gone/invalid — hard-reload to login, exactly once. Shared
 * by every authed API caller so no path keeps working on a dead session. */
let bouncing = false
export function onUnauthorized() {
  if (bouncing) return
  bouncing = true
  // a dead session cannot save anything, so the unload guard must not stand in
  // front of the redirect asking about it
  beginDeliberateNavigation()
  window.location.assign('/admin/login')
}

/** last write failure, cleared on the next success (drives save status) */
export const storeError = ref<string | null>(null)
/** number of keys with unflushed or in-flight writes */
export const pendingWrites = ref(0)

/**
 * The last failure, with enough detail to act on.
 *
 * `storeError` is the message the save pill shows. This carries the status and
 * whether retrying could ever help, which is what separates "the network
 * blipped, we will try again" from "the server refused this and always will".
 */
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
  /** monotonic per key — see `acked` below */
  seq: number
}

const queues = new Map<string, { inflight: boolean; next: Op | null }>()

/**
 * Per key: the highest op number ENQUEUED, and the highest the server has
 * ACCEPTED.
 *
 * This exists so a caller can tell when the bytes it handed over are actually
 * the bytes the server holds. The merge-on-save path needs that: its 3-way
 * base must be a state the server really had, and it used to advance the
 * moment a write was queued — so an offline save left every later merge
 * resolving against an ancestor that never existed.
 *
 * Sequence numbers rather than a promise or a callback, because the queue
 * drops superseded ops (latest wins). A superseded op has no honest
 * resolution: resolving it is a lie, rejecting it invents an error. With
 * numbers the question disappears — it simply never becomes the acked seq,
 * while the op that replaced it carries a higher one.
 */
const enqueued = new Map<string, number>()
const acked = new Map<string, number>()

/** bumped on every server-accepted write, so one watcher can see them all */
export const storeAck = ref(0)

/** the highest op number the server has accepted for `key` */
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

/** returns the op number, which `ackedSeq` can be compared against */
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
  q.next = op // latest wins: an unsent op is simply replaced
  countPending()
  if (!q.inflight) void flush(key)
  return op.seq
}

/** 5xx, 429 and a bare network failure are worth trying again; a refusal is
 * not. 412 counts as retryable: the answer to a changed baseline is to re-read
 * and reapply, which is what the next merge-on-save does. */
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
        // Session expired mid-work — back to login. Clear the queue: the
        // navigation below is a hard reload, so nothing queued can be saved,
        // and leaving it there pinned pendingWrites above zero forever (which
        // also made flushStore hang on the way out).
        q.next = null
        q.inflight = false
        countPending()
        storeError.value = 'your session expired — sign in again'
        storeFailure.value = { key, message: storeError.value, status: 401, retryable: false }
        onUnauthorized()
        return
      }
      if (!res.ok) {
        // The server names its refusals — 'project storage is full', the
        // contributor structural rejection, the 412 re-read instruction — and
        // all of it used to be discarded in favour of 'save failed (403)'.
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
      // A terminal refusal is dropped rather than retried: the same request
      // will be refused forever, and keeping it queued is a loop that pins
      // pendingWrites and never clears the error. The local state is kept
      // either way, so nothing the user typed is thrown away.
      if (retryable) q.next ??= op
      storeError.value = message
      storeFailure.value = { key, message, status, retryable }
      break
    }
  }
  q.inflight = false
  countPending()
}

/** fetches keys not yet hydrated into the cache; throws on network failure */
export async function hydrateStore(keys: string[]): Promise<void> {
  const missing = keys.filter((k) => !hydratedKeys.has(k))
  if (!missing.length) return
  const res = await fetch(`/api/store?keys=${missing.map(encodeURIComponent).join(',')}`)
  if (res.status === 401) {
    onUnauthorized()
    await new Promise(() => {}) // navigation is taking over
  }
  if (!res.ok) throw new Error(`store fetch failed (${res.status})`)
  const data = (await res.json()) as Record<string, string | null>
  for (const [key, value] of Object.entries(data)) {
    hydratedKeys.add(key)
    // never clobber a key with local writes still in flight
    const q = queues.get(key)
    if (q && (q.inflight || q.next)) continue
    if (value === null) cache.delete(key)
    else cache.set(key, value)
  }
}

/**
 * Reads ONE key straight from the server, bypassing the cache entirely.
 * Used by the merge-on-save path, which must see what is actually stored
 * right now — not what this tab believes. Deliberately does not touch the
 * cache or the hydration bookkeeping, so it can never disturb a pending
 * local write. Returns null when the key does not exist.
 */
export async function storeGetFresh(key: string): Promise<string | null> {
  const res = await fetch(`/api/store?keys=${encodeURIComponent(key)}`)
  if (res.status === 401) {
    onUnauthorized()
    await new Promise(() => {}) // navigation is taking over
  }
  if (!res.ok) throw new Error(`store fetch failed (${res.status})`)
  const data = (await res.json()) as Record<string, string | null>
  return data[key] ?? null
}

/** force-refetches keys even when already hydrated — for when a server-side
 * writer (the AI assistant) changed them behind the cache. The in-flight
 * write guard in hydrateStore still applies, so pending local writes are
 * never clobbered. */
export async function rehydrateStore(keys: string[]): Promise<void> {
  for (const k of keys) hydratedKeys.delete(k)
  await hydrateStore(keys)
}

/** resolves once every queued write has been flushed (best effort) */
export async function flushStore(): Promise<void> {
  while ([...queues.values()].some((q) => q.inflight || q.next)) {
    await new Promise((r) => setTimeout(r, 50))
    if (storeError.value) return // stuck on an error — don't hang forever
  }
}
