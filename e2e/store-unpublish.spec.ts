import { test, expect, request as pwRequest } from '@playwright/test'

// DELETE /api/published takes the live site down: the export and its snapshot
// go, visitors get the "nothing published" answer, and the next publish is a
// first one again. Humans with a build role only.
//
// API-level spec: bootstraps its own admin like store-roles, so it does not
// depend on ordering beyond sorting after smoke.spec.ts.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }

const snapshot = () => ({
  name: 'Unpublish Co',
  pages: [
    {
      id: 'p1',
      name: 'Home',
      path: '/',
      status: 'published',
      elements: [{ id: 'b1', type: 'body', children: [{ id: 'h1', type: 'h1', content: 'Live home', children: [] }] }],
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
    seo: { siteName: 'U', titleTemplate: '%s', description: '' },
    domain: '',
    tokens: [],
    customCode: { head: '' },
    fonts: { family: 'sans' },
  },
})

test('unpublishing removes the live site until the next publish', async ({ baseURL }) => {
  const admin = await pwRequest.newContext({ baseURL })
  let res = await admin.post('/api/auth/login', { data: ADMIN })
  if (!res.ok()) {
    res = await admin.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })
    expect(res.ok()).toBeTruthy()
  }

  res = await admin.post('/api/published', { data: snapshot() })
  expect(res.ok()).toBeTruthy()
  expect(await (await admin.get('/')).text()).toContain('Live home')

  const anon = await pwRequest.newContext({ baseURL })
  expect((await anon.delete('/api/published')).status()).toBe(401)

  expect((await admin.delete('/api/published')).ok()).toBeTruthy()
  const down = await admin.get('/')
  expect(down.status()).toBe(404)
  expect(await down.text()).toContain('Nothing published yet')
})
