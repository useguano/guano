import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'

// Actions are the third engine: interactions write classes, animations write
// inline styles, actions write DATA. A prototype's "Mark as done" could change
// the colour of a pill and never the status behind it, so every such button in
// a Superbird prototype was dead.
//
// These specs are about the WRITE surface — what `edit_elements {bindActions}`
// accepts and, mostly, what it refuses. Every refusal here exists because the
// alternative is a published page whose button silently does nothing, which is
// the failure the interaction engine already paid for twice.

/** every refusal an edit came back with, unescaped — asserting on
 *  JSON.stringify would make a quoted field name unmatchable */
const why = (r: any) =>
  (r.failures ?? []).flatMap((f: any) => f.errors ?? []).join(' | ')

/** a task collection and a template page bound to it */
async function taskSite() {
  const s = await mcpSession()
  const task = (await s.call('create_collection', { name: 'task' })).collection
  await s.call('update_collection', {
    collectionId: task.id,
    addFields: [
      { name: 'status', type: 'select', options: ['todo', 'done'] },
      { name: 'done', type: 'boolean' },
      { name: 'points', type: 'number' },
    ],
  })
  await s.call('upsert_entries', {
    collectionId: task.id,
    entries: [{ name: 'One', values: { title: 'One', status: 'todo', done: 'false', points: '1' } }],
  })
  return { s, task }
}

/** the collection template page, where an entry IS in scope */
async function templatePage(s: any, task: any) {
  const pages = (await s.call('list_pages')).pages
  return pages.find((p: any) => p.isCollectionTemplate && p.name.toLowerCase().includes('task'))
}

test.describe('binding an action', () => {
  test('a set lands on the element and comes back with its binding id', async () => {
    const { s, task } = await taskSite()
    const tpl = await templatePage(s, task)
    await s.call('set_page_html', {
      pageId: tpl.id,
      html: pageHtml('<button data-ref="done"><span>Mark as done</span></button>'),
      version: tpl.version,
    })
    const page = await s.call('get_page', { pageId: tpl.id })
    const r = await s.call('edit_elements', {
      pageId: tpl.id,
      version: page.version,
      edits: [
        {
          ref: 'done',
          bindActions: [{ trigger: 'click', ops: [{ op: 'set', field: 'status', value: 'done' }] }],
        },
      ],
    })
    expect(r.saved).toBe(true)
    expect(r.bound[0].bindingIds).toHaveLength(1)

    const read = await s.call('get_page', { pageId: tpl.id, includeInteractions: true })
    const found = JSON.stringify(read)
    expect(found).toContain('"status"')
    expect(found).toContain('done')
  })

  test('toggle and increment are refused on a field of the wrong type', async () => {
    const { s, task } = await taskSite()
    const tpl = await templatePage(s, task)
    await s.call('set_page_html', {
      pageId: tpl.id,
      html: pageHtml('<button data-ref="b"><span>Go</span></button>'),
      version: tpl.version,
    })
    let page = await s.call('get_page', { pageId: tpl.id })
    const bad = await s.call('edit_elements', {
      pageId: tpl.id,
      version: page.version,
      edits: [{ ref: 'b', bindActions: [{ trigger: 'click', ops: [{ op: 'toggle', field: 'title' }] }] }],
    })
    expect(why(bad)).toContain('toggle flips a boolean')

    page = await s.call('get_page', { pageId: tpl.id })
    const bad2 = await s.call('edit_elements', {
      pageId: tpl.id,
      version: page.version,
      edits: [
        { ref: 'b', bindActions: [{ trigger: 'click', ops: [{ op: 'increment', field: 'status' }] }] },
      ],
    })
    expect(why(bad2)).toContain('increment adds to a number')
  })

  test('an unknown field is named, with the tool that lists the real ones', async () => {
    const { s, task } = await taskSite()
    const tpl = await templatePage(s, task)
    await s.call('set_page_html', {
      pageId: tpl.id,
      html: pageHtml('<button data-ref="b"><span>Go</span></button>'),
      version: tpl.version,
    })
    const page = await s.call('get_page', { pageId: tpl.id })
    const r = await s.call('edit_elements', {
      pageId: tpl.id,
      version: page.version,
      edits: [
        { ref: 'b', bindActions: [{ trigger: 'click', ops: [{ op: 'set', field: 'nope', value: 'x' }] }] },
      ],
    })
    expect(why(r)).toContain('no field "nope"')
    expect(why(r)).toContain('get_collection')
  })

  test('a select value outside the options is refused, because a page matches on the VALUE', async () => {
    const { s, task } = await taskSite()
    const tpl = await templatePage(s, task)
    await s.call('set_page_html', {
      pageId: tpl.id,
      html: pageHtml('<button data-ref="b"><span>Go</span></button>'),
      version: tpl.version,
    })
    const page = await s.call('get_page', { pageId: tpl.id })
    const r = await s.call('edit_elements', {
      pageId: tpl.id,
      version: page.version,
      edits: [
        {
          ref: 'b',
          bindActions: [{ trigger: 'click', ops: [{ op: 'set', field: 'status', value: 'shipped' }] }],
        },
      ],
    })
    expect(why(r)).toContain('not an option')
    expect(why(r)).toContain('todo, done')
  })

  test('with no entry in scope the write is refused, naming both ways out', async () => {
    const { s } = await taskSite()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<button data-ref="b"><span>Go</span></button>'),
      version: home.version,
    })
    const page = await s.call('get_page', { pageId: home.id })
    const r = await s.call('edit_elements', {
      pageId: home.id,
      version: page.version,
      edits: [
        { ref: 'b', bindActions: [{ trigger: 'click', ops: [{ op: 'set', field: 'status', value: 'done' }] }] },
      ],
    })
    expect(why(r)).toContain('no entry in scope')
    expect(why(r)).toContain('collection-list')
    expect(why(r)).toContain('entry:')
  })

  test('a row trigger inside a list IS in scope, and targets that row', async () => {
    const { s } = await taskSite()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(
        [
          '<collection-list data-ref="rows" source="task">',
          '  <div data-ref="row">',
          '    <input type="checkbox" data-ref="check" />',
          '  </div>',
          '</collection-list>',
        ].join('\n'),
      ),
      version: home.version,
    })
    const page = await s.call('get_page', { pageId: home.id })
    const r = await s.call('edit_elements', {
      pageId: home.id,
      version: page.version,
      edits: [{ ref: 'check', bindActions: [{ trigger: 'change', ops: [{ op: 'toggle', field: 'done' }] }] }],
    })
    expect(r.saved).toBe(true)
    expect(why(r)).not.toContain('no entry in scope')
  })

  test('a create with neither values nor a draft scope is refused as an empty entry', async () => {
    const { s } = await taskSite()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<button data-ref="b"><span>New</span></button>'),
      version: home.version,
    })
    const page = await s.call('get_page', { pageId: home.id })
    const r = await s.call('edit_elements', {
      pageId: home.id,
      version: page.version,
      edits: [{ ref: 'b', bindActions: [{ trigger: 'click', ops: [{ op: 'create', collection: 'task' }] }] }],
    })
    expect(why(r)).toContain('empty "task" entry')
    expect(why(r)).toContain('draft')
  })

  test('unbindActionIds removes it, and an unknown id is reported rather than ignored', async () => {
    const { s, task } = await taskSite()
    const tpl = await templatePage(s, task)
    await s.call('set_page_html', {
      pageId: tpl.id,
      html: pageHtml('<button data-ref="b"><span>Go</span></button>'),
      version: tpl.version,
    })
    let page = await s.call('get_page', { pageId: tpl.id })
    const bound = await s.call('edit_elements', {
      pageId: tpl.id,
      version: page.version,
      edits: [
        { ref: 'b', bindActions: [{ trigger: 'click', ops: [{ op: 'set', field: 'status', value: 'done' }] }] },
      ],
    })
    const id = bound.bound[0].bindingIds[0]

    page = await s.call('get_page', { pageId: tpl.id })
    const gone = await s.call('edit_elements', {
      pageId: tpl.id,
      version: page.version,
      edits: [{ ref: 'b', unbindActionIds: [id] }],
    })
    expect(gone.saved).toBe(true)

    page = await s.call('get_page', { pageId: tpl.id })
    const again = await s.call('edit_elements', {
      pageId: tpl.id,
      version: page.version,
      edits: [{ ref: 'b', unbindActionIds: [id] }],
    })
    expect(why(again)).toContain('no action binding')
  })
})

test.describe('a draft scope', () => {
  test('it is set and cleared by name, and a bad name is refused', async () => {
    const { s } = await taskSite()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<div data-ref="form"><input data-ref="title" /></div>'),
      version: home.version,
    })
    let page = await s.call('get_page', { pageId: home.id })
    const ok = await s.call('edit_elements', {
      pageId: home.id,
      version: page.version,
      edits: [{ ref: 'form', draft: 'newtask' }],
    })
    expect(ok.saved).toBe(true)

    page = await s.call('get_page', { pageId: home.id })
    const bad = await s.call('edit_elements', {
      pageId: home.id,
      version: page.version,
      edits: [{ ref: 'form', draft: 'New Task' }],
    })
    expect(why(bad)).toContain('not a scope name')

    page = await s.call('get_page', { pageId: home.id })
    const cleared = await s.call('edit_elements', {
      pageId: home.id,
      version: page.version,
      edits: [{ ref: 'form', draft: '' }],
    })
    expect(cleared.saved).toBe(true)
  })
})
