import type { MediaKind } from '@/types/media'

/** mimes the server accepts, per kind — mirror of ALLOWED in server/media.mjs */
export const KIND_MIMES: Record<MediaKind, string[]> = {
  image: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml'],
  video: ['video/mp4', 'video/webm'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg'],
  document: ['application/pdf'],
  font: ['font/woff2', 'font/woff', 'font/ttf', 'font/otf'],
}

export const KIND_LABELS: Record<MediaKind, string> = {
  image: 'Images',
  video: 'Video',
  audio: 'Audio',
  document: 'Documents',
  font: 'Fonts',
}

/** `accept` attribute for a file input limited to the given kinds (all when omitted) */
export function acceptFor(kinds?: MediaKind[] | null): string {
  const list = kinds?.length ? kinds : (Object.keys(KIND_MIMES) as MediaKind[])
  return list.flatMap((k) => KIND_MIMES[k]).join(',')
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
