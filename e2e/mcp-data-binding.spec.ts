import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'

// The silent data-binding no-ops from the Harbour run: a write the tools
// accepted, every renderer resolved to nothing, and `publish` said nothing
// about. Each one is now either a refusal at write time or a diagnostic the
// publish warnings carry.

test.describe('a filter that could never match', () => {
  test('equalsCurrent on a non-reference field is refused by name', async () => {
    const s = await mcpSession()
    const post = (await s.call('create_collection', { name: 'post' })).collection
    await s.call('update_collection', {
      collectionId: post.id,
      addFields: [{ name: 'owner', type: 'text' }],
    })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<collection-list data-ref="list" source="post"><p data-field="title" /></collection-list>'),
      version: home.version,
    })
    const page = await s.home()
    const r = await s.call('edit_elements', {
      pageId: page.id,
      version: page.version,
      edits: [{ ref: 'list', listQuery: { filter: { field: 'owner', equalsCurrent: true } } }],
    })
    const why = JSON.stringify(r.failures)
    expect(why).toContain('equalsCurrent')
    expect(why).toContain('reference field')
    expect(why).toContain('owner')
    // and nothing was stored
    expect(JSON.stringify(s.stored())).not.toContain('equalsCurrent')
  })

  test('equalsCurrent on a reference field still lands', async () => {
    const s = await mcpSession()
    const convo = (await s.call('create_collection', { name: 'convo' })).collection
    const msg = (await s.call('create_collection', { name: 'msg', detailRoutes: false })).collection
    await s.call('update_collection', {
      collectionId: msg.id,
      addFields: [{ name: 'convo', type: 'reference', refCollectionId: convo.id }],
    })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<collection-list data-ref="list" source="msg"><p data-field="title" /></collection-list>'),
      version: home.version,
    })
    const page = await s.home()
    const r = await s.call('edit_elements', {
      pageId: page.id,
      version: page.version,
      edits: [{ ref: 'list', listQuery: { filter: { field: 'convo', equalsCurrent: true } } }],
    })
    expect(r.failures ?? []).toEqual([])
  })
})

test.describe('a field binding that names nothing', () => {
  test('data-field outside the collection’s fields is a diagnostic, not a blank', async () => {
    const s = await mcpSession()
    const col = (await s.call('create_collection', { name: 'project' })).collection
    await s.call('upsert_entries', { collectionId: col.id, entries: [{ name: 'Alpha' }] })
    const home = await s.home()
    const w = await s.call('set_page_html', {
      pageId: home.id,
      // `project` has `title`; `headline` is not a field of it
      html: pageHtml(
        '<collection-list source="project"><h3 data-ref="h" data-field="headline" /></collection-list>',
      ),
      version: home.version,
    })
    expect(w.saved).toBe(true)
    expect(JSON.stringify(w.diagnostics)).toContain('headline')
    expect(JSON.stringify(w.diagnostics)).toContain('renders empty')
    // the real field is named in the message, so no second read is needed
    expect(JSON.stringify(w.diagnostics)).toContain('title')

    // and the publish warnings carry it, which is the last moment anyone looks
    expect(await s.kinds()).toContain('tree-diagnostics')
  })

  test('a bound attribute naming nothing in scope says so', async () => {
    const s = await mcpSession()
    const col = (await s.call('create_collection', { name: 'project' })).collection
    await s.call('update_collection', {
      collectionId: col.id,
      addFields: [{ name: 'shots', type: 'multi-image' }],
    })
    await s.call('upsert_entries', { collectionId: col.id, entries: [{ name: 'Alpha' }] })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(
        [
          '<collection-list source="project">',
          // inside a multi-image list the scope is the IMAGE, not the entry —
          // so `title` is not reachable here even though the collection has it
          '  <collection-list source="shots">',
          '    <img data-ref="shot" data-field="shots" />',
          '  </collection-list>',
          '</collection-list>',
        ].join('\n'),
      ),
      version: home.version,
    })
    const page = await s.home()
    const r = await s.call('edit_elements', {
      pageId: page.id,
      version: page.version,
      edits: [{ ref: 'shot', fieldAttrs: { alt: 'title' } }],
    })
    expect(r.saved).toBe(true)
    const diag = JSON.stringify(await s.call('get_page', { pageId: page.id, elements: 'none' }))
    expect(diag).toContain("'alt' attribute is bound to 'title'")
  })

  test('a correct binding raises nothing', async () => {
    const s = await mcpSession()
    const col = (await s.call('create_collection', { name: 'project' })).collection
    await s.call('upsert_entries', { collectionId: col.id, entries: [{ name: 'Alpha' }] })
    const home = await s.home()
    const w = await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(
        '<collection-list source="project"><h3 data-ref="h" data-field="title" /></collection-list>',
      ),
      version: home.version,
    })
    expect(w.diagnostics).toEqual([])
    expect(await s.kinds()).not.toContain('tree-diagnostics')
    expect(col.id).toBeTruthy()
  })
})

test.describe('form warnings', () => {
  test('a hidden control is not counted as a nameless one', async () => {
    const s = await mcpSession()
    const field = await s.call('create_component', {
      name: 'Field',
      html:
        '<div class="grid gap-1"><label class="text-sm"><span>Label</span></label>' +
        '<input class="border px-2" name="email" /><textarea class="border px-2" /></div>',
    })
    const textarea = /<textarea data-id="([0-9a-f]+)"/.exec(field.html)![1]
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<form data-ref="f" class="grid gap-3"><Field data-ref="one" /></form>'),
      version: home.version,
    })
    const page = await s.home()
    // this placement hides the optional textarea
    const hide = await s.call('edit_elements', {
      pageId: page.id,
      version: page.version,
      edits: [{ ref: 'one', part: 'textarea', hidden: true }],
    })
    expect(hide.failed).toBe(0)
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'f', form: { enabled: true } }],
    })

    const warnings = (await s.call('publish', {})).warnings ?? []
    const forms = warnings.find((w: { kind: string }) => w.kind === 'form-setup')
    expect(JSON.stringify(forms?.issues ?? [])).not.toContain('no usable name')
    // the hidden control's name is not in the exported HTML either
    expect(await s.html()).not.toContain('<textarea')
    expect(textarea).toHaveLength(8)
  })

  test('a password field is flagged — submissions are stored as plain text', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(
        '<form data-ref="f" class="grid gap-3">' +
          '<input class="border" name="email" type="email" />' +
          '<input class="border" name="passphrase" type="password" />' +
          '</form>',
      ),
      version: home.version,
    })
    const page = await s.home()
    await s.call('edit_elements', {
      pageId: page.id,
      version: page.version,
      edits: [{ ref: 'f', form: { enabled: true } }],
    })
    const warnings = (await s.call('publish', {})).warnings ?? []
    const forms = warnings.find((w: { kind: string }) => w.kind === 'form-setup')
    expect(JSON.stringify(forms?.issues ?? [])).toContain('passphrase')
    expect(JSON.stringify(forms?.issues ?? [])).toContain('plain text')
  })
})

// E7: valid Tailwind v4 variants the class validator refused, so the editor
// stood between an author (or an agent) and working CSS — and the hint then
// suggested a different BASE class, which cannot help when the PREFIX is what
// was rejected.
test.describe('class variants', () => {
  test('a named max-width variant is accepted, stacked or alone', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<div data-ref="box" class="flex"><span>x</span></div>'),
      version: home.version,
    })
    const page = await s.home()
    const r = await s.call('edit_elements', {
      pageId: page.id,
      version: page.version,
      edits: [
        {
          ref: 'box',
          addClasses: [
            'max-sm:hidden',
            'max-md:flex-col',
            'min-lg:gap-8',
            'max-sm:[&>span]:sr-only',
            'open:rotate-180',
            'aria-expanded:bg-black',
            '*:p-2',
          ],
        },
      ],
    })
    expect(r.failures ?? []).toEqual([])
    const html = await s.html()
    expect(html).toContain('max-sm:hidden')
    // `&` and `>` are escaped in the attribute, as they must be
    expect(html).toContain('max-sm:[&amp;&gt;span]:sr-only')
    expect(html).toContain('*:p-2')
    // and they reach the stylesheet, which is the point
    const css = await s.css()
    expect(css).toContain('max-width')
  })

  test('an unknown variant is refused by naming the VARIANT', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<div data-ref="box" class="flex" />'),
      version: home.version,
    })
    const page = await s.home()
    const r = await s.call('edit_elements', {
      pageId: page.id,
      version: page.version,
      edits: [{ ref: 'box', addClasses: ['nope:overflow-hidden'] }],
    })
    const why = JSON.stringify(r.failures)
    expect(why).toContain('not a known variant')
    expect(why).toContain('max-[767px]')
    // never a base-class suggestion, which would carry the same broken prefix
    expect(why).not.toContain('did you mean')
  })
})

// E40: an entry carries `name` and `slug` as its OWN properties — both are
// top-level keys of an upsert_entries item, and the entry's route is built from
// its slug — so a FIELD by either name is a second value with the same name,
// and every route and `@item` link uses the other one.
test.describe('reserved field names', () => {
  test('`name` and `slug` are refused, with the reason', async () => {
    const s = await mcpSession()
    const col = (await s.call('create_collection', { name: 'post' })).collection
    const r = await s.call('update_collection', {
      collectionId: col.id,
      addFields: [{ name: 'slug', type: 'text' }, { name: 'name', type: 'text' }],
    })
    // `update_collection` applies field by field, so the refusal is `partial`
    // with the reason, not a failed call
    expect(r.partial).toBe(true)
    expect(JSON.stringify(r.errors)).toContain('slug')
    expect(JSON.stringify(r.errors)).toContain("entry's OWN property")
    // and nothing landed
    const after = await s.call('get_collection', { collectionId: col.id })
    expect((after.fields as { name: string }[]).map((f) => f.name)).toEqual(['title'])
  })

  test('every other name is fine, `status` included', async () => {
    const s = await mcpSession()
    const col = (await s.call('create_collection', { name: 'post' })).collection
    const r = await s.call('update_collection', {
      collectionId: col.id,
      addFields: [
        // a status field is what a `data-[status=…]:` class matches on — the
        // reservation must not reach it
        { name: 'status', type: 'select', options: ['draft', 'live'] },
        { name: 'slug-override', type: 'text' },
        { name: 'display-name', type: 'text' },
      ],
    })
    expect(r.errors).toBeUndefined()
    expect(r.partial).toBeUndefined()
  })
})
