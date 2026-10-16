import { test, expect } from '@playwright/test'
import { join, resolve } from 'node:path'
// @ts-expect-error untyped
import { exportSite } from '../server/export.mjs'

const SITE = join(resolve(import.meta.dirname, '..', '.e2e-data'), 'site')
const n = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, children: [], ...extra })

function fixture() {
  return {
    schemaVersion: 2,
    pages: [{
      id: 'p1', name: 'Home', path: '/', status: 'published',
      elements: [{
        ...n('b', 'body'),
        children: [
          { ...n('open', 'button', { htmlId: 'open' }),
            interactions: [{ id: 'bd1', interactionId: 'i-sheet', trigger: 'click', targetId: 'sheet', closeOn: ['escape'] }],
            children: [n('ot', 'span', { content: 'Open' })] },
          n('sheet', 'div', { htmlId: 'sheet', classes: 'hidden fixed inset-y-0 left-0 w-64 bg-white' }),
        ],
      }],
    }],
    components: [], collections: [],
    interactions: [{ id: 'i-sheet', name: 'sheet', toClasses: 'block', duration: 'duration-200', easing: 'ease-out', scrim: true }],
    animations: [], breakpoints: [], comments: [], locales: ['en'], defaultLocale: 'en',
    settings: { publishing: { method: 'server', github: { repo: '', branch: '' } }, seo: { siteName: 'S', titleTemplate: '%s', description: '' }, domain: '', tokens: [] },
  }
}

test.describe('a scrim', () => {
  test.beforeAll(async () => { await exportSite(fixture(), SITE) })

  test('its classes reach the stylesheet', async ({ page }) => {
    await page.goto('/')
    const css = await page.request.get('/assets/style.css').then((r) => r.text())
    expect(css).toContain('bg-black\\/50')
  })

  test('it appears behind the sheet and a click on it closes both', async ({ page }) => {
    await page.goto('/?resetstate')
    expect(await page.locator('[data-guano-scrim]').count()).toBe(0)

    await page.locator('#open').click()
    const scrim = page.locator('[data-guano-scrim]')
    await expect(scrim).toHaveCount(1)
    await expect(scrim).toHaveClass(/opacity-100/)
    await expect(page.locator('#sheet')).toHaveClass(/block/)
    // the sheet is the scrim's NEXT sibling — the target sits above the backdrop
    const after = await scrim.evaluate((el) => el.nextElementSibling?.id ?? '')
    expect(after).toBe('sheet')

    // well clear of the sheet, which is `left-0 w-64` and legitimately on top
    await scrim.click({ position: { x: 600, y: 300 } })
    await expect(page.locator('#sheet')).not.toHaveClass(/block/)
    await expect(scrim).toHaveClass(/opacity-0/)
  })

  test('Escape closes it too', async ({ page }) => {
    await page.goto('/?resetstate')
    await page.locator('#open').click()
    await expect(page.locator('[data-guano-scrim]')).toHaveClass(/opacity-100/)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-guano-scrim]')).toHaveClass(/opacity-0/)
  })
})
