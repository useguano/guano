import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// E12: `missingTranslatable` counted the `shadowedByAll` masters the guide
// tells you to SKIP, so the counter could never reach 0 for anyone following
// the advice. E13: a page's SEO title and description — text a visitor reads in
// the tab and in every search result — were not in the worklist at all, so
// "missingTranslatable: 0" could be reached with every title still in English.

test.describe('the translation counter', () => {
  test('a master every instance shadows is not counted as work left', async () => {
    const s = await mcpSession()
    await s.call('update_settings', { addLocales: ['fr'] })
    const made = await s.call('create_component', {
      name: 'Row',
      html: '<div class="flex"><span>Master text</span></div>',
    })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<Row data-ref="a" />\n<Row data-ref="b" />'),
      version: home.version,
    })
    const page = await s.home()
    // both instances carry their own text, so the master renders nowhere
    const r = await s.call('edit_elements', {
      pageId: page.id,
      version: page.version,
      edits: [
        { ref: 'a', part: 'span', content: 'A' },
        { ref: 'b', part: 'span', content: 'B' },
      ],
    })
    expect(r.failed).toBe(0)

    // a bare call is counters-only, so ask for the kind
    const work = await s.call('get_translation_worklist', { locale: 'fr', kind: 'master' })
    const master = (work.items as { kind: string; shadowedByAll?: boolean }[])[0]
    expect(master?.shadowedByAll).toBe(true)
    expect(work.shadowedByAll).toBe(1)

    // translating the two instances — what the guide says to do — reaches 0
    const els = await s.call('get_translation_worklist', { locale: 'fr', kind: 'element' })
    const items = els.items as { key: string }[]
    expect(items).toHaveLength(2)
    const wrote = await s.call('set_translations', {
      locale: 'fr',
      handle: els.handle,
      items: items.map((i) => ({ key: i.key, text: 'FR' })),
    })
    expect(wrote.failures ?? []).toEqual([])
    const after = await s.call('get_translation_worklist', { locale: 'fr', countsOnly: true })
    expect(after.missingTranslatable).toBe(0)
  })
})

test.describe('SEO in the worklist', () => {
  test('a page title and description are listed and writable', async () => {
    const s = await mcpSession()
    await s.call('update_settings', { addLocales: ['fr'] })
    const home = await s.home()
    await s.call('set_page_seo', {
      pageId: home.id,
      title: 'Ridgeline — trail maps',
      description: 'Routes above the treeline.',
    })

    const work = await s.call('get_translation_worklist', { locale: 'fr', kind: 'seo' })
    const rows = work.items as { field: string; key: string; base: { text: string } }[]
    expect(rows.map((r) => r.field).sort()).toEqual(['description', 'title'])
    expect(rows.find((r) => r.field === 'title')!.base.text).toContain('Ridgeline')

    // written by handle: the keyed form carries no pageId and no field at all
    const wrote = await s.call('set_translations', {
      locale: 'fr',
      handle: work.handle,
      items: rows.map((r) => ({
        key: r.key,
        text: r.field === 'title' ? 'Ligne de crête' : 'Au-dessus de la forêt.',
      })),
    })
    expect(wrote.failures ?? []).toEqual([])
    expect(wrote.written).toBe(2)

    // the fr route carries the translated title
    const dir = await s.exportAll()
    expect(dir['fr/index.html']).toContain('Ligne de crête')
    expect(dir['index.html']).toContain('Ridgeline')

    // and the worklist now reports them done
    const after = await s.call('get_translation_worklist', { locale: 'fr', kind: 'seo' })
    expect((after.items as { override?: unknown }[]).every((i) => i.override)).toBe(true)
  })

  test('clearing an SEO override leaves the page byte-identical', async () => {
    const s = await mcpSession()
    await s.call('update_settings', { addLocales: ['fr'] })
    const home = await s.home()
    await s.call('set_page_seo', { pageId: home.id, title: 'T' })
    const before = JSON.stringify(s.stored().pages[0])
    await s.call('set_translations', {
      locale: 'fr',
      items: [{ kind: 'seo', pageId: home.id, field: 'title', content: 'Te' }],
    })
    await s.call('set_translations', {
      locale: 'fr',
      items: [{ kind: 'seo', pageId: home.id, field: 'title', content: '' }],
    })
    expect(JSON.stringify(s.stored().pages[0])).toBe(before)
  })
})

test.describe('the worklist can go to disk', () => {
  test('outputPath writes the items, and set_translations reads them back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'guano-wl-'))
    try {
      const s = await mcpSession()
      await s.call('update_settings', { addLocales: ['fr'] })
      const home = await s.home()
      await s.call('set_page_html', {
        pageId: home.id,
        html: pageHtml('<h1 data-ref="t">Ridgeline</h1>\n<p data-ref="p">Above the treeline.</p>'),
        version: home.version,
      })

      const out = join(dir, 'fr.json')
      const r = await s.call('get_translation_worklist', { locale: 'fr', outputPath: out })
      // the response carries the counters and the path, not the items
      expect(r.items).toBeUndefined()
      expect(r.outputPath).toBe(out)
      expect(r.next).toContain('itemsPath')

      const file = JSON.parse(readFileSync(out, 'utf8'))
      expect(file.locale).toBe('fr')
      expect(file.items.length).toBe(2)

      // translate in the file, hand it straight back
      for (const item of file.items) item.content = `FR ${item.base.text}`
      const { writeFileSync } = await import('node:fs')
      writeFileSync(out, JSON.stringify(file))
      const wrote = await s.call('set_translations', { locale: 'fr', itemsPath: out })
      expect(wrote.failures ?? []).toEqual([])
      expect(wrote.written).toBe(2)

      const after = await s.call('get_translation_worklist', { locale: 'fr', countsOnly: true })
      expect(after.missingTranslatable).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// 3I: a worklist item's ADDRESS is most of its bytes and it used to travel
// twice — out in the worklist and back in the write. The handle keeps the
// addresses in the server process.
test.describe('the worklist handle', () => {
  const built = async () => {
    const s = await mcpSession()
    await s.call('update_settings', { addLocales: ['fr', 'de'] })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<h1 data-ref="t">Ridgeline</h1>\n<p data-ref="p">Above the treeline.</p>'),
      version: home.version,
    })
    return s
  }

  test('a bare call returns the counters, and says how to get the items', async () => {
    const s = await built()
    const bare = await s.call('get_translation_worklist', { locale: 'fr' })
    expect(bare.items).toBeUndefined()
    expect(bare.total).toBe(2)
    expect(bare.missingTranslatable).toBe(2)
    expect(bare.next).toContain('filter')
    // small enough that an agent can afford it on every check
    expect(JSON.stringify(bare).length).toBeLessThan(600)
  })

  test('keyed items carry no addresses, and write back by key', async () => {
    const s = await built()
    const wl = await s.call('get_translation_worklist', { locale: 'fr', missingOnly: true })
    expect(wl.handle).toMatch(/^wl-/)
    const items = wl.items as Record<string, unknown>[]
    expect(items).toHaveLength(2)
    // the address is gone from the wire: no pageId, no id
    for (const item of items) {
      expect(item.key).toBeTruthy()
      expect(item.pageId).toBeUndefined()
      expect(item.id).toBeUndefined()
    }

    const r = await s.call('set_translations', {
      locale: 'fr',
      handle: wl.handle,
      items: items.map((i) => ({ key: i.key, text: 'FR' })),
    })
    expect(r.failures ?? []).toEqual([])
    expect(r.written).toBe(2)
    expect(
      (await s.call('get_translation_worklist', { locale: 'fr' })).missingTranslatable,
    ).toBe(0)
  })

  test('a handle from another locale, or an unknown key, is refused by name', async () => {
    const s = await built()
    const fr = await s.call('get_translation_worklist', { locale: 'fr', missingOnly: true })
    // the handle is per locale: writing it at `de` would translate into the
    // wrong language silently
    await expect(
      s.call('set_translations', {
        locale: 'de',
        handle: fr.handle,
        items: [{ key: '0', text: 'DE' }],
      }),
    ).rejects.toThrow(/locale "fr"/)

    // a fresh worklist invalidates the old handle rather than resolving stale keys
    const again = await s.call('get_translation_worklist', { locale: 'fr', missingOnly: true })
    expect(again.handle).not.toBe(fr.handle)
    await expect(
      s.call('set_translations', {
        locale: 'fr',
        handle: fr.handle,
        items: [{ key: '0', text: 'FR' }],
      }),
    ).rejects.toThrow(/not the one this session last handed out/)

    await expect(
      s.call('set_translations', {
        locale: 'fr',
        handle: again.handle,
        items: [{ key: '99', text: 'FR' }],
      }),
    ).rejects.toThrow(/no item with key "99"/)
  })
})
