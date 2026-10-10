import { test, expect, request as pwRequest } from '@playwright/test'

// What a visitor's browser is allowed to keep. The `server` publish method IS
// the host, so these headers are the published site's only caching story — and
// it had none at all: no `cache-control`, no `etag`, nothing to revalidate
// against, so every navigation re-downloaded script.js (24 KB), motion.js
// (17 KB), style.css (32 KB) and every image on the page.
//
// Two tiers, and the split is the whole contract: `assets/media/<sha>…` is
// content-addressed, so that URL can never mean anything else and is immutable
// for a year. Everything else keeps its name across a republish, so it must be
// revalidated or a publish would not be visible — which is what makes the
// 304 the load-bearing part rather than the ETag.
//
// API-level, bootstrapping its own admin like store-site-password, so it sorts
// after smoke.spec.ts and needs nothing else.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }

// a 1×1 png, so the export interns it under assets/media/<hash>
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

const snapshot = () => ({
  name: 'Cache Co',
  pages: [
    {
      id: 'p1',
      name: 'Home',
      path: '/',
      status: 'published',
      elements: [
        {
          id: 'b1',
          type: 'body',
          children: [
            { id: 'h1', type: 'h1', content: 'Cached', children: [] },
            { id: 'i1', type: 'image', src: PNG, children: [] },
          ],
        },
      ],
    },
  ],
  components: [], collections: [], interactions: [], animations: [], breakpoints: [], comments: [],
  locales: ['en'], defaultLocale: 'en',
  settings: {
    publishing: { method: 'server', github: { repo: '', branch: '' } },
    seo: { siteName: 'C', titleTemplate: '%s', description: '' },
    domain: '', tokens: [], customCode: { head: '' }, fonts: { family: 'sans' },
  },
})

// A publish is rate-limited to 12/min server-side and the suite exceeds that
// across its publishing specs, so this file publishes ONCE for all three tests
// (the same reason store-forms does). Nothing here needs a second one: the
// private-site test toggles the password, not the content.
let admin: Awaited<ReturnType<typeof pwRequest.newContext>>

test.beforeAll(async ({ baseURL }) => {
  admin = await pwRequest.newContext({ baseURL })
  const res = await admin.post('/api/auth/login', { data: ADMIN })
  if (!res.ok()) {
    expect(
      (await admin.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })).ok(),
    ).toBeTruthy()
  }
  expect((await admin.post('/api/published', { data: snapshot() })).ok()).toBeTruthy()
})

test('the published site is cacheable, and a content-addressed asset immutably so', async ({
  baseURL,
}) => {
  const visitor = await pwRequest.newContext({ baseURL })

  // the HTML keeps its name across a republish, so it is revalidated
  const page = await visitor.get('/')
  expect(page.status()).toBe(200)
  expect(page.headers()['cache-control']).toBe('no-cache')
  const pageTag = page.headers()['etag']
  expect(pageTag).toMatch(/^"[0-9a-f]{24}"$/)

  // …and the revalidation is answered with a 304, which is the point of the
  // ETag: without this the header costs a hash and saves nothing
  const again = await visitor.get('/', { headers: { 'if-none-match': pageTag! } })
  expect(again.status()).toBe(304)
  expect((await again.body()).length).toBe(0)
  expect(again.headers()['etag']).toBe(pageTag)

  // a changed ETag still gets the body
  const stale = await visitor.get('/', { headers: { 'if-none-match': '"0000000000000000000000ff"' } })
  expect(stale.status()).toBe(200)
  expect(await stale.text()).toContain('Cached')

  // the stylesheet is the same deal — named, so revalidated
  const css = await visitor.get('/assets/style.css')
  expect(css.status()).toBe(200)
  expect(css.headers()['cache-control']).toBe('no-cache')
  expect(css.headers()['etag']).toBeTruthy()

  // the interned image is addressed BY ITS HASH, so the URL can never mean
  // anything else: cache it for a year and never ask again
  const src = /<img[^>]*src="([^"]*assets\/media\/[^"]*)"/.exec(await stale.text())?.[1]
  expect(src).toBeTruthy()
  const media = await visitor.get(src!)
  expect(media.status()).toBe(200)
  expect(media.headers()['cache-control']).toBe('public, max-age=31536000, immutable')

  // nosniff survives on every tier — the cache headers are additive
  expect(media.headers()['x-content-type-options']).toBe('nosniff')
  expect(page.headers()['x-content-type-options']).toBe('nosniff')
})

test('a preview is never stored at all', async () => {
  const minted = await admin.post('/api/preview', { data: snapshot() })
  expect(minted.ok()).toBeTruthy()
  const { url } = (await minted.json()) as { url: string }

  // a preview renders DRAFTS. A stale draft in any cache is worse than a slow
  // one, so nothing about it is keepable — not even an ETag to revalidate.
  const previewCtx = await pwRequest.newContext()
  const page = await previewCtx.get(url)
  expect(page.status()).toBe(200)
  expect(page.headers()['cache-control']).toBe('no-store')
  expect(page.headers()['etag']).toBeUndefined()
  expect(page.headers()['x-robots-tag']).toContain('noindex')
})

test('a private site is never stored by a shared cache', async ({ baseURL }) => {
  const res = await admin.put('/api/site-password', { data: { enabled: true, password: 'letmein1' } })
  expect(await res.json()).toMatchObject({ enabled: true, passwordSet: true })

  const visitor = await pwRequest.newContext({ baseURL })
  const unlocked = await visitor.post('/_guano/unlock', {
    form: { password: 'letmein1', next: '/' },
    maxRedirects: 0,
  })
  expect(unlocked.status()).toBe(303)

  // the password is a real access control, so the page is the browser's to
  // keep and no intermediary's — `public` would let a proxy hand it to someone
  // who never typed it
  const page = await visitor.get('/')
  expect(page.status()).toBe(200)
  expect(page.headers()['cache-control']).toBe('private, no-cache')

  // even the immutable tier is scoped down
  const src = /<img[^>]*src="([^"]*assets\/media\/[^"]*)"/.exec(await page.text())?.[1]
  const media = await visitor.get(src!)
  expect(media.headers()['cache-control']).toBe('private, max-age=31536000, immutable')

  // put it back, so the shared instance is public for whatever runs next
  expect((await admin.put('/api/site-password', { data: { enabled: false } })).ok()).toBeTruthy()
})
