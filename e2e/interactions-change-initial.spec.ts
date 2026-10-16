import { test, expect } from '@playwright/test'
import { join, resolve } from 'node:path'
// @ts-expect-error untyped server module
import { exportSite } from '../server/export.mjs'

// A `change` binding reflects its control's STATE, so it has to be read once at
// load and not only when something moves. A radio that ships `checked` fired
// nothing until you clicked elsewhere, so radio-driven tabs opened with every
// panel closed — the one arrangement the markup cannot be authored out of.

const SITE = join(resolve(import.meta.dirname, '..', '.e2e-data'), 'site')
const SHOW = 'i-show'

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  children: [],
  ...extra,
})

function fixture() {
  return {
    schemaVersion: 2,
    pages: [
      {
        id: 'p1',
        name: 'Home',
        path: '/',
        status: 'published',
        elements: [
          {
            ...node('b', 'body'),
            children: [
              // tab one ships CHECKED, so its panel must be open on arrival
              {
                ...node('r1', 'radio', {
                  htmlId: 'tab1',
                  attributes: { name: 'tabs', value: 'one', checked: '' },
                }),
                interactions: [
                  { id: 'bd1', interactionId: SHOW, trigger: 'change', targetId: 'panel1' },
                ],
              },
              {
                ...node('r2', 'radio', {
                  htmlId: 'tab2',
                  attributes: { name: 'tabs', value: 'two' },
                }),
                interactions: [
                  { id: 'bd2', interactionId: SHOW, trigger: 'change', targetId: 'panel2' },
                ],
              },
              node('panel1', 'div', { htmlId: 'panel1', classes: 'hidden' }),
              node('panel2', 'div', { htmlId: 'panel2', classes: 'hidden' }),
            ],
          },
        ],
      },
    ],
    components: [],
    collections: [],
    interactions: [{ id: SHOW, name: 'show', toClasses: 'block', duration: '150', easing: 'ease-out' }],
    animations: [],
    breakpoints: [],
    comments: [],
    locales: ['en'],
    defaultLocale: 'en',
    settings: {
      publishing: { method: 'server', github: { repo: '', branch: '' } },
      seo: { siteName: 'T', titleTemplate: '%s', description: '' },
      domain: '',
      tokens: [],
    },
  }
}

test.describe('a change binding reads its control at load', () => {
  test.beforeAll(async () => {
    await exportSite(fixture(), SITE)
  })

  test('a radio that ships checked opens its panel without a click', async ({ page }) => {
    await page.goto('/?resetstate')
    // THE regression: this used to be `hidden` until you clicked something else
    await expect(page.locator('#panel1')).toHaveClass(/block/)
    await expect(page.locator('#panel2')).not.toHaveClass(/block/)
  })

  test('and clicking the other tab still works', async ({ page }) => {
    await page.goto('/?resetstate')
    await page.locator('#tab2').check()
    await expect(page.locator('#panel2')).toHaveClass(/block/)
  })
})
