import { test, expect, request as pwRequest } from '@playwright/test'
import { becomeBuilder } from './fixtures/session'

// 301s. The feature exists so that renaming a page does not cost the links
// other people made — so the one thing it must never cost is a PAGE: a rule
// whose source is a route that actually shipped is dropped at publish and
// reported, never served. That ordering is what lets the server answer the
// redirect BEFORE it looks for a file (a real 301, not the meta-refresh stub
// that static hosts get) with no way for a stale rule to shadow a live page.
//
// API-level, bootstrapping its own admin like store-site-cache, so it sorts
// after smoke.spec.ts and needs nothing else. One publish per test is over the
// 12/min limit across the suite, so this file publishes TWICE at most.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }

const page = (id: string, name: string, path: string) => ({
  id,
  name,
  path,
  status: 'published',
  elements: [
    {
      id: `${id}-b`,
      type: 'body',
      children: [{ id: `${id}-h`, type: 'h1', content: name, children: [] }],
    },
  ],
})

const snapshot = (redirects: { id: string; from: string; to: string }[], locales = ['en']) => ({
  name: 'Redirect Co',
  pages: [page('p1', 'Home', '/'), page('p2', 'Pricing', '/pricing')],
  components: [], collections: [], interactions: [], animations: [], breakpoints: [], comments: [],
  locales,
  defaultLocale: 'en',
  settings: {
    publishing: { method: 'server', github: { repo: '', branch: '' } },
    seo: { siteName: 'R', titleTemplate: '%s', description: '' },
    domain: '', tokens: [], customCode: { head: '' }, fonts: { family: 'sans' },
    redirects,
  },
})

let admin: Awaited<ReturnType<typeof pwRequest.newContext>>
let visitor: Awaited<ReturnType<typeof pwRequest.newContext>>

test.beforeAll(async ({ baseURL }) => {
  admin = await pwRequest.newContext({ baseURL })
  const res = await admin.post('/api/auth/login', { data: ADMIN })
  if (!res.ok()) {
    expect(
      (await admin.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })).ok(),
    ).toBeTruthy()
  }
  // A browser session is never a builder session: everything below needs
  // the kind the desktop app holds (→ e2e/fixtures/session.ts).
  await becomeBuilder(admin)
  // every redirect shape in one publish: a plain move, one shadowed by a real
  // page, one into nothing, and a chain
  const published = await admin.post('/api/published', {
    data: snapshot(
      [
        { id: 'r1', from: '/old-pricing', to: '/pricing' },
        { id: 'r2', from: '/pricing', to: '/elsewhere' },
        { id: 'r3', from: '/gone', to: '/nowhere' },
        { id: 'r4', from: '/ancient', to: '/old-pricing' },
      ],
      ['en', 'fr'],
    ),
  })
  expect(published.ok()).toBeTruthy()
  visitor = await pwRequest.newContext({ baseURL })
})

test('an old path answers with a 301 to the new one', async () => {
  const res = await visitor.get('/old-pricing', { maxRedirects: 0 })
  expect(res.status()).toBe(301)
  expect(res.headers()['location']).toBe('/pricing')
  // a bare 301 is cached by browsers indefinitely, so removing the rule later
  // would leave every visitor who followed it permanently stuck
  expect(res.headers()['cache-control']).toBe('no-cache')
  // and following it lands on the real page
  const followed = await visitor.get('/old-pricing')
  expect(followed.status()).toBe(200)
  expect(await followed.text()).toContain('Pricing')
})

test('the query string rides along', async () => {
  const res = await visitor.get('/old-pricing?utm_source=newsletter', { maxRedirects: 0 })
  expect(res.status()).toBe(301)
  expect(res.headers()['location']).toBe('/pricing?utm_source=newsletter')
})

test('a redirect answers on every locale route, not just the default', async () => {
  const res = await visitor.get('/fr/old-pricing', { maxRedirects: 0 })
  expect(res.status()).toBe(301)
  expect(res.headers()['location']).toBe('/fr/pricing')
})

test('a real page always wins over a redirect claiming its path', async () => {
  const res = await visitor.get('/pricing', { maxRedirects: 0 })
  expect(res.status()).toBe(200)
  expect(await res.text()).toContain('Pricing')
})

test('a chain is collapsed to one hop', async () => {
  const res = await visitor.get('/ancient', { maxRedirects: 0 })
  expect(res.status()).toBe(301)
  // never /old-pricing: two round trips for one rename is a tax on every
  // visitor, and crawlers discount a chain
  expect(res.headers()['location']).toBe('/pricing')
})

test('a static host gets a redirect stub for the same path', async () => {
  // the server answers the 301 before it ever looks for a file, so the stub is
  // only ever read by a zip/GitHub copy of site/ — but it has to BE there,
  // because site/ is what the zip ships
  const zip = await admin.post('/api/published?method=zip', { data: snapshot([{ id: 'r1', from: '/old-pricing', to: '/pricing' }]) })
  expect(zip.ok()).toBeTruthy()
  const body = await zip.body()
  // the stub's path and its meta refresh, read straight out of the archive
  const text = body.toString('latin1')
  expect(text).toContain('old-pricing/index.html')

  // and the live 301 still wins on this host
  const res = await visitor.get('/old-pricing', { maxRedirects: 0 })
  expect(res.status()).toBe(301)
})

test('removing the last redirect takes effect on the next publish', async () => {
  expect((await admin.post('/api/published', { data: snapshot([]) })).ok()).toBeTruthy()
  const res = await visitor.get('/old-pricing', { maxRedirects: 0 })
  expect(res.status()).toBe(404)
})
