export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'font'

export interface MediaAsset {
  id: string
  name: string
  filename: string
  mime: string
  kind: MediaKind
  size: number
  width?: number
  height?: number
  alt?: string
  folderId?: string
  hasThumb: boolean
  createdAt: string
  uploadedBy: string
}

export interface MediaFolder {
  id: string
  name: string
  parentId?: string
}

export interface MediaIndex {
  assets: MediaAsset[]
  folders: MediaFolder[]
}

export interface MediaUsage {
  total: number
  branches: Array<{ branchId: string; count: number }>
}
