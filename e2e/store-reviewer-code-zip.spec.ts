import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'
import { readZip } from '../server/zip.mjs'

// Three server contracts added together, API-level and self-bootstrapping like
// store-agent-security.spec, and named to sort AFTER smoke.spec (which owns
// the first-run flow):
//
//  1. The REVIEWER role: reads and comments, nothing else. A reviewer's project
//     write keeps the stored blob whole and takes only `comments`; publish,
//     preview, tokens, the team list and every media mutation are refused.
//  2. A `custom-code` element's content is raw HTML the exporter emits
//     verbatim — so it is held to the custom-code gate: a contributor's write
//     is refused by name, an agent's needs `allowCustomCode`, and a builder's
//     ships as written.
//  3. The ZIP export rewrites root-absolute URLs to depth-relative ones, so the
//     archive opens from disk and from a sub-folder; the directory on disk
//     keeps `/assets/…` for the `server` method.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }
const REVIEWER = { email: 'reviewer@example.com', password: 'reviewer-pass-1' }
const CONTRIB = { email: 'contrib@example.com', password: 'contrib-pass-1' }
const MAIN = 'guano-project:main'

async function adminContext(baseURL: string | undefined) {
  const ctx = await pwRequest.newContext({ baseURL })
  const res = await ctx.post('/api/auth/login', { data: ADMIN })
  if (!res.ok()) {
    expect((await ctx.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })).ok()).toBeTruthy()
  }
  return ctx
}

/** a session for an invited role, invited on first run and reused afterwards */
async function roleContext(
  admin: APIRequestContext,
  baseURL: string | undefined,
  who: { email: string; password: string },
  role: string,
) {
  const ctx = await pwRequest.newContext({ baseURL })
  const invite = await admin.post('/api/users/invite', { data: { name: role, email: who.email, role } })
  if (invite.ok()) {
    const { token } = await invite.json()
    expect((await ctx.post(`/api/invite/${token}/accept`, { data: { password: who.password } })).ok()).toBeTruthy()
  } else {
    expect((await ctx.post('/api/auth/login', { data: who })).ok()).toBeTruthy()
  }
  return ctx
}

const CODE = '<script>window.__embed = 1</script><div id="widget"></div>'

/** Main with one published page holding a heading and a custom-code block */
function project(code: string) {
  return {
    name: 'Zip Co',
    schemaVersion: 2,
    pages: [
      {
        id: 'home',
        name: 'Home',
        path: '/',
        status: 'published',
        elements: [
          {
            id: 'body',
            type: 'body',
            children: [
              { id: 'h', type: 'h1', content: 'Hello', children: [] },
              { id: 'code', type: 'custom-code', classes: 'my-4', content: code, children: [] },
              { id: 'link', type: 'link', link: '/about', children: [{ id: 'lt', type: 'span', content: 'About', children: [] }] },
            ],
          },
        ],
      },
      {
        id: 'about',
        name: 'About',
        path: '/about',
        status: 'published',
        elements: [
          { id: 'body2', type: 'body', children: [{ id: 'h2', type: 'h1', content: 'About', children: [] }] },
        ],
      },
    ],
    components: [],
    collections: [],
    interactions: [],
    animations: [],
    comments: [],
    locales: ['en'],
    defaultLocale: 'en',
    settings: { customCode: { head: '' } },
  }
}

async function readMain(ctx: APIRequestContext) {
  const res = await ctx.get(`/api/store?keys=${MAIN}`)
  expect(res.ok()).toBeTruthy()
  return JSON.parse(((await res.json()) as Record<string, string>)[MAIN]!)
}

test('a reviewer can only add comments', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  const main = project(CODE)
  expect((await admin.put(`/api/store/${MAIN}`, { data: JSON.stringify(main) })).ok()).toBeTruthy()
  const reviewer = await roleContext(admin, baseURL, REVIEWER, 'reviewer')

  // a comment lands; a content edit, a structural edit and a settings change
  // riding in the same blob do not
  const tampered = JSON.parse(JSON.stringify(main))
  tampered.pages[0].elements[0].children[0].content = 'Defaced'
  tampered.pages[0].elements[0].children.push({ id: 'new', type: 'div', children: [] })
  tampered.pages[0].status = 'draft'
  tampered.settings.seo = { title: 'changed' }
  tampered.comments = [{ id: 'c1', pageId: 'home', text: 'Looks good', author: 'Reviewer', createdAt: 1, resolved: false, replies: [] }]
  const put = await reviewer.put(`/api/store/${MAIN}`, { data: JSON.stringify(tampered) })
  expect(put.ok()).toBeTruthy()
  const stored = await readMain(admin)
  expect(stored.comments.map((c: { text: string }) => c.text)).toEqual(['Looks good'])
  expect(stored.pages[0].elements[0].children[0].content).toBe('Hello')
  expect(stored.pages[0].elements[0].children).toHaveLength(3)
  expect(stored.pages[0].status).toBe('published')
  expect(stored.settings.seo).toBeUndefined()

  // nothing else: no draft, no draft index, no delete, no publish or preview
  // by any method, no token, no team list, no media mutation
  expect((await reviewer.put('/api/store/guano-project:rev-draft', { data: JSON.stringify(main) })).status()).toBe(403)
  expect((await reviewer.put('/api/store/guano-branches', { data: JSON.stringify({ branches: [] }) })).status()).toBe(403)
  expect((await reviewer.delete(`/api/store/${MAIN}`)).status()).toBe(403)
  for (const method of ['server', 'zip', 'github']) {
    expect((await reviewer.post(`/api/published?method=${method}`, { data: main })).status()).toBe(403)
  }
  expect((await reviewer.post('/api/preview', { data: main })).status()).toBe(403)
  expect((await reviewer.post('/api/tokens', { data: { name: 'x' } })).status()).toBe(403)
  expect((await reviewer.get('/api/users/members')).status()).toBe(403)
  expect((await reviewer.get('/api/media')).ok()).toBeTruthy()
  expect((await reviewer.post('/api/media/folders', { data: { name: 'x' } })).status()).toBe(403)

  await admin.dispose()
  await reviewer.dispose()
})

test('a custom-code block is gated like custom code and exported verbatim', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  const main = project(CODE)
  expect((await admin.put(`/api/store/${MAIN}`, { data: JSON.stringify(main) })).ok()).toBeTruthy()

  // a contributor changing the code is refused BY NAME, not silently dropped
  const contrib = await roleContext(admin, baseURL, CONTRIB, 'contributor')
  const edited = project('<script>alert(1)</script>')
  const refused = await contrib.put(`/api/store/${MAIN}`, { data: JSON.stringify(edited) })
  expect(refused.status()).toBe(403)
  expect((await refused.json()).error).toMatch(/custom-code\[code\]/)
  expect((await readMain(admin)).pages[0].elements[0].children[1].content).toBe(CODE)

  // an agent token needs the switch; with it off the write is refused the same way
  const policy = await admin.get('/api/agent-policy')
  const before = await policy.json()
  await admin.put('/api/agent-policy', { data: { allowMainWrites: true, allowCustomCode: false } })
  const minted = await admin.post('/api/tokens', { data: { name: 'code-spec' } })
  expect(minted.ok()).toBeTruthy()
  const { token, id: tokenId } = await minted.json()
  const agent = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${token}` } })
  const agentRefused = await agent.put(`/api/store/${MAIN}`, { data: JSON.stringify(edited) })
  expect(agentRefused.status()).toBe(403)
  expect((await agentRefused.json()).error).toMatch(/custom-code\[code\]/)
  await admin.put('/api/agent-policy', { data: { allowCustomCode: true } })
  expect((await agent.put(`/api/store/${MAIN}`, { data: JSON.stringify(edited) })).ok()).toBeTruthy()
  // restore
  expect((await admin.put(`/api/store/${MAIN}`, { data: JSON.stringify(main) })).ok()).toBeTruthy()
  await admin.put('/api/agent-policy', { data: before })
  if (tokenId) await admin.delete(`/api/tokens/${tokenId}`)

  // a builder's publish ships the code as written, inside the styled element
  const pub = await admin.post('/api/published?method=server', { data: main })
  expect(pub.ok()).toBeTruthy()
  const visitor = await pwRequest.newContext({ baseURL })
  const html = await (await visitor.get('/')).text()
  expect(html).toContain(`<div class="my-4">${CODE}</div>`)

  await admin.dispose()
  await contrib.dispose()
  await agent.dispose()
  await visitor.dispose()
})

test('the zip export is relative, and named after the project', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  const main = project(CODE)
  expect((await admin.put(`/api/store/${MAIN}`, { data: JSON.stringify(main) })).ok()).toBeTruthy()

  const res = await admin.post('/api/published?method=zip', { data: main })
  expect(res.ok()).toBeTruthy()
  expect(res.headers()['content-disposition']).toMatch(/filename="zip-co_[0-9a-f]{8}\.zip"/)
  const files = readZip(await res.body()) as { path: string; data: Buffer }[]
  const byPath = Object.fromEntries(files.map((f) => [f.path, f.data.toString('utf8')]))

  // the root page addresses its assets and the other route relatively
  expect(byPath['index.html']).toContain('href="assets/style.css"')
  expect(byPath['index.html']).toContain('href="about/index.html"')
  expect(byPath['index.html']).not.toMatch(/(href|src)="\/assets\//)
  // one level down, every reference climbs out first
  expect(byPath['about/index.html']).toContain('href="../assets/style.css"')
  expect(byPath['about/index.html']).not.toMatch(/(href|src)="\//)

  // the served site keeps root-absolute URLs — that is what a domain root needs
  const visitor = await pwRequest.newContext({ baseURL })
  expect(await (await visitor.get('/')).text()).toContain('href="/assets/style.css"')

  await admin.dispose()
  await visitor.dispose()
})
