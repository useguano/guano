import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'

// `listQuery.filter.equalsCurrent` matches the entry being rendered, which is how
// a parent's page lists its children.
//
// Without it a filter could only compare against a literal, so the Cocoapp
// prototype could not render a conversation's messages through
// `message.conversation` at all: it had to mirror the relation as a
// multi-reference on the Conversation and keep both sides in step by hand. The
// mirrored field was seeded and the `message.conversation` field rendered nowhere.

test.describe('a list filtered by the entry being rendered', () => {
  test('a template page lists the child entries pointing at its own entry', async () => {
    const s = await mcpSession()
    // conversations get real routes; messages are data-only
    const convo = (await s.call('create_collection', { name: 'convo' })).collection
    const msg = (await s.call('create_collection', { name: 'msg', detailRoutes: false }))
      .collection
    await s.call('update_collection', {
      collectionId: msg.id,
      addFields: [
        { name: 'body', type: 'text' },
        { name: 'convo', type: 'reference', refCollectionId: convo.id },
      ],
    })
    await s.call('upsert_entries', {
      collectionId: convo.id,
      entries: [{ name: 'Jade' }, { name: 'Amelie' }],
    })
    // seeded by SLUG, no uuid transcription
    await s.call('upsert_entries', {
      collectionId: msg.id,
      entries: [
        { name: 'm1', values: { body: 'Hello Jade', convo: 'jade' } },
        { name: 'm2', values: { body: 'Hi Amelie', convo: 'amelie' } },
        { name: 'm3', values: { body: 'Jade again', convo: 'jade' } },
      ],
    })

    // the conversation template page: a thread of the messages pointing at it
    const pages = (await s.call('list_pages')).pages
    const template = pages.find((p: { name: string }) => p.name !== 'Home')
    expect(template).toBeTruthy()
    await s.call('set_page_html', {
      pageId: template.id,
      // the body keeps its `source` (the collection it is the template for):
      // page meta is tool parameters, never markup
      html: [
        '<body source="convo">',
        '  <h1 data-ref="who" data-field="title" />',
        '  <collection-list data-ref="thread" source="msg">',
        '    <p data-ref="line" data-field="body" />',
        '  </collection-list>',
        '</body>',
      ].join('\n'),
      version: template.version,
    })
    const after = (await s.call('list_pages')).pages.find(
      (p: { id: string }) => p.id === template.id,
    )
    const r = await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        { ref: 'thread', listQuery: { filter: { field: 'convo', equalsCurrent: true } } },
      ],
    })
    expect(r.failed).toBe(0)

    // each conversation route carries only ITS messages
    const dir = await s.exportAll()
    expect(dir['convo/jade/index.html']).toContain('Hello Jade')
    expect(dir['convo/jade/index.html']).toContain('Jade again')
    expect(dir['convo/jade/index.html']).not.toContain('Hi Amelie')
    expect(dir['convo/amelie/index.html']).toContain('Hi Amelie')
    expect(dir['convo/amelie/index.html']).not.toContain('Hello Jade')
  })

  test('outside entry scope the filter matches nothing rather than everything', async () => {
    const s = await mcpSession()
    const convo = (await s.call('create_collection', { name: 'convo', detailRoutes: false }))
      .collection
    const msg = (await s.call('create_collection', { name: 'msg', detailRoutes: false }))
      .collection
    await s.call('update_collection', {
      collectionId: msg.id,
      addFields: [
        { name: 'body', type: 'text' },
        { name: 'convo', type: 'reference', refCollectionId: convo.id },
      ],
    })
    await s.call('upsert_entries', { collectionId: convo.id, entries: [{ name: 'Jade' }] })
    await s.call('upsert_entries', {
      collectionId: msg.id,
      entries: [{ name: 'm1', values: { body: 'Hello Jade', convo: 'jade' } }],
    })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(
        ['<collection-list data-ref="thread" source="msg">\n</collection-list>', '<p data-ref="line" data-field="body" />', '\tcollection-list:'].join(
          '\n',
        ),
      ),
      version: home.version,
    })
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'thread', listQuery: { filter: { field: 'convo', equalsCurrent: true } } }],
    })
    // no entry in scope: showing every message would be worse than showing none
    expect(await s.html()).not.toContain('Hello Jade')
  })
})
