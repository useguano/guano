import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'

// POST /api/preview renders the posted snapshot to its OWN site, served by the
// same server under /_guano/preview, and touches nothing live.
//
// It used to be a second HTTP server on PORT+1, which bound every interface,
// spoke plain HTTP while the studio is HTTPS, and behind a proxy or on a VPS
// was simply unreachable — so the `preview` tool handed back a url that hangs
// and the workflow it exists for could never run. One origin fixes that; the
// signed token stays, because an agent's browser has no Guano session.
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
/** where the preview is served on the studio's own origin */
const MOUNT = '/_guano/preview'

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

test('a preview renders under the mount, includes drafts, and leaves the live one alone', async ({
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
  const body = (await res.json()) as {
    routes: number
    bytes: number
    url: string
    routeUrls?: string[]
  }
  expect(body.routes).toBe(2) // the draft is rendered too
  // the studio's own origin, under the mount, with a one-time access token
  expect(body.url).toMatch(/^http:\/\/[^/]+\/_guano\/preview\/\?t=\d+\.[a-f0-9]{64}$/)

  // every route, so an agent navigates straight to a page instead of hunting
  // for a link to click
  expect(body.routeUrls).toEqual(
    expect.arrayContaining([expect.stringContaining('/_guano/preview/draft')]),
  )
  expect(body.routeUrls!.every((u) => u.includes('?t='))).toBe(true)

  // Opening the link the editor was handed trades the token for a cookie,
  // which the page's own asset requests then carry.
  const previewCtx = await pwRequest.newContext({ baseURL })
  expect((await previewCtx.get(body.url)).ok()).toBeTruthy()
  const home = await previewCtx.get(`${MOUNT}/`)
  expect(home.ok()).toBeTruthy()
  expect(await home.text()).toContain('Live home')
  // unfinished work is never indexed
  expect(home.headers()['x-robots-tag']).toContain('noindex')

  // the exported URLs were moved onto the mount, or every asset on the page
  // would 404 against the LIVE site's assets
  expect(await home.text()).toContain(`${MOUNT}/assets/`)

  // the DRAFT page renders here, which a publish would have dropped
  const draft = await previewCtx.get(`${MOUNT}/draft/`)
  expect(draft.ok()).toBeTruthy()
  expect(await draft.text()).toContain('Work in progress')

  // a bare mount keeps its trailing slash, or the browser resolves every
  // relative URL one directory up
  const bare = await previewCtx.get(MOUNT, { maxRedirects: 0 })
  expect(bare.status()).toBe(302)
  expect(bare.headers()['location']).toBe(`${MOUNT}/`)

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
 * The preview is not a public mirror of unpublished work.
 *
 * It renders work explicitly not ready to ship, so reaching it cold must not
 * work. The signed token in the url the editor is handed is the gate, traded on
 * first hit for a cookie scoped to the mount — and it stays even now that the
 * session cookie could reach here, because the agent's BROWSER is a different
 * profile with no Guano session at all. A session-only gate would mean the one
 * workflow this exists for is the one that cannot run.
 */
test('the preview is reachable only with the token the editor was handed', async ({ baseURL }) => {
  const admin = await pwRequest.newContext({ baseURL })
  let res = await login(admin)
  if (!res.ok()) {
    res = await admin.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })
    expect(res.ok()).toBeTruthy()
  }
  res = await admin.post('/api/preview', { data: snapshot() })
  expect(res.ok()).toBeTruthy()
  const { url } = (await res.json()) as { url: string }

  // cold, with no token and no cookie
  const stranger = await pwRequest.newContext({ baseURL })
  const cold = await stranger.get(`${MOUNT}/`)
  expect(cold.status()).toBe(401)
  expect(await cold.text()).toContain('preview link missing or expired')
  // ...including the assets, or the markup would leak through a stylesheet
  expect((await stranger.get(`${MOUNT}/assets/style.css`)).status()).toBe(401)
  // ...and a draft route, which is the content that matters here
  expect((await stranger.get(`${MOUNT}/draft/`)).status()).toBe(401)
  // a forged token is not enough
  expect(
    (await stranger.get(`${MOUNT}/?t=${Date.now() + 60_000}.${'0'.repeat(64)}`)).status(),
  ).toBe(401)
  // nor is an expired one, however well signed it was
  expect((await stranger.get(`${MOUNT}/?t=1.` + '0'.repeat(64))).status()).toBe(401)

  // the editor's own link works, and leaves a cookie behind that the page's
  // asset requests ride on
  const visitor = await pwRequest.newContext({ baseURL })
  const opened = await visitor.get(url)
  expect(opened.ok()).toBeTruthy()
  expect(await opened.text()).toContain('Live home')

  // ...and the token hit serves the page DIRECTLY, with the cookie on that
  // same response. It used to 303 to the bare path, which a client without a
  // cookie jar (curl, fetch, an MCP agent) followed cookieless into the 401 —
  // so the `preview` tool's "open the url and look" could never be done by
  // the agent itself.
  const cookieless = await pwRequest.newContext({ baseURL })
  const direct = await cookieless.get(url, { maxRedirects: 0 })
  expect(direct.status()).toBe(200)
  expect(await direct.text()).toContain('Live home')
  expect(direct.headers()['set-cookie']).toContain('guano_preview=')
  // scoped to the mount, so it is never sent with a request for the published
  // site, the editor or the API
  expect(direct.headers()['set-cookie']).toContain(`Path=${MOUNT}`)
  expect(direct.headers()['cache-control']).toContain('no-store')
  // a token on a deeper route serves THAT route, not the home page
  const token = url.split('?t=')[1]
  const deep = await cookieless.get(`${MOUNT}/draft/?t=${token}`, { maxRedirects: 0 })
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
    const ctx = await pwRequest.newContext({ baseURL })
    try {
      return (await ctx.get(path, { maxRedirects: 0 })).status()
    } finally {
      await ctx.dispose()
    }
  }
  expect(await probe(`${MOUNT}/?t=${token}/`)).toBe(200)
  expect(await probe(`${MOUNT}/?t=${token}%23editor`)).toBe(200)
  expect(await probe(`${MOUNT}/?t=${token}x`)).toBe(401)
  await cookieless.dispose()
  expect((await visitor.get(`${MOUNT}/assets/style.css`)).ok()).toBeTruthy()
  expect((await visitor.get(`${MOUNT}/draft/`)).ok()).toBeTruthy()

  // The preview cookie unlocks the preview and NOTHING else. It is one path on
  // the studio's origin now, so this is the assertion that replaces "the
  // editor is not reachable from the preview port": an unauthenticated caller
  // holding only a preview cookie still gets nowhere near the API.
  expect((await visitor.get('/api/store?keys=guano-project:main')).status()).toBe(401)
  // ...and a route under the mount that is not in the export is the export's
  // own miss, never the editor
  const notInExport = await visitor.get(`${MOUNT}/admin/`)
  expect(notInExport.status()).toBe(404)
  expect(await notInExport.text()).not.toContain('<div id="app">')

  await stranger.dispose()
  await visitor.dispose()
  await admin.dispose()
})
