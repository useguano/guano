import { test, expect } from '@playwright/test'
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

/** every data-int meta on the page, in document order */
async function metas(html: string) {
  const out: { t: string; k: string; s: string; a?: string }[] = []
  for (const m of html.matchAll(/data-int="([^"]*)"/g)) {
    const json = m[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&')
    out.push(...JSON.parse(json))
  }
  return out
}

/** the state keys a [data-tgt] element listens on */
function targetKeys(html: string, htmlId: string) {
  const el = new RegExp(`<[^>]*id="${htmlId}"[^>]*>`).exec(html)?.[0] ?? ''
  const tgt = /data-tgt="([^"]*)"/.exec(el)?.[1] ?? ''
  return tgt.replaceAll('&amp;', '&').split(' ').filter(Boolean)
}

test.describe('bindings across a collection-list boundary', () => {
  test.beforeAll(async () => {
    await exportSite(fixture(), SITE)
  })

  test('a row trigger and the shared sheet outside the list agree on one state key', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    const all = await metas(html)

    // the list repeated, so there are two row-open triggers
    const opens = all.filter((m) => m.a === 'on' && m.s.startsWith(`${SHOW}:sheet`))
    expect(opens).toHaveLength(2)

    // neither carries an entry scope: the sheet renders once, outside the repeat
    for (const m of opens) expect(m.s).toBe(`${SHOW}:sheet`)

    // the close button inside the sheet keys the same effect
    const close = all.find((m) => m.a === 'off')!
    expect(close.s).toBe(`${SHOW}:sheet`)

    // and the sheet itself listens on exactly that key — this is the match that
    // used to fail
    expect(targetKeys(html, 'sheet')).toContain(`${SHOW}:sheet`)
  })

  test('a per-row effect stays independent row to row', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    const toggles = (await metas(html)).filter((m) => m.s.startsWith(`${SHOW}:rowPanel`))
    expect(toggles).toHaveLength(2)
    // one key per entry, never shared
    const keys = new Set(toggles.map((m) => m.s))
    expect(keys).toEqual(new Set([`${SHOW}:rowPanel@ee1`, `${SHOW}:rowPanel@ee2`]))
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
