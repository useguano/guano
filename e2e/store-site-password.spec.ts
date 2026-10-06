import { test, expect, request as pwRequest } from '@playwright/test'

// A private site: one shared visitor password in front of the published
// pages, enforced by this server. The hash lives in publish.json, the switch
// beside it; the unlock cookie is derived from the hash, so a new password
// logs every visitor out.
//
// API-level spec: bootstraps its own admin like store-roles, so it does not
// depend on ordering beyond sorting after smoke.spec.ts.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }

const snapshot = () => ({
  name: 'Private Co',
  pages: [
    {
      id: 'p1',
      name: 'Home',
      path: '/',
      status: 'published',
      elements: [{ id: 'b1', type: 'body', children: [{ id: 'h1', type: 'h1', content: 'Members only', children: [] }] }],
    },
  ],
  components: [], collections: [], interactions: [], animations: [], breakpoints: [], comments: [],
  locales: ['en'], defaultLocale: 'en',
  settings: {
    publishing: { method: 'server', github: { repo: '', branch: '' } },
    seo: { siteName: 'P', titleTemplate: '%s', description: '' },
    domain: '', tokens: [], customCode: { head: '' }, fonts: { family: 'sans' },
  },
})

test('a private site asks for its password, then serves', async ({ baseURL }) => {
  const admin = await pwRequest.newContext({ baseURL })
  let res = await admin.post('/api/auth/login', { data: ADMIN })
  if (!res.ok()) {
    res = await admin.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })
    expect(res.ok()).toBeTruthy()
  }
  expect((await admin.post('/api/published', { data: snapshot() })).ok()).toBeTruthy()

  // anyone can read the site before the gate is on
  const visitor = await pwRequest.newContext({ baseURL })
  expect(await (await visitor.get('/')).text()).toContain('Members only')

  // the switch alone does nothing until a password exists
  res = await admin.put('/api/site-password', { data: { enabled: true } })
  expect(await res.json()).toMatchObject({ enabled: true, passwordSet: false })
  expect(await (await visitor.get('/')).text()).toContain('Members only')

  expect((await admin.put('/api/site-password', { data: { password: 'abc' } })).status()).toBe(400)
  // the minimum is 8: a shared visitor password is the only thing between the
  // public and unpublished-adjacent content, and four characters is a guess
  const short = await admin.put('/api/site-password', { data: { password: 'letmein' } })
  expect(short.status()).toBe(400)
  expect(await short.text()).toContain('at least 8')
  res = await admin.put('/api/site-password', { data: { password: 'letmein1' } })
  expect(await res.json()).toMatchObject({ enabled: true, passwordSet: true })

  // now the gate page, for the page and for its assets
  const gated = await visitor.get('/')
  expect(gated.status()).toBe(401)
  expect(await gated.text()).toContain('This site is private')
  expect(gated.headers()['x-robots-tag']).toContain('noindex')
  expect((await visitor.get('/assets/style.css')).status()).toBe(401)

  // wrong password: the gate again, with the error
  res = await visitor.post('/_guano/unlock', { form: { password: 'nope', next: '/' } })
  expect(res.status()).toBe(401)
  expect(await res.text()).toContain('not right')

  // right password: redirected to where they were going, cookie set, site served
  res = await visitor.post('/_guano/unlock', { form: { password: 'letmein1', next: '/' }, maxRedirects: 0 })
  expect(res.status()).toBe(303)
  expect(res.headers()['set-cookie']).toContain('guano_site=')
  expect(await (await visitor.get('/')).text()).toContain('Members only')

  // an open redirect is never followed. `//` was checked; `/\\` was not, and a
  // browser treats it the same for a special scheme — so this landed the
  // visitor on an attacker's host immediately after they typed the real
  // password. site-runtime.js already rejected both for a form redirect.
  for (const next of ['//evil.test/x', '/\\evil.test/x', 'https://evil.test', '\\\\evil.test']) {
    res = await visitor.post('/_guano/unlock', {
      form: { password: 'letmein1', next },
      maxRedirects: 0,
    })
    expect(res.headers()['location'], `next=${next}`).toBe('/')
  }
  // ...while a genuine path still carries through
  res = await visitor.post('/_guano/unlock', {
    form: { password: 'letmein1', next: '/about' },
    maxRedirects: 0,
  })
  expect(res.headers()['location']).toBe('/about')

  // a new password invalidates the old cookie
  await admin.put('/api/site-password', { data: { password: 'changed1' } })
  expect((await visitor.get('/')).status()).toBe(401)

  // and off is off, password kept
  res = await admin.put('/api/site-password', { data: { enabled: false } })
  expect(await res.json()).toMatchObject({ enabled: false, passwordSet: true })
  expect(await (await visitor.get('/')).text()).toContain('Members only')

  // the endpoint itself is for builders with a session
  const anon = await pwRequest.newContext({ baseURL })
  expect((await anon.get('/api/site-password')).status()).toBe(401)
})
