const FIT_RE = /^object-/
const BG_SIZE_RE = /^bg-(auto|cover|contain|\[)/

export function backgroundKindFromUrl(url) {
  const s = String(url ?? '')
  if (/^data:video\//i.test(s)) return 'video'
  if (/^data:image\//i.test(s)) return 'image'
  if (/\.(mp4|webm|ogv|mov)([?#]|$)/i.test(s)) return 'video'
  return 'image'
}

const cssUrl = (url) =>
  `url("${String(url).replace(/[\\"()\s\u0000-\u001f]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase())}")`

/**
 * @param {'image'|'video'|null|undefined} kind
 * @param {string|undefined} url  already resolved/rewritten media URL
 * @param {string[]} classTokens  the element's class tokens (for fit/size hints)
 * @returns {null | {
 *   kind: 'image'|'video',
 *   url: string,
 *   style: string,        // inline style to merge onto the host
 *   hostClass: string,    // extra host classes (e.g. 'relative' for video)
 *   layerClass: string,   // class for the <video> layer (video only)
 * }}
 */
export function backgroundRender(kind, url, classTokens = []) {
  if (!url || !kind) return null

  if (kind === 'video') {
    const fit = classTokens.filter((c) => FIT_RE.test(c))
    return {
      kind: 'video',
      url,
      style: '',
      hostClass: 'relative',
      layerClass: ['absolute', 'inset-0', '-z-10', 'h-full', 'w-full', ...(fit.length ? fit : ['object-cover'])].join(' '),
    }
  }

  const hasSize = classTokens.some((c) => BG_SIZE_RE.test(c))
  const style = hasSize
    ? `background-image:${cssUrl(url)}`
    : `background-image:${cssUrl(url)};background-size:cover;background-position:center`
  return { kind: 'image', url, style, hostClass: '', layerClass: '' }
}
