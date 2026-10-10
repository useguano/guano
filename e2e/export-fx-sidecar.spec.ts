import { test, expect } from '@playwright/test'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
// @ts-expect-error untyped server module
import { exportSite } from '../server/export.mjs'

// How the effects manifest is DELIVERED. The in-process MCP harness inlines the
// sidecar back into the html it hands a spec (so the content can be read from
// one string), which means nothing else proves the file is real — this does,
// against a directory on disk.
//
// Three things have to hold or the published page is dead:
//  1. the manifest is NOT in the html, which is the whole point of the change;
//  2. the sidecar is a `defer` script that comes BEFORE the runtimes, because
//     deferred scripts execute in document order and the runtimes read the
//     global it assigns — a fetch, or a tag after them, and nothing plays;
//  3. the file it names exists, and assigns that global.
//
// It also pins the content-addressed name: two routes with identical effects
// must share one file, and the hash is what puts it on the exported site's
// `immutable` cache tier (e2e/store-site-cache.spec.ts asserts that half).

// the served site dir, so the last test can drive the real page. smoke.spec.ts
// republishes afterwards, so clobbering it here is fine (same as site-motion)
const SITE = join(resolve(import.meta.dirname, '..', '.e2e-data'), 'site')

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  children: [],
  ...extra,
})

const SHOW = 'i-show'

/** `pages` with identical effects on two of the three routes */
function fixture() {
  const body = (id: string, ref: string) =>
    node(`${id}-body`, 'body', {
      children: [
        node(`${id}-btn`, 'button', {
          htmlId: 'btn',
          content: 'go',
          interactions: [
            { id: `${id}-b1`, interactionId: SHOW, trigger: 'click', targetId: `${id}-panel` },
          ],
        }),
        node(`${id}-panel`, 'div', { htmlId: 'panel', classes: 'hidden', content: ref }),
      ],
    })
  return {
    pages: [
      { id: 'p1', name: 'Home', path: '/', status: 'published', elements: [body('p1', 'one')] },
      { id: 'p2', name: 'Twin', path: '/twin', status: 'published', elements: [body('p2', 'one')] },
      // no effects at all: this route must reference no sidecar
      {
        id: 'p3',
        name: 'Bare',
        path: '/bare',
        status: 'published',
        elements: [node('p3-body', 'body', { children: [node('p3-t', 'h1', { content: 'bare' })] })],
      },
    ],
    components: [],
    collections: [],
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
      seo: { siteName: 'S', titleTemplate: '%s', description: '' },
      domain: '',
      tokens: [],
      customCode: { head: '' },
      fonts: { family: 'sans' },
    },
  }
}

const SIDECAR = /<script src="\/(assets\/fx-[0-9a-f]{8}\.js)" defer><\/script>/

test.describe('the effects manifest ships as a sidecar', () => {
  test.beforeAll(async () => {
    await exportSite(fixture(), SITE)
  })

  test('the html carries a reference, never the manifest', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    // the island it replaced is gone, and so is every attribute it replaced
    expect(html).not.toContain('application/json" id="guano-fx"')
    expect(html).not.toContain('"els":')
    for (const dead of ['data-int=', 'data-anim=', 'data-tgt=', 'data-atgt=']) {
      expect(html).not.toContain(dead)
    }
    // what it does carry is the handle and the reference
    expect(html).toContain('data-fx="0"')
    expect(SIDECAR.test(html)).toBe(true)
  })

  test('it is deferred and ordered BEFORE the runtime that reads it', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    const fx = html.indexOf(SIDECAR.exec(html)![0])
    const runtime = html.indexOf('<script src="/assets/script.js" defer></script>')
    expect(fx).toBeGreaterThan(-1)
    expect(runtime).toBeGreaterThan(-1)
    // deferred scripts run in document order, so this ordering IS the guarantee
    // that the global is set before the runtime looks for it
    expect(fx).toBeLessThan(runtime)
  })

  test('the file exists and assigns the global the runtimes read', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    const body = await readFile(join(SITE, SIDECAR.exec(html)![1]!), 'utf8')
    expect(body.startsWith('window.__guanoFx=')).toBe(true)
    const man = JSON.parse(body.slice(body.indexOf('=') + 1))
    expect(man.fx).toEqual({ s0: 'flex' })
    expect(man.rm).toEqual({ s0: 'hidden' })
    expect(man.els).toEqual([{ c: [{ t: 'click', k: 'k0', s: 's0' }] }, { t: ['s0'] }])
  })

  test('two routes with identical effects share one file, and a bare route has none', async () => {
    const home = await readFile(join(SITE, 'index.html'), 'utf8')
    const twin = await readFile(join(SITE, 'twin/index.html'), 'utf8')
    const bare = await readFile(join(SITE, 'bare/index.html'), 'utf8')

    // the name is a content hash, so the same manifest is the same file — which
    // is also what makes it safe to cache for a year
    expect(SIDECAR.exec(twin)![1]).toBe(SIDECAR.exec(home)![1])

    // a route with no effects references nothing and ships no runtime
    expect(SIDECAR.test(bare)).toBe(false)
    expect(bare).not.toContain('/assets/script.js')

    // exactly one sidecar on disk for the two routes that need it
    const written = (await readdir(join(SITE, 'assets'))).filter((f) => f.startsWith('fx-'))
    expect(written).toHaveLength(1)
  })

  test('the click still works on the published page', async ({ page }) => {
    // the delivery is only correct if the effect actually fires, so this drives
    // the real thing rather than trusting the bytes
    await page.goto('/')
    const panel = page.locator('#panel')
    await expect(panel).toHaveClass(/hidden/)
    await page.locator('#btn').click()
    await expect(panel).not.toHaveClass(/hidden/)
    await expect(panel).toHaveClass(/flex/)
  })
})
