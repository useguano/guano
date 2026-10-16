import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'
import { classTriggers, manifest, wiredById } from './fixtures/fxWire'

// Binding a click on a component instance used to need an authored
// `<div class="contents">` around it — an element per modal trigger. The
// wrapper now emits that element itself, and the binding keys as the PAGE
// binding it is: scoped per instance, the trigger wrote
// `X:target@<instanceId>` while a page target listened on `X:target`, so the
// click did nothing and every tool reported success.

test('a click binds straight onto an instance, with no contents wrapper authored', async () => {
  const s = await mcpSession()
  await s.call('create_component', { name: 'Button', html: '<button class="px-3 py-2"><span>Open</span></button>' })
  const created = await s.call('create_interactions', {
    items: [{ name: 'show', toClasses: 'block', modal: true }],
  })
  const i = created.created[0]

  const home = await s.home()
  await s.call('set_page_html', {
    pageId: home.id,
    html: pageHtml('<Button data-ref="opener" /><div data-ref="sheet" class="hidden fixed inset-0"></div>'),
    version: home.version,
  })
  const page = await s.call('get_page', { pageId: home.id })
  const r = await s.call('edit_elements', {
    pageId: home.id,
    version: page.version,
    edits: [{ ref: 'opener', bindInteractions: [{ interactionId: i.id, trigger: 'click', targetRef: 'sheet' }] }],
  })
  console.log('BIND', JSON.stringify({ saved: r.saved, failures: r.failures }).slice(0, 400))
  expect(r.saved).toBe(true)

  const html = await s.html()
  console.log('EXPORT', html.replace(/\s+/g, ' ').match(/<body>.*?<\/body>/)?.[0])
  // the wrapper emits a REAL element so the binding has somewhere to land…
  expect(html).toMatch(/<div[^>]*data-fx/)
  // …and it is display:contents, so it moves no pixel
  expect(html).toMatch(/class="contents"|contents/)
})

test('the key the wrapper declares is the one its target listens on', async () => {
  const s = await mcpSession()
  await s.call('create_component', { name: 'Button', html: '<button><span>Open</span></button>' })
  const i = (
    await s.call('create_interactions', { items: [{ name: 'show', toClasses: 'block' }] })
  ).created[0]
  const home = await s.home()
  await s.call('set_page_html', {
    pageId: home.id,
    html: pageHtml(
      '<Button data-ref="opener" /><div data-ref="sheet" class="hidden"></div>',
    ),
    version: home.version,
  })
  const page = await s.call('get_page', { pageId: home.id })
  await s.call('edit_elements', {
    pageId: home.id,
    version: page.version,
    edits: [
      { ref: 'opener', bindInteractions: [{ interactionId: i.id, trigger: 'click', targetRef: 'sheet' }] },
      { ref: 'sheet', htmlId: 'sheet' },
    ],
  })
  const html = await s.html()
  // the relationship, not the literal: published keys are route-local ordinals
  const fired = classTriggers(html, '')
  const listens = wiredById(html, 'sheet')?.t ?? []
  expect(listens).toHaveLength(1)
  expect(fired.map((f: any) => f.s)).toContain(listens[0])
  expect(manifest(html).fx?.[listens[0]!]).toBe('block')
})

test('two instances of one component drive the SAME sheet', async () => {
  const s = await mcpSession()
  await s.call('create_component', { name: 'Button', html: '<button><span>Open</span></button>' })
  const i = (
    await s.call('create_interactions', { items: [{ name: 'show', toClasses: 'block' }] })
  ).created[0]
  const home = await s.home()
  await s.call('set_page_html', {
    pageId: home.id,
    html: pageHtml(
      '<Button data-ref="a" /><Button data-ref="b" /><div data-ref="sheet" id="sheet" class="hidden"></div>',
    ),
    version: home.version,
  })
  const page = await s.call('get_page', { pageId: home.id })
  await s.call('edit_elements', {
    pageId: home.id,
    version: page.version,
    edits: [
      { ref: 'a', bindInteractions: [{ interactionId: i.id, trigger: 'click', targetRef: 'sheet' }] },
      { ref: 'b', bindInteractions: [{ interactionId: i.id, trigger: 'click', targetRef: 'sheet' }] },
    ],
  })
  const html = await s.html()
  const listens = wiredById(html, 'sheet')?.t ?? []
  // ONE state key, whichever Button fires it — a per-instance scope would have
  // given each its own flag and neither could close what the other opened
  expect(listens).toHaveLength(1)
})
