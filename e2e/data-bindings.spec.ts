import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'

// The data-model gaps a project-management prototype hit, each one of which had
// forced a denormalised field or five elements where one belongs:
//
//   - a NUMBER could not reach a style, so no progress bar was possible
//   - `listQuery.filter` was ONE condition, so a per-project kanban could not
//     be expressed and the board had to be global
//   - a date rendered its raw ISO value and a choice its raw value, so two
//     collections grew `due-label` text fields and every pill was five spans

test('a per-project kanban column: project = current AND status = todo', async () => {
  const s = await mcpSession()
  const proj = (await s.call('create_collection', { name: 'project' })).collection
  await s.call('upsert_entries', {
    collectionId: proj.id,
    entries: [{ name: 'Alpha', slug: 'alpha' }, { name: 'Beta', slug: 'beta' }],
  })
  const task = (await s.call('create_collection', { name: 'task', detailRoutes: false })).collection
  await s.call('update_collection', {
    collectionId: task.id,
    addFields: [
      { name: 'status', type: 'select', options: ['todo', 'done'] },
      { name: 'project', type: 'reference', refCollectionId: proj.id },
    ],
  })
  await s.call('upsert_entries', {
    collectionId: task.id,
    entries: [
      { name: 'A-todo', values: { title: 'A-todo', status: 'todo', project: 'alpha' } },
      { name: 'A-done', values: { title: 'A-done', status: 'done', project: 'alpha' } },
      { name: 'B-todo', values: { title: 'B-todo', status: 'todo', project: 'beta' } },
    ],
  })

  // the project TEMPLATE page: the entry in scope is the project
  const tpl = (await s.call('list_pages')).pages.find((p: any) => p.isCollectionTemplate)
  await s.call('set_page_html', {
    pageId: tpl.id,
    html: pageHtml('<collection-list data-ref="todoCol" source="task"><span data-field="title" /></collection-list>'),
    version: tpl.version,
  })
  const page = await s.call('get_page', { pageId: tpl.id })
  const r = await s.call('edit_elements', {
    pageId: tpl.id,
    version: page.version,
    edits: [
      {
        ref: 'todoCol',
        listQuery: {
          filter: { field: 'project', equalsCurrent: true },
          filters: [{ field: 'status', equals: 'todo' }],
        },
      },
    ],
  })
  console.log('SAVED', r.saved, JSON.stringify(r.failures ?? []))
  const all = await s.exportAll()
  const alpha = Object.entries(all).find(([k]) => k.includes('alpha'))![1] as string
  console.log('ALPHA ROUTE', alpha.replace(/\s+/g, ' ').match(/<body>.*<\/body>/)?.[0]?.slice(0, 300))
  expect(alpha).toContain('A-todo')
  expect(alpha).not.toContain('A-done')
  expect(alpha).not.toContain('B-todo')
})

test('an unvalidated second condition is still refused', async () => {
  const s = await mcpSession()
  const task = (await s.call('create_collection', { name: 'task', detailRoutes: false })).collection
  const home = await s.home()
  await s.call('set_page_html', {
    pageId: home.id,
    html: pageHtml('<collection-list data-ref="l" source="task"><span data-field="title" /></collection-list>'),
    version: home.version,
  })
  const page = await s.call('get_page', { pageId: home.id })
  const r = await s.call('edit_elements', {
    pageId: home.id,
    version: page.version,
    edits: [{ ref: 'l', listQuery: { filters: [{ field: 'nope', equals: 'x' }] } }],
  })
  const why = (r.failures ?? []).flatMap((f: any) => f.errors ?? []).join(' ')
  console.log('WHY', why)
  expect(why).toContain('filters[0].field')
})

test('dates and choices render as words', async () => {
  const s = await mcpSession()
  const c = (await s.call('create_collection', { name: 'task', detailRoutes: false })).collection
  await s.call('update_collection', {
    collectionId: c.id,
    addFields: [
      { name: 'due', type: 'date' },
      { name: 'status', type: 'select', options: ['todo', 'in-progress', 'done'] },
    ],
  })
  const lab = await s.call('update_collection', {
    collectionId: c.id,
    updateFields: [{ name: 'status', optionLabels: { todo: 'To do', 'in-progress': 'In progress', done: 'Done' } }],
  })
  console.log('LABELS', JSON.stringify(lab).slice(0, 220))
  await s.call('upsert_entries', {
    collectionId: c.id,
    entries: [{ name: 'A', values: { due: '2026-03-12', status: 'in-progress' } }],
  })
  const home = await s.home()
  const r = await s.call('set_page_html', {
    pageId: home.id,
    html: pageHtml(
      [
        '<collection-list data-ref="rows" source="task">',
        '  <span data-field="due|date:long" />',
        '  <span data-field="due|date:month-day" />',
        '  <span data-field="status|label" />',
        '  <span data-field="status" />',
        '</collection-list>',
      ].join('\n'),
    ),
    version: home.version,
  })
  console.log('DIAG', JSON.stringify(r.diagnostics ?? []))
  console.log('EXPORT', (await s.html()).replace(/\s+/g, ' ').match(/<body>.*?<\/body>/)?.[0])
})

test('a format the field cannot take is refused by name', async () => {
  const s = await mcpSession()
  const c = (await s.call('create_collection', { name: 'task', detailRoutes: false })).collection
  await s.call('update_collection', { collectionId: c.id, addFields: [{ name: 'due', type: 'date' }] })
  const home = await s.home()
  await s.call('set_page_html', {
    pageId: home.id,
    html: pageHtml('<collection-list data-ref="rows" source="task"><span data-ref="d" data-field="due" /></collection-list>'),
    version: home.version,
  })
  const page = await s.call('get_page', { pageId: home.id })
  const r = await s.call('edit_elements', {
    pageId: home.id,
    version: page.version,
    edits: [{ ref: 'd', arg: 'due|date:nope' }],
  })
  const why = (r.failures ?? []).flatMap((f: any) => f.errors ?? []).join(' ')
  console.log('WHY', why)
  expect(why).toContain('not a date format')

  const page2 = await s.call('get_page', { pageId: home.id })
  const r2 = await s.call('edit_elements', {
    pageId: home.id,
    version: page2.version,
    edits: [{ ref: 'd', arg: 'due|label' }],
  })
  const why2 = (r2.failures ?? []).flatMap((f: any) => f.errors ?? []).join(' ')
  console.log('WHY2', why2)
  expect(why2).toContain('only works on a select')
})

test('a numeric field reaches a style through a CSS variable', async () => {
  const s = await mcpSession()
  const c = (await s.call('create_collection', { name: 'task', detailRoutes: false })).collection
  await s.call('update_collection', {
    collectionId: c.id,
    addFields: [{ name: 'progress', type: 'number' }],
  })
  await s.call('upsert_entries', {
    collectionId: c.id,
    entries: [
      { name: 'A', values: { progress: '60' } },
      { name: 'B', values: { progress: '25' } },
    ],
  })
  const home = await s.home()
  await s.call('set_page_html', {
    pageId: home.id,
    html: pageHtml(
      [
        '<collection-list data-ref="rows" source="task">',
        '  <div data-ref="bar" class="h-2 bg-blue-500 w-[calc(var(--p)*1%)]" data-bind-style:--p="progress"></div>',
        '</collection-list>',
      ].join('\n'),
    ),
    version: home.version,
  })
  const html = await s.html()
  // the ONE way a measurement becomes a width: a custom property a class reads
  expect(html).toContain('style="--p:60"')
  expect(html).toContain('style="--p:25"')
  // and it round-trips, so a later read does not lose the binding
  const page = await s.call('get_page', { pageId: home.id })
  expect(page.html).toContain('data-bind-style:--p="progress"')
})

test('a style binding that is not a custom property is refused with the way out', async () => {
  const s = await mcpSession()
  const c = (await s.call('create_collection', { name: 'task', detailRoutes: false })).collection
  await s.call('update_collection', {
    collectionId: c.id,
    addFields: [{ name: 'progress', type: 'number' }],
  })
  const home = await s.home()
  const r = await s.call('set_page_html', {
    pageId: home.id,
    html: pageHtml(
      '<collection-list data-ref="rows" source="task"><div data-bind-style="progress"></div></collection-list>',
    ),
    version: home.version,
  })
  const said = (r.refused ?? []).map((x: any) => x.message).join(' ')
  expect(said).toContain('data-bind-style:--p')
})
