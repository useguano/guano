import { computed, ref } from 'vue'
import { onUnauthorized } from '@/lib/store'
import type { MediaAsset, MediaFolder, MediaIndex, MediaKind, MediaUsage } from '@/types/media'

const assets = ref<MediaAsset[]>([])
const folders = ref<MediaFolder[]>([])
const loaded = ref(false)
let loading: Promise<void> | null = null

function idFromSrc(src: string | undefined): string | null {
  if (!src) return null
  const m = /^\/media\/([a-f0-9]{16})$/.exec(src)
  return m ? m[1]! : null
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (res.status === 401) {
    onUnauthorized()
    await new Promise(() => {})
  }
  const detail = await res.json().catch(() => null)
  if (!res.ok) throw new Error((detail as { error?: string })?.error ?? `request failed (${res.status})`)
  return detail as T
}

export function useMedia() {
  function loadMedia(): Promise<void> {
    if (loaded.value) return Promise.resolve()
    if (loading) return loading
    loading = api<MediaIndex>('/api/media')
      .then((index) => {
        assets.value = index.assets ?? []
        folders.value = index.folders ?? []
        loaded.value = true
      })
      .catch((err) => {
        loading = null
        throw err
      })
    return loading
  }

  async function upload(file: File, folderId?: string): Promise<MediaAsset> {
    const query = new URLSearchParams({ name: file.name })
    if (folderId) query.set('folder', folderId)
    const asset = await api<MediaAsset>(`/api/media?${query}`, {
      method: 'POST',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file,
    })
    assets.value.push(asset)
    return asset
  }

  async function replaceAsset(id: string, file: File): Promise<MediaAsset> {
    const updated = await api<MediaAsset>(`/api/media/${id}/replace`, {
      method: 'POST',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file,
    })
    patchLocal(updated)
    return updated
  }

  async function updateAsset(
    id: string,
    patch: { name?: string; alt?: string; folderId?: string | null },
  ): Promise<MediaAsset> {
    const updated = await api<MediaAsset>(`/api/media/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    patchLocal(updated)
    return updated
  }

  async function removeAsset(id: string): Promise<void> {
    await api(`/api/media/${id}`, { method: 'DELETE' })
    assets.value = assets.value.filter((a) => a.id !== id)
  }

  function usage(id: string): Promise<MediaUsage> {
    return api<MediaUsage>(`/api/media/${id}/usage`)
  }

  async function createFolder(name: string, parentId?: string): Promise<MediaFolder> {
    const folder = await api<MediaFolder>('/api/media/folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, parentId }),
    })
    folders.value.push(folder)
    return folder
  }

  async function renameFolder(id: string, name: string): Promise<MediaFolder> {
    const folder = await api<MediaFolder>(`/api/media/folders/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const local = folders.value.find((f) => f.id === id)
    if (local) local.name = folder.name
    return folder
  }

  async function moveFolder(id: string, parentId: string | null): Promise<MediaFolder> {
    const folder = await api<MediaFolder>(`/api/media/folders/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentId }),
    })
    const local = folders.value.find((f) => f.id === id)
    if (local) local.parentId = folder.parentId
    return folder
  }

  async function removeFolder(id: string): Promise<void> {
    const res = await api<{ ok: true; parentId: string | null }>(`/api/media/folders/${id}`, {
      method: 'DELETE',
    })
    const up = res.parentId ?? undefined
    for (const f of folders.value) if (f.parentId === id) f.parentId = up
    for (const a of assets.value) if (a.folderId === id) a.folderId = up
    folders.value = folders.value.filter((f) => f.id !== id)
  }

  function patchLocal(updated: MediaAsset) {
    const i = assets.value.findIndex((a) => a.id === updated.id)
    if (i !== -1) assets.value[i] = updated
  }

  const assetById = (id: string) => assets.value.find((a) => a.id === id)
  const assetForSrc = (src: string | undefined) => {
    const id = idFromSrc(src)
    return id ? assetById(id) : undefined
  }
  const mediaUrl = (asset: Pick<MediaAsset, 'id'>) => `/media/${asset.id}`
  const thumbUrl = (asset: MediaAsset) =>
    asset.hasThumb ? `/media/thumb/${asset.id}` : `/media/${asset.id}`

  return {
    assets: computed(() => assets.value),
    folders: computed(() => folders.value),
    loaded: computed(() => loaded.value),
    loadMedia,
    upload,
    replaceAsset,
    updateAsset,
    removeAsset,
    usage,
    createFolder,
    renameFolder,
    moveFolder,
    removeFolder,
    assetById,
    assetForSrc,
    idFromSrc,
    mediaUrl,
    thumbUrl,
  }
}

export function kindOfMime(mime: string): MediaKind | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('font/')) return 'font'
  if (mime === 'application/pdf') return 'document'
  return null
}
