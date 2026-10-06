import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'

// POST /_guano/forms/:id — the only unauthenticated WRITE in the product.
//
// This spec is the refusal order, in order. A public endpoint that stores what
// strangers send and can make the instance send mail is the one surface where
// "it works" is not the question worth asking; what it REFUSES is.
//
// Sorts after smoke.spec.ts, which owns the first-run flow.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }
const FORM_ID = 'e2e-form'

async function adminContext(baseURL?: string) {
  const ctx = await pwRequest.newContext({ baseURL })
  let res = await ctx.post('/api/auth/login', { data: ADMIN })
  if (!res.ok()) {
    res = await ctx.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })
    expect(res.ok()).toBeTruthy()
  }
  return ctx
}

const snapshot = () => ({
  schemaVersion: 2,
  name: 'Forms Co',
  pages: [
    {
      id: 'home',
      name: 'Home',
      path: '',
      status: 'published',
      elements: [
        {
          id: 'b1',
          type: 'body',
          children: [
            {
              id: FORM_ID,
              type: 'form',
              form: { enabled: true, name: 'Contact', notify: true },
              children: [
                { id: 'f1', type: 'input', attributes: { name: 'email', type: 'email', required: '' }, children: [] },
                { id: 'f2', type: 'textarea', attributes: { name: 'message', maxlength: '40' }, children: [] },
                {
                  id: 'f3',
                  type: 'select',
                  attributes: { name: 'topic' },
                  children: [
                    { id: 'o1', type: 'option', content: 'sales', children: [] },
                    { id: 'o2', type: 'option', content: 'help', children: [] },
                  ],
                },
                { id: 'f4', type: 'checkbox', attributes: { name: 'optin' }, children: [] },
                // a select inside a COMPONENT INSTANCE. Its option values live
                // on the master, so reading the page nodes recorded
                // `options: ["", ""]` in the manifest and the endpoint then
                // refused every value the page actually offers (E15).
                {
                  id: 'f6',
                  type: 'RoleField',
                  children: [
                    {
                      id: 'p1',
                      type: 'select',
                      children: [
                        { id: 'p2', type: 'option', content: '', children: [] },
                        { id: 'p3', type: 'option', content: '', children: [] },
                      ],
                    },
                  ],
                },
                {
                  id: 'f5',
                  type: 'form-success',
                  children: [{ id: 't1', type: 'text', content: 'Thanks', children: [] }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  components: [
    {
      id: 'c1',
      name: 'RoleField',
      root: {
        id: 'm0',
        type: 'RoleField',
        content: '',
        children: [
          {
            id: 'm1',
            type: 'select',
            content: '',
            classes: 'appearance-none border px-2',
            attributes: { name: 'role' },
            children: [
              { id: 'm2', type: 'option', content: 'designer', children: [] },
              { id: 'm3', type: 'option', content: 'engineer', children: [] },
            ],
          },
        ],
      },
    },
  ],
  collections: [], interactions: [], animations: [], breakpoints: [], comments: [],
  locales: ['en'], defaultLocale: 'en',
  settings: {
    publishing: { method: 'server', github: { repo: '', branch: 'main' }, apiOrigin: '' },
    seo: { siteName: 'Forms Co', titleTemplate: '%s', description: '' },
    domain: 'forms.example', tokens: [], customCode: { head: '' }, fonts: { family: 'sans' },
  },
})

/**
 * Publish ONCE for the whole file.
 *
 * A publish is rate-limited to 12/min per user and the suite already runs close
 * to that ceiling (see CLAUDE.md). One publish per test exhausted the budget
 * for every spec that followed, which is a test-design bug that looks exactly
 * like a product one.
 */
let published: Promise<void> | null = null
function ensurePublished(admin: APIRequestContext) {
  published ??= (async () => {
    const res = await admin.post('/api/published', { data: snapshot() })
    expect(res.ok()).toBeTruthy()
  })()
  return published
}

/** a visitor: no session, and a fresh client address PER REQUEST. The per-IP
 *  limit (5/minute) is real, so a test sharing one address would be measuring
 *  the limiter instead of the endpoint. The suite runs with TRUST_PROXY=1 so
 *  the last X-Forwarded-For hop is the client (see playwright.config.ts). */
let ipSeq = 0
const nextIp = () => `203.0.113.${(ipSeq++ % 240) + 10}`
const visitor = (baseURL?: string) => pwRequest.newContext({ baseURL })

const body = (fields: Record<string, string>) => new URLSearchParams(fields).toString()
const GOOD = { email: 'v@example.com', message: 'hello', topic: 'sales', _route: '/', _t: '4000' }

async function post(
  ctx: APIRequestContext,
  fields: Record<string, string>,
  { id = FORM_ID, ip, origin }: { id?: string; ip?: string; origin?: string } = {},
) {
  return ctx.post(`/_guano/forms/${id}`, {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      'x-forwarded-for': ip ?? nextIp(),
      ...(origin ? { origin } : {}),
    },
    data: body(fields),
    maxRedirects: 0,
  })
}

test.describe('the public form endpoint', () => {
  test('a submission is validated against what was PUBLISHED, and stored', async ({ baseURL }) => {
    const admin = await adminContext(baseURL)
    await ensurePublished(admin)

    const v = await visitor(baseURL)
    const res = await post(v, GOOD)
    expect(res.status()).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })

    // it reads back through the authed API, with the manifest's columns
    const read = await (await admin.get(`/api/forms/${FORM_ID}/submissions`)).json()
    expect(read.total).toBe(1)
    expect(read.submissions[0].values).toMatchObject({ email: 'v@example.com', message: 'hello' })
    // an unchecked box is false, not absent — the column stays stable
    expect(read.submissions[0].values.optin).toBe(false)
    // NO ip and no user agent: personal data we have no use for
    expect(read.submissions[0].ip).toBeUndefined()
    expect(Object.keys(read.submissions[0])).not.toContain('ua')

    // the list view carries the counts
    const list = await (await admin.get('/api/forms')).json()
    const row = list.forms.find((f: { formId: string }) => f.formId === FORM_ID)
    expect(row).toMatchObject({ name: 'Contact', count: 1, onSite: true })

    await v.dispose()
    await admin.dispose()
  })

  test('every refusal, in the order they are checked', async ({ baseURL }) => {
    const admin = await adminContext(baseURL)
    await ensurePublished(admin)
    const v = await visitor(baseURL)

    // an unknown form and a disabled one answer the SAME 404, so probing
    // cannot enumerate which ids exist
    expect((await post(v, GOOD, { id: 'no-such-form' })).status()).toBe(404)
    expect((await post(v, GOOD, { id: 'has%20spaces' })).status()).toBe(404)

    // multipart (file uploads) is refused outright in v1
    const wrongType = await v.post(`/_guano/forms/${FORM_ID}`, {
      headers: { 'content-type': 'application/json' },
      data: '{}',
    })
    expect(wrongType.status()).toBe(415)

    // GET is not a thing
    expect((await v.get(`/_guano/forms/${FORM_ID}`)).status()).toBe(405)

    // a route the form was never exported on: one form id must not accept
    // submissions attributed to any page on the site
    expect((await post(v, { ...GOOD, _route: '/elsewhere' })).status()).toBe(400)

    // the field rules, each naming the field so the runtime can mark it
    const missing = await post(v, { message: 'x', _route: '/', _t: '4000' })
    expect(missing.status()).toBe(400)
    expect((await missing.json()).field).toBe('email')
    expect((await post(v, { ...GOOD, email: 'not-an-email' })).status()).toBe(400)
    expect((await post(v, { ...GOOD, message: 'x'.repeat(50) })).status()).toBe(400)
    expect((await post(v, { ...GOOD, topic: 'not-offered' })).status()).toBe(400)

    // an oversized body is cut off rather than buffered
    const big = await v.post(`/_guano/forms/${FORM_ID}`, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      data: body({ ...GOOD, message: 'x'.repeat(40_000) }),
    })
    expect(big.status()).toBe(413)

    await v.dispose()
    await admin.dispose()
  })

  test('the spam traps answer success and store nothing', async ({ baseURL }) => {
    const admin = await adminContext(baseURL)
    await ensurePublished(admin)
    await admin.delete(`/api/forms/${FORM_ID}/submissions`)
    const v = await visitor(baseURL)

    // a bot told "caught" adapts; one told "thank you" does not
    const hp = await post(v, { ...GOOD, _hp: 'i am a bot' })
    expect(hp.status()).toBe(200)
    expect(await hp.json()).toMatchObject({ ok: true })
    const fast = await post(v, { ...GOOD, _t: '20' })
    expect(fast.status()).toBe(200)

    const read = await (await admin.get(`/api/forms/${FORM_ID}/submissions`)).json()
    expect(read.total).toBe(0)
    const list = await (await admin.get('/api/forms')).json()
    expect(list.forms.find((f: { formId: string }) => f.formId === FORM_ID).spamDropped).toBeGreaterThan(0)

    await v.dispose()
    await admin.dispose()
  })

  test('an unknown field name is discarded, never stored', async ({ baseURL }) => {
    const admin = await adminContext(baseURL)
    await ensurePublished(admin)
    await admin.delete(`/api/forms/${FORM_ID}/submissions`)
    const v = await visitor(baseURL)

    // dropped rather than refused: a bot adding junk keys must not be able to
    // make a real visitor's submission fail
    expect((await post(v, { ...GOOD, surprise: 'payload' })).status()).toBe(200)
    const read = await (await admin.get(`/api/forms/${FORM_ID}/submissions`)).json()
    expect(JSON.stringify(read.submissions[0].values)).not.toContain('payload')

    await v.dispose()
    await admin.dispose()
  })

  test('CORS allows the published domain and nothing else, and never credentials', async ({
    baseURL,
  }) => {
    const admin = await adminContext(baseURL)
    await ensurePublished(admin)

    // the origin goes per REQUEST, so `post` can still rotate the client
    // address and keep the per-IP limiter out of the way
    const allowed = await visitor(baseURL)
    const ok = await post(allowed, GOOD, { origin: 'https://forms.example' })
    expect(ok.status()).toBe(200)
    // matched, never reflected, and never with credentials
    expect(ok.headers()['access-control-allow-origin']).toBe('https://forms.example')
    expect(ok.headers()['access-control-allow-credentials']).toBeUndefined()
    expect(ok.headers()['vary']).toBe('origin')

    const denied = await visitor(baseURL)
    const no = await post(denied, GOOD, { origin: 'https://evil.example' })
    expect(no.status()).toBe(403)
    expect(no.headers()['access-control-allow-origin']).toBeUndefined()

    // the preflight, both ways
    const pre = await allowed.fetch(`/_guano/forms/${FORM_ID}`, {
      method: 'OPTIONS',
      headers: { origin: 'https://forms.example' },
    })
    expect(pre.status()).toBe(204)
    expect(pre.headers()['access-control-allow-methods']).toContain('POST')
    const preBad = await denied.fetch(`/_guano/forms/${FORM_ID}`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    })
    expect(preBad.status()).toBe(403)

    for (const c of [admin, allowed, denied]) await c.dispose()
  })

  test('without JS the native post lands back on the site', async ({ baseURL }) => {
    const admin = await adminContext(baseURL)
    await ensurePublished(admin)
    const v = await visitor(baseURL)

    // no `accept: application/json` — a plain browser form post
    const res = await v.post(`/_guano/forms/${FORM_ID}`, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      data: body(GOOD),
      maxRedirects: 0,
    })
    expect(res.status()).toBe(303)
    expect(res.headers()['location']).toContain('form=sent')

    await v.dispose()
    await admin.dispose()
  })

  test('the per-IP limit fires and says when to retry', async ({ baseURL }) => {
    const admin = await adminContext(baseURL)
    await ensurePublished(admin)
    // ONE pinned address: this is the case that must be limited
    const v = await visitor(baseURL)

    let limited = null
    for (let i = 0; i < 12; i++) {
      // one pinned address, on purpose: this is the case that MUST be limited
      const res = await post(v, GOOD, { ip: '192.0.2.123' })
      if (res.status() === 429) {
        limited = res
        break
      }
    }
    expect(limited).not.toBeNull()
    expect(limited!.headers()['retry-after']).toBeTruthy()
    expect((await limited!.json()).retryAfterSeconds).toBeGreaterThan(0)

    await v.dispose()
    await admin.dispose()
  })

  test('a private site gates the endpoint, not just the pages', async ({ baseURL }) => {
    const admin = await adminContext(baseURL)
    await ensurePublished(admin)
    await admin.put('/api/site-password', { data: { enabled: true, password: 'letmein1' } })

    const v = await visitor(baseURL)
    try {
      // the form id is only discoverable from a page nobody can read, which is
      // weak protection and not the kind to rely on
      expect((await post(v, GOOD)).status()).toBe(401)
    } finally {
      // restore it even on failure: every spec after this one serves the site
      await admin.put('/api/site-password', { data: { enabled: false, password: '' } })
      await v.dispose()
      await admin.dispose()
    }
  })

  test('a submission is not accepted under /api', async ({ baseURL }) => {
    const v = await visitor(baseURL)
    // The two prefixes are disjoint on purpose: /api/forms IS a route, but the
    // AUTHED read API, so an unauthenticated submission posted there is turned
    // away by auth and never reaches any submission handling.
    const res = await v.post(`/api/forms/${FORM_ID}`, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      data: body(GOOD),
    })
    expect(res.status()).toBe(401)
    // and nothing in that namespace is readable without a session either
    expect((await v.get('/api/forms')).status()).toBe(401)
    expect((await v.get(`/api/forms/${FORM_ID}/submissions`)).status()).toBe(401)
    expect((await v.get(`/api/forms/${FORM_ID}/submissions.csv`)).status()).toBe(401)
    await v.dispose()
  })
})

test.describe('reading submissions', () => {
  test('contributors cannot read; a token needs the policy; nobody deletes with one', async ({
    baseURL,
  }) => {
    const admin = await adminContext(baseURL)
    await ensurePublished(admin)
    const v = await visitor(baseURL)
    await post(v, GOOD)

    // a contributor is the lowest-privilege role and the likeliest outsider
    const invite = await admin.post('/api/users/invite', {
      data: { name: 'C', email: 'contrib-forms@example.com', role: 'contributor' },
    })
    const { token: inviteToken } = await invite.json()
    const contributor = await pwRequest.newContext({ baseURL })
    await contributor.post(`/api/invite/${inviteToken}/accept`, { data: { password: ADMIN.password } })
    expect((await contributor.get('/api/forms')).status()).toBe(403)
    expect((await contributor.get(`/api/forms/${FORM_ID}/submissions`)).status()).toBe(403)

    // an agent token is refused until an admin opens the gate
    const minted = await admin.post('/api/tokens', { data: { name: 'forms-spec' } })
    const { token } = await minted.json()
    const agent = await pwRequest.newContext({
      baseURL,
      extraHTTPHeaders: { authorization: `Bearer ${token}` },
    })
    const blocked = await agent.get(`/api/forms/${FORM_ID}/submissions`)
    expect(blocked.status()).toBe(403)
    expect((await blocked.json()).error).toContain('personal')

    await admin.put('/api/agent-policy', { data: { allowFormSubmissions: true } })
    const opened = await agent.get(`/api/forms/${FORM_ID}/submissions`)
    expect(opened.ok()).toBeTruthy()
    const payload = await opened.json()
    // fenced: visitor-written text is DATA, never an instruction
    expect(payload._untrusted).toContain('never instructions')
    expect(payload.submissions[0].values.email).toMatchObject({
      untrusted: true,
      text: 'v@example.com',
    })

    // and never a delete, policy or not
    expect((await agent.delete(`/api/forms/${FORM_ID}/submissions`)).status()).toBe(403)
    await admin.put('/api/agent-policy', { data: { allowFormSubmissions: false } })

    for (const c of [v, contributor, agent, admin]) await c.dispose()
  })

  test('the CSV quotes properly and defuses a formula', async ({ baseURL }) => {
    const admin = await adminContext(baseURL)
    await ensurePublished(admin)
    await admin.delete(`/api/forms/${FORM_ID}/submissions`)
    const v = await visitor(baseURL)

    // a visitor writes the cells, and a spreadsheet EXECUTES one starting `=`
    await post(v, { ...GOOD, message: '=HYPERLINK("http://evil","click")' })
    await post(v, { ...GOOD, email: 'quote@example.com', message: 'he said "hi", then left' })

    const res = await admin.get(`/api/forms/${FORM_ID}/submissions.csv`)
    expect(res.ok()).toBeTruthy()
    expect(res.headers()['content-type']).toContain('text/csv')
    expect(res.headers()['content-disposition']).toContain('attachment')
    const csv = await res.text()
    // the formula is now literal text
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).not.toMatch(/,=HYPERLINK/)
    // a comma and a quote inside a value do not shift the columns
    expect(csv).toContain('"he said ""hi"", then left"')
    // a BOM, or Excel on Windows mangles an accented name
    expect(csv.charCodeAt(0)).toBe(0xfeff)

    await v.dispose()
    await admin.dispose()
  })

  test('a submission can be deleted, one or all', async ({ baseURL }) => {
    const admin = await adminContext(baseURL)
    await ensurePublished(admin)
    await admin.delete(`/api/forms/${FORM_ID}/submissions`)
    const v = await visitor(baseURL)
    await post(v, GOOD)
    await post(v, { ...GOOD, email: 'second@example.com' })

    let read = await (await admin.get(`/api/forms/${FORM_ID}/submissions`)).json()
    expect(read.total).toBe(2)
    const one = read.submissions[0].id
    expect((await admin.delete(`/api/forms/${FORM_ID}/submissions/${one}`)).ok()).toBeTruthy()
    read = await (await admin.get(`/api/forms/${FORM_ID}/submissions`)).json()
    expect(read.total).toBe(1)
    expect((await admin.delete(`/api/forms/${FORM_ID}/submissions/${one}`)).status()).toBe(404)

    expect((await admin.delete(`/api/forms/${FORM_ID}/submissions`)).ok()).toBeTruthy()
    read = await (await admin.get(`/api/forms/${FORM_ID}/submissions`)).json()
    expect(read.total).toBe(0)

    await v.dispose()
    await admin.dispose()
  })

  test('a contributor cannot turn a form on through a project write', async ({ baseURL }) => {
    const admin = await adminContext(baseURL)
    const main = snapshot()
    // store Main with the form OFF
    const off = JSON.parse(JSON.stringify(main))
    delete off.pages[0].elements[0].children[0].form
    expect((await admin.put('/api/store/guano-project%3Amain', { data: off })).ok()).toBeTruthy()

    const invite = await admin.post('/api/users/invite', {
      data: { name: 'C2', email: 'contrib-form2@example.com', role: 'contributor' },
    })
    const { token } = await invite.json()
    const contributor = await pwRequest.newContext({ baseURL })
    await contributor.post(`/api/invite/${token}/accept`, { data: { password: ADMIN.password } })

    // `node.form` is behaviour, not content: the server merge keeps the stored
    // value and drops theirs
    const wrote = await contributor.put('/api/store/guano-project%3Amain', { data: main })
    expect(wrote.status()).toBe(200)
    const stored = await (await admin.get('/api/store?keys=guano-project:main')).json()
    const form = JSON.parse(stored['guano-project:main']).pages[0].elements[0].children[0]
    expect(form.form).toBeUndefined()

    await contributor.dispose()
    await admin.dispose()
  })
})

test.describe('a select inside a component instance', () => {
  // E15: an <option>'s value and text live on the MASTER when the select sits
  // inside an instance, which is how the guide tells you to build a field. The
  // manifest read the page nodes, recorded `options: ["", ""]`, and the
  // endpoint then refused "designer" — the value the page itself offers — with
  // "role is not one of the offered values". A visitor got a 400 for picking
  // the first option in the list.
  test('the value the page offers is accepted, and a made-up one is not', async ({ baseURL }) => {
    const admin = await adminContext(baseURL)
    await ensurePublished(admin)

    const good = await post(await visitor(baseURL), { ...GOOD, role: 'designer' })
    expect(good.status()).toBe(200)
    expect(await good.json()).toMatchObject({ ok: true })

    const bad = await post(await visitor(baseURL), { ...GOOD, role: 'ceo' })
    expect(bad.status()).toBe(400)
    expect((await bad.json()).field).toBe('role')

    // the stored row carries the value, not an empty string
    const read = await (await admin.get(`/api/forms/${FORM_ID}/submissions`)).json()
    expect(JSON.stringify(read.submissions)).toContain('designer')

    // leave the store as it was found: submissions outlive a publish, and a
    // later spec's Forms panel lists every form that still has one — including
    // this file's, as "(removed)"
    expect((await admin.delete(`/api/forms/${FORM_ID}/submissions`)).ok()).toBeTruthy()
    await admin.dispose()
  })
})
