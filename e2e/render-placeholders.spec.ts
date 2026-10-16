import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'

// Three bugs found building a project-management prototype in Guano, each one a
// write the tools accepted and a published page that was wrong.

test.describe('an element default is an EDITOR placeholder', () => {
  test('an empty leaf exports empty, not its lorem', async () => {
    const s = await mcpSession()
    const home = await s.home()
    // the shapes that caught this: a colour dot, a badge dot, a toggle knob —
    // empty spans used as geometry, every one of which shipped "Dolor sit amet"
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(
        [
          '<span data-ref="dot" class="size-2 rounded-full bg-red-500"></span>',
          '<p data-ref="para"></p>',
          '<h2 data-ref="head"></h2>',
        ].join('\n'),
      ),
      version: home.version,
    })
    const html = await s.html()
    expect(html).not.toContain('Dolor sit amet')
    expect(html).not.toContain('Lorem ipsum')
    // the elements still render — it is their TEXT that is empty, not the box
    expect(html).toContain('rounded-full')
  })

  test('content someone actually wrote still ships', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<h2 data-ref="head">Real words</h2>'),
      version: home.version,
    })
    expect(await s.html()).toContain('Real words')
  })
})

test.describe('structural markup inside a leaf is refused, not absorbed', () => {
  test('a bound span inside a <p> is named rather than silently dropped', async () => {
    const s = await mcpSession()
    const c = (await s.call('create_collection', { name: 'activity', detailRoutes: false }))
      .collection
    await s.call('update_collection', {
      collectionId: c.id,
      addFields: [{ name: 'actor', type: 'text' }],
    })
    const home = await s.home()
    const r = await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(
        [
          '<collection-list data-ref="rows" source="activity">',
          '  <p data-ref="line">Hello <span data-field="actor" /> did a thing</p>',
          '</collection-list>',
        ].join('\n'),
      ),
      version: home.version,
    })
    const said = JSON.stringify(r)
    // the refusal names the attribute that would have been lost AND the way out
    expect(said).toContain('data-field')
    expect(said).toContain('container')
  })

  test('ordinary rich text inside a leaf is still accepted', async () => {
    const s = await mcpSession()
    const home = await s.home()
    const r = await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<p data-ref="line">Hello <strong>there</strong></p>'),
      version: home.version,
    })
    expect(r.saved).toBe(true)
    expect(await s.html()).toContain('<strong>there</strong>')
  })
})

test.describe('unmodelled classes are reported once', () => {
  test('twenty of them are one warning, not twenty', async () => {
    const s = await mcpSession()
    const home = await s.home()
    // genuinely unmodelled: a variant stack the Style panel has no control for
    const odd = Array.from({ length: 20 }, (_, i) => `focus-visible:ring-offset-chalk-${i}`)
    const r = await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(odd.map((cls, i) => `<span data-ref="s${i}" class="${cls}">x</span>`).join('\n')),
      version: home.version,
    })
    const notes = JSON.stringify(r).match(/Style panel has no control/g) ?? []
    expect(notes).toHaveLength(1)
  })
})
