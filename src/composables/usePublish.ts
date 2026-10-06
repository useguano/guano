import { computed, ref, watch } from 'vue'
import { activeBranchId, currentSnapshot, projectStorageKey, usePersistence } from './usePersistence'
import { MAIN_ID } from './useBranches'
import { readStoredProject } from '@/lib/storage'
import {
  flushStore,
  hydrateStore,
  onUnauthorized,
  storeError,
  storeGet,
  storeRemove,
  storeSet,
} from '@/lib/store'
import { downloadBlob, filenameFrom } from '@/lib/download'
import type { PublishMethod } from '@/types/editor'

/** mirror of the last-published snapshot so the Unpublished dot
 * survives editor reloads (server-stored; hydrated by the boot flow) */
export const PUBLISHED_BASELINE_KEY = 'guano-published-baseline'

// snapshot of the project at the last publish; null = never published.
// (migrations can make an old save differ from its own published
// baseline — worst case one false "Unpublished".)
const publishedSnapshot = ref<string | null>(null)

/** stats of the last successful publish (Publishing settings tab) */
export const PUBLISHED_INFO_KEY = 'guano-published-info'
const publishedInfo = ref<{
  publishedAt: number
  routes: number
  bytes: number
  commit?: string
} | null>(null)

/** Main's stored snapshot, mirrored into a ref because the store cache is
 * not reactive. Only publishing and the Unpublished dot read it, and only
 * while a draft is active — on Main, `currentSnapshot` is the live truth. */
const storedMainSnapshot = ref<string | null>(null)

function readMainSnapshot(): string | null {
  // readStoredProject (not raw storeGet) so a pre-migration save publishes
  // migrated; a current-version save round-trips byte-identical
  const main = readStoredProject(projectStorageKey(MAIN_ID))
  return main ? JSON.stringify(main) : null
}

// switching onto a draft: Main was just flushed to the store cache
// (switchBranch/createBranch saveNow() before flipping the id), so a plain
// cache read here is current regardless of watcher flush timing
watch(activeBranchId, () => {
  if (activeBranchId.value !== MAIN_ID) storedMainSnapshot.value = readMainSnapshot()
})

/** called from the editor boot flow once the store cache is hydrated */
export function hydratePublishState() {
  publishedSnapshot.value = storeGet(PUBLISHED_BASELINE_KEY)
  storedMainSnapshot.value = readMainSnapshot()
  try {
    publishedInfo.value = JSON.parse(storeGet(PUBLISHED_INFO_KEY) ?? 'null')
  } catch {
    publishedInfo.value = null
  }
}

export function usePublish() {
  /** what publishing would ship: always Main, never a draft */
  const mainSnapshot = computed(() =>
    activeBranchId.value === MAIN_ID ? currentSnapshot.value : storedMainSnapshot.value,
  )

  /** true whenever MAIN differs from the last published state — draft edits
   * never flip it; merging a draft into Main does. On Main it compares the
   * persistence layer's already-committed snapshot: no per-edit stringify,
   * and content-accurate (undoing back to the published state clears it). */
  const hasUnpublishedChanges = computed(
    () => publishedSnapshot.value === null || mainSnapshot.value !== publishedSnapshot.value,
  )

  /** publishes Main to the server, whatever branch is active; throws on
   * failure. Only the client enforces Main-only publishing — the server
   * stores whatever snapshot it's sent. */
  async function markPublished(method: PublishMethod = 'server', signal?: AbortSignal): Promise<void> {
    // Settle any pending edit so the committed snapshot is what we publish —
    // AWAITED. Fired and forgotten, the snapshot read a line later could
    // predate the merge the save was still doing, and the live site would be
    // ahead of (or behind) the saved project.
    await usePersistence().saveNow()
    await flushStore()
    if (storeError.value) {
      throw new Error(`Changes are not saved — publishing would ship something else. ${storeError.value}`)
    }
    let snapshot: string
    if (activeBranchId.value === MAIN_ID) {
      snapshot = currentSnapshot.value
    } else {
      // a session restored straight onto a draft may not have Main cached
      await hydrateStore([projectStorageKey(MAIN_ID)])
      const main = readMainSnapshot()
      if (!main) throw new Error('Main has no saved version yet — switch to Main before publishing.')
      storedMainSnapshot.value = main
      snapshot = main
    }
    const res = await fetch(`/api/published?method=${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: snapshot,
      signal,
    })
    if (res.status === 401) onUnauthorized() // dead session — back to login
    if (!res.ok) {
      const detail = await res.json().catch(() => null)
      throw new Error(detail?.error ?? `publish failed (${res.status})`)
    }
    // zip method streams the site back as a binary attachment; every method
    // also refreshed SITE, so the baseline/info updates below are valid.
    let stats: { routes: number; bytes: number; commit?: string }
    if ((res.headers.get('content-type') ?? '').includes('application/zip')) {
      downloadBlob(await res.blob(), filenameFrom(res, 'site.zip'))
      stats = {
        routes: Number(res.headers.get('x-export-routes')) || 0,
        bytes: Number(res.headers.get('x-export-bytes')) || 0,
      }
    } else {
      const body = await res.json().catch(() => null)
      stats = { routes: body?.routes ?? 0, bytes: body?.bytes ?? 0, commit: body?.commit }
    }
    publishedSnapshot.value = snapshot
    publishedInfo.value = {
      publishedAt: Date.now(),
      routes: stats.routes,
      bytes: stats.bytes,
      commit: stats.commit,
    }
    storeSet(PUBLISHED_BASELINE_KEY, snapshot)
    storeSet(PUBLISHED_INFO_KEY, JSON.stringify(publishedInfo.value))
  }

  /** takes the live site down and forgets the baseline, so the next publish
   * reads as a first one */
  async function unpublish() {
    const res = await fetch('/api/published', { method: 'DELETE' })
    if (!res.ok) {
      const detail = await res.json().catch(() => null)
      throw new Error(detail?.error ?? `unpublish failed (${res.status})`)
    }
    publishedSnapshot.value = null
    publishedInfo.value = null
    storeRemove(PUBLISHED_BASELINE_KEY)
    storeRemove(PUBLISHED_INFO_KEY)
  }

  return { hasUnpublishedChanges, markPublished, unpublish, publishedInfo }
}
