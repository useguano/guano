// Media extraction for the static exporter: interns data-URL media and
// referenced library assets into hashed files under media/ so the exported
// site is fully self-contained. Split out of export.mjs; the render
// mirror stays there per CLAUDE.md's keep-in-sync mandate.

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { sanitizeSvg } from './media.mjs'
import { log } from './log.mjs'
import { DATA_DIR, walkNodes } from './util.mjs'
import { fontSrcRefs } from '../src/lib/shared/fonts.js'
import { mediaRefsInRich } from '../src/lib/shared/richtext.js'

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'application/pdf': 'pdf',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
}

// media library storage (see server/media.mjs) — referenced assets are
// copied into the export under hashed names so the site stays fully static
const MEDIA_LIB = join(DATA_DIR, 'media')
const LIB_REF_RE = /^\/media\/([a-f0-9]{16})$/

// raster formats sharp can read a header from; an SVG has no intrinsic pixel
// size worth shipping and a PDF/font/video is not an <img> at all
const RASTER_EXT = new Set(['png', 'jpg', 'gif', 'webp', 'avif'])

// Formats worth generating responsive variants for. A GIF is excluded because
// it may be ANIMATED and a resize would flatten it to one frame; an SVG scales
// by itself; an AVIF is already smaller than the webp we would make of it.
const VARIANT_EXT = new Set(['png', 'jpg', 'webp'])
/** the widths a `srcset` offers, filtered to those SMALLER than the original —
 *  upscaling is strictly worse than letting the browser take the full file */
const VARIANT_WIDTHS = [480, 768, 1200, 1600]
// Resized files are cached by content hash + width, so a republish (and the
// preview export, which runs the same code) reads instead of re-encoding. The
// original is already named by its content hash, so the key is free.
const VARIANTS_DIR = join(MEDIA_LIB, 'variants')

export async function extractMedia(project) {
  const files = new Map() // relPath -> Buffer
  const paths = new Map() // dataUrl | '/media/<id>' -> '/media/<hash>.<ext>' | null (dropped)
  const libraryRefs = new Set() // '/media/<id>' strings, resolved after the scan
  // data-URL ref -> {width, height}: a library asset carries its dimensions in
  // the media index, but an inlined image never went through intake, so the
  // header is read here. Filled by `probes` below, awaited before the return.
  const dataSizes = new Map()
  // ref -> [{w, rel}] smallest first, the `srcset` an <img> offers
  const variants = new Map()
  // content hash -> the same list, so two refs to one file resize once
  const variantsByHash = new Map()
  const probes = []
  let madeVariantDir = false

  /** resize once per (hash, width), reading the cache when it is already there */
  const variantFor = async (hash, buffer, width) => {
    const name = `${hash}-${width}.webp`
    try {
      return await readFile(join(VARIANTS_DIR, name))
    } catch {
      /* not cached yet */
    }
    const out = await sharp(buffer)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()
    try {
      if (!madeVariantDir) {
        await mkdir(VARIANTS_DIR, { recursive: true })
        madeVariantDir = true
      }
      await writeFile(join(VARIANTS_DIR, name), out)
    } catch (err) {
      // an unwritable cache must not fail the export — it only costs time
      log.warn(`export: could not cache media variant ${name}: ${err.message}`)
    }
    return out
  }

  const store = (value, buffer, ext) => {
    const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 12)
    const rel = `assets/media/${hash}.${ext}`
    files.set(rel, buffer)
    paths.set(value, `/${rel}`)
    if (!RASTER_EXT.has(ext) || dataSizes.has(value)) return
    probes.push(
      sharp(buffer)
        .metadata()
        .then(async (meta) => {
          if (!Number.isFinite(meta?.width) || !Number.isFinite(meta?.height)) return
          dataSizes.set(value, { width: meta.width, height: meta.height })
          if (!VARIANT_EXT.has(ext)) return
          const already = variantsByHash.get(hash)
          if (already) {
            variants.set(value, already)
            return
          }
          const made = []
          for (const width of VARIANT_WIDTHS) {
            if (width >= meta.width) continue
            const out = await variantFor(hash, buffer, width)
            const vrel = `assets/media/${hash}-${width}.webp`
            files.set(vrel, out)
            made.push({ w: width, rel: `/${vrel}` })
          }
          variantsByHash.set(hash, made)
          variants.set(value, made)
        })
        .catch(() => {
          /* unreadable header — no dimensions, and no variants, is honest */
        }),
    )
  }

  const intern = (value) => {
    if (typeof value !== 'string') return
    if (LIB_REF_RE.test(value)) {
      libraryRefs.add(value)
      return
    }
    if (!value.startsWith('data:')) return
    if (paths.has(value)) return
    const match = value.match(/^data:([^;,]+)(;base64)?,/)
    const ext = match && MIME_EXT[match[1]]
    if (!match || !ext) {
      log.warn(`export: dropping media with unsupported mime ${match?.[1] ?? '?'}`)
      paths.set(value, null)
      return
    }
    const payload = value.slice(match[0].length)
    let buffer = match[2] ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload))
    // data-URL SVGs never went through media intake, so they get the same
    // script-stripping the upload path applies (media.mjs) — the served CSP
    // is the second layer, this is the first
    if (match[1] === 'image/svg+xml') buffer = Buffer.from(sanitizeSvg(buffer.toString('utf8')), 'utf8')
    store(value, buffer, ext)
  }

  const scanNode = (node) => {
    intern(node.src)
    intern(node.background)
    intern(node.conditions?.swapSrc)
    // a LINK to a library asset (a PDF download, a logo pack) is just as
    // server-specific as an <img src> — left alone, `/media/<id>` shipped
    // verbatim and 404'd on any host but this one
    intern(node.link)
    // …and so are hrefs/srcs written inside rich body copy
    for (const ref of mediaRefsInRich(node.content)) intern(ref)
    for (const override of Object.values(node.locales ?? {})) {
      intern(override.src)
      intern(override.link)
      for (const ref of mediaRefsInRich(override.content)) intern(ref)
    }
  }
  intern(project.settings?.favicon)
  intern(project.settings?.faviconDark)
  intern(project.settings?.seo?.logo)
  intern(project.settings?.seo?.ogImage)
  // registered webfonts: without this the exported @font-face still pointed at
  // /media/<id>, which only THIS server answers — the export is supposed to be
  // deployable to any static host, fonts included
  for (const ref of fontSrcRefs(project.settings)) intern(ref)
  for (const page of project.pages) walkNodes(page.elements, scanNode)
  for (const component of project.components ?? []) walkNodes([component.root], scanNode)
  for (const collection of project.collections ?? []) {
    const imageFields = collection.fields.filter((f) => f.type === 'image').map((f) => f.name)
    // multi-image holds an ARRAY of urls — every one of them has to be
    // extracted, or a gallery exports with dead /media/ links
    const mediaFields = collection.fields.filter((f) => f.type === 'multi-image').map((f) => f.name)
    for (const entry of collection.entries) {
      for (const field of imageFields) {
        intern(entry.values[field])
        for (const values of Object.values(entry.locales ?? {})) intern(values[field])
      }
      for (const field of mediaFields) {
        const urls = entry.values[field]
        if (Array.isArray(urls)) for (const url of urls) intern(url)
      }
      // rich-text fields carry their own links/images (an article body linking a
      // PDF from the library) — same server-specific refs as a node's content
      for (const value of Object.values(entry.values ?? {})) {
        if (typeof value === 'string') for (const ref of mediaRefsInRich(value)) intern(ref)
      }
      for (const values of Object.values(entry.locales ?? {})) {
        for (const value of Object.values(values ?? {})) {
          if (typeof value === 'string') for (const ref of mediaRefsInRich(value)) intern(ref)
        }
      }
    }
  }

  // resolve library refs: copy referenced bytes out of the media store so the
  // exported site is self-contained (deployable anywhere, immutable names)
  let assetsById = new Map()
  if (libraryRefs.size) {
    let index = { assets: [] }
    try {
      index = JSON.parse(await readFile(join(MEDIA_LIB, 'index.json'), 'utf8'))
    } catch {
      /* no library yet — every ref drops below */
    }
    assetsById = new Map((index.assets ?? []).map((a) => [a.id, a]))
    for (const ref of libraryRefs) {
      const id = LIB_REF_RE.exec(ref)[1]
      const asset = assetsById.get(id)
      const ext = asset && MIME_EXT[asset.mime]
      if (!ext) {
        log.warn(`export: dropping missing/unsupported media asset ${id}`)
        paths.set(ref, null)
        continue
      }
      try {
        store(ref, await readFile(join(MEDIA_LIB, 'files', id)), ext)
      } catch {
        log.warn(`export: media asset ${id} has no file on disk — dropped`)
        paths.set(ref, null)
      }
    }
  }

  await Promise.all(probes)

  const rewrite = (value) =>
    typeof value === 'string' && (value.startsWith('data:') || LIB_REF_RE.test(value))
      ? (paths.get(value) ?? undefined)
      : value
  /**
   * intrinsic pixel size of a media ref, or null. The library index records it
   * at upload (media.mjs `makeThumb`); an inlined data URL, and an asset from
   * before thumbnails existed, fall back to the header read in `store`. Null
   * when neither answers — the exporter then emits no width/height at all,
   * which is right: a guessed dimension distorts the image.
   */
  const sizeFor = (value) => {
    if (typeof value !== 'string') return null
    const id = LIB_REF_RE.exec(value)?.[1]
    const asset = id ? assetsById.get(id) : null
    if (asset && Number.isFinite(asset.width) && Number.isFinite(asset.height)) {
      return { width: asset.width, height: asset.height }
    }
    return dataSizes.get(value) ?? null
  }
  /** default alt text from the library asset a src references, if any */
  const altFor = (value) => {
    const id = typeof value === 'string' ? LIB_REF_RE.exec(value)?.[1] : null
    return (id && assetsById.get(id)?.alt) || ''
  }
  /** 'image' | 'video' | null for a media ref, from its library asset mime */
  const kindFor = (value) => {
    const id = typeof value === 'string' ? LIB_REF_RE.exec(value)?.[1] : null
    const mime = id && assetsById.get(id)?.mime
    if (!mime) return null
    return mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : null
  }
  /**
   * The `srcset` for a media ref, or '' — the resized copies the browser may
   * take instead of the full file. Never the original: that stays the `src`,
   * so a browser with no srcset support, and any ref whose widths were all
   * larger than the image, still gets a working image.
   */
  const srcsetFor = (value) => {
    const list = variants.get(value)
    if (!list || !list.length) return ''
    return list.map((v) => `${v.rel} ${v.w}w`).join(', ')
  }
  return { rewrite, altFor, kindFor, sizeFor, srcsetFor, files }
}
