import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'

// The reads that returned nothing, or everything.
//
// E18: `get_page {ref}` scoped the HTML correctly and answered `elements: []`,
// so the one read meant to be targeted returned the markup and none of the
// addresses. E19: `elementIds` given a `#ref` filtered the summary down to
// nothing, silently. E20: `edit_structure`'s `elements` is documented as "the
// ops said what changed" and returned every row on the page.

const PAGE = [
  '<header data-ref="top" class="flex"><span>logo</span></header>',
  '<section data-ref="hero" class="p-8">',
  '  <h1 data-ref="title">T</h1>',
  '  <Card data-ref="promo" />',
  '</section>',
  '<footer data-ref="foot"><span>f</span></footer>',
].join('\n')

async function built() {
  const s = await mcpSession()
  await s.seed(['card'])
  const home = await s.home()
  await s.call('set_page_html', { pageId: home.id, html: pageHtml(PAGE), version: home.version })
  return { s, pageId: home.id }
}

test.describe('a subtree read', () => {
  test('by ref returns the subtree’s rows, not an empty list', async () => {
    const { s, pageId } = await built()
    const r = await s.call('get_page', { pageId, ref: 'hero' })
    const rows = r.elements as { ref?: string; type: string }[]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].ref).toBe('hero')
    expect(rows.map((e) => e.ref)).toContain('title')
    // and only the subtree: the header and footer are not in it
    expect(rows.map((e) => e.ref)).not.toContain('top')
    expect(rows.map((e) => e.ref)).not.toContain('foot')
  })

  test('by ref and by id agree', async () => {
    const { s, pageId } = await built()
    const full = await s.call('get_page', { pageId, elements: 'own' })
    const heroId = (full.elements as { ref?: string; id: string }[]).find((e) => e.ref === 'hero')!
      .id
    const byRef = await s.call('get_page', { pageId, ref: 'hero', elements: 'own' })
    const byId = await s.call('get_page', { pageId, id: heroId, elements: 'own' })
    expect(byRef.elements).toEqual(byId.elements)
    expect(byRef.html).toBe(byId.html)
  })

  test('ref-parts on a subtree lists that subtree’s instances', async () => {
    const { s, pageId } = await built()
    const r = await s.call('get_page', { pageId, ref: 'hero', elements: 'ref-parts' })
    const rows = r.elements as { ref?: string; parts?: unknown[] }[]
    expect(rows.map((e) => e.ref)).toEqual(['promo'])
    expect(rows[0].parts?.length).toBeGreaterThan(0)
  })

  test('a subtree address that matches nothing is refused, not emptied', async () => {
    const { s, pageId } = await built()
    await expect(s.call('get_page', { pageId, ref: 'nope' })).rejects.toThrow(/nope/)
  })
})

test.describe('elementIds', () => {
  test('takes a #ref, a short data-id and a full id alike', async () => {
    const { s, pageId } = await built()
    const full = await s.call('get_page', { pageId, elements: 'own' })
    const titleId = (full.elements as { ref?: string; id: string }[]).find(
      (e) => e.ref === 'title',
    )!.id
    const shortTop = /<header data-id="([0-9a-f]+)"/.exec(full.html)![1]

    const r = await s.call('get_page', { pageId, elementIds: ['hero', shortTop, titleId] })
    const rows = r.elements as { ref?: string; id: string }[]
    expect(rows).toHaveLength(3)
    expect(rows.map((e) => e.ref).sort()).toEqual(['hero', 'title', 'top'])
    expect(r.unknownIds).toBeUndefined()
  })

  test('an address that matches nothing is reported', async () => {
    const { s, pageId } = await built()
    const r = await s.call('get_page', { pageId, elementIds: ['hero', 'ghost'] })
    expect((r.elements as unknown[]).length).toBe(1)
    expect(r.unknownIds).toEqual(['ghost'])
  })
})

test.describe('edit_structure’s element summary', () => {
  test('is scoped to what the ops touched, plus the refs', async () => {
    const { s, pageId } = await built()
    const before = await s.call('get_page', { pageId, elements: 'none' })
    const whole = ((await s.call('get_page', { pageId, elements: 'refs' })).elements as unknown[])
      .length

    const r = await s.call('edit_structure', {
      pageId,
      version: before.version,
      ops: [
        {
          op: 'insert',
          parent: 'hero',
          html: '<div data-ref="box" class="mt-4"><p data-ref="line">x</p></div>',
        },
      ],
    })
    expect(r.saved).toBe(true)
    const rows = r.elements as { ref?: string; type: string }[]
    // the inserted block, whole
    expect(rows.map((e) => e.ref)).toContain('box')
    expect(rows.map((e) => e.ref)).toContain('line')
    // the refs stay, because they are the addresses the next call needs
    expect(rows.map((e) => e.ref)).toContain('top')
    // but not every row on the page: the untouched <span>s are gone
    expect(rows.length).toBeLessThan(whole)
    expect(rows.some((e) => e.type === 'span' && !e.ref)).toBe(false)
  })

  test('"own" still means the whole page', async () => {
    const { s, pageId } = await built()
    const before = await s.call('get_page', { pageId, elements: 'none' })
    const r = await s.call('edit_structure', {
      pageId,
      version: before.version,
      ops: [{ op: 'insert', parent: 'hero', html: '<p data-ref="line">x</p>' }],
      elements: 'own',
    })
    const rows = r.elements as { type: string; ref?: string }[]
    expect(rows.some((e) => e.ref === 'foot')).toBe(true)
    expect(rows.some((e) => e.type === 'span' && !e.ref)).toBe(true)
  })
})

// E24: a `refused` entry beside a bare `saved: true` reads as a clean success.
// `saved` says the store was written; `partial` says not all of it landed.
test.describe('partial-write semantics', () => {
  test('set_page_html says partial when something was refused', async () => {
    const s = await mcpSession()
    await s.seed(['card'])
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<Card data-ref="promo" />'),
      version: home.version,
    })
    const page = await s.home()
    // a class on an instance wrapper renders nowhere, so the writer refuses it
    const r = await s.call('set_page_html', {
      pageId: page.id,
      html: pageHtml('<Card data-ref="promo" class="mt-8" />\n<p data-ref="after">x</p>'),
      version: page.version,
      elements: 'none',
    })
    expect(r.saved).toBe(true)
    expect(r.partial).toBe(true)
    expect(JSON.stringify(r.refused)).toContain('class')
    // the rest of the page DID land, which is why `saved` is true
    const after = await s.call('get_page', { pageId: page.id, elements: 'none' })
    expect(after.html).toContain('data-ref="after"')
  })

  test('a clean write says nothing about partial', async () => {
    const s = await mcpSession()
    const home = await s.home()
    const r = await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<p data-ref="p">x</p>'),
      version: home.version,
      elements: 'none',
    })
    expect(r.saved).toBe(true)
    expect(r.partial).toBeUndefined()
    expect(r.refused).toBeUndefined()
  })
})

// 3I: the HTML has always printed the 8-hex `data-id`, and every tool accepts
// it, but the element summaries printed full uuids — 36 bytes a row against 8,
// carried in every later turn of the session.
test.describe('ids print in the short form', () => {
  test('every row, and it is a working address', async () => {
    const { s, pageId } = await built()
    const page = await s.call('get_page', { pageId, elements: 'own' })
    const rows = page.elements as { id: string; ref?: string }[]
    for (const row of rows) expect(row.id).toHaveLength(8)

    // the printed id addresses the element everywhere an `id` is taken
    const hero = rows.find((e) => e.ref === 'hero')!
    expect((await s.call('get_page', { pageId, id: hero.id })).elements[0].ref).toBe('hero')
    const e = await s.call('edit_elements', {
      pageId,
      version: page.version,
      edits: [{ id: hero.id, addClasses: ['mt-8'] }],
    })
    expect(e.failed).toBe(0)
    // the echo is short too
    expect((e.bound ?? []).length + 0).toBeGreaterThanOrEqual(0)

    // and it matches the `data-id` in the HTML, which is the point
    expect(page.html).toContain(`data-id="${hero.id}"`)
  })

  test('a component’s node rows print short ids against its own tree', async () => {
    const s = await mcpSession()
    const made = await s.call('create_component', {
      name: 'Card',
      html: '<div class="p-4"><h3>T</h3><p>B</p></div>',
    })
    const rows = (await s.call('list_components', { includeNodes: true })).components[0]
      .nodes as { id: string; type: string }[]
    for (const row of rows) expect(row.id).toHaveLength(8)
    // and each resolves on the master
    const h3 = rows.find((r) => r.type === 'h3')!
    const r = await s.call('edit_elements', {
      componentId: made.componentId,
      edits: [{ id: h3.id, content: 'Title' }],
    })
    expect(r.failed).toBe(0)
    expect(r.saved).toBe(true)
  })
})

// 3I: `applied: ["insert"]` said that SOMETHING landed and nothing about what,
// so the next call was a confirming read.
test('a structural write says what it did, by name', async () => {
  const { s, pageId } = await built()
  const page = await s.call('get_page', { pageId, elements: 'none' })
  const r = await s.call('edit_structure', {
    pageId,
    version: page.version,
    ops: [
      { op: 'insert', parent: 'hero', html: '<div data-ref="box"><p data-ref="line">x</p></div>' },
      { op: 'wrap', target: 'box', html: '<div data-ref="shell" class="rounded" />' },
      { op: 'remove', target: 'line' },
    ],
    elements: 'none',
  })
  expect(r.saved).toBe(true)
  const applied = r.applied as string[]
  expect(applied[0]).toContain('inserted div#box under #hero')
  expect(applied[0]).toContain('2 new')
  expect(applied[1]).toContain('wrapped box in div#shell')
  expect(applied[2]).toContain('removed line')
})

// A SLOT's children are the page's own structure — the resolver leaves them
// unmapped and every writer treats them as ordinary page nodes. The collapsed
// read modes did not: both branches returned on the instance row, so anything
// inside a slot appeared in NO row, while the `html` half of the same response
// printed it in full. A ref'd instance in a Section's slot was editable by ref
// and undiscoverable, and a page whose body is one `<Shell><slot>…` came back
// as a single row for the whole page.
test.describe('a slot’s contents are page structure, so a read lists them', () => {
  async function shellWithCards(s: Awaited<ReturnType<typeof mcpSession>>) {
    await s.call('create_component', {
      name: 'FeatureCard',
      html: '<div class="card"><span>Title</span></div>',
    })
    await s.call('create_component', {
      name: 'Shell',
      html:
        '<div class="flex flex-col">\n  <header class="border-b"><span>Top</span></header>\n' +
        '  <main data-slot class="flex-1"><p>Default body</p></main>\n</div>',
    })
    const home = await s.home()
    const written = await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml(
        '<Shell data-ref="shell">\n  <slot>\n' +
          '    <h1 data-ref="title">Hello</h1>\n' +
          '    <FeatureCard data-ref="f-1"><div><span>One</span></div></FeatureCard>\n' +
          '    <FeatureCard data-ref="f-2"><div><span>Two</span></div></FeatureCard>\n' +
          '  </slot>\n</Shell>',
      ),
    })
    expect(written.refused ?? []).toEqual([])
    return home
  }

  test('"own" collapses the instance but keeps walking its slot', async () => {
    const s = await mcpSession()
    const home = await shellWithCards(s)
    const read = await s.call('get_page', { pageId: home.id, elements: 'own' })
    const refs = read.elements.map((e: { ref?: string }) => e.ref).filter(Boolean)
    // the Shell row is there, and so is everything the page put in its slot
    expect(refs).toContain('shell')
    expect(refs).toContain('title')
    expect(refs).toContain('f-1')
    expect(refs).toContain('f-2')
    // the Shell's OWN structure stays collapsed — the header is the component's
    expect(JSON.stringify(read.elements)).not.toContain('header')
  })

  test('"ref-parts" lists a ref’d instance inside a slot, with its parts', async () => {
    const s = await mcpSession()
    const home = await shellWithCards(s)
    const read = await s.call('get_page', { pageId: home.id, elements: 'ref-parts' })
    const byRef = new Map(
      read.elements.map((e: { ref?: string }) => [e.ref, e as { parts?: unknown[] }]),
    )
    expect([...byRef.keys()].sort()).toEqual(['f-1', 'f-2', 'shell'])
    // each card carries the parts an agent fills, so no second read is needed
    expect(byRef.get('f-1')!.parts!.length).toBeGreaterThan(0)
    // and the path really addresses it: the row's path is the child-index path
    const card = read.elements.find((e: { ref?: string }) => e.ref === 'f-1')
    expect(card.path.split('.').length).toBeGreaterThan(1)
  })

  test('an edit by ref reaches a card inside the slot', async () => {
    const s = await mcpSession()
    const home = await shellWithCards(s)
    const edit = await s.call('edit_elements', {
      pageId: home.id,
      version: (await s.home()).version,
      edits: [{ ref: 'f-2', part: 'span', content: 'Changed' }],
    })
    expect(edit.failed).toBe(0)
    expect(await s.html()).toContain('Changed')
  })
})
