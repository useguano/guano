import { ref } from 'vue'
import { beginDeliberateNavigation } from '@/composables/navigationIntent'
import { hostBridge } from '@/lib/hostBridge'

const cache = new Map<string, string>()
const hydratedKeys = new Set<string>()

/**
 * The hash the SERVER last reported for each key — from a read's
 * `x-guano-hashes` header or a write's response — and the only source of an
 * `If-Match`. The client cannot hash: `crypto.subtle` needs a secure context,
 * which an editor reached over plain http at a LAN address does not have.
 */
const hashes = new Map<string, string>()

/** the hash the server last reported for `key`, or undefined */
export const storeHash = (key: string) => hashes.get(key)

/** Read `x-guano-hashes` off a store GET: `{"<key>": "<sha256>" | null}`. */
function absorbHashes(res: Response) {
  const header = res.headers.get('x-guano-hashes')
  if (!header) return
  try {
    const map = JSON.parse(header) as Record<string, string | null>
    for (const [key, hash] of Object.entries(map)) {
      if (hash) hashes.set(key, hash)
      else hashes.delete(key)
    }
  } catch {
    // A header we cannot read means no baseline, which means no `If-Match` —
    // the write still lands, with the behaviour the editor had before.
  }
}

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
  /**
   * The hash of the bytes this write was computed from, sent as `If-Match`.
   *
   * A whole project blob goes out on every write, so what a lost update costs
   * is not a field but every page the other writer had. `persistMerged`
   * already reads the stored blob and three-way merges onto it — this closes
   * the window between that read and this write, which is where a second
   * editor's save, or an agent's, used to disappear with no error anywhere.
   *
   * The client never COMPUTES it: `crypto.subtle` needs a secure context, and
   * an editor reached over plain http at a LAN address is exactly the case
   * that broke `crypto.randomUUID` (→ src/lib/shared/ids.js). The server
   * reports the hash on every read and every write, and this is what it last
   * said.
   */
  ifMatch?: string
}

const queues = new Map<string, { inflight: boolean; next: Op | null }>()

const enqueued = new Map<string, number>()
const acked = new Map<string, number>()

export const storeAck = ref(0)

/**
 * Someone else saved this key between the read a write was computed from and
 * the write itself. Registered by `usePersistence`, which reloads the blob and
 * says so — **never silently**: a refreshed view nobody was told about is a
 * person retyping work they cannot see any more.
 */
let conflictHandler: ((key: string) => void) | null = null
export function onStoreConflict(handler: (key: string) => void) {
  conflictHandler = handler
}

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

export function storeSet(key: string, value: string, ifMatch?: string): number {
  cache.set(key, value)
  return enqueue(key, { method: 'PUT', value, seq: 0, ifMatch })
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

/**
 * A 412 is deliberately NOT retryable.
 *
 * It means the stored bytes moved after this write was computed, so replaying
 * the same body is exactly the clobber `If-Match` exists to prevent — and it
 * would replay forever, because the condition never clears on its own. The
 * answer is to reload and let the editor recompute, which is what
 * `onStoreConflict` is for.
 */
const isRetryable = (status: number | null) =>
  status === null || status >= 500 || status === 429

async function reauthorized(): Promise<boolean> {
  if (!hostBridge.available) return false
  try {
    await hostBridge.requestReauth()
    return true
  } catch {
    return false
  }
}

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
        ...(op.ifMatch ? { headers: { 'if-match': op.ifMatch } } : {}),
      })
      if (res.status === 412) {
        // Nothing was written, and nothing should be: this body was built on
        // bytes that have moved. Drop the op, hand the server's view of the
        // current hash to the conflict handler, and let the editor reload and
        // recompute on top of what is actually stored.
        const detail = (await res.json().catch(() => null)) as { currentHash?: string } | null
        if (detail?.currentHash) hashes.set(key, detail.currentHash)
        else hashes.delete(key)
        q.next = null
        q.inflight = false
        countPending()
        storeError.value = null
        storeFailure.value = null
        conflictHandler?.(key)
        return
      }
      if (res.status === 401) {
        // Under a host that can re-mint (the desktop launcher), a dead cookie
        // is a pause, not the end: keep `inflight` true so no second flush
        // starts for this key, leave storeError clean so the status pill stays
        // "Saving…" rather than flashing a failure, and re-queue the op. The
        // `??=` is the same last-write-wins rule the retryable catch uses — an
        // edit made while we waited must win over the one being replayed.
        if (hostBridge.available) {
          try {
            await hostBridge.requestReauth()
            q.next ??= op
            continue
          } catch {
            /* fall through to the ordinary bounce */
          }
        }
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
      // The server reports the hash of what it wrote — which is not
      // necessarily the hash of what was SENT: a contributor's write is
      // content-merged server-side, and a reviewer's keeps the stored blob
      // whole. Taking it from the response rather than from our own body is
      // what makes the next `If-Match` describe reality.
      const written = (await res.json().catch(() => null)) as { hash?: string } | null
      if (written?.hash) hashes.set(key, written.hash)
      else hashes.delete(key)
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
    if (await reauthorized()) return hydrateStore(keys)
    onUnauthorized()
    await new Promise(() => {})
  }
  if (!res.ok) throw new Error(`store fetch failed (${res.status})`)
  absorbHashes(res)
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
    if (await reauthorized()) return storeGetFresh(key)
    onUnauthorized()
    await new Promise(() => {})
  }
  if (!res.ok) throw new Error(`store fetch failed (${res.status})`)
  absorbHashes(res)
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
