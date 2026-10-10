import { test, expect } from '@playwright/test'
import { classTriggers, wired, wiredById } from './fixtures/fxWire'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
// @ts-expect-error untyped server module
import { exportSite } from '../server/export.mjs'

// A binding's state key carries the ENTRY part only when its owner and its
// target share one entry scope (src/lib/shared/entryScope.js).
//
// Keyed off the trigger — as it was — a row button inside a :collection-list
// that opened ONE shared sheet outside the list wrote `X@e<row>` while the
// sheet, rendered once, listened on `X`. The key never matched, so the click
// silently did nothing, and the recipe GUIDE.md recommends ("ONE overlay per
// kind, outside the list") was unbuildable. edit_elements and publish both
// reported success, which is what made it expensive to find.
//
// Both halves are pinned here: the cross-repeat case must agree on one key, and
// the per-row case must still be independent per row.

const SITE = join(resolve(import.meta.dirname, '..', '.e2e-data'), 'site')

const SHOW = 'i-show'

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  children: [],
  ...extra,
})

const entry = (id: string, slug: string, title: string) => ({
  id,
  name: title,
  slug,
  status: 'published',
  values: { title },
})

function fixture() {
  return {
    pages: [
      {
        id: 'p1',
        name: 'Home',
        path: '/',
        status: 'published',
        elements: [
          node('body', 'body', {
            children: [
              node('list', 'collection-list', {
                arg: 'post',
                children: [
                  node('row', 'div', {
                    children: [
                      // opens the ONE shared sheet, which lives outside the list
                      node('rowOpen', 'button', {
                        content: 'Open sheet',
                        htmlId: 'row-open',
                        interactions: [
                          {
                            id: 'b-row-open',
                            interactionId: SHOW,
                            trigger: 'click',
                            targetId: 'sheet',
                            action: 'on',
                          },
                        ],
                      }),
                      // a per-ROW effect: must stay independent row to row
                      node('rowToggle', 'button', {
                        content: 'Expand',
                        interactions: [
                          {
                            id: 'b-row-toggle',
                            interactionId: SHOW,
                            trigger: 'click',
                            targetId: 'rowPanel',
                            action: 'on',
                          },
                        ],
                      }),
                      node('rowPanel', 'div', { classes: 'hidden', content: 'panel' }),
                    ],
                  }),
                ],
              }),
              node('sheet', 'div', {
                htmlId: 'sheet',
                classes: 'fixed top-0 left-0 h-32 w-32 hidden',
                children: [
                  node('sheetClose', 'button', {
                    content: 'Close',
                    htmlId: 'sheet-close',
                    interactions: [
                      {
                        id: 'b-sheet-close',
                        interactionId: SHOW,
                        trigger: 'click',
                        targetId: 'sheet',
                        action: 'off',
                      },
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
    components: [],
    collections: [
      {
        id: 'c1',
        name: 'post',
        slug: 'post',
        detailRoutes: false,
        templatePageId: '',
        fields: [{ id: 'f1', name: 'title', type: 'text' }],
        entries: [entry('e1', 'one', 'One'), entry('e2', 'two', 'Two')],
      },
    ],
    interactions: [
      { id: SHOW, name: 'Show', toClasses: 'flex', duration: 'duration-300', easing: 'ease-out' },
    ],
    animations: [],
    breakpoints: [],
    comments: [],
    locales: ['en'],
    defaultLocale: 'en',
    settings: {
      publishing: { method: 'server', github: { repo: '', branch: '' } },
      seo: { siteName: 'T', titleTemplate: '%s', description: '' },
      domain: '',
      smtp: {},
      integrations: { stripe: {}, mailing: {} },
      tokens: [],
      customCode: { head: '' },
      fonts: { family: 'sans' },
    },
  }
}

/** every class trigger on the page, in document order */
async function metas(html: string) {
  return classTriggers(html, SITE)
}

/** the state keys the element with this html id listens on */
function targetKeys(html: string, htmlId: string) {
  return wiredById(html, htmlId, SITE)?.t ?? []
}

test.describe('bindings across a collection-list boundary', () => {
  test.beforeAll(async () => {
    await exportSite(fixture(), SITE)
  })

  // The published keys are route-local ordinals (src/lib/shared/fxWire.js), so
  // these assert the RELATIONSHIP rather than a composed uuid — which is what
  // the bug was anyway: the row button wrote one key and the sheet listened on
  // another, so the click did nothing while every tool reported success.
  test('a row trigger and the shared sheet outside the list agree on one state key', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    const all = await metas(html)
    const listens = targetKeys(html, 'sheet')
    expect(listens).toHaveLength(1)
    const sheetKey = listens[0]!

    // the list repeated, so there are two row-open triggers, and BOTH key the
    // sheet's one effect: neither carries an entry scope, because the sheet
    // renders once, outside the repeat
    const opens = all.filter((m) => m.s === sheetKey && m.a === 'on')
    expect(opens).toHaveLength(2)

    // the close button inside the sheet keys that same effect
    const closes = all.filter((m) => m.a === 'off')
    expect(closes).toHaveLength(1)
    expect(closes[0]!.s).toBe(sheetKey)
  })

  test('a per-row effect stays independent row to row', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    // each repeat renders its own panel, and the two listen on DIFFERENT keys —
    // without the entry scope a hover on one card fires every row
    const sheetKey = targetKeys(html, 'sheet')[0]!
    const panels = wired(html, SITE).filter(({ fx }) => fx.t && !fx.t.includes(sheetKey))
    expect(panels).toHaveLength(2)
    const rowKeys = new Set(panels.flatMap(({ fx }) => fx.t!))
    expect(rowKeys.size).toBe(2)

    // and each row's trigger declares the key its own panel listens on
    const toggles = (await metas(html)).filter((m) => rowKeys.has(m.s))
    expect(toggles).toHaveLength(2)
    expect(new Set(toggles.map((m) => m.s))).toEqual(rowKeys)
  })

  test('the row button actually opens the sheet in the browser', async ({ page }) => {
    await page.goto('/')
    const sheet = page.locator('#sheet')
    await expect(sheet).toHaveClass(/hidden/)

    await page.locator('#row-open').first().click()
    await expect(sheet).not.toHaveClass(/hidden/)
    await expect(sheet).toHaveClass(/flex/)

    await page.locator('#sheet-close').click()
    await expect(sheet).toHaveClass(/hidden/)
  })
})
