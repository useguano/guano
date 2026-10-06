import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'

// The tool CONTRACTS an agent depends on, driven in-process. Every case here
// comes from something that cost the Cocoapp session real calls: a response too
// big to read, a key that is absent when it should be an empty array, a whole
// list resent to add one item, a batch form that exists for one tool and not
// its twin.

test.describe('get_guide', () => {
  test('a bare call returns the rules and the map, not the whole handbook', async () => {
    const s = await mcpSession()
    const bare = await s.call('get_guide')
    // the first call of the Cocoapp session came back "exceeds maximum allowed
    // tokens" and cost four more calls to recover before any work started
    expect(JSON.stringify(bare).length).toBeLessThan(12_000)
    expect(bare.goldenRules).toContain('## The golden rules')
    expect(bare.sections.length).toBeGreaterThan(10)
    expect(bare.next).toContain('get_guide')
  })

  test('the whole handbook is still reachable, and one section stays one section', async () => {
    const s = await mcpSession()
    const all = await s.call('get_guide', { section: 'all' })
    expect(all.guide).toContain('<!-- guano handbook')
    expect(all.guide.length).toBeGreaterThan(50_000)

    const one = await s.call('get_guide', { section: 'animations' })
    expect(one.guide).toContain('## Animations')
    expect(one.guide.length).toBeLessThan(all.guide.length / 4)

    // asking for the toc explicitly gets the map alone
    const toc = await s.call('get_guide', { section: 'toc' })
    expect('goldenRules' in toc).toBe(false)
  })

  test('the described size is computed, not a stale number in prose', async () => {
    const s = await mcpSession()
    const claimed = Number(/(\d+) KB/.exec(s.tool('get_guide').description)![1])
    const actual = Math.round((await s.call('get_guide', { section: 'all' })).guide.length / 1024)
    expect(Math.abs(claimed - actual)).toBeLessThanOrEqual(1)
  })
})

test.describe('get_page', () => {
  test('diagnostics is always present, so "clean" and "not checked" differ', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<h1 />'),
      version: home.version,
    })
    const page = await s.call('get_page', { pageId: home.id, elements: 'none' })
    // the key used to be omitted when empty, so a validated page and an
    // unvalidated one read identically
    expect(page.diagnostics).toEqual([])
  })
})

test.describe('component node rows', () => {
  test('list_components keeps the full binding view the other rows summarize', async () => {
    const s = await mcpSession()
    await s.seed(['sheet'])
    const listed = await s.call('list_components', { names: ['Sheet'], includeNodes: true })
    const bound = listed.components[0].nodes.filter((n: { interactions?: unknown[] }) => n.interactions?.length)
    expect(bound.length).toBeGreaterThan(0)
    expect(bound[0].interactions[0]).toHaveProperty('bindingId')
    expect(bound[0].interactions[0]).toHaveProperty('trigger')
  })
})

test.describe('design tokens', () => {
  test('addTokens adds without resending the whole palette', async () => {
    const s = await mcpSession()
    await s.call('update_settings', {
      tokens: [
        { name: 'brand', value: '#0D594A' },
        { name: 'cream', value: '#FFEDA6' },
      ],
    })
    // the session resent all 27 tokens to add two, because `tokens` replaces
    const r = await s.call('update_settings', { addTokens: [{ name: 'ink', value: '#111111' }] })
    expect(r.saved).toBe(true)
    expect(r.tokensChanged).toEqual({ added: ['ink'] })
    expect(r.tokens.map((t: { name: string }) => t.name).sort()).toEqual(['brand', 'cream', 'ink'])
  })

  test('addTokens re-values an existing token and keeps its id', async () => {
    const s = await mcpSession()
    await s.call('update_settings', { tokens: [{ name: 'brand', value: '#000000' }] })
    const before = s.stored().settings.tokens[0].id
    await s.call('update_settings', { addTokens: [{ name: 'brand', value: '#0D594A' }] })
    const after = s.stored().settings.tokens
    expect(after).toHaveLength(1)
    expect(after[0].value).toBe('#0D594A')
    expect(after[0].id).toBe(before) // same id, so merges stay quiet
  })

  test('removing a token that still styles something is refused, and says where', async () => {
    const s = await mcpSession()
    await s.call('update_settings', { tokens: [{ name: 'brand', value: '#0D594A' }] })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<h1 data-ref="title" />'),
      version: home.version,
    })
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'title', addClasses: ['bg-brand'] }],
    })

    const refused = await s.call('update_settings', { removeTokens: ['brand'] })
    expect(refused.saved).toBe(false)
    expect(refused.reason).toBe('tokens-in-use')
    expect(refused.inUse[0].token).toBe('brand')
    expect(refused.inUse[0].where).toContain('page')
    expect(s.stored().settings.tokens).toHaveLength(1) // nothing written

    const forced = await s.call('update_settings', { removeTokens: ['brand'], forcePurge: true })
    expect(forced.saved).toBe(true)
    expect(forced.tokens).toHaveLength(0)
  })

  test('an unused token is removed without ceremony', async () => {
    const s = await mcpSession()
    await s.call('update_settings', {
      tokens: [
        { name: 'brand', value: '#0D594A' },
        { name: 'unused', value: '#FFFFFF' },
      ],
    })
    const r = await s.call('update_settings', { removeTokens: ['unused'] })
    expect(r.saved).toBe(true)
    expect(r.tokensChanged).toEqual({ added: [], removed: ['unused'] })
    expect(r.tokens.map((t: { name: string }) => t.name)).toEqual(['brand'])
  })
})

test.describe('create_interactions', () => {
  test('a batch is one write, and reports each item', async () => {
    const s = await mcpSession()
    // a sliding sheet needs two effects and a tab strip four; the session made
    // eight one call at a time because only the animation side had a batch form
    const r = await s.call('create_interactions', {
      items: [
        { name: 'Sheet · open', toClasses: 'visible opacity-100' },
        { name: 'Sheet · slide in', toClasses: 'translate-x-0 translate-y-0' },
        { name: 'Tab · active', toClasses: 'bg-white', duration: 'duration-200' },
      ],
    })
    expect(r.saved).toBe(true)
    expect(r.created).toHaveLength(3)
    expect(r.failures).toBeUndefined()
    expect(s.stored().interactions).toHaveLength(3)
    expect(r.created[2].duration).toBe('duration-200')
    expect(r.created[0].duration).toBe('duration-300') // the default still applies
  })

  test('one bad item fails on its own and the rest are saved', async () => {
    const s = await mcpSession()
    const r = await s.call('create_interactions', {
      items: [
        { name: 'Good', toClasses: 'flex' },
        { name: 'Bad', toClasses: 'not-a-real-class' },
        { name: '', toClasses: 'flex' },
      ],
    })
    expect(r.saved).toBe(true)
    expect(r.created.map((i: { name: string }) => i.name)).toEqual(['Good'])
    expect(r.failures).toHaveLength(2)
    expect(r.failures[0].errors[0]).toContain('not-a-real-class')
    expect(r.failures[1].errors[0]).toContain('name')
    expect(s.stored().interactions).toHaveLength(1)
  })
})

test.describe('extracting a component', () => {
  test('create_component takes a ref, and reports the master’s nodes', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<div data-ref="card">\n  <h3 />\n  <p />\n</div>'),
      version: home.version,
    })
    const after = await s.home()
    // the usual way to build a big component is to write it on a page with refs
    // and style it by ref — and then an id had to be fetched with a get_page
    // whose only purpose was this call
    const made = await s.call('create_component', {
      pageId: after.id,
      ref: 'card',
      name: 'Card',
      version: after.version,
    })
    expect(made.saved).toBe(true)
    expect(made.name).toBe('Card')
    // the addresses to style it with, which only the `code` path used to return
    // the extracted element stays inside the master, under the :Card root
    expect(made.nodes.map((n: { type: string }) => n.type)).toEqual(['Card', 'div', 'h3', 'paragraph'])
    expect(made.nodes[0].root).toBe(true)
    // the page keeps its own nodes, now wrapped in the instance, and the
    // instance took the extracted block's ref
    const page = await s.call('get_page', { pageId: after.id })
    expect(page.html).toMatch(/<Card [^>]*data-ref="card">/)
    expect(page.html).toContain('<h3 ')
  })

  test('an unknown ref is refused by name, not by throwing', async () => {
    const s = await mcpSession()
    const home = await s.home()
    const r = await s.call('create_component', {
      pageId: home.id,
      ref: 'nope',
      name: 'Card',
      version: home.version,
    })
    expect(r.saved).toBe(false)
    expect(r.reason).toBe('no-such-ref')
    expect(r.message).toContain('#nope')
  })

  test('create_components resolves each item’s ref as the batch rewrites the page', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<header data-ref="top">\n  <h1 />\n</header>\n<footer data-ref="bottom">\n  <span />\n</footer>'),
      version: home.version,
    })
    const after = await s.home()
    const r = await s.call('create_components', {
      items: [
        { pageId: after.id, ref: 'top', name: 'SiteHeader' },
        { pageId: after.id, ref: 'bottom', name: 'SiteFooter' },
      ],
      versions: [{ pageId: after.id, version: after.version }],
    })
    expect(r.saved).toBe(true)
    expect(r.created).toBe(2)
    const page = await s.call('get_page', { pageId: after.id })
    expect(page.html).toMatch(/<SiteHeader [^>]*data-ref="top">/)
    expect(page.html).toMatch(/<SiteFooter [^>]*data-ref="bottom">/)
  })
})

test.describe('reference fields', () => {
  /** two collections, the second referring to the first */
  async function graph() {
    const s = await mcpSession()
    const author = (await s.call('create_collection', { name: 'author', detailRoutes: false }))
      .collection
    const post = (await s.call('create_collection', { name: 'post', detailRoutes: false })).collection
    await s.call('update_collection', {
      collectionId: post.id,
      addFields: [{ name: 'writer', type: 'reference', refCollectionId: author.id }],
    })
    await s.call('upsert_entries', {
      collectionId: author.id,
      entries: [{ name: 'Ada Lovelace' }],
    })
    return { s, author, post }
  }

  test('a reference takes a slug, so seeding needs no uuid transcription', async () => {
    const { s, author: authorCol, post } = await graph()
    const author = s.stored().collections.find((c: { name: string }) => c.name === 'author')
      .entries[0]
    // entry ids only come back in a response, so the session transcribed 35
    // uuids by hand between calls
    const r = await s.call('upsert_entries', {
      collectionId: post.id,
      entries: [{ name: 'First post', values: { writer: author.slug } }],
    })
    expect(r.saved).toBe(true)
    const written = s.stored().collections.find((c: { name: string }) => c.name === 'post')
      .entries[0]
    expect(written.values.writer).toBe(author.id) // stored as the id, as always
  })

  test('an id still works, and a value matching nothing is refused', async () => {
    const { s, author: authorCol, post } = await graph()
    const author = s.stored().collections.find((c: { name: string }) => c.name === 'author')
      .entries[0]
    const byId = await s.call('upsert_entries', {
      collectionId: post.id,
      entries: [{ name: 'By id', values: { writer: author.id } }],
    })
    expect(byId.saved).toBe(true)

    // stored as-is before this: the field read back fine and rendered nothing
    const bad = await s.call('upsert_entries', {
      collectionId: post.id,
      entries: [{ name: 'Bad', values: { writer: 'nobody' } }],
    })
    expect(bad.saved).toBe(false)
    expect(JSON.stringify(bad)).toContain('nobody')
    expect(JSON.stringify(bad)).toContain('slug')
    // and the half-made entry is rolled back
    const posts = s.stored().collections.find((c: { name: string }) => c.name === 'post').entries
    expect(posts.map((e: { name: string }) => e.name)).toEqual(['By id'])
  })

  test('a multi-reference resolves each value, by slug or id', async () => {
    const { s, author: authorCol, post } = await graph()
    await s.call('upsert_entries', {
      collectionId: authorCol.id,
      entries: [{ name: 'Grace Hopper' }],
    })
    const authors = s.stored().collections.find((c: { name: string }) => c.name === 'author')
      .entries
    await s.call('update_collection', {
      collectionId: post.id,
      addFields: [
        { name: 'contributors', type: 'multi-reference', refCollectionId: authorCol.id },
      ],
    })
    const r = await s.call('upsert_entries', {
      collectionId: post.id,
      entries: [{ name: 'Joint', values: { contributors: [authors[0].slug, authors[1].id] } }],
    })
    expect(r.saved).toBe(true)
    const written = s.stored().collections.find((c: { name: string }) => c.name === 'post')
      .entries[0]
    expect(written.values.contributors).toEqual([authors[0].id, authors[1].id])
  })
})

test.describe('list_icons', () => {
  test('a list of names is validated in one call, with a suggestion per miss', async () => {
    const s = await mcpSession()
    // the session guessed every icon name and searched once for one of them;
    // a guess that is wrong is only found by check:catalog or by looking
    const r = await s.call('list_icons', {
      names: ['mail', 'users', 'not-an-icon', 'arrow-right-circle'],
    })
    expect(r.known).toEqual(['mail', 'users'])
    expect(r.unknown.map((u: { name: string }) => u.name)).toEqual([
      'not-an-icon',
      'arrow-right-circle',
    ])
    // v4 renamed this one; the suggestion is one step from the fix
    expect(r.unknown[1].didYouMean).toContain('circle-arrow-right')
  })

  test('searching still works, and asking for neither is an error', async () => {
    const s = await mcpSession()
    const hits = await s.call('list_icons', { query: 'chevron' })
    expect(hits.icons.length).toBeGreaterThan(3)
    expect(hits.icons.every((n: string) => n.includes('chevron'))).toBe(true)
    await expect(s.call('list_icons', {})).rejects.toThrow(/query|names/)
  })
})

test.describe('breakpoints', () => {
  test('they can be set, and come back widest first', async () => {
    const s = await mcpSession()
    // nothing could edit these from MCP: an agent could scope a binding to a
    // breakpoint but never add the breakpoint it wanted
    const r = await s.call('update_settings', {
      breakpoints: [
        { name: 'Mobile', width: 390 },
        { name: 'Desktop', width: 1440 },
        { name: 'Tablet', width: 768 },
      ],
    })
    expect(r.saved).toBe(true)
    expect(r.breakpoints.map((b: { name: string }) => b.name)).toEqual([
      'Desktop',
      'Tablet',
      'Mobile',
    ])
    // the widest is the base for the cascade, perView and binding scopes
    expect(r.breakpoints[0].width).toBe(1440)
    expect(s.stored().breakpoints[0].height).toBe(900) // defaulted
  })

  test('two breakpoints cannot share a width', async () => {
    const s = await mcpSession()
    const r = await s.call('update_settings', {
      breakpoints: [
        { name: 'A', width: 768 },
        { name: 'B', width: 768 },
      ],
    })
    expect(r.saved).toBe(false)
    expect(r.reason).toBe('duplicate-breakpoint-width')
  })

  test('keeping an id keeps the breakpoint, and dropping one a slider names is refused', async () => {
    const s = await mcpSession()
    const base = s.stored().breakpoints
    const mobile = base[base.length - 1]
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<slider data-ref="deck">\n  <div>\n    <span />\n  </div>\n</slider>'),
      version: home.version,
    })
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'deck', slider: { perView: { base: 3, [mobile.id]: 1 } } }],
    })

    const refused = await s.call('update_settings', {
      breakpoints: [{ name: 'Desktop', width: 1440 }],
    })
    expect(refused.saved).toBe(false)
    expect(refused.reason).toBe('breakpoints-in-use')
    expect(refused.inUse[0].where).toContain('slider')

    // keeping its id keeps it, with a new width
    const kept = await s.call('update_settings', {
      breakpoints: [
        { name: 'Desktop', width: 1440 },
        { id: mobile.id, name: 'Phone', width: 420 },
      ],
    })
    expect(kept.saved).toBe(true)
    expect(kept.breakpoints.find((b: { id: string }) => b.id === mobile.id).name).toBe('Phone')
  })
})

test.describe('set_page_html identity', () => {
  test('wrapping an element keeps everything it was carrying', async () => {
    // The DSL path could not do this: a node that changed PARENT kept its id
    // but had its classes, content and bindings DROPPED, because a line diff
    // could not tell a deliberate wrap from a coincidental match, and carrying
    // state across would have styled new structure with old presentation. It
    // reported what it dropped so an agent could put it back by hand. Matching
    // a tree by `data-ref`/`data-id` has no such ambiguity, so the state simply
    // survives and there is nothing to put back.
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<h1 data-ref="title" />'),
      version: home.version,
    })
    let after = await s.home()
    const { created } = await s.call('create_interactions', {
      items: [{ name: 'Show', toClasses: 'flex' }],
    })
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        {
          ref: 'title',
          addClasses: ['text-3xl', 'font-bold'],
          content: 'Dashboard',
          bindInteractions: [{ interactionId: created[0].id, trigger: 'hover' }],
        },
      ],
    })
    const before = await s.call('get_page', { pageId: after.id, elements: 'refs' })
    const titleId = before.elements.find((e: { ref?: string }) => e.ref === 'title').id

    after = await s.home()
    const r = await s.call('set_page_html', {
      pageId: after.id,
      html: pageHtml('<div data-ref="wrap">\n  <h1 data-ref="title" class="text-3xl font-bold">Dashboard</h1>\n</div>'),
      version: after.version,
    })
    expect(r.saved).toBe(true)
    expect(r.applied.removed).toBe(0)

    const page = await s.call('get_page', {
      pageId: after.id,
      includeContent: true,
      includeInteractions: true,
    })
    const title = page.elements.find((e: { ref?: string }) => e.ref === 'title')
    expect(title.id).toBe(titleId) // the same element, under a new parent
    expect(title.classes).toContain('text-3xl')
    expect(title.content.text).toBe('Dashboard')
    expect(title.interactions[0].interactionId).toBe(created[0].id)
    // and it really is inside the wrapper
    expect(page.html).toMatch(/<div [^>]*data-ref="wrap">\n\s+<h1 /)
  })
})

test.describe('addressing a component instance’s parts', () => {
  /** a page with two Button instances, each ref'd */
  async function buttons() {
    const s = await mcpSession()
    await s.seed(['button'])
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<Button data-ref="save" />\n<Button data-ref="cancel" />'),
      version: home.version,
    })
    return s
  }

  test('ref-parts lists only the ref’d instances, with symbolic part names', async () => {
    const s = await buttons()
    const home = await s.home()
    const small = await s.call('get_page', {
      pageId: home.id,
      elements: 'ref-parts',
      summaryOnly: true,
    })
    expect(small.elements).toHaveLength(2)
    expect(small.elements.map((e: { ref: string }) => e.ref)).toEqual(['save', 'cancel'])
    const names = small.elements[0].parts.map((p: { part: string }) => p.part)
    expect(names).toContain('span')
    // the same type twice gets [n]
    expect(new Set(names).size).toBe(names.length)

    // and it is much smaller than the read that carried the same information
    const own = await s.call('get_page', { pageId: home.id, elements: 'own', summaryOnly: true })
    expect(JSON.stringify(small).length).toBeLessThan(JSON.stringify(own).length)
  })

  test('an edit addresses a part by name, and each instance keeps its own', async () => {
    const s = await buttons()
    const after = await s.home()
    const r = await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        { ref: 'save', part: 'span', content: 'Save changes' },
        { ref: 'cancel', part: 'span', content: 'Cancel' },
      ],
    })
    expect(r.failed).toBe(0)
    const html = await s.html()
    expect(html).toContain('Save changes')
    expect(html).toContain('Cancel')
  })

  test('a part that does not exist is refused, and the message lists the real ones', async () => {
    const s = await buttons()
    const after = await s.home()
    const r = await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'save', part: 'h1', content: 'nope' }],
      verbose: true,
    })
    expect(r.failed).toBe(1)
    const message = r.failures[0].errors[0]
    expect(message).toContain('has no part "h1"')
    // and it lists the real ones, so the next call is right
    expect(message).toContain('icon, span, icon[1]')
  })

  test('part on a plain element says so rather than guessing', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<h1 data-ref="title" />'),
      version: home.version,
    })
    const after = await s.home()
    const r = await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'title', part: 'span', content: 'x' }],
      verbose: true,
    })
    expect(r.failed).toBe(1)
    expect(JSON.stringify(r)).toContain('component instance')
  })
})

// A collection could hold text, media, dates and references, and nothing else —
// so a price, a yes/no and a status had to be typed as free text, which sorts
// wrong, cannot be validated, and shows up in the translation worklist as if
// "waiting" were prose. All three store a STRING like every other scalar.
test.describe('number, boolean and choice fields', () => {
  async function seeded() {
    const s = await mcpSession()
    const c = (await s.call('create_collection', { name: 'gear', detailRoutes: false }))
      .collection
    const r = await s.call('update_collection', {
      collectionId: c.id,
      addFields: [
        { name: 'price', type: 'number' },
        { name: 'featured', type: 'boolean' },
        { name: 'status', type: 'select', options: ['waiting', 'active', 'archived'] },
      ],
    })
    expect(r.errors).toBeUndefined()
    return { s, c }
  }

  test('a select reports its options, so they can be written without guessing', async () => {
    const { s, c } = await seeded()
    const fields = (await s.call('get_collection', { collectionId: c.id })).fields
    const status = fields.find((f: { name: string }) => f.name === 'status')
    expect(status.options).toEqual(['waiting', 'active', 'archived'])
    // and the scalar types carry no options key at all
    expect(fields.find((f: { name: string }) => f.name === 'price').options).toBeUndefined()
  })

  test('a select with no options is refused — every write to it would be', async () => {
    const s = await mcpSession()
    const c = (await s.call('create_collection', { name: 'gear', detailRoutes: false }))
      .collection
    const r = await s.call('update_collection', {
      collectionId: c.id,
      addFields: [{ name: 'status', type: 'select' }],
    })
    expect(JSON.stringify(r.errors)).toContain('options')
    expect((await s.call('get_collection', { collectionId: c.id })).fields).toHaveLength(1)
  })

  test('a value the field cannot hold is refused by name, not stored', async () => {
    const { s, c } = await seeded()
    const r = await s.call('upsert_entries', {
      collectionId: c.id,
      entries: [
        { name: 'Kayak', values: { price: 'twelve' } },
        { name: 'Tent', values: { featured: 'yes' } },
        { name: 'Rope', values: { status: 'pending' } },
        { name: 'Paddle', values: { price: '120', featured: 'true', status: 'active' } },
      ],
    })
    expect(r.failures).toHaveLength(3)
    const why = r.failures.map((f: { message: string }) => f.message).join(' | ')
    expect(why).toContain('is not a number')
    expect(why).toContain('is not "true" or "false"')
    // the select names the options rather than leaving the agent to guess
    expect(why).toContain('"waiting", "active", "archived"')
    // a failed create leaves nothing behind; the good one landed
    const entries = (await s.call('get_collection', { collectionId: c.id })).entries
    expect(entries).toHaveLength(1)
    expect(entries[0].values.price.text ?? entries[0].values.price).toBe('120')
  })

  test('none of the three enters the translation worklist', async () => {
    const { s, c } = await seeded()
    await s.call('update_settings', { addLocales: ['fr'] })
    await s.call('upsert_entries', {
      collectionId: c.id,
      entries: [{ name: 'Kayak', values: { price: '120', featured: 'true', status: 'active' } }],
    })
    const work = await s.call('get_translation_worklist', { locale: 'fr' })
    const names = JSON.stringify(work.items ?? [])
    expect(names).not.toContain('"price"')
    expect(names).not.toContain('"featured"')
    expect(names).not.toContain('"status"')

    // and an override on one is refused rather than stored as dead data: the
    // value is what a data-[…] variant matches on, so translating it would
    // break the styling it drives
    const entry = (await s.call('get_collection', { collectionId: c.id })).entries[0]
    const r = await s.call('upsert_entries', {
      collectionId: c.id,
      entries: [{ entryId: entry.id, locale: 'fr', values: { status: 'actif' } }],
    })
    expect(JSON.stringify(r.failures)).toContain('status')
  })

  test('all three render, and a select drives a variant class per entry', async () => {
    const { s, c } = await seeded()
    await s.call('upsert_entries', {
      collectionId: c.id,
      entries: [
        { name: 'Kayak', values: { price: '120', featured: 'true', status: 'waiting' } },
        { name: 'Tent', values: { price: '90', featured: 'false', status: 'active' } },
      ],
    })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(
        [
          '<collection-list source="gear">',
          '  <span data-field="price" />',
          '  <span data-field="featured" />',
          '  <span data-ref="pill" data-field="status" />',
          '</collection-list>',
        ].join('\n'),
      ),
      version: home.version,
    })
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        {
          ref: 'pill',
          fieldAttrs: { 'data-status': 'status' },
          addClasses: ['data-[status=waiting]:bg-yellow-200'],
        },
      ],
    })

    const html = await s.html()
    // a number and a boolean are strings all the way to the page
    expect(html).toContain('>120<')
    expect(html).toContain('>true<')
    // and the select's VALUE is what the variant matches on, per entry
    expect(html).toContain('data-status="waiting"')
    expect(html).toContain('data-status="active"')
  })

  test('options can be changed later, and an orphaned value is reported not rewritten', async () => {
    const { s, c } = await seeded()
    await s.call('upsert_entries', {
      collectionId: c.id,
      entries: [{ name: 'Kayak', values: { status: 'archived' } }],
    })
    const r = await s.call('update_collection', {
      collectionId: c.id,
      updateFields: [{ name: 'status', options: ['waiting', 'active'] }],
    })
    expect(r.saved).toBe(true)
    expect(JSON.stringify(r.warnings)).toContain('archived')
    // the entry keeps the value: pages match on it, so a silent rewrite would
    // restyle them
    const entry = (await s.call('get_collection', { collectionId: c.id })).entries[0]
    expect(entry.values.status.text ?? entry.values.status).toBe('archived')
  })
})

// Two tasks the Ridgeline brief simply could not be done: a page created as a
// draft was a draft forever (nothing after create_page changed its status, so
// a draft collection template kept its entry routes out of the export), and an
// agent could reply to a comment thread but never start one.
test.describe('set_translations', () => {
  // F5: the three id lookups called findNode raw, so the SHORT 8-hex data-id a
  // read prints — the one the worklist itself hands back — was refused as "no
  // element with id", and an agent had no address that worked.
  test('the short data-id a read prints is a usable address', async () => {
    const s = await mcpSession()
    await s.call('update_settings', { addLocales: ['fr'] })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<h1 data-ref="title">Ridgeline</h1><input placeholder="Your email" />'),
      version: home.version,
    })
    const page = await s.call('get_page', { pageId: home.id })
    const shortId = /<h1 data-id="([0-9a-f]+)"/.exec(page.html)![1]
    expect(shortId).toHaveLength(8)

    const r = await s.call('set_translations', {
      locale: 'fr',
      items: [{ kind: 'element', pageId: home.id, id: shortId, content: 'Ligne de crête' }],
    })
    expect(r.failures ?? []).toEqual([])
    expect(r.written).toBe(1)

    // and the attribute path, which had the same raw lookup
    const attrId = /<input data-id="([0-9a-f]+)"/.exec(page.html)![1]
    const a = await s.call('set_translations', {
      locale: 'fr',
      items: [
        {
          kind: 'attribute',
          pageId: home.id,
          id: attrId,
          attribute: 'placeholder',
          content: 'Votre courriel',
        },
      ],
    })
    expect(a.failures ?? []).toEqual([])

    const node = s
      .stored()
      .pages[0].elements[0].children.find((n: { type: string }) => n.type === 'h1')
    expect(node.locales.fr.content).toBe('Ligne de crête')
    const field = s
      .stored()
      .pages[0].elements[0].children.find((n: { type: string }) => n.type === 'input')
    expect(field.locales.fr.attributes.placeholder).toBe('Votre courriel')
  })

  test('a master is addressable by its short id too', async () => {
    const s = await mcpSession()
    await s.call('update_settings', { addLocales: ['fr'] })
    const made = await s.call('create_component', {
      name: 'Hero',
      html: '<section><h1>Ridgeline</h1></section>',
    })
    const def = (await s.call('list_components', {})).components.find(
      (c: { id: string }) => c.id === made.componentId,
    )
    const shortId = /<h1 data-id="([0-9a-f]+)"/.exec(def.html)![1]
    expect(shortId).toHaveLength(8)

    const r = await s.call('set_translations', {
      locale: 'fr',
      items: [
        { kind: 'master', componentId: made.componentId, id: shortId, content: 'Ligne de crête' },
      ],
    })
    expect(r.failures ?? []).toEqual([])
    expect(r.written).toBe(1)
  })
})

test.describe('update_page and create_comment', () => {
  test('a draft page is published later, and the route appears', async () => {
    const s = await mcpSession()
    const made = await s.call('create_page', { name: 'About', slug: '/about', status: 'draft' })
    await s.call('set_page_html', {
      pageId: made.pageId,
      html: pageHtml('<h1>About us</h1>'),
      version: (await s.call('get_page', { pageId: made.pageId })).version,
    })
    // a draft is dropped from the export
    expect(Object.keys(await s.exportAll())).not.toContain('about/index.html')

    const read = await s.call('get_page', { pageId: made.pageId })
    const up = await s.call('update_page', {
      pageId: made.pageId,
      version: read.version,
      status: 'published',
    })
    expect(up.saved).toBe(true)
    expect(up.changed).toEqual(['status'])
    expect(Object.keys(await s.exportAll())).toContain('about/index.html')
  })

  test('a rename and a slug change land together, and a taken slug is refused', async () => {
    const s = await mcpSession()
    const made = await s.call('create_page', { name: 'About', slug: '/about' })
    await s.call('create_page', { name: 'Contact', slug: '/contact' })

    const read = await s.call('get_page', { pageId: made.pageId })
    const taken = await s.call('update_page', {
      pageId: made.pageId,
      version: read.version,
      slug: '/contact',
    })
    expect(taken.saved).toBe(false)
    expect(taken.reason).toBe('slug-taken')

    const ok = await s.call('update_page', {
      pageId: made.pageId,
      version: read.version,
      name: 'Our story',
      slug: '/story',
    })
    expect(ok.saved).toBe(true)
    expect(ok.changed.sort()).toEqual(['name', 'slug'])
    // nothing links to the old route, so there is nothing to report — the note
    // and `linksToOldSlug` appear only when a link really did break (E14, see
    // mcp-publish-warnings.spec.ts)
    expect(ok.note).toBeUndefined()
    expect(ok.linksToOldSlug).toBeUndefined()
    expect(Object.keys(await s.exportAll())).toContain('story/index.html')
  })

  test('the home page keeps its slug, and a stale version is refused', async () => {
    const s = await mcpSession()
    const home = await s.home()
    const read = await s.call('get_page', { pageId: home.id })
    const moved = await s.call('update_page', {
      pageId: home.id,
      version: read.version,
      slug: '/start',
    })
    expect(moved.saved).toBe(false)
    expect(moved.reason).toBe('home-slug')

    expect(
      (await s.call('update_page', { pageId: home.id, version: 'stale', name: 'X' })).reason,
    ).toBe('stale-version')
  })

  test('a comment anchors to an element, and to the page without one', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<section data-ref="hero"><h1>Ridgeline</h1></section>'),
      version: home.version,
    })

    const anchored = await s.call('create_comment', {
      pageId: home.id,
      ref: 'hero',
      text: 'Guessed the headline — confirm the wording?',
    })
    expect(anchored.saved).toBe(true)
    expect(anchored.anchoredTo).toBeTruthy()

    const loose = await s.call('create_comment', { pageId: home.id, text: 'No pricing copy yet.' })
    expect(loose.anchoredTo).toBeUndefined()

    const threads = (await s.call('list_comments', {})).comments
    expect(threads).toHaveLength(2)
    // a thread an agent started takes a reply like any other
    const back = await s.call('reply_to_comment', {
      commentId: anchored.commentId,
      text: 'Wording confirmed.',
    })
    expect(back.saved).toBe(true)
  })

  test('a comment anchored to nothing is refused rather than left invisible', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await expect(
      s.call('create_comment', { pageId: home.id, ref: 'nope', text: 'hi' }),
    ).rejects.toThrow(/nope/)
    expect((await s.call('list_comments', {})).comments).toHaveLength(0)
  })
})

test.describe('get_guide sections', () => {
  test('the 25 KB content section is three, and the old slug still resolves', async () => {
    const s = await mcpSession()
    const toc = await s.call('get_guide')
    const slugs = (toc.sections as { section: string; bytes: number }[])
    const by = new Map(slugs.map((x) => [x.section, x.bytes]))
    expect([...by.keys()]).toContain('content')
    expect([...by.keys()]).toContain('media')
    expect([...by.keys()]).toContain('data')
    expect([...by.keys()]).not.toContain('content-media-data')
    // each one is a section an agent can afford to read on its own
    for (const slug of ['content', 'media', 'data']) {
      expect(by.get(slug)!).toBeLessThan(18_000)
    }

    // the slug it used to have is aliased, not 404
    const old = await s.call('get_guide', { section: 'content-media-data' })
    expect(old.guide).toContain('## Content')
    // and a partial slug reaches the right one, which is undocumented no more
    expect((await s.call('get_guide', { section: 'page' })).guide).toContain('## Page HTML')
    expect((await s.call('get_guide', { section: 'html' })).guide).toContain('## Page HTML')
    // a miss costs the slug list, not the handbook
    const miss = await s.call('get_guide', { section: 'zzz' })
    expect(miss.error).toContain('zzz')
    expect(miss.sections.length).toBeGreaterThan(10)
  })
})

// Three writes that could destroy work an agent had not read, and said so
// only afterwards.
test.describe('destructive writes are interlocked', () => {
  test('a token replace that drops an in-use token is refused', async () => {
    const s = await mcpSession()
    await s.call('update_settings', {
      addTokens: [
        { name: 'brand', value: '#112233' },
        { name: 'ink', value: '#000000' },
      ],
    })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<p data-ref="t" class="text-ink bg-brand">x</p>'),
      version: home.version,
    })

    // the stale-read shape: re-send the list you were handed, minus one
    const r = await s.call('update_settings', { tokens: [{ name: 'brand', value: '#112233' }] })
    expect(r.saved).toBe(false)
    expect(r.reason).toBe('tokens-in-use')
    expect(JSON.stringify(r.inUse)).toContain('ink')
    // it names addTokens, which is what the caller actually wanted
    expect(r.message).toContain('addTokens')
    // and nothing was dropped
    const after = await s.call('get_settings')
    expect((after.tokens as { name: string }[]).map((t) => t.name).sort()).toEqual(['brand', 'ink'])

    // forcePurge is the opt-in, same as removeTokens
    const forced = await s.call('update_settings', {
      tokens: [{ name: 'brand', value: '#112233' }],
      forcePurge: true,
    })
    expect(forced.saved).toBe(true)
  })

  test('deleting a bound interaction is refused, and names where', async () => {
    const s = await mcpSession()
    const { created } = await s.call('create_interactions', {
      items: [{ name: 'Show', toClasses: 'flex' }],
    })
    const id = created[0].id
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<div data-ref="panel" class="hidden" />'),
      version: home.version,
    })
    const page = await s.home()
    await s.call('edit_elements', {
      pageId: page.id,
      version: page.version,
      edits: [{ ref: 'panel', bindInteractions: [{ interactionId: id, trigger: 'click' }] }],
    })

    // the count is readable WITHOUT risking the delete
    const listed = (await s.call('list_interactions')).interactions as { bindings?: number }[]
    expect(listed[0].bindings).toBe(1)

    const r = await s.call('delete_interaction', { interactionId: id })
    expect(r.saved).toBe(false)
    expect(r.reason).toBe('in-use')
    expect(r.bindings).toBe(1)
    expect(JSON.stringify(r.where)).toContain('panel')
    // still there, still bound
    expect((await s.call('list_interactions')).interactions).toHaveLength(1)

    const forced = await s.call('delete_interaction', { interactionId: id, force: true })
    expect(forced.saved).toBe(true)
    expect(forced.unbound).toBe(1)
  })

  test('an UNBOUND effect deletes without ceremony', async () => {
    const s = await mcpSession()
    const { created } = await s.call('create_interactions', {
      items: [{ name: 'Spare', toClasses: 'flex' }],
    })
    const r = await s.call('delete_interaction', { interactionId: created[0].id })
    expect(r.saved).toBe(true)

    const anim = await s.call('create_animations', {
      items: [
        {
          name: 'Fade',
          steps: [
            { duration: 200, easing: 'quart-out', tracks: [{ prop: 'opacity', from: 0, to: 1 }] },
          ],
        },
      ],
    })
    expect(anim.created).toHaveLength(1)
    const d = await s.call('delete_animation', { animationId: anim.created[0].id })
    expect(d.saved).toBe(true)
  })
})

test('delete_animation reports the pages it rewrote', async () => {
  const s = await mcpSession()
  const anim = await s.call('create_animations', {
    items: [
      {
        name: 'Fade',
        steps: [
          { duration: 200, easing: 'quart-out', tracks: [{ prop: 'opacity', from: 0, to: 1 }] },
        ],
      },
    ],
  })
  const id = anim.created[0].id
  const home = await s.home()
  await s.call('set_page_html', {
    pageId: home.id,
    html: pageHtml('<div data-ref="card" class="opacity-0" />'),
    version: home.version,
  })
  const page = await s.home()
  await s.call('edit_elements', {
    pageId: page.id,
    version: page.version,
    edits: [{ ref: 'card', bindAnimations: [{ animationId: id, trigger: 'appear' }] }],
  })

  const r = await s.call('delete_animation', { animationId: id, force: true })
  expect(r.saved).toBe(true)
  expect(r.unbound).toBe(1)
  // the page it rewrote is named — this is the field whose name was wrong in
  // the handler, which made every call to this tool throw. The version itself
  // is UNCHANGED, and deliberately so: a binding is node state the HTML
  // reports and does not carry, so `pageVersion` excludes it (see GUIDE, "a
  // node-only edit returns the SAME version").
  expect(r.versions).toHaveLength(1)
  expect(r.versions[0].pageId).toBe(home.id)
  expect(r.versions[0].version).toBe(page.version)
  // and the binding really is gone
  const after = await s.call('get_page', {
    pageId: home.id,
    elements: 'own',
    includeInteractions: true,
  })
  expect(JSON.stringify(after.elements)).not.toContain('animations')
})

test.describe('a count track only lands where it can write', () => {
  async function seeded() {
    const s = await mcpSession()
    const made = await s.call('create_animations', {
      items: [
        {
          name: 'Count up',
          steps: [
            {
              tracks: [{ prop: 'count', from: 0, to: 18000, format: { group: true, suffix: '+' } }],
              duration: 900,
              easing: 'linear',
            },
          ],
        },
      ],
    })
    expect(made.failures ?? []).toEqual([])
    return { s, animationId: made.created[0].id as string }
  }

  test('a container has no text of its own to count into', async () => {
    const { s, animationId } = await seeded()
    const home = await s.home()
    const written = await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml('<div data-ref="box"><span data-ref="n">18,000+</span></div>'),
    })

    const bad = await s.call('edit_elements', {
      pageId: home.id,
      version: written.version,
      edits: [{ ref: 'box', bindAnimations: [{ animationId, trigger: 'load' }] }],
    })
    expect(bad.failed).toBe(1)
    expect(JSON.stringify(bad.failures)).toMatch(/is a container/)

    // …and the leaf beside it takes it
    const good = await s.call('edit_elements', {
      pageId: home.id,
      version: written.version,
      edits: [{ ref: 'n', bindAnimations: [{ animationId, trigger: 'load' }] }],
    })
    expect(good.failed).toBe(0)
  })

  test('a field-bound element would fight the render', async () => {
    const { s, animationId } = await seeded()
    const c = (await s.call('create_collection', { name: 'stat', detailRoutes: false })).collection
    await s.call('update_collection', {
      collectionId: c.id,
      addFields: [{ name: 'total', type: 'text' }],
    })
    const home = await s.home()
    const written = await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml(
        '<collection-list source="stat">\n  <span data-ref="v" data-field="total" />\n</collection-list>',
      ),
    })
    const bad = await s.call('edit_elements', {
      pageId: home.id,
      version: written.version,
      edits: [{ ref: 'v', bindAnimations: [{ animationId, trigger: 'load' }] }],
    })
    expect(bad.failed).toBe(1)
    expect(JSON.stringify(bad.failures)).toMatch(/comes from a collection field/)
  })

  // The element's own text IS the destination — that is what lets one timeline
  // on a StatCounter master drive 12 / 99 / 11 / 140. So a `format` that cannot
  // read that text back is not a cosmetic mismatch: the number silently falls
  // through to the track's `to` and lands on something nobody wrote.
  test("a format that cannot read the element's own text back is refused", async () => {
    const { s, animationId } = await seeded()
    const home = await s.home()
    const written = await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml(
        '<span data-ref="ok">18,000+</span>\n' +
          '<span data-ref="nosuffix">18,000</span>\n' +
          '<span data-ref="words">eighteen thousand</span>\n' +
          '<span data-ref="blank" />',
      ),
    })

    // the text the format spells exactly: allowed
    expect(
      (
        await s.call('edit_elements', {
          pageId: home.id,
          version: written.version,
          edits: [{ ref: 'ok', bindAnimations: [{ animationId, trigger: 'load' }] }],
        })
      ).failed,
    ).toBe(0)

    // the suffix is in the format but not in the text — the end state would
    // read "18,000+" over an element that says "18,000"
    const noSuffix = await s.call('edit_elements', {
      pageId: home.id,
      version: written.version,
      edits: [{ ref: 'nosuffix', bindAnimations: [{ animationId, trigger: 'load' }] }],
    })
    expect(noSuffix.failed).toBe(1)
    expect(JSON.stringify(noSuffix.failures)).toMatch(/would end on .*18,000\+.*but this element says/)

    // no number in the text at all: the count would replace the words
    const words = await s.call('edit_elements', {
      pageId: home.id,
      version: written.version,
      edits: [{ ref: 'words', bindAnimations: [{ animationId, trigger: 'load' }] }],
    })
    expect(words.failed).toBe(1)
    expect(JSON.stringify(words.failures)).toMatch(/but this element says .*eighteen thousand/)

    // binding BEFORE the copy exists is an ordinary order of work, never refused
    expect(
      (
        await s.call('edit_elements', {
          pageId: home.id,
          version: written.version,
          edits: [{ ref: 'blank', bindAnimations: [{ animationId, trigger: 'load' }] }],
        })
      ).failed,
    ).toBe(0)
  })

  test('a staggered step and a yoyo are refused at the library', async () => {
    const s = await mcpSession()
    const track = { prop: 'count', from: 0, to: 100 }
    const staggered = await s.call('create_animations', {
      items: [
        { name: 'A', steps: [{ tracks: [track], duration: 500, easing: 'linear', stagger: 60 }] },
      ],
    })
    expect(staggered.saved).toBe(false)
    expect(JSON.stringify(staggered.failures)).toMatch(/cannot stagger/)

    const yoyo = await s.call('create_animations', {
      items: [
        { name: 'B', steps: [{ tracks: [track], duration: 500, easing: 'linear', yoyo: true }] },
      ],
    })
    expect(yoyo.saved).toBe(false)
    expect(JSON.stringify(yoyo.failures)).toMatch(/cannot yoyo/)
  })
})
