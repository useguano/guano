// Shared background-media rendering logic, used by the Vue renderers and the
// static exporter alike. An image background becomes a CSS background-image on
// the host; a video background becomes an absolutely-positioned <video> layer
// behind the content (the host is made position:relative).

const FIT_RE = /^object-/
const BG_SIZE_RE = /^bg-(auto|cover|contain|\[)/

/**
 * Media kind for a background ref that is NOT a library asset (https URL or
 * data: URL) — the library resolves kind from its mime index; everything else
 * falls back to this. Without it, external backgrounds were silently DROPPED
 * (kind null → backgroundRender null) in both the canvas and the export.
 */
export function backgroundKindFromUrl(url) {
  const s = String(url ?? '')
  if (/^data:video\//i.test(s)) return 'video'
  if (/^data:image\//i.test(s)) return 'image'
  if (/\.(mp4|webm|ogv|mov)([?#]|$)/i.test(s)) return 'video'
  return 'image'
}

/** CSS url() with the URL quoted and every breakout character percent-encoded,
 * so a crafted URL can't close the url() and inject extra declarations into
 * the host's inline style (equivalent bytes for any URL consumer). */
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
    // object-fit / object-position steer the layer; default to cover
    const fit = classTokens.filter((c) => FIT_RE.test(c))
    return {
      kind: 'video',
      url,
      style: '',
      hostClass: 'relative',
      layerClass: ['absolute', 'inset-0', '-z-10', 'h-full', 'w-full', ...(fit.length ? fit : ['object-cover'])].join(' '),
    }
  }

  // image: rely on any bg-size/bg-repeat/bg-position classes; when none set,
  // default to a sensible cover/center so a raw pick looks right
  const hasSize = classTokens.some((c) => BG_SIZE_RE.test(c))
  const style = hasSize
    ? `background-image:${cssUrl(url)}`
    : `background-image:${cssUrl(url)};background-size:cover;background-position:center`
  return { kind: 'image', url, style, hostClass: '', layerClass: '' }
}
