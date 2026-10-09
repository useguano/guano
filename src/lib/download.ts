export function filenameFrom(res: Response, fallback: string): string {
  const header = res.headers.get('content-disposition') ?? ''
  return /filename="([^"]+)"/.exec(header)?.[1] ?? fallback
}

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
