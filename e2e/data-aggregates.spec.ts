import { test, expect } from '@playwright/test'
import { join, resolve } from 'node:path'
// @ts-expect-error untyped
import { exportSite } from '../server/export.mjs'

const SITE = join(resolve(import.meta.dirname, '..', '.e2e-data'), 'site')
const n = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, children: [], ...extra })

const TASK = {
  id: 'c-task', name: 'task', templatePageId: '', detailRoutes: false,
  fields: [
    { id: 'f1', name: 'title', type: 'text' },
    { id: 'f2', name: 'status', type: 'select', options: ['todo', 'done'] },
    { id: 'f3', name: 'points', type: 'number' },
  ],
  entries: [
    { id: 'e1', name: 'A', slug: 'a', values: { title: 'A', status: 'todo', points: '3' }, status: 'published', createdAt: 1 },
    { id: 'e2', name: 'B', slug: 'b', values: { title: 'B', status: 'todo', points: '4' }, status: 'published', createdAt: 2 },
    { id: 'e3', name: 'C', slug: 'c', values: { title: 'C', status: 'done', points: '5' }, status: 'published', createdAt: 3 },
  ],
}

const column = (status: string, next: string) => ({
  ...n(`col-${status}`, 'div', { htmlId: `wrap-${status}` }),
  children: [
    n(`h-${status}`, 'span', {
      htmlId: `count-${status}`,
      arg: '@count:task',
      listQuery: { filter: { field: 'status', equals: status } },
    }),
    {
      ...n(`list-${status}`, 'collection-list', {
        htmlId: `col-${status}`,
        arg: 'task',
        listQuery: { filter: { field: 'status', equals: status }, sortField: 'createdAt' },
      }),
      children: [
        { ...n(`card-${status}`, 'div'), children: [
          n(`t-${status}`, 'span', { arg: 'title' }),
          { ...n(`b-${status}`, 'button'),
            actions: [{ id: `a-${status}`, trigger: 'click', ops: [{ op: 'set', field: 'status', value: next }] }],
            children: [n(`bt-${status}`, 'span', { content: '>' })] },
        ] },
        { ...n(`e-${status}`, 'list-empty'), children: [n(`et-${status}`, 'span', { content: 'none' })] },
      ],
    },
  ],
})

function fixture() {
  return {
    schemaVersion: 2,
    pages: [{ id: 'p1', name: 'Board', path: '/', status: 'published', elements: [{
      ...n('b', 'body'),
      children: [
        column('todo', 'done'),
        column('done', 'todo'),
        n('sum', 'span', { htmlId: 'sum', arg: '@sum:task.points' }),
        n('avg', 'span', { htmlId: 'avg', arg: '@avg:task.points' }),
        n('all', 'span', { htmlId: 'all', arg: '@count:task' }),
      ],
    }] }],
    components: [], collections: [TASK], interactions: [], animations: [],
    breakpoints: [], comments: [], locales: ['en'], defaultLocale: 'en',
    settings: { publishing: { method: 'server', github: { repo: '', branch: '' } }, seo: { siteName: 'B', titleTemplate: '%s', description: '' }, domain: '', tokens: [] },
  }
}

test.describe('aggregates', () => {
  test.beforeAll(async () => { await exportSite(fixture(), SITE) })

  test('they render at publish time', async ({ page }) => {
    await page.goto('/?resetstate')
    await expect(page.locator('#count-todo')).toHaveText('2')
    await expect(page.locator('#count-done')).toHaveText('1')
    await expect(page.locator('#all')).toHaveText('3')
    await expect(page.locator('#sum')).toHaveText('12')
    await expect(page.locator('#avg')).toHaveText('4')
  })

  test('a column header follows the card that just left it', async ({ page }) => {
    await page.goto('/?resetstate')
    await page.locator('#col-todo button').first().click()
    // the whole point: the count is a property of the LIST, so moving a card
    // has to move both the column and its header
    await expect(page.locator('#count-todo')).toHaveText('1')
    await expect(page.locator('#count-done')).toHaveText('2')
    // totals that span every status do not move
    await expect(page.locator('#all')).toHaveText('3')
    await expect(page.locator('#sum')).toHaveText('12')
  })
})
