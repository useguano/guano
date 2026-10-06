import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'

// The agent format: a page read and written as HTML.
//
// Assertions land on the EXPORTED HTML wherever they can. A tool reporting
// success for a write that renders nowhere is the bug class this format exists
// to remove, so "the response said saved" is never the whole check.
//
// `npm run check:html` holds the LAYER to its round-trip properties over the
// whole corpus (52 pages, 75 component masters). This spec holds the TOOLS to
// the contract an agent actually sees: what adopts, what is refused by name,
// and what a stale version does.

test.describe('reading and writing a page as HTML', () => {
  test('one write carries structure, classes and text, and it publishes', async () => {
    const s = await mcpSession()
    const home = await s.home()
    const r = await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml(
        [
          '<section data-ref="hero" class="px-6 py-24 text-center">',
          '  <h1 class="text-4xl font-bold">Ship faster</h1>',
          '  <p>Everything you need.</p>',
          '  <a href="/pricing" class="underline"><span>See pricing</span></a>',
          '</section>',
        ].join('\n'),
      ),
    })
    expect(r.saved).toBe(true)
    expect(r.applied.created).toBe(5)
    expect(r.refused).toBeUndefined()

    // the DSL needed a structure write and then a second round of element
    // edits for the classes and the text; this is the whole page in one call
    const html = await s.html()
    expect(html).toContain('class="px-6 py-24 text-center"')
    expect(html).toContain('Ship faster')
    expect(html).toContain('href="/pricing"')
  })

  test('a read written straight back changes nothing', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml('<section data-ref="a" class="p-4"><h2>Title</h2></section>'),
    })
    // give an element state the HTML does NOT carry, which is exactly what a
    // write has to preserve
    let page = await s.call('get_page', { pageId: home.id, elements: 'refs' })
    const { created } = await s.call('create_interactions', {
      items: [{ name: 'Show', toClasses: 'flex' }],
    })
    await s.call('edit_elements', {
      pageId: home.id,
      version: page.version,
      edits: [{ ref: 'a', bindInteractions: [{ interactionId: created[0].id, trigger: 'hover' }] }],
    })

    page = await s.call('get_page', { pageId: home.id })
    const before = page.html
    const r = await s.call('set_page_html', {
      pageId: home.id,
      version: page.version,
      html: page.html,
    })
    expect(r.applied).toEqual({ kept: 2, created: 0, removed: 0 })
    const after = await s.call('get_page', { pageId: home.id, includeInteractions: true })
    expect(after.html).toBe(before)
    expect(after.elements.find((e: { ref?: string }) => e.ref === 'a').interactions).toHaveLength(1)
  })

  test('identity is carried by data-id, then by data-ref, then by the tree', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml('<h2>A</h2>\n<h3>B</h3>\n<h4>C</h4>'),
    })
    let page = await s.call('get_page', { pageId: home.id })
    const ids = page.elements.filter((e: { type: string }) => e.type !== 'body').map((e: { id: string }) => e.id)

    // by data-id: reordered, and every element is the same element
    const lines = page.html.split('\n')
    const reordered = [lines[0], lines[3], lines[1], lines[2], lines[4]].join('\n')
    let r = await s.call('set_page_html', { pageId: home.id, version: page.version, html: reordered })
    expect(r.applied).toEqual({ kept: 3, created: 0, removed: 0 })
    page = await s.call('get_page', { pageId: home.id })
    expect(page.elements.filter((e: { type: string }) => e.type !== 'body').map((e: { id: string }) => e.id).sort()).toEqual(
      [...ids].sort(),
    )

    // by the TREE: no ids at all, and an element inserted in the middle
    r = await s.call('set_page_html', {
      pageId: home.id,
      version: page.version,
      html: pageHtml('<h4>C</h4>\n<p>new</p>\n<h2>A</h2>\n<h3>B</h3>'),
    })
    expect(r.applied.created).toBe(1)
    expect(r.applied.removed).toBe(0)

    // by data-ref: the strongest address an author writes themselves
    page = await s.call('get_page', { pageId: home.id })
    await s.call('set_page_html', {
      pageId: home.id,
      version: page.version,
      html: pageHtml('<section data-ref="box"><h2>A</h2></section>'),
    })
    page = await s.call('get_page', { pageId: home.id, elements: 'refs' })
    const boxId = page.elements.find((e: { ref?: string }) => e.ref === 'box').id
    await s.call('set_page_html', {
      pageId: home.id,
      version: page.version,
      html: pageHtml('<div data-ref="wrap"><section data-ref="box"><h2>A</h2></section></div>'),
    })
    page = await s.call('get_page', { pageId: home.id, elements: 'refs' })
    expect(page.elements.find((e: { ref?: string }) => e.ref === 'box').id).toBe(boxId)
  })

  test('a page of filled-in components is one write', async () => {
    const s = await mcpSession()
    await s.seed(['card'])
    const home = await s.home()
    // self-closed: each instance arrives as the component defines it
    await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml('<Card data-ref="one" />\n<Card data-ref="two" />\n<Card data-ref="three" />'),
    })
    let page = await s.call('get_page', { pageId: home.id })
    expect((page.html.match(/<Card /g) ?? []).length).toBe(3)

    // written out: the parts take their text, and ONE call fills the page
    const filled = page.html.replace(/<h3([^>]*)\/>/g, '<h3$1>Starter</h3>')
    const r = await s.call('set_page_html', { pageId: home.id, version: page.version, html: filled })
    expect(r.saved).toBe(true)
    expect(r.refused).toBeUndefined()

    const html = await s.html()
    expect((html.match(/Starter/g) ?? []).length).toBe(3)

    // and each instance keeps its OWN text
    page = await s.call('get_page', { pageId: home.id })
    const one = page.html
    await s.call('set_page_html', {
      pageId: home.id,
      version: page.version,
      html: one.replace('Starter', 'Pro'),
    })
    const after = await s.html()
    expect((after.match(/Pro/g) ?? []).length).toBe(1)
    expect((after.match(/Starter/g) ?? []).length).toBe(2)
  })

  test('a class inside an instance is refused by name, not dropped', async () => {
    const s = await mcpSession()
    await s.seed(['card'])
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml('<Card data-ref="one" />'),
    })
    const page = await s.call('get_page', { pageId: home.id })
    const r = await s.call('set_page_html', {
      pageId: home.id,
      version: page.version,
      html: page.html.replace('<h3', '<h3 class="text-2xl"'),
    })
    // a mapped element wears the component's look, so a class here would
    // render nowhere — said out loud, with the tool that can do it
    expect(r.refused[0].message).toContain('renders nowhere')
    expect(r.refused[0].path).toContain('Card')
    expect(await s.html()).not.toContain('text-2xl')
  })

  test('a part count that does not match the component is refused', async () => {
    const s = await mcpSession()
    await s.seed(['card'])
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml('<Card data-ref="one" />'),
    })
    const page = await s.call('get_page', { pageId: home.id })
    const r = await s.call('set_page_html', {
      pageId: home.id,
      version: page.version,
      html: page.html.replace('</Card>', '  <p>extra</p>\n</Card>'),
    })
    expect(JSON.stringify(r.refused)).toContain('update_component')
    expect(await s.html()).not.toContain('extra')
  })

  test('script, a handler and a bad tag are refused with line:col, saving nothing', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml('<h2>Keep me</h2>'),
    })
    const page = await s.call('get_page', { pageId: home.id })

    const cases: [string, RegExp, number][] = [
      ['<section>\n  <script>alert(1)</script>\n</section>', /never allowed/, 2],
      ['<section>\n  <div onclick="x()" />\n</section>', /event handlers/, 2],
      ['<section>\n  <blink />\n</section>', /unknown element/, 2],
      ['<section>\n  <span />\n', /never closed/, 1],
      ['<section>\n  <div class=a />\n</section>', /must be quoted/, 2],
      ['<section>\n  loose text\n</section>', /container/, 2],
    ]
    for (const [html, re, line] of cases) {
      const r = await s.call('set_page_html', { pageId: home.id, version: page.version, html })
      expect(r.saved, html).toBe(false)
      expect(r.reason).toBe('invalid-html')
      expect(r.diagnostics[0].message).toMatch(re)
      expect(r.diagnostics[0].line).toBe(line)
      expect(r.diagnostics[0].col).toBeGreaterThan(0)
    }
    // a failed write is always safe to retry: nothing moved
    expect((await s.call('get_page', { pageId: home.id })).html).toBe(page.html)
    expect(await s.html()).toContain('Keep me')
  })

  test('a stale version is rejected with the current one', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml('<h2>One</h2>'),
    })
    const r = await s.call('set_page_html', {
      pageId: home.id,
      version: home.version, // the write above advanced it
      html: pageHtml('<h2>Two</h2>'),
    })
    expect(r.saved).toBe(false)
    expect(r.reason).toBe('stale-version')
    expect(r.currentVersion).toBeTruthy()
    expect(await s.html()).toContain('One')

    // and the version it hands back works
    const ok = await s.call('set_page_html', {
      pageId: home.id,
      version: r.currentVersion,
      html: pageHtml('<h2>Two</h2>'),
    })
    expect(ok.saved).toBe(true)
  })

  test('a node-only edit does not advance the version', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml('<h2 data-ref="t">One</h2>'),
    })
    const page = await s.call('get_page', { pageId: home.id })
    const { created } = await s.call('create_interactions', {
      items: [{ name: 'Show', toClasses: 'flex' }],
    })
    // an interaction is not in the HTML, so it cannot make a pending structure
    // write unsafe — the version is a hash of what get_page SHOWS
    await s.call('edit_elements', {
      pageId: home.id,
      version: page.version,
      edits: [{ ref: 't', bindInteractions: [{ interactionId: created[0].id, trigger: 'hover' }] }],
    })
    expect((await s.call('get_page', { pageId: home.id })).version).toBe(page.version)
  })

  test('edit_structure changes part of a page, and a bad op refuses the batch', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml('<section data-ref="hero"><h1>Hi</h1></section>'),
    })
    let page = await s.call('get_page', { pageId: home.id })
    let r = await s.call('edit_structure', {
      pageId: home.id,
      version: page.version,
      ops: [
        { op: 'insert', html: '<footer data-ref="foot"><p>Footer</p></footer>', after: 'hero' },
        { op: 'wrap', targets: ['hero', 'foot'], html: '<main class="mx-auto max-w-5xl" />' },
      ],
    })
    expect(r.saved).toBe(true)
    let html = await s.html()
    expect(html).toContain('max-w-5xl')
    expect(html).toContain('Footer')

    // one op that cannot land refuses the WHOLE batch — a page is never left
    // half-edited, which is what made a line-addressed batch dangerous
    page = await s.call('get_page', { pageId: home.id })
    const before = page.html
    r = await s.call('edit_structure', {
      pageId: home.id,
      version: page.version,
      ops: [
        { op: 'insert', html: '<p>fine</p>', parent: 'hero' },
        { op: 'remove', target: 'does-not-exist' },
      ],
    })
    expect(r.saved).toBe(false)
    expect(r.message).toContain('does-not-exist')
    expect((await s.call('get_page', { pageId: home.id })).html).toBe(before)

    // a remove takes the subtree with it
    r = await s.call('edit_structure', {
      pageId: home.id,
      version: page.version,
      ops: [{ op: 'remove', target: 'foot' }],
    })
    expect(r.changed.removed).toBe(2)
    expect(await s.html()).not.toContain('Footer')
  })

  test('edit_structure on a component master reaches every instance', async () => {
    const s = await mcpSession()
    const made = await s.call('create_component', {
      name: 'Tile',
      html: '<div class="rounded-xl border p-4"><h3>Title</h3></div>',
    })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml('<Tile data-ref="a" />\n<Tile data-ref="b" />'),
    })
    const comp = (await s.call('list_components', {})).components[0]
    const r = await s.call('edit_structure', {
      componentId: made.componentId,
      version: comp.version,
      ops: [{ op: 'insert', html: '<p class="text-sm">Sub</p>', parent: made.componentId }],
    })
    expect(r.saved).toBe(true)
    expect(r.pages).toHaveLength(1)
    // the published page is the check: both instances grew it, styled once
    const html = await s.html()
    expect((html.match(/Sub/g) ?? []).length).toBe(2)
    expect((html.match(/text-sm/g) ?? []).length).toBe(2)
  })

  test('a big page is read in parts', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml(
        '<section data-ref="hero" class="p-6"><h1>Hi</h1></section>\n<footer data-ref="foot"><p>Bye</p></footer>',
      ),
    })
    const subtree = await s.call('get_page', { pageId: home.id, ref: 'hero' })
    expect(subtree.html).toMatch(/^<section /)
    expect(subtree.html).not.toContain('footer')

    const shape = await s.call('get_page', { pageId: home.id, mode: 'structure' })
    expect(shape.html).not.toContain('class=')
    expect(shape.html).not.toContain('Hi')
    expect(shape.html).toContain('<section')

    const rows = await s.call('get_page', { pageId: home.id, elements: 'refs', summaryOnly: true })
    expect(rows.html).toBeUndefined()
    // rows carry a path, never a line: a position is invalidated by the edit
    // before it, which is how the line arithmetic this replaces went wrong
    expect(rows.elements.every((e: { path?: string; line?: number }) => typeof e.path === 'string' && e.line === undefined)).toBe(true)

    const missing = await s.call('get_page', { pageId: home.id, ref: 'nope' }).catch((e: Error) => e)
    expect(String(missing)).toContain('nope')
  })
})
