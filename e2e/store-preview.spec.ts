import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'

// POST /api/preview renders the posted snapshot to its OWN site, on its own
// port, and touches nothing live.
//
// Without it publishing was the only way to render anything, so the Cocoapp
// review session published six of its seven times purely to look — each one
// replacing the live origin with a half-built draft. The preview also includes
// DRAFT pages, which a publish drops and which are exactly what you need to see
// while building.
//
// API-level spec: bootstraps its own admin like store-roles, so it does not
// depend on ordering beyond sorting after smoke.spec.ts.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }

const login = (ctx: APIRequestContext, creds = ADMIN) =>
  ctx.post('/api/auth/login', { data: creds })

/** a two-page project: one published, one draft */
const snapshot = () => ({
  name: 'Preview Co',
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
          children: [{ id: 'h1', type: 'h1', content: 'Live home', children: [] }],
        },
      ],
    },
    {
      id: 'p2',
      name: 'Draft',
      path: '/draft',
      status: 'draft',
      elements: [
        {
          id: 'b2',
          type: 'body',
          children: [{ id: 'h2', type: 'h1', content: 'Work in progress', children: [] }],
        },
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
    seo: { siteName: 'P', titleTemplate: '%s', description: '' },
    domain: '',
    smtp: {},
    integrations: { stripe: {}, mailing: {} },
    tokens: [],
    customCode: { head: '' },
    fonts: { family: 'sans' },
  },
})

test('a preview renders to its own site, includes drafts, and leaves the live one alone', async ({
  baseURL,
}) => {
  const admin = await pwRequest.newContext({ baseURL })
  let res = await login(admin)
  if (!res.ok()) {
    res = await admin.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })
    expect(res.ok()).toBeTruthy()
  }

  // what the live site says now, so we can prove the preview did not touch it
  const liveBefore = await (await admin.get('/')).text()

  res = await admin.post('/api/preview', { data: snapshot() })
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { routes: number; bytes: number; url: string }
  expect(body.routes).toBe(2) // the draft is rendered too
  // the url now carries a one-time access token (see below)
  expect(body.url).toMatch(/^http:\/\/[^/]+:\d+\/\?t=\d+\.[a-f0-9]{64}$/)

  // the preview answers on its own port. Opening the link the editor was
  // handed trades the token for a cookie, which the page's own asset requests
  // then carry.
  const previewCtx = await pwRequest.newContext({ baseURL: body.url.split('?')[0] })
  expect((await previewCtx.get(body.url)).ok()).toBeTruthy()
  const home = await previewCtx.get('/')
  expect(home.ok()).toBeTruthy()
  expect(await home.text()).toContain('Live home')
  // unfinished work is never indexed
  expect(home.headers()['x-robots-tag']).toContain('noindex')

  // the DRAFT page renders here, which a publish would have dropped
  const draft = await previewCtx.get('/draft/')
  expect(draft.ok()).toBeTruthy()
  expect(await draft.text()).toContain('Work in progress')

  // the editor is not reachable from the preview port
  expect((await previewCtx.get('/admin/')).status()).toBe(404)
  expect((await previewCtx.get('/api/preview')).status()).toBe(404)

  // and the live site is exactly as it was
  expect(await (await admin.get('/')).text()).toBe(liveBefore)

  await previewCtx.dispose()
  await admin.dispose()
})

test('a preview needs a session', async ({ baseURL }) => {
  const anon = await pwRequest.newContext({ baseURL })
  const res = await anon.post('/api/preview', { data: snapshot() })
  expect(res.status()).toBe(401)
  await anon.dispose()
})

/**
 * The preview port is not a public mirror of unpublished work.
 *
 * It binds every interface and authenticated nothing, so on any host without a
 * firewall in front of it every draft page was readable by anyone who guessed
 * the port — the one surface in the product that renders work explicitly not
 * ready to ship. A session cookie cannot be the credential, because it is
 * Secure by default and the preview is plain HTTP on another port, so in the
 * hosted setup the browser would never send it. Hence a signed token in the
 * URL the editor is handed, traded for a cookie scoped to the preview.
 */
test('the preview port is reachable only from the editor', async ({ baseURL }) => {
  const admin = await pwRequest.newContext({ baseURL })
  let res = await login(admin)
  if (!res.ok()) {
    res = await admin.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })
    expect(res.ok()).toBeTruthy()
  }
  res = await admin.post('/api/preview', { data: snapshot() })
  expect(res.ok()).toBeTruthy()
  const { url } = (await res.json()) as { url: string }
  const origin = url.split('?')[0]!

  // cold, with no token and no cookie
  const stranger = await pwRequest.newContext({ baseURL: origin })
  const cold = await stranger.get('/')
  expect(cold.status()).toBe(401)
  expect(await cold.text()).toContain('preview link missing or expired')
  // ...including the assets, or the markup would leak through a stylesheet
  expect((await stranger.get('/assets/style.css')).status()).toBe(401)
  // ...and a draft route, which is the content that matters here
  expect((await stranger.get('/draft/')).status()).toBe(401)
  // a forged token is not enough
  expect((await stranger.get(`/?t=${Date.now() + 60_000}.${'0'.repeat(64)}`)).status()).toBe(401)
  // nor is an expired one, however well signed it was
  expect((await stranger.get('/?t=1.' + '0'.repeat(64))).status()).toBe(401)

  // the editor's own link works, and leaves a cookie behind that the page's
  // asset requests ride on
  const visitor = await pwRequest.newContext({ baseURL: origin })
  const opened = await visitor.get(url)
  expect(opened.ok()).toBeTruthy()
  expect(await opened.text()).toContain('Live home')

  // ...and the token hit serves the page DIRECTLY, with the cookie on that
  // same response. It used to 303 to the bare path, which a client without a
  // cookie jar (curl, fetch, an MCP agent) followed cookieless into the 401 —
  // so the `preview` tool's "open the url and look" could never be done by
  // the agent itself.
  const cookieless = await pwRequest.newContext({ baseURL: origin })
  const direct = await cookieless.get(url, { maxRedirects: 0 })
  expect(direct.status()).toBe(200)
  expect(await direct.text()).toContain('Live home')
  expect(direct.headers()['set-cookie']).toContain('guano_preview=')
  expect(direct.headers()['cache-control']).toContain('no-store')
  // a token on a deeper route serves THAT route, not the home page
  const token = url.split('?t=')[1]
  const deep = await cookieless.get(`/draft/?t=${token}`, { maxRedirects: 0 })
  expect(deep.status()).toBe(200)

  // a '/' or a '#anchor' AFTER the token value is trimmed before the mac is
  // compared. The link gets pasted, hand-edited and appended to — the MCP tool
  // itself shipped one with the route glued onto the end of the token — and a
  // 401 reading "missing or expired" is the least useful answer to a character
  // of punctuation. The signature still has to verify, so the last probe is a
  // token with a real character added.
  //
  // Each probe gets its OWN context: a request that succeeds leaves the
  // `guano_preview` cookie in the one it was made from, and every later probe
  // from there is unlocked by the cookie whatever its token says — which would
  // make all three of these pass without reading the token at all.
  const probe = async (path: string) => {
    const ctx = await pwRequest.newContext({ baseURL: origin })
    try {
      return (await ctx.get(path, { maxRedirects: 0 })).status()
    } finally {
      await ctx.dispose()
    }
  }
  expect(await probe(`/?t=${token}/`)).toBe(200)
  expect(await probe(`/?t=${token}%23editor`)).toBe(200)
  expect(await probe(`/?t=${token}x`)).toBe(401)
  await cookieless.dispose()
  expect((await visitor.get('/assets/style.css')).ok()).toBeTruthy()
  expect((await visitor.get('/draft/')).ok()).toBeTruthy()

  // the editor and the API stay unreachable from here, cookie or not
  expect((await visitor.get('/admin/')).status()).toBe(404)
  expect((await visitor.get('/api/preview')).status()).toBe(404)

  await stranger.dispose()
  await visitor.dispose()
  await admin.dispose()
})
