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

export const PUBLISHED_BASELINE_KEY = 'guano-published-baseline'

const publishedSnapshot = ref<string | null>(null)

export const PUBLISHED_INFO_KEY = 'guano-published-info'
const publishedInfo = ref<{
  publishedAt: number
  routes: number
  bytes: number
  commit?: string
} | null>(null)

const storedMainSnapshot = ref<string | null>(null)

function readMainSnapshot(): string | null {
  const main = readStoredProject(projectStorageKey(MAIN_ID))
  return main ? JSON.stringify(main) : null
}

watch(activeBranchId, () => {
  if (activeBranchId.value !== MAIN_ID) storedMainSnapshot.value = readMainSnapshot()
})

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
  const mainSnapshot = computed(() =>
    activeBranchId.value === MAIN_ID ? currentSnapshot.value : storedMainSnapshot.value,
  )

  const hasUnpublishedChanges = computed(
    () => publishedSnapshot.value === null || mainSnapshot.value !== publishedSnapshot.value,
  )

  async function markPublished(method: PublishMethod = 'server', signal?: AbortSignal): Promise<void> {
    await usePersistence().saveNow()
    await flushStore()
    if (storeError.value) {
      throw new Error(`Changes are not saved — publishing would ship something else. ${storeError.value}`)
    }
    let snapshot: string
    if (activeBranchId.value === MAIN_ID) {
      snapshot = currentSnapshot.value
    } else {
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
    if (res.status === 401) onUnauthorized()
    if (!res.ok) {
      const detail = await res.json().catch(() => null)
      throw new Error(detail?.error ?? `publish failed (${res.status})`)
    }
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
