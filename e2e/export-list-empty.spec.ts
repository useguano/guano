import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'

// `<list-empty>` is a list's empty state: a direct child that renders only when
// there is nothing to repeat, and is never repeated itself.
//
// Without it a list that matched nothing rendered as a blank gap. The Cocoapp
// review flagged exactly this ("Empty and loading states for every list" is a
// design standard the tools could not express), and the closed conversation that
// appeared in no tab had no "nothing here" to show either.

test.describe('a list’s empty state', () => {
  async function page(html: string, entries: { name: string }[]) {
    const s = await mcpSession()
    const c = (await s.call('create_collection', { name: 'item', detailRoutes: false }))
      .collection
    if (entries.length) await s.call('upsert_entries', { collectionId: c.id, entries })
    const home = await s.home()
    const r = await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(html),
      version: home.version,
    })
    return { s, r }
  }

  const LIST = [
    '<collection-list data-ref="rows" source="item">',
    '  <p data-ref="row" />',
    '  <list-empty data-ref="none">',
    '    <div data-type="text" data-ref="noneText" />',
    '  </list-empty>',
    '</collection-list>',
  ].join('\n')

  test('it renders when the list is empty, and not when it is not', async () => {
    const withEntries = await page(LIST, [{ name: 'One' }, { name: 'Two' }])
    expect(withEntries.r.saved).toBe(true)
    let after = await withEntries.s.home()
    await withEntries.s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        { ref: 'row', content: 'A row' },
        { ref: 'none', addClasses: ['italic'] },
      ],
    })
    let html = await withEntries.s.html()
    expect((html.match(/A row/g) ?? []).length).toBe(2)
    expect(html).not.toContain('italic')

    const noEntries = await page(LIST, [])
    after = await noEntries.s.home()
    await noEntries.s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        { ref: 'row', content: 'A row' },
        { ref: 'none', addClasses: ['italic'] },
      ],
    })
    html = await noEntries.s.html()
    // the empty block renders, and the row template does NOT
    expect(html).toContain('italic')
    expect(html).not.toContain('A row')
  })

  test('it is never repeated, even when the list has entries', async () => {
    const { s } = await page(LIST, [{ name: 'One' }, { name: 'Two' }, { name: 'Three' }])
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'none', addClasses: ['border-dashed'] }],
    })
    const html = await s.html()
    expect((html.match(/border-dashed/g) ?? []).length).toBe(0)
  })

  test('a filter that matches nothing shows it, which is the whole point', async () => {
    const s = await mcpSession()
    const c = (await s.call('create_collection', { name: 'item', detailRoutes: false }))
      .collection
    await s.call('update_collection', {
      collectionId: c.id,
      addFields: [{ name: 'status', type: 'text' }],
    })
    await s.call('upsert_entries', {
      collectionId: c.id,
      entries: [{ name: 'One', values: { status: 'active' } }],
    })
    const home = await s.home()
    await s.call('set_page_html', { pageId: home.id, html: pageHtml(LIST), version: home.version })
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        { ref: 'rows', listQuery: { filter: { field: 'status', equals: 'closed' } } },
        { ref: 'row', content: 'A row' },
        { ref: 'noneText', content: 'No closed conversations' },
      ],
    })
    const html = await s.html()
    expect(html).toContain('No closed conversations')
    expect(html).not.toContain('A row')
  })

  test('written outside a list it is reported as a diagnostic', async () => {
    // it is a diagnostic rather than a refusal: the markup is well-formed and
    // storable, and a diagnostic names the ELEMENT, which only exists once the
    // write landed. The response says so in its notes.
    const { r } = await page('<list-empty data-ref="none"><div data-type="text" /></list-empty>', [])
    expect(r.saved).toBe(true)
    expect(JSON.stringify(r.diagnostics)).toContain('empty state')
    expect(JSON.stringify(r.notes)).toContain('diagnostics')
  })
})
