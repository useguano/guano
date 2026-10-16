import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
// @ts-expect-error untyped server module
import { exportSite } from '../server/export.mjs'

// Actions are the DATA engine: a prototype's "Mark as done" used to toggle a
// class and leave the status behind it untouched, so every such button was
// dead. These tests drive the real exported site in a real browser, so the
// emitted `ds` wire AND the runtime that consumes it are both under test.
//
// The acceptance shapes are the ones a project-management prototype needs:
// mark-as-done through a `data-[…]:` variant, a kanban card that migrates
// column, a draft scope that commits a new entry, and a route with no action
// that ships nothing at all.

const SITE = join(resolve(import.meta.dirname, '..', '.e2e-data'), 'site')

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  children: [],
  ...extra,
})

const TASK = {
  id: 'c-task',
  name: 'task',
  templatePageId: 'p-task',
  detailRoutes: true,
  fields: [
    { id: 'f-title', name: 'title', type: 'text' },
    { id: 'f-status', name: 'status', type: 'select', options: ['todo', 'doing', 'done'] },
    { id: 'f-points', name: 'points', type: 'number' },
    { id: 'f-done', name: 'done', type: 'boolean' },
  ],
  entries: [
    {
      id: 'e-nav',
      name: 'Nav',
      slug: 'responsive-nav',
      values: { title: 'Responsive nav', status: 'todo', points: '2', done: 'false' },
      status: 'published',
      createdAt: 1,
    },
    {
      id: 'e-two',
      name: 'Two',
      slug: 'second',
      values: { title: 'Second', status: 'todo', points: '1', done: 'false' },
      status: 'published',
      createdAt: 2,
    },
  ],
}

/** the task template route: an entry IS in scope, so ops need no `entry` */
const taskBody = {
  ...node('b-task', 'body'),
  children: [
    // the pill reads the status as an ATTRIBUTE, which is what lets a
    // data-[…]: variant restyle it without a second component
    node('n-pill', 'span', {
      htmlId: 'pill',
      fieldAttrs: { 'data-status': 'status' },
      content: 'Status',
    }),
    node('n-count', 'span', { htmlId: 'points', arg: 'points' }),
    {
      ...node('n-done', 'button', { htmlId: 'markDone' }),
      actions: [
        { id: 'a-done', trigger: 'click', ops: [{ op: 'set', field: 'status', value: 'done' }] },
      ],
      children: [node('n-done-t', 'span', { content: 'Mark as done' })],
    },
    {
      ...node('n-bump', 'button', { htmlId: 'bump' }),
      actions: [
        { id: 'a-bump', trigger: 'click', ops: [{ op: 'increment', field: 'points', by: 1 }] },
      ],
      children: [node('n-bump-t', 'span', { content: '+1' })],
    },
    {
      ...node('n-flip', 'button', { htmlId: 'flip' }),
      actions: [{ id: 'a-flip', trigger: 'click', ops: [{ op: 'toggle', field: 'done' }] }],
      children: [node('n-flip-t', 'span', { content: 'flip' })],
    },
    node('n-flag', 'span', { htmlId: 'flag', fieldAttrs: { 'data-done': 'done' } }),
  ],
}

/** one kanban column: a list filtered by status, whose rows advance their own */
const column = (status: string, next: string) => ({
  ...node(`col-${status}`, 'collection-list', {
    htmlId: `col-${status}`,
    arg: 'task',
    listQuery: { filter: { field: 'status', equals: status }, sortField: 'createdAt' },
  }),
  children: [
    {
      ...node(`card-${status}`, 'div'),
      children: [
        node(`card-t-${status}`, 'span', { arg: 'title' }),
        {
          ...node(`adv-${status}`, 'button'),
          actions: [
            {
              id: `a-adv-${status}`,
              trigger: 'click',
              ops: [{ op: 'set', field: 'status', value: next }],
            },
          ],
          children: [node(`adv-t-${status}`, 'span', { content: '>' })],
        },
      ],
    },
    {
      ...node(`empty-${status}`, 'list-empty'),
      children: [node(`empty-t-${status}`, 'span', { content: 'Nothing here' })],
    },
  ],
})

const boardBody = {
  ...node('b-board', 'body'),
  children: [
    column('todo', 'doing'),
    column('doing', 'done'),
    column('done', 'todo'),
    {
      ...node('n-draft', 'div', { htmlId: 'newtask', draft: 'newtask' }),
      children: [
        node('n-draft-in', 'input', { htmlId: 'draftTitle', arg: 'title' }),
        {
          ...node('n-draft-go', 'button', { htmlId: 'createTask' }),
          actions: [
            {
              id: 'a-create',
              trigger: 'click',
              ops: [
                { op: 'create', collection: 'task', from: 'newtask', values: { status: 'todo' } },
              ],
            },
          ],
          children: [node('n-draft-go-t', 'span', { content: 'Create task' })],
        },
      ],
    },
  ],
}

/** a route with no action anywhere — the control case */
const plainBody = {
  ...node('b-plain', 'body'),
  children: [node('n-plain', 'h1', { content: 'Plain' })],
}

function fixture(persist?: 'none' | 'session' | 'local') {
  return {
    schemaVersion: 2,
    pages: [
      { id: 'p-plain', name: 'Home', path: '/', status: 'published', elements: [plainBody] },
      { id: 'p-board', name: 'Board', path: '/board', status: 'published', elements: [boardBody] },
      {
        id: 'p-task',
        name: 'Task',
        path: '/task',
        status: 'published',
        collectionId: 'c-task',
        elements: [taskBody],
      },
    ],
    components: [],
    collections: [TASK],
    interactions: [],
    animations: [],
    breakpoints: [],
    comments: [],
    locales: ['en'],
    defaultLocale: 'en',
    settings: {
      publishing: { method: 'server', github: { repo: '', branch: '' } },
      seo: { siteName: 'State', titleTemplate: '%s', description: '' },
      domain: '',
      tokens: [],
      ...(persist ? { state: { persist } } : {}),
    },
  }
}

test.describe('client state on the published site', () => {
  test.beforeAll(async () => {
    await exportSite(fixture(), SITE)
  })

  test('a route with no action ships no store and no extra script', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    expect(html).not.toContain('/assets/state.js')
    expect(html).not.toContain('data-ds')
    // and the stateful one does
    const board = await readFile(join(SITE, 'board/index.html'), 'utf8')
    expect(board).toContain('/assets/state.js')
    expect(board).toContain('data-ds-list')
  })

  test('set moves a bound attribute, which is what a data-[…]: variant reads', async ({ page }) => {
    await page.goto('/task/responsive-nav?resetstate')
    const pill = page.locator('#pill')
    await expect(pill).toHaveAttribute('data-status', 'todo')
    await page.locator('#markDone').click()
    await expect(pill).toHaveAttribute('data-status', 'done')
  })

  test('increment and toggle write the shapes the CMS stores', async ({ page }) => {
    await page.goto('/task/responsive-nav?resetstate')
    await expect(page.locator('#points')).toHaveText('2')
    await page.locator('#bump').click()
    await page.locator('#bump').click()
    // "4", never 4 — a real number would stop a data-[points=4]: variant matching
    await expect(page.locator('#points')).toHaveText('4')

    await expect(page.locator('#flag')).toHaveAttribute('data-done', 'false')
    await page.locator('#flip').click()
    await expect(page.locator('#flag')).toHaveAttribute('data-done', 'true')
    await page.locator('#flip').click()
    await expect(page.locator('#flag')).toHaveAttribute('data-done', 'false')
  })

  test('a card migrates to the column whose filter now matches it', async ({ page }) => {
    await page.goto('/board?resetstate')
    const todo = page.locator('#col-todo')
    const doing = page.locator('#col-doing')
    await expect(todo).toContainText('Responsive nav')
    await expect(doing).toContainText('Nothing here')

    await todo.locator('button').first().click()
    await expect(doing).toContainText('Responsive nav')
    await expect(todo).not.toContainText('Responsive nav')

    // and AGAIN, from the row the runtime built — the regression this guards is
    // a built row whose trigger carried the template's entry, so the second
    // click rewrote the first card instead of this one
    await doing.locator('button').first().click()
    await expect(page.locator('#col-done')).toContainText('Responsive nav')
    await expect(doing).toContainText('Nothing here')
  })

  test('a draft scope commits a new entry, and clears itself', async ({ page }) => {
    await page.goto('/board?resetstate')
    await page.locator('#draftTitle').fill('Fresh task')
    await page.locator('#createTask').click()
    await expect(page.locator('#col-todo')).toContainText('Fresh task')
    await expect(page.locator('#draftTitle')).toHaveValue('')
  })

  test('emptying a column shows its empty block back', async ({ page }) => {
    await page.goto('/board?resetstate')
    const todo = page.locator('#col-todo')
    while ((await todo.locator('button').count()) > 0) {
      await todo.locator('button').first().click()
    }
    await expect(todo).toContainText('Nothing here')
  })

  test('the default session persistence carries a write across routes', async ({ page }) => {
    await page.goto('/task/responsive-nav?resetstate')
    await page.locator('#markDone').click()
    await expect(page.locator('#pill')).toHaveAttribute('data-status', 'done')

    // a second page LOAD — this is the one thing cross-route state has to do,
    // and it is why the persisted diff keys by real entry id rather than a
    // route-local ordinal
    await page.goto('/board')
    await expect(page.locator('#col-done')).toContainText('Responsive nav')
    await expect(page.locator('#col-todo')).not.toContainText('Responsive nav')
  })

  test('?resetstate forgets it, so a walkthrough starts from the top', async ({ page }) => {
    await page.goto('/task/responsive-nav?resetstate')
    await page.locator('#markDone').click()
    await expect(page.locator('#pill')).toHaveAttribute('data-status', 'done')
    await page.goto('/task/responsive-nav?resetstate')
    await expect(page.locator('#pill')).toHaveAttribute('data-status', 'todo')
  })
})

test.describe('persist: none', () => {
  test.beforeAll(async () => {
    await exportSite(fixture('none'), SITE)
  })

  test('a write is forgotten on the next load', async ({ page }) => {
    await page.goto('/task/responsive-nav?resetstate')
    await page.locator('#markDone').click()
    await expect(page.locator('#pill')).toHaveAttribute('data-status', 'done')
    await page.reload()
    await expect(page.locator('#pill')).toHaveAttribute('data-status', 'todo')
  })
})
