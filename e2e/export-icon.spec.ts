import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
// server + shared modules under test — plain ESM, safe to import into the runner
// @ts-expect-error untyped server module
import { exportSite } from '../server/export.mjs'
import { lucideSvg, sanitizeInlineSvg } from '../src/lib/shared/svg.js'
import { LUCIDE_ICONS } from '../src/lib/shared/lucideIcons.js'

// The `:icon:` element inlines SVG markup into the page. An uploaded SVG file is
// only ever an <img> (script cannot run there) behind a no-script CSP; inlined
// markup has neither protection, so the exporter is the line that has to hold.
// These tests drive the real exporter, and a real browser for the part that
// only a browser can answer: does the icon follow the text colour?
//
// The fixture is exported into the e2e data dir's site/ (smoke.spec.ts
// republishes it afterwards, so clobbering it here is fine).

const SITE = join(resolve(import.meta.dirname, '..', '.e2e-data'), 'site')

// stored as an agent, an import or a merge could have left it: NOT sanitized
const HOSTILE =
  '<svg viewBox="0 0 24 24" onload="window.__pwned=1"><script>window.__pwned=1</script>' +
  '<foreignObject><img src=x onerror="window.__pwned=1"></foreignObject>' +
  '<a href="javascript:window.__pwned=1"><circle cx="1" cy="1" r="1"/></a>' +
  '<rect id="kept" width="4" height="4" fill="#ff0000" style="fill:url(https://evil.example/x)"/></svg>'

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  children: [],
  ...extra,
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
              node('btn', 'button', {
                htmlId: 'btn',
                classes: 'inline-flex items-center gap-2 text-red-500',
                children: [
                  node('arrow', 'icon', {
                    htmlId: 'arrow',
                    classes: 'size-4',
                    svg: lucideSvg('arrow-right', LUCIDE_ICONS['arrow-right']),
                  }),
                  node('label', 'span', { content: 'Next' }),
                ],
              }),
              node('hostile', 'icon', { htmlId: 'hostile', svg: HOSTILE }),
              node('empty', 'icon', { htmlId: 'empty' }),
              node('labelled', 'icon', {
                htmlId: 'labelled',
                svg: lucideSvg('x', LUCIDE_ICONS.x),
                attributes: { 'aria-label': 'Close' },
              }),
            ],
          }),
        ],
      },
    ],
    components: [],
    collections: [],
    interactions: [],
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

const tagOf = (html: string, id: string) =>
  new RegExp(`<svg[^>]*id="${id}"[^>]*>[\\s\\S]*?</svg>`).exec(html)![0]!

test.describe('the icon element', () => {
  test.beforeAll(async () => {
    await exportSite(fixture(), SITE)
  })

  test('an icon is an inline svg carrying its own classes', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    const arrow = tagOf(html, 'arrow')
    expect(arrow).toContain('class="size-4"')
    expect(arrow).toContain('viewBox="0 0 24 24"')
    expect(arrow).toContain('stroke="currentColor"')
    expect(arrow).toContain('data-icon="lucide:arrow-right"')
    expect(arrow).toContain('<path')
    // inside the button, beside its words — the point of the whole change
    expect(html).toMatch(/<button[^>]*id="btn"[^>]*><svg[\s\S]*?<\/svg><span[^>]*>Next<\/span><\/button>/)
  })

  test('markup stored unsanitized is sanitized on the way out', async ({ page }) => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    const hostile = tagOf(html, 'hostile')
    for (const vector of ['script', 'onload', 'onerror', 'foreignObject', 'javascript', 'href', 'style', 'evil', '<img', '<a']) {
      expect(hostile, vector).not.toContain(vector)
    }
    // what was safe survives, recoloured to follow the text
    expect(hostile).toContain('<rect id="kept" width="4" height="4" fill="currentColor"/>')

    await page.goto('/')
    await expect(page.locator('#hostile')).toBeAttached()
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined()
  })

  test('the icon follows the text colour of what holds it', async ({ page }) => {
    await page.goto('/')
    const colours = await page.evaluate(() => ({
      button: getComputedStyle(document.querySelector('#btn')!).color,
      stroke: getComputedStyle(document.querySelector('#arrow path')!).stroke,
    }))
    expect(colours.stroke).toBe(colours.button)
    // and takes its size from its class, not from the markup's 24px
    const box = await page.locator('#arrow').boundingBox()
    expect(box!.width).toBe(16)
  })

  test('an icon with nothing picked still renders, and an author attribute wins', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    expect(tagOf(html, 'empty')).toContain('<circle')
    const labelled = tagOf(html, 'labelled')
    expect(labelled).toContain('aria-label="Close"')
    expect(labelled.match(/aria-label=/g)!).toHaveLength(1)
  })

  test('the sanitizer is idempotent, and every bundled icon survives it whole', () => {
    const once = sanitizeInlineSvg(HOSTILE)
    expect(sanitizeInlineSvg(once)).toBe(once)
    for (const [name, inner] of Object.entries(LUCIDE_ICONS)) {
      expect(lucideSvg(name, inner), name).toContain(inner)
    }
  })
})
