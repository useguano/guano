// Root-absolute → depth-relative URL rewriting for the ZIP export.
//
// The exporter emits root-absolute URLs (`/assets/style.css`, `/fr`) because
// that is what a site served from a domain root needs, and it is what the
// `server` and `github` methods deploy. A zip is different: it is opened from
// disk (`file:///assets/style.css` resolves to the drive's root, so every page
// comes up unstyled and without its runtime) or dropped into a sub-folder of
// some host, where `/assets/` points at the host's root rather than the site's.
// So the zip — and ONLY the zip — rewrites every root-absolute reference to one
// relative to the file that carries it: `assets/style.css` at the root,
// `../assets/style.css` one level down. The exported directory on disk is
// untouched; this runs over the in-memory file list on the way into the archive.
//
// Route links become explicit files (`/fr` → `../fr/index.html`), because a
// directory URL only resolves to its index on a server; from disk it opens a
// listing or nothing. Anything that is not a path into the export is left
// alone: protocol-relative `//cdn…`, the form endpoint under `/_superbird/` (which
// lives on the instance, never in the zip), `data-form-redirect` (consumed by
// the runtime as a root-relative route), JSON-LD, and `<meta content>` (an
// `og:image` has to be absolute anyway).

const ATTR_RE = /\b(href|src|poster|action|srcset)=("|')([^"']*)\2/g
const CSS_URL_RE = /url\(\s*(["']?)(\/[^"')]*)\1\s*\)/g

/** `../` for each directory between the file and the export root */
const prefixFor = (path) => '../'.repeat(path.split('/').length - 1)

/** does the last path segment name a file (has an extension)? */
const looksLikeFile = (pathname) => /\.[a-z0-9]+$/i.test(pathname.split('/').pop() ?? '')

/**
 * One root-absolute URL → relative to a file at `prefix`. Returns the input
 * unchanged when it is not a path into the export.
 */
export function relativizeUrl(url, prefix) {
  if (!url.startsWith('/') || url.startsWith('//') || url.startsWith('/_superbird/')) return url
  const m = /^([^?#]*)(.*)$/.exec(url)
  const pathname = m[1]
  const tail = m[2]
  if (pathname === '/') return `${prefix}index.html${tail}`
  const rel = pathname.slice(1).replace(/\/$/, '')
  return looksLikeFile(rel) ? `${prefix}${rel}${tail}` : `${prefix}${rel}/index.html${tail}`
}

function relativizeHtml(html, prefix) {
  return html.replace(ATTR_RE, (whole, name, quote, value) => {
    if (name === 'srcset') {
      const next = value
        .split(',')
        .map((candidate) => {
          const trimmed = candidate.trim()
          const space = trimmed.search(/\s/)
          const url = space === -1 ? trimmed : trimmed.slice(0, space)
          const descriptor = space === -1 ? '' : trimmed.slice(space)
          return relativizeUrl(url, prefix) + descriptor
        })
        .join(', ')
      return `${name}=${quote}${next}${quote}`
    }
    return `${name}=${quote}${relativizeUrl(value, prefix)}${quote}`
  })
}

const relativizeCss = (css, prefix) =>
  css.replace(CSS_URL_RE, (whole, quote, url) => `url(${quote}${relativizeUrl(url, prefix)}${quote})`)

/**
 * Rewrite an exported site's file list for a zip. HTML and CSS files are
 * rewritten per their own depth; everything else is passed through as is.
 * @param {{path: string, data: Buffer}[]} files  as `readDirFiles` returns them
 */
export function relativizeSite(files) {
  return files.map((file) => {
    const prefix = prefixFor(file.path)
    if (file.path.endsWith('.html')) {
      return { ...file, data: Buffer.from(relativizeHtml(file.data.toString('utf8'), prefix)) }
    }
    if (file.path.endsWith('.css')) {
      return { ...file, data: Buffer.from(relativizeCss(file.data.toString('utf8'), prefix)) }
    }
    return file
  })
}

// ---------- mounted preview: root-absolute → mount-prefixed ----------
//
// The preview is served from the MAIN server under `/_superbird/preview/`, not from
// a second port on PORT+1. That port bound every interface, spoke plain HTTP
// while the studio is HTTPS, needed its own token gate, its own rate-limit
// buckets and its own form handler — and behind any proxy, or on a VPS, it is
// simply unreachable, so the `preview` tool handed out a URL that hangs. One
// origin fixes all of it.
//
// Root-absolute URLs are what made a sub-path impossible, so they are rewritten
// here, the way the zip rewrite does it — but to the mount rather than to a
// relative depth. Keeping them absolute means a route stays a clean directory
// URL (`/_superbird/preview/pricing`) that the server resolves to its index.html,
// and it is the form of URL an agent can navigate to directly.
//
// Three paths are NOT the site's and must survive untouched: `//cdn…`, and
// anything under `/_superbird/` or `/media/` (instance routes, not export paths).
// The one exception is the form endpoint, which is remapped INTO the mount so a
// draft form posts to the preview's own handler — it validates exactly as the
// live one does and then stores and sends nothing. Without that remap a form
// tried out in the preview would put a row in the real list.
const FORMS_PREFIX = '/_superbird/forms/'

/** One root-absolute URL → the same path under `mount`. */
export function mountUrl(url, mount) {
  if (!url.startsWith('/') || url.startsWith('//')) return url
  if (url.startsWith(FORMS_PREFIX)) return `${mount}/forms/${url.slice(FORMS_PREFIX.length)}`
  if (url.startsWith('/_superbird/') || url.startsWith('/media/')) return url
  return mount + url
}

const mountHtml = (html, mount) =>
  html
    .replace(ATTR_RE, (whole, name, quote, value) => {
      if (name === 'srcset') {
        const next = value
          .split(',')
          .map((candidate) => {
            const trimmed = candidate.trim()
            const space = trimmed.search(/\s/)
            const url = space === -1 ? trimmed : trimmed.slice(0, space)
            const descriptor = space === -1 ? '' : trimmed.slice(space)
            return mountUrl(url, mount) + descriptor
          })
          .join(', ')
        return `${name}=${quote}${next}${quote}`
      }
      return `${name}=${quote}${mountUrl(value, mount)}${quote}`
    })
    // the runtime reads this as a root-relative route and navigates to it
    // itself, so it is rewritten here where the zip leaves it alone
    .replace(/\bdata-form-redirect=("|')([^"']*)\1/g, (whole, quote, value) =>
      `data-form-redirect=${quote}${mountUrl(value, mount)}${quote}`,
    )

const mountCss = (css, mount) =>
  css.replace(CSS_URL_RE, (whole, quote, url) => `url(${quote}${mountUrl(url, mount)}${quote})`)

/**
 * Rewrite an exported site's file list to be served under `mount`.
 * @param {{path: string, data: Buffer}[]} files  as `readDirFiles` returns them
 * @param {string} mount  no trailing slash, e.g. `/_superbird/preview`
 */
export function mountSite(files, mount) {
  return files.map((file) => {
    if (file.path.endsWith('.html')) {
      return { ...file, data: Buffer.from(mountHtml(file.data.toString('utf8'), mount)) }
    }
    if (file.path.endsWith('.css')) {
      return { ...file, data: Buffer.from(mountCss(file.data.toString('utf8'), mount)) }
    }
    return file
  })
}
