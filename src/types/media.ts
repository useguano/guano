// Media library types. The server (server/media.mjs, plain JS) mirrors this
// shape without importing it — same convention as src/lib/shared/ registries.
// The index lives server-side, global across branches (never in the
// branch-scoped project blob), so these are fetched, not part of Project.

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'font'

export interface MediaAsset {
  /** 16-char hex, server-generated; the public URL is `/media/<id>` */
  id: string
  /** editable display name */
  name: string
  /** original upload filename, used for downloads + details */
  filename: string
  mime: string
  kind: MediaKind
  /** bytes */
  size: number
  /** images only */
  width?: number
  height?: number
  /** default alt text, applied when placed (a node may still override) */
  alt?: string
  folderId?: string
  /** whether a generated thumbnail exists at `/media/thumb/<id>` */
  hasThumb: boolean
  /** ISO timestamp */
  createdAt: string
  /** id of the user who uploaded it */
  uploadedBy: string
}

export interface MediaFolder {
  id: string
  name: string
  /** parent folder id; absent = a root-level folder */
  parentId?: string
}

export interface MediaIndex {
  assets: MediaAsset[]
  folders: MediaFolder[]
}

/** result of GET /api/media/<id>/usage */
export interface MediaUsage {
  total: number
  branches: Array<{ branchId: string; count: number }>
}
