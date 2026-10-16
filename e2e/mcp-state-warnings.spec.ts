import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'

// Every warning here is a shape the WRITE path accepts — a blob can arrive by
// import, by a 3-way merge or from an agent that never passed a validator — and
// whose failure mode on the published page is a control that does nothing.

/** write a project blob behind the toolset, the way an import or a merge does */
async function withBlob(mutate: (p: any) => void) {
  const s = await mcpSession()
  const task = (await s.call('create_collection', { name: 'task', detailRoutes: false }))
    .collection
  await s.call('update_collection', {
    collectionId: task.id,
    addFields: [{ name: 'status', type: 'select', options: ['todo', 'done'] }],
  })
  const home = await s.home()
  await s.call('set_page_html', {
    pageId: home.id,
    html: pageHtml('<div data-ref="box"><button data-ref="b"><span>Go</span></button></div>'),
    version: home.version,
  })
  const blob = s.stored()
  mutate(blob)
  s.writeStore('guano-project:main', JSON.stringify(blob))
  return s
}

/** the button node in the seeded page */
const buttonOf = (blob: any) => {
  let found: any = null
  const walk = (nodes: any[]) => {
    for (const n of nodes ?? []) {
      if (n.type === 'button') found = n
      walk(n.children)
    }
  }
  walk(blob.pages[0].elements)
  return found
}

const boxOf = (blob: any) => {
  let found: any = null
  const walk = (nodes: any[]) => {
    for (const n of nodes ?? []) {
      if (n.type === 'div' && !found) found = n
      walk(n.children)
    }
  }
  walk(blob.pages[0].elements)
  return found
}

test('an op with no entry in scope is reported, not shipped', async () => {
  const s = await withBlob((blob) => {
    buttonOf(blob).actions = [
      { id: 'a1', trigger: 'click', ops: [{ op: 'set', field: 'status', value: 'done' }] },
    ]
  })
  expect(await s.kinds()).toContain('action-target-unresolved')
})

test('a create with neither values nor a draft scope is reported', async () => {
  const s = await withBlob((blob) => {
    buttonOf(blob).actions = [
      { id: 'a1', trigger: 'click', ops: [{ op: 'create', collection: 'task' }] },
    ]
  })
  expect(await s.kinds()).toContain('action-create-empty')
})

test('a draft scope nothing commits is reported — what a visitor types goes nowhere', async () => {
  const s = await withBlob((blob) => {
    boxOf(blob).draft = 'newtask'
  })
  expect(await s.kinds()).toContain('action-draft-uncommitted')
})

test('a draft scope WITH a create pointing at it is not reported', async () => {
  const s = await withBlob((blob) => {
    boxOf(blob).draft = 'newtask'
    buttonOf(blob).actions = [
      {
        id: 'a1',
        trigger: 'click',
        ops: [{ op: 'create', collection: 'task', from: 'newtask' }],
      },
    ]
  })
  const kinds = await s.kinds()
  expect(kinds).not.toContain('action-draft-uncommitted')
  expect(kinds).not.toContain('action-create-empty')
})

test('persistence set to local with no action anywhere is reported', async () => {
  const s = await withBlob((blob) => {
    blob.settings.state = { persist: 'local' }
  })
  expect(await s.kinds()).toContain('state-persistence-unused')
})

test('the default session persistence on a stateless site is NOT reported', async () => {
  const s = await withBlob(() => {})
  expect(await s.kinds()).not.toContain('state-persistence-unused')
})
