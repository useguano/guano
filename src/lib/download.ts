/** the filename a response names itself in `content-disposition`, or the
 * fallback — the server mints download names (`<project>_<id>.zip`), so the
 * client never has to agree with it on a spelling */
export function filenameFrom(res: Response, fallback: string): string {
  const header = res.headers.get('content-disposition') ?? ''
  return /filename="([^"]+)"/.exec(header)?.[1] ?? fallback
}

/** trigger a browser download for a Blob under the given filename */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
