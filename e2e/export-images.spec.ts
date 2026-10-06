import { test, expect } from '@playwright/test'
import sharp from 'sharp'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mcpSession } from './fixtures/mcpSession'

// The performance attributes the exporter puts on every <img>: intrinsic
// width/height (so the box is reserved and the page does not reflow as images
// arrive), decoding="async", and ONE eager image per route.
//
// They are exporter-only by design — they change no pixel — so the canvas
// never sees them and these checks read the EXPORTED HTML.
//
// The load-bearing rule is that width/height must never DISTORT an image: they
// are safe only because the exported stylesheet carries Tailwind's preflight
// `img,video{max-width:100%;height:auto}`. That rule is asserted here too, so
// a future stylesheet change cannot quietly break every responsive image.

/** a solid PNG of the given size, as a data URL — the intrinsic size the
 *  exporter is expected to read back off the header */
async function pngDataUrl(width: number, height: number) {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 120, b: 220 } },
  })
    .png()
    .toBuffer()
  return `data:image/png;base64,${buf.toString('base64')}`
}

/** the <img …> tags of a rendered route, in document order */
const imgs = (html: string) => html.match(/<img\b[^>]*>/g) ?? []

/** a one-page project whose body holds the given nodes */
function projectWith(runtime: any, nodes: unknown[]) {
  const project = runtime.createProject('Images')
  const body = project.pages[0].elements.find((n: any) => n.type === 'body')
  body.children = nodes
  return project
}

let i = 0
const node = (extra: Record<string, unknown>) => ({
  id: `img-node-${++i}`,
  type: 'image',
  children: [],
  ...extra,
})

test.describe('exported image attributes', () => {
  test('intrinsic size, async decoding, and one eager image per route', async () => {
    const s = await mcpSession()
    const wide = await pngDataUrl(2, 1)
    const tall = await pngDataUrl(1, 2)
    const html = await s.exportWith(
      projectWith(s.runtime, [
        node({ src: wide }),
        node({ src: tall }),
        node({ src: '/media/0000000000000000' }),
      ]),
      [],
    )

    const tags = imgs(html)
    expect(tags).toHaveLength(3)
    // the missing library ref is dropped as before: the element still renders,
    // with no src — and so with no size either, since there is nothing to read
    expect(html).not.toContain('/media/0000000000000000')
    expect(tags[2]).not.toContain('src=')
    expect(tags[2]).not.toContain('width=')

    // the header read gives each image its real pixel size
    expect(tags[0]).toContain('width="2" height="1"')
    expect(tags[1]).toContain('width="1" height="2"')

    // every image decodes off the main thread
    for (const tag of tags) expect(tag).toContain('decoding="async"')

    // ONE eager image: a hero is one image, and fetchpriority="high" on
    // several is worse than on none
    expect(tags[0]).toContain('fetchpriority="high"')
    expect(tags[0]).not.toContain('loading=')
    expect(tags[1]).toContain('loading="lazy"')
    expect(tags[1]).not.toContain('fetchpriority')
  })

  test('an authored loading wins, and the exporter adds none of its own', async () => {
    const s = await mcpSession()
    const src = await pngDataUrl(4, 3)
    const html = await s.exportWith(
      projectWith(s.runtime, [
        node({ src }),
        node({ src, attributes: { loading: 'eager' } }),
      ]),
      [],
    )

    const tags = imgs(html)
    expect(tags).toHaveLength(2)
    expect(tags[1]).toContain('loading="eager"')
    // …and exactly once: a duplicate attribute resolves to the FIRST
    // occurrence, so an exporter default emitted beside it would win silently
    expect(tags[1]!.match(/loading=/g)).toHaveLength(1)
    expect(tags[1]).not.toContain('loading="lazy"')
  })

  test('the box is reserved without distorting: the stylesheet keeps height auto', async () => {
    const s = await mcpSession()
    const css = await s.css()
    expect(css.replace(/\s+/g, '')).toContain('img,video{max-width:100%;height:auto}')
  })

  test('a field-bound image carries its size too', async () => {
    const s = await mcpSession()
    const c = (await s.call('create_collection', { name: 'shot', detailRoutes: false })).collection
    await s.call('update_collection', {
      collectionId: c.id,
      addFields: [{ name: 'photo', type: 'image' }],
    })
    await s.call('upsert_entries', {
      collectionId: c.id,
      entries: [{ name: 'One', values: { photo: await pngDataUrl(8, 5) } }],
    })

    const project = s.stored()
    const body = project.pages[0].elements.find((n: any) => n.type === 'body')
    body.children = [
      {
        id: 'list-1',
        type: 'collection-list',
        arg: 'shot',
        children: [node({ src: '', arg: 'photo' })],
      },
    ]
    const html = await s.exportWith(project, [])

    const tags = imgs(html)
    expect(tags).toHaveLength(1)
    expect(tags[0]).toContain('width="8" height="5"')
    expect(tags[0]).toContain('decoding="async"')
  })

  test('an image with no readable size gets no width or height at all', async () => {
    const s = await mcpSession()
    // an SVG has no intrinsic pixel size worth shipping; a guessed one would
    // distort it, so the honest answer is to emit neither attribute
    const svg = `data:image/svg+xml;base64,${Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
    ).toString('base64')}`
    const html = await s.exportWith(projectWith(s.runtime, [node({ src: svg })]), [])

    const tags = imgs(html)
    expect(tags).toHaveLength(1)
    expect(tags[0]).not.toContain('width=')
    expect(tags[0]).not.toContain('height=')
    // the hints that cost nothing are still there
    expect(tags[0]).toContain('decoding="async"')
    expect(tags[0]).toContain('fetchpriority="high"')
  })
})

test.describe('responsive variants', () => {
  /** a solid PNG wide enough to be worth resizing */
  const wide = (width: number) => pngDataUrl(width, Math.round(width / 2))

  test('a large image offers every width below it, and the files are written', async () => {
    const s = await mcpSession()
    const html = await s.exportWith(projectWith(s.runtime, [node({ src: await wide(2000) })]), [])
    const tag = imgs(html)[0]!
    for (const w of [480, 768, 1200, 1600]) expect(tag).toContain(`${w}w`)
    // the src stays the ORIGINAL, so a browser without srcset still works
    expect(tag).toMatch(/src="\/assets\/media\/[a-f0-9]{12}\.png"/)
    expect(tag).toContain('sizes="100vw"')

    // …and every file the srcset names really is in the export
    const dir = await s.exportDir(projectWith(s.runtime, [node({ src: await wide(2000) })]))
    try {
      for (const m of tag.matchAll(/\/(assets\/media\/[^ ]+\.webp) \d+w/g)) {
        expect(existsSync(join(dir, m[1]!))).toBe(true)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a small image offers only the widths below it, and a GIF offers none', async () => {
    const s = await mcpSession()
    const gifBuf = await sharp({
      create: { width: 1000, height: 400, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .gif()
      .toBuffer()
    const html = await s.exportWith(
      projectWith(s.runtime, [
        node({ src: await wide(600) }),
        node({ src: `data:image/gif;base64,${gifBuf.toString('base64')}` }),
      ]),
      [],
    )
    const tags = imgs(html)
    expect(tags[0]).toContain('480w')
    expect(tags[0]).not.toContain('768w')
    // a GIF may be ANIMATED, and a resize would flatten it to one frame
    expect(tags[1]).not.toContain('srcset')
    expect(tags[1]).not.toContain('sizes=')
  })

  test('an authored sizes wins, and is never emitted twice', async () => {
    const s = await mcpSession()
    const src = await wide(2000)
    const html = await s.exportWith(
      projectWith(s.runtime, [
        node({ src, attributes: { sizes: '(min-width: 768px) 33vw, 100vw' } }),
      ]),
      [],
    )
    const tag = imgs(html)[0]!
    expect(tag).toContain('sizes="(min-width: 768px) 33vw, 100vw"')
    expect(tag.match(/sizes=/g)).toHaveLength(1)
  })

  test('a second export reads the cache: the variant files are byte-identical', async () => {
    const s = await mcpSession()
    const src = await wide(2000)
    const project = projectWith(s.runtime, [node({ src })])
    const first = await s.exportDir(project)
    const second = await s.exportDir(project)
    try {
      const webps = readdirSync(join(first, 'assets/media')).filter((f) => f.endsWith('.webp'))
      expect(webps.length).toBe(4)
      for (const name of webps) {
        const a = readFileSync(join(first, 'assets/media', name))
        const b = readFileSync(join(second, 'assets/media', name))
        expect(b.equals(a)).toBe(true)
      }
    } finally {
      rmSync(first, { recursive: true, force: true })
      rmSync(second, { recursive: true, force: true })
    }
  })
})
