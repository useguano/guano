import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'

// E2: `edit_structure {op: "replace"}` dropped the element it replaced and
// hoisted its children, reporting `saved: true` with nothing refused.
//
// `applyHtml` adopts a single parsed root onto the root it is GIVEN when the
// types match. The replace op passed a throwaway holder typed after the
// target's PARENT, so replacing a `<div>` that sits inside a `<div>` adopted
// the markup's root onto the holder instead: the replaced element was absorbed
// into a node that is thrown away, its children spliced in flat, and its id
// re-seated onto whichever child the LCS paired it with. Replacing a `<div>`
// at the top of the body happened to work, which is why it looked fine.

test.describe('replace keeps the element it replaces', () => {
  const build = async () => {
    const s = await mcpSession()
    await s.call('create_component', {
      name: 'ProjectRow',
      html: '<div class="flex"><span>row</span></div>',
    })
    await s.call('create_component', {
      name: 'Button',
      html: '<button class="px-3"><span>Go</span></button>',
    })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(
        [
          '<div data-ref="outer" class="p-2">',
          '  <div data-ref="row-wrap" class="flex items-center">',
          '    <ProjectRow />',
          '    <Button />',
          '  </div>',
          '</div>',
        ].join('\n'),
      ),
      version: home.version,
    })
    return s
  }

  test('a div replaced inside a div survives, with its id', async () => {
    const s = await build()
    const before = await s.call('get_page', { pageId: (await s.home()).id, elements: 'own' })
    const wrapId = (before.elements as { ref?: string; id: string }[]).find(
      (e) => e.ref === 'row-wrap',
    )!.id

    const r = await s.call('edit_structure', {
      pageId: before.pageId,
      version: before.version,
      ops: [
        {
          op: 'replace',
          target: 'row-wrap',
          html:
            '<div data-ref="row-wrap" class="flex items-center"><ProjectRow />' +
            '<div data-ref="btn-box" class="ml-auto"><Button /></div></div>',
        },
      ],
      elements: 'none',
    })
    expect(r.saved).toBe(true)

    const after = await s.call('get_page', { pageId: before.pageId, elements: 'own' })
    const rows = after.elements as { ref?: string; id: string; type: string }[]
    // the replaced element is still there, still the same node
    const wrap = rows.find((e) => e.ref === 'row-wrap')
    expect(wrap).toBeTruthy()
    expect(wrap!.id).toBe(wrapId)
    // and the new box is INSIDE it, not beside it
    expect(after.html).toMatch(
      /data-ref="row-wrap"[\s\S]*data-ref="btn-box"[\s\S]*<\/div>\s*<\/div>/,
    )
    // the published page shows both boxes
    const html = await s.html()
    expect(html).toContain('class="p-2"')
    expect(html).toContain('class="flex items-center"')
    expect(html).toContain('class="ml-auto"')
  })

  test('replacing with a different tag still works', async () => {
    const s = await build()
    const before = await s.call('get_page', { pageId: (await s.home()).id, elements: 'none' })
    const r = await s.call('edit_structure', {
      pageId: before.pageId,
      version: before.version,
      ops: [{ op: 'replace', target: 'row-wrap', html: '<section data-ref="sec"><p>x</p></section>' }],
      elements: 'none',
    })
    expect(r.saved).toBe(true)
    const after = await s.call('get_page', { pageId: before.pageId, elements: 'none' })
    expect(after.html).toContain('data-ref="sec"')
    expect(after.html).not.toContain('data-ref="row-wrap"')
  })

  test('inserting a wrapper around one child leaves every sibling in place', async () => {
    const s = await build()
    const before = await s.call('get_page', { pageId: (await s.home()).id, elements: 'none' })
    const r = await s.call('edit_structure', {
      pageId: before.pageId,
      version: before.version,
      ops: [{ op: 'wrap', target: 'row-wrap', html: '<div data-ref="shell" class="rounded" />' }],
      elements: 'none',
    })
    expect(r.saved).toBe(true)
    const after = await s.call('get_page', { pageId: before.pageId, elements: 'none' })
    expect(after.html).toMatch(/data-ref="shell"[\s\S]*data-ref="row-wrap"/)
    expect(after.html).toContain('ProjectRow')
    expect(after.html).toContain('Button')
  })

  test('a wrapper the writer refuses says which check refused it', async () => {
    const s = await build()
    const before = await s.call('get_page', { pageId: (await s.home()).id, elements: 'none' })
    // two elements is the one thing a wrapper cannot be
    const r = await s.call('edit_structure', {
      pageId: before.pageId,
      version: before.version,
      ops: [{ op: 'wrap', target: 'row-wrap', html: '<div /><div />' }],
      elements: 'none',
    })
    expect(r.saved).toBe(false)
    expect(r.message).toContain('exactly one element')
  })
})

// 3G: a slot arrives holding the master's default content, and "put MY content
// in it" meant two reads and a hand-built `replace` of the whole slot element —
// which re-sends the slot's own classes and so edits the master by accident.
test.describe('replaceChildren', () => {
  test('fills an instance’s slot without touching the slot element', async () => {
    const s = await mcpSession()
    const made = await s.call('create_component', {
      name: 'Panel',
      html: '<section class="rounded border"><div data-ref="body" class="grid gap-2"><p>Default</p></div></section>',
    })
    const slotId = /<div data-id="([0-9a-f]+)" data-ref="body"/.exec(made.html)![1]
    await s.call('edit_elements', {
      componentId: made.componentId,
      edits: [{ id: slotId, slot: true }],
    })

    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<Panel data-ref="p1" />\n<Panel data-ref="p2" />'),
      version: home.version,
    })
    const page = await s.call('get_page', { pageId: home.id, elements: 'none' })
    const firstSlot = /<div data-id="([0-9a-f]+)" data-slot/.exec(page.html)![1]

    const r = await s.call('edit_structure', {
      pageId: home.id,
      version: page.version,
      ops: [
        {
          op: 'replaceChildren',
          target: firstSlot,
          html: '<h3 data-ref="t">Mine</h3><p data-ref="d">My copy.</p>',
        },
      ],
      elements: 'none',
    })
    expect(r.saved).toBe(true)
    expect(r.changed.created).toBe(2)
    expect(r.changed.removed).toBe(1) // the default <p>

    const after = await s.call('get_page', { pageId: home.id, elements: 'none' })
    // this instance holds its own content…
    expect(after.html).toContain('data-ref="t"')
    // …the slot element itself is untouched (same id, still a slot)
    expect(after.html).toContain(`<div data-id="${firstSlot}" data-slot`)
    // …and the OTHER instance still has the master's default
    const html = await s.html()
    expect(html).toContain('Mine')
    expect(html).toContain('Default')
    // the shared chrome is unchanged on both
    expect((html.match(/class="rounded border"/g) ?? []).length).toBe(2)
  })

  test('a leaf is refused, because its text is content', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<p data-ref="p">x</p>'),
      version: home.version,
    })
    const page = await s.call('get_page', { pageId: home.id, elements: 'none' })
    const r = await s.call('edit_structure', {
      pageId: home.id,
      version: page.version,
      ops: [{ op: 'replaceChildren', target: 'p', html: '<span>y</span>' }],
      elements: 'none',
    })
    expect(r.saved).toBe(false)
    expect(r.message).toContain('is a leaf')
  })
})
