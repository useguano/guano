import { test, expect } from '@playwright/test'
// In-process, on the shared harness (e2e/fixtures/mcpSession.ts): the toolset
// and its bundled runtime are plain ESM driven against an in-memory store. No
// server, no browser, no login — so this spec cannot disturb smoke.spec's
// first-run flow.
import { mcpSession, pageHtml as page } from './fixtures/mcpSession'
import { withComponents } from './fixtures/components'

// An agent building a site WITH components: a page written with `<Name />`
// instances, and the component itself edited as the board edits it. The
// ready-made ones come from e2e/fixtures/components.json. The checks that
// matter read the published HTML — a tool reporting success for a write that
// renders nowhere is the bug class here.

test('an instance written with a ref expands, and lists the parts to fill', async () => {
  const { call, home, html, seed } = await mcpSession()
  await seed(['card'])
  const h = await home()
  const written = await call('set_page_html', {
    pageId: h.id,
    version: h.version,
    html: page('<Button data-ref="cta" />\n<Card data-ref="one" />'),
  })
  expect(written.saved).toBe(true)
  const cta = written.elements.find((e: { ref?: string }) => e.ref === 'cta')
  const one = written.elements.find((e: { ref?: string }) => e.ref === 'one')
  // `:Button#cta:` used to be stored as an empty leaf — the ref defeated the expansion
  expect(cta.childCount).toBeGreaterThan(0)
  const part = (row: { parts: { type: string; id: string; hidden?: boolean; hiddenBy?: string }[] }, type: string) =>
    row.parts.find((p) => p.type === type)!
  // the card's button sits in a footer the component hides until asked
  expect(part(one, 'Button').hidden).toBe(true)
  expect(part(one, 'Button').hiddenBy).toBeTruthy()

  const edited = await call('edit_elements', {
    pageId: h.id,
    version: written.version,
    edits: [
      { ref: 'cta', variants: { variant: 'outline' } },
      { id: part(cta, 'span').id, content: 'Get started' },
      { id: part(one, 'h3').id, content: 'First card' },
      { id: part(one, 'span').id, content: 'Read more' },
      { id: part(one, 'Button').hiddenBy, hidden: false },
    ],
  })
  expect(edited.failed).toBe(0)

  const out = await html()
  expect(out).toContain('>Get started<')
  expect(out).toContain('>First card<')
  expect(out).toContain('>Read more<')
  expect(out).toContain('border-input') // the outline option, worn
})

test("an instance's own line takes no classes or bindings", async () => {
  const { call, home, stored, html, seed } = await mcpSession()
  await seed(['card'])
  const h = await home()
  const written = await call('set_page_html', {
    pageId: h.id,
    version: h.version,
    html: page('<Button data-ref="cta" />\n<Card data-ref="one" />'),
  })
  const one = written.elements.find((e: { ref?: string }) => e.ref === 'one')
  const nested = one.parts.find((p: { type: string }) => p.type === 'Button')

  const edited = await call('edit_elements', {
    pageId: h.id,
    version: written.version,
    edits: [
      // on the page node this rendered nowhere while reporting success…
      { ref: 'cta', addClasses: ['mt-8'] },
      // …and on a nested one it landed on Button's root: a box around every button
      { id: nested.id, addClasses: ['w-full'] },
    ],
  })
  expect(edited.failed).toBe(2)
  expect(JSON.stringify(edited.failures)).toContain('wrap the instance in a `<div>`')

  const button = stored().components.find((c: { name: string }) => c.name === 'Button')
  expect(button.root.classes).toBeUndefined()
  expect(await html()).not.toContain('w-full')
})

test('a component is written from scratch, and edited as the board edits it', async () => {
  const { call, home, stored, html, seed } = await mcpSession()
  await seed(['button'])

  const made = await call('create_component', {
    name: 'promo',
    category: 'Sections',
    html: '<section>\n  <h2 />\n  <Button />\n</section>',
  })
  expect(made.saved).toBe(true)
  expect(made.name).toBe('Promo')
  const node = (type: string) => made.nodes.find((n: { type: string }) => n.type === type)
  expect(node('span').in).toBe('Button')

  // no page holds an instance yet: the component is addressed directly
  const styled = await call('edit_elements', {
    componentId: made.componentId,
    verbose: true,
    edits: [
      { id: node('section').id, addClasses: ['py-12'] },
      { id: node('h2').id, content: 'Launch week' },
      // what Promo says about ITS button — not what Button says
      { id: node('span').id, content: 'Join' },
      { id: node('Button').id, variants: { variant: 'secondary' } },
      // a look is Button's, whoever it was reached through
      { id: node('button').id, addClasses: ['rounded-full'] },
      // and a binding in there would be Button's too
      { id: node('button').id, bindInteractions: [{ interactionId: 'x', trigger: 'click' }] },
    ],
  })
  expect(styled.failed).toBe(1)
  expect(JSON.stringify(styled.results)).toContain('what Promo says about its Button')
  expect(JSON.stringify(styled.failures)).toContain('Wrap the instance')

  const button = stored().components.find((c: { name: string }) => c.name === 'Button')
  expect(button.root.children[0].classes).toContain('rounded-full')
  expect(button.root.children[0].children[1].content).toBe('Button')

  const h = await home()
  const written = await call('set_page_html', {
    pageId: h.id,
    version: h.version,
    html: page('<Promo />\n<Button />'),
  })
  expect(written.saved).toBe(true)
  const out = await html()
  expect(out).toContain('>Launch week<')
  expect(out).toContain('>Join<') // Promo's button
  expect(out).toContain('>Button<') // a button of its own
  expect(out).toContain('py-12')
})

test('rename, duplicate, detach and delete keep every page in step', async () => {
  const { call, home, stored, html, seed } = await mcpSession()
  await seed(['card'])
  const card = { componentId: stored().components.find((c: { name: string }) => c.name === 'Card').id }
  const h = await home()
  let written = await call('set_page_html', {
    pageId: h.id,
    version: h.version,
    html: page('<Card data-ref="one" />\n<Card data-ref="two" />'),
  })

  const renamed = await call('update_component', { componentId: card.componentId, name: 'tile', category: 'Cards' })
  expect(renamed.renamed).toEqual({ from: 'Card', to: 'Tile' })
  expect(renamed.versions).toHaveLength(1)
  const types = stored().pages[0].elements[0].children.map((n: { type: string }) => n.type)
  expect(types).toEqual(['Tile', 'Tile'])

  const copy = await call('duplicate_component', { componentId: card.componentId, name: 'WideTile' })
  expect(copy.name).toBe('WideTile')

  const detached = await call('detach_instance', {
    pageId: h.id,
    version: renamed.versions[0].version,
    ref: 'two',
  })
  expect(detached.saved).toBe(true)
  const tiles = () =>
    stored().pages[0].elements[0].children.filter((n: { type: string }) => n.type === 'Tile')
  expect(tiles()).toHaveLength(1)

  // still used once: refused, then detached and deleted
  const refused = await call('delete_component', { componentId: card.componentId })
  expect(refused.reason).toBe('in-use')
  const deleted = await call('delete_component', { componentId: card.componentId, detach: true })
  expect(deleted.detached).toBe(1)
  expect(tiles()).toHaveLength(0)

  // both cards are still on the page, as plain elements
  const out = await html()
  expect(out.match(/>Card title</g)).toHaveLength(2)
  written = await call('get_page', { pageId: h.id })
  // always present, so "clean" and "nobody checked" are different answers
  expect(written.diagnostics).toEqual([])
})

test('a list keeps its filter inside a component, and an instance can narrow it', async () => {
  const { call, home, html } = await mcpSession()
  const col = await call('create_collection', { name: 'conversation' })
  await call('update_collection', { collectionId: col.collection.id, addFields: [{ name: 'status', type: 'text' }] })
  await call('upsert_entries', {
    collectionId: col.collection.id,
    entries: [
      { name: 'A', values: { title: 'Alpha', status: 'active' } },
      { name: 'B', values: { title: 'Beta', status: 'waiting' } },
    ],
  })
  const h = await home()
  let w = await call('set_page_html', {
    pageId: h.id,
    version: h.version,
    html: page('<div data-ref="inbox">\n  <collection-list data-ref="list" source="conversation">\n    <h3 data-field="title" />\n  </collection-list>\n</div>'),
  })
  await call('edit_elements', {
    pageId: h.id,
    version: w.version,
    edits: [{ ref: 'list', listQuery: { filter: { field: 'status', equals: 'active' } } }],
  })
  w = await call('get_page', { pageId: h.id, elements: 'refs' })
  const made = await call('create_component', {
    pageId: h.id,
    id: w.elements.find((e: { ref?: string }) => e.ref === 'inbox').id,
    name: 'Inbox',
    version: w.version,
  })
  expect(made.saved).toBe(true)
  // the filter moved to the master with the rest of the node state — and used
  // to be ignored there by every renderer
  let out = await html()
  expect(out).toContain('Alpha')
  expect(out).not.toContain('Beta')
  const inbox = (await call('list_components', { names: ['Inbox'], includeNodes: true })).components[0]
  expect(inbox.nodes.find((n: { type: string }) => n.type === 'collection-list').listQuery).toBeTruthy()

  // an instance's own filter wins over the component's default
  w = await call('get_page', { pageId: h.id, elements: 'all' })
  const list = w.elements.find((e: { type: string }) => e.type === 'collection-list')
  await call('edit_elements', {
    pageId: h.id,
    version: w.version,
    edits: [{ id: list.id, listQuery: { filter: { field: 'status', equals: 'waiting' } } }],
  })
  out = await html()
  expect(out).toContain('Beta')
  expect(out).not.toContain('Alpha')

  // a field binding on the component's element is structure: every instance follows
  const h3 = inbox.nodes.find((n: { type: string }) => n.type === 'h3')
  const arg = await call('edit_elements', { componentId: inbox.id, edits: [{ id: h3.id, arg: 'status' }] })
  expect(arg.failed).toBe(0)
  expect(arg.alsoTouched).toHaveLength(1)
  expect(await html()).toContain('>waiting<')
})

test("an instance wears the default even when its host picked otherwise", async () => {
  const { call, home, html, seed } = await mcpSession()
  await seed(['button'])
  const card = await call('create_component', { name: 'Card', html: '<div>\n  <Button />\n</div>' })
  const mirror = card.nodes.find((n: { type: string }) => n.type === 'Button')
  await call('edit_elements', { componentId: card.componentId, edits: [{ id: mirror.id, variants: { variant: 'outline' } }] })
  const h = await home()
  const w = await call('set_page_html', { pageId: h.id, version: h.version, html: page('<Card data-ref="c1" />\n<Card data-ref="c2" />') })
  const c2 = w.elements.find((e: { ref?: string }) => e.ref === 'c2').parts.find((p: { type: string }) => p.type === 'Button')
  await call('edit_elements', { pageId: h.id, version: w.version, edits: [{ id: c2.id, variants: { variant: 'default' } }] })
  const looks = [...(await html()).matchAll(/<button class="([^"]*)"/g)].map((m) =>
    m[1].includes('border-input') ? 'outline' : 'default',
  )
  expect(looks).toEqual(['outline', 'default'])
})

test("a host's say about the instance it holds reaches the page", async () => {
  const { call, home, html, seed } = await mcpSession()
  await seed(['input'])

  // Vezaro, MAJOR: `edit_elements {componentId, instanceAttributes}` on the
  // radios a StartFlow component held answered `{saved: true, edited: 4}` and
  // every one of them still exported the OptionCard default name — so four
  // questions were one radio group, and answering a later one cleared the
  // earlier answer. Nothing in the response said so.
  //
  // `name` per placement is the whole reason the per-placement layer exists,
  // and a host IS a placement. Every renderer read the node's own layer and
  // the master's and stopped, so the layer in between — the host's mirror —
  // rendered nowhere.
  const host = await call('create_component', {
    name: 'Field',
    html: '<div>\n  <Input />\n  <Input />\n</div>',
  })
  const mirrors = host.nodes.filter((n: { type: string }) => n.type === 'input')
  const ed = await call('edit_elements', {
    componentId: host.componentId,
    edits: [
      { id: mirrors[0].id, instanceAttributes: { name: 'treatment' } },
      { id: mirrors[1].id, instanceAttributes: { name: 'goal' } },
    ],
  })
  expect(ed.failed).toBe(0)

  const h = await home()
  const w = await call('set_page_html', {
    pageId: h.id,
    version: h.version,
    html: page('<Field data-ref="f1" />'),
  })
  const names = (out: string) => [...out.matchAll(/<input[^>]*name="([^"]*)"/g)].map((m) => m[1])
  expect(names(await html())).toEqual(['treatment', 'goal'])

  // and THIS placement still wins over what its host said — the chain is
  // own → each host mirror → master, as it is for every other per-instance value
  const read = await call('get_page', { pageId: h.id, elements: 'ref-parts' })
  const first = read.elements
    .find((e: { ref?: string }) => e.ref === 'f1')
    .parts.find((p: { part: string }) => p.part === 'input')
  const own = await call('edit_elements', {
    pageId: h.id,
    version: read.version,
    edits: [{ id: first.id, instanceAttributes: { name: 'this-one-only' } }],
  })
  expect(own.failed).toBe(0)
  expect(names(await html())).toEqual(['this-one-only', 'goal'])
})

test('what a host cannot say about an instance is refused, not dropped', async () => {
  const { call, home, seed } = await mcpSession()
  await seed(['button'])
  const card = await call('create_component', { name: 'Card', html: '<div>\n  <Button />\n</div>' })

  // a link on the instance's own line renders nowhere
  const h = await home()
  const link = await call('set_page_html', { pageId: h.id, version: h.version, html: page('<Card data-ref="c1" href="/messages" />') })
  // refused by NAME rather than dropped: the wrapper emits no element, so the
  // link had nowhere to go
  expect(link.refused[0].message).toContain('no element')
  expect(link.refused[0].path).toContain('Card')

  // a binding inside the nested block would be Button's — it used to be stripped silently
  const nested = await call('update_component', {
    componentId: card.componentId,
    version: card.version,
    html: '<Card>\n  <div>\n    <Button>\n      <button>\n        <svg />\n        <span data-field="title" />\n        <svg />\n      </button>\n    </Button>\n  </div>\n</Card>',
  })
  expect(nested.saved).toBe(false)
  expect(JSON.stringify(nested.refused)).toContain("the component's")

  // and the same through an arg edit on the mirror
  const span = card.nodes.find((n: { type: string }) => n.type === 'span')
  const arg = await call('edit_elements', { componentId: card.componentId, edits: [{ id: span.id, arg: 'title' }] })
  expect(arg.failed).toBe(1)
  expect(arg.failures[0].errors[0]).toContain('every Button everywhere')
})

test('publish warns about what a design review would send back', async () => {
  const { call, home, seed } = await mcpSession()
  await seed(['select', 'navbar'])
  await call('create_interactions', { items: [{ name: 'Never bound', toClasses: 'hidden' }] })
  await call('update_settings', { motion: { transitions: { enabled: true, preset: 'fade' } } })
  const h = await home()
  const w = await call('set_page_html', {
    pageId: h.id,
    version: h.version,
    html: page('<Navbar />\n<Select />\n<select data-ref="raw">\n  <option />\n</select>'),
  })
  await call('edit_elements', { pageId: h.id, version: w.version, edits: [{ ref: 'raw', addClasses: ['h-9', 'rounded-lg'] }] })
  await call('create_page', { name: 'Two', slug: '/two' })
  const two = (await call('list_pages')).pages.find((p: { name: string }) => p.name === 'Two')
  await call('set_page_html', { pageId: two.id, version: two.version, html: page('<Navbar />') })

  const kinds = (await call('publish')).warnings.map((x: { kind: string }) => x.kind)
  // the raw select, not the library one (it has appearance-none and a drawn chevron)
  const native = (await call('publish')).warnings.find((x: { kind: string }) => x.kind === 'native-select')
  expect(native.message).toContain('1 :select')
  // the navbar is sticky top-0 on every page, which is what most marketing
  // sites are — a fixed bar over a fading page is usually the design somebody
  // asked for, so it is NOT the app-shell case
  expect(kinds).not.toContain('body-transition-under-app-shell')
  expect(kinds).toContain('unused-effects')
  expect(kinds).not.toContain('unstyled-controls')
})

test('a body transition is flagged under an app SHELL, not under a top bar', async () => {
  const { call, home } = await mcpSession()
  await call('update_settings', { motion: { transitions: { enabled: true, preset: 'fade' } } })
  // a sidebar: full height down one side, which the content sits beside. Fading
  // the body takes the shell with it on every navigation — the app blinking.
  await call('create_component', {
    name: 'Rail',
    html: '<div class="fixed inset-y-0 left-0 w-64 border-r border-border">\n  <span>Rail</span>\n</div>',
  })
  const h = await home()
  await call('set_page_html', { pageId: h.id, version: h.version, html: page('<Rail />') })
  await call('create_page', { name: 'Two', slug: '/two' })
  const two = (await call('list_pages')).pages.find((p: { name: string }) => p.name === 'Two')
  await call('set_page_html', { pageId: two.id, version: two.version, html: page('<Rail />') })

  const warning = (await call('publish')).warnings.find(
    (x: { kind: string }) => x.kind === 'body-transition-under-app-shell',
  )
  expect(warning).toBeTruthy()
  expect(warning.chrome).toEqual(['Rail'])
})

// Colour is a class on a thing, never a reason for another thing. A review
// session produced one Card in four colours and one icon in six shades; both
// are refused at the write now, and the slower route (duplicate, then restyle)
// is caught at publish.

test('a component that is another one in other colours is refused', async () => {
  const { call } = await mcpSession()
  const card = (tone: string) =>
    `<div class="rounded-lg border p-4 ${tone}"><h3 class="text-lg font-semibold">T</h3><p class="text-sm">Body</p></div>`

  const first = await call('create_component', { name: 'Card', html: card('bg-white text-black') })
  expect(first.saved).toBe(true)

  // same elements, only colours differ → refused, pointing at the variant route
  const twin = await call('create_component', { name: 'DarkCard', html: card('bg-black text-white') })
  expect(twin.saved).toBe(false)
  expect(twin.reason).toBe('colour-twin')
  expect(twin.componentId).toBe(first.componentId)
  expect(twin.message).toContain('set_component_variants')
  // nothing was left behind
  expect((await call('list_components')).components.map((c: { name: string }) => c.name)).toEqual(['Card'])

  // nothing differs at all → a duplicate
  const same = await call('create_component', { name: 'Card2', html: card('bg-white text-black') })
  expect(same.saved).toBe(false)
  expect(same.reason).toBe('duplicate-component')

  // a real difference (layout, not colour) is a second component
  const wide = await call('create_component', { name: 'WideCard', html: card('bg-white text-black flex gap-4') })
  expect(wide.saved).toBe(true)

  // the extraction path is held to the same rule
  const home = await call('list_pages').then((r) => r.pages[0])
  const read = await call('get_page', { pageId: home.id })
  const put = await call('set_page_html', {
    pageId: home.id,
    version: read.version,
    html: page(`<div data-ref="c" class="rounded-lg border p-4 bg-red-500 text-white"><h3 class="text-lg font-semibold">X</h3><p class="text-sm">Y</p></div>`),
  })
  expect(put.saved).toBe(true)
  const extracted = await call('create_component', { pageId: home.id, ref: 'c', name: 'RedCard', version: put.version })
  expect(extracted.saved).toBe(false)
  expect(extracted.reason).toBe('colour-twin')
})

test('publish warns about components that differ only by colour', async () => {
  const { call, stored } = await mcpSession()
  const made = await call('create_component', {
    name: 'Pill',
    html: '<span class="rounded-full px-3 py-1 text-xs bg-primary text-primary-foreground">A</span>',
  })
  // duplicate, then restyle in colour only — the create-time refusal cannot see this
  const copy = await call('duplicate_component', { componentId: made.componentId, name: 'DangerPill' })
  const row = copy.nodes[0]
  await call('edit_elements', {
    componentId: copy.componentId,
    edits: [{ id: row.id, removeClasses: ['bg-primary', 'text-primary-foreground'], addClasses: ['bg-red-500', 'text-white'] }],
  })
  expect(JSON.stringify(stored().components[1].root)).toContain('bg-red-500')
  const published = await call('publish', {})
  const warn = (published.warnings ?? []).find((w: { kind: string }) => w.kind === 'colour-twin-components')
  expect(warn).toBeTruthy()
  expect(warn.pairs[0]).toMatch(/Pill ↔ DangerPill|DangerPill ↔ Pill/)
})

test('a single-colour SVG is refused as a file, and goes on the page as an icon', async () => {
  const { call } = await mcpSession()
  const mono = (color: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="${color}"/></svg>`
  const dataUrl = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

  await expect(call('upload_media', { name: 'box.svg', dataUrl: dataUrl(mono('#ff0000')) })).rejects.toThrow(
    /single-colour SVG/,
  )
  // the same mark, another shade — the case that filled a library
  await expect(call('upload_media', { name: 'box-blue.svg', dataUrl: dataUrl(mono('#0000ff')) })).rejects.toThrow(
    /inline icon/,
  )
  // a file is what a favicon needs
  const kept = await call('upload_media', { name: 'favicon.svg', dataUrl: dataUrl(mono('#ff0000')), asFile: true })
  expect(kept.url).toBe('/media/m1')
  // a multi-colour logo is a file
  const logo =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h8v16H4z" fill="#f00"/><path d="M12 4h8v16h-8z" fill="#00f"/></svg>'
  expect((await call('upload_media', { name: 'logo.svg', dataUrl: dataUrl(logo) })).url).toBe('/media/m1')
  // the batch form names the refused item and keeps going
  const batch = await call('upload_media', {
    items: [{ name: 'a.svg', dataUrl: dataUrl(mono('#000')) }, { name: 'logo.svg', dataUrl: dataUrl(logo) }],
  })
  expect(batch.failures?.[0]?.index).toBe(0)
  expect(batch.assets).toHaveLength(1)
})

// A slot: the one place an instance's STRUCTURE is its own. One Modal holds a
// different body on every page; the component's chrome stays shared.

test('a slot holds per-instance structure while the rest of the component stays shared', async () => {
  const { call, stored, html, home } = await mcpSession()
  const modal = await call('create_component', {
    name: 'Modal',
    html: `<div class="fixed inset-0 flex items-center justify-center bg-black/50">
  <div class="rounded-xl bg-white p-6">
    <div data-slot class="space-y-4"><h2 class="text-lg">Title</h2><p>Body</p></div>
    <button class="mt-6 rounded bg-black px-4 py-2 text-white"><span>Close</span></button>
  </div>
</div>`,
  })
  expect(modal.saved).toBe(true)
  const slotRow = modal.nodes.find((n: { slot?: boolean }) => n.slot)
  expect(slotRow).toBeTruthy()
  expect(modal.html).toContain('data-slot')

  // two instances: each starts from the default content, as its own nodes
  const page = await home()
  let read = await call('get_page', { pageId: page.id })
  const put = await call('set_page_html', {
    pageId: page.id,
    version: read.version,
    html: `<body><Modal data-ref="a" /><Modal data-ref="b" /></body>`,
  })
  expect(put.saved).toBe(true)
  read = await call('get_page', { pageId: page.id, elements: 'ref-parts' })
  const a = read.elements.find((e: { ref: string }) => e.ref === 'a')
  const slotPart = a.parts.find((p: { slot?: boolean }) => p.slot)
  expect(slotPart).toBeTruthy()
  expect(slotPart.childCount).toBe(2)
  // the slot's children print with their own attributes; the chrome prints as content only
  expect(read.html).toMatch(/<h2 data-id="[0-9a-f]+" class="text-lg">Title<\/h2>/)
  expect(read.html).not.toContain('class="mt-6')

  // restructure ONE instance's slot: a page edit, nothing shared moves
  const ins = await call('edit_structure', {
    pageId: page.id,
    version: read.version,
    ops: [{ op: 'insert', parent: slotPart.id, html: '<p data-ref="extra" class="text-red-500">Only here</p>' }],
  })
  expect(ins.saved).toBe(true)
  let out = await html()
  expect(out.match(/Only here/g)?.length).toBe(1)
  expect(out.match(/Close/g)?.length).toBe(2)
  // the slot content is NOT a part: it is addressed directly, by ref
  const styled = await call('edit_elements', {
    pageId: page.id,
    version: (await call('get_page', { pageId: page.id })).version,
    edits: [{ ref: 'extra', removeClasses: ['text-red-500'], addClasses: ['text-blue-500'] }],
  })
  expect(styled.saved).toBe(true)
  expect(JSON.stringify(stored().components[0])).not.toContain('Only here')

  // a round trip of the page is a no-op — slot content included
  read = await call('get_page', { pageId: page.id })
  const before = JSON.stringify(stored().pages[0])
  const echo = await call('set_page_html', { pageId: page.id, version: read.version, html: read.html })
  expect(echo.saved).toBe(true)
  expect(JSON.stringify(stored().pages[0])).toBe(before)

  // the component changes: every instance follows, every slot keeps its own
  const cv = (await call('list_components')).components.find((c: { name: string }) => c.name === 'Modal').version
  const upd = await call('update_component', {
    componentId: modal.componentId,
    version: cv,
    html: modal.html.replace('>Body<', '>New default<').replace('mt-6', 'mt-8'),
  })
  expect(upd.saved).toBe(true)
  const closeRow = modal.nodes.find((n: { type: string }) => n.type === 'span')
  const restyle = await call('edit_elements', {
    componentId: modal.componentId,
    edits: [{ id: closeRow.id, content: 'Dismiss' }],
  })
  expect(restyle.saved).toBe(true)
  out = await html()
  expect(out.match(/Dismiss/g)?.length).toBe(2)
  expect(out.match(/mt-8/g)?.length).toBe(2)
  expect(out).toContain('Only here')
  expect(out).not.toContain('New default') // the default is for NEW instances only
  // a third instance starts from the new default
  read = await call('get_page', { pageId: page.id })
  const more = await call('edit_structure', {
    pageId: page.id,
    version: read.version,
    ops: [{ op: 'insert', parent: read.elements?.[0]?.id ?? 'body', html: '<Modal data-ref="c" />' }],
  })
  if (more.saved) expect(await html()).toContain('New default')

  // detach keeps slot content as it is, and the chrome it had
  read = await call('get_page', { pageId: page.id })
  const det = await call('detach_instance', { pageId: page.id, version: read.version, ref: 'a' })
  expect(det.saved).toBe(true)
  out = await html()
  expect(out).toContain('Only here')
  expect(out.match(/Dismiss/g)?.length).toBeGreaterThanOrEqual(2)
})

test('<slot> fills the one slot without re-typing the shell', async () => {
  const { call, home, html } = await mcpSession()
  // Vezaro, MINOR: nine funnel screens shared one FunnelShell, and because an
  // instance's interior must match its master node for node, each page had to
  // re-type the shell's whole skeleton — header, progress bar, footer — around
  // its own content. Nine copies, every one stale the moment the shell changed.
  const shell = await call('create_component', {
    name: 'Shell',
    html: `<div class="flex min-h-screen flex-col">
  <header class="border-b px-6 py-4"><span>Step 1 of 6</span></header>
  <main data-slot class="flex-1 px-6 py-10"><p>Default body</p></main>
  <footer class="border-t px-6 py-4"><span>Need help?</span></footer>
</div>`,
  })
  expect(shell.saved).toBe(true)

  const h = await home()
  const w = await call('set_page_html', {
    pageId: h.id,
    version: h.version,
    html: page(
      '<Shell data-ref="step">\n  <slot>\n    <h1>What is your goal?</h1>\n    <p>Pick one.</p>\n  </slot>\n</Shell>',
    ),
  })
  expect(w.saved).toBe(true)
  expect(w.refused ?? []).toEqual([])

  // the slot holds the page's content, and the shell around it still renders
  const out = await html()
  expect(out).toContain('What is your goal?')
  expect(out).toContain('Step 1 of 6')
  expect(out).toContain('Need help?')
  expect(out).not.toContain('Default body')

  // a second write through the shorthand keeps the slot's node ids — the
  // identity every interaction target and comment anchor depends on
  const read = await call('get_page', { pageId: h.id, elements: 'own' })
  const idsBefore = read.elements.map((e: { id: string }) => e.id)
  const again = await call('set_page_html', {
    pageId: h.id,
    version: read.version,
    html: page(
      '<Shell data-ref="step">\n  <slot>\n    <h1>What is your goal?</h1>\n    <p>Pick two.</p>\n  </slot>\n</Shell>',
    ),
  })
  expect(again.saved).toBe(true)
  expect(again.elements.map((e: { id: string }) => e.id)).toEqual(idsBefore)
  expect(await html()).toContain('Pick two.')

  // and it is refused where it cannot mean one thing
  const loose = await call('set_page_html', {
    pageId: h.id,
    version: (await call('get_page', { pageId: h.id })).version,
    html: page('<section>\n  <slot>\n    <h1>x</h1>\n  </slot>\n</section>'),
  })
  expect(JSON.stringify(loose.refused)).toMatch(/only fills a component instance/)
})

test('a slot is refused where it cannot mean anything', async () => {
  const { call } = await mcpSession()
  const leaf = await call('create_component', { name: 'Bad', html: '<div><p data-slot>x</p></div>' })
  expect(leaf.saved).toBe(false)
  expect(JSON.stringify(leaf.refused)).toMatch(/can't be a slot/)
  const root = await call('create_component', { name: 'Bad2', html: '<Bad2 data-slot><div /></Bad2>' })
  expect(root.saved).toBe(false)
  // on a page, data-slot is the component's: an authored one is dropped, not stored
  const ok = await call('create_component', { name: 'Box', html: '<div data-slot class="p-4"><p>d</p></div>' })
  expect(ok.saved).toBe(true)
  const page = (await call('list_pages')).pages[0]
  const read = await call('get_page', { pageId: page.id })
  const put = await call('set_page_html', {
    pageId: page.id,
    version: read.version,
    html: '<body><section data-slot><p>plain</p></section><Box /></body>',
  })
  expect(put.saved).toBe(true)
  const after = await call('get_page', { pageId: page.id })
  expect(after.html.indexOf('data-slot')).toBe(after.html.lastIndexOf('data-slot')) // only the Box's
})

// A link is PER-INSTANCE with a component default. Every renderer already
// resolved it own-first (`node.link ?? master.link`), so a per-instance
// destination rendered correctly everywhere — and the WRITE path forbade it
// twice: `apply.ts` refused an `href` inside an instance as the component's,
// and `adoptCodeOwned` copied the master's link back down on the next push.
// A Button component therefore could not be a link, which is the first thing
// anyone wants from a Button.
test('each instance of one component carries its own link', async () => {
  const { call, home, html, stored } = await mcpSession()
  const made = await call('create_component', {
    name: 'Cta',
    html: '<a class="rounded bg-black px-4 py-2 text-white" href="/default"><span>Go</span></a>',
  })
  expect(made.saved).toBe(true)

  const h = await home()
  const put = await call('set_page_html', {
    pageId: h.id,
    version: h.version,
    html: page('<Cta data-ref="one" />\n<Cta data-ref="two" />\n<Cta data-ref="three" />'),
  })
  expect(put.saved).toBe(true)

  const after = await home()
  const r = await call('edit_elements', {
    pageId: after.id,
    version: after.version,
    edits: [
      { ref: 'one', part: 'link', link: '/pricing' },
      { ref: 'two', part: 'link', link: 'https://example.com/docs' },
    ],
  })
  expect(r.failed).toBe(0)

  const out = await html()
  expect(out).toContain('href="/pricing"')
  expect(out).toContain('href="https://example.com/docs"')
  // the one that said nothing still inherits the master's
  expect(out).toContain('href="/default"')
  // and the shared styling is still the component's on all three
  expect((out.match(/bg-black/g) ?? []).length).toBe(3)

  // only the two that differ store a link of their own
  const links: (string | undefined)[] = []
  const walk = (nodes: { link?: string; type: string; children?: unknown[] }[]) => {
    for (const n of nodes) {
      if (n.type === 'link') links.push(n.link)
      walk((n.children ?? []) as never[])
    }
  }
  walk(stored().pages[0].elements)
  expect(links.filter(Boolean).sort()).toEqual(['/pricing', 'https://example.com/docs'])
})

test('a link written as href in the page markup is the instance’s own', async () => {
  const { call, home, html } = await mcpSession()
  await call('create_component', {
    name: 'Cta',
    html: '<a class="underline" href="/default"><span>Go</span></a>',
  })
  const h = await home()
  const put = await call('set_page_html', {
    pageId: h.id,
    version: h.version,
    html: page('<Cta data-ref="one">\n  <a href="/signup"><span>Start</span></a>\n</Cta>'),
  })
  expect(put.saved).toBe(true)
  expect(put.refused ?? []).toEqual([])

  const out = await html()
  expect(out).toContain('href="/signup"')
  expect(out).not.toContain('href="/default"')
  // a round-trip of the read is still a no-op: the href comes back as written
  const read = await call('get_page', { pageId: (await home()).id })
  expect(read.html).toContain('href="/signup"')
})

// The master's link is a DEFAULT, so changing it has to reach the instances
// that never set one — which is what the old copy-down did for free.
test('changing the master’s link moves every instance that did not override it', async () => {
  const { call, home, html } = await mcpSession()
  const made = await call('create_component', {
    name: 'Cta',
    html: '<a class="underline" href="/old"><span>Go</span></a>',
  })
  const h = await home()
  await call('set_page_html', {
    pageId: h.id,
    version: h.version,
    html: page('<Cta data-ref="one" />\n<Cta data-ref="two" />'),
  })
  const after = await home()
  await call('edit_elements', {
    pageId: after.id,
    version: after.version,
    edits: [{ ref: 'two', part: 'link', link: '/kept' }],
  })

  const comp = (await call('list_components')).components.find(
    (c: { name: string }) => c.name === 'Cta',
  )
  const moved = await call('update_component', {
    componentId: made.componentId,
    version: comp.version,
    html: '<a class="underline" href="/new"><span>Go</span></a>',
  })
  expect(moved.saved).toBe(true)

  const out = await html()
  expect(out).toContain('href="/new"') // the one that inherits followed
  expect(out).toContain('href="/kept"') // the one that overrode did not
  expect(out).not.toContain('href="/old"')
})
