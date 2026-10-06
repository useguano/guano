import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'

// The write that was saved, reported `saved: true`, and was gone later.
//
// Vezaro, MAJOR: a finished home page came back as the empty page the draft
// started from, after a run of writes to OTHER pages that were issued in
// parallel. Every call in between answered `saved: true`; nothing reported a
// conflict.
//
// The mechanism: a tool loads the whole project, works, and writes the whole
// thing back, and the baseline it refuses to overwrite past was ONE pair of
// module variables shared by every call. Two calls in flight both read the same
// bytes; the first save moved the shared baseline to its own write; the second
// save compared against THAT, found it current, and wrote a project built on
// the bytes from before the first write. One whole page, silently.
//
// So the property these specs hold is not "a conflict is reported" — it is
// that concurrent writes to different pages ALL survive, which is what the
// guide promises. The conflict path is tested separately, because the two
// answers are different: queue the write, or refuse it.

const body = (text: string) => pageHtml(`<section><h1>${text}</h1></section>`)

/** a session with `count` extra pages, each written once */
async function withPages(count: number) {
  const s = await mcpSession()
  const home = await s.home()
  const pages = [{ id: home.id as string, name: 'Home' }]
  for (let i = 1; i <= count; i++) {
    const r = await s.call('create_page', { name: `P${i}`, slug: `/p${i}` })
    pages.push({ id: r.pageId ?? r.page?.id, name: `P${i}` })
  }
  return { s, pages }
}

test.describe('concurrent whole-project writes', () => {
  test('nine page writes issued at once all land', async () => {
    const { s, pages } = await withPages(8)
    const versions = new Map<string, string>()
    for (const p of pages) {
      const r = await s.call('get_page', { pageId: p.id })
      versions.set(p.id, r.version)
    }

    // the shape that lost a page: one batch, no awaits in between
    const results = await Promise.all(
      pages.map((p) =>
        s.call('set_page_html', {
          pageId: p.id,
          html: body(`MARK-${p.name}`),
          version: versions.get(p.id),
        }),
      ),
    )
    for (const r of results) expect(r.saved, JSON.stringify(r)).toBe(true)

    // every one of them is in the stored project — the assertion that failed
    // before the write lock, for all but the last page in the batch
    const stored = s.stored()
    for (const p of pages) {
      const page = stored.pages.find((x: { id: string }) => x.id === p.id)
      expect(JSON.stringify(page.elements), `${p.name} was reverted`).toContain(`MARK-${p.name}`)
    }
  })

  test('a page write and an unrelated settings write do not erase each other', async () => {
    const { s, pages } = await withPages(0)
    const home = await s.call('get_page', { pageId: pages[0].id })
    const [a, b] = await Promise.all([
      s.call('set_page_html', {
        pageId: pages[0].id,
        html: body('KEEP-ME'),
        version: home.version,
      }),
      s.call('update_settings', { seo: { siteName: 'Vezaro' } }),
    ])
    expect(a.saved).toBe(true)
    expect(b.saved ?? true).toBeTruthy()
    const stored = s.stored()
    expect(JSON.stringify(stored.pages[0].elements)).toContain('KEEP-ME')
    expect(stored.settings.seo.siteName).toBe('Vezaro')
  })

  /** a rival save landing after the handler's `nth` project read */
  const rivalSaveAfterRead = (s: Awaited<ReturnType<typeof mcpSession>>, nth: number) => {
    let reads = 0
    s.onProjectRead(() => {
      if (++reads !== nth) return
      s.onProjectRead(null)
      s.writeStore(
        'guano-project:main',
        JSON.stringify({ ...s.stored(), name: 'renamed in the editor' }),
      )
    })
  }

  test('a human save inside the load→save window refuses the write', async () => {
    const { s, pages } = await withPages(0)
    const home = await s.call('get_page', { pageId: pages[0].id })
    // after the handler's own load: the write it is about to make is built on
    // bytes that no longer exist, and would take the rename down with it
    rivalSaveAfterRead(s, 1)

    const r = await s
      .call('set_page_html', {
        pageId: pages[0].id,
        html: body('SHOULD-NOT-LAND'),
        version: home.version,
      })
      .catch((e: Error) => ({ error: e.message }))

    expect(JSON.stringify(r)).toMatch(/changed while you were working on it/i)
    const stored = s.stored()
    expect(JSON.stringify(stored.pages[0].elements)).not.toContain('SHOULD-NOT-LAND')
    expect(stored.name).toBe('renamed in the editor')
  })

  test('a save landing after the check is still refused, by If-Match', async () => {
    const { s, pages } = await withPages(0)
    const home = await s.call('get_page', { pageId: pages[0].id })
    // the second read is the save's own compare — a rival write that lands
    // after it passes every client-side check, and only the compare-and-swap
    // on the write itself can see it
    rivalSaveAfterRead(s, 2)

    const r = await s
      .call('set_page_html', {
        pageId: pages[0].id,
        html: body('SHOULD-NOT-LAND'),
        version: home.version,
      })
      .catch((e: Error) => ({ error: e.message }))

    expect(JSON.stringify(r)).toMatch(/changed while you were working on it/i)
    const stored = s.stored()
    expect(JSON.stringify(stored.pages[0].elements)).not.toContain('SHOULD-NOT-LAND')
    expect(stored.name).toBe('renamed in the editor')
  })
})
